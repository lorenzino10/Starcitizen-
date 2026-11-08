// NAVCOM LOGISTICS INTELLIGENCE: test con DATI SINTETICI (nessuna missione reale).
// Luoghi fittizi "Alfa", "Bravo", ... in un sistema "stanton" sintetico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { vec } from '../js/core/vector.js';
import { normalizeContract, transition, recordLoad, recordDelivery, patchAge, isCommitted, SHIPS, canTransition } from '../js/logistics/model.js';
import { PlaceIndex, leg, legCache } from '../js/logistics/places.js';
import { buildTasks, validateSequence, routeContracts, planDispatch, EXACT_LIMIT } from '../js/logistics/optimizer.js';
import { buildManifest, holdChartSvg } from '../js/logistics/manifest.js';
import { applyAction, newDispatch, recompute, alternativeStations } from '../js/logistics/dispatch.js';
import { normalizeObservation, whereToSearch, diffWithPrevious, breakdown } from '../js/logistics/intel.js';
import { normalizeSchp, normalizeWikiMission, observeFromCatalog, wikiCatalog, parseSchpScript } from '../js/logistics/catalog.js';
import { freightRadar } from '../js/logistics/radar.js';
import { exportFull, parseBackup, mergeById, contractsToCsv, csvToContracts, jsonToContracts } from '../js/logistics/io.js';
import { LogisticsDB } from '../js/logistics/lgdb.js';

const GM = 1e9;
const SYN = {
  stanton: [
    { name: 'Alfa', pos: vec(0, 0, 0) }, { name: 'Bravo', pos: vec(1 * GM, 0, 0) }, { name: 'Charlie', pos: vec(2 * GM, 0, 0) },
    { name: 'Delta', pos: vec(3 * GM, 0, 0) }, { name: 'Echo', pos: vec(1 * GM, 1 * GM, 0) }, { name: 'SYN-L1 Foxtrot Station', pos: vec(0, 2 * GM, 0) },
  ],
  pyro: [{ name: 'Golf', pos: vec(0, 0, 0) }],
};
const places = new PlaceIndex(SYN);
const ctxBase = (extra = {}) => ({ capacity: 240, start: { name: 'Alfa', system: 'stanton' }, legOf: legCache(places), priority: 'profitto', ship: SHIPS['rsi-constellation-mk5-centaurus'], ...extra });
const C = (over) => {
  const r = normalizeContract({ system: 'stanton', patch: '4.10.2', status: 'accettata', reward: 10000, ...over });
  assert.ok(r.contract, r.errors.join('; '));
  return r.contract;
};
const mv = (id, scu, from, to, extra = {}) => ({ id, scu, cargo: 'Merce sintetica', from: { name: from }, to: { name: to }, ...extra });

// ------------------------------------------------------------------ test minimi richiesti
test('1. Due contratti da 150 e 120 SCU contemporanei sono rifiutati con capienza 240', () => {
  const a = C({ id: 'A', movements: [mv('m1', 150, 'Bravo', 'Delta')] });
  const b = C({ id: 'B', movements: [mv('m1', 120, 'Bravo', 'Delta')] });
  const { tasks } = buildTasks([a, b], { capacity: 240 });
  const both = [tasks[0], tasks[2], tasks[1], tasks[3]]; // carica A, carica B, scarica A, scarica B
  const v = validateSequence(both, { capacity: 240 });
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /capacità superata.*270 SCU su 240/);
  // l'ottimizzatore non li tiene mai insieme: o fa due giri o non pianifica
  const r = routeContracts([a, b], ctxBase());
  assert.ok(r.ok);
  assert.ok(r.peak <= 240, `picco ${r.peak}`);
  // con al massimo 2 scali (servirebbero 4) il piano e' impossibile
  assert.equal(routeContracts([a, b], ctxBase({ maxStops: 2 })).ok, false);
});

