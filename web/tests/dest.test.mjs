// DESTINATION INTELLIGENCE (0.8.0): test con DATI SINTETICI. Verificano la correttezza del SOFTWARE
// (nessuna deduzione, nessun servizio ereditato, campi mancanti dichiarati, abbinamenti prudenti).
// L'accuratezza dei DATI delle fonti non si verifica qui: vedi il collaudo su dati reali in docs/DESTINATIONS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Geo } from '../js/atlas/geo.js';
import { buildGameInfo, buildMining, buildEnvironment, buildUexPlaces, buildMarket, buildExpeditionShips, makeResolver, makeSuggester, smNameCandidates } from '../js/dest/build.js';
import { DestIndex, ND, DV, searchKey, itemCategory } from '../js/dest/model.js';

const GM = 1e9;
const place = (id, name, kind, system, parentId, pos, extra = {}) => ({ id, name, aliases: [], type: kind, kind, system, parentId, pos, frame: 'sistema (statico)', hidden: false, qtValid: true, radius: null, services: [], source: 'sintetico', patch: 'SYN', ...extra });
const PL = { x: 10 * GM, y: 0, z: 0 };
const PLACES = [
  place('st', 'Sole Sintetico', 'star', 'stanton', null, { x: 0, y: 0, z: 0 }),
  place('pl', 'Pianeta Uno', 'planet', 'stanton', 'st', PL, { radius: 1e6 }),
  place('mo', 'Luna Gelida', 'moon', 'stanton', 'pl', { x: PL.x + 5e7, y: 0, z: 0 }, { radius: 3e5 }),
  place('city', 'Citta Uno', 'city', 'stanton', 'pl', { x: PL.x + 1e6, y: 0, z: 0 }),
  place('out', 'Avamposto Commercio', 'outpost', 'stanton', 'pl', { x: PL.x, y: 1e6, z: 0 }),
  place('sta', 'Stazione Orbitale', 'station', 'stanton', 'pl', { x: PL.x + 1.2e6, y: 0, z: 0 }),
  place('dup1', 'Gemella', 'outpost', 'stanton', 'mo', { x: PL.x + 5e7 + 3e5, y: 0, z: 0 }),
  place('pst', 'Sole Pyro', 'star', 'pyro', null, { x: 0, y: 0, z: 0 }),
  place('ppl', 'Pyro I', 'planet', 'pyro', 'pst', { x: 3 * GM, y: 0, z: 0 }, { radius: 5e5 }),
  place('ruin', 'Rovina', 'station', 'pyro', 'ppl', { x: 3 * GM + 7e5, y: 0, z: 0 }),
  place('dup2', 'Gemella', 'outpost', 'pyro', 'ppl', { x: 3 * GM, y: 5e5, z: 0 }),
];
const geo = new Geo(PLACES);
const resolveFull = makeResolver(geo); const resolveId = (n, s) => resolveFull(n, s)?.id ?? null;

