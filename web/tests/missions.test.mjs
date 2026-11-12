// MISSION DATABASE 2.0 e COMMAND BRIDGE (2.0.0): test della specifica (parte C) con DATI SINTETICI.
// Nessuna missione di questo file esiste nel gioco: luoghi, contratti e ricompense sono inventati
// solo per provare la logica. I dati reali sono verificati a parte (docs/MISSIONS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { normalizePlaces, Geo } from '../js/atlas/geo.js';
import { catalogViews, MissionIndex } from '../js/atlas/missions.js';
import { evaluateStack, geoLegOf, jumpLeg } from '../js/atlas/stack.js';
import { buildMissionDb, atlasSubset, validateCatalog, diffCatalog, publishMissions, parseGameVersion, compareVersions, systemsPath, cleanDescription } from '../js/missions/build.js';
import { dbViews, findMissions, collapseVariants, matchRole, routeCertainty, classify, shipCaps, maxBoxFromGrid, cargoOf, parseArea, jumpLinks, CLASS } from '../js/missions/finder.js';
import { fetchAllPages, missionsPageUrl, liveVersion } from '../js/missions/wiki.js';
import { loadMissionDb, provenance, SNAP_KEY } from '../js/missions/load.js';
import { draftMovements, observedInput } from '../js/missions/observe.js';
import { bridgeScene, nextJump, nextLeg } from '../js/home/bridge.js';
import { normalizeContract } from '../js/logistics/model.js';
import { LogisticsDB } from '../js/logistics/lgdb.js';

// ---------------------------------------------------------------- geografia sintetica a 3 sistemi
const GM = 1e9;
const row = (uuid, name, type, parent, x, system, y = 0) => ({ uuid, name, type, system, parent_uuid: parent, x, y, z: 0, qt_valid: true, hidden: false });
const ROWS = [
  row('s0', 'SYN-S', 'Star', null, 0, 'stanton'), row('sp', 'Pianeta S', 'Planet', 's0', 10 * GM, 'stanton'),
  row('sa', 'Base Alfa', 'Outpost', 'sp', 10 * GM + 1e6, 'stanton'), row('sb', 'Base Bravo', 'Outpost', 'sp', 10 * GM - 1e6, 'stanton'),
  row('sc', 'Stazione Charlie', 'Manmade', 's0', 12 * GM, 'stanton'), row('sd', 'Stazione Delta', 'Manmade', 's0', 14 * GM, 'stanton'),
  row('gsp', 'Pyro Gateway', 'Manmade', 's0', 20 * GM, 'stanton'), row('gsn', 'Nyx Gateway', 'Manmade', 's0', -20 * GM, 'stanton'),
  row('p0', 'SYN-P', 'Star', null, 0, 'pyro'), row('pa', 'Base Pyro', 'Outpost', 'p0', 5 * GM, 'pyro'), row('pg', 'Gemella', 'Outpost', 'p0', 6 * GM, 'pyro'),
  row('gps', 'Stanton Gateway', 'Manmade', 'p0', 30 * GM, 'pyro'), row('gpn', 'Nyx Gateway', 'Manmade', 'p0', -30 * GM, 'pyro'),
  row('n0', 'SYN-N', 'Star', null, 0, 'nyx'), row('na', 'Base Nyx', 'Outpost', 'n0', 3 * GM, 'nyx'), row('sg', 'Gemella', 'Outpost', 'n0', 4 * GM, 'nyx'),
  row('gns', 'Stanton Gateway', 'Manmade', 'n0', 9 * GM, 'nyx'), row('gnp', 'Pyro Gateway', 'Manmade', 'n0', -9 * GM, 'nyx'),
];
const PLACES = normalizePlaces(ROWS, { source: 'sintetico', patch: '9.9.0' });
const geo = new Geo(PLACES);
const LINKS = jumpLinks(geo);

