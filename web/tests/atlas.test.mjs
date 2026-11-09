// ATLANTE 3D e CARGO INTELLIGENCE (0.7.0): test con DATI SINTETICI, separati dai dati reali.
// Mondo fittizio: stella "SYN", pianeta "Pianeta Sintetico", luna "Luna Sintetica" con basi in
// superficie, stazione "Stazione Charlie", un sistema pyro sintetico. Nessuna missione reale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { normalizePlaces, Geo, kindOf, geoFromSnapshot } from '../js/atlas/geo.js';
import { buildMissionCatalog, buildShips, cleanTitle } from '../js/atlas/scunpacked.js';
import { catalogViews, schpViews, userViews, MissionIndex, plannable, missionSegments, normalizationQueue, findDuplicates, TO_CONFIRM } from '../js/atlas/missions.js';
import { evaluateStack, suggestStack, bestStack, stackTypes, geoLegOf, toPlanning } from '../js/atlas/stack.js';
import { discoveryScore, rankDiscovery, observationsByPlace, placeStats, levelOf } from '../js/atlas/discovery.js';
import { stopsOf, moveStop, measure, planFromStack, manifestOf } from '../js/atlas/plan.js';
import { camera, projector, cluster, pick, compressor, frameDistance, DEG } from '../js/atlas/view.js';
import { normalizeContract, SHIPS } from '../js/logistics/model.js';
import { validateSequence } from '../js/logistics/optimizer.js';
import { normalizeObservation } from '../js/logistics/intel.js';
import { exportFull, parseBackup } from '../js/logistics/io.js';
import { LogisticsDB } from '../js/logistics/lgdb.js';

const GM = 1e9;
const P0 = { x: 10 * GM, y: 0, z: 0 }; // pianeta
const M0 = { x: 10 * GM + 5e7, y: 0, z: 0 }; // luna (raggio 2e5)
const row = (uuid, name, type, parent, p, system = 'stanton', extra = {}) => ({ uuid, name, type, system, parent_uuid: parent, x: p.x, y: p.y, z: p.z, qt_valid: true, hidden: false, ...extra });
const ROWS = [
  row('star', 'SYN', 'Star', null, { x: 0, y: 0, z: 0 }),
  row('pl', 'Pianeta Sintetico', 'Planet', 'star', P0),
  row('mo', 'Luna Sintetica', 'Moon', 'pl', M0),
  row('ba', 'Base Alfa', 'Outpost', 'mo', { x: M0.x + 2e5, y: 0, z: 0 }),
  row('bb', 'Base Bravo', 'Outpost', 'mo', { x: M0.x, y: 2e5, z: 0 }),
  row('bc', 'Base Delta Orbitale', 'Manmade', 'mo', { x: M0.x, y: 0, z: 9e5 }),
  row('sc', 'Stazione Charlie', 'Manmade', 'star', { x: 12 * GM, y: 1 * GM, z: 0 }),
  row('se', 'SYN-L1 Stazione Echo', 'Manmade', 'star', { x: 11 * GM, y: -1 * GM, z: 0 }),
  row('g1', 'Gemella', 'Outpost', 'pl', { x: P0.x + 1e6, y: 0, z: 0 }),
  row('hid', 'Base Nascosta', 'Outpost', 'mo', { x: M0.x - 2e5, y: 0, z: 0 }, 'stanton', { hidden: true }),
  row('pstar', 'PYS', 'Star', null, { x: 0, y: 0, z: 0 }, 'pyro'),
  row('pb', 'Base Pyro', 'Outpost', 'pstar', { x: 5 * GM, y: 0, z: 0 }, 'pyro'),
  row('g2', 'Gemella', 'Outpost', 'pstar', { x: 6 * GM, y: 0, z: 0 }, 'pyro'),
];
const PLACES = normalizePlaces(ROWS, { source: 'sintetico', patch: '9.9.0' });
// raggi sintetici (il seed reale non contiene questi nomi)
for (const p of PLACES) { if (p.id === 'mo') p.radius = 2e5; if (p.id === 'pl') p.radius = 1e6; }
const geo = new Geo(PLACES);

const pool = (purposeKey, purpose, names) => [purposeKey, { Purpose: purpose, ResolvedLocations: names.map((n) => (n ? { UUID: `t-${n}`, Name: n } : { UUID: 'anon' })) }];
const contract = (uuid, { pick, drop, offer = ['sc'], reward = 30000, rank = 1, order = { Name: 'Rame', MinScu: 40, MaxScu: 80, MaxContainerSize: 16 }, type = 'Hauling - Planetary', extraPools = [] }) => ({
  UUID: uuid, DebugName: `SYN_${uuid}_Stanton`, MissionType: { Name: type }, MissionGiver: 'Compagnia Sintetica', Title: `Trasporto ${uuid}`,
  LocationPools: Object.fromEntries([pool('PickupLocationBP', 'Location', pick), pool('DropoffLocationBP', 'Destination', drop), ...extraPools]),
  MissionTokens: {}, FixedReward: { Amount: reward }, MinStanding: { Name: 'Rookie' }, RankIndex: rank,
  AvailabilityLocations: [{ ResolvedLocations: offer.map((u) => ({ UUID: u })) }], HaulingOrders: order ? [order] : [], Deadline: { CompletionTime: 3600 },
});
const CONTRACTS = [
  contract('fix1', { pick: ['Base Alfa'], drop: ['Stazione Charlie'] }),
  contract('pool3', { pick: ['Base Alfa', 'Base Bravo', 'Stazione Echo'], drop: ['Stazione Charlie'] }), // "Stazione Echo" = suffisso unico
  contract('unk', { pick: ['Lobby', null], drop: ['Luogo Inesistente'] }),
  { ...contract('amb', { pick: ['Gemella'], drop: ['Base Bravo'], offer: [] }), DebugName: 'SYN_amb' }, // sistema ignoto
  contract('ambS', { pick: ['Gemella'], drop: ['Base Bravo'], offer: [] }), // sistema dal DebugName
  contract('multi', { pick: ['Base Alfa'], drop: ['Stazione Charlie'], extraPools: [pool('DropoffLocation2BP', 'Destination1', ['Base Bravo'])] }),
  { UUID: 'combat', MissionType: { Name: 'Mercenary' }, LocationPools: {} },
];
const CAT = buildMissionCatalog(CONTRACTS, PLACES, { patch: '9.9.0-LIVE.1', geo });

const userC = (over) => { const r = normalizeContract({ system: 'stanton', patch: '9.9.0', status: 'accettata', reward: 10000, title: 'Contratto', company: 'Compagnia Sintetica', ...over }); assert.ok(r.contract, r.errors.join('; ')); return r.contract; };
const mk = (contracts = [], schp = null) => { const q = new Map(); const views = [...userViews(contracts, geo, q), ...schpViews(schp, geo, q), ...catalogViews(CAT)]; return { views, idx: new MissionIndex(views, geo), q }; };
const ctx = (extra = {}) => ({ geo, capacity: 240, ship: SHIPS['rsi-constellation-mk5-centaurus'], ranks: {}, start: 'sc', ...extra });