const STARMAP = [
  { UUID: 'sta', Name: 'Stazione Orbitale', Description: 'Stazione con servizi.', Amenities: [{ Name: 'Hangar L' }, { Name: 'Landing Pad M' }, { Name: 'Docking' }, { Name: 'Clinic' }, { Name: 'Commodity Trading - Freight Elevator' }], RespawnLocationType: 'Hospital', Jurisdiction: null, Type: { Name: 'Manmade' } },
  { UUID: 'city', Name: 'Citta Uno', Description: '<= PLACEHOLDER =>', Amenities: [{ Name: 'Hangar XL' }, { Name: 'Refinery' }, { Name: 'Clinic' }], RespawnLocationType: 'Hospital', Jurisdiction: null, Type: { Name: 'LandingZone' } },
  { UUID: 'pl', Name: 'Pianeta Uno', Amenities: [], Jurisdiction: { Name: 'Giurisdizione Uno', BaseFine: 125, MaxStolenGoodsPossessionScu: 1 }, RespawnLocationType: 'None', Type: { Name: 'Planet' } },
  { UUID: 'ruin', Name: 'Rovina', Amenities: [{ Name: 'Hangar L' }], Jurisdiction: { Name: 'Banda Libera', BaseFine: 0, MaxStolenGoodsPossessionScu: 1 }, RespawnLocationType: 'Other', Type: { Name: 'Manmade' } },
];
const OC = {
  Stanton: [
    { ObjectContainer: 'Pianeta Uno', Type: 'Planet', SurfaceMinTemp: -20, SurfaceMaxTemp: 30, AtmosphereBreathable: null, AtmosphericComposition: 'N 78 %, O2 21 %', AtmosphereHeight: 30000, Gravitation: 1, Comment: 'Updated Alpha 4.1', Submitted: '2026-04-06' },
    { ObjectContainer: 'Luna Gelida', Type: 'Moon', SurfaceMinTemp: -200, SurfaceMaxTemp: -100, AtmosphereBreathable: 0, AtmosphericComposition: null, Gravitation: 1 },
  ],
  Pyro: [{ ObjectContainer: 'Pyro1', Type: 'Planet', SurfaceMinTemp: 220, SurfaceMaxTemp: 230, AtmosphereBreathable: 0, Gravitation: 1 }, { ObjectContainer: 'Inesistente', Type: 'Planet', Gravitation: 1 }, { ObjectContainer: 'Altro', Type: 'Moon', Gravitation: 1 }],
};
const UEX = {
  space_stations: [
    { id: 1, name: 'Stazione Orbitale', star_system_name: 'Stanton', planet_name: 'Pianeta Uno', is_armistice: 1, is_landable: 1, has_refuel: 1, has_repair: 1, has_clinic: 1, has_habitation: 1, has_freight_elevator: 1, pad_types: 'S,M,L', date_modified: 1790000000, faction_name: 'UEE', jurisdiction_name: 'Giurisdizione Uno' },
    { id: 2, name: 'Rovina', star_system_name: 'Pyro', planet_name: 'Pyro I', is_armistice: 1, has_refuel: 1, date_modified: 1790000000 },
    { id: 3, name: 'Gemella', star_system_name: 'Stanton', is_armistice: 0, date_modified: 1790000000 },
    { id: 4, name: 'Stazione Orbitale (Stanton)', star_system_name: 'Stanton', date_modified: 1790000000 },
  ],
  cities: [{ id: 1, name: 'Citta Uno', star_system_name: 'Stanton', is_armistice: 1, has_refinery: 1, date_modified: 1790000000 }],
  outposts: [
    { id: 7, name: 'Avamposto Commercio', star_system_name: 'Stanton', planet_name: 'Pianeta Uno', is_armistice: 0, has_trade_terminal: 1, date_modified: 1790000000 },
    { id: 8, name: 'Avamposto', star_system_name: 'Stanton', date_modified: 1790000000 },
  ],
  poi: [],
  terminals: [
    { id: 100, name: 'Admin - Avamposto', type: 'commodity', star_system_name: 'Stanton', id_outpost: 7, is_auto_load: 0, has_freight_elevator: 0, max_container_size: 16, game_version: '4.1', date_modified: 1790000000 },
    { id: 101, name: 'Negozio - Stazione', type: 'item', star_system_name: 'Stanton', id_space_station: 1, is_shop_fps: 1, date_modified: 1790000000 },
    { id: 102, name: 'Carburante - Stazione', type: 'fuel', star_system_name: 'Stanton', id_space_station: 1, is_refuel: 1, date_modified: 1790000000 },
    { id: 103, name: 'Admin - Rovina', type: 'commodity', star_system_name: 'Pyro', id_space_station: 2, date_modified: 1790000000 },
    { id: 104, name: 'Admin - Citta', type: 'commodity', star_system_name: 'Stanton', id_city: 1, date_modified: 1790000000 },
  ],
  categories: [{ id: 1, type: 'item', section: 'Utility', name: 'Mining Modules' }, { id: 2, type: 'item', section: 'Armor', name: 'Helmets' }, { id: 3, type: 'item', section: 'Personal Weapons', name: 'Rifles' }],
  commodities: [{ id: 1, name: 'Oro', is_illegal: 0 }, { id: 2, name: 'Sostanza Vietata', is_illegal: 1 }],
  items_prices_all: [
    { id_item: 10, id_category: 1, id_terminal: 101, price_buy: 8000, price_sell: 0, item_name: 'Modulo Helix Sintetico', date_modified: 1790000000 },
    { id_item: 11, id_category: 2, id_terminal: 101, price_buy: 1200, item_name: 'Casco Prova', date_modified: 1700000000 },
    { id_item: 12, id_category: 3, id_terminal: 103, price_buy: 5000, item_name: 'Sintetico P9 Rifle', date_modified: 1790000000 },
  ],
  commodities_prices_all: [
    { id_commodity: 1, id_terminal: 100, price_buy: 0, price_sell: 6000, scu_sell: 50, container_sizes: '1,2,4,8,16', date_modified: 1790000000 },
    { id_commodity: 1, id_terminal: 104, price_buy: 0, price_sell: 6500, scu_sell: 0, date_modified: 1790000000 },
    { id_commodity: 1, id_terminal: 103, price_buy: 0, price_sell: 9000, scu_sell: 10, date_modified: 1790000000 },
    { id_commodity: 2, id_terminal: 103, price_buy: 100, price_sell: 0, date_modified: 1790000000 },
  ],
  fuel_prices_all: [{ commodity_name: 'Hydrogen Fuel', id_terminal: 102, price_buy: 800, date_modified: 1790000000 }, { commodity_name: 'Quantum Fuel', id_terminal: 102, price_buy: 1800, date_modified: 1790000000 }],
};
const RES = [
  { UUID: 'r1', Name: '<= PLACEHOLDER =>', Kind: 'mineable', Key: 'MineableRock_SurfaceCommon_Iron', Composition: { DepositName: 'Iron (Ore)', Parts: [{ Name: 'Iron (Ore)' }, { Name: 'Quantainium (Raw)' }] } },
  { UUID: 'r2', Name: 'Hadanite', Kind: 'mineable' },
  { UUID: 'r3', Name: 'Rottame', Kind: 'salvageable' },
];
const LOCS = [
  { Provider: { Name: 'HPP_Pianeta' }, Locations: [{ System: 'Stanton', Name: 'Pianeta Uno', Type: 'planet' }], Groups: [{ GroupName: 'SpaceShip_Mineables', Deposits: [{ ResourceUUID: 'r1' }] }, { GroupName: 'FPS_Mineables', Deposits: [{ ResourceUUID: 'r2' }] }, { GroupName: 'Salvage_FreshDerelicts', Deposits: [{ ResourceUUID: 'r3' }] }] },
  { Provider: { Name: 'Sconosciuto' }, Locations: [{ System: 'Stanton', Name: 'Nessun Luogo', Type: 'cave' }], Groups: [{ GroupName: 'FPS_Mineables', Deposits: [{ ResourceUUID: 'r2' }] }] },
];
const SHIPS = [
  { ClassName: 'RSI_Constellation_Mk5_Centaurus', Name: 'RSI Constellation Mk V Centaurus', IsSpaceship: true, Cargo: 240, Role: 'Medium Freight', Career: 'Multi-Role', Propulsion: { FuelCapacity: 46800 }, QuantumTravel: { FuelCapacity: 8600, Range: 848e9 } },
  { ClassName: 'MISC_Prospector', Name: 'MISC Prospector', IsSpaceship: true, Cargo: 0, Role: 'Light Mining', Career: 'Industrial', Propulsion: { FuelCapacity: 5300 }, QuantumTravel: { FuelCapacity: 900, Range: 155e9 } },
  { ClassName: 'X_Display', Name: 'Esposizione', IsSpaceship: true },
];

