// Test MATEMATICI e funzionali del pianificatore (Fasi 4-5): coordinate sintetiche con
// risultato noto esattamente. I controlli che richiedono il gioco sono in collaudo.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec, distance } from '../js/core/vector.js';
import { DEFAULT_HUD, hudText, hudUnit, planDrop, transitionInterval } from '../js/core/hud.js';
import { accelPhase, convTime, dropState, jumpTime } from '../js/core/qtdrive.js';
import { dijkstraDense, pathTo, systemsPath } from '../js/core/navgraph.js';
import { buildContext, inFlightCorrection, planInSystem, planRoutes } from '../js/core/plan.js';
import { gatewayLinks } from '../js/core/systems.js';
import { coordinateChecks, parseShowLocation, pilotInstructions } from '../js/core/instructions.js';
import { STATUS } from '../js/core/qt.js';
import { obstructionModel } from '../js/data/bodies.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const KM = 1000, GM = 1e9;
const OPEN = { bodies: [], margin: 1.2, complete: true, missing: [] };
const pts = (list) => list.map(([name, x, y, z]) => ({ key: name, name, pos: vec(x, y, z), qtValid: true }));

// ------------------------------------------------------------------ HUD e incertezza
test('HUD: unità e passo dell\'ultima cifra', () => {
  assert.equal(hudUnit(13.9 * GM).unit, 'Gm');
  close(hudUnit(13.9 * GM).step, 0.1 * GM);
  assert.equal(hudUnit(500e6).unit, 'Mm');
  close(hudUnit(500e6).step, 0.1e6);
  assert.equal(hudUnit(5e5).unit, 'km');
  assert.equal(hudText(13921999 * KM), '13,9 Gm');
});

test('HUD: istante del cambio di lettura per ogni regola di arrotondamento', () => {
  const r = 0.1 * GM;
  assert.deepEqual(transitionInterval(139, r, 'floor').map((x) => x / GM), [14, 14]);
  assert.deepEqual(transitionInterval(139, r, 'ceil').map((x) => Math.round(x / 1e6)), [13900, 13900]);
  close(transitionInterval(139, r, 'round')[0], 13.95 * GM);
  const u = transitionInterval(139, r, 'unknown');
  close(u[1] - u[0], r); // regola sconosciuta: incertezza di un passo intero
});

test('Incertezza: residuo = ipotenusa fra distanza perpendicolare e scarto lungo la tratta', () => {
  // tratta lunga 10 km, uscita ideale a 5 km dalla destinazione, P a 3 m dalla tratta, passo HUD 1 km
  const hud = { units: [{ unit: 'km', min: 0, dec: 0 }], rounding: 'floor' };
  const d = planDrop({ h0: 4000, res0: 3, legLength: 10000, hud });
  // con troncamento il cambio "da 4 a 3 km" avviene esattamente a 4 km -> nessuno scarto
  assert.equal(`${d.fromText}→${d.toText}`, '4 km→3 km');
  close(d.worst, Math.hypot(3, 0));
  const d2 = planDrop({ h0: 4500, res0: 3, legLength: 10000, hud });
  close(d2.worst, Math.hypot(3, 500));
});

test('Caso ARC-L1 → CRU-L4: 13.921.999 km si legge "13,9 Gm" e l\'incertezza è di decine di migliaia di km', () => {
  const d = planDrop({ h0: 13921999 * KM, res0: 1201 * KM, legLength: 24003285 * KM, hud: DEFAULT_HUD });
  assert.equal(d.idealText, '13,9 Gm');
  assert.equal(`${d.fromText}→${d.toText}`, '14,0 Gm→13,9 Gm');
  close(d.roundingInterval[0], 13.9 * GM); close(d.roundingInterval[1], 14.0 * GM);
  close(d.worst, Math.hypot(1201 * KM, 78001 * KM), 1e-9);
  assert.equal(d.reaction, null); // tempo di reazione non indicato -> non determinabile
});

