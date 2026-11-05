"""Servizi di pianificazione: collegano database, dati e motore matematico.
L'interfaccia chiama solo queste funzioni."""
from __future__ import annotations

from dataclasses import dataclass

from ..core.halo import BANDS, BandCrossing, band_crossings
from ..core.qt import LegResult, NavPoint, ObstructionModel, check_obstructions, classify, rank_candidates
from ..core.vector import Vec3, distance
from ..data import citizenhq
from ..data.bodies import obstruction_model
from ..db.database import Database


def location_key(row) -> str:
    return f"{row['source']}:{row['uuid']}"


def custom_key(row) -> str:
    return f"cp:{row['name']}"


def nav_points(db: Database, system: str) -> dict[str, NavPoint]:
    """Tutti i punti del sistema: posizioni importate + punti personali."""
    pts: dict[str, NavPoint] = {}
    for r in db.locations(system):
        k = location_key(r)
        pts[k] = NavPoint(k, r["name"], Vec3(r["x"], r["y"], r["z"]), bool(r["qt_valid"]), r["source"])
    for r in db.custom_points(system):
        k = custom_key(r)
        pts[k] = NavPoint(k, f"★ {r['name']}", Vec3(r["x"], r["y"], r["z"]), False, "personale")
    return pts


def import_system(db: Database, system: str):
    locs, report = citizenhq.fetch_system(system)
    db.replace_locations(citizenhq.SOURCE, system, locs, report)
    return report


def plan_to_target(db: Database, system: str, start: NavPoint, target: Vec3,
                   margin: float, include_blocked: bool = False) -> tuple[list[LegResult], ObstructionModel]:
    pts = nav_points(db, system)
    candidates = [p for p in pts.values() if p.qt_valid]
    model = obstruction_model(system, margin)
    res = rank_candidates(start, target, candidates, model, db.verified_pairs(system), include_blocked)
    return res, model


@dataclass(slots=True)
class HaloOption:
    start: NavPoint
    dest: NavPoint
    crossing: BandCrossing
    leg_length_m: float
    status: str
    notes: list[str]
    obstructed_by: list[str]


def halo_options(db: Database, start: NavPoint, band: int, margin: float,
                 dest_key: str | None = None) -> list[HaloOption]:
    """Tratte da start che attraversano la fascia richiesta entro la sua altezza.
    Ordinate per finestra di interruzione piu' ampia (piu' tollerante)."""
    system = "stanton"
    pts = nav_points(db, system)
    model = obstruction_model(system, margin)
    verified = db.verified_pairs(system)
    dests = [pts[dest_key]] if dest_key else [p for p in pts.values() if p.qt_valid]
    out: list[HaloOption] = []
    for d in dests:
        if d.key == start.key:
            continue
        for c in band_crossings(start.pos, d.pos, BANDS[band]):
            if not c.within_height and not dest_key:
                continue
            obs = check_obstructions(start.pos, d.pos, model)
            if any(not o.uncertain for o in obs) and not dest_key:
                continue
            status, notes = classify(start, d, obs, model, (start.key, d.key) in verified)
            if not c.within_height:
                notes.append("La tratta attraversa il raggio della fascia ma fuori dalla sua altezza (sopra/sotto gli asteroidi).")
            if any(not o.uncertain for o in obs):
                notes.append("Tratta bloccata da un corpo celeste (stima).")
            out.append(HaloOption(start, d, c, distance(start.pos, d.pos), status.value, notes,
                                  [o.body for o in obs]))
            break  # primo attraversamento nel verso di marcia
    out.sort(key=lambda o: -o.crossing.window_m)
    return out