function world({ personal = [], links = {}, withMarket = true } = {}) {
  const uex = buildUexPlaces(UEX, { resolve: resolveFull, suggest: makeSuggester(geo) });
  const dest = {
    meta: { patch: 'SYN-1', sources: {} },
    game: buildGameInfo(STARMAP),
    env: buildEnvironment(OC, { resolve: resolveId, fetchedAt: '2026-11-09T00:00:00Z' }),
    smPois: { byPlace: {} },
    mining: buildMining(LOCS, RES, { resolve: resolveId, patch: 'SYN-1' }),
    uex,
  };
  return new DestIndex({ geo, dest, market: withMarket ? buildMarket(UEX) : null, ships: buildExpeditionShips(SHIPS), personal, links });
}
const PERSONAL = [
  { id: 'a1', name: 'Grotta Segnata', system: 'Stanton', body: 'Luna Gelida', lat: 12.5, lon: 40, status: 'Da verificare', category: 'Mining', resource: 'Hadanite', notes: 'da controllare' },
  { id: 'a2', name: 'Punto Nel Vuoto', system: 'Stanton', x: 4000000, y: 3000000, z: 0, unit: 'km', status: 'Da verificare', category: 'Altro' },
  { id: 'a3', name: 'Vicino Avamposto', system: 'Stanton', x: (PL.x) / 1000, y: (1e6 + 2000) / 1000, z: 0, unit: 'km', status: 'Verificato', resource: 'Hadanite' },
];
const f = (rows, key) => rows.find((r) => r.key === key);
const svc = (card, key) => card.services.find((r) => r.key === key);

