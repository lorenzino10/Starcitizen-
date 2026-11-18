// Test del piano di carico Hercules (web/hercules/engine.js). Dati delle casse e delle griglie
// dai file di gioco 4.10.3; i carichi qui sotto sono SINTETICI, inventati per il test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLoad, buildHold, SHIPS, BOXES, exitPath } from '../hercules/engine.js';

const I = (h, x, y, z) => (z * h.L + y) * h.W + x;

/** Ricostruisce l'occupazione e controlla sovrapposizioni, confini griglia, appoggio, taglia massima. */
function checkGeometry(p) {
  const h = p.hold, occ = new Int32Array(h.W * h.L * h.H);
  for (const b of p.boxes) {
    const g = h.grids[b.grid];
    assert.ok(b.x >= g.x0 && b.x + b.w <= g.x0 + g.w, `cassa ${b.id} fuori griglia in larghezza`);
    assert.ok(b.y >= g.y0 && b.y + b.l <= g.y0 + g.l, `cassa ${b.id} fuori griglia in lunghezza`);
    assert.ok(b.z >= 0 && b.z + b.h <= g.h, `cassa ${b.id} fuori griglia in altezza`);
    assert.ok(b.w <= g.maxc[0] && b.l <= g.maxc[1] && b.h <= g.maxc[2], `cassa ${b.id} oltre la taglia massima della griglia`);
    const dims = [...BOXES[b.size]].sort();
    assert.deepEqual([b.w, b.l, b.h].sort(), dims);
    assert.equal(b.h, BOXES[b.size][2], 'le casse non si ribaltano');
    for (let z = b.z; z < b.z + b.h; z++) for (let y = b.y; y < b.y + b.l; y++) for (let x = b.x; x < b.x + b.w; x++) {
      assert.equal(occ[I(h, x, y, z)], 0, `sovrapposizione in ${x},${y},${z}`);
      occ[I(h, x, y, z)] = b.id + 1;
    }
  }
  for (const b of p.boxes) if (b.z > 0) for (let y = b.y; y < b.y + b.l; y++) for (let x = b.x; x < b.x + b.w; x++) assert.notEqual(occ[I(h, x, y, b.z - 1)], 0, `cassa ${b.id} non appoggiata`);
}

/** L'ordine di carico deve essere eseguibile: ogni cassa entra con un percorso libero dalla rampa. */
function checkLoadOrder(p) {
  const h = p.hold, st = { hold: h, occ: new Int32Array(h.W * h.L * h.H), boxes: p.boxes };
  assert.equal(new Set(p.load).size, p.boxes.length);
  for (const id of p.load) {
    const b = p.boxes[id];
    assert.ok(exitPath(st, b, () => false, true), `cassa ${id} non caricabile in quell'ordine`);
    for (let z = b.z; z < b.z + b.h; z++) for (let y = b.y; y < b.y + b.l; y++) for (let x = b.x; x < b.x + b.w; x++) st.occ[I(h, x, y, z)] = id + 1;
  }
}

test('griglie C2 dai file di gioco: 480 + 216 = 696 SCU', () => {
  const h = buildHold(SHIPS.c2);
  assert.equal(h.capacity, 696);
  assert.deepEqual(h.grids.map((g) => [g.w, g.l, g.h]), [[8, 15, 4], [6, 9, 4]]);
  assert.equal(buildHold(SHIPS.m2).capacity, 522);
  assert.equal(buildHold(SHIPS.a2).capacity, 216);
});

test('C2 piena di casse da 32 SCU: 20 casse (14 di traverso nella grande, 6 per lungo nella piccola)', () => {
  const p = planLoad('c2', [{ name: 'X', boxes: { 32: 25 } }]);
  assert.equal(p.boxes.length, 20);
  assert.equal(p.totals.unplaced, 5);
  checkGeometry(p);
  for (const b of p.boxes) if (p.hold.grids[b.grid].id === 'piccola') assert.equal(b.l, 8, 'nella piccola la 32 SCU sta solo per lungo (max 7,5 m di larghezza)');
});

test('tre tappe: la prima consegna vicino alla rampa, l\'ultima in fondo, zero spostamenti', () => {
  const stops = [
    { name: 'Prima', boxes: { 32: 4, 16: 4, 8: 4, 4: 4, 2: 4, 1: 4 } },
    { name: 'Seconda', boxes: { 32: 4, 24: 2, 8: 4 } },
    { name: 'Terza', boxes: { 32: 5, 16: 2, 1: 6 } },
  ];
  const p = planLoad('c2', stops);
  checkGeometry(p);
  checkLoadOrder(p);
  assert.equal(p.totals.unplaced, 0);
  assert.equal(p.totals.extraMoves, 0);
  const d = p.perStop.map((s) => s.avgDistM);
  assert.ok(d[0] < d[1] && d[1] < d[2], `distanze medie dalla rampa ${d}`);
  for (const s of p.perStop) assert.equal(s.unload.length, s.boxes);
});

test('stiva piena di casse da 1 SCU su due tappe: tutto dentro, nessuno spostamento', () => {
  const p = planLoad('c2', [{ name: 'A', boxes: { 1: 300 } }, { name: 'B', boxes: { 1: 396 } }]);
  assert.equal(p.totals.placedScu, 696);
  assert.equal(p.totals.extraMoves, 0);
  checkGeometry(p);
  checkLoadOrder(p);
});

test('carico quasi pieno e misto: geometria valida, ordine di carico eseguibile, spostamenti dichiarati', () => {
  const p = planLoad('c2', [{ name: 'A', boxes: { 32: 5, 1: 50 } }, { name: 'B', boxes: { 24: 5, 4: 20 } }, { name: 'C', boxes: { 16: 10, 8: 10, 2: 20 } }]);
  checkGeometry(p);
  checkLoadOrder(p);
  assert.equal(p.totals.placedScu, 690);
  assert.equal(p.totals.extraMoves, p.perStop.reduce((s, x) => s + x.moves.length, 0));
});

test('oltre capacità: le casse in più sono dichiarate, non inventate', () => {
  const p = planLoad('c2', [{ name: 'A', boxes: { 32: 30 } }]);
  assert.equal(p.totals.requestedScu, 960);
  assert.ok(p.totals.placedScu <= 696);
  assert.equal(p.boxes.length + p.unplaced.length, 30);
});

test('M2 e A2: limiti di altezza e larghezza rispettati', () => {
  const m = planLoad('m2', [{ name: 'A', boxes: { 8: 20, 1: 40 } }, { name: 'B', boxes: { 32: 6 } }]);
  checkGeometry(m); checkLoadOrder(m);
  const a = planLoad('a2', [{ name: 'A', boxes: { 32: 3, 4: 10 } }, { name: 'B', boxes: { 24: 2 } }]);
  checkGeometry(a); checkLoadOrder(a);
  for (const b of a.boxes) if (b.size === 32) assert.equal(b.l, 8);
});

test('griglie invertite (piccola verso la rampa): piano comunque valido', () => {
  const p = planLoad('c2', [{ name: 'A', boxes: { 16: 6 } }, { name: 'B', boxes: { 32: 6, 8: 8 } }], { order: 'piccola-rampa' });
  checkGeometry(p); checkLoadOrder(p);
  assert.equal(p.hold.grids[0].id, 'piccola');
});
