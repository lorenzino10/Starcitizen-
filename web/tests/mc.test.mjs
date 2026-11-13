// MISSION CONTROL (2.1.0): test obbligatori della specifica.
// DATI SINTETICI, dichiarati: i nomi dei luoghi (New Babbage, Port Tressler, microTech...) servono solo a
// leggere i test come la specifica; coordinate, contratti, titoli, gradi e ricompense sono INVENTATI qui e
// non esistono nel gioco. In fondo un test sui dati reali, saltato se il catalogo locale non c'e'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { normalizePlaces, Geo } from '../js/atlas/geo.js';
import { buildMissionDb, missionTitle, prereqGroups } from '../js/missions/build.js';
import { dbViews, jumpLinks, shipCaps } from '../js/missions/finder.js';
import { loadMissionDb } from '../js/missions/load.js';
import { observedInput } from '../js/missions/observe.js';
import { normalizeContract } from '../js/logistics/model.js';
import { LogisticsDB } from '../js/logistics/lgdb.js';
import * as MC from '../js/missions/control.js';
import { McStore, MC_KEYS, newRecord, withStatus, byCatalog, cleanProfile } from '../js/missions/records.js';

// ---------------------------------------------------------------- geografia sintetica
const GM = 1e9;
const row = (uuid, name, type, parent, x, system, y = 0) => ({ uuid, name, type, system, parent_uuid: parent, x, y, z: 0, qt_valid: true, hidden: false });
const ROWS = [
  row('s0', 'SYN-Stanton', 'Star', null, 0, 'stanton'),
  row('mt', 'microTech', 'Planet', 's0', 20 * GM, 'stanton'),
  row('nb', 'New Babbage', 'LandingZone', 'mt', 20 * GM + 1e6, 'stanton'),
  row('pt', 'Port Tressler', 'Manmade', 'mt', 20 * GM + 3e6, 'stanton'),
  row('ca', 'Calliope', 'Moon', 'mt', 20 * GM + 4e8, 'stanton'),
  row('cb', 'Base Calliope', 'Outpost', 'ca', 20 * GM + 4e8 + 1e5, 'stanton'),
  row('cl', 'Clio', 'Moon', 'mt', 20 * GM - 4e8, 'stanton'),
  row('hu', 'Hurston', 'Planet', 's0', 12 * GM, 'stanton', 5 * GM),
  row('lv', 'Lorville', 'LandingZone', 'hu', 12 * GM + 1e6, 'stanton', 5 * GM),
  row('gsp', 'Pyro Gateway', 'Manmade', 's0', 30 * GM, 'stanton'),
  row('p0', 'SYN-Pyro', 'Star', null, 0, 'pyro'),
  row('pa', 'Base Pyro', 'Outpost', 'p0', 5 * GM, 'pyro'),
  row('gps', 'Stanton Gateway', 'Manmade', 'p0', 25 * GM, 'pyro'),
];
const PLACES = normalizePlaces(ROWS, { source: 'sintetico', patch: '9.9.0' });
const geo = new Geo(PLACES);
const LINKS = jumpLinks(geo);
const CENT = shipCaps('RSI Constellation Mk V Centaurus');