test('2. 80 caricati, poi 100, poi 80 consegnati, poi 120 ritirati: picco 220 SCU', () => {
  const a = C({ id: 'A', movements: [mv('m1', 80, 'Bravo', 'Delta')] });
  const b = C({ id: 'B', movements: [mv('m1', 100, 'Charlie', 'Echo')] });
  const c = C({ id: 'C', movements: [mv('m1', 120, 'Delta', 'Echo')] });
  const t = buildTasks([a, b, c], { capacity: 240 }).tasks;
  const id = (x) => t.find((k) => k.id === x);
  const seq = [id('A/m1/P1'), id('B/m1/P1'), id('A/m1/D1'), id('C/m1/P1'), id('B/m1/D1'), id('C/m1/D1')];
  const v = validateSequence(seq, { capacity: 240 });
  assert.ok(v.ok, v.errors.join('; '));
  assert.deepEqual(v.loads, [80, 180, 100, 220, 120, 0]);
  assert.equal(v.peak, 220);
  const man = buildManifest({ seq, initialLoad: 0, contracts: [a, b, c] }, { capacity: 240, ship: SHIPS['rsi-constellation-mk5-centaurus'] });
  assert.equal(man.peak, 220);
  assert.equal(man.stops.at(-1).loadAfter, 0);
  assert.equal(man.stops.find((s) => s.place.name === 'Delta').loadAfter, 220);
  assert.match(holdChartSvg(man), /picco 220 SCU su 240/);
});

test('3. Nessun algoritmo consegna merce non ancora ritirata (esatto ed euristico, istanze casuali)', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const names = SYN.stanton.map((p) => p.name);
  for (let k = 0; k < 40; k++) {
    const n = 2 + Math.floor(rnd() * 8); // fino a 9 contratti: oltre EXACT_LIMIT -> euristica
    const cs = [];
    for (let i = 0; i < n; i++) {
      const f = names[Math.floor(rnd() * names.length)]; let to = names[Math.floor(rnd() * names.length)];
      if (to === f) to = names[(names.indexOf(f) + 1) % names.length];
      cs.push(C({ id: `K${k}C${i}`, movements: [mv('m1', 10 + Math.floor(rnd() * 120), f, to)] }));
    }
    const r = routeContracts(cs, ctxBase({ capacity: 240 }));
    if (!r.ok) continue;
    const v = validateSequence(r.seq, { capacity: 240 });
    assert.ok(v.ok, `${r.method}: ${v.errors.join('; ')}`);
    const seen = new Set();
    for (const t of r.seq) { if (t.type === 'scarico') assert.ok(seen.has(t.pair), `consegna prima del ritiro (${r.method})`); seen.add(t.id); }
    if (buildTasks(cs, { capacity: 240 }).tasks.length > EXACT_LIMIT) assert.equal(r.method, 'euristico deterministico');
  }
});

test('3b. Euristica deterministica: stesso input, stesso risultato; esatto non peggiore dell\'euristica', () => {
  const cs = Array.from({ length: 7 }, (_, i) => C({ id: `R${i}`, movements: [mv('m1', 30 + i * 10, SYN.stanton[i % 6].name, SYN.stanton[(i * 2 + 1) % 6].name)] }));
  const a = routeContracts(cs, ctxBase()), b = routeContracts(cs, ctxBase());
  assert.deepEqual(a.seq.map((t) => t.id), b.seq.map((t) => t.id));
  const small = cs.slice(0, 4);
  const ex = routeContracts(small, ctxBase());
  const he = routeContracts(small, ctxBase({ method: 'euristico' }));
  assert.equal(ex.method, 'esatto'); assert.equal(he.method, 'euristico deterministico');
  assert.ok(ex.eval.distance <= he.eval.distance + 1e-6, `esatto ${ex.eval.distance} > euristico ${he.eval.distance}`);
});

