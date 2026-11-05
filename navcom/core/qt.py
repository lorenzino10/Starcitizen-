"""Valutazione delle tratte quantiche verso un bersaglio arbitrario.

Modello:
  * una tratta QT e' il segmento S->D fra partenza S e marker QT D;
  * il pilota puo' interrompere il salto in qualunque punto del segmento;
  * il punto migliore per avvicinarsi a un bersaglio P e' la proiezione di P
    sul segmento (t limitato a [0,1]);
  * l'HUD durante il QT mostra la distanza residua verso D, quindi il valore
    da attendere e' |D - C| dove C e' il punto di interruzione;
  * dopo l'interruzione si vola in modo convenzionale per |P - C|.

Una retta geometricamente possibile NON e' una rotta QT disponibile: lo stato
di ogni tratta e' classificato esplicitamente (vedi RouteStatus).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .geometry import project_point_on_segment
from .vector import Vec3, distance


class RouteStatus(str, Enum):
    VERIFIED = "Verificata nel gioco"
    DATA_SUPPORTED = "Supportata dai dati di navigazione"
    THEORETICAL = "Teorica, da verificare"


@dataclass(frozen=True, slots=True)
class NavPoint:
    """Punto navigabile. qt_valid=True solo se una fonte dati lo indica come
    destinazione QT selezionabile."""
    key: str
    name: str
    pos: Vec3
    qt_valid: bool = False
    source: str = ""


@dataclass(frozen=True, slots=True)
class Body:
    """Corpo celeste usato per il controllo degli ostacoli."""
    name: str
    center: Vec3
    radius_m: float
    source: str = ""
    uncertain: bool = False   # posizione/raggio in conflitto fra fonti


@dataclass(frozen=True, slots=True)
class ObstructionModel:
    bodies: tuple[Body, ...] = ()
    margin: float = 1.2        # raggio efficace = raggio corpo * margin (STIMA)
    complete: bool = False     # True se l'elenco corpi del sistema e' completo


@dataclass(frozen=True, slots=True)
class Obstruction:
    body: str
    clearance_m: float   # distanza minima segmento-centro meno raggio efficace (<0 = colpisce)
    uncertain: bool


def check_obstructions(a: Vec3, b: Vec3, model: ObstructionModel) -> list[Obstruction]:
    """Corpi il cui volume (raggio * margine) interseca il segmento A->B.

    Regola per gli estremi: se A o B si trovano dentro il raggio efficace di un
    corpo (es. avamposto in superficie, stazione in orbita bassa), il raggio di
    quel corpo viene ridotto a 0,999 volte la distanza dell'estremo dal centro.
    Cosi' un segmento che si allontana dalla superficie non risulta bloccato,
    mentre uno che attraversa il pianeta si'.
    """
    hits: list[Obstruction] = []
    for body in model.bodies:
        r = body.radius_m * model.margin
        r = min(r, 0.999 * distance(a, body.center), 0.999 * distance(b, body.center))
        if r <= 0:
            continue
        d = project_point_on_segment(a, b, body.center).distance
        if d < r:
            hits.append(Obstruction(body.name, d - r, body.uncertain))
    return hits


@dataclass(slots=True)
class LegResult:
    start: NavPoint
    dest: NavPoint
    target: Vec3
    leg_length_m: float
    t: float                       # parametro del punto di interruzione
    t_unclamped: float
    drop_point: Vec3
    qt_travel_m: float             # distanza percorsa in QT fino all'interruzione
    hud_remaining_m: float         # distanza da D mostrata in HUD all'interruzione
    residual_m: float              # volo convenzionale residuo verso il bersaglio
    direct_m: float                # volo convenzionale diretto S->P (riferimento)
    status: RouteStatus
    obstructions: list[Obstruction] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def gain_m(self) -> float:
        """Quanto volo convenzionale si risparmia rispetto al volo diretto."""
        return self.direct_m - self.residual_m

    @property
    def needs_manual_drop(self) -> bool:
        return 0.0 < self.t < 1.0

    @property
    def blocked(self) -> bool:
        return any(not o.uncertain for o in self.obstructions)


def classify(start: NavPoint, dest: NavPoint, obstructions: list[Obstruction],
             model: ObstructionModel, verified: bool) -> tuple[RouteStatus, list[str]]:
    notes: list[str] = []
    if verified:
        return RouteStatus.VERIFIED, ["Tratta segnata come provata in gioco."]
    ok = True
    if not dest.qt_valid:
        ok = False
        notes.append("La destinazione non e' indicata come marker QT dalla fonte dati.")
    if not start.qt_valid:
        ok = False
        notes.append("La partenza non e' un marker QT noto: la tratta parte da una posizione libera.")
    if not model.complete:
        ok = False
        notes.append("Dati sui corpi celesti incompleti per questo sistema: ostacoli non verificabili.")
    if any(o.uncertain for o in obstructions):
        ok = False
        notes.append("Possibile ostacolo con dati in conflitto fra fonti.")
    return (RouteStatus.DATA_SUPPORTED if ok else RouteStatus.THEORETICAL), notes


def evaluate_leg(start: NavPoint, dest: NavPoint, target: Vec3,
                 model: ObstructionModel, verified: bool = False) -> LegResult:
    """Valuta la tratta start->dest come mezzo per avvicinarsi a target."""
    proj = project_point_on_segment(start.pos, dest.pos, target)
    leg = distance(start.pos, dest.pos)
    obs = check_obstructions(start.pos, dest.pos, model)
    status, notes = classify(start, dest, obs, model, verified)
    res = LegResult(
        start=start, dest=dest, target=target, leg_length_m=leg,
        t=proj.t, t_unclamped=proj.t_unclamped, drop_point=proj.point,
        qt_travel_m=distance(start.pos, proj.point),
        hud_remaining_m=distance(proj.point, dest.pos),
        residual_m=proj.distance, direct_m=distance(start.pos, target),
        status=status, obstructions=obs, notes=notes,
    )
    if proj.t >= 1.0:
        res.notes.append("Il bersaglio e' oltre la destinazione: nessuna interruzione, si arriva a destinazione.")
    if proj.t <= 0.0:
        res.notes.append("Il bersaglio e' alle spalle: questa tratta non avvicina.")
    return res


def rank_candidates(start: NavPoint, target: Vec3, candidates: list[NavPoint],
                    model: ObstructionModel, verified_pairs: set[tuple[str, str]] | None = None,
                    include_blocked: bool = False) -> list[LegResult]:
    """Valuta tutte le destinazioni candidate e le ordina per convenienza.

    Ordinamento: distanza residua (volo convenzionale) crescente, poi distanza
    QT totale crescente. Sono escluse le tratte che non avvicinano (guadagno
    <= 0) e, salvo include_blocked, quelle bloccate da un corpo celeste.
    """
    verified_pairs = verified_pairs or set()
    out: list[LegResult] = []
    for d in candidates:
        if d.key == start.key:
            continue
        r = evaluate_leg(start, d, target, model, (start.key, d.key) in verified_pairs)
        if r.gain_m <= 0:
            continue
        if r.blocked and not include_blocked:
            continue
        out.append(r)
    out.sort(key=lambda r: (r.blocked, r.residual_m, r.qt_travel_m))
    return out
