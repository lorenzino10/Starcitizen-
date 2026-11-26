// 3.4.0: RESET SCELTE (home/reset.js) e scheda ESPLORA (atlas/explore.js). Dati sintetici, marcati come tali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESET_GROUPS, NEVER_TOUCHED, UNDO_KEY, plan, applyReset, undoReset, lastUndo } from '../js/home/reset.js';
import { explorerCard, fmtDuration, WEATHER } from '../js/atlas/explore.js';

// ---------------------------------------------------------------- archivi finti
class LS { constructor(o = {}) { this.m = new Map(Object.entries(o)); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
class Meta { constructor(o = {}) { this.m = new Map(Object.entries(o).map(([k, v]) => [k, structuredClone(v)])); } async getMeta(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : null; } async setMeta(k, v) { this.m.set(k, structuredClone(v)); } }
const SHIP = 'Crusader C2 Hercules Starlifter';
function fixture() {
  const ls = new LS({ 'navcom.layout': 'fold', 'navcom.atlas.gl': '0', 'navcom.settings': '{"margin":1.5,"system":"pyro"}', 'navcom.v1': '{"routes":[1,2,3]}', 'navcom.explore': '1' });
  const points = new Meta({
    homeState: { position: { system: 'pyro', x: 1 }, destination: { id: 'd' }, lastPlan: { a: 1 }, ship: SHIP, fleet: [{ id: 'f1', name: SHIP }], shipNotes: { [SHIP]: 'nota' }, bridge: { tab: 'cargo', mc: { ui: 'avanzata' } } },
    destRecent: [{ id: 'x' }], destFavorites: [{ id: 'fav' }], destVisits: [{ id: 'v' }], destNotes: { a: 'n' },
  });
  const logistics = new Meta({ atlasUi: { system: 'pyro', selected: 'p1', sel: ['m1'] }, settings: { ship: 'crus-c2-hercules', scu: 696, ranks: 'Covalex:3', prio: 'tempo', maxStops: 4, pos: 'Ruin Station' }, playerProfile: { crime: 2 }, mcRecords: [1] });
  return { ls, dbs: { points, logistics } };
}

test('RS-1 gruppi: le scelte sono il predefinito, il viaggio no; i dati personali sono dichiarati intoccabili', () => {
  assert.equal(RESET_GROUPS.view.def, true);
  assert.equal(RESET_GROUPS.trip.def, false);
  assert.ok(NEVER_TOUCHED.some((w) => /DATABASE PUNTI/.test(w)));
  assert.ok(NEVER_TOUCHED.some((w) => /reputazione/.test(w)));
  const keys = plan(['view', 'trip']).map((t) => t.local ?? t.meta);
  for (const k of ['navcom.v1', 'playerProfile', 'mcRecords', 'destFavorites', 'destVisits', 'destNotes']) assert.ok(!keys.includes(k), k);
});

test('RS-2 plan unisce i campi della stessa chiave meta', () => {
  const hs = plan(['view', 'trip']).find((t) => t.meta === 'homeState');
  assert.deepEqual(hs.fields.sort(), ['bridge', 'destination', 'lastPlan', 'position']);
  const st = plan(['view', 'trip']).find((t) => t.meta === 'settings');
  assert.ok(st.fields.includes('pos') && st.fields.includes('prio') && !st.fields.includes('ranks') && !st.fields.includes('ship'));
});

test('RS-3 reset delle scelte: via layout e filtri, restano dati, nave, flotta, gradi e posizione', async () => {
  const { ls, dbs } = fixture();
  const r = await applyReset({ groups: ['view'], ls, dbs });
  assert.ok(r.changed.length >= 5);
  assert.equal(ls.getItem('navcom.layout'), null);
  assert.equal(ls.getItem('navcom.settings'), null);
  assert.equal(ls.getItem('navcom.explore'), null);
  assert.equal(ls.getItem('navcom.v1'), '{"routes":[1,2,3]}', 'rotte e punti personali intatti');
  assert.equal(await dbs.logistics.getMeta('atlasUi'), null);
  const st = await dbs.logistics.getMeta('settings');
  assert.equal(st.prio, undefined); assert.equal(st.maxStops, undefined);
  assert.equal(st.ranks, 'Covalex:3'); assert.equal(st.ship, 'crus-c2-hercules'); assert.equal(st.pos, 'Ruin Station');
  const hs = await dbs.points.getMeta('homeState');
  assert.equal(hs.bridge, undefined);
  assert.equal(hs.ship, SHIP); assert.equal(hs.fleet.length, 1); assert.equal(hs.shipNotes[SHIP], 'nota');
  assert.deepEqual(hs.position, { system: 'pyro', x: 1 }, 'senza "viaggio" la posizione resta');
  assert.deepEqual(await dbs.logistics.getMeta('playerProfile'), { crime: 2 });
  assert.deepEqual(await dbs.points.getMeta('destRecent'), [{ id: 'x' }]);
});

test('RS-4 reset del viaggio: posizione, destinazione, rotta e recenti; preferiti e visite restano', async () => {
  const { ls, dbs } = fixture();
  await applyReset({ groups: ['trip'], ls, dbs });
  const hs = await dbs.points.getMeta('homeState');
  assert.equal(hs.position, undefined); assert.equal(hs.destination, undefined); assert.equal(hs.lastPlan, undefined);
  assert.deepEqual(hs.bridge, { tab: 'cargo', mc: { ui: 'avanzata' } }, 'le scelte non fanno parte del viaggio');
  assert.equal(await dbs.points.getMeta('destRecent'), null);
  assert.deepEqual(await dbs.points.getMeta('destFavorites'), [{ id: 'fav' }]);
  assert.equal((await dbs.logistics.getMeta('settings')).pos, undefined);
  assert.equal(ls.getItem('navcom.layout'), 'fold');
});

test('RS-5 annulla: rimette esattamente i valori di prima, poi la copia sparisce', async () => {
  const { ls, dbs } = fixture();
  const before = { hs: await dbs.points.getMeta('homeState'), st: await dbs.logistics.getMeta('settings'), at: await dbs.logistics.getMeta('atlasUi'), ls: [...ls.m] };
  await applyReset({ groups: ['view', 'trip'], ls, dbs, now: new Date('2026-11-26T08:00:00Z') });
  assert.equal(lastUndo(ls).at, '2026-11-26T08:00:00.000Z');
  assert.equal(await undoReset({ ls, dbs }), true);
  assert.deepEqual(await dbs.points.getMeta('homeState'), before.hs);
  assert.deepEqual(await dbs.logistics.getMeta('settings'), before.st);
  assert.deepEqual(await dbs.logistics.getMeta('atlasUi'), before.at);
  assert.deepEqual([...ls.m].sort(), before.ls.sort());
  assert.equal(ls.getItem(UNDO_KEY), null);
  assert.equal(await undoReset({ ls, dbs }), false);
});

test('RS-6 niente da azzerare: nessuna copia, nessuna scrittura; senza archivio IndexedDB resta il localStorage', async () => {
  const ls = new LS({ 'navcom.v1': 'x' });
  const r = await applyReset({ groups: ['view', 'trip'], ls, dbs: { points: new Meta(), logistics: new Meta() } });
  assert.deepEqual(r.changed, []); assert.equal(r.undo, null); assert.equal(ls.getItem(UNDO_KEY), null);
  const ls2 = new LS({ 'navcom.layout': 'pc' });
  const r2 = await applyReset({ groups: ['view'], ls: ls2, dbs: { points: null, logistics: null } });
  assert.deepEqual(r2.changed, ['navcom.layout']);
});

test('RS-7 la copia si salva prima di cancellare: se il salvataggio fallisce non si cancella nulla', async () => {
  const { ls, dbs } = fixture();
  ls.setItem = () => { throw new Error('quota piena'); };
  await assert.rejects(applyReset({ groups: ['view'], ls, dbs }), /quota/);
  assert.equal(ls.getItem('navcom.layout'), 'fold');
  assert.ok(await dbs.logistics.getMeta('atlasUi'));
});

// ---------------------------------------------------------------- ESPLORA
// Campi nel formato della DESTINATION INTELLIGENCE (field() di dest/model.js). SINTETICI.
const F = (key, label, value, o = {}) => ({ key, label, value, display: value == null ? 'N.D.' : null, status: value == null ? 'sconosciuta' : o.status ?? 'documentata', sourceLabel: value == null ? null : 'starmap.space', note: o.note ?? null });
const syntheticCard = (mode = 'superficie') => ({
  description: 'Testo di esempio (sintetico).',
  env: {
    context: { mode },
    exterior: [F('atm', 'Atmosfera', 'presente'), F('breath', 'Respirabilità all\'esterno', 'no'), F('press', 'Pressione atmosferica', null), F('tmin', 'Temperatura minima', '-40 °C'), F('tmax', 'Temperatura massima', '5 °C'),
      F('grav', 'Gravità', null), F('comp', 'Composizione atmosferica', 'CO2, N2'), F('weather', 'Condizioni meteo', null), F('wind', 'Vento, tempeste, visibilità', null), F('haz', 'Pericoli ambientali', null)],
    survival: [F('helmet', 'Casco', 'necessario all\'esterno'), F('hostile', 'Ambiente ostile o letale', 'letale senza casco')],
  },
  security: [F('nofly', 'Restrizioni al volo (no-fly)', null), F('jur', 'Giurisdizione (file di gioco)', 'microTech')],
  services: [{ key: 'hangar', label: 'Hangar', values: [F('hangar', 'file di gioco', 'sì, taglia L')] }, { key: 'asop', label: 'Terminale ASOP', values: [F('asop', '—', null)] }],
});
const base = { id: 's1', name: 'Base di prova', kind: 'outpost', system: 'stanton', pos: { x: 1e6, y: 2e6, z: 3e6 }, frame: 'sistema', qtValid: true, source: 'scunpacked', patch: '4.10.3' };
const sit = { time: { value: '☀ 10:24', sub: 'giorno', status: 'ipotetica' }, temp: { value: '-40 … 5 °C', sub: 'min … max', status: 'documentata' }, air: { value: 'NO', sub: 'casco', status: 'documentata', tone: 'bad' }, armistice: { value: 'SÌ', sub: 'starmap.space', status: 'documentata' }, faction: { value: 'microTech' }, relation: { label: 'neutrale', status: 'ipotetica', why: ['nessuna reputazione registrata'] } };

test('EX-1 base in superficie: ora, temperatura, aria dalla SITUAZIONE; meteo sempre N.D. con il perché', () => {
  const c = explorerCard({ place: base, pathLabel: 'Stanton › microTech › Base', kindLabel: 'Avamposto', surface: { ok: true, lat: 0.1, lon: 0.2, alt: 1200, note: 'statico' }, sit, card: syntheticCard(), rotation: { hours: 4.12 }, bodyName: 'microTech' });
  const h = Object.fromEntries(c.hero.map((t) => [t.key, t]));
  assert.equal(h.time.value, '☀ 10:24'); assert.equal(h.time.label, 'ORA LOCALE');
  assert.equal(h.temp.value, '-40 … 5 °C'); assert.equal(h.air.value, 'NO'); assert.equal(h.air.tone, 'bad');
  assert.equal(h.wx.value, null); assert.equal(h.wx.status, 'sconosciuta'); assert.match(h.wx.sub, /nessuna fonte/);
  assert.equal(WEATHER.available, false);
  assert.equal(h.grav.value, null, 'gravità non inventata');
  assert.equal(h.atm.value, 'presente'); assert.equal(h.atm.sub, 'CO2, N2');
});

test('EX-2 sezioni: servizi solo se una fonte li indica, gli altri contati; nessuna sezione missioni', () => {
  const c = explorerCard({ place: base, sit, card: syntheticCard(), surface: { ok: true, lat: 0.1, lon: 0.2, alt: 1200, note: 'statico' } });
  const svc = c.sections.find((s) => s.key === 'svc');
  assert.deepEqual(svc.rows.map((r) => r.label), ['Hangar']); assert.equal(svc.hidden, 1);
  assert.ok(!c.sections.some((s) => /MISSION|CONTRATT/i.test(s.title)));
  const haz = c.sections.find((s) => s.key === 'haz');
  assert.ok(haz.rows.some((r) => /Condizioni meteo/.test(r.label) && r.value === null));
  assert.ok(haz.rows.some((r) => /non vuol dire luogo sicuro/.test(r.value ?? '')));
  const secR = c.sections.find((s) => s.key === 'sec').rows;
  assert.ok(secR.some((r) => r.label === 'Zona di armistizio' && r.value === 'SÌ'));
  assert.ok(secR.some((r) => r.label === 'Rapporto con te' && r.value === 'neutrale'));
  assert.ok(c.sections.find((s) => s.key === 'pos').rows.some((r) => r.label === 'Sul globo' && /lat 5\.73°/.test(r.value)));
});

test('EX-3 pianeta o luna: durata del giorno dalla rotazione, mai un\'ora inventata', () => {
  const moon = { id: 'm', name: 'Daymar', kind: 'moon', system: 'stanton', pos: { x: 0, y: 0, z: 0 }, radius: 295e3 };
  const c = explorerCard({ place: moon, card: syntheticCard('corpo'), sit: { ...sit, time: { value: null } }, rotation: { hours: 2.48 } });
  const t = c.hero.find((x) => x.key === 'time');
  assert.equal(t.label, 'DURATA DEL GIORNO'); assert.equal(t.value, 'giorno di 2 h 29 min'); assert.equal(t.status, 'ipotetica');
  const none = explorerCard({ place: { ...moon, system: 'nyx', name: 'Nyx I' }, card: null, rotation: null });
  assert.equal(none.hero.find((x) => x.key === 'time').value, null);
  assert.equal(fmtDuration(0.5), '30 min'); assert.equal(fmtDuration(4), '4 h'); assert.equal(fmtDuration(0), null);
});

test('EX-4 senza scheda della destinazione: solo dati dell\'ATLANTE, dichiarato', () => {
  const c = explorerCard({ place: { ...base, services: [{ label: 'Terminale commerciale nei file di gioco' }] } });
  assert.equal(c.missingCard, true);
  assert.ok(c.hero.every((t) => t.key === 'time' || t.value === null || t.key === 'atm'));
  assert.match(c.sections.find((s) => s.key === 'svc').rows[0].note, /solo dall'ATLANTE/);
  assert.ok(c.sources.every((s) => !/DESTINATION/.test(s)));
});

test('EX-5 stazione nello spazio: vuoto, niente giorno locale', () => {
  const st = { ...base, kind: 'station', name: 'Stazione di prova' };
  const card = syntheticCard('orbita'); card.env.exterior = []; card.env.exteriorNote = 'le condizioni della superficie non valgono qui';
  const c = explorerCard({ place: st, card, sit: null });
  const h = Object.fromEntries(c.hero.map((t) => [t.key, t]));
  assert.equal(h.time.value, null); assert.match(h.time.sub, /spazio/);
  assert.equal(h.atm.value, 'vuoto');
  assert.ok(c.sections.find((s) => s.key === 'env').rows.some((r) => /non valgono qui/.test(r.note ?? '')));
});

test('EX-6 gravità 1 g: valore predefinito della fonte, mostrato come da verificare', () => {
  const card = syntheticCard(); card.env.exterior = card.env.exterior.map((f) => (f.key === 'grav' ? F('grav', 'Gravità', '1 g') : f));
  const g = explorerCard({ place: base, card }).hero.find((t) => t.key === 'grav');
  assert.equal(g.value, '1 g'); assert.equal(g.status, 'ipotetica'); assert.match(g.sub, /predefinito/);
  card.env.exterior = card.env.exterior.map((f) => (f.key === 'grav' ? F('grav', 'Gravità', '0.33 g') : f));
  assert.equal(explorerCard({ place: base, card }).hero.find((t) => t.key === 'grav').status, 'documentata');
});