const pool = (key, purpose, names) => [key, { Purpose: purpose, ResolvedLocations: names.map((n) => ({ UUID: `t-${n}`, Name: n })) }];
const C = (uuid, { pick = ['Base Alfa'], drop = ['Stazione Charlie'], offer = ['sc'], type = 'Hauling - Planetary', reward = { Amount: 40000 }, calc = false, order = { Name: 'Rame', MinScu: 40, MaxScu: 80, MaxContainerSize: 16 }, rank = 0, debug = 'SYN_Stanton', tokens = {}, extra = {} } = {}) => ({
  UUID: uuid, DebugName: `${debug}_${uuid}`, MissionType: { Name: type }, MissionGiver: 'Compagnia Sintetica', Title: `Trasporto ${uuid}`,
  LocationPools: Object.fromEntries([pool('PickupLocationBP', 'Location', pick), pool('DropoffLocationBP', 'Destination', drop)].filter(([, v]) => v.ResolvedLocations.length)),
  MissionTokens: tokens, FixedReward: calc ? null : reward, CalculatedReward: calc, MinStanding: rank ? { Name: 'Junior' } : null, RankIndex: rank,
  AvailabilityLocations: offer.length ? [{ ResolvedLocations: offer.map((u) => ({ UUID: u })) }] : [], HaulingOrders: order ? [order] : [], Deadline: { CompletionTime: 120 }, ...extra,
});
const PATCH = '9.9.0-LIVE.1000';
const CONTRACTS = [
  C('fix1'), C('fix2', { drop: ['Stazione Delta'] }), C('pool3', { pick: ['Base Alfa', 'Base Bravo', 'Stazione Delta'] }),
  C('range', { reward: { Amount: 10000, Max: 25000 } }), C('dyn', { calc: true }),
  C('inter', { type: 'Hauling - Interstellar', pick: ['Base Alfa'], drop: ['Base Pyro'], debug: 'SYN_Interstellar' }),
  C('interNyx', { type: 'Hauling - Interstellar', pick: ['Base Nyx'], drop: ['Base Pyro'], offer: ['na'], debug: 'SYN_Interstellar' }),
  C('ambig', { type: 'Hauling - Interstellar', pick: ['Base Alfa'], drop: ['Gemella'], debug: 'SYN_Interstellar' }),
  C('tok', { type: 'Hauling - Interstellar', pick: [], drop: [], tokens: { 'Location|Address': ['Base Alfa'], 'Destination|Address': ['Base Nyx'] }, debug: 'SYN_Interstellar' }),
  C('bigbox', { order: { Name: 'Titanio', MinScu: 100, MaxScu: 425, MaxContainerSize: 32 } }),
  C('huge', { order: { Name: 'Oro', MinScu: 64, MaxScu: 64, MaxContainerSize: 64 } }),
  C('ranked', { rank: 3 }),
  C('v1'), C('v2'), // varianti dello stesso modello (gruppo Wiki)
  C('combat', { type: 'Mercenary', order: null, pick: [], drop: [] }),
  { ...C('nfr'), NotForRelease: true }, { ...C('wip'), WorkInProgress: true },
];
const WIKI = {
  liveDefault: PATCH,
  list: CONTRACTS.map((c) => ({ uuid: c.UUID, title: c.Title, description: c.UUID === 'fix1' ? 'Consegna <EM4>urgente</EM4> di rame.' : '[Contractor|HaulCargo_AtoB]', star_systems: [] })),
  grouped: [{ uuid: 'v1', variant_count: 2, variants: [{ uuid: 'v1' }, { uuid: 'v2' }] }],
};
const build = (opts = {}) => buildMissionDb(CONTRACTS, PLACES, { geo, links: LINKS, patch: PATCH, fetchedAt: '2026-11-12T00:00:00Z', wiki: WIKI, ...opts });
const DB = build();
const VIEWS = dbViews(DB);
const V = (uuid) => VIEWS.find((v) => v.uuid === uuid);
const CENT = shipCaps('RSI Constellation Mk V Centaurus');