test('4. Missione con più punti di ritiro: quantità corrette per ogni ritiro e consegna', () => {
  const c = C({ id: 'M', movements: [mv('a', 30, 'Bravo', 'Delta'), mv('b', 50, 'Charlie', 'Delta'), mv('c', 20, 'Charlie', 'Echo')] });
  const r = routeContracts([c], ctxBase());
  assert.ok(r.ok);
  const per = {};
  for (const t of r.seq) per[`${t.movementId}:${t.type}`] = (per[`${t.movementId}:${t.type}`] ?? 0) + t.qty;
  assert.deepEqual(per, { 'a:carico': 30, 'a:scarico': 30, 'b:carico': 50, 'b:scarico': 50, 'c:carico': 20, 'c:scarico': 20 });
  // consegna parziale: lo stato per movimento resta separato
  let x = recordLoad(c, 'b', 50);
  x = recordDelivery(x, 'b', 20);
  assert.equal(x.status, 'in_esecuzione');
  assert.deepEqual(x.movements.map((m) => [m.id, m.loaded, m.delivered]), [['a', 0, 0], ['b', 50, 20], ['c', 0, 0]]);
  assert.throws(() => recordDelivery(x, 'b', 31), /in stiva/);
  assert.throws(() => recordDelivery(x, 'a', 1), /in stiva/); // 'a' non ancora caricato
  const t = buildTasks([x], { capacity: 240 });
  assert.equal(t.initialLoad, 30);
  assert.deepEqual(t.tasks.filter((k) => k.movementId === 'b').map((k) => [k.type, k.qty]), [['scarico', 30]]);
});

test('5. Una missione solo teorica (catalogo) non può essere promossa automaticamente', () => {
  const entry = normalizeWikiMission(WIKI_SYN);
  assert.equal(entry.source, 'wiki');
  assert.equal(normalizeContract({ ...entry, status: 'catalogo', movements: [mv('m', 1, 'Alfa', 'Bravo')] }).contract, null);
  assert.throws(() => observeFromCatalog(entry, {}), /luogo e il momento/);
  const draft = observeFromCatalog(entry, { place: 'Alfa', at: '2026-11-08T10:00:00Z', patch: '4.10.2' });
  assert.equal(draft.status, 'osservata');
  assert.equal(draft.reward, null, 'la ricompensa del catalogo non viene copiata');
  assert.ok(draft.movements.every((m) => m.from === null), 'ritiro dinamico: resta sconosciuto');
  const c = normalizeContract({ ...draft, system: 'stanton' });
  assert.ok(c.contract);
  assert.ok(c.warnings.some((w) => /ritiro non noto/.test(w)));
  // un'osservata non entra mai nel piano come contratto
  const plan = planDispatch([c.contract], ctxBase());
  assert.equal(plan.contracts.length, 0);
  // e un confermato senza luoghi noti non viene proposto
  const conf = transition(c.contract, 'confermata');
  const p2 = planDispatch([conf], ctxBase());
  assert.equal(p2.proposed.length, 0);
  assert.match(p2.blocked[0].reason, /non noto/);
  assert.equal(canTransition('osservata', 'completata'), false);
});

