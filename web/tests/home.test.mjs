// PLANCIA (1.0.0): logica pura e stato, con DATI SINTETICI. Nessuna telemetria: la posizione e' solo
// quella inserita; la nave mostra la configurazione di serie; la rotta e' quella del pianificatore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_SET, DEFAULT_SHIP, parsePosition, nearestMarker, nearestBody, planSummary, straightDistance, pushRecent, shipSheet, miniProjector } from '../js/home/model.js';
import { HomeState, META_KEYS } from '../js/home/state.js';
import { IDBFactory } from 'fake-indexeddb';
import { PointsDB } from '../js/data/pointsdb.js';
import { normalizePoint } from '../js/core/points.js';

class FakeDb { constructor() { this.m = new Map(); } async getMeta(k) { return this.m.get(k) ?? null; } async setMeta(k, v) { this.m.set(k, structuredClone(v)); } }

test('HM-1 plancia senza posizione: POSIZIONE NON IMPOSTATA, nave predefinita, nessuna destinazione', async () => {
  const st = await new HomeState(() => new FakeDb()).load();
  assert.equal(st.position, null); assert.equal(st.destination, null); assert.equal(st.lastPlan, null);
  assert.equal(st.ship, DEFAULT_SHIP); assert.equal(NOT_SET, 'POSIZIONE NON IMPOSTATA');
  assert.deepEqual(straightDistance(null, { system: 'stanton', pos: { x: 0, y: 0, z: 0 } }), { d: null, note: 'posizione non impostata' });
  const mem = await new HomeState(() => null).load();
  assert.equal(mem.persistent, false, 'senza archivio lo stato è dichiarato non persistente');
});

test('HM-2 /showlocation: metri nel frame del sistema; tre numeri con unità dichiarata; testo non valido rifiutato', () => {
  assert.deepEqual(parsePosition('Coordinates: x:22462651723.53 y:-37186290817.84 z:808831.76'), { x: 22462651723.53, y: -37186290817.84, z: 808831.76, source: '/showlocation' });
  assert.deepEqual(parsePosition('Coordinates: x:1e6 y:-2.5E3 z:0'), { x: 1e6, y: -2500, z: 0, source: '/showlocation' });
  assert.deepEqual(parsePosition('1000 -2000 3,5'), { x: 1000, y: -2000, z: 3.5, source: 'manuale' });
  assert.deepEqual(parsePosition('1 2 3', { unit: 'km' }), { x: 1000, y: 2000, z: 3000, source: 'manuale' });
  assert.ok(parsePosition('').error);
  assert.ok(parsePosition('Port Tressler').error, 'un nome non diventa coordinate');
  assert.ok(parsePosition('lat 12 lon 40 alt 3').error, 'coordinate planetarie non convertite');
  assert.ok(parsePosition('1 2').error);
});

test('HM-3 contesto posizione: marker QT validi soltanto, distanza dalla superficie se il raggio è noto', () => {
  const pos = { x: 1000, y: 0, z: 0 };
  const mk = [{ name: 'Centro pianeta', pos: { x: 0, y: 0, z: 0 }, qtValid: false }, { name: 'Stazione', pos: { x: 4000, y: 0, z: 0 }, qtValid: true }];
  assert.deepEqual(nearestMarker(pos, mk), { name: 'Stazione', d: 3000 });
  assert.equal(nearestMarker(pos, []), null);
  const places = [{ id: 'p', name: 'P', kind: 'planet', system: 'stanton', pos: { x: 0, y: 0, z: 0 }, radius: 600 }, { id: 'm', name: 'M', kind: 'moon', system: 'stanton', pos: { x: 3000, y: 0, z: 0 } }, { id: 'o', name: 'Altro sistema', kind: 'planet', system: 'pyro', pos: { x: 1000, y: 0, z: 0 } }];
  assert.deepEqual(nearestBody(pos, places, 'stanton'), { name: 'P', id: 'p', d: 400, fromSurface: true });
});

test('HM-4 distanza: in linea retta solo nello stesso sistema, mai fra sistemi diversi', () => {
  const pos = { system: 'stanton', x: 0, y: 3, z: 4 };
  assert.equal(straightDistance(pos, { system: 'stanton', pos: { x: 0, y: 0, z: 0 } }).d, 5);
  const x = straightDistance(pos, { system: 'pyro', pos: { x: 0, y: 0, z: 0 } }); assert.equal(x.d, null); assert.match(x.note, /jump point/);
  assert.match(straightDistance(pos, { system: 'stanton', pos: null }).note, /senza XYZ/);
});

test('HM-5 riepilogo rotta: copiato dal pianificatore, nessun ricalcolo', () => {
  assert.equal(planSummary(null), null);
  const p = { at: 'T', inputs: { target: { name: 'New Babbage', system: 'stanton' } }, data: { gameVersion: 'V' },
    result: { departure: 'Port Tressler', status: 'dati', evidence: 'fonti', residual_m: 7e5, residualWorst_m: 9e7, time_s: null,
      steps: [{ kind: 'qt', to: 'A' }, { kind: 'jump', to: 'Pyro Gateway' }, { kind: 'qt-drop', to: 'B' }, { kind: 'conv', to: 'P' }] } };
  const s = planSummary(p);
  assert.deepEqual([s.qtLegs, s.drops, s.jumps], [2, 1, 1]);
  assert.deepEqual(s.path, ['A', 'Pyro Gateway', 'B']);
  assert.equal(s.residual, 7e5); assert.equal(s.time, null, 'tempo non determinabile resta null');
});