// ---------------------------------------------------------------- 1. importazione paginata
test('MD-1 importazione paginata: tutte le pagine, totale verificato, errori espliciti', async () => {
  const all = Array.from({ length: 250 }, (_, i) => ({ uuid: `u${i}` }));
  const pages = (size, total = all.length, rows = all) => async (url) => {
    const n = +/page\[number\]=(\d+)/.exec(url)[1];
    return { data: rows.slice((n - 1) * size, n * size), meta: { total, last_page: Math.ceil(total / size), current_page: n } };
  };
  const urls = [];
  const got = await fetchAllPages(async (u) => { urls.push(u); return pages(100)(u); }, (p) => missionsPageUrl(false, p));
  assert.equal(got.length, 250);
  assert.equal(urls.length, 3, 'tre pagine da 100');
  assert.match(urls[0], /filter\[grouped\]=false&page\[size\]=100&page\[number\]=1$/);
  await assert.rejects(fetchAllPages(pages(100, 260), (p) => missionsPageUrl(false, p)), /incompleta: 250 record su 260/);
  const dup = [...all.slice(0, 150), ...all.slice(100, 200)];
  // righe ripetute tra pagine (succede davvero: 5153 righe, 4922 uuid il 2026-11-12): tenute una volta e contate
  const d = await fetchAllPages(pages(100, 250, dup), (p) => missionsPageUrl(true, p));
  assert.equal(d.length, 200); assert.deepEqual(d.stats, { total: 250, received: 250, unique: 200, duplicates: 50 });
  await assert.rejects(fetchAllPages(async () => ({ error: 'x' }), (p) => missionsPageUrl(true, p)), /senza "data"/);
});

// ---------------------------------------------------------------- 2. versione LIVE
test('MD-2 versione LIVE: riconosciuta dalla Wiki, confrontata, mai retrocessa', () => {
  assert.deepEqual(liveVersion({ data: { code: '4.10.2-LIVE.12881860', channel: 'live', released_at: '2026-10-28' } }), { code: '4.10.2-LIVE.12881860', channel: 'live', releasedAt: '2026-10-28' });
  assert.equal(liveVersion({ data: { code: 'latest' } }), null, 'codice non riconoscibile: nessuna versione inventata');
  assert.equal(liveVersion(null), null);
  assert.deepEqual(parseGameVersion('4.10.2-LIVE.12881860'), { code: '4.10.2-LIVE.12881860', version: '4.10.2', channel: 'LIVE', build: '12881860' });
  assert.ok(compareVersions('4.10.2-LIVE.12881860', '4.9.0-LIVE.12232306') > 0);
  assert.equal(DB.meta.version, '9.9.0'); assert.equal(DB.meta.channel, 'LIVE'); assert.equal(DB.meta.build, '1000');
  const newer = { ...DB, meta: { ...DB.meta, patch: '9.10.0-LIVE.2000' } };
  const r = validateCatalog(DB, newer, { minMissions: 1 });
  assert.equal(r.ok, false); assert.match(r.errors.join(), /più vecchia/);
});