const P = (purpose, names) => ({ Purpose: purpose, ResolvedLocations: names.map((n) => ({ UUID: `t-${n}`, Name: n })) });
const C = (uuid, { pools = { PickupLocationBP: P('Location', ['New Babbage']), DropoffLocationBP: P('Destination', ['Port Tressler']) }, offer = ['nb'], type = 'Hauling - Planetary', reward = { Amount: 40000 }, order = { Name: 'Rame', MinScu: 40, MaxScu: 80, MaxContainerSize: 16 }, title, extra = {} } = {}) => ({
  UUID: uuid, DebugName: `SYN_Stanton_${uuid}`, MissionType: { Name: type }, MissionGiver: 'Compagnia Sintetica', Title: title ?? `SYN ${uuid}`,
  LocationPools: pools, FixedReward: reward, CalculatedReward: !reward,
  AvailabilityLocations: offer.length ? [{ ResolvedLocations: offer.map((u) => ({ UUID: u })) }] : [], HaulingOrders: order ? [order] : [], ...extra,
});
const rank = (Name, MinReputation) => ({ Name, MinReputation });
const CONTRACTS = [
  C('loc'), // New Babbage -> Port Tressler: locale (stesso corpo)
  C('moon', { offer: ['pt'], pools: { PickupLocationBP: P('Location', ['Port Tressler']), DropoffLocationBP: P('Destination', ['Base Calliope']) }, reward: { Amount: 55000 } }),
  C('inbound', { offer: ['lv'], pools: { PickupLocationBP: P('Location', ['Lorville']), DropoffLocationBP: P('Destination', ['Port Tressler']) } }),
  C('star', { type: 'Hauling - Interstellar', pools: { PickupLocationBP: P('Location', ['New Babbage']), DropoffLocationBP: P('Destination', ['Base Pyro']) }, reward: { Amount: 120000 } }),
  C('dynpool', { pools: { PickupLocationBP: P('Location', ['New Babbage']), DropoffLocationBP: P('Destination', ['Port Tressler', 'Lorville']) } }),
  C('multipick', { pools: { PickupLocation1BP: P('Location', ['New Babbage']), PickupLocation2BP: P('Location1', ['Port Tressler']), DropoffLocationBP: P('Destination', ['Lorville']) } }),
  C('multidrop', { offer: ['pt'], pools: { PickupLocationBP: P('Location', ['Port Tressler']), DropoffLocation1BP: P('Destination', ['Lorville']), DropoffLocation2BP: P('Destination1', ['Base Calliope']) } }),
  C('bounty', { type: 'Bounty Hunter', offer: ['mt'], order: null, pools: { TargetLocationBP: P('Target', ['Base Calliope']) }, reward: { Amount: 30000 } }),
  C('ranked', { extra: { MinStanding: rank('Member', 1000), ReputationScope: 'Hauling' } }),
  C('capped', { extra: { MinStanding: rank('Applicant', 0), MaxStanding: rank('Member', 1000), ReputationScope: 'Hauling' } }),
  C('senior', { extra: { MinStanding: rank('Senior', 5000), ReputationScope: 'Hauling' } }),
  C('notitle', { title: '<= PLACEHOLDER =>' }),
  C('dyntitle', { type: 'Bounty Hunter', order: null, offer: ['mt'], title: 'Kill ~mission(TargetName)', pools: { TargetLocationBP: P('Target', ['Clio', 'Base Calliope']) } }),
  C('bigbox', { order: { Name: 'Oro', MinScu: 64, MaxScu: 64, MaxContainerSize: 64 } }),
  C('heavy', { order: { Name: 'Titanio', MinScu: 300, MaxScu: 480, MaxContainerSize: 32 } }),
  C('prereq', { extra: { Prerequisites: [{ RequiredCount: 1, RequiredMissions: [{ UUID: 'loc', Title: 'SYN loc', DebugName: 'SYN_Stanton_loc' }] }] } }),
  C('crime', { extra: { CrimeStat: { Min: 1, Max: 5 } } }),
];
const PATCH = '9.9.0-LIVE.1000';
const DB = buildMissionDb(CONTRACTS, PLACES, { geo, links: LINKS, patch: PATCH, fetchedAt: '2026-11-13T00:00:00Z', wiki: null });
const VIEWS = dbViews(DB);
const V = (uuid) => VIEWS.find((v) => v.uuid === uuid);
const L = MC.ladders(VIEWS);
const NB = MC.regionOf(geo, 'nb'), PT = MC.regionOf(geo, 'pt');
const ctxList = (extra = {}) => ({ geo, links: LINKS, profile: MC.EMPTY_PROFILE(), L, ship: CENT, ...extra });
const list = (q, extra) => MC.controlList(VIEWS, { tab: 'offerte', relation: 'da', sort: 'ricompensa', ...q }, ctxList(extra));
const ids = (r) => r.rows.map((x) => x.v.uuid).sort();