// ------------------------------------------------------------------ 1. mappa 3D
test('1. mappa 3D: proiezione, rotazione, zoom e inquadratura', () => {
  const cam = camera({ target: P0, dist: 1e9 });
  const P = projector(cam, 800, 600);
  const c = P.project(P0);
  assert.ok(Math.abs(c.x - 400) < 1e-6 && Math.abs(c.y - 300) < 1e-6, 'il target sta al centro');
  const a = P.project(geo.get('ba').pos);
  cam.yaw += 30 * DEG; const b = projector(cam, 800, 600).project(geo.get('ba').pos);
  assert.ok(a.visible && b.visible);
  assert.notDeepEqual([a.x, a.y], [b.x, b.y], 'la rotazione cambia la vista');
  const far = projector({ ...cam, dist: 1e10 }, 800, 600).project(geo.get('ba').pos);
  assert.ok(Math.hypot(far.x - 400, far.y - 300) < Math.hypot(b.x - 400, b.y - 300), 'allontanando lo zoom i punti si avvicinano al centro');
  const d = frameDistance(P0, [geo.get('sc').pos, geo.get('se').pos]);
  assert.ok(d > 2 * GM && d < 20 * GM);
  const cmp = compressor(P0, 1e6); const v = cmp(geo.get('sc').pos);
  assert.ok(Math.hypot(v.x - P0.x, v.y - P0.y) < Math.hypot(geo.get('sc').pos.x - P0.x, geo.get('sc').pos.y - P0.y), 'la scala compressa avvicina solo graficamente');
  assert.ok(Math.abs(geo.distance('pl', 'sc') - Math.hypot(2 * GM, 1 * GM)) < 1, 'le distanze reali non cambiano');
});

test('2. selezione dei corpi celesti: gerarchia e clic', () => {
  assert.deepEqual(geo.path('ba').map((p) => p.name), ['SYN', 'Pianeta Sintetico', 'Luna Sintetica', 'Base Alfa']);
  assert.equal(geo.pathLabel('ba'), 'Stanton → Pianeta Sintetico → Luna Sintetica → Base Alfa');
  assert.deepEqual(geo.children('mo').map((p) => p.id).sort(), ['ba', 'bb', 'bc', 'hid']);
  const P = projector(camera({ target: P0, dist: 5e8 }), 800, 600);
  const pts = ['pl', 'sc'].map((id) => { const q = P.project(geo.get(id).pos); return { id, x: q.x, y: q.y, depth: q.depth, priority: 90 }; });
  const cl = cluster(pts);
  const hit = pick(pts[0].x + 3, pts[0].y - 2, cl);
  assert.equal(hit.id, 'pl');
  assert.equal(pick(pts[0].x + 40, pts[0].y + 40, cl), null, 'nessuna selezione lontano dai punti');
});

test('3. identificazione delle basi: tipi, corpo, ricerca, nascosti', () => {
  assert.equal(kindOf('Outpost'), 'outpost'); assert.equal(kindOf('Manmade', 'Pyro Gateway'), 'gateway'); assert.equal(kindOf('LandingZone'), 'city');
  assert.equal(geo.bodyOf('ba').name, 'Luna Sintetica');
  assert.equal(geo.bodyOf('sc'), null, 'una stazione nello spazio non appartiene a un corpo');
  assert.equal(geo.search('base alfa')[0].id, 'ba');
  assert.equal(geo.get('hid').hidden, true);
  assert.equal(geo.resolve('Stazione Echo').how, 'suffisso');
  assert.equal(geo.resolveName('Gemella'), null, 'nome presente in due sistemi: ambiguo');
  assert.equal(geo.resolveName('Gemella', 'pyro').id, 'g2', 'con il sistema indicato si risolve');
});

test('4. scheda della località: sezioni, superficie verificata, nessuna invenzione', () => {
  const { idx } = mk();
  const r = idx.forPlace('ba');
  assert.ok(r.out.length >= 3 && r.in.length === 0);
  const s = geo.surface('ba');
  assert.ok(s.ok && Math.abs(s.alt) < 1 && Math.abs(s.lat) < 1e-9 && Math.abs(s.lon) < 1e-9);
  const orb = geo.surface('bc');
  assert.equal(orb.ok, false); assert.equal(orb.orbit, true, 'in orbita: non collocata sul globo');
  const noR = geo.surface('g1'); // il pianeta ha raggio 1e6 ma la base e' a 1e6 esatto: sulla superficie
  assert.equal(noR.ok, true);
  const g2 = new Geo(PLACES.map((p) => (p.id === 'mo' ? { ...p, radius: null } : p)));
  assert.equal(g2.surface('ba').ok, false, 'senza raggio noto nessuna posizione sul globo');
  assert.match(g2.surface('ba').note, /raggio .* non noto/);
});

test('5. associazione delle missioni agli identificativi canonici', () => {
  const fix = CAT.missions.find((m) => m.id === 'scu:fix1');
  const ids = (p) => p.ids.map((i) => CAT.places[i]);
  assert.deepEqual(ids(fix.pools.find((p) => p.role === 'pickup')), ['ba']);
  assert.deepEqual(ids(fix.pools.find((p) => p.role === 'dropoff')), ['sc']);
  assert.equal(CAT.missions.length, 6, 'solo trasporto: la missione mercenaria e\' esclusa');
  const multi = CAT.missions.find((m) => m.id === 'scu:multi');
  assert.deepEqual(multi.pools.map((p) => `${p.role}${p.slot}`), ['pickup1', 'dropoff1', 'dropoff2'], 'Destination1 = seconda consegna');
  const { idx } = mk();
  assert.ok(idx.forPlace('sc').in.some((e) => e.v.id === 'scu:fix1' && e.strength === 'fisso'));
  assert.ok(idx.forPlace('bb').out.some((e) => e.v.id === 'scu:pool3' && e.strength === 'possibile' && e.alternatives === 3));
});

test('6. OFFERTA, RITIRO e CONSEGNA restano distinti', () => {
  const { idx } = mk();
  const atC = idx.forPlace('sc');
  assert.ok(atC.offer.some((e) => e.v.id === 'scu:fix1'), 'offerta alla Stazione Charlie');
  assert.ok(!atC.out.some((e) => e.v.id === 'scu:fix1'), 'l\'offerta non diventa un ritiro');
  const v = idx.byId.get('scu:pool3');
  assert.equal(v.ops.find((o) => o.role === 'pickup').fixed, false);
  assert.ok(!plannable(v).ok && plannable(v).missing[0].includes(TO_CONFIRM));
  const u = userViews([userC({ offerZone: 'Stazione Charlie', movements: [{ scu: 10, from: null, to: 'Base Bravo' }] })], geo)[0];
  assert.equal(u.offer[0].id, 'sc');
  assert.equal(u.ops.find((o) => o.role === 'pickup').ids.length, 0, 'ritiro sconosciuto: non copiato dall\'offerta');
});

test('7. località sconosciute: coda di normalizzazione, nessuna associazione', () => {
  const unk = CAT.missions.find((m) => m.id === 'scu:unk');
  const pk = unk.pools.find((p) => p.role === 'pickup');
  assert.equal(pk.ids.length, 0); assert.equal(pk.anonymous, 1); assert.deepEqual(pk.unresolved.map((i) => CAT.names[i]), ['Lobby']);
  const amb = CAT.missions.find((m) => m.id === 'scu:amb').pools.find((p) => p.role === 'pickup');
  assert.equal(amb.ids.length, 0); assert.deepEqual(amb.ambiguous.map((i) => CAT.names[i]), ['Gemella']);
  const ambS = CAT.missions.find((m) => m.id === 'scu:ambS').pools.find((p) => p.role === 'pickup');
  assert.deepEqual(ambS.ids.map((i) => CAT.places[i]), ['g1'], 'col sistema noto il nome si risolve nel sistema giusto');
  const q = new Map();
  schpViews({ entries: [{ id: 'schp:x', systems: ['stanton'], offerZones: [], movements: [{ cargo: 'X', scu: 5, from: { names: ['Posto Ignoto'] }, to: { names: ['Base Bravo'] } }] }] }, geo, q);
  const all = normalizationQueue(CAT, q).map((x) => x.name);
  for (const n of ['Lobby', 'Luogo Inesistente', 'Gemella', 'Posto Ignoto']) assert.ok(all.includes(n), n);
});