// ---------------------------------------------------------------- 3. varianti
test('MD-3 varianti: gruppi della Wiki, modelli distinti dalle varianti, una riga per modello', () => {
  assert.equal(DB.meta.excluded.notForRelease, 1); assert.equal(DB.meta.excluded.workInProgress, 1);
  assert.equal(DB.missions.length, CONTRACTS.length - 2);
  assert.equal(V('v1').group, 'v1'); assert.equal(V('v2').group, 'v1'); assert.equal(V('v1').variants, 2);
  assert.equal(DB.meta.templates, DB.missions.length - 1, 'v1 e v2 contano come un solo modello');
  const r = findMissions(VIEWS, { from: { id: 'sa' }, to: { id: 'sc' } }, { geo, links: LINKS });
  const rows = collapseVariants(r.rows);
  assert.ok(rows.length < r.rows.length);
  assert.equal(rows.find((x) => x.v.group === 'v1').found, 2);
  // senza Wiki: raggruppamento euristico dichiarato
  const H = build({ wiki: null });
  assert.equal(H.missions.find((m) => m.uuid === 'v1').groupHow, 'euristica');
  // con la Wiki: chi manca dal suo elenco riceve comunque un gruppo, dichiarato euristico
  assert.ok(DB.missions.every((m) => m.group && (m.groupHow === 'wiki' || m.groupHow === 'euristica')));
  assert.equal(DB.meta.wiki.matched + DB.meta.wiki.heuristic, DB.missions.length);
  assert.equal(cleanDescription('[Contractor|HaulCargo_AtoB]'), null, 'un segnaposto non è una descrizione');
  assert.equal(V('fix1').description, 'Consegna urgente di rame.');
});

// ---------------------------------------------------------------- 4. offerta / ritiro / consegna
test('MD-4 il luogo d\'offerta non diventa il punto di ritiro', () => {
  const v = V('fix1');
  assert.deepEqual(v.offer.map((o) => o.id), ['sc']);
  assert.deepEqual(v.ops.filter((o) => o.role === 'pickup').flatMap((o) => o.ids), ['sa']);
  assert.equal(matchRole(v, 'pickup', { id: 'sc' }, geo), 'no');
  // DA = stazione dell'offerta: il modello con un ritiro noto altrove NON e' "in partenza da qui"
  const r = findMissions([v], { from: { id: 'sc' } }, { geo, links: LINKS });
  assert.equal(r.rows.length, 0); assert.equal(r.excluded.partenza, 1);
  // il dettaglio per la registrazione non copia l'offerta nel ritiro
  const d = draftMovements(v, geo);
  assert.equal(d[0].from, 'Base Alfa'); assert.equal(d[0].to, 'Stazione Charlie');
});

// ---------------------------------------------------------------- 5. pool
test('MD-5 pool interi: nessuna scelta arbitraria, certezza dichiarata', () => {
  const v = V('pool3');
  const pk = v.ops.find((o) => o.role === 'pickup');
  assert.equal(pk.ids.length, 3); assert.equal(pk.fixed, false);
  assert.equal(routeCertainty(v), 'variabile');
  assert.equal(matchRole(v, 'pickup', { id: 'sa' }, geo), 'possibile');
  assert.equal(matchRole(v, 'pickup', { system: 'stanton' }, geo), 'certo', 'tutto il pool è in Stanton');
  const d = draftMovements(v, geo);
  assert.equal(d[0].from, '', 'ritiro da pool lasciato vuoto');
  assert.equal(d[0].fromPool.length, 3);
  // nome ambiguo in una missione interstellare: candidati tenuti tutti (Pyro e Nyx)
  const a = V('ambig'); const dp = a.ops.find((o) => o.role === 'dropoff');
  assert.equal(dp.ids.length, 0);
  assert.deepEqual(dp.alt.sort(), ['pg', 'sg']);
  assert.equal(routeCertainty(a), 'variabile');
});