// ---------------------------------------------------------------- 1. New Babbage / microTech
test('MC-1 New Babbage: regione microTech, offerta "a New Babbage" distinta da "nella regione"', () => {
  assert.equal(NB.body.id, 'mt'); assert.equal(NB.system, 'stanton');
  const luogo = list({ region: NB, scope: 'luogo' });
  // a livello "solo questo luogo": offerta a NB o ritiro a NB; mai il bounty offerto genericamente su microTech
  assert.ok(ids(luogo).includes('loc') && ids(luogo).includes('star'));
  assert.ok(!ids(luogo).includes('moon'), 'offerta e ritiro a Port Tressler: non "da New Babbage"');
  assert.equal(MC.offerRelation(V('bounty'), NB, geo, 'luogo'), null, 'offerta su microTech non dichiarata offerta a New Babbage');
  const corpo = list({ region: NB, scope: 'corpo' });
  assert.ok(['moon', 'bounty', 'multidrop'].every((u) => ids(corpo).includes(u)), 'il corpo comprende Port Tressler e le lune');
  assert.ok(!ids(corpo).includes('inbound'), 'offerta e ritiro a Lorville: fuori regione per "da qui"');
  const rel = MC.offerRelation(V('bounty'), NB, geo, 'corpo');
  assert.equal(rel.level, 'corpo');
  assert.match(MC.offerText(rel, NB), /nella regione microTech \(non specificamente a New Babbage\)/);
  assert.equal(MC.offerRelation(V('loc'), NB, geo, 'corpo').level, 'luogo');
});

// ---------------------------------------------------------------- 2. Port Tressler
test('MC-2 Port Tressler: stazione in orbita, stessa regione, offerte proprie', () => {
  assert.equal(PT.body.id, 'mt');
  const r = list({ region: PT, scope: 'luogo' });
  assert.ok(ids(r).includes('moon') && ids(r).includes('multidrop'));
  assert.equal(MC.offerRelation(V('moon'), PT, geo, 'luogo').level, 'luogo');
  // "verso qui": la consegna a Port Tressler, offerta a Lorville
  const verso = list({ region: PT, scope: 'luogo', relation: 'verso' });
  assert.ok(ids(verso).includes('inbound') && ids(verso).includes('loc'));
  assert.ok(!ids(verso).includes('moon'), 'parte da Port Tressler, non arriva qui');
  const relIn = MC.regionRelation(V('inbound'), PT, geo, 'luogo');
  assert.equal(relIn.offer, null); assert.equal(relIn.dropoff, 'certo');
});

// ---------------------------------------------------------------- 3. requisiti di reputazione
test('MC-3 reputazione: scale dal catalogo, grado non registrato mai presunto', () => {
  const lad = L.get('Compagnia Sintetica|Hauling');
  assert.deepEqual(lad.map((x) => x.name), ['Applicant', 'Member', 'Senior']);
  const empty = MC.accessCheck(V('ranked'), MC.EMPTY_PROFILE(), L);
  assert.equal(empty.state, 'unknown'); assert.match(empty.checks[0].note, /non registrato/);
  const member = { ...MC.EMPTY_PROFILE(), standings: [{ faction: 'Compagnia Sintetica', scope: 'Hauling', standing: 'Member', rep: null }] };
  assert.equal(MC.standingRep(member, L, 'Compagnia Sintetica', 'Hauling'), 1000);
  assert.equal(MC.accessCheck(V('ranked'), member, L).state, 'ok');
  assert.equal(MC.availability(V('ranked'), { region: NB, scope: 'corpo', geo, profile: member, L }).state, 'accessibile');
  assert.equal(MC.availability(V('ranked'), { region: NB, scope: 'corpo', geo, profile: MC.EMPTY_PROFILE(), L }).state, 'regione', 'senza profilo: compatibile con la regione, non "accessibile"');
});

