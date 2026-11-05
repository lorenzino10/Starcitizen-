// Test del motore con coordinate sintetiche e risultati esatti, piu' il caso reale Aaron Halo.
// Esecuzione: node --test web/tests/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { projectPointOnSegment, segmentHitsSphere, segmentSphereRoots } from '../js/core/geometry.js';
import { BANDS, bandCrossings, locate } from '../js/core/halo.js';
import { STATUS, checkObstructions, evaluateLeg, rankCandidates } from '../js/core/qt.js';
import { fmtKm, hudReading, hudResolution } from '../js/core/units.js';
import { add, distance, fromArray, vec } from '../js/core/vector.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const GM = 1e9;

// ---- geometria -----------------------------------------------------------------
test('distanza 3-4-12 = 13', () => assert.equal(distance(vec(1, 1, 1), vec(4, 5, 13)), 13));

test('proiezione dentro il segmento', () => {
  const p = projectPointOnSegment(vec(0, 0, 0), vec(10, 0, 0), vec(3, 4, 0));
  close(p.t, 0.3); assert.deepEqual(p.point, vec(3, 0, 0)); close(p.distance, 4);
});

test('proiezione limitata prima di A e oltre B', () => {
  const before = projectPointOnSegment(vec(0, 0, 0), vec(10, 0, 0), vec(-5, 3, 0));
  assert.equal(before.t, 0); close(before.tUnclamped, -0.5); close(before.distance, Math.sqrt(34));
  const after = projectPointOnSegment(vec(0, 0, 0), vec(10, 0, 0), vec(13, 4, 0));
  assert.equal(after.t, 1); close(after.tUnclamped, 1.3); close(after.distance, 5);
});

test('proiezione obliqua 3D', () => {
  const a = vec(1, 2, 3), b = add(a, vec(4, 4, 2));
  const p = add(add(a, vec(3, 3, 1.5)), vec(2, -2, 0));
  const r = projectPointOnSegment(a, b, p);
  close(r.t, 0.75); close(r.point.x, 4); close(r.point.y, 5); close(r.point.z, 4.5); close(r.distance, 2 * Math.SQRT2);
});

test('segmento degenere e grandi coordinate', () => {
  close(projectPointOnSegment(vec(1, 1, 1), vec(1, 1, 1), vec(4, 5, 1)).distance, 5);
  const p = projectPointOnSegment(vec(0, 0, 0), vec(10 * GM, 0, 0), vec(3 * GM, 4 * GM, 0));
  assert.ok(Math.abs(p.distance - 4 * GM) < 1e-3);
});

test('radici segmento-sfera', () => {
  const r = segmentSphereRoots(vec(-10, 0, 0), vec(10, 0, 0), vec(0, 0, 0), 5);
  close(r[0], 0.25); close(r[1], 0.75);
  const tan = segmentSphereRoots(vec(-10, 5, 0), vec(10, 5, 0), vec(0, 0, 0), 5);
  assert.equal(tan.length, 1); close(tan[0], 0.5);
  assert.deepEqual(segmentSphereRoots(vec(-10, 6, 0), vec(10, 6, 0), vec(0, 0, 0), 5), []);
  assert.deepEqual(segmentSphereRoots(vec(10, 0, 0), vec(20, 0, 0), vec(0, 0, 0), 5), []);
  assert.ok(segmentHitsSphere(vec(-10, 1, 0), vec(10, 1, 0), vec(0, 0, 0), 2));
  assert.ok(!segmentHitsSphere(vec(-10, 3, 0), vec(10, 3, 0), vec(0, 0, 0), 2));
});

// ---- tratte QT -------------------------------------------------------------------
const S = { key: 's', name: 'S', pos: vec(0, 0, 0), qtValid: true };
const D = { key: 'd', name: 'D', pos: vec(100, 0, 0), qtValid: true };
const OPEN = { bodies: [], margin: 1.2, complete: true };

test('punto di interruzione e distanza HUD (triangolo 6-8-10)', () => {
  const r = evaluateLeg(S, D, vec(6, 8, 0), OPEN);
  close(r.t, 0.06); close(r.qtTravel, 6); close(r.hudRemaining, 94); close(r.residual, 8);
  close(r.direct, 10); close(r.gain, 2); assert.ok(r.needsDrop); assert.equal(r.status, STATUS.DATA);
});

test('bersaglio oltre la destinazione: nessuna interruzione', () => {
  const r = evaluateLeg(S, D, vec(130, 40, 0), OPEN);
  assert.equal(r.t, 1); assert.equal(r.hudRemaining, 0); close(r.residual, 50); assert.ok(!r.needsDrop);
});

test('HUD + distanza percorsa = lunghezza tratta', () => {
  const r = evaluateLeg(S, { key: 'd2', name: 'D2', pos: vec(30, 40, 120), qtValid: true }, vec(10, 30, 50), OPEN);
  close(r.qtTravel + r.hudRemaining, r.legLength); close(r.legLength, 130);
});

test('ordinamento ed esclusione delle tratte inutili', () => {
  const near = { key: 'near', name: 'near', pos: vec(100, 0, 0), qtValid: true };
  const better = { key: 'better', name: 'better', pos: vec(100, 20, 0), qtValid: true };
  const behind = { key: 'behind', name: 'behind', pos: vec(-100, 0, 0), qtValid: true };
  const res = rankCandidates(S, vec(50, 10, 0), [near, better, behind], OPEN);
  assert.deepEqual(res.map((r) => r.dest.key), ['better', 'near']);
  close(res[0].residual, 0); close(res[1].residual, 10);
});