// ---------------------------------------------------------------- 6. interstellari
test('MD-6 Stanton–Pyro–Nyx: missioni interstellari trovate fra sistemi, salti dalla rete NAVCOM', () => {
  assert.deepEqual(LINKS.map((l) => `${l.from}-${l.to}`).sort(), ['nyx-pyro', 'nyx-stanton', 'pyro-stanton']);
  const v = V('inter');
  assert.equal(v.interstellar, true); assert.deepEqual(v.transit, ['stanton', 'pyro']);
  const r = findMissions(VIEWS, { from: { system: 'stanton' }, to: { system: 'pyro' } }, { geo, links: LINKS });
  const ids = r.rows.map((x) => x.v.uuid);
  assert.ok(ids.includes('inter'));
  assert.equal(r.rows.find((x) => x.v.uuid === 'inter').path.join('>'), 'stanton>pyro');
  assert.ok(findMissions(VIEWS, { from: { system: 'nyx' }, to: { system: 'pyro' } }, { geo, links: LINKS }).rows.some((x) => x.v.uuid === 'interNyx'));
  // pool vuoti nei file: luoghi dal testo della missione, marcati come tali
  const t = V('tok');
  assert.ok(t.ops.every((o) => o.src === 'testo'));
  assert.deepEqual(t.transit, ['stanton', 'nyx']);
  // senza collegamento diretto Stanton-Pyro il percorso passa da Nyx (nessuna tratta QT unica richiesta)
  assert.deepEqual(systemsPath('stanton', 'pyro', [{ from: 'stanton', to: 'nyx' }, { from: 'nyx', to: 'pyro' }]), ['stanton', 'nyx', 'pyro']);
  // tratta fra sistemi: distanze reali fino e dai gateway, tempo non calcolabile
  const leg = jumpLeg(geo, geo.get('sa'), geo.get('pa'), LINKS);
  const exp = Math.abs(20 * GM - (10 * GM + 1e6)) + Math.abs(30 * GM - 5 * GM);
  assert.equal(Math.round(leg.distance), Math.round(exp)); assert.equal(leg.time, null); assert.equal(leg.jumps, 1);
  const j = nextJump('stanton', 'pyro', { geo, links: LINKS, pos: { x: 0, y: 0, z: 0 } });
  assert.equal(j.gateway.name, 'Pyro Gateway'); assert.equal(j.distance, 20 * GM);
  assert.equal(nextJump('stanton', 'stanton', { geo, links: LINKS }), null);
});

// ---------------------------------------------------------------- 7. ricompense variabili
test('MD-7 ricompense fisse, intervallo e dinamiche: mai inventate', () => {
  assert.deepEqual(V('fix1').rewardInfo, { kind: 'fissa', min: 40000, max: 40000, currency: 'UEC' });
  assert.equal(V('range').rewardInfo.kind, 'intervallo'); assert.equal(V('range').rewardInfo.max, 25000);
  assert.equal(V('dyn').rewardInfo.kind, 'dinamica'); assert.equal(V('dyn').reward, null);
  const q = { from: { id: 'sa' }, minReward: 20000 };
  const without = findMissions(VIEWS, q, { geo, links: LINKS }).rows.map((x) => x.v.uuid);
  assert.ok(!without.includes('dyn')); assert.ok(without.includes('range'), 'massimo dell\'intervallo sopra la soglia');
  const withDyn = findMissions(VIEWS, { ...q, includeUnknownReward: true }, { geo, links: LINKS }).rows.map((x) => x.v.uuid);
  assert.ok(withDyn.includes('dyn'));
});

// ---------------------------------------------------------------- 8. stacking
test('MD-8 stacking: luoghi comuni, capacità, viaggi; modelli ipotetici distinti, pool non eseguibili', () => {
  const sub = atlasSubset(DB); const views = catalogViews(sub); const ix = new MissionIndex(views, geo);
  const ctx = { geo, links: LINKS, capacity: CENT.scu, ship: { maxBox: CENT.maxBox }, ranks: {}, start: 'sa' };
  const a = ix.byId.get('scu:fix1'), b = ix.byId.get('scu:fix2');
  const r = evaluateStack([a, b], ctx);
  assert.equal(r.cls, 'potenziale', 'modelli di catalogo: mai eseguibile senza contratti accettati');
  assert.equal(r.metrics.rewardAccepted, 0); assert.equal(r.metrics.rewardUnconfirmed, 80000);
  assert.ok(r.route.seq.length >= 4);
  const big = evaluateStack([ix.byId.get('scu:bigbox')], ctx);
  assert.ok(big.warnings.some((w) => /più viaggi/.test(w)), '425 SCU con 240 di stiva: piano su più viaggi');
  const p = evaluateStack([ix.byId.get('scu:pool3')], ctx);
  assert.equal(p.cls, 'verificare', 'ritiro da pool: non dichiarato eseguibile');
  const x = evaluateStack([ix.byId.get('scu:inter')], ctx);
  assert.ok(x.route, 'interstellare pianificabile sulla rete dei salti');
  assert.equal(x.metrics.unknownLegs, 0);
  const old = geoLegOf(geo)(geo.get('sa'), geo.get('pa'));
  assert.equal(old.known, false, 'senza rete dei salti il comportamento precedente resta invariato');
});