test('8. visualizzazione delle rotte: stili, numerazione, nessun segmento fra sistemi', () => {
  const { idx } = mk([userC({ title: 'Mio', movements: [{ scu: 20, from: 'Base Alfa', to: 'Stazione Charlie' }] })]);
  const mine = idx.views.find((v) => v.origin === 'utente');
  assert.deepEqual(missionSegments(mine, geo, 'stanton').map((s) => s.style), ['confermata']);
  const segs = missionSegments(idx.byId.get('scu:fix1'), geo, 'stanton');
  assert.deepEqual(segs.map((s) => s.style).sort(), ['ipotetica', 'offerta'], 'ritiro→consegna ipotetico + offerta→primo ritiro (luoghi diversi)');
  assert.ok(segs.every((s) => s.style !== 'confermata'), 'un modello di catalogo non e\' mai confermato');
  const pool = missionSegments(idx.byId.get('scu:pool3'), geo, 'stanton');
  assert.ok(pool.length === 3 && pool.every((s) => s.style === 'nonverificata'));
  const cross = userViews([userC({ movements: [{ scu: 5, from: 'Base Alfa', to: 'Base Pyro' }] })], geo)[0];
  assert.equal(missionSegments(cross, geo, 'stanton').length, 0, 'nessuna linea interstellare');
  const r = evaluateStack([mine], ctx());
  const plan = planFromStack(r, { capacity: 240, start: { id: 'sc', name: 'Stazione Charlie' } });
  assert.deepEqual(stopsOf(plan.seq).map((s) => s.place.id), ['ba', 'sc']);
});

test('9. nessun collegamento geografico inventato', () => {
  const { idx } = mk();
  const conn = idx.connections('ba');
  for (const c of conn) assert.ok(idx.views.some((v) => c.missions.includes(v.id) && v.ops.some((o) => o.role === 'pickup' && o.ids.includes(c.from)) && v.ops.some((o) => o.role === 'dropoff' && o.ids.includes(c.to))));
  assert.ok(conn.some((c) => c.to === 'sc' && c.fixed >= 1));
  const fromB = idx.connections('bb').find((c) => c.to === 'sc');
  assert.ok(fromB && fromB.fixed === 0 && fromB.possible >= 1, 'Bravo→Charlie esiste solo in un pool (pool3): possibile, mai fisso');
  const leg = geoLegOf(geo)({ id: 'ba' }, { id: 'pb' });
  assert.equal(leg.distance, null); assert.equal(leg.interstellar, true);
  assert.equal(geo.distance('ba', 'pb'), null, 'nessuna distanza euclidea fra sistemi');
  assert.equal(idx.connections('ba', { maxAlternatives: 1 }).some((c) => c.possible), false, 'filtro: niente collegamenti da pool');
});

test('10. compatibilita\' delle missioni accumulabili: tipologie e classi', () => {
  const a = userViews([userC({ title: 'A', movements: [{ scu: 80, from: 'Base Alfa', to: 'Stazione Charlie' }] })], geo)[0];
  const b = userViews([userC({ title: 'B', status: 'confermata', movements: [{ scu: 100, from: 'Base Alfa', to: 'SYN-L1 Stazione Echo' }] })], geo)[0];
  const c = userViews([userC({ title: 'C', status: 'confermata', movements: [{ scu: 50, from: 'Stazione Charlie', to: 'Base Alfa' }] })], geo)[0];
  const t = (x, y) => stackTypes(x, y, geo).map((s) => s.type).sort();
  assert.deepEqual(t(a, b), ['multi_dropoff', 'same_pickup']);
  assert.deepEqual(t(a, c), ['return_trip']);
  const { idx } = mk();
  assert.ok(stackTypes(idx.byId.get('scu:pool3'), idx.byId.get('scu:fix1'), geo).some((s) => s.type === 'same_dropoff' && s.sure));
  assert.equal(evaluateStack([a], ctx()).cls, 'eseguibile');
  assert.equal(evaluateStack([a, b], ctx()).cls, 'potenziale');
  assert.equal(evaluateStack([a, idx.byId.get('scu:pool3')], ctx()).cls, 'verificare');
  const sug = suggestStack([a], idx, ctx());
  assert.ok(sug.length && sug.every((x) => x.types.length));
});

test('11. vincoli di capienza dopo ogni ritiro e scarico (esempio 240 SCU)', () => {
  const v = userViews([
    userC({ title: 'A', movements: [{ scu: 80, from: 'Base Alfa', to: 'Base Bravo' }] }),
    userC({ title: 'B', movements: [{ scu: 100, from: 'Base Alfa', to: 'Stazione Charlie' }] }),
    userC({ title: 'D', movements: [{ scu: 120, from: 'Base Bravo', to: 'Stazione Charlie' }] }),
  ], geo);
  const r = evaluateStack(v, ctx({ start: 'ba' }));
  assert.equal(r.cls, 'eseguibile');
  assert.ok(r.metrics.peak <= 240);
  assert.equal(r.metrics.peak, 220, 'ritiro A+B (180), scarico A, ritiro D: picco 220');
  const big = userViews([userC({ movements: [{ scu: 300, from: 'Base Alfa', to: 'Base Bravo' }] })], geo);
  const rb = evaluateStack(big, ctx());
  assert.ok(rb.route && rb.metrics.peak <= 240 && rb.warnings.some((w) => /più viaggi/.test(w)));
});

test('12. consegne sempre dopo i ritiri, anche riordinando a mano', () => {
  const v = userViews([userC({ movements: [{ scu: 30, from: 'Base Alfa', to: 'Stazione Charlie' }, { scu: 20, from: 'Base Bravo', to: 'Stazione Charlie' }] })], geo);
  const r = evaluateStack(v, ctx());
  assert.ok(validateSequence(r.route.seq, { capacity: 240 }).ok);
  const plan = planFromStack(r, { capacity: 240 });
  const st = stopsOf(plan.seq).map((s) => s.place.id);
  const last = st.indexOf('sc');
  const bad = moveStop(plan, last, 0);
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /prima del ritiro/);
  const swap = moveStop(plan, 0, 1);
  assert.equal(swap.ok, true, 'scambiare i due ritiri e\' ammesso');
});

test('13. piu\' ritiri e piu\' consegne in un solo contratto', () => {
  const c = userC({ movements: [
    { id: 'a', scu: 30, from: 'Base Alfa', to: 'Stazione Charlie' }, { id: 'b', scu: 20, from: 'Base Bravo', to: 'Stazione Charlie' },
    { id: 'c', scu: 10, from: 'Base Alfa', to: 'SYN-L1 Stazione Echo' }] });
  const v = userViews([c], geo)[0];
  assert.equal(v.ops.filter((o) => o.role === 'pickup').length, 3);
  const r = evaluateStack([v], ctx());
  assert.equal(r.metrics.pickups, 3); assert.equal(r.metrics.dropoffs, 3);
  const man = manifestOf(planFromStack(r, { capacity: 240 }));
  const delivered = man.stops.flatMap((s) => s.ops).filter((o) => o.type === 'scarico').reduce((s, o) => s + o.qty, 0);
  assert.equal(delivered, 60, 'nessun carico contato due volte');
});

