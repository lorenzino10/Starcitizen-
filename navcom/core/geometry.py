"""Geometria dei segmenti 3D: proiezioni, distanze minime, intersezioni con sfere.

Una tratta quantica (QT) e' modellata come il segmento A->B fra il punto di
partenza A e il marker di destinazione B: P(t) = A + t*(B-A), t in [0,1].
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .vector import Vec3


@dataclass(frozen=True, slots=True)
class Projection:
    t: float            # parametro sul segmento, limitato a [0,1]
    t_unclamped: float  # parametro sulla retta infinita (diagnostica)
    point: Vec3         # punto del segmento piu' vicino al bersaglio
    distance: float     # distanza minima segmento-bersaglio (m)


def clamp01(t: float) -> float:
    return 0.0 if t < 0.0 else 1.0 if t > 1.0 else t


def project_point_on_segment(a: Vec3, b: Vec3, p: Vec3) -> Projection:
    """Proiezione vettoriale di P sul segmento AB.

    t* = ((P-A)·(B-A)) / |B-A|^2, poi limitato a [0,1]: se la proiezione cade
    prima di A il punto piu' vicino e' A, se cade oltre B e' B. Un segmento
    degenere (A == B) restituisce A.
    """
    ab = b - a
    l2 = ab.norm2()
    if l2 == 0.0:
        return Projection(0.0, 0.0, a, (p - a).norm())
    t_raw = (p - a).dot(ab) / l2
    t = clamp01(t_raw)
    c = a + ab * t
    return Projection(t, t_raw, c, (p - c).norm())


def point_at(a: Vec3, b: Vec3, t: float) -> Vec3:
    return a + (b - a) * t


def segment_sphere_roots(a: Vec3, b: Vec3, center: Vec3, radius: float) -> list[float]:
    """Valori di t in [0,1] in cui il segmento AB attraversa la sfera |X-C| = r.

    Risolve |A + t·d - C|^2 = r^2  ->  (d·d) t^2 + 2 (d·f) t + (f·f - r^2) = 0
    con d = B-A e f = A-C. Usa la forma numericamente stabile delle radici.
    """
    d = b - a
    f = a - center
    qa = d.norm2()
    if qa == 0.0:
        return []
    qb = 2.0 * d.dot(f)
    qc = f.norm2() - radius * radius
    disc = qb * qb - 4.0 * qa * qc
    if disc < 0.0:
        return []
    sq = math.sqrt(disc)
    if sq == 0.0:
        roots = [-qb / (2.0 * qa)]
    else:
        q = -0.5 * (qb + math.copysign(sq, qb))
        roots = sorted({q / qa, qc / q if q != 0.0 else -qb / (2.0 * qa)})
    return [t for t in roots if 0.0 <= t <= 1.0]


def segment_hits_sphere(a: Vec3, b: Vec3, center: Vec3, radius: float) -> bool:
    """True se il segmento passa a distanza < radius dal centro."""
    return project_point_on_segment(a, b, center).distance < radius