// ---------------------------------------------------------------- 9. Centaurus
test('MD-9 Centaurus: 240 SCU, cassa 32, viaggi e casse incompatibili', () => {
  assert.equal(CENT.scu, 240); assert.equal(CENT.maxBox, 32);
  const r = findMissions(VIEWS, { from: { id: 'sa' }, ship: CENT, includeIncompatible: true }, { geo, links: LINKS }).rows;
  const by = (u) => r.find((x) => x.v.uuid === u);
  assert.equal(by('fix1').fit, 'ok'); assert.equal(by('fix1').trips, 1);
  assert.equal(by('bigbox').fit, 'viaggi'); assert.equal(by('bigbox').trips, 2);
  assert.equal(by('huge').fit, 'cassa', 'casse da 64 SCU non entrano');
  assert.ok(!findMissions(VIEWS, { from: { id: 'sa' }, ship: CENT }, { geo, links: LINKS }).rows.some((x) => x.v.uuid === 'huge'));
  assert.equal(maxBoxFromGrid([7.5, 5, 12.5]), 32); assert.equal(maxBoxFromGrid([2.5, 2.5, 2.5]), 8); assert.equal(maxBoxFromGrid(null), null);
  assert.deepEqual(cargoOf(V('bigbox')), { scu: 425, scuMin: 100, box: 32 });
});

// ---------------------------------------------------------------- 10. contratti personali in IndexedDB
test('MD-10 contratto visto nel MobiGlas: salvato con riferimento al modello, dati esistenti intatti', async () => {
  const db = await LogisticsDB.open();
  const mine = normalizeContract({ title: 'Mio contratto', status: 'accettata', system: 'stanton', reward: 1000, patch: '9.9.0', movements: [{ scu: 10, from: { name: 'Base Alfa' }, to: { name: 'Stazione Charlie' } }] }).contract;
  await db.putContracts([mine]); await db.setMeta('atlasUi', { sel: ['x'] });
  const v = V('pool3');
  const o = observedInput(v, { status: 'accettata', reward: '41000', offer: 'Stazione Charlie', movements: [{ cargo: 'Rame', scu: '60', containerMax: '16', from: 'Base Bravo', to: 'Stazione Charlie' }] }, { geo, patch: '9.9.0' });
  const r = normalizeContract(o.input);
  assert.ok(r.contract, r.errors.join());
  assert.equal(r.contract.catalogRef.id, 'scu:pool3'); assert.equal(r.contract.catalogRef.uuid, 'pool3');
  assert.equal(r.contract.movements[0].from.name, 'Base Bravo', 'ritiro scelto da te fra le alternative del pool');
  await db.putContracts([r.contract]);
  // fuori pool: avviso, non errore (il pool del catalogo può essere di un'altra patch)
  assert.ok(observedInput(v, { movements: [{ scu: '5', from: 'Base Pyro', to: 'Stazione Charlie' }] }, { geo }).warnings.some((w) => /non è fra i 3 luoghi/.test(w)));
  // il catalogo salvato per l'uso offline non tocca contratti e preferenze
  const fetchJson = async (u) => (u.endsWith('index.json') ? { file: 'catalog-x.json', patch: PATCH } : DB);
  await loadMissionDb({ fetchJson, getMeta: (k) => db.getMeta(k), setMeta: (k, x) => db.setMeta(k, x) });
  const db2 = await LogisticsDB.open();
  const all = await db2.contracts();
  assert.deepEqual(all.map((c) => c.title).sort(), ['Mio contratto', 'Trasporto pool3']);
  assert.deepEqual(await db2.getMeta('atlasUi'), { sel: ['x'] });
  assert.equal((await db2.getMeta(SNAP_KEY)).cat.missions.length, DB.missions.length);
});