test('Tempo di reazione: sposta l\'uscita verso la destinazione di v·τ e il cambio scelto lo compensa', () => {
  const hud = { units: [{ unit: 'km', min: 0, dec: 0 }], rounding: 'floor' };
  const d = planDrop({ h0: 5000, res0: 0, legLength: 20000, hud, speed: 1000, reaction: { min: 2, max: 2 } });
  // senza reazione si sceglierebbe il cambio a 5 km; con 2 s a 1 km/s si esce 2 km dopo:
  // NAVCOM sceglie il cambio a 7 km ("da 7 a 6 km") e l'uscita reale cade esattamente a 5 km
  assert.equal(d.fromText, '7 km');
  assert.deepEqual(d.reaction.interval, [5000, 5000]);
  close(d.worst, 0);
});

// ------------------------------------------------------------------ tempi
test('Drive QT: modello a due stadi (fasi, durata, velocità all\'uscita)', () => {
  const p = { vmax: 1e8, ve: 1e7, a1: 1e6, a2: 3e6 };
  const ph = accelPhase(p);
  close(ph.T1, 10); close(ph.T2, 45); close(ph.D, 2.1875e9);
  close(jumpTime(2 * ph.D, p), 2 * ph.T, 1e-9);
  close(jumpTime(2 * ph.D + 1e9, p), 2 * ph.T + 10, 1e-9);
  const L = 1e10;
  close(dropState(ph.D, L, p).speed, 1e8, 1e-6);
  assert.equal(dropState(5e9, L, p).phase, 'crociera');
  close(dropState(L, L, p).time, jumpTime(L, p), 1e-6);
  const inst = jumpTime(1e9, { vmax: 1e8 });
  close(inst, 10);
  assert.equal(dropState(5e8, 1e9, { vmax: 1e8 }).lowerBound, true);
  assert.equal(jumpTime(1e9, null), null);
});

test('Volo convenzionale: profilo trapezoidale e triangolare', () => {
  close(convTime(10000, 100, 10).time, 10000 / 100 + 100 / 10); // raggiunge la velocità massima
  close(convTime(250, 100, 10).time, 2 * Math.sqrt(25));         // non la raggiunge
  assert.equal(convTime(1000, 100).lowerBound, true);
  assert.equal(convTime(1000, 0), null);
});

// ------------------------------------------------------------------ grafo
test('Dijkstra su grafo denso con archi direzionali e un arco bloccato', () => {
  // 0->2 bloccato, 0->1->2 ammesso; 2->0 ammesso solo in quel verso
  const W = [[0, 1, Infinity], [Infinity, 0, 1], [5, Infinity, 0]];
  const { dist, prev } = dijkstraDense(3, 0, (u, v) => W[u][v]);
  assert.deepEqual([...dist], [0, 1, 2]);
  assert.deepEqual(pathTo(prev, 0, 2), [0, 1, 2]);
  const back = dijkstraDense(3, 2, (u, v) => W[u][v]);
  assert.equal(back.dist[0], 5);
});

test('Percorso fra sistemi: collegamenti logici, nessuna distanza euclidea', () => {
  const links = [{ from: 'stanton', to: 'pyro', usable: true }, { from: 'pyro', to: 'nyx', usable: true }, { from: 'nyx', to: 'stanton', usable: false }];
  assert.deepEqual(systemsPath(links, 'stanton', 'nyx').map((l) => l.to), ['pyro', 'nyx']);
  assert.equal(systemsPath(links, 'nyx', 'stanton'), null);
});

// ------------------------------------------------------------------ strategie
test('Una interruzione: caso esatto A=(0,0,0), B=(1.000.000 km,0,0), P=(400.000, 30.000, 0) km', () => {
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), OPEN);
  const r = planInSystem(ctx, vec(4e8, 3e7, 0), null, { mode: 'geometrica', allowTwoStage: false });
  const ab = r.plans.find((p) => p.steps[0].from.name === 'A');
  const ba = r.plans.find((p) => p.steps[0].from.name === 'B');
  const dAB = ab.steps[0];
  assert.deepEqual([dAB.dropPoint.x, dAB.dropPoint.y, dAB.dropPoint.z], [4e8, 0, 0]);
  close(dAB.h0, 6e8); close(dAB.travel, 4e8); close(ab.residual, 3e7);
  close(ba.steps[0].h0, 4e8); // verso opposto: stessa C, lettura HUD diversa
  assert.equal(ab.steps[1].kind, 'conv');
});

