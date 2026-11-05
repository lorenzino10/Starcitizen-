// Aaron Halo (Stanton): fasce e attraversamenti delle tratte QT.
// Fonte: CaptSheppard / Cornerstone (cstone.space), survey 3.16.1-LIVE, invariata fino a 4.x.
// Distanze dal centro della griglia di Stanton (origine dei dati), NON dal contenitore stella.
// Modello: gusci sferici centrati sull'origine limitati in |z| (differenza dal cilindro < 1 km).
import { pointAt, segmentSphereRoots } from './geometry.js';
import { ORIGIN, distance } from './vector.js';

export const HALO_SOURCE = 'CaptSheppard / Cornerstone (cstone.space), survey 3.16.1-LIVE';

const RAW = [ // banda, interno, esterno, picco densita', semi-altezza (km)
  [1, 19673000, 19715000, 19702000, 625],
  [2, 19815000, 19914000, 19857000, 2070],
  [3, 19914000, 20071000, 19995000, 4046],
  [4, 20129000, 20230000, 20168000, 2912],
  [5, 20230000, 20407000, 20320000, 4998],
  [6, 20407000, 20540000, 20471000, 5000],
  [7, 20540000, 20750000, 20662000, 4998],
  [8, 20793000, 20968000, 20881000, 3487],
  [9, 21046000, 21132000, 21082000, 2400],
  [10, 21159000, 21299000, 21207000, 2008],
];
export const BANDS = Object.fromEntries(RAW.map(([n, i, o, p, h]) =>
  [n, { number: n, inner: i * 1e3, outer: o * 1e3, peak: p * 1e3, halfHeight: h * 1e3 }]));

/**
 * Intervalli del segmento A->B dentro il guscio della fascia, nel verso di marcia.
 * Distanze HUD = |B - P(t)| = (1-t)|B-A|.
 */
export function bandCrossings(a, b, band, center = ORIGIN) {
  const leg = distance(a, b);
  const ts = new Set([0, 1]);
  for (const r of [band.inner, band.outer]) segmentSphereRoots(a, b, center, r).forEach((t) => ts.add(t));
  const sorted = [...ts].sort((x, y) => x - y);
  const intervals = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [t0, t1] = [sorted[i], sorted[i + 1]];
    if (t1 - t0 <= 0) continue;
    const mid = distance(pointAt(a, b, (t0 + t1) / 2), center);
    if (mid >= band.inner && mid <= band.outer) {
      const last = intervals[intervals.length - 1];
      if (last && Math.abs(last[1] - t0) < 1e-12) last[1] = t1;
      else intervals.push([t0, t1]);
    }
  }
  return intervals.map(([t0, t1]) => {
    const peaks = segmentSphereRoots(a, b, center, band.peak).filter((t) => t >= t0 && t <= t1);
    const tp = peaks.length ? peaks[0] : null;
    const p0 = pointAt(a, b, t0), p1 = pointAt(a, b, t1);
    return {
      band: band.number, tEnter: t0, tExit: t1, tPeak: tp,
      enterHud: (1 - t0) * leg, exitHud: (1 - t1) * leg,
      peakHud: tp === null ? null : (1 - tp) * leg,
      window: (t1 - t0) * leg, zEnter: p0.z, zExit: p1.z,
      // z e' lineare lungo il segmento: il massimo di |z| e' a un estremo dell'intervallo
      withinHeight: Math.abs(p0.z) <= band.halfHeight && Math.abs(p1.z) <= band.halfHeight,
    };
  });
}

/** Fascia in cui si trova pos (null se fuori) e distanza radiale dal centro. */
export function locate(pos, center = ORIGIN) {
  const r = distance(pos, center);
  for (const b of Object.values(BANDS)) {
    if (r >= b.inner && r <= b.outer && Math.abs(pos.z) <= b.halfHeight) return { band: b.number, r };
  }
  return { band: null, r };
}