// ---------------------------------------------------------------- 11. aggiornamento fallito
test('MD-11 aggiornamento fallito: resta l\'ultimo catalogo valido, segnalato come snapshot precedente', async () => {
  const prev = { idx: { file: 'catalog-old.json', patch: PATCH, history: [] }, cat: DB };
  const small = { ...DB, missions: DB.missions.slice(0, 3), meta: { ...DB.meta } };
  const check = validateCatalog(small, DB, { minMissions: 1 });
  assert.equal(check.ok, false); assert.match(check.errors.join(), /scese da/);
  const pub = publishMissions({ db: small, prev, check, sources: { wiki: { ok: false, error: 'HTTP 503' } }, fetchedAt: 'T' });
  assert.equal(pub.ok, false);
  assert.deepEqual(pub.files.map(([n]) => n), ['catalog-old.json', 'index.json']);
  assert.match(pub.files[1][1].fallback.note, /snapshot precedente/);
  assert.equal(publishMissions({ db: small, prev: null, check, fetchedAt: 'T' }).files.length, 0, 'nessuno snapshot: nulla di inventato');
  const ok = publishMissions({ db: DB, prev, check: validateCatalog(DB, DB, { minMissions: 1 }), fetchedAt: 'T', liveDefault: PATCH });
  assert.equal(ok.ok, true); assert.equal(ok.files[1][1].fallback, null); assert.deepEqual(ok.files[1][1].diff, diffCatalog(DB, DB));
  // nel browser: sito irraggiungibile -> copia locale dichiarata; senza copia -> catalogo assente
  const meta = new Map([[SNAP_KEY, { at: '2026-11-01T00:00:00Z', index: { file: 'catalog-old.json', liveDefault: PATCH }, cat: DB }]]);
  const io = { fetchJson: async () => { throw new Error('offline'); }, getMeta: async (k) => meta.get(k) ?? null, setMeta: async () => {} };
  const res = await loadMissionDb(io);
  assert.equal(res.from, 'copia locale'); assert.ok(res.warnings[0].includes('2026-11-01'));
  const pv = provenance(res);
  assert.equal(pv.stale, true); assert.match(pv.text, /COPIA LOCALE/); assert.equal(pv.missions, DB.missions.length); assert.equal(pv.build, '1000');
  const none = await loadMissionDb({ ...io, getMeta: async () => null });
  assert.equal(none.cat, null); assert.equal(provenance(none).ok, false);
  // indice pubblicato in fallback: avviso esplicito anche quando il sito risponde
  const fb = await loadMissionDb({ fetchJson: async (u) => (u.endsWith('index.json') ? pub.files[1][1] : DB), getMeta: async () => null, setMeta: async () => {} });
  assert.ok(fb.warnings.some((w) => /Ultimo aggiornamento non riuscito/.test(w)));
  assert.ok(fb.warnings.some((w) => /Wiki API non raggiungibile/.test(w)));
});