// ---------------------------------------------------------------- 4. missioni non accessibili
test('MC-4 non accessibili: grado insufficiente, grado oltre il massimo, CrimeStat; nascoste solo se chiesto', () => {
  const member = { ...MC.EMPTY_PROFILE(), standings: [{ faction: 'Compagnia Sintetica', scope: 'Hauling', standing: 'Member' }], crime: 0 };
  assert.equal(MC.accessCheck(V('senior'), member, L).state, 'no');
  const senior = { ...member, standings: [{ faction: 'Compagnia Sintetica', scope: 'Hauling', rep: 6000 }] };
  const capped = MC.accessCheck(V('capped'), senior, L);
  assert.equal(capped.state, 'no'); assert.match(capped.checks[0].note, /fino al grado Member/);
  assert.equal(MC.accessCheck(V('crime'), member, L).state, 'no', 'CrimeStat 0 fuori dall\'intervallo 1–5');
  assert.equal(MC.accessCheck(V('crime'), MC.EMPTY_PROFILE(), L).state, 'unknown');
  assert.equal(MC.availability(V('senior'), { region: NB, scope: 'corpo', geo, profile: member, L }).state, 'non_accessibile');
  assert.ok(ids(list({ region: NB, scope: 'corpo' }, { profile: member })).includes('senior'), 'mostrata (marcata) per default');
  assert.ok(!ids(list({ region: NB, scope: 'corpo', hideBlocked: true }, { profile: member })).includes('senior'));
  assert.ok(ids(list({ region: NB, scope: 'corpo', hideBlocked: true, showAll: true }, { profile: member })).includes('senior'), '"mostra tutte le catalogate"');
  // prerequisito: missione richiesta col suo titolo; registrata come completata nel profilo -> ok
  const pr = MC.accessCheck(V('prereq'), MC.EMPTY_PROFILE(), L);
  assert.equal(pr.state, 'unknown'); assert.match(pr.checks[0].note, /SYN loc/);
  assert.equal(MC.accessCheck(V('prereq'), { ...MC.EMPTY_PROFILE(), completed: [{ uuid: 'loc' }] }, L).state, 'ok');
});

// ---------------------------------------------------------------- 5. titoli
test('MC-5 titoli: esatto, dinamico, assente; il nome interno resta separato', () => {
  assert.equal(V('loc').title, 'SYN loc'); assert.equal(V('loc').titleStatus, 'verificato');
  const nt = V('notitle');
  assert.equal(nt.titleStatus, 'assente'); assert.match(nt.title, /titolo assente nei file/); assert.equal(nt.debug, 'SYN_Stanton_notitle');
  const dt = V('dyntitle');
  assert.equal(dt.titleStatus, 'dinamico'); assert.equal(dt.title, 'Kill [TargetName]', 'parametro mostrato, non inventato');
  assert.notEqual(missionTitle({ Title: '[Contractor|DataHeistTitle_VE]' }, null).status, 'verificato', 'una chiave di testo non diventa un titolo esatto');
  assert.equal(missionTitle({ Title: '<= PLACEHOLDER =>' }, null, {}, 'X').status, 'assente');
  assert.deepEqual(missionTitle({ Title: 'Dal file' }, { title: 'Dalla Wiki' }), { title: 'Dalla Wiki', status: 'verificato', raw: null, from: 'Wiki' }, 'titolo visibile della Wiki prima del testo dei file');
  assert.equal(missionTitle({ DisplayTitle: 'Visibile', Title: 'Dal file' }, { title: 'Dalla Wiki' }).title, 'Visibile');
  assert.deepEqual(prereqGroups([{ RequiredCount: 2, RequiredMissions: [{ UUID: 'a', Title: '<= X =>', DebugName: 'A' }], RequiredTags: [{ Name: 'T' }] }]),
    [{ need: 2, missions: [{ uuid: 'a', title: null, debug: 'A' }], tags: ['T'], excluded: [] }]);
  // ricerca per nome esatto o parziale anche sul nome interno
  assert.deepEqual(ids(list({ text: 'notitle', showAll: true })), ['notitle']);
});

