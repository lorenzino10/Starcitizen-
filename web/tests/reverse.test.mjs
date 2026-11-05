// RICERCA INVERSA QT: test sintetici con risultati esatti.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATUS } from '../js/core/qt.js';
import { completePath, reverseSearch, targetWarnings } from '../js/core/reverse.js';
import { vec } from '../js/core/vector.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPEN = { bodies: [], margin: 1.2, complete: true };
const qp = (key, x, y, z) => ({ key, name: key, pos: vec(x, y, z), qtValid: true });

test('TEST OBBLIGATORIO: A(0,0,0) B(1.000.000,0,0) P(400.000,30.000,0)', () => {
  const A = qp('A', 0, 0, 0), B = qp('B', 1_000_000, 0, 0);
  const { routes } = reverseSearch([A, B], vec(400_000, 30_000, 0), OPEN);
  assert.equal(routes.length, 2);                        // A->B e B->A separate
  const ab = routes.find((r) => r.from.key === 'A');
  assert.deepEqual(ab.dropPoint, vec(400_000, 0, 0));      // C = (400.000, 0, 0)
  close(ab.hudRemaining, 600_000);                         // 600 km sull'HUD verso B
  close(ab.residual, 30_000);                              // 30 km da P
  close(ab.fromStart, 400_000);                            // 400 km da A al punto C
  close(ab.legLength, 1_000_000);
  assert.equal(ab.status, STATUS.DATA);
  const ba = routes.find((r) => r.from.key === 'B');
  assert.deepEqual(ba.dropPoint, vec(400_000, 0, 0));
  close(ba.hudRemaining, 400_000);                         // verso opposto: 400 km verso A
  close(ba.residual, 30_000);
  // a parita' di residuo viene prima la direzione con meno QT prima del drop (A->B: 400 km)
  assert.equal(routes[0].from.key, 'A');
});

test('ordinamento dalla tratta piu vicina alla piu lontana', () => {
  const pts = [qp('A', 0, 0, 0), qp('B', 1e6, 0, 0), qp('C', 0, 1e6, 0), qp('D', 1e6, 1e6, 0)];
  const P = vec(500_000, 100_000, 0);
  const { routes } = reverseSearch(pts, P, OPEN);
  for (let i = 1; i < routes.length; i++) assert.ok(routes[i - 1].residual <= routes[i].residual);
  close(routes[0].residual, 100_000);                      // A-B passa a 100 km
  assert.deepEqual(new Set(routes.slice(0, 2).map((r) => r.from.key)), new Set(['A', 'B']));
  // ogni rotta: HUD + percorso da A = lunghezza tratta
  for (const r of routes) close(r.fromStart + r.hudRemaining, r.legLength);
});

test('estremi esclusi: se il punto piu vicino e marker, non e una interruzione', () => {
  const { routes, nearestMarker, endpointOnly } = reverseSearch([qp('A', 0, 0, 0), qp('B', 1e6, 0, 0)], vec(-50_000, 10, 0), OPEN);
  assert.equal(routes.length, 0);
  assert.equal(endpointOnly, 2);
  assert.equal(nearestMarker.point.key, 'A');
});

test('punti non QT ignorati, tratte bloccate escluse o marcate', () => {
  const pts = [qp('A', 0, 0, 0), qp('B', 1e6, 0, 0), { ...qp('X', 0, 5e5, 0), qtValid: false }];
  assert.equal(reverseSearch(pts, vec(5e5, 1e3, 0), OPEN).routes.length, 2);
  const planet = { bodies: [{ name: 'P', center: vec(7e5, 0, 0), radius: 1e4 }], margin: 1, complete: true };
  const r = reverseSearch(pts, vec(5e5, 1e3, 0), planet);
  assert.equal(r.routes.length, 0); assert.equal(r.blocked, 2);
  assert.ok(reverseSearch(pts, vec(5e5, 1e3, 0), planet, { includeBlocked: true }).routes.every((x) => x.blocked));
});

test('stato: verificata solo se segnata, teorica se mancano i corpi celesti', () => {
  const pts = [qp('A', 0, 0, 0), qp('B', 1e6, 0, 0)];
  const v = reverseSearch(pts, vec(4e5, 3e4, 0), OPEN, { verifiedPairs: new Set(['A|B']) }).routes;
  assert.equal(v.find((r) => r.from.key === 'A').status, STATUS.VERIFIED);
  assert.equal(v.find((r) => r.from.key === 'B').status, STATUS.DATA);   // il verso opposto non e' provato
  const t = reverseSearch(pts, vec(4e5, 3e4, 0), { bodies: [], margin: 1, complete: false }).routes;
  assert.ok(t.every((r) => r.status === STATUS.THEORETICAL));
});

test('avvisi: dentro un pianeta, fuori regione, dati incompleti', () => {
  const pts = [qp('A', 0, 0, 0), qp('B', 1e9, 0, 0)];
  const m = { bodies: [{ name: 'Hurston', center: vec(5e8, 0, 0), radius: 1e6 }], margin: 1.2, complete: true };
  assert.equal(targetWarnings(vec(5e8, 1e5, 0), pts, m)[0].level, 'err');
  assert.match(targetWarnings(vec(5e10, 0, 0), pts, m)[0].text, /oltre la regione/);
  assert.deepEqual(targetWarnings(vec(3e8, 1e7, 0), pts, m), []);
  assert.ok(targetWarnings(vec(3e8, 0, 0), pts, { bodies: [], margin: 1, complete: false }).some((w) => /mancano/.test(w.text)));
});

test('percorso completo dalla posizione attuale', () => {
  // due rotte con lo stesso residuo: A->B (A lontano da S) e B->A (B vicino a S)
  const A = qp('A', 0, 0, 0), B = qp('B', 1e6, 0, 0);
  const S = { key: null, name: 'Io', pos: vec(1.1e6, 0, 0) };
  const { routes } = reverseSearch([A, B], vec(4e5, 3e4, 0), OPEN);
  const path = completePath(S, routes, OPEN);
  assert.equal(path[0].from.key, 'B');          // S->B 100 km + B->C 600 km = 700 km
  close(path[0].qtTotal, 700_000);
  close(path[1].qtTotal, 1_100_000 + 400_000); // S->A 1.100 km + A->C 400 km
  // con le velocita' ordina per tempo
  const timed = completePath(S, routes, OPEN, { qtSpeed: 1e5, convSpeed: 1e3 });
  close(timed[0].time, 700_000 / 1e5 + 30_000 / 1e3);
  // soglia sul residuo
  assert.equal(completePath(S, routes, OPEN, { maxResidual: 10_000 }).length, 0);
});

test('marker in superficie di un corpo rotante: tratta teorica', () => {
  const m = { bodies: [{ name: 'Daymar', center: vec(0, 0, 0), radius: 295_000 }], margin: 1.2, complete: true };
  const out = qp('Outpost', 296_000, 0, 0), st = qp('Station', 5e6, 0, 0);
  const { routes } = reverseSearch([out, st], vec(2e6, 1e4, 0), m);
  assert.ok(routes.length === 2 && routes.every((r) => r.status === STATUS.THEORETICAL));
  assert.ok(routes[0].notes.some((n) => /ruota/.test(n)));
});