test('Punto esterno ai segmenti: nessuna interruzione utile', () => {
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), OPEN);
  const r = planInSystem(ctx, vec(2e9, 1e6, 0), null, { mode: 'geometrica', allowTwoStage: false });
  assert.equal(r.plans.length, 0);
  assert.equal(r.nearest.name, 'B');
});

test('Due interruzioni: punto di uscita intermedio C1 calcolato in forma chiusa', () => {
  // C1 = (4e8,0,0) su A-B; P sta sulla retta C1 -> M al 40% da M
  const M = [4e8, 1e9, 5e8];
  const C1 = [4e8, 0, 0];
  const P = vec(...C1.map((c, i) => c + 0.6 * (M[i] - c)));
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0], ['M', ...M]]), OPEN);
  const r = planInSystem(ctx, P, null, { mode: 'geometrica', limit: 50 });
  const p = r.plans.find((x) => x.type === 'S2' && x.steps[0].from.name === 'A' && x.steps[1].to.name === 'M');
  assert.ok(p, 'piano A->B, C1->M presente');
  close(p.steps[0].dropPoint.x, 4e8, 1e-9); close(p.steps[0].dropPoint.y, 0, 1e-9);
  assert.ok(p.residual < 1e-3);
  close(p.steps[1].h0, distance(P, vec(...M)), 1e-9);
  assert.equal(p.steps[1].from.kind, 'drop');
  assert.ok(p.residualWorst >= p.residualRefined);
});

test('Archi direzionali: una tratta verificata solo in un verso', () => {
  const model = { ...OPEN, complete: false }; // dati incompleti: tutto teorico salvo le verifiche
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), model, { verified: new Set(['A|B']) });
  const op = planInSystem(ctx, vec(4e8, 3e7, 0), null, { mode: 'operativa', allowTwoStage: false });
  assert.equal(op.plans.length, 1);
  assert.equal(op.plans[0].steps[0].from.name, 'A');
  assert.equal(op.plans[0].status, STATUS.VERIFIED);
  const geo = planInSystem(ctx, vec(4e8, 3e7, 0), null, { mode: 'geometrica', allowTwoStage: false });
  assert.equal(geo.plans.find((p) => p.steps[0].from.name === 'B').status, STATUS.THEORETICAL); // mai promossa
});

test('Tratte bloccate e segnate non disponibili: escluse in modalità operativa', () => {
  const body = { bodies: [{ name: 'Pianeta', center: vec(7e8, 0, 0), radius: 1e6, uncertain: false }], margin: 1.2, complete: true, missing: [] };
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), body);
  assert.equal(planInSystem(ctx, vec(4e8, 3e7, 0), null, { mode: 'operativa', allowTwoStage: false }).plans.length, 0);
  const geo = planInSystem(ctx, vec(4e8, 3e7, 0), null, { mode: 'geometrica', allowTwoStage: false, includeBlocked: true });
  assert.ok(geo.plans.length === 2 && geo.plans.every((p) => p.blocked));
  const ctx2 = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), OPEN, { unavailable: new Set(['A|B']) });
  const op = planInSystem(ctx2, vec(4e8, 3e7, 0), null, { mode: 'operativa', allowTwoStage: false });
  assert.deepEqual(op.plans.map((p) => p.steps[0].from.name), ['B']);
});