// ---------------------------------------------------------------- 6-8. geografia
test('MC-6/7/8 geografia: locale, interplanetario, interstellare, destinazione dinamica', () => {
  const g = (u) => MC.geoClass(V(u), geo);
  assert.equal(g('loc').cls, 'locale'); assert.equal(MC.mcCategory(V('loc'), geo), 'tr_local');
  assert.equal(g('moon').cls, 'interplanetario', 'Port Tressler (microTech) -> Calliope: corpi diversi'); assert.equal(MC.mcCategory(V('moon'), geo), 'tr_inter');
  assert.equal(g('star').cls, 'interstellare'); assert.equal(MC.mcCategory(V('star'), geo), 'tr_star');
  const d = g('dynpool');
  assert.equal(d.cls, 'da_determinare'); assert.deepEqual(d.possible, ['locale', 'interplanetario']); assert.equal(d.sure, false);
  assert.equal(MC.mcCategory(V('dynpool'), geo), 'tr_open');
});

// ---------------------------------------------------------------- 9. bounty
test('MC-9 bounty: luogo operativo dall\'obiettivo, mai un ritiro; offerta di regione', () => {
  const b = V('bounty');
  assert.equal(MC.mcCategory(b, geo), 'bounty');
  assert.equal(b.ops.filter((o) => o.role === 'pickup').length, 0);
  const gc = MC.geoClass(b, geo);
  assert.equal(gc.cls, 'locale'); assert.equal(gc.basis, 'obiettivo');
  assert.equal(MC.matchObjective(b, { id: 'ca', system: 'stanton' }, geo), 'certo');
  const dyn = MC.geoClass(V('dyntitle'), geo);
  assert.equal(dyn.cls, 'sistema', 'obiettivo in un pool di due lune'); assert.equal(dyn.sure, false);
});

// ---------------------------------------------------------------- 10-11. piu' ritiri, piu' consegne
test('MC-10/11 più ritiri e più consegne: MULTIDESTINAZIONE', () => {
  assert.equal(MC.mcCategory(V('multipick'), geo), 'tr_multi');
  assert.equal(MC.mcCategory(V('multidrop'), geo), 'tr_multi');
  assert.equal(MC.geoClass(V('multidrop'), geo).multi, true);
  const info = MC.placeInfo(V('multipick'), geo);
  assert.deepEqual([...info.pick.sure].sort(), ['nb', 'pt']);
});

// ---------------------------------------------------------------- 12-13. raggruppamento
test('MC-12/13 RAGGRUPPA: stessa destinazione, stessa partenza, vicine, isolate', () => {
  const sel = ['loc', 'inbound', 'moon', 'star', 'bounty'].map(V);
  const g = MC.groupSelection(sel, geo, { links: LINKS });
  const find = (kind, key) => g.groups.find((x) => x.kind === kind && x.keys.includes(key));
  const dest = find('destinazione', 'pt');
  assert.deepEqual(dest.members.map((m) => m.id).sort(), [V('inbound').id, V('loc').id].sort());
  assert.ok(dest.members.every((m) => m.sure), 'luoghi fissi: appartenenza certa');
  const start = find('partenza', 'nb');
  assert.deepEqual(start.members.map((m) => m.id).sort(), [V('loc').id, V('star').id].sort());
  assert.ok(find('vicine', 'mt'), 'Port Tressler e Calliope attorno a microTech');
  assert.ok(find('direzione', 'stanton>pyro') === undefined, 'una sola missione interstellare: nessun gruppo di direzione');
  assert.equal(g.unknown.length, 0);
  // pool: appartenenza solo POSSIBILE
  const p = MC.groupSelection([V('dynpool'), V('inbound')], geo).groups.find((x) => x.kind === 'destinazione' && x.keys.includes('pt'));
  assert.equal(p.members.find((m) => m.id === V('dynpool').id).sure, false);
  // contratti raggruppabili con uno dato
  const rel = MC.relatedTo(V('loc'), [V('inbound'), V('star'), V('moon')], geo);
  const why = (u) => rel.find((x) => x.v.uuid === u)?.why.map((w) => `${w.kind}${w.sure ? '!' : ''}`);
  assert.ok(why('inbound').includes('destinazione!')); assert.ok(why('star').includes('partenza!'));
  assert.ok(why('moon').includes('vicine!'), 'Port Tressler e Calliope attorno a microTech');
});