test('DI-1 pianeta: atmosfera, temperature e gravità con fonte; respirabilità MAI dedotta dalla presenza di atmosfera', () => {
  const ix = world(); const c = ix.card('pl');
  assert.equal(c.ctx.mode, 'corpo');
  assert.match(f(c.env.exterior, 'atm').value, /presente/);
  assert.equal(f(c.env.exterior, 'breath').value, null, 'atmosfera presente ma respirabilità non indicata: resta vuota');
  assert.match(f(c.env.exterior, 'breath').note, /NON implica/);
  assert.equal(f(c.env.survival, 'helmet').display, DV);
  assert.equal(f(c.env.exterior, 'tmin').value, '-20 °C');
  assert.equal(f(c.env.exterior, 'tmin').sourceLabel.includes('starmap.space'), true);
  assert.equal(f(c.env.exterior, 'press').value, null); assert.equal(f(c.env.exterior, 'press').display, ND);
  assert.equal(f(c.env.exterior, 'grav').value, null, 'gravità 1 g per tutti i corpi: scartata come valore predefinito');
  assert.match(f(c.env.exterior, 'grav').note, /predefinito/);
  const moon = ix.card('mo');
  assert.equal(f(moon.env.exterior, 'breath').value, 'no');
  assert.equal(f(moon.env.survival, 'helmet').status, 'documentata');
});

test('DI-2 stazione orbitale: hangar e servizi per fonte, ambiente esterno del pianeta NON applicato, interno da verificare', () => {
  const c = world().card('sta');
  assert.equal(c.ctx.mode, 'orbita');
  assert.equal(c.env.exterior.length, 0, 'le temperature del pianeta non valgono per una stazione in orbita');
  assert.match(c.env.exteriorNote, /non valgono qui/);
  assert.equal(c.env.interior[0].display, DV);
  assert.match(svc(c, 'hangar').values[0].value, /taglia L/);
  assert.match(svc(c, 'pad').note, /non dice se la tua nave ci sta/);
  assert.ok(svc(c, 'pad').values.some((v) => v.value === 'S,M,L' && v.status === 'segnalata'));
  assert.ok(svc(c, 'fe').values.some((v) => v.source === 'scu' && /sì/.test(v.value)));
  assert.ok(svc(c, 'h2').values.some((v) => /800/.test(v.value) && v.dynamic));
  assert.ok(svc(c, 'qt').values.some((v) => /1800/.test(v.value)));
  assert.equal(svc(c, 'rearm').values[0].display, DV, 'riarmo non distinguibile dalla riparazione: non dedotto');
  assert.match(svc(c, 'respawn').values[0].value, /ospedale/);
});

test('DI-3 avamposto commerciale: terminali, prezzi datati, nessun servizio ereditato dalla città vicina', () => {
  const ix = world(); const c = ix.card('out');
  assert.deepEqual(c.terminals.map((t) => t.id), [100]);
  const tr = ix.tradeOf(c);
  assert.equal(tr.length, 1); assert.equal(tr[0].sell, 6000); assert.ok(tr[0].date);
  assert.ok(!svc(c, 'refinery').values.some((v) => v.value && /sì/.test(v.value)), 'la raffineria della città non passa all\'avamposto');
  assert.ok(!svc(c, 'hangar').values.some((v) => v.value), 'l\'hangar XL della città non passa all\'avamposto');
  assert.equal(f(c.security, 'jur').value, 'Giurisdizione Uno'); assert.match(f(c.security, 'jur').note, /ereditata da Pianeta Uno/);
  assert.equal(f(c.security, 'armU').value, 'no');
});