test('Multi-tratta: con la partenza nota il percorso aggira la tratta bloccata con Dijkstra', () => {
  // S -> A diretto attraversa il pianeta; S -> W -> A e' libero
  const body = { bodies: [{ name: 'Pianeta', center: vec(-5e8, 0, 0), radius: 1e7, uncertain: false }], margin: 1.2, complete: true, missing: [] };
  const ctx = buildContext('t', pts([['S', -1e9, 0, 0], ['W', -5e8, 5e8, 0], ['A', 0, 0, 0], ['B', 1e9, 0, 0]]), body);
  const r = planInSystem(ctx, vec(4e8, 3e7, 0), { key: 'S', name: 'S', pos: vec(-1e9, 0, 0) }, { mode: 'operativa', allowTwoStage: false });
  const p = r.plans.find((x) => x.steps.some((s) => s.kind === 'qt-drop' && s.from.name === 'A' && s.to.name === 'B'));
  assert.deepEqual(p.steps.map((s) => `${s.kind}:${s.from.name ?? ''}>${s.to.name ?? 'P'}`), ['qt:S>W', 'qt:W>A', 'qt-drop:A>B', 'conv:>P']);
  assert.equal(p.departure.name, 'S');
});

test('Selezione della rotta migliore secondo ciascun criterio', () => {
  // A-B passa a 100 km da P ma con lettura HUD in Gm; C-D e' corta, vicina a P, lettura in Mm
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 2e10, 0, 0], ['C', 1.5e10 - 1e8, 3e5, 0], ['D', 1.5e10 + 1e8, 3e5, 0]]), OPEN);
  const P = vec(1.5e10, 1e5, 0);
  const base = { mode: 'geometrica', allowTwoStage: false, drive: { vmax: 1e8 }, conv: { v: 1e4 } };
  const run = (criterion) => planInSystem(ctx, P, null, { ...base, criterion }).plans;
  const name = (p) => p.steps[0].from.name + p.steps[0].to.name;
  const res = run('residuo'), tim = run('tempo'), ope = run('operativo');
  const min = (arr, f) => Math.min(...arr.map(f));
  close(res[0].residual, min(res, (p) => p.residual)); assert.ok(['AB', 'BA'].includes(name(res[0])));
  close(tim[0].time.total, min(tim, (p) => p.time.total)); assert.equal(name(tim[0]), 'CB');
  close(ope[0].residualWorst, min(ope, (p) => p.residualWorst)); assert.equal(name(ope[0]), 'BC');
  // tre criteri, tre risposte diverse: il piu' vicino in teoria non e' il piu' preciso in pratica
  assert.equal(new Set([name(res[0]), name(tim[0]), name(ope[0])]).size, 3);
  assert.ok(res[0].residualWorst > 400 * ope[0].residualWorst);
});

test('Percorso fra sistemi: jump point come arco logico, coordinate mai mescolate', () => {
  const st = buildContext('stanton', pts([['Pyro Gateway', 1e10, 0, 0], ['A', 0, 0, 0], ['B', 1e9, 0, 0]]), OPEN);
  const py = buildContext('pyro', pts([['Stanton Gateway', -3e10, 0, 0], ['Q', -2e10, 1e9, 0]]), OPEN);
  const links = gatewayLinks({ stanton: st.markers, pyro: py.markers });
  assert.equal(links.filter((l) => l.usable).length, 2);
  const r = planRoutes({ contexts: { stanton: st, pyro: py }, links, target: { system: 'stanton', pos: vec(4e8, 3e7, 0) },
    start: { system: 'pyro', key: 'Q', name: 'Q', pos: vec(-2e10, 1e9, 0) }, opts: { mode: 'geometrica', allowTwoStage: false } });
  const p = r.plans[0];
  const jump = p.steps.find((s) => s.kind === 'jump');
  assert.equal(jump.length, 0);
  assert.deepEqual([jump.system, jump.toSystem], ['pyro', 'stanton']);
  const i = p.steps.indexOf(jump);
  assert.ok(p.steps.slice(0, i).every((s) => s.system === 'pyro'));
  assert.ok(p.steps.slice(i + 1).every((s) => s.system === 'stanton'));
  const none = planRoutes({ contexts: { stanton: st }, links: [], target: { system: 'stanton', pos: vec(4e8, 3e7, 0) }, start: { system: 'nyx', pos: vec(0, 0, 0), name: 'x' } });
  assert.match(none.error, /Nessun collegamento/);
});