// ---------------------------------------------------------------- 14. capacita' e casse
test('MC-14 Centaurus: cassa troppo grande, più viaggi, SCU non bastano a provare l\'incastro', () => {
  assert.equal(CENT.scu, 240); assert.equal(CENT.maxBox, 32);
  assert.equal(MC.shipFit(V('bigbox'), CENT).fit, 'cassa');
  const h = MC.shipFit(V('heavy'), CENT); assert.equal(h.fit, 'viaggi'); assert.equal(h.trips, 2);
  assert.equal(MC.shipFit(V('loc'), CENT).fit, 'ok');
  assert.equal(MC.shipFit(V('bounty'), CENT).fit, 'nd');
  assert.ok(!ids(list({ showAll: true, fitOnly: true })).includes('bigbox'));
  const ctx = { geo, links: LINKS, capacity: CENT.scu, ship: CENT, ranks: {}, start: 'nb' };
  const r = MC.planSelection([V('bigbox'), V('loc')], ctx, 'guadagno');
  assert.ok(r.excluded.some((x) => x.v.uuid === 'bigbox'), 'cassa da 64 esclusa con il motivo');
  assert.ok(!r.best || !r.best.set.some((v) => v.uuid === 'bigbox'));
});

// ---------------------------------------------------------------- 15. rotte con jump point
test('MC-15 rotta fra sistemi: gateway, salto senza distanza euclidea', () => {
  const r = MC.routeSteps(geo.get('nb'), geo.get('pa'), geo, LINKS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((s) => s.kind), ['qt', 'salto', 'qt']);
  assert.equal(r.steps[0].to.name, 'Pyro Gateway'); assert.equal(r.steps[1].to.name, 'Stanton Gateway');
  assert.equal(r.steps[1].distance, undefined, 'il tunnel non ha una lunghezza nei dati');
  assert.equal(MC.routeSteps(geo.get('nb'), geo.get('pt'), geo, LINKS).steps.length, 1);
  const d = MC.distanceFrom(V('star'), geo.get('lv'), geo, LINKS);
  assert.ok(d.d > 0 && d.via === false, 'ritiro a New Babbage: stesso sistema');
});

// ---------------------------------------------------------------- 16. scenario della specifica
test('MC-16 scenario: New Babbage, Centaurus, 3 trasporti + 1 bounty', () => {
  const sel = ['loc', 'moon', 'star', 'bounty'].map(V);
  const g = MC.groupSelection(sel, geo, { links: LINKS });
  assert.ok(g.groups.length > 0);
  const ctx = { geo, links: LINKS, capacity: CENT.scu, ship: CENT, ranks: {}, start: 'nb' };
  for (const mode of Object.keys(MC.MODES)) {
    const r = MC.planSelection(sel, ctx, mode);
    assert.equal(r.others.length, 1, 'il bounty resta un\'attività separata');
    assert.equal(r.others[0].v.uuid, 'bounty'); assert.match(r.others[0].note, /non sommata al cargo/);
    assert.ok(r.best, `${mode}: una combinazione cargo`);
    assert.ok(!r.best.set.some((v) => v.uuid === 'bounty'));
    const s = r.summary;
    for (const k of ['missions', 'reward', 'cargo', 'trips', 'pickups', 'dropoffs', 'itinerary', 'distance', 'time', 'risks']) assert.ok(['noto', 'calcolato', 'mancante', 'parziale'].includes(s[k].how), `${k}: origine dichiarata`);
    assert.equal(s.reward.value, r.best.set.reduce((n, v) => n + (v.rewardInfo.max ?? 0), 0), 'la ricompensa del bounty non entra nel cargo');
  }
  const best = MC.planSelection(sel, ctx, 'guadagno').best;
  assert.deepEqual(best.set.map((v) => v.uuid).sort(), ['loc', 'moon', 'star']);
});