test('6. Offerta non trovata: il ricalcolo conserva contratti accettati e merce in stiva', () => {
  let acc = C({ id: 'ACC', movements: [mv('m1', 60, 'Bravo', 'Delta')] });
  acc = recordLoad(acc, 'm1', 60); // gia' a bordo
  const acc2 = C({ id: 'ACC2', movements: [mv('m1', 40, 'Charlie', 'Echo')] });
  const conf = C({ id: 'CONF', status: 'confermata', movements: [mv('m1', 50, 'Echo', 'Delta')], reward: 50000 });
  let contracts = [acc, acc2, conf];
  let st = newDispatch({ name: 'Alfa', system: 'stanton' });
  const before = recompute(st, contracts, ctxBase());
  assert.ok(before.proposed.some((c) => c.id === 'CONF'));
  const r = applyAction(st, contracts, { type: 'non_disponibile', contractId: 'CONF' }, { now: '2026-11-08T11:00:00Z', patch: '4.10.2' });
  contracts = contracts.map((c) => r.changed.find((x) => x.id === c.id) ?? c);
  st = r.state;
  assert.equal(contracts.find((c) => c.id === 'CONF').status, 'non_disponibile');
  assert.equal(r.observations[0].outcome, 'assente');
  const after = recompute(st, contracts, ctxBase());
  assert.ok(after.ok);
  assert.deepEqual(after.committed.map((c) => c.id).sort(), ['ACC', 'ACC2']);
  assert.equal(after.initialLoad, 60);
  assert.ok(after.seq.some((t) => t.contractId === 'ACC' && t.type === 'scarico' && t.qty === 60));
  assert.ok(after.seq.some((t) => t.contractId === 'ACC2' && t.type === 'carico'));
  assert.ok(!after.seq.some((t) => t.contractId === 'CONF'));
  // un contratto accettato non puo' diventare "non disponibile"
  assert.throws(() => applyAction(st, contracts, { type: 'non_disponibile', contractId: 'ACC' }), /già accettato/);
  // saltare una stazione con consegne obbligatorie lo segnala e non le perde
  const s2 = applyAction(st, contracts, { type: 'salta', place: { name: 'Delta' } });
  assert.match(s2.messages[0], /operazioni obbligatorie/);
  const p3 = recompute(s2.state, contracts, ctxBase());
  assert.ok(p3.seq.some((t) => t.place.name === 'Delta'));
});

test('7. Dati obsoleti dopo il cambio di patch', () => {
  assert.equal(patchAge('4.10.2-LIVE.12881860', '4.10.2'), 'attuale');
  assert.equal(patchAge('4.10.0', '4.10.2'), 'attuale'); // stesso major.minor
  assert.equal(patchAge('4.9.1', '4.10.2'), 'obsoleto');
  assert.equal(patchAge(null, '4.10.2'), 'sconosciuta');
  const obs = [
    { place: 'Bravo', at: '2026-01-01T10:00:00Z', patch: '4.9.0', outcome: 'presente', reward: 1000, scu: 10 },
    { place: 'Bravo', at: '2026-01-02T10:00:00Z', patch: '4.9.0', outcome: 'presente' },
    { place: 'Charlie', at: '2026-11-08T10:00:00Z', patch: '4.10.2', outcome: 'presente' },
  ].map((o) => normalizeObservation(o).observation);
  const w = whereToSearch(obs, { currentPatch: '4.10.2' });
  assert.equal(w[0].place, 'Charlie');
  const bravo = w.find((x) => x.place === 'Bravo');
  assert.equal(bravo.current.visits, 0);
  assert.equal(bravo.previous.visits, 2);
  assert.equal(bravo.previous.sample, 'campione insufficiente');
});

test('8. Posizione senza coordinate affidabili: nessuna rotta precisa', () => {
  assert.equal(places.resolve('Stazione Inesistente', 'stanton'), null);
  const l = leg(places, { name: 'Alfa', system: 'stanton' }, { name: 'Stazione Inesistente' });
  assert.equal(l.distance, null); assert.match(l.note, /posizione non nota/);
  const inter = leg(places, { name: 'Alfa' }, { name: 'Golf' });
  assert.equal(inter.distance, null); assert.ok(inter.interstellar);
  assert.equal(places.resolve('Foxtrot Station').name, 'SYN-L1 Foxtrot Station'); // suffisso unico
  const c = C({ id: 'U', movements: [mv('m1', 10, 'Bravo', 'Stazione Inesistente')] });
  const p = planDispatch([c], ctxBase());
  assert.ok(p.ok);
  assert.equal(p.eval.unknownLegs, 1);
  assert.equal(p.eval.travelTime, null);
  assert.ok(p.warnings.some((w) => /non nota/.test(w)));
  // movimento senza luogo: non pianificabile, segnalato
  const d = normalizeContract({ system: 'stanton', status: 'accettata', patch: '4.10.2', movements: [{ id: 'x', scu: 5, from: null, to: { name: 'Bravo' } }] }).contract;
  const r = routeContracts([d], ctxBase());
  assert.equal(r.issues[0].reason, 'punto di ritiro o consegna non noto');
  // il radar non calcola deviazioni senza posizioni
  const rad = freightRadar({ start: { name: 'Nowhere' }, dest: { name: 'Delta' }, capacity: 240, currentPatch: '4.10.2', priority: 'profitto' }, { catalog: [], observations: [], places });
  assert.match(rad.issues[0], /non nota/);
});

