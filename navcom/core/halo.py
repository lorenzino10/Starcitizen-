"""Aaron Halo (Stanton): modello a fasce e attraversamenti delle tratte QT.

Fonte delle fasce: CaptSheppard / Cornerstone, "Aaron Halo - Detailed Shape
and Density Survey" (cstone.space), misurata in 3.16.1-LIVE (2022), ripubblicata
invariata fino a 4.x. Le distanze sono riferite al centro della griglia del
sistema Stanton (origine 0,0,0 dei dati di posizione), NON al contenitore
della stella. Valori in km nella fonte, convertiti in metri qui.

Le fasce sono modellate come gusci sferici centrati sull'origine e limitati in
altezza (|z| <= semi-altezza). A ~20 Gm di raggio con |z| <= 5.000 km la
differenza fra raggio sferico e cilindrico e' < 1 km.
"""
from __future__ import annotations

from dataclasses import dataclass

from .geometry import point_at, segment_sphere_roots
from .vector import ORIGIN, Vec3, distance

HALO_SOURCE = "CaptSheppard / Cornerstone (cstone.space), survey 3.16.1-LIVE"


@dataclass(frozen=True, slots=True)
class Band:
    number: int
    inner_m: float
    outer_m: float
    peak_m: float          # punto di massima densita'
    half_height_m: float


_KM = 1000.0
# band: inner, outer, densest point, half-height (km)
_RAW = [
    (1, 19_673_000, 19_715_000, 19_702_000, 625),
    (2, 19_815_000, 19_914_000, 19_857_000, 2_070),
    (3, 19_914_000, 20_071_000, 19_995_000, 4_046),
    (4, 20_129_000, 20_230_000, 20_168_000, 2_912),
    (5, 20_230_000, 20_407_000, 20_320_000, 4_998),
    (6, 20_407_000, 20_540_000, 20_471_000, 5_000),
    (7, 20_540_000, 20_750_000, 20_662_000, 4_998),
    (8, 20_793_000, 20_968_000, 20_881_000, 3_487),
    (9, 21_046_000, 21_132_000, 21_082_000, 2_400),
    (10, 21_159_000, 21_299_000, 21_207_000, 2_008),
]
BANDS: dict[int, Band] = {
    n: Band(n, i * _KM, o * _KM, p * _KM, h * _KM) for n, i, o, p, h in _RAW
}


@dataclass(frozen=True, slots=True)
class BandCrossing:
    band: int
    t_enter: float
    t_exit: float
    t_peak: float | None          # None se la tratta non tocca il raggio di picco
    enter_hud_m: float            # distanza dalla destinazione all'ingresso
    exit_hud_m: float             # distanza dalla destinazione all'uscita
    peak_hud_m: float | None
    window_m: float               # lunghezza del tratto dentro la fascia
    z_enter_m: float
    z_exit_m: float
    within_height: bool           # |z| entro la semi-altezza su tutto il tratto

    def window_seconds(self, speed_m_s: float) -> float:
        """Durata del passaggio a velocita' di crociera costante (stima)."""
        return self.window_m / speed_m_s


def band_crossings(a: Vec3, b: Vec3, band: Band, center: Vec3 = ORIGIN) -> list[BandCrossing]:
    """Intervalli del segmento A->B dentro il guscio [inner, outer] della fascia.

    Ogni intervallo e' dato nel verso di percorrenza: 'enter' e' il primo
    punto incontrato. La distanza HUD e' |B - P(t)|, cioe' la distanza verso la
    destinazione del salto.
    """
    leg = distance(a, b)
    ts = {0.0, 1.0}
    for r in (band.inner_m, band.outer_m):
        ts.update(segment_sphere_roots(a, b, center, r))
    ts_sorted = sorted(ts)
    intervals: list[list[float]] = []
    for t0, t1 in zip(ts_sorted, ts_sorted[1:]):
        if t1 - t0 <= 0:
            continue
        mid = distance(point_at(a, b, (t0 + t1) / 2), center)
        if band.inner_m <= mid <= band.outer_m:
            if intervals and abs(intervals[-1][1] - t0) < 1e-12:
                intervals[-1][1] = t1
            else:
                intervals.append([t0, t1])
    out: list[BandCrossing] = []
    for t0, t1 in intervals:
        peaks = [t for t in segment_sphere_roots(a, b, center, band.peak_m) if t0 <= t <= t1]
        tp = peaks[0] if peaks else None
        p0, p1 = point_at(a, b, t0), point_at(a, b, t1)
        z_ok = abs(p0.z) <= band.half_height_m and abs(p1.z) <= band.half_height_m
        out.append(BandCrossing(
            band=band.number, t_enter=t0, t_exit=t1, t_peak=tp,
            enter_hud_m=(1 - t0) * leg, exit_hud_m=(1 - t1) * leg,
            peak_hud_m=None if tp is None else (1 - tp) * leg,
            window_m=(t1 - t0) * leg, z_enter_m=p0.z, z_exit_m=p1.z,
            within_height=z_ok,
        ))
    return out


def locate(pos: Vec3, center: Vec3 = ORIGIN) -> tuple[int | None, float]:
    """Fascia in cui si trova pos (None se fuori) e distanza radiale dal centro."""
    r = distance(pos, center)
    for band in BANDS.values():
        if band.inner_m <= r <= band.outer_m and abs(pos.z) <= band.half_height_m:
            return band.number, r
    return None, r