// ---------------------------------------------------------------- 17. persistenza, registrazione, aggiornamento
test('MC-17 IndexedDB: registro e profilo persistono; ACCETTATA solo nell\'archivio; aggiornamento del catalogo non li tocca', async () => {
  const db = await LogisticsDB.open();
  await db.setMeta('atlasUi', { sel: ['x'] });
  const st = await new McStore(db).load();
  // registrazione di un'offerta vista nel mobiGlas: titolo e identificativi copiati dal modello
  const v = V('dynpool');
  const rec = newRecord(v, { status: 'visibile', reward: '41000', offerAt: 'New Babbage', locations: { pickup: 'New Babbage', dropoff: 'Lorville' } });
  assert.equal(rec.ref.title, v.title); assert.equal(rec.ref.uuid, 'dynpool'); assert.equal(rec.reward, 41000);
  assert.throws(() => newRecord(v, { status: 'disponibile' }), /non valido/, 'nessuno stato "disponibile adesso"');
  await st.add(rec);
  const o = observedInput(v, { status: 'accettata', reward: '41000', offer: 'New Babbage', movements: [{ cargo: 'Rame', scu: '60', containerMax: '16', from: 'New Babbage', to: 'Lorville' }] }, { geo, patch: '9.9.0' });
  const c = normalizeContract(o.input); assert.ok(c.contract, c.errors.join());
  await db.putContracts([c.contract]);
  await st.update(rec.id, { contractId: c.contract.id });
  await st.setStatus(rec.id, 'accettata');
  await st.saveProfile({ standings: [{ faction: 'Compagnia Sintetica', scope: 'Hauling', standing: 'Member' }, { faction: '' }], crime: 9, tags: ['a', 'a'] });
  // riapertura: tutto e' ancora li'
  const st2 = await new McStore(await LogisticsDB.open()).load();
  assert.equal(st2.records.length, 1); assert.equal(st2.records[0].status, 'accettata');
  assert.deepEqual(st2.records[0].history.map((h) => h.status), ['visibile', 'accettata']);
  assert.equal(st2.profile.standings.length, 1, 'righe vuote scartate'); assert.equal(st2.profile.crime, null, 'CrimeStat fuori scala non salvato'); assert.deepEqual(st2.profile.tags, ['a']);
  // l'elenco usa le tue registrazioni: scheda ACCETTATE, stato tuo
  const recs = byCatalog(st2.records);
  const acc = list({ tab: 'accettate', region: NB, scope: 'corpo' }, { records: recs });
  assert.deepEqual(ids(acc), ['dynpool']); assert.equal(acc.rows[0].av.state, 'accettata');
  assert.ok(!ids(list({ region: NB, scope: 'corpo' }, { records: recs })).includes('dynpool'), 'non ripetuta fra le offerte');
  assert.equal(withStatus(rec, 'completata').history.length, 2);
  // aggiornamento del catalogo: registro, profilo, contratti e preferenze intatti
  const fetchJson = async (u) => (u.endsWith('index.json') ? { file: 'catalog-x.json', patch: PATCH } : DB);
  await loadMissionDb({ fetchJson, getMeta: (k) => db.getMeta(k), setMeta: (k, x) => db.setMeta(k, x) });
  const db3 = await LogisticsDB.open();
  assert.equal((await db3.getMeta(MC_KEYS.records)).length, 1);
  assert.equal((await db3.getMeta(MC_KEYS.profile)).standings[0].standing, 'Member');
  assert.deepEqual(await db3.getMeta('atlasUi'), { sel: ['x'] });
  assert.equal((await db3.contracts()).length, 1);
  assert.deepEqual(cleanProfile(null), MC.EMPTY_PROFILE());
});