test('14. container: casse oltre la cassa massima della nave = incompatibile', () => {
  const v = userViews([userC({ movements: [{ scu: 64, containerMax: 64, from: 'Base Alfa', to: 'Base Bravo' }] })], geo);
  const r = evaluateStack(v, ctx());
  assert.equal(r.cls, 'incompatibile'); assert.match(r.reasons[0], /cassa massima/);
  const ok = evaluateStack(userViews([userC({ movements: [{ scu: 64, containerMax: 32, from: 'Base Alfa', to: 'Base Bravo' }] })], geo), ctx());
  assert.equal(ok.cls, 'eseguibile');
  assert.ok(manifestOf(planFromStack(ok, { capacity: 240, ship: SHIPS['rsi-constellation-mk5-centaurus'] })).limits.some((l) => /Compatibilità fisica non verificata/.test(l)));
  const fix = CAT.missions.find((m) => m.id === 'scu:fix1');
  assert.equal(fix.orders[0].containerMax, 16);
});

test('15. reputazione e requisiti', () => {
  const { idx } = mk();
  const fix = idx.byId.get('scu:fix1');
  assert.equal(fix.rankIndex, 1);
  assert.equal(evaluateStack([fix], ctx({ ranks: { 'Compagnia Sintetica': 0 } })).cls, 'incompatibile');
  assert.notEqual(evaluateStack([fix], ctx({ ranks: { 'Compagnia Sintetica': 2 } })).cls, 'incompatibile');
  assert.equal(idx.forPlace('ba', { maxRank: 0 }).out.length, 0, 'filtro grado massimo');
});

test('16. offerte teoriche separate dai contratti reali', () => {
  const { idx } = mk();
  const fix = idx.byId.get('scu:fix1');
  const r = evaluateStack([fix], ctx());
  assert.equal(r.cls, 'potenziale', 'un modello di catalogo non e\' mai eseguibile');
  assert.ok(r.assumed.some((a) => /massimo del modello/.test(a)));
  assert.equal(r.metrics.rewardAccepted, 0); assert.equal(r.metrics.rewardUnconfirmed, 30000);
  const order = idx.forPlace('ba').out.map((e) => e.v.origin);
  assert.ok(order.every((o) => o === 'catalogo'));
  const withUser = mk([userC({ movements: [{ scu: 5, from: 'Base Alfa', to: 'Base Bravo' }] })]).idx.forPlace('ba').out;
  assert.equal(withUser[0].v.origin, 'utente', 'i contratti reali vengono prima');
});

test('17. ricalcolo quando un contratto viene rimosso', () => {
  const a = userC({ title: 'A', movements: [{ scu: 100, from: 'Base Alfa', to: 'Stazione Charlie' }] });
  const b = userC({ title: 'B', movements: [{ scu: 100, from: 'Base Bravo', to: 'Stazione Charlie' }] });
  const both = evaluateStack(userViews([a, b], geo), ctx());
  const one = evaluateStack(userViews([a], geo), ctx());
  assert.equal(both.metrics.peak, 200); assert.equal(one.metrics.peak, 100);
  assert.ok(one.metrics.distance < both.metrics.distance);
  const { idx } = mk([a, b]);
  const best = bestStack('ba', idx, ctx());
  assert.equal(best.mandatory.length, 2, 'i contratti accettati restano sempre nel piano');
  const { idx: idx2 } = mk([a]);
  assert.equal(bestStack('ba', idx2, ctx()).mandatory.length, 1);
});

test('18. backup e ripristino completi (piani e screenshot compresi)', () => {
  const r = evaluateStack(userViews([userC({ movements: [{ scu: 5, from: 'Base Alfa', to: 'Base Bravo' }] })], geo), ctx());
  const plan = planFromStack(r, { capacity: 240 });
  const shot = { id: 's1', contractId: 'x', name: 'mobi.png', type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', at: '2026-11-08T10:00:00Z' };
  const bad = { id: 's2', dataUrl: 'javascript:alert(1)' };
  const json = JSON.stringify(exportFull({ points: [{ id: 'p1' }], contracts: [], observations: [], plans: [plan], attachments: [shot, bad] }));
  const back = parseBackup(json);
  assert.equal(back.plans.length, 1); assert.deepEqual(back.plans[0].seq, plan.seq);
  assert.deepEqual(back.attachments.map((a) => a.id), ['s1'], 'solo immagini');
  assert.equal(back.points.length, 1);
});

test('19. persistenza IndexedDB: v2 aggiunge piani e allegati senza toccare i dati v1', async () => {
  const name = 'navcom-logistics';
  await new Promise((res, rej) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = res; r.onerror = rej; });
  await new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('contracts', { keyPath: 'id' }); d.createObjectStore('observations', { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => { const d = r.result; const tx = d.transaction('contracts', 'readwrite'); tx.objectStore('contracts').put({ id: 'vecchio', title: 'dal v1' }); tx.oncomplete = () => { d.close(); res(); }; };
    r.onerror = rej;
  });
  const db = await LogisticsDB.open();
  assert.equal(db.persistent, true);
  assert.deepEqual((await db.contracts()).map((c) => c.id), ['vecchio']);
  await db.putPlans([{ id: 'pl1', seq: [], contracts: [] }]);
  await db.putAttachments([{ id: 'a1', dataUrl: 'data:image/png;base64,AA' }]);
  db.close();
  const db2 = await LogisticsDB.open();
  assert.deepEqual((await db2.plans()).map((p) => p.id), ['pl1']);
  assert.deepEqual((await db2.attachments()).map((p) => p.id), ['a1']);
  db2.close();
});

