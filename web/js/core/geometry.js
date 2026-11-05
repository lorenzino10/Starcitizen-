// Geometria dei segmenti 3D. Una tratta QT e' il segmento P(t) = A + t(B-A), t in [0,1].
import { add, dot, norm, norm2, scale, sub } from './vector.js';

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const pointAt = (a, b, t) => add(a, scale(sub(b, a), t));

/**
 * Proiezione vettoriale di P sul segmento AB.
 * t* = ((P-A)·(B-A)) / |B-A|^2, limitato a [0,1]. Segmento degenere -> A.
 * @returns {{t:number, tUnclamped:number, point:object, distance:number}}
 */
export function projectPointOnSegment(a, b, p) {
  const ab = sub(b, a);
  const l2 = norm2(ab);
  if (l2 === 0) return { t: 0, tUnclamped: 0, point: a, distance: norm(sub(p, a)) };
  const tRaw = dot(sub(p, a), ab) / l2;
  const t = clamp01(tRaw);
  const c = add(a, scale(ab, t));
  return { t, tUnclamped: tRaw, point: c, distance: norm(sub(p, c)) };
}

/**
 * Valori di t in [0,1] in cui il segmento AB attraversa la sfera |X-C| = r.
 * (d·d)t^2 + 2(d·f)t + (f·f - r^2) = 0, d = B-A, f = A-C; radici in forma stabile.
 */
export function segmentSphereRoots(a, b, center, r) {
  const d = sub(b, a);
  const f = sub(a, center);
  const qa = norm2(d);
  if (qa === 0) return [];
  const qb = 2 * dot(d, f);
  const qc = norm2(f) - r * r;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  let roots;
  if (sq === 0) roots = [-qb / (2 * qa)];
  else {
    const q = -0.5 * (qb + (qb >= 0 ? sq : -sq));
    roots = [...new Set([q / qa, qc / q])].sort((x, y) => x - y);
  }
  return roots.filter((t) => t >= 0 && t <= 1);
}

export const segmentHitsSphere = (a, b, c, r) => projectPointOnSegment(a, b, c).distance < r;