test('DI-4 località di Pyro: giurisdizione dai file di gioco, armistizio solo da fonte, livello di sicurezza mai dedotto', () => {
  const ix = world(); const c = ix.card('ruin');
  assert.equal(f(c.security, 'jur').value, 'Banda Libera');
  assert.equal(f(c.security, 'fine').value, '0 aUEC');
  assert.equal(f(c.security, 'armU').value, 'sì'); assert.equal(f(c.security, 'armU').status, 'segnalata');
  assert.match(f(c.security, 'armU').note, /non per le zone circostanti/);
  assert.equal(f(c.security, 'sec').value, null); assert.match(f(c.security, 'sec').note, /non si ricava/);
  assert.match(f(c.security, 'illegal').value, /Sostanza Vietata/);
  assert.equal(f(c.security, 'fps').status, 'ipotetica', 'armi bloccate: regola del gioco, etichettata come calcolata');
  // senza armistizio documentato: sconosciuto, mai "sicuro"
  const p = ix.card('ppl');
  assert.equal(f(p.security, 'arm').display, 'SCONOSCIUTO');
  assert.ok(!JSON.stringify(p.security).includes('sicura"'));
  assert.equal(f(p.env.exterior, 'tmin').value, '220 °C', 'Pyro1 di starmap.space abbinato a Pyro I');
});

test('DI-5 punto XYZ casuale nello spazio: nessun ambiente planetario, nessun servizio, distanze reali dalle strutture', () => {
  const ix = world({ personal: PERSONAL }); const c = ix.card('pt:a2');
  assert.equal(c.ctx.mode, 'spazio');
  assert.equal(c.env.exterior.length, 0); assert.equal(c.env.interior, null);
  assert.equal(c.services.length, 0); assert.equal(c.terminals.length, 0);
  assert.ok(c.nearby.length > 0 && c.nearby.every((n, i, a) => i === 0 || a[i - 1].d <= n.d));
  assert.equal(f(c.env.survival, 'helmet').status, 'ipotetica');
  assert.equal(f(c.env.survival, 'thermal').display, DV);
  assert.ok(c.missing.length > 10);
  assert.equal(c.mining, null, 'nessuna risorsa attribuita a un punto lontano dai corpi');
});

test('DI-6 punto personale SENZA XYZ: scheda dal corpo indicato, niente rotta, coordinate planetarie non convertite', () => {
  const ix = world({ personal: PERSONAL }); const c = ix.card('pt:a1');
  assert.equal(c.xyz, null);
  assert.equal(c.ctx.body.id, 'mo'); assert.match(c.ctx.note, /non convertite in XYZ/);
  assert.equal(f(c.env.exterior, 'breath').value, 'no');
  assert.equal(f(c.own, 'res').status, 'ipotetica'); assert.match(f(c.own, 'res').note, /sperimentale/);
  const near = ix.card('pt:a3');
  assert.equal(f(near.own, 'res').status, 'verificata');
  const s = ix.search('grotta'); assert.equal(s[0].id, 'pt:a1'); assert.match(s[0].kindLabel, /senza XYZ/);
});

test('DI-7 omonimi: entrambi trovati con sistema e corpo; abbinamento UEX ambiguo NON unito', () => {
  const ix = world(); const r = ix.search('Gemella');
  const geoHits = r.filter((x) => x.origin === 'geo');
  assert.equal(geoHits.length, 2); assert.ok(geoHits.every((x) => x.homonyms >= 1));
  assert.deepEqual(new Set(geoHits.map((x) => x.systemLabel)), new Set(['Stanton', 'Pyro']));
  assert.ok(geoHits.some((x) => x.body === 'Luna Gelida') && geoHits.some((x) => x.body === 'Pyro I'));
  const u = ix.uexLocs['station:3'];
  assert.equal(u.placeId, 'dup1', 'nello stesso sistema il nome è univoco: abbinato');
  const part = ix.uexLocs['outpost:8'];
  assert.equal(part.placeId, null, '"Avamposto" è solo l\'inizio di "Avamposto Commercio": mai abbinato da solo');
  assert.deepEqual(part.candidates, ['out']); assert.equal(part.candidatesWhy, 'nome parziale');
  assert.equal(ix.uexLocs['station:4'].placeId, 'sta', '"(Stanton)" ripete il sistema: abbinato senza parentesi');
  const card = ix.card('uex:outpost:8'); assert.equal(card.candidates[0].id, 'out');
});