test('20. funzionamento offline: cache del service worker e copie locali', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/ui-atlas.js', import.meta.url), 'utf8');
  const swCache = /const CACHE = '([^']+)'/.exec(sw)[1], appCache = /const CACHE_NAME = '([^']+)'/.exec(app)[1];
  assert.equal(swCache, appCache, 'stesso nome di cache in sw.js e app.js');
  assert.match(sw, /caches\.match\(req/, 'senza rete il service worker risponde dalla cache');
  assert.match(ui, /atlasSnapshot/, 'ultima copia valida dell\'atlante in IndexedDB');
  assert.match(ui, /geoFromCitizenHQ/, 'ripiego sulle posizioni CitizenHQ gia\' importate');
  const snap = { meta: { patch: '9.9' }, places: PLACES, connections: [] };
  assert.equal(geoFromSnapshot(JSON.parse(JSON.stringify(snap))).places.length, PLACES.length, 'lo snapshot salvato ricostruisce l\'atlante');
});

test('21. fallback 2D: vista ortogonale dall\'alto senza WebGL', () => {
  const cam = camera({ target: P0, dist: 4 * GM, pitch: 89.9 * DEG, ortho: true });
  const P = projector(cam, 800, 600);
  const a = P.project(geo.get('sc').pos), b = P.project(geo.get('se').pos);
  assert.ok(a.visible && b.visible && Number.isFinite(a.x) && Number.isFinite(b.y));
  const dpx = Math.hypot(a.x - b.x, a.y - b.y), dm = Math.hypot(1 * GM, 2 * GM);
  assert.ok(Math.abs(dpx * P.metersPerPixel() - dm) / dm < 0.01, 'in 2D la scala e\' uniforme');
  const r = readFileSync(new URL('../js/atlas/render.js', import.meta.url), 'utf8');
  assert.match(r, /getContext\('2d'\)/); assert.doesNotMatch(r, /getContext\(['"](webgl|experimental-webgl)/i);
});

test('22. prestazioni con migliaia di luoghi e missioni', () => {
  const rows = [row('S', 'STAR', 'Star', null, { x: 0, y: 0, z: 0 })];
  for (let i = 0; i < 5000; i++) rows.push(row(`o${i}`, `Luogo ${i}`, i % 5 ? 'Outpost' : 'Manmade', 'S', { x: Math.cos(i) * (1 + i) * 1e7, y: Math.sin(i) * (1 + i) * 1e7, z: (i % 7) * 1e6 }));
  const places = normalizePlaces(rows, { source: 'sintetico' });
  const g = new Geo(places);
  const contracts = [];
  for (let k = 0; k < 3000; k++) contracts.push(contract(`m${k}`, { pick: [`Luogo ${k % 5000}`, `Luogo ${(k * 7) % 5000}`], drop: [`Luogo ${(k * 13 + 1) % 5000}`], offer: [`o${k % 5000}`] }));
  let t = performance.now();
  const cat = buildMissionCatalog(contracts, places, { geo: g });
  const idx = new MissionIndex(catalogViews(cat), g);
  const tBuild = performance.now() - t;
  t = performance.now();
  const P = projector(camera({ dist: 1e11 }), 1600, 900);
  const pts = places.map((p) => { const q = P.project(p.pos); return { id: p.id, x: q.x, y: q.y, depth: q.depth, priority: 50 }; });
  const cl = cluster(pts);
  const tDraw = performance.now() - t;
  t = performance.now(); const r = idx.forPlace('o42'); idx.connections('o42'); const tQuery = performance.now() - t;
  assert.equal(cat.missions.length, 3000); assert.ok(r.out.length > 0); assert.ok(cl.length < pts.length);
  assert.ok(tBuild < 5000, `catalogo e indice: ${tBuild.toFixed(0)} ms`);
  assert.ok(tDraw < 500, `proiezione e raggruppamento: ${tDraw.toFixed(0)} ms`);
  assert.ok(tQuery < 500, `scheda e collegamenti: ${tQuery.toFixed(0)} ms`);
});

test('23. cambio della patch: dati separati e filtrati', () => {
  const obs = [
    normalizeObservation({ place: 'Base Alfa', system: 'stanton', patch: '9.9.0', outcome: 'nessuna', at: '2026-11-01T10:00:00Z' }).observation,
    normalizeObservation({ place: 'Base Alfa', system: 'stanton', patch: '9.8.1', outcome: 'presente', title: 'X', at: '2026-10-01T10:00:00Z' }).observation,
  ];
  const st = placeStats(obs, { currentPatch: '9.9.2' });
  assert.equal(st.current.visits, 1); assert.equal(st.previous.visits, 1, 'la patch precedente resta, separata');
  const { idx } = mk();
  assert.ok(idx.forPlace('ba', { patch: '9.9' }).out.length > 0);
  assert.equal(idx.forPlace('ba', { patch: '9.8' }).out.length, 0);
  assert.equal(levelOf(placeStats(obs.slice(1), { currentPatch: '9.9.2' }), []), 'obsoleta');
});

test('24. aggiornamento delle osservazioni e Discovery deterministico', () => {
  const { idx } = mk();
  const base = { geo, index: idx, currentPatch: '9.9.0', now: '2026-11-08T12:00:00Z', from: 'sc' };
  const before = discoveryScore('ba', { ...base, obsByPlace: new Map() });
  assert.equal(before.level, 'mai');
  assert.equal(discoveryScore('ba', { ...base, obsByPlace: new Map() }).score, before.score, 'stesso input, stesso punteggio');
  assert.ok(before.parts.every((p) => typeof p.text === 'string' && p.text.length), 'ogni componente e\' spiegata');
  const obs = [normalizeObservation({ place: 'Base Alfa', system: 'stanton', patch: '9.9.0', outcome: 'nessuna', at: '2026-11-08T11:00:00Z' }).observation];
  const after = discoveryScore('ba', { ...base, obsByPlace: observationsByPlace(obs, geo) });
  assert.equal(after.level, 'parziale'); assert.ok(after.score < before.score, 'una base appena verificata scende in classifica');
  const rank = rankDiscovery({ ...base, obsByPlace: new Map() }, { system: 'stanton' });
  assert.deepEqual(rank.map((r) => r.place.id), rankDiscovery({ ...base, obsByPlace: new Map() }, { system: 'stanton' }).map((r) => r.place.id));
  assert.equal(placeStats([], {}).current.sample, 'campione insufficiente');
});

test('25. regressione: moduli esistenti invariati e nuove funzioni additive', () => {
  // i test delle funzioni NAVCOM esistenti girano nello stesso comando (node --test tests/*.test.mjs);
  // qui si verifica che l'atlante non tocchi i dati del DATABASE PUNTI e del resto dell'app
  const ui = readFileSync(new URL('../js/ui-atlas.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /pdb\.(put|delete|clear)/, 'l\'atlante legge i punti personali, non li modifica');
  assert.doesNotMatch(ui, /store\.(replaceLocations|addCustomPoint|delete)/, 'nessuna modifica alle posizioni importate');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const t of ['plan', 'db', 'reverse', 'route', 'halo', 'points', 'saved', 'logistics', 'data']) assert.match(html, new RegExp(`data-tab="${t}"`));
  assert.equal(cleanTitle('<= UNINITIALIZED =>', {}, 'fallback'), 'fallback');
  assert.equal(cleanTitle('~mission(Rank) Hauler', { Rank: ['Rookie'] }), 'Rookie Hauler');
  const ships = buildShips([{ Name: 'Nave', ClassName: 'NAVE_A', Cargo: 64, CargoGrids: [{ SCU: 64, X: 2.5, Y: 5, Z: 2.5, MaxSize: { X: 2.5, Y: 5, Z: 2.5 } }] }, { Name: 'Nave', ClassName: 'NAVE_A_Display', Cargo: 64 }, { Name: 'Caccia', ClassName: 'C', Cargo: 0 }]);
  assert.deepEqual(ships.map((s) => s.id), ['NAVE_A']);
  assert.equal(findDuplicates([userC({ id: 'x1', movements: [{ scu: 5, from: 'Base Alfa', to: 'Base Bravo' }] }), userC({ id: 'x2', movements: [{ scu: 5, from: 'Base Alfa', to: 'Base Bravo' }] })]).length, 1);
  assert.equal(toPlanning(catalogViews(CAT).find((v) => v.id === 'scu:multi'), geo).ok, false, 'modello con piu\' consegne: abbinamento merce-luogo non inventato');
  assert.ok(measure([], geoLegOf(geo)).stops === 0);
});

// =====================================================================================
// 0.7.1 LOCATION INTELLIGENCE ESTESA: ricerca geografica, evidenze, destinazione, stacking.
// Secondo mondo SINTETICO: pianeta "Arco" con luna "Vala" (basi 061, 045 e 20 basi di pool),
// pianeta "Micro" con basi, un sistema pyro sintetico. Nessun dato reale.
import { hierarchy, relation, LEVELS as XL, NO_LINK, OMITTED, expandedSegments, destinationSet } from '../js/atlas/expanded.js';
import { exploratoryStack, STACK_MODES } from '../js/atlas/stack.js';

const W = (() => {
  const A0 = { x: 20 * GM, y: 0, z: 0 }, V0 = { x: 20 * GM + 6e7, y: 0, z: 0 }, M0 = { x: -15 * GM, y: 5 * GM, z: 0 };
  const rows = [
    row('S2', 'STAR2', 'Star', null, { x: 0, y: 0, z: 0 }),
    row('arc', 'Arco', 'Planet', 'S2', A0),
    row('vala', 'Vala', 'Moon', 'arc', V0),
    row('a061', 'Area 061', 'Outpost', 'vala', { x: V0.x + 3e5, y: 0, z: 0 }),
    row('a045', 'Area 045', 'Outpost', 'vala', { x: V0.x, y: 3e5, z: 0 }),
    row('a18', 'Citta Arco', 'LandingZone', 'arc', { x: A0.x + 1e6, y: 0, z: 0 }),
    row('mic', 'Micro', 'Planet', 'S2', M0),
    row('mb1', 'Base Micro', 'Outpost', 'mic', { x: M0.x + 1e6, y: 0, z: 0 }),
    row('mb2', 'Seconda Micro', 'Outpost', 'mic', { x: M0.x, y: 1e6, z: 0 }),
    row('p2', 'STAR3', 'Star', null, { x: 0, y: 0, z: 0 }, 'pyro'),
    row('pyb', 'Rifugio Pyro', 'Outpost', 'p2', { x: 4 * GM, y: 0, z: 0 }, 'pyro'),
  ];
  for (let i = 0; i < 19; i++) rows.push(row(`pool${i}`, `Pozzo ${i}`, 'Outpost', 'vala', { x: V0.x - 3e5, y: i * 1e4, z: 0 }));
  const places = normalizePlaces(rows, { source: 'sintetico', patch: '9.9.0' });
  for (const p of places) { if (p.id === 'vala') p.radius = 3e5; if (p.id === 'arc') p.radius = 1e6; if (p.id === 'mic') p.radius = 1e6; }
  const g = new Geo(places);
  const twenty = ['Area 061', ...Array.from({ length: 19 }, (_, i) => `Pozzo ${i}`)];
  const C = [
    contract('w-fix', { pick: ['Area 061'], drop: ['Citta Arco'], offer: ['a061'] }),                      // 1 certo, stesso pianeta
    contract('w-pool20', { pick: twenty, drop: ['Citta Arco'], offer: ['vala'] }),                       // 2 possibile (20 alternative)
    contract('w-moon', { pick: ['Vala'], drop: ['Citta Arco'], offer: ['vala'] }),                       // 3 regionale: il pool nomina la luna
    contract('w-offer', { pick: ['Pozzo 3', 'Pozzo 4'], drop: ['Base Micro'], offer: ['vala'] }),        // 3b regionale da offerta sulla luna
    contract('w-other', { pick: ['Area 045'], drop: ['Citta Arco'], offer: ['a045'] }),                  // 4 altra base della luna
    contract('w-inter', { pick: ['Area 061'], drop: ['Base Micro'], offer: ['a061'], rank: 2 }),         // 5 interplanetaria certa
    contract('w-stellar', { pick: ['Area 061'], drop: ['Rifugio Pyro'], offer: ['a061'] }),              // 6 interstellare
    contract('w-dyn', { pick: ['Area 061'], drop: [null, 'Luogo Dinamico'], offer: ['a061'] }),          // 7 destinazione dinamica
    contract('w-other2', { pick: ['Seconda Micro'], drop: ['Base Micro'], offer: ['mic'] }),             // 9 contratto diverso verso Micro
    contract('w-chain', { pick: ['Citta Arco'], drop: ['Seconda Micro'], offer: ['a18'] }),              // 9b seconda tratta documentata
    contract('w-both', { pick: ['Area 061'], drop: ['Area 061', 'Pozzo 1', 'Pozzo 2'], offer: ['a061'], order: { Name: 'X', MinScu: 10, MaxScu: 20, MaxContainerSize: 8 } }), // 10 certo + possibile
  ];
  C.find((c) => c.UUID === 'w-inter').MissionGiver = 'Altra Compagnia';
  const cat = buildMissionCatalog(C, places, { patch: '9.9.0-LIVE.1', geo: g });
  return { g, places, cat };
})();
const wIdx = (contracts = [], extra = {}) => { const q = new Map(); const views = [...userViews(contracts, W.g, q), ...catalogViews(W.cat)]; return new MissionIndex(views, W.g); };
const wUser = (over) => { const r = normalizeContract({ system: 'stanton', patch: '9.9.0', status: 'accettata', reward: 10000, title: 'Contratto', company: 'Compagnia Sintetica', ...over }); assert.ok(r.contract, r.errors.join('; ')); return r.contract; };
const ids = (rows) => [...new Set(rows.map((r) => r.v.id))].sort();
const POSS = { mode: 'possibili' };

test('LI-1. ritiro esatto nella base selezionata: CERTO, ritiro e consegna distinti', () => {
  const x = wIdx().forPlaceExpanded('a061', {}, POSS);
  assert.ok(ids(x.sections.certainOut).includes('scu:w-fix'));
  assert.ok(!ids(x.sections.certainIn).includes('scu:w-fix'), 'il ritiro non diventa consegna');
  const r = x.sections.certainOut.find((r) => r.v.id === 'scu:w-fix');
  assert.equal(r.level, 'certo'); assert.equal(r.role, 'pickup'); assert.match(r.reason, /punto fisso/);
  assert.deepEqual(hierarchy(W.g, 'a061') && [hierarchy(W.g, 'a061').moon.name, hierarchy(W.g, 'a061').planet.name, hierarchy(W.g, 'a061').system], ['Vala', 'Arco', 'stanton']);
});

test('LI-2. base fra 20 alternative: POSSIBILE con numero di alternative, mai certa', () => {
  const x = wIdx().forPlaceExpanded('a061', {}, POSS);
  const r = x.sections.possibleOut.find((r) => r.v.id === 'scu:w-pool20');
  assert.ok(r); assert.equal(r.alternatives, 20); assert.equal(r.level, 'possibile');
  assert.match(r.reason, /IL GIOCO ASSEGNA IL LUOGO EFFETTIVO/);
  assert.ok(!ids([...x.sections.certainOut, ...x.sections.certainIn]).includes('scu:w-pool20'));
  assert.equal(r.v.patch, '9.9.0-LIVE.1'); assert.ok(r.v.source);
});

test('LI-3. missione associata alla luna e non a una base: REGIONALE, separata', () => {
  const x = wIdx().forPlaceExpanded('a061', {}, POSS);
  const reg = x.sections.regional.luna.find((r) => r.v.id === 'scu:w-moon');
  assert.ok(reg, 'pool che nomina Vala'); assert.equal(reg.level, 'regionale'); assert.equal(reg.anchor.id, 'vala');
  assert.match(reg.reason, /BASE SPECIFICA NON CONFERMATA/);
  const off = x.sections.offersArea.find((r) => r.v.id === 'scu:w-offer');
  assert.ok(off && off.via === 'offerta' && off.bucket === 'luna', 'offerta sulla luna = regionale');
  assert.equal(x.sections.regional.pianeta.length, 0, 'nessun contratto nomina il pianeta Arco');
});

test('LI-4. missione di un\'altra base della stessa luna: ALTRE BASI, non contata qui', () => {
  const x = wIdx().forPlaceExpanded('a061', {}, POSS);
  const g = x.sections.otherBases.luna.find((g) => g.place.id === 'a045');
  assert.ok(g && ids(g.rows).includes('scu:w-other'));
  const mine = [...x.sections.certainOut, ...x.sections.certainIn, ...x.sections.possibleOut, ...x.sections.possibleIn, ...x.sections.regional.luna, ...x.sections.offersArea];
  assert.ok(!ids(mine).includes('scu:w-other'));
  assert.equal(x.unique.otherBases >= 1, true);
  assert.ok(!(x.unique.total > ids(mine).length), 'il totale della base non include le altre basi');
});

test('LI-5. missione interplanetaria Arco → Micro (stesso contratto)', () => {
  const idx = wIdx();
  const x = idx.forPlaceExpanded('a061', {}, POSS);
  assert.ok(ids(x.sections.interplanetary).includes('scu:w-inter'));
  assert.equal(relation(W.g, 'a061', 'mb1'), 'interplanetaria'); assert.equal(relation(W.g, 'a061', 'a045'), 'luna'); assert.equal(relation(W.g, 'a061', 'a18'), 'pianeta');
  const d = idx.forDestination('a061', { id: 'mic' });
  const hit = d.results.find((r) => r.v.id === 'scu:w-inter');
  assert.equal(hit.evidence, 'certo'); assert.deepEqual(hit.hits, ['mb1']);
  assert.equal(destinationSet(W.g, { id: 'mic' }).ids.size, 3, 'il pianeta include le sue località, distinte');
  const sc = idx.forPlaceExpanded('a061', {}, { ...POSS, scope: 'interplanetaria' });
  assert.ok(ids(sc.sections.certainOut).includes('scu:w-inter') && !ids(sc.sections.certainOut).includes('scu:w-fix'), 'filtro "tra pianeti" sulla gerarchia reale');
});

test('LI-6. missione interstellare Stanton → Pyro: distinta, nessuna linea fra sistemi', () => {
  const idx = wIdx();
  const x = idx.forPlaceExpanded('a061', {}, POSS);
  assert.ok(ids(x.sections.interstellar).includes('scu:w-stellar'));
  assert.ok(!ids(x.sections.interplanetary).includes('scu:w-stellar'));
  const seg = expandedSegments(x, W.g, 'stanton', { force: new Set(['scu:w-stellar']) });
  assert.ok(!seg.segments.some((s) => s.mission === 'scu:w-stellar'), 'nessuna linea interstellare');
  const d = idx.forDestination('a061', { system: 'pyro' });
  assert.ok(d.interstellar); assert.deepEqual(d.results.map((r) => r.v.id), ['scu:w-stellar']);
});

test('LI-7. destinazione dinamica sconosciuta: resta SCONOSCIUTA, mai assegnata', () => {
  const idx = wIdx();
  const x = idx.forPlaceExpanded('a061', {}, POSS);
  const r = x.sections.certainOut.find((r) => r.v.id === 'scu:w-dyn');
  assert.ok(r.link.unknown >= 1 && !r.link.ids, 'altro capo non risolto');
  for (const dest of [{ id: 'mic' }, { id: 'arc' }, { system: 'pyro' }]) assert.ok(!idx.forDestination('a061', dest).results.some((x) => x.v.id === 'scu:w-dyn'), 'nessuna destinazione inventata');
  assert.ok(x.diagnostics.unresolvedNames.some(([n]) => n === 'Luogo Dinamico'));
  assert.equal(XL.sconosciuto.label, 'SCONOSCIUTO');
});

test('LI-8. nessuna falsa promozione da regionale a certa', () => {
  const idx = wIdx();
  const x = idx.forPlaceExpanded('a061', {}, POSS);
  const certain = ids([...x.sections.certainOut, ...x.sections.certainIn]), possible = ids([...x.sections.possibleOut, ...x.sections.possibleIn]);
  for (const id of ['scu:w-moon', 'scu:w-offer']) { assert.ok(!certain.includes(id)); assert.ok(!possible.includes(id)); }
  const v = idx.forPlaceExpanded('a061', {}, { mode: 'verificate' });
  assert.equal(v.sections.regional.luna.length + v.sections.offersArea.length + v.sections.possibleOut.length, 0, 'VERIFICATE: solo certezze');
  assert.ok(v.diagnostics.hiddenByMode >= 3);
  const d = idx.forDestination('a061', { id: 'mic' });
  assert.equal(d.results.find((r) => r.v.id === 'scu:w-offer')?.evidence, 'regionale');
  assert.ok(!plannable(idx.byId.get('scu:w-moon')).ok, 'una regionale non e\' pianificabile');
});

test('LI-9. nessun collegamento costruito combinando contratti diversi', () => {
  const idx = wIdx();
  const d = idx.forDestination('a061', { id: 'mic' });
  for (const r of d.results) assert.ok(r.v.ops.some((o) => o.role === 'dropoff' && o.ids.some((id) => ['mic', 'mb1', 'mb2'].includes(id))), r.v.id);
  assert.ok(!d.results.some((r) => r.v.id === 'scu:w-other2' || r.v.id === 'scu:w-chain'), 'contratti che non partono dall\'origine non entrano');
  const ch = d.chains.find((c) => c.via.id === 'a18');
  assert.ok(ch, 'tratta intermedia documentata via Citta Arco');
  assert.ok(ch.first.every((x) => x.v.id !== ch.second[0].v.id), 'due contratti distinti, dichiarati come sequenza');
  const none = idx.forDestination('a045', { system: 'pyro' });
  assert.equal(none.results.length, 0); assert.equal(none.none, NO_LINK); assert.match(none.noneNote, /non significa/i);
});

test('LI-10. nessuna duplicazione nei riepiloghi', () => {
  const x = wIdx().forPlaceExpanded('a061', {}, POSS);
  const both = 'scu:w-both';
  assert.ok(ids(x.sections.certainOut).includes(both)); assert.ok(ids(x.sections.possibleIn).includes(both), 'stessa missione in due ruoli');
  const all = [...x.sections.certainOut, ...x.sections.certainIn, ...x.sections.possibleOut, ...x.sections.possibleIn, ...x.sections.regional.luna, ...x.sections.regional.pianeta, ...x.sections.offersArea];
  assert.equal(x.unique.total, new Set(all.map((r) => r.v.id)).size);
  assert.equal(x.unique.certain + x.unique.possible + x.unique.regional, x.unique.total, 'ogni missione contata una volta sola');
  assert.ok(!ids(x.sections.offersArea).includes('scu:w-fix'), 'offerta qui ma gia\' certa: non ripetuta');
});

test('LI-11. missioni in elenco anche quando la mappa omette le linee', () => {
  const idx = wIdx();
  const x = idx.forPlaceExpanded('a061', {}, { ...POSS, maxDraw: 10 });
  const r = x.sections.possibleOut.find((r) => r.v.id === 'scu:w-pool20');
  assert.equal(r.drawable, false);
  const seg = expandedSegments(x, W.g, 'stanton');
  assert.ok(seg.omitted >= 1 && !seg.segments.some((s) => s.mission === 'scu:w-pool20'));
  const forced = expandedSegments(x, W.g, 'stanton', { force: new Set(['scu:w-pool20']) });
  assert.ok(forced.segments.some((s) => s.mission === 'scu:w-pool20' && s.style === 'nonverificata'), 'espansione su richiesta');
  const cs = idx.connectionsSplit('a061', {}, 10);
  assert.ok(cs.omitted.some((o) => o.v.id === 'scu:w-pool20')); assert.ok(cs.found > cs.drawn);
  assert.match(OMITTED, /collegamenti grafici omessi/);
  assert.ok(x.diagnostics.notDrawn >= 1);
});

test('LI-12. filtri per patch, compagnia e reputazione', () => {
  const idx = wIdx();
  const comp = idx.forPlaceExpanded('a061', { company: 'Altra Compagnia' }, POSS);
  assert.deepEqual(ids(comp.sections.certainOut), ['scu:w-inter']);
  const rank = idx.forPlaceExpanded('a061', { maxRank: 1 }, POSS);
  assert.ok(!ids(rank.sections.certainOut).includes('scu:w-inter') && rank.diagnostics.filteredOut >= 1);
  const patch = idx.forPlaceExpanded('a061', { patch: '9.8' }, POSS);
  assert.equal(patch.unique.total, 0); assert.ok(patch.diagnostics.filteredOut > 0);
  assert.ok(patch.diagnostics.why.some((w) => /filtri/.test(w)), 'la diagnostica spiega lo zero');
});

test('LI-13. EXECUTIVE STACK: solo dati verificati, vincoli di carico rispettati', () => {
  const u1 = wUser({ title: 'Mio 1', movements: [{ scu: 120, from: 'Area 061', to: 'Citta Arco', containerMax: 16 }] });
  const u2 = wUser({ title: 'Mio 2', status: 'confermata', movements: [{ scu: 100, from: 'Area 061', to: 'Base Micro', containerMax: 16 }] });
  const idx = wIdx([u1, u2]);
  const c = { geo: W.g, capacity: 240, ship: SHIPS['rsi-constellation-mk5-centaurus'], ranks: {}, start: 'a061' };
  const b = bestStack('a061', idx, c, { mode: 'executive' });
  assert.equal(b.mode, 'executive');
  assert.ok(b.excluded.some((x) => x.v.origin === 'catalogo' && /non verificato|quantità/.test(x.why)), 'quantita\' assunta dal modello: esclusa');
  const r = b.scenarios.guadagno.result;
  assert.ok(r.views.every((v) => v.origin === 'utente'));
  assert.ok(r.metrics.peak <= 240);
  assert.equal(r.metrics.rewardAccepted, 10000, 'il contratto non accettato non e\' acquisito');
  assert.equal(r.cls, 'potenziale');
  const over = evaluateStack(idx.views.filter((v) => v.origin === 'utente'), { ...c, capacity: 100 });
  assert.ok(over.route ? over.route.peak <= 100 : over.cls === 'incompatibile', 'capacita\' verificata dopo ogni operazione');
  assert.ok(STACK_MODES.executive && STACK_MODES.exploratory);
});

test('LI-14. EXPLORATORY STACK: combinazione teorica, nessun manifesto definitivo', () => {
  const idx = wIdx();
  const r = exploratoryStack('a061', idx, { geo: W.g, capacity: 1000, ship: SHIPS['rsi-constellation-mk5-centaurus'], ranks: {} }, { limit: 8 });
  assert.ok(exploratoryStack('a061', idx, { geo: W.g, capacity: 240, ranks: {} }).rejected.some((x) => /capacità/.test(x.why)), 'i massimi noti oltre la capacità vengono esclusi');
  assert.equal(r.executable, false); assert.equal(r.manifest, null);
  assert.ok(r.chosen.length > 0);
  assert.ok(r.chosen.some((x) => x.level === 'possibile' || x.level === 'regionale'));
  assert.ok(r.unknownPlaces.length > 0, 'luoghi ancora sconosciuti elencati');
  assert.ok(r.toVerify.length > 0 && r.why.length > 0 && r.constraints.length > 0);
  const sel = exploratoryStack('a061', idx, { geo: W.g, capacity: 240, ranks: {} }, { selected: [idx.byId.get('scu:w-moon')] });
  assert.equal(sel.chosen.length, 1); assert.ok(sel.unknownPlaces.some((t) => /ritiro/.test(t)));
});

test('LI-15. nessuna perdita dei contratti dell\'utente', async () => {
  const u = wUser({ title: 'Conservato', status: 'osservata', movements: [{ scu: 5, from: 'Area 061', to: null }] });
  const idx = wIdx([u]);
  const x = idx.forPlaceExpanded('a061', {}, { mode: 'verificate' });
  assert.ok(ids(x.sections.certainOut).includes(`user:${u.id}`), 'contratto tuo visibile anche in VERIFICATE');
  assert.equal(idx.views.filter((v) => v.origin === 'utente').length, 1);
  const db = await LogisticsDB.open();
  await db.putContracts([u]);
  const back = await db.contracts();
  assert.ok(back.some((c) => c.id === u.id && c.title === 'Conservato'));
  db.close();
});

test('LI-16. nessuna regressione: forPlace, connections e navigazione invariati', async () => {
  const idx = wIdx();
  const old = idx.forPlace('a061');
  assert.ok(old.out.some((e) => e.v.id === 'scu:w-fix' && e.strength === 'fisso'));
  assert.ok(old.out.some((e) => e.v.id === 'scu:w-pool20' && e.strength === 'possibile' && e.alternatives === 20));
  assert.ok(Array.isArray(idx.connections('a061')));
  const counts = idx.counts(); assert.ok(counts.get('a061') >= 5);
  const plan = await import('../js/core/plan.js');
  assert.ok(plan.DEFAULT_OPTS && plan.STRATEGY, 'motore di navigazione caricato e invariato');
  const { idx: base } = mk();
  assert.ok(base.forPlace('ba').out.length >= 3, 'primo mondo sintetico invariato');
});

test('LI-17. funzionamento offline: stessa ricerca dallo snapshot salvato', () => {
  const snap = JSON.parse(JSON.stringify({ meta: { patch: '9.9' }, places: W.places, connections: [] }));
  const g2 = geoFromSnapshot(snap);
  const cat2 = JSON.parse(JSON.stringify(W.cat));
  const idx2 = new MissionIndex(catalogViews(cat2), g2);
  const a = idx2.forPlaceExpanded('a061', {}, POSS).unique, b = wIdx().forPlaceExpanded('a061', {}, POSS).unique;
  assert.deepEqual(a, b);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /cache: 'no-cache'/, 'online: rivalidazione di ogni file, nessuna versione vecchia');
  assert.match(sw, /k !== CACHE/, 'le cache delle versioni precedenti vengono cancellate');
});

test('LI-18. compatibilità con il database IndexedDB attuale (v2, nessuno schema nuovo)', async () => {
  const db = await LogisticsDB.open();
  await db.setMeta('atlasUi', { system: 'stanton', sel: [], mode: 'possibili', scope: 'interplanetaria', dest: { label: 'Micro' } });
  const ui = await db.getMeta('atlasUi');
  assert.equal(ui.mode, 'possibili'); assert.equal(ui.scope, 'interplanetaria');
  db.close();
  const ver = await new Promise((res) => { const r = indexedDB.open('navcom-logistics'); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; });
  assert.equal(ver, 2, 'nessun aggiornamento di schema richiesto');
  const src = readFileSync(new URL('../js/ui-atlas.js', import.meta.url), 'utf8');
  assert.match(src, /S\.mode = S\.modeChosen && MODES\[S\.mode\] \? S\.mode : 'possibili'/, 'stato salvato senza scelta esplicita (0.7.0/0.7.1) letto con il valore predefinito');
});

test('GL-1 grafica WebGL: orbite nel piano del sistema, aspetto illustrativo deterministico, riserva 2D', async () => {
  const { orbitPoints, lookOf } = await import('../js/atlas/gl.js');
  const pts = orbitPoints({ x: 0, y: 0, z: 0 }, { x: 3e10, y: 4e10, z: 1e6 }, 8);
  assert.equal(pts.length, 9);
  for (const p of pts) { assert.ok(Math.abs(Math.hypot(p.x, p.y) - 5e10) < 1); assert.equal(p.z, 1e6); }
  assert.deepEqual(orbitPoints({ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 5 }), [], 'raggio nullo: nessuna orbita inventata');
  assert.deepEqual(lookOf('Daymar', 'moon', 'stanton', 295000), lookOf('Daymar', 'moon', 'stanton', 295000));
  assert.equal(lookOf('Crusader', 'planet', 'stanton', 7.45e6).type, 1);
  assert.equal(lookOf('Pyro V', 'planet', 'pyro', 7.8e6).type, 1);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/atlas/render.js', import.meta.url), 'utf8');
  assert.match(src, /if \(L\.ok\)/, 'senza WebGL resta il disegno 2D');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="at-gl"/); assert.match(html, /illustrative/);
});