test('ostacoli: blocco, margine, estremo in superficie', () => {
  const planet = { name: 'P', center: vec(50, 0, 0), radius: 5 };
  const m1 = { bodies: [planet], margin: 1, complete: true };
  close(checkObstructions(S.pos, D.pos, m1)[0].clearance, -5);
  assert.equal(rankCandidates(S, vec(60, 8, 0), [D], m1).length, 0);
  assert.ok(rankCandidates(S, vec(60, 8, 0), [D], m1, new Set(), true)[0].blocked);
  const near = { name: 'P', center: vec(50, 5.5, 0), radius: 5 };
  assert.equal(checkObstructions(S.pos, D.pos, { bodies: [near], margin: 1, complete: true }).length, 0);
  assert.equal(checkObstructions(S.pos, D.pos, { bodies: [near], margin: 1.2, complete: true }).length, 1);
  const globe = { bodies: [{ name: 'G', center: vec(0, 0, 0), radius: 10 }], margin: 1.2, complete: true };
  assert.equal(checkObstructions(vec(10, 0, 0), vec(100, 0, 0), globe).length, 0);
  assert.equal(checkObstructions(vec(10, 0, 0), vec(-100, 0, 0), globe).length, 1);
});

test('classificazione', () => {
  const free = { ...S, key: 'free', qtValid: false };
  assert.equal(evaluateLeg(free, D, vec(50, 1, 0), OPEN).status, STATUS.THEORETICAL);
  assert.equal(evaluateLeg(S, D, vec(50, 1, 0), { bodies: [], margin: 1, complete: false }).status, STATUS.THEORETICAL);
  const unc = { bodies: [{ name: 'star?', center: vec(50, 0, 0), radius: 5, uncertain: true }], margin: 1, complete: true };
  const r = evaluateLeg(S, D, vec(50, 1, 0), unc);
  assert.equal(r.status, STATUS.THEORETICAL); assert.ok(!r.blocked);
  assert.equal(evaluateLeg(S, D, vec(50, 1, 0), OPEN, true).status, STATUS.VERIFIED);
});

// ---- Aaron Halo ----------------------------------------------------------------
test('attraversamento radiale: valori esatti', () => {
  const [c] = bandCrossings(vec(25 * GM, 0, 0), vec(15 * GM, 0, 0), BANDS[5]);
  close(c.enterHud, 20407000000 - 15 * GM); close(c.peakHud, 20320000000 - 15 * GM);
  close(c.exitHud, 20230000000 - 15 * GM); close(c.window, 177000000); assert.ok(c.withinHeight);
});

test('corda che attraversa due volte, fuori quota, interna', () => {
  const y = 20.3 * GM * 0.99;
  const cs = bandCrossings(vec(-30 * GM, y, 0), vec(30 * GM, y, 0), BANDS[5]);
  assert.equal(cs.length, 2); close(cs[0].window, cs[1].window);
  assert.ok(bandCrossings(vec(25 * GM, 0, 1e9), vec(15 * GM, 0, 1e9), BANDS[5]).every((c) => !c.withinHeight));
  assert.deepEqual(bandCrossings(vec(GM, 0, 0), vec(2 * GM, 0, 0), BANDS[5]), []);
});

test('locate', () => {
  assert.equal(locate(vec(20320000000, 0, 0)).band, 5);
  assert.equal(locate(vec(20320000000, 0, 10000000)).band, null);
  assert.equal(locate(vec(20100000000, 0, 0)).band, null);
});

const FX = JSON.parse(readFileSync(new URL('../../tests/fixtures/stanton_arc_l1_cru_l4.json', import.meta.url), 'utf8'));
const ARC = fromArray(FX.points['ARC-L1'].xyz_m), CRU = fromArray(FX.points['CRU-L4'].xyz_m);

test('ARC-L1 -> CRU-L4 fascia 5 contro i valori pubblicati', () => {
  const ref = FX.published;
  const leg = distance(ARC, CRU);
  const [c] = bandCrossings(ARC, CRU, BANDS[5]);
  assert.ok(Math.abs(leg - ref.cornerstone_route_km * 1e3) < 5e6);
  assert.ok(Math.abs(c.peakHud - ref.cornerstone_band5_peak_km * 1e3) < 5e6, `picco ${c.peakHud}`);
  assert.equal(Math.round(c.peakHud / GM * 10) / 10, ref.scminer_band5_gm);
  assert.ok(c.withinHeight);
  assert.ok(c.exitHud <= ref.scminer_band5_gm * GM && ref.scminer_band5_gm * GM <= c.enterHud);
});

test('identita: picco andata + picco ritorno = lunghezza tratta', () => {
  const [fw] = bandCrossings(ARC, CRU, BANDS[5]);
  const [bw] = bandCrossings(CRU, ARC, BANDS[5]);
  close(fw.peakHud + bw.peakHud, distance(ARC, CRU), 1e-12);
});

// ---- unita' -----------------------------------------------------------------
test('formattazione', () => {
  assert.equal(fmtKm(14290791503.35), '14.290.792 km');
  assert.equal(hudReading(14290791503.35, 1), '14.3 Gm');
  assert.equal(hudResolution(14290791503.35, 1), 1e8);
});