test('DI-8 collegamento confermato da te: i dati UEX passano alla scheda; i punti personali non cambiano', () => {
  const pers = structuredClone(PERSONAL);
  const ix = world({ personal: pers, links: { 'outpost:8': 'out' } });
  assert.ok(ix.uexByPlace.get('out').some((l) => l.key === 'outpost:8'));
  assert.ok(!ix.search('Avamposto').some((r) => r.id === 'uex:outpost:8'), 'una volta confermato non resta come voce separata');
  ix.card('pt:a1'); ix.card('pt:a2'); ix.prepare(ix.card('pt:a2'), null);
  assert.deepEqual(pers, PERSONAL, 'il modulo non modifica i record del DATABASE PUNTI');
});

test('DI-9 ricerca: abbreviazioni, numeri romani, compatto, sistema obbligatorio nel risultato', () => {
  const ix = world();
  assert.equal(searchKey('Pyro 1'), searchKey('Pyro I'));
  assert.equal(ix.search('pyro 1')[0].id, 'ppl');
  assert.equal(ix.search('stazioneorbitale')[0].id, 'sta');
  for (const r of ix.search('a')) { assert.ok(r.systemLabel); assert.ok(r.kindLabel); }
  assert.deepEqual(smNameCandidates('Pyro1'), ['Pyro1', 'Pyro I']);
});

test('DI-10 CERCA ARTICOLO: catalogo segnalato con data, mai disponibilità in tempo reale; RAGGIUNGI solo con XYZ', () => {
  const ix = world(); const r = ix.findItem('helix');
  assert.equal(r.length, 1); assert.equal(r[0].placeName, 'Stazione Orbitale'); assert.equal(r[0].buy, 8000); assert.ok(r[0].date);
  assert.equal(r[0].cat, 'Laser e moduli minerari');
  assert.equal(ix.geo.get(r[0].place).pos !== null, true);
  const shops = ix.shopsOf(ix.card('sta'), { sort: 'prezzo' });
  assert.deepEqual(shops.map((s) => s.item), ['Casco Prova', 'Modulo Helix Sintetico']);
  assert.equal(shops[0].cat, 'Caschi');
  const src = readFileSync(new URL('../js/ui-dest.js', import.meta.url), 'utf8');
  assert.match(src, /NON è garantito disponibile adesso/);
  assert.equal(itemCategory({ section: 'Personal Weapons', name: 'Attachments' }, 'P4 Magazine (30 cap)')[0], 'munizioni');
});

test('DI-11 DOVE POSSO VENDERE: prezzi crowdsourced non garantiti, distanza solo nello stesso sistema', () => {
  const ix = world(); const res = ix.whereToSell('Oro', { scu: 20, from: 'sta' });
  assert.match(res.note, /non garantiti/);
  assert.deepEqual(res.rows.map((r) => r.sell), [9000, 6500, 6000]);
  const pyro = res.rows.find((r) => r.system === 'pyro');
  assert.equal(pyro.distance, null); assert.match(pyro.distNote, /altro sistema/);
  const out = res.rows.find((r) => r.terminalId === 100);
  assert.ok(out.distance > 0); assert.match(out.demandNote, /50 SCU/);
  assert.equal(res.rows.find((r) => r.terminalId === 104).demandNote, 'domanda non segnalata', 'domanda 0 nella fonte = non segnalata, non "zero"');
  assert.equal(out.total, 120000);
});

test('DI-12 mining: tabelle di generazione, mai giacimenti; recupero relitti escluso; luoghi non abbinati elencati', () => {
  const m = buildMining(LOCS, RES, { resolve: resolveId });
  const g = m.byPlace.pl[0].groups;
  assert.deepEqual(g.map((x) => x.kind), ['ship', 'fps']);
  assert.deepEqual(g[0].materials.map((x) => x.name), ['Iron', 'Quantainium']);
  assert.equal(m.unmatched[0].name, 'Nessun Luogo');
  const ix = world({ personal: PERSONAL }); const c = ix.card('out');
  assert.match(c.mining.note, /non è un giacimento confermato/);
  assert.equal(c.mining.regionalBody.id, 'pl');
  assert.equal(c.mining.refineries[0].id, 'city');
  assert.ok(c.personalNear.some((p) => p.id === 'pt:a3' && !p.sperimentale));
});