test('9. Backup e ripristino conservano contratti, osservazioni e stati (IndexedDB)', async () => {
  const db = await LogisticsDB.open();
  assert.ok(db.persistent);
  let c1 = C({ id: 'B1', movements: [mv('m1', 30, 'Bravo', 'Delta'), mv('m2', 20, 'Charlie', 'Delta')] });
  c1 = recordDelivery(recordLoad(c1, 'm1', 30), 'm1', 10);
  const c2 = C({ id: 'B2', status: 'confermata', movements: [mv('m1', 5, 'Alfa', 'Echo', { containerMax: 2 })] });
  const o1 = normalizeObservation({ place: 'Bravo', at: '2026-11-08T09:00:00Z', patch: '4.10.2', outcome: 'presente', reward: 100, scu: 5 }).observation;
  await db.putContracts([c1, c2]); await db.putObservations([o1]);
  const backup = JSON.stringify(exportFull({ points: [{ id: 'p1', name: 'Punto' }], contracts: await db.contracts(), observations: await db.observations() }));
  await db.replaceAll({});
  assert.equal((await db.contracts()).length, 0);
  const parsed = parseBackup(backup);
  assert.deepEqual(parsed.errors, []);
  await db.replaceAll(parsed);
  const back = (await db.contracts()).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(back.map((c) => [c.id, c.status]), [['B1', 'in_esecuzione'], ['B2', 'confermata']]);
  assert.deepEqual(back[0].movements.map((m) => [m.loaded, m.delivered]), [[30, 10], [0, 0]]);
  assert.equal(back[1].movements[0].containerMax, 2);
  assert.deepEqual(back[0].history, c1.history);
  assert.equal((await db.observations())[0].reward, 100);
  assert.equal(parsed.points.length, 1);
  // unione senza perdita
  const m = mergeById([c1], [{ ...c1, updatedAt: '2000-01-01T00:00:00Z' }, c2]);
  assert.deepEqual([m.added, m.updated, m.kept], [1, 0, 1]);
  db.close();
});

test('10. CSV e JSON dei contratti: andata e ritorno, più movimenti per contratto', () => {
  const c = C({ id: 'CSV1', title: 'Consegna; "speciale"', movements: [mv('a', 30, 'Bravo', 'Delta'), mv('b', 12, 'Charlie', 'Delta', { containerMax: 4 })] });
  const csv = contractsToCsv([c]);
  const back = csvToContracts(csv);
  assert.deepEqual(back.errors, []);
  assert.equal(back.contracts.length, 1);
  assert.equal(back.contracts[0].title, 'Consegna; "speciale"');
  assert.deepEqual(back.contracts[0].movements.map((m) => [m.id, m.scu, m.from.name, m.to.name, m.containerMax]), [['a', 30, 'Bravo', 'Delta', null], ['b', 12, 'Charlie', 'Delta', 4]]);
  const j = jsonToContracts({ contracts: [{ title: 'J', system: 'stanton', patch: '4.10.2', movements: [{ scu: 'x' }] }] });
  assert.equal(j.contracts.length, 0); assert.match(j.errors[0], /SCU/);
});