test('Tempo complessivo: "non determinabile" senza velocità, somma delle fasi con i parametri', () => {
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), OPEN);
  const P = vec(4e8, 3e7, 0);
  const a = planInSystem(ctx, P, null, { mode: 'geometrica', allowTwoStage: false }).plans[0];
  assert.equal(a.time.total, null);
  assert.ok(a.time.missing.includes('velocità QT del drive'));
  const b = planInSystem(ctx, P, null, { mode: 'geometrica', allowTwoStage: false, drive: { vmax: 1e8 }, conv: { v: 1000 }, prep: 5 }).plans
    .find((x) => x.steps[0].from.name === 'A');
  close(b.time.total, 5 + 4e8 / 1e8 + 3e7 / 1000);
});

// ------------------------------------------------------------------ coordinate e unita'
test('Lettura /showlocation e controlli sulle coordinate', () => {
  assert.deepEqual(parseShowLocation('Coordinates: x:12850457093 y:0 z:0'), { x: 12850457093, y: 0, z: 0 });
  assert.deepEqual(parseShowLocation('Coordinates: x:-18930439540.5 y:-2610058765 z:1e3'), { x: -18930439540.5, y: -2610058765, z: 1000 });
  assert.equal(parseShowLocation('niente'), null);
  const model = obstructionModel('stanton', 1.2);
  const points = [{ pos: vec(4e10, 0, 0) }];
  assert.ok(coordinateChecks(vec(12850457093, 0, 0), { model, points }).some((w) => w.level === 'err' && /Hurston/.test(w.text)));
  // metri inseriti come km: 1000 volte troppo lontano
  assert.ok(coordinateChecks(vec(2e13, 0, 0), { points, unitFactor: 1000 }).some((w) => /metri inseriti come chilometri/.test(w.text)));
  assert.ok(coordinateChecks(vec(2e7, 0, 0), { points, unitFactor: 1 }).some((w) => /seleziona "km"/.test(w.text)));
});

test('Modello ostacoli Pyro: posizioni dai dati, raggi per nome, stella incerta', () => {
  const rows = [{ name: 'Pyro', type: 'Star', x: 0, y: 0, z: 0 }, { name: 'Bloom', type: 'Planet', x: 1, y: 2, z: 0 }, { name: 'Ignoto', type: 'Moon', x: 5, y: 5, z: 0 }];
  const m = obstructionModel('pyro', 1.2, rows);
  assert.equal(m.bodies.find((b) => b.name === 'Bloom').radius, 413900);
  assert.ok(m.bodies.some((b) => b.uncertain));
  assert.equal(m.complete, false);
  assert.deepEqual(m.missing, ['Ignoto']);
});

test('Istruzioni per il pilota e correzione in volo', () => {
  const ctx = buildContext('stanton', pts([['A', 0, 0, 0], ['B', 1e9, 0, 0]]), OPEN);
  const p = planInSystem(ctx, vec(4e8, 3e7, 0), null, { mode: 'geometrica', allowTwoStage: false }).plans.find((x) => x.steps[0].from.name === 'A');
  const lines = pilotInstructions(p);
  assert.match(lines[0], /Posizionati a A/);
  assert.ok(lines.some((l) => /passa da 600 Mm a 599,9 Mm|passa da 600,0 Mm a 599,9 Mm/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /90,0° dalla direzione di B/.test(l)));
  const c = inFlightCorrection(vec(0, 0, 0), vec(1000, 0, 0), vec(5000, 3000, 0));
  close(c.along, 4000); close(c.closest, 3000);
});

test('Prestazioni: 400 marker (circa 160.000 tratte direzionali) in tempi interattivi', () => {
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const many = Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, name: `m${i}`, pos: vec((rnd() - 0.5) * 1e11, (rnd() - 0.5) * 1e11, (rnd() - 0.5) * 1e8), qtValid: true }));
  const ctx = buildContext('t', many, OPEN);
  const t0 = Date.now();
  const r = planInSystem(ctx, vec(1.2e9, -4.5e9, 1e6), { pos: vec(3e10, 3e10, 0), name: 'io' }, { mode: 'geometrica' });
  const ms = Date.now() - t0;
  assert.ok(r.plans.length > 0);
  assert.ok(ms < 8000, `${ms} ms`);
});
