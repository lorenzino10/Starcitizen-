"""Corpi celesti per il controllo ostacoli (seed locale con attribuzione).

CitizenHQ non fornisce i raggi dei corpi, quindi i raggi vengono da un seed
locale estratto dal dataset community starmap.space. Solo Stanton e' coperto
per ora: per Pyro e Nyx il modello ostacoli e' dichiarato incompleto e le
tratte risultano "Teoriche".
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from ..core.qt import Body, ObstructionModel
from ..core.vector import Vec3

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"
# Corpi la cui posizione e' in conflitto fra fonti (vedi _meta.known_conflicts).
UNCERTAIN = {"Stanton Star"}


@lru_cache(maxsize=None)
def load_seed(system: str) -> dict | None:
    p = SEED_DIR / f"{system.lower()}_bodies.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def obstruction_model(system: str, margin: float = 1.2) -> ObstructionModel:
    seed = load_seed(system)
    if not seed:
        return ObstructionModel(bodies=(), margin=margin, complete=False)
    bodies = []
    for b in seed["bodies"]:
        bodies.append(Body(
            name=b["name"], center=Vec3(b["x"], b["y"], b["z"]),
            radius_m=float(b["body_radius_m"]), source=seed["_meta"]["source"],
            uncertain=b["name"] in UNCERTAIN,
        ))
        if b["name"] == "Stanton Star":
            # seconda posizione possibile (CitizenHQ): stella all'origine
            bodies.append(Body(name="Stanton Star (origine, CitizenHQ)",
                               center=Vec3(0.0, 0.0, 0.0), radius_m=float(b["body_radius_m"]),
                               source="citizenhq", uncertain=True))
    return ObstructionModel(bodies=tuple(bodies), margin=margin, complete=True)