// ---------------------------------------------------------------- 18. nessuna missione "disponibile adesso"
test('MC-18 stati: nessun modello del catalogo supera POTENZIALMENTE ACCESSIBILE senza una tua conferma', () => {
  const states = new Set(list({ region: NB, scope: 'sistema', relation: 'tutte', showAll: true }).rows.map((x) => x.av.state));
  for (const s of states) assert.ok(['catalogata', 'regione', 'accessibile', 'non_accessibile'].includes(s), s);
  assert.equal(MC.availability(V('loc'), { geo }).state, 'catalogata', 'senza posizione');
  assert.ok(!Object.keys(MC.AVAIL).some((k) => /disponibil/i.test(k + MC.AVAIL[k].label)));
});

// ---------------------------------------------------------------- dati reali (se presenti)
const W = new URL('../data/', import.meta.url);
const CAT = (() => { try { const idx = JSON.parse(readFileSync(new URL('missions/index.json', W))); return new URL(`missions/${idx.file}`, W); } catch { return null; } })();
test('MC-R dati reali: New Babbage, titoli, nessuna offerta inventata a livello di luogo', { skip: !CAT || !existsSync(CAT) || !existsSync(new URL('atlas/geo.json', W)) ? 'catalogo locale assente (generato in CI)' : false }, () => {
  const rg = new Geo(JSON.parse(readFileSync(new URL('atlas/geo.json', W))).places);
  const views = dbViews(JSON.parse(readFileSync(CAT)));
  const nb = MC.regionOf(rg, rg.resolveName('New Babbage').id);
  const ctx = { geo: rg, links: jumpLinks(rg), profile: MC.EMPTY_PROFILE(), L: MC.ladders(views), ship: CENT };
  const corpo = MC.controlList(views, { tab: 'offerte', region: nb, scope: 'corpo', relation: 'da' }, ctx);
  assert.ok(corpo.total > 0);
  const luogo = MC.controlList(views, { tab: 'offerte', region: nb, scope: 'luogo', relation: 'da' }, ctx);
  for (const r of luogo.rows) if (r.av.state !== 'catalogata') assert.equal(r.rel.offer.level, 'luogo', 'offerta "a New Babbage" solo se i dati lo dicono');
  for (const v of views) if (v.titleStatus === 'verificato') assert.ok(!/^<=|~mission\(|\[[A-Za-z][^\]]*\]/.test(v.title), v.title);
});

// ---------------------------------------------------------------- 19. backup completo
test('MC-19 backup completo: registro e profilo inclusi; backup precedenti senza la sezione accettati', async () => {
  const { exportFull, parseBackup, mergeById } = await import('../js/logistics/io.js');
  const rec = newRecord(V('loc'), { status: 'accettata', reward: 40000 });
  const bad = { id: 'x', status: 'disponibile', ref: { title: 'inventata' } };
  const prof = cleanProfile({ standings: [{ faction: 'Compagnia Sintetica', standing: 'Member' }] });
  const b = parseBackup(JSON.stringify(exportFull({ points: [], contracts: [], observations: [], missionControl: { records: [rec, bad], profile: prof } })));
  assert.equal(b.missionControl.records.length, 1); assert.equal(b.missionControl.records[0].ref.title, 'SYN loc');
  assert.match(b.errors.join(), /1 registrazioni non valide/);
  assert.equal(b.missionControl.profile.standings[0].standing, 'Member');
  assert.equal(parseBackup(JSON.stringify(exportFull({ points: [], contracts: [], observations: [] }))).missionControl, null);
  // unione: la registrazione locale piu' recente non viene sovrascritta
  const newer = { ...rec, status: 'completata', updatedAt: '2999-01-01T00:00:00Z' };
  assert.equal(mergeById([newer], b.missionControl.records).list[0].status, 'completata');
});