// ------------------------------------------------------------------ moduli
test('Ottimizzatore: i confermati sono proposti "da accettare", mai come acquisiti; grado e casse rispettati', () => {
  const acc = C({ id: 'A', movements: [mv('m1', 100, 'Bravo', 'Delta')] });
  const ok = C({ id: 'OK', status: 'confermata', company: 'Synthetic Haulers', rank: 'Junior', reward: 90000, movements: [mv('m1', 80, 'Bravo', 'Charlie')] });
  const big = C({ id: 'BIG', status: 'confermata', reward: 1e6, movements: [mv('m1', 10, 'Bravo', 'Charlie', { containerMax: 64 })] });
  const rank = C({ id: 'RANK', status: 'confermata', company: 'Synthetic Haulers', rank: 'Senior', reward: 1e6, movements: [mv('m1', 10, 'Bravo', 'Charlie')] });
  const p = planDispatch([acc, ok, big, rank], ctxBase({ ranks: { 'Synthetic Haulers': 'Member' } }));
  assert.ok(p.ok);
  assert.deepEqual(p.proposed.map((c) => c.id), ['OK']);
  assert.deepEqual(p.blocked.map((b) => b.contract.id).sort(), ['BIG', 'RANK']);
  assert.ok(p.committed.every(isCommitted));
  const man = buildManifest(p, { capacity: 240, ship: SHIPS['rsi-constellation-mk5-centaurus'] });
  assert.ok(man.stops.flatMap((s) => s.ops).filter((o) => o.contractId === 'OK').every((o) => o.proposed));
  assert.ok(man.limits.some((l) => /fisica non verificata/.test(l)));
});

test('Ottimizzatore: movimento oltre la capacità diviso in più viaggi', () => {
  const c = C({ id: 'X', movements: [mv('m1', 300, 'Bravo', 'Delta')] });
  const r = routeContracts([c], ctxBase());
  assert.ok(r.ok);
  assert.deepEqual(r.seq.map((t) => `${t.type}:${t.qty}`), ['carico:240', 'scarico:240', 'carico:60', 'scarico:60']);
});

test('Ottimizzatore: profitto orario solo con tempi noti', () => {
  const c = C({ id: 'T', movements: [mv('m1', 10, 'Bravo', 'Delta')] });
  const p = planDispatch([c], ctxBase());
  assert.equal(p.score.perHour, null);
  const p2 = planDispatch([c], ctxBase({ legOf: legCache(places, { drive: { vmax: 1e8 } }), handling: { perScu: 6, perStop: 60 } }));
  assert.ok(p2.score.perHour > 0);
});

test('Intelligence: variazioni, analisi per compagnia, campione dichiarato', () => {
  const a = normalizeObservation({ place: 'Bravo', at: '2026-11-01T10:00:00Z', patch: '4.10.2', offerId: 'X1', reward: 1000, scu: 10, company: 'Synthetic Haulers' }).observation;
  const b = normalizeObservation({ place: 'Bravo', at: '2026-11-02T10:00:00Z', patch: '4.10.2', offerId: 'X1', reward: 1200, scu: 10, company: 'Synthetic Haulers' }).observation;
  assert.deepEqual(diffWithPrevious(b, [a, b]).map((d) => [d.field, d.before, d.after]), [['reward', 1000, 1200]]);
  const by = breakdown([a, b], 'compagnia');
  assert.equal(by[0].n, 2); assert.equal(by[0].sample, 'campione insufficiente');
  const alt = alternativeStations([a, b], { currentPatch: '4.10.2' });
  assert.equal(alt[0].kind, 'previsione');
});

test('Catalogo: normalizzazione SCHaulingPlanner (sintetico) con più ritiri e ripartizione ignota', () => {
  const text = `window.MISSION_DATA = ${JSON.stringify({ meta: {}, missions: [{ reward: 1000, contractor: 'Synthetic Haulers', rank: 'Junior', system: 'Stanton', location: ['Alfa'], missionType: 'Local', sourceFile: 'Data_2026.05.26_12.00.00.txt', deliveries: [{ scu: 10, cargo: 'X', destination: 'Delta', pickups: ['Bravo', 'Charlie'] }] }] })};`;
  const cat = normalizeSchp(parseSchpScript(text));
  const e = cat.entries[0];
  assert.equal(e.patch, null); assert.equal(e.observedAt, '2026-05-26');
  assert.equal(e.movements[0].from.fixed, false); assert.equal(e.movements[0].from.splitKnown, false);
  assert.match(e.notes, /ripartizione/);
  assert.equal(cat.meta.observedFrom, '2026-05-26');
  assert.equal(normalizeSchp(parseSchpScript(text)).entries[0].id, e.id, 'ID stabile');
});