// ---------------------------------------------------------------- 12. regressione: plancia, mappa, classi
test('MD-12 classificazione: nessuna missione DISPONIBILE ORA senza una fonte personale', () => {
  assert.ok(!Object.values(CLASS).some((c) => /DISPONIBILE ORA/.test(c.label)));
  assert.equal(classify(V('fix1'), {}).cls, 'potenziale');
  assert.equal(classify(V('ranked'), {}).cls, 'catalogata', 'grado non dichiarato');
  assert.equal(classify(V('ranked'), { ranks: { 'Compagnia Sintetica': 3 } }).cls, 'potenziale');
  assert.equal(classify({ origin: 'utente', status: 'accettata' }).cls, 'accettata');
  assert.equal(classify({ origin: 'utente', status: 'osservata' }).cls, 'osservata');
  assert.equal(classify({ origin: 'utente', status: 'fallita' }).cls, 'fallita');
  assert.equal(classify({ origin: 'storica' }).cls, 'storica');
  assert.deepEqual(parseArea('Pyro', geo), { system: 'pyro', label: 'Pyro' });
  assert.ok(parseArea('Luogo che non esiste', geo).error);
});

test('MD-12 mappa del Command Bridge: geometria reale distinta da indicazioni schematiche', () => {
  const pos = { system: 'stanton', x: 9 * GM, y: 0, z: 0 };
  // destinazione in Pyro: linea SCHEMATICA verso il gateway, nessuna linea fra sistemi
  const s1 = bridgeScene({ geo, system: 'stanton', position: pos, destination: { id: 'pa', name: 'Base Pyro', system: 'pyro', pos: geo.get('pa').pos }, links: LINKS, missions: [] });
  assert.deepEqual(s1.lines.map((l) => l.style), ['regionale']);
  assert.equal(s1.lines[0].b, geo.get('gsp').pos);
  assert.ok(s1.items.some((i) => i.id === '__pos'));
  assert.ok(!s1.items.some((i) => i.system !== 'stanton'));
  // stesso sistema senza rotta: linea retta dichiarata; con rotta del pianificatore: solo tratte reali
  const dest = { id: 'sc', name: 'Stazione Charlie', system: 'stanton', pos: geo.get('sc').pos };
  assert.deepEqual(bridgeScene({ geo, system: 'stanton', position: pos, destination: dest, links: LINKS }).lines.map((l) => l.style), ['possibile']);
  const plan = { inputs: { target: { name: 'Stazione Charlie' } }, path: [{ kind: 'qt', system: 'stanton', from: { name: 'A', pos: [9 * GM, 0, 0] }, to: { name: 'Stazione Charlie', pos: [12 * GM, 0, 0] }, drop: null }, { kind: 'jump', system: 'pyro', from: null, to: null }] };
  const s2 = bridgeScene({ geo, system: 'stanton', position: pos, destination: dest, lastPlan: plan, links: LINKS });
  assert.deepEqual(s2.lines.map((l) => l.style), ['navcom']);
  assert.equal(nextLeg(plan, dest).to, 'Stazione Charlie'); assert.equal(nextLeg(plan, { name: 'Altro' }).matches, false);
  // missioni: fisse = ipotetica (catalogo), pool = non verificata, interstellare = schematica verso il gateway
  const s3 = bridgeScene({ geo, system: 'stanton', missions: [V('fix1'), V('pool3'), V('inter')], links: LINKS });
  const st = s3.lines.map((l) => `${l.id}:${l.style}`);
  assert.ok(st.includes('ms:scu:fix1:ipotetica')); assert.ok(st.includes('ms:scu:pool3:nonverificata')); assert.ok(st.includes('ms:scu:inter:regionale'));
  // senza posizione: la scena c'e' lo stesso (pianeti, stazioni, gateway)
  const s4 = bridgeScene({ geo, system: 'pyro', links: LINKS });
  assert.deepEqual(s4.items.map((i) => i.kind).sort(), ['gateway', 'gateway']); assert.equal(s4.lines.length, 0);
  assert.ok(bridgeScene({ geo, system: 'pyro', links: LINKS, outposts: true }).items.some((i) => i.id === 'pa'), 'avamposti a richiesta');
});