test('DI-13 PREPARA SPEDIZIONE: tre gruppi, nessun obbligo senza fonte, dati della nave dai file di gioco', () => {
  const ix = world();
  const cent = ix.ships.find((s) => /Centaurus/.test(s.name)); const pros = ix.ships.find((s) => /Prospector/.test(s.name));
  assert.ok(!ix.ships.some((s) => s.name === 'Esposizione'));
  const r = ix.prepare(ix.card('mo'), cent, { activity: 'trasporto', fromId: 'sta' });
  assert.ok(r.documented.some((x) => /Casco: necessario all'esterno/.test(x.text) && x.source));
  assert.ok(r.advice.some((x) => /Nessun rifornimento documentato/.test(x.text)));
  assert.ok(r.missing.some((x) => /Pressione/.test(x.text)));
  assert.ok(r.documented.some((x) => /Andata e ritorno/.test(x.text)));
  assert.ok(![...r.documented, ...r.advice].some((x) => /obbligatori/i.test(x.text)));
  const m = ix.prepare(ix.card('pl'), pros, { activity: 'mining_nave' });
  assert.ok(m.documented.some((x) => /Iron, Quantainium/.test(x.text) && /Non sono giacimenti confermati/.test(x.text)));
  const wrong = ix.prepare(ix.card('pl'), cent, { activity: 'mining_nave' });
  assert.ok(wrong.advice.some((x) => /non risulta una nave mineraria/.test(x.text)));
  const none = ix.prepare(ix.card('ppl'), null);
  assert.ok(none.missing.some((x) => /Nave non selezionata/.test(x.text)));
});

test('DI-14 dati mancanti: scheda funzionante senza prezzi e senza ambiente; ogni assenza dichiarata', () => {
  const ix = world({ withMarket: false }); const c = ix.card('city');
  assert.equal(ix.shopsOf(c), null); assert.equal(ix.findItem('helix'), null);
  assert.equal(c.description, null, 'descrizione segnaposto del gioco scartata');
  const bare = new DestIndex({ geo, dest: {} });
  const b = bare.card('out');
  assert.ok(b.missing.length > 20);
  assert.equal(f(b.env.exterior, 'tmin').display, ND);
  assert.ok(b.services.every((r) => r.values.every((v) => v.value === null)));
});

test('DI-15 aggiornamenti: build tollerante a fonti vuote, nessuna chiave API nel codice pubblico, dati generati non versionati', () => {
  const empty = buildUexPlaces({}, {}); assert.deepEqual(empty, { locations: {}, terminals: {} });
  assert.deepEqual(buildMarket({}).itemPrices, []);
  assert.deepEqual(buildEnvironment({}, {}).byPlace, {});
  for (const f2 of ['../js/ui-dest.js', '../js/dest/model.js', '../js/dest/build.js', '../tools/fetch_destinations.mjs']) {
    const s = readFileSync(new URL(f2, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /Bearer\s|api[_-]?key\s*[:=]|secret|token\s*[:=]/i, f2);
  }
  assert.match(readFileSync(new URL('../data/.gitignore', import.meta.url), 'utf8'), /^destinations\/$/m);
  const wf = readFileSync(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(wf, /fetch_destinations\.mjs/);
  const tool = readFileSync(new URL('../tools/fetch_destinations.mjs', import.meta.url), 'utf8');
  assert.match(tool, /previous\('dest\.json'\)/, 'fonte giu\': si riusa l\'ultimo snapshot pubblicato');
});

test('DI-16 annotazioni e collegamenti in chiavi separate; l\'interfaccia non scrive nel DATABASE PUNTI', () => {
  const src = readFileSync(new URL('../js/ui-dest.js', import.meta.url), 'utf8');
  assert.match(src, /setMeta\('destNotes'/); assert.match(src, /setMeta\('destLinks'/); assert.match(src, /setMeta\('destSnapshot'/);
  assert.doesNotMatch(src, /\.put\(|\.putMany\(|\.delete\(|replaceAll\(/, 'nessuna scrittura sui punti');
});

test('DI-17 ricerca articoli in italiano: "fucile" trova i "Rifle" (nomi UEX in inglese)', () => {
  const ix = world();
  assert.deepEqual(ix.findItem('fucile').map((r) => r.item), ['Sintetico P9 Rifle']);
  assert.deepEqual(ix.findItem('rifle').map((r) => r.item), ['Sintetico P9 Rifle']);
  assert.equal(ix.findItem('fu').length, 0, 'sotto i 3 caratteri nessuna traduzione');
  assert.deepEqual(ix.shopsOf(ix.card('ruin'), { q: 'fucil' }).map((r) => r.item), ['Sintetico P9 Rifle']);
});