test('Catalogo: Wiki API (sintetico) con candidati dinamici e versione', () => {
  const cat = wikiCatalog([WIKI_SYN, { uuid: 'n', title: 'Non trasporto', has_hauling: false }], { fetchedAt: '2026-11-08' });
  assert.equal(cat.entries.length, 1);
  const e = cat.entries[0];
  assert.equal(e.patch, '4.10.2-LIVE.12881860');
  assert.equal(e.rank, 'Rookie');
  assert.equal(e.reward, null);
  assert.deepEqual(e.movements.map((m) => [m.cargo, m.scu, m.containerMax]), [['Merce A', 32, 8], ['Merce B', 2, null]]);
  assert.equal(e.movements[0].from.fixed, false);
});

test('Freight Radar: tre alternative, evidenze distinte, nessuna probabilità', () => {
  const catalog = wikiCatalog([WIKI_SYN]).entries;
  const obs = [normalizeObservation({ place: 'Bravo', system: 'stanton', at: '2026-11-08T10:00:00Z', patch: '4.10.2', outcome: 'presente', scu: 40, reward: 20000, to: 'Delta' }).observation];
  const r = freightRadar({ start: { name: 'Alfa', system: 'stanton' }, dest: { name: 'Delta', system: 'stanton' }, capacity: 240, ship: SHIPS['rsi-constellation-mk5-centaurus'], ranks: {}, maxStops: 2, currentPatch: '4.10.2', priority: 'profitto' }, { catalog, observations: obs, places });
  assert.deepEqual(r.alternatives.conservativa.map((s) => s.name), ['Bravo']);
  assert.ok(r.alternatives.equilibrata.length >= 1);
  assert.ok(r.alternatives.esplorativa.length >= r.alternatives.equilibrata.length);
  const bravo = r.stations.find((s) => s.name === 'Bravo');
  assert.equal(bravo.bestEvidence, 'osservata_attuale');
  assert.equal(bravo.detour, 0); // Bravo e' sulla retta Alfa-Delta
  const charlie = r.stations.find((s) => s.name === 'Charlie');
  assert.equal(charlie.bestEvidence, 'catalogo_attuale');
  assert.ok(charlie.toVerify.some((v) => /assegnato dinamicamente/.test(v)));
  assert.ok(!JSON.stringify(r.stations.map((s) => Object.keys(s))).includes('probab'));
  // rango insufficiente: il modello Wiki richiede Rookie
  const r2 = freightRadar({ start: { name: 'Alfa' }, dest: { name: 'Delta' }, capacity: 240, ranks: { 'Synthetic Haulers': 'Trainee' }, currentPatch: '4.10.2' }, { catalog, observations: [], places });
  assert.equal(r2.stations.length, 0);
});

const WIKI_SYN = {
  uuid: 'syn-0001', title: 'Synthetic Hauler Needed', mission_giver: 'Synthetic Haulers', has_hauling: true,
  min_standing: { name: 'Rookie', min_reputation: 50 }, reward_min: null, reward_max: null, star_systems: ['Stanton'],
  version: '4.10.2-LIVE.12881860', mission_type: 'Hauling - Planetary', has_combat: false, illegal: false,
  mission_tokens: { 'Location|Address': ['Bravo', 'Charlie'], 'Destination|Address': ['Delta'] },
  hauling_orders: [{ name: 'Merce A', min_scu: 32, max_scu: 32, max_container_size: 8 }, { name: 'Merce B', min_scu: null, max_scu: 2, max_container_size: -1 }],
};
