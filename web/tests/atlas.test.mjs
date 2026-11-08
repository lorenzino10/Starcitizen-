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