test('HM-6 stato persistente in chiavi meta separate; preferiti e visite solo su azione esplicita', async () => {
  const db = new FakeDb();
  const st = await new HomeState(() => db).load();
  let events = []; st.onChange((w) => events.push(w));
  await st.setPosition({ system: 'stanton', x: 1, y: 2, z: 3, source: '/showlocation' });
  await st.setDestination({ id: 'city', name: 'Citta Uno', system: 'stanton', pos: { x: 0, y: 0, z: 0 } });
  await st.toggleFav({ id: 'pt:a1', name: 'Grotta' }); await st.addRecent({ id: 'city', name: 'Citta Uno' }); await st.addRecent({ id: 'city', name: 'Citta Uno' });
  assert.deepEqual(events, ['position', 'destination', 'fav', 'recent', 'recent']);
  assert.equal(st.visits.length, 0, 'aprire o impostare una destinazione non registra una visita');
  await st.markVisited({ id: 'city', name: 'Citta Uno' }); assert.equal(st.lastVisit('city').name, 'Citta Uno');
  const again = await new HomeState(() => db).load();
  assert.equal(again.position.source, '/showlocation'); assert.ok(again.position.at);
  assert.equal(again.destination.id, 'city'); assert.ok(again.isFav('pt:a1')); assert.equal(again.recent.length, 1);
  assert.deepEqual([...db.m.keys()].sort(), Object.values(META_KEYS).sort(), 'solo le chiavi della plancia, nessun punto toccato');
  await again.toggleFav({ id: 'pt:a1' }); assert.equal(again.isFav('pt:a1'), false);
  assert.deepEqual(Object.keys(again.exportJson()).sort(), Object.values(META_KEYS).sort());
});

test('HM-7 elenco recenti senza duplicati e limitato', () => {
  let l = []; for (let i = 0; i < 20; i++) l = pushRecent(l, { id: `x${i % 15}` });
  assert.equal(l.length, 12); assert.equal(l[0].id, 'x4'); assert.equal(new Set(l.map((e) => e.id)).size, 12);
});

test('HM-8 scheda nave: solo dati dei file di gioco, campi mancanti null; nessuno stato carburante/scudi/danni', () => {
  assert.equal(shipSheet(null), null);
  const s = shipSheet({ name: 'RSI Constellation Mk V Centaurus', maker: 'Roberts Space Industries', cargo: 240, fuelH: 46800, fuelQt: 8600, qtRange: 848e9, qtSpeed: 250857100, stock: { quantumDrive: ['Khaos (grado 3)'] }, patch: '4.x' }, 'mia nota');
  const v = Object.fromEntries(s.rows.map((r) => [r.label, r.value]));
  assert.equal(v['Cargo (griglia)'], '240 SCU'); assert.match(v['Autonomia quantum'], /848/); assert.equal(v['Quantum drive (di serie)'], 'Khaos (grado 3)');
  assert.equal(v['Power plant (di serie)'], null); assert.equal(v.Dimensioni, null);
  assert.ok(!s.rows.some((r) => /stato|danni|livello carburante|scudi attuali/i.test(r.label)));
  assert.match(s.source, /configurazione di serie/); assert.equal(s.notes, 'mia nota');
  const pros = Object.fromEntries(shipSheet({ name: 'MISC Prospector', cargo: 0, mining: true }).rows.map((r) => [r.label, r.value]));
  assert.match(pros['Cargo (griglia)'], /minerario non è cargo/);
});

test('HM-9 mini mappa: scala lineare reale (rapporti delle distanze conservati)', () => {
  const P = miniProjector([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: -50 }], 228, 228, 14);
  const a = P.at({ x: 100, y: 0 }), b = P.at({ x: 0, y: -50 }), o = P.at({ x: 0, y: 0 });
  assert.equal(o.x, 114); assert.equal(o.y, 114);
  assert.ok(Math.abs((a.x - o.x) / (b.y - o.y) - 2) < 1e-9, 'Y verso l\'alto, rapporto 2:1 conservato');
});

test('HM-10 archivio personale preservato: 3.355 punti invariati dopo l\'uso della plancia e la riapertura', async () => {
  const factory = new IDBFactory();
  let db = await PointsDB.open({ indexedDB: factory });
  const pts = Array.from({ length: 3355 }, (_, i) => normalizePoint({ id: `p${i}`, name: `Punto ${i}`, system: 'stanton', x: i, y: -i, z: 0, unit: 'km', status: 'Da verificare', category: 'Mining', notes: `nota ${i}` }, { now: '2026-01-01T00:00:00.000Z' }).point);
  await db.putMany(pts);
  await db.setMeta('destNotes', { city: { text: 'mia nota' } });
  const before = JSON.stringify(await db.all());
  const st = await new HomeState(() => db).load();
  await st.setPosition({ system: 'stanton', x: 1, y: 2, z: 3, source: 'manuale' });
  await st.setDestination({ id: 'pt:p7', name: 'Punto 7', system: 'stanton', pos: { x: 7000, y: -7000, z: 0 } });
  await st.toggleFav({ id: 'pt:p7', name: 'Punto 7' }); await st.markVisited({ id: 'pt:p7', name: 'Punto 7' });
  db.close(); db = await PointsDB.open({ indexedDB: factory });
  assert.equal(JSON.stringify(await db.all()), before, 'nessun punto modificato o cancellato');
  assert.deepEqual(await db.getMeta('destNotes'), { city: { text: 'mia nota' } }, 'annotazioni DI intatte');
  const again = await new HomeState(() => db).load();
  assert.equal(again.destination.id, 'pt:p7'); assert.ok(again.isFav('pt:p7'));
  db.close();
});
