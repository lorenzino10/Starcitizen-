// DESTINATION INTELLIGENCE: enciclopedia operativa delle destinazioni.
// Unisce, senza copiarli in un secondo database: il database geografico dell'atlante (uuid della
// starmap del gioco), lo snapshot delle fonti (data/destinations/) e il DATABASE PUNTI personale.
// Ogni campo esce come {valore, stato, fonte, data, versione}; un campo senza fonte e' NON DISPONIBILE
// o DA VERIFICARE, mai un valore plausibile. Nessuna deduzione fra campi diversi:
//  - atmosfera presente -> NON implica respirabile;
//  - livello di sicurezza <-> armistizio: indipendenti;
//  - servizi della citta' / stazione vicina -> NON passano all'avamposto o al punto XYZ;
//  - pad di atterraggio -> NON implica compatibilita' con la nave.
import { normName } from '../logistics/model.js';
import { KIND_LABEL, SYSTEM_LABEL, BODY_KINDS } from '../atlas/geo.js';
import { AMENITY, SRC } from './build.js';
import { distance } from '../core/vector.js';

export const ND = 'NON DISPONIBILE';
export const DV = 'DA VERIFICARE';
export const ST = {
  verificata: 'verificata (da te)', documentata: 'documentata', segnalata: 'segnalata (community)',
  ipotetica: 'ipotetica / calcolata', sconosciuta: 'sconosciuta',
};
const SRC_LABEL = { scu: SRC.scu.label, uex: SRC.uex.label, sm: SRC.sm.label, geo: 'starmap del gioco (atlante NAVCOM)', db: 'DATABASE PUNTI personale', calc: 'calcolo NAVCOM sui dati statici' };
const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** Abbreviazioni d'uso comune -> nome della starmap. Solo forme univoche e note. */
export const ABBREV = {
  nb: 'New Babbage', a18: 'Area18', 'area 18': 'Area18', lv: 'Lorville', ori: 'Orison', grim: 'GrimHEX', 'grim hex': 'GrimHEX',
  pt: 'Port Tressler', 'pyro gw': 'Pyro Gateway', 'nyx gw': 'Nyx Gateway', 'stanton gw': 'Stanton Gateway',
};

/**
 * Categorie richieste <- sezione e nome delle categorie UEX (elenco reale del 2026-11-09).
 * Le munizioni FPS non hanno una categoria propria in UEX: restano dove UEX le mette.
 */
export const ITEM_CATS = [
  ['armi_fps', 'Armi FPS'], ['munizioni', 'Munizioni'], ['armature', 'Armature'], ['caschi', 'Caschi'], ['tute', 'Tute'],
  ['medico', 'MedPen e consumabili'], ['multitool', 'Multitool e accessori'], ['tractor', 'Tractor beam'],
  ['mining_eq', 'Attrezzature minerarie'], ['mining_laser', 'Laser e moduli minerari'], ['componenti', 'Componenti navali'],
  ['armi_nave', 'Armi e munizioni delle navi'], ['qd', 'Quantum drive'], ['veicoli', 'Veicoli'], ['cibo', 'Cibo e bevande'],
  ['merci', 'Merci commerciali'], ['altro', 'Altri articoli'],
];
const CAT_LABEL = Object.fromEntries(ITEM_CATS);
export function itemCategory(cat, name = '') {
  if (/magazine|\bammo\b|battery pack|\bcap\)/i.test(name)) return ['munizioni', CAT_LABEL.munizioni];
  const sec = String(cat?.section ?? '').toLowerCase(), nm = String(cat?.name ?? '').toLowerCase();
  let k = 'altro';
  if (!cat) k = 'altro';
  else if (sec === 'personal weapons') k = nm === 'attachments' ? 'multitool' : 'armi_fps';
  else if (/ammo|magazine/.test(nm)) k = 'munizioni';
  else if (sec === 'armor') k = nm === 'helmets' ? 'caschi' : 'armature';
  else if (sec === 'undersuits') k = 'tute';
  else if (/consumable/.test(nm) || sec === 'consumable') k = 'medico';
  else if (nm === 'foods' || nm === 'drinks') k = 'cibo';
  else if (nm === 'tractor beams') k = 'tractor';
  else if (nm === 'mining laser heads' || nm === 'mining modules') k = 'mining_laser';
  else if (cat.mining || /mining/.test(nm)) k = 'mining_eq';
  else if (nm === 'gadgets' || nm === 'fuel nozzle') k = 'multitool';
  else if (nm === 'quantum drives' || nm === 'jump modules') k = 'qd';
  else if (sec === 'vehicle weapons') k = 'armi_nave';
  else if (sec === 'systems' || sec === 'avionics' || nm === 'external fuel tanks' || nm === 'docking collars') k = 'componenti';
  else if (sec === 'vehicles') k = 'veicoli';
  else if (sec === 'commodities') k = 'merci';
  return [k, CAT_LABEL[k]];
}

const field = (key, label, value, { status = null, source = null, date = null, version = null, dynamic = false, note = null, display = null } = {}) => {
  const has = value !== null && value !== undefined && value !== '';
  return { key, label, value: has ? value : null, display: display ?? (has ? null : status === 'dv' ? DV : ND), status: has ? status ?? 'documentata' : 'sconosciuta', source: has ? source : null, sourceLabel: has && source ? SRC_LABEL[source] ?? source : null, date, version, dynamic, note };
};
const RESPAWN = { Hospital: 'ospedale', Other: 'altro (il gioco non specifica)', Prison: 'prigione', PrisonExit: 'uscita della prigione', CriminalLocation: 'luogo per criminali', CriminalHospital: 'ospedale per criminali' };
const yesNo = (v) => (v === true ? 'sì' : v === false ? 'no' : null);
const fmtT = (v) => (v === null || v === undefined ? null : `${v} °C`);

/** Normalizzazione per la ricerca: minuscole, senza accenti, numeri romani -> arabi. */
export function searchKey(s) {
  return normName(s).split(' ').map((w) => (ROMAN[w] ? String(ROMAN[w]) : w)).join(' ');
}

export class DestIndex {
  /**
   * @param geo   database geografico dell'atlante (Geo) - SENZA punti personali (li gestisce l'indice)
   * @param dest  data/destinations/dest.json
   * @param market data/destinations/market.json (facoltativo: caricato a richiesta)
   * @param personal punti del DATABASE PUNTI (record originali, id invariati)
   * @param links  collegamenti confermati da te {chiaveUEX: uuid}
   */
  constructor({ geo, dest = {}, market = null, ships = [], personal = [], links = {} }) {
    this.geo = geo; this.dest = dest; this.ships = ships; this.links = links;
    this.game = dest.game ?? {}; this.env = dest.env?.byPlace ?? {}; this.envSuspect = dest.env?.suspect ?? {};
    this.smPois = dest.smPois?.byPlace ?? {}; this.mining = dest.mining?.byPlace ?? {};
    this.uexLocs = dest.uex?.locations ?? {}; this.terminals = dest.uex?.terminals ?? {};
    this.meta = dest.meta ?? {};
    // gravita': se quasi tutti i valori della fonte sono identici (1 g) sono un valore predefinito, non misure
    const gs = Object.values(this.env).map((e) => e.gravityRaw ?? e.gravity).filter((g) => g !== null && g !== undefined);
    if (gs.length >= 3) {
      const top = gs.filter((g) => g === gs[0]).length;
      if (top / gs.length >= 0.8) {
        const why = `gravità ${gs[0]} g per ${top} corpi su ${gs.length} nella fonte: valore predefinito, non una misura`;
        this.env = Object.fromEntries(Object.entries(this.env).map(([k, e]) => [k, (e.gravityRaw ?? e.gravity) === gs[0] ? { ...e, gravity: null, gravitySuspect: why } : e]));
      }
    }
    // luoghi UEX -> uuid (abbinamento della build o conferma tua); mai per nome ambiguo
    this.uexByPlace = new Map();
    for (const l of Object.values(this.uexLocs)) {
      const pid = l.placeId ?? links[l.key] ?? null;
      if (pid) { if (!this.uexByPlace.has(pid)) this.uexByPlace.set(pid, []); this.uexByPlace.get(pid).push(l); }
    }
    this.termByPlace = new Map(); this.termByLoc = new Map();
    for (const t of Object.values(this.terminals)) {
      const pid = t.placeId ?? (t.locKey ? (this.uexLocs[t.locKey]?.placeId ?? links[t.locKey] ?? null) : null);
      t._place = pid;
      if (pid) { if (!this.termByPlace.has(pid)) this.termByPlace.set(pid, []); this.termByPlace.get(pid).push(t); }
      if (t.locKey) { if (!this.termByLoc.has(t.locKey)) this.termByLoc.set(t.locKey, []); this.termByLoc.get(t.locKey).push(t); }
    }
    this.setPersonal(personal);
    if (market) this.setMarket(market);
  }

  setPersonal(points) {
    this.personal = new Map();
    for (const p of points ?? []) {
      const k = { km: 1000, m: 1 }[p.unit] ?? 1000;
      const ok = [p.x, p.y, p.z].every((v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v));
      this.personal.set(`pt:${p.id}`, { rec: p, system: String(p.system ?? '').toLowerCase() || null, pos: ok ? { x: +p.x * k, y: +p.y * k, z: +p.z * k } : null });
    }
    this._search = null;
  }

  setMarket(m) {
    this.market = m;
    this.priceByTerminal = new Map(); this.commByTerminal = new Map();
    for (const r of m.itemPrices ?? []) { if (!this.priceByTerminal.has(r[1])) this.priceByTerminal.set(r[1], []); this.priceByTerminal.get(r[1]).push(r); }
    for (const r of m.commodityPrices ?? []) { if (!this.commByTerminal.has(r[1])) this.commByTerminal.set(r[1], []); this.commByTerminal.get(r[1]).push(r); }
  }

  // ------------------------------------------------------------ ricerca universale
  #entries() {
    if (this._search) return this._search;
    const E = [];
    const add = (id, name, extra) => E.push({ id, name, key: searchKey(name), compact: searchKey(name).replace(/ /g, ''), ...extra });
    for (const p of this.geo.places) {
      if (p.kind === 'personal') continue;
      const aliases = [...(p.aliases ?? [])];
      for (const l of this.uexByPlace.get(p.id) ?? []) { if (l.nickname) aliases.push(l.nickname); if (l.name !== p.name) aliases.push(l.name); }
      add(p.id, p.name, { aliases: aliases.map(searchKey), system: p.system, kind: p.kind, hidden: !!p.hidden, origin: 'geo' });
    }
    for (const l of Object.values(this.uexLocs)) {
      if (l.placeId || this.links[l.key]) continue;
      add(`uex:${l.key}`, l.name, { aliases: l.nickname ? [searchKey(l.nickname)] : [], system: l.system, kind: l.kind === 'station' ? 'station' : l.kind === 'city' ? 'city' : l.kind === 'outpost' ? 'outpost' : 'poi', hidden: false, origin: 'uex' });
    }
    for (const [id, p] of this.personal) add(id, p.rec.name, { aliases: [], system: p.system, kind: 'personal', hidden: false, origin: 'db' });
    const counts = new Map(); for (const e of E) counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
    for (const e of E) e.homonyms = counts.get(e.key) - 1;
    return (this._search = E);
  }

  /** Autocompletamento: esatto, alias/abbreviazione, prefisso, parole, compatto. */
  search(text, { system = null, limit = 25, includeHidden = true } = {}) {
    let q = searchKey(text); if (!q) return [];
    if (ABBREV[q]) q = searchKey(ABBREV[q]);
    const qc = q.replace(/ /g, ''); const words = q.split(' ');
    const score = (e) => {
      if (e.key === q || e.aliases.includes(q)) return 0;
      if (e.compact === qc) return 1;
      if (e.key.startsWith(q) || e.aliases.some((a) => a.startsWith(q))) return 2;
      if (words.every((w) => e.key.includes(w))) return 3;
      if (qc.length >= 3 && e.compact.includes(qc)) return 4;
      return 9;
    };
    return this.#entries().filter((e) => (!system || e.system === system) && (includeHidden || !e.hidden))
      .map((e) => [score(e) + (e.hidden ? 0.5 : 0), e]).filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit)
      .map(([, e]) => this.describe(e.id, e));
  }

  /** Etichetta di un risultato: sistema, corpo, tipo, omonimi. */
  describe(id, e = null) {
    if (id.startsWith('pt:')) {
      const p = this.personal.get(id); if (!p) return null;
      return { id, name: p.rec.name, system: p.system, systemLabel: SYSTEM_LABEL[p.system] ?? p.system ?? '—', body: p.rec.body || null, kindLabel: `Punto personale${p.pos ? '' : ' (senza XYZ)'}`, origin: 'db', homonyms: e?.homonyms ?? 0, hasXyz: !!p.pos };
    }
    if (id.startsWith('uex:')) {
      const l = this.uexLocs[id.slice(4)]; if (!l) return null;
      return { id, name: l.name, system: l.system, systemLabel: SYSTEM_LABEL[l.system] ?? l.system, body: l.moon ?? l.planet ?? null, kindLabel: `${KIND_LABEL[l.kind === 'poi' ? 'poi' : l.kind] ?? l.kind} (solo UEX, non abbinato alla starmap)`, origin: 'uex', homonyms: e?.homonyms ?? 0, hasXyz: false };
    }
    const p = this.geo.get(id); if (!p) return null;
    const body = this.geo.bodyOf(id);
    return { id, name: p.name, system: p.system, systemLabel: SYSTEM_LABEL[p.system], body: body && body.id !== id ? body.name : null, kindLabel: p.kind === 'star' ? 'Stella / sistema' : KIND_LABEL[p.kind] ?? p.kind, path: this.geo.pathLabel(id), origin: 'geo', hidden: !!p.hidden, homonyms: e?.homonyms ?? 0, hasXyz: !!p.pos };
  }

  // ------------------------------------------------------------ scheda
  /** Antenati con giurisdizione/ambiente: [{place, level}] dal luogo verso il sistema. */
  #chain(id) { return this.geo.path(id).slice().reverse(); }

  /** Corpo celeste il cui ambiente esterno riguarda il luogo, e come lo si sa. */
  context(id, pos = null, system = null) {
    const p = id && !id.startsWith('pt:') && !id.startsWith('uex:') ? this.geo.get(id) : null;
    if (p && BODY_KINDS.has(p.kind) && p.kind !== 'star') return { mode: 'corpo', body: p, note: 'ambiente esterno del corpo celeste' };
    if (p) {
      const body = this.geo.bodyOf(id);
      if (!body || body.kind === 'star') return { mode: 'spazio', body: null, note: 'nello spazio: nessun corpo celeste di riferimento' };
      const s = this.geo.surface(id);
      if (s.ok) return { mode: 'superficie', body, note: `sulla superficie di ${body.name} (posizione statica entro il 10 % del raggio)` };
      if (s.orbit) return { mode: 'orbita', body, note: `in orbita: ${s.note}` };
      if (!p.pos || !body.radius) return { mode: 'superficie?', body, note: `appartiene a ${body.name} nella starmap; quota non verificabile (${s.note ?? 'posizione o raggio mancanti'})` };
      return { mode: 'superficie?', body, note: s.note };
    }
    if (pos && system) {
      const near = this.nearestBody(pos, system);
      if (!near) return { mode: 'spazio', body: null, note: 'punto nello spazio: nessun corpo con raggio noto nel sistema' };
      const alt = near.d - near.body.radius;
      const atm = this.env[near.body.id]?.atmosphereHeight ?? null;
      if (alt < -near.body.radius * 0.1) return { mode: 'incoerente', body: near.body, alt, note: `il punto sta sotto la superficie di ${near.body.name} secondo il raggio noto: coordinate da ricontrollare` };
      if (alt <= near.body.radius * 0.1) return { mode: 'superficie', body: near.body, alt, note: `a ${Math.round(alt / 1000)} km dalla superficie di ${near.body.name} (calcolato)` };
      return { mode: 'spazio', body: near.body, alt, atmosphereHeight: atm, note: `a ${Math.round(alt / 1000).toLocaleString('it-IT')} km dalla superficie di ${near.body.name}, il corpo più vicino (calcolato)` };
    }
    return { mode: 'ignoto', body: null, note: 'posizione non nota' };
  }

  nearestBody(pos, system) {
    let best = null;
    for (const b of this.geo.places) {
      if (b.system !== system || !(b.kind === 'planet' || b.kind === 'moon') || !b.pos || !b.radius) continue;
      const d = distance(pos, b.pos); if (!best || d - b.radius < best.d - best.body.radius) best = { body: b, d };
    }
    return best;
  }

  /** Luoghi documentati vicino a una posizione: distanze reali, nessun servizio attribuito al punto. */
  nearby(pos, system, { limit = 8, excludeId = null } = {}) {
    if (!pos || !system) return [];
    return this.geo.places.filter((p) => p.system === system && p.pos && p.kind !== 'personal' && p.id !== excludeId && !p.hidden && !['asteroid', 'navpoint'].includes(p.kind))
      .map((p) => ({ id: p.id, name: p.name, kindLabel: KIND_LABEL[p.kind] ?? p.kind, d: distance(pos, p.pos), services: this.serviceSummary(p.id) }))
      .sort((a, b) => a.d - b.d).slice(0, limit);
  }
  serviceSummary(id) {
    const g = this.game[id]?.amenities ?? []; const u = this.uexByPlace.get(id) ?? [];
    const out = new Set(g.map((a) => AMENITY[a]?.k).filter(Boolean));
    for (const l of u) for (const [k, v] of Object.entries(l.flags)) if (v && k !== 'is_landable' && k !== 'has_quantum_marker') out.add(k.replace(/^(has|is)_/, ''));
    return [...out];
  }

  /** Scheda completa di una destinazione. */
  card(id) {
    if (id.startsWith('pt:')) return this.#personalCard(id);
    if (id.startsWith('uex:')) return this.#uexCard(id.slice(4));
    const p = this.geo.get(id); if (!p) return null;
    const d = this.describe(id);
    const ctx = this.context(id);
    const uex = this.uexByPlace.get(id) ?? [];
    const terms = this.#terminalsFor(id, uex);
    const card = {
      id, title: p.name, desc: d, place: p, ctx, xyz: p.pos ? { ...p.pos, frame: p.frame } : null, qtValid: !!p.qtValid,
      ids: { starmap: p.id, uex: uex.map((l) => l.key) },
      description: this.game[id]?.description ?? null,
      env: this.#env(ctx, p), security: this.#security(id, uex, terms), services: this.#services(id, uex, terms),
      terminals: terms, mining: this.miningFor(id, ['superficie', 'superficie?'].includes(ctx.mode) ? ctx : null), personalNear: this.personalNear(p.pos, p.system, ctx.body),
      nearby: null, candidates: [],
    };
    card.missing = this.#missing(card);
    return card;
  }

  #uexCard(key) {
    const l = this.uexLocs[key]; if (!l) return null;
    const bodyName = l.moon ?? l.planet; const bodyId = bodyName ? this.geo.resolve(bodyName, l.system)?.place?.id ?? null : null;
    const body = bodyId ? this.geo.get(bodyId) : null;
    const ctx = body ? { mode: l.kind === 'station' ? 'orbita?' : 'superficie?', body, note: `UEX lo colloca su/presso ${body.name}; posizione nella starmap non abbinata` } : { mode: 'ignoto', body: null, note: 'non abbinato alla starmap del gioco' };
    const terms = this.termByLoc.get(key) ?? [];
    const cands = (l.candidates ?? []).map((c) => this.describe(c)).filter(Boolean);
    const card = {
      id: `uex:${key}`, title: l.name, desc: this.describe(`uex:${key}`), place: null, ctx, xyz: null, qtValid: false,
      ids: { starmap: null, uex: [key] }, description: null,
      env: this.#env(ctx, null), security: this.#security(null, [l], terms), services: this.#services(null, [l], terms),
      terminals: terms, mining: body ? this.miningFor(body.id, { mode: 'regionale', body }) : null, personalNear: [], nearby: null,
      candidates: cands, linkKey: key,
    };
    card.missing = this.#missing(card);
    return card;
  }

  #personalCard(id) {
    const p = this.personal.get(id); if (!p) return null;
    const r = p.rec;
    let ctx;
    if (p.pos && p.system) ctx = this.context(null, p.pos, p.system);
    else if (r.body) {
      const b = this.geo.resolve(r.body, p.system)?.place ?? null;
      ctx = b ? { mode: 'superficie', body: b, note: `corpo indicato nella scheda: ${b.name}${typeof r.lat === 'number' ? ` (lat ${r.lat}°, lon ${r.lon}°: coordinate planetarie, non convertite in XYZ)` : ''}` } : { mode: 'ignoto', body: null, note: `corpo "${r.body}" non riconosciuto nella starmap` };
    } else ctx = { mode: 'ignoto', body: null, note: 'scheda senza XYZ e senza corpo celeste: posizione non nota' };
    const card = {
      id, title: r.name, desc: this.describe(id), place: null, personal: r, ctx, xyz: p.pos, qtValid: false,
      ids: { starmap: null, uex: [], db: r.id }, description: null,
      env: this.#env(ctx, null), security: this.#security(null, [], []), services: [], terminals: [],
      mining: ctx.body && ctx.mode === 'superficie' ? this.miningFor(ctx.body.id, { mode: 'regionale', body: ctx.body }) : null,
      personalNear: this.personalNear(p.pos, p.system, ctx.body, id),
      nearby: p.pos ? this.nearby(p.pos, p.system) : [], candidates: [],
      own: [
        field('cat', 'Categoria (tua)', r.category, { status: r.status === 'Verificato' ? 'verificata' : 'ipotetica', source: 'db' }),
        field('res', 'Risorsa annotata (tua)', r.resource, { status: r.status === 'Verificato' ? 'verificata' : 'ipotetica', source: 'db', note: r.status === 'Verificato' ? null : 'coordinata/annotazione sperimentale finché non la verifichi tu' }),
        field('st', 'Stato del punto', r.status, { source: 'db' }),
        field('src', 'Fonte del dato (tua)', r.sourceRef, { source: 'db' }),
        field('notes', 'Note', r.notes, { source: 'db' }),
      ],
    };
    card.missing = this.#missing(card);
    return card;
  }

  // ------------------------------------------------------------ ambiente
  #env(ctx, p) {
    const body = ctx.body; const e = body ? this.env[body.id] : null;
    const from = body && p && body.id !== p.id ? ` (ereditato dal corpo ${body.name}: valore planetario, non misura locale)` : '';
    const date = e?.submitted ?? e?.fetchedAt ?? null; const ver = e?.comment ?? null;
    const exterior = [];
    const f = (k, l, v, o = {}) => exterior.push(field(k, l, v, { source: 'sm', date, version: ver, ...o, note: [o.note, v !== null && v !== undefined ? from : null].filter(Boolean).join(' ') || null }));
    const hasAtm = e ? (e.composition || e.atmosphereHeight ? true : null) : null;
    f('atm', 'Atmosfera', hasAtm === true ? `presente${e.atmosphereHeight ? ` (altezza ${e.atmosphereHeight.toLocaleString('it-IT')} m)` : ''}` : null, { note: hasAtm === null && e ? 'la fonte non indica composizione né altezza dell\'atmosfera' : null });
    f('breath', 'Respirabilità all\'esterno', yesNo(e?.breathable), { note: e && e.breathable === null ? 'campo vuoto nella fonte: la presenza di atmosfera NON implica che sia respirabile' : null });
    exterior.push(field('press', 'Pressione atmosferica', null, { note: 'nessuna fonte collegata pubblica la pressione' }));
    f('tmin', 'Temperatura minima', fmtT(e?.tempMin), { note: 'superficie, valore del corpo: le condizioni locali e meteo possono differire' });
    f('tmax', 'Temperatura massima', fmtT(e?.tempMax));
    exterior.push(field('ttyp', 'Temperatura tipica', null, { note: 'non pubblicata dalle fonti collegate' }));
    f('grav', 'Gravità', e?.gravity !== null && e?.gravity !== undefined ? `${e.gravity} g` : null, { status: e?.gravitySuspect ? 'dv' : null, note: e?.gravitySuspect ? `valore della fonte scartato: ${e.gravitySuspect}` : null });
    f('comp', 'Composizione atmosferica', e?.composition ?? null);
    f('bio', 'Biomi', e?.biomes ?? null);
    f('ocean', 'Oceani', yesNo(e?.oceans));
    f('hab', 'Abitabile (secondo la fonte)', yesNo(e?.habitable));
    for (const [k, l] of [['weather', 'Condizioni meteo'], ['wind', 'Vento, tempeste, visibilità'], ['haz', 'Pericoli ambientali']]) exterior.push(field(k, l, null, { status: 'dv', note: 'dinamici o non pubblicati dalle fonti collegate' }));
    const survival = this.#survival(ctx, e);
    const structure = p && ['station', 'gateway', 'city', 'outpost'].includes(p.kind);
    const interior = !structure ? null : [
      field('int', 'Ambiente interno pressurizzato', null, { status: 'dv', note: 'nessuna fonte collegata documenta pressurizzazione e gravità interne di stazioni e installazioni' }),
    ];
    let space = null;
    if (['spazio', 'orbita', 'orbita?'].includes(ctx.mode)) {
      const outside = ctx.body && ctx.atmosphereHeight && ctx.alt !== undefined ? ctx.alt > ctx.atmosphereHeight : null;
      space = [field('space', 'Posizione nello spazio', ctx.note, { status: 'ipotetica', source: 'calc' }),
        field('spaceAtm', 'Atmosfera nel punto', outside === true ? 'fuori dall\'atmosfera documentata del corpo più vicino' : null, { status: outside === true ? 'ipotetica' : 'dv', source: 'calc', note: outside === null ? 'altezza dell\'atmosfera del corpo non nota: impossibile dire se il punto è nel vuoto' : 'calcolato dalla distanza e dall\'altezza atmosferica della fonte' })];
    }
    const surfaceLike = ['corpo', 'superficie', 'superficie?'].includes(ctx.mode);
    return { context: ctx, exterior: surfaceLike ? exterior : [], exteriorNote: surfaceLike ? null : ctx.body ? `le condizioni della superficie di ${ctx.body.name} non valgono qui: il punto non è sulla superficie` : null, interior, space, survival, envSource: e && surfaceLike ? { name: e.smName, date, version: ver } : null };
  }

  #survival(ctx, e) {
    const out = [];
    const inSpace = ['spazio', 'orbita', 'orbita?'].includes(ctx.mode);
    const br = inSpace || ctx.mode === 'ignoto' || ctx.mode === 'incoerente' ? undefined : e?.breathable;
    if (inSpace) out.push(field('helmet', 'Casco', 'necessario fuori dagli ambienti pressurizzati', { status: 'ipotetica', source: 'calc', note: 'punto nello spazio: nessuna atmosfera respirabile documentata' }));
    else if (br === false) out.push(field('helmet', 'Casco', 'necessario all\'esterno', { source: 'sm', note: 'atmosfera documentata come NON respirabile' }));
    else if (br === true) out.push(field('helmet', 'Casco', 'non richiesto dalla respirabilità secondo la fonte', { source: 'sm', note: 'verifica comunque sul posto: temperature e pericoli locali non sono coperti' }));
    else out.push(field('helmet', 'Casco', null, { status: 'dv', note: 'respirabilità non documentata: tienilo finché non verifichi' }));
    out.push(field('suit', 'Tuta pressurizzata (undersuit)', br === false || inSpace ? 'necessaria con il casco per l\'esterno' : null, { status: br === false ? 'documentata' : inSpace ? 'ipotetica' : 'dv', source: br === false ? 'sm' : inSpace ? 'calc' : null }));
    const tm = inSpace ? null : e?.tempMin, tx = inSpace ? null : e?.tempMax;
    out.push(field('thermal', 'Protezione termica', tm !== null && tm !== undefined || tx !== null && tx !== undefined ? `range documentato ${tm ?? '?'} / ${tx ?? '?'} °C: confronta con i limiti di temperatura di tuta e armatura` : null, { status: tm !== undefined && tm !== null ? 'documentata' : 'dv', source: 'sm', note: 'NAVCOM non dichiara obbligatoria nessuna protezione: i limiti dell\'equipaggiamento li vedi nel gioco' }));
    out.push(field('hostile', 'Ambiente ostile o letale', br === false ? 'letale senza casco (atmosfera non respirabile)' : null, { status: br === false ? 'documentata' : 'dv', source: br === false ? 'sm' : null }));
    out.push(field('foot', 'Permanenza a piedi', null, { status: 'dv', note: 'dipende da equipaggiamento, meteo e fauna: non documentato' }));
    return out;
  }

  // ------------------------------------------------------------ sicurezza
  #security(id, uex, terms) {
    const rows = [];
    const sm = id ? this.smPois[id] : null;
    const arm = uex.map((l) => l.flags.is_armistice).filter((v) => v !== undefined);
    const armUex = arm.length ? arm.every(Boolean) ? true : arm.some(Boolean) ? 'misto' : false : null;
    const uexDate = uex.map((l) => l.modified).filter(Boolean).sort().pop() ?? null;
    if (sm?.armistice !== null && sm?.armistice !== undefined) rows.push(field('arm', 'Zona di armistizio', yesNo(sm.armistice), { source: 'sm', date: sm.lastUpdate, note: 'vale per l\'area protetta della località, non per le zone circostanti' }));
    if (armUex !== null) rows.push(field('armU', 'Zona di armistizio', armUex === 'misto' ? 'sì per alcune voci UEX, no per altre' : yesNo(armUex), { source: 'uex', status: 'segnalata', date: uexDate, dynamic: false, note: 'vale per l\'area protetta della località, non per le zone circostanti' }));
    if (!rows.length) rows.push(field('arm', 'Zona di armistizio', null, { display: 'SCONOSCIUTO', note: 'nessuna fonte collegata lo indica' }));
    const armYes = rows.some((r) => r.value === 'sì');
    rows.push(field('fps', 'Armi FPS', armYes ? 'bloccate dentro l\'area di armistizio (regola del gioco)' : null, { status: armYes ? 'ipotetica' : 'dv', source: armYes ? 'calc' : null, note: armYes ? 'fuori dal perimetro protetto non vale' : 'non documentato' }));
    rows.push(field('shipw', 'Armi della nave', armYes ? 'limitate dentro l\'area di armistizio (regola del gioco)' : null, { status: armYes ? 'ipotetica' : 'dv', source: armYes ? 'calc' : null }));
    rows.push(field('nofly', 'Restrizioni al volo (no-fly)', yesNo(sm?.noFly), { source: 'sm', date: sm?.lastUpdate ?? null }));
    rows.push(field('def', 'Difese automatiche', sm?.defenses ?? null, { source: 'sm', date: sm?.lastUpdate ?? null }));
    rows.push(field('tres', 'Area di trespassing', yesNo(sm?.trespassing), { source: 'sm', date: sm?.lastUpdate ?? null }));
    // giurisdizione: dal luogo verso il sistema (il contesto territoriale si eredita, i servizi no)
    let jur = null, jurFrom = null;
    if (id) for (const x of this.#chain(id)) { const j = this.game[x.id]?.jurisdiction; if (j?.name) { jur = j; jurFrom = x.id === id ? null : x.name; break; } }
    rows.push(field('jur', 'Giurisdizione (file di gioco)', jur?.name ?? null, { source: 'scu', version: this.meta.patch ?? null, note: jurFrom ? `ereditata da ${jurFrom}` : null }));
    if (jur) {
      rows.push(field('fine', 'Multa base', jur.baseFine !== null ? `${jur.baseFine} aUEC` : null, { source: 'scu', version: this.meta.patch ?? null }));
      rows.push(field('stolen', 'Merce rubata tollerata', jur.maxStolenScu !== null ? `${jur.maxStolenScu} SCU` : null, { source: 'scu', version: this.meta.patch ?? null }));
    }
    const ujur = [...new Set(uex.map((l) => l.jurisdiction).filter(Boolean))];
    if (ujur.length) rows.push(field('jurU', 'Giurisdizione (UEX)', ujur.join(', '), { source: 'uex', status: 'segnalata', date: uexDate }));
    const body = id ? this.geo.bodyOf(id) : null; const be = body ? this.env[body.id] : null;
    let aff = id ? this.game[id]?.affiliation : null;
    rows.push(field('ctrl', 'Controllo / affiliazione', aff ?? be?.affiliation ?? ([...new Set(uex.map((l) => l.faction).filter(Boolean))].join(', ') || null), { source: aff ? 'scu' : be?.affiliation ? 'sm' : 'uex', status: aff || be?.affiliation ? 'documentata' : 'segnalata', note: 'chi controlla la zona, non un giudizio di ostilità' }));
    rows.push(field('hostile', 'Aree controllate da fazioni ostili', null, { status: 'dv', note: 'l\'ostilità dipende dalla tua reputazione: non documentata' }));
    const illegal = this.illegalTraded(terms);
    rows.push(field('illegal', 'Attività illegali possibili', illegal.length ? `merci illegali trattate ai terminali: ${illegal.join(', ')}` : null, { source: 'uex', status: 'segnalata', note: illegal.length ? null : 'nessuna merce illegale segnalata ai terminali (non significa che la zona sia legale o sicura)' }));
    rows.push(field('sec', 'Livello di sicurezza documentato', null, { note: 'nessuna fonte collegata lo pubblica; non si ricava da armistizio o giurisdizione' }));
    const resp = id ? this.game[id]?.respawn : null;
    rows.push(field('respawn', 'Tipo di respawn (file di gioco)', resp ? RESPAWN[resp] ?? resp : null, { source: 'scu', version: this.meta.patch ?? null }));
    rows.push(field('note', 'Particolarità', id && this.game[id]?.blockTravel ? 'il gioco blocca il viaggio verso questo punto (BlockTravel)' : null, { source: 'scu' }));
    return rows;
  }

  illegalTraded(terms) {
    if (!this.market) return [];
    const out = new Set();
    for (const t of terms) for (const r of this.commByTerminal.get(t.id) ?? []) { const c = this.market.commodities?.[r[0]]; if (c?.illegal) out.add(c.name); }
    return [...out].sort();
  }

  // ------------------------------------------------------------ servizi
  #terminalsFor(id, uexLocs) {
    const set = new Map();
    for (const t of this.termByPlace.get(id) ?? []) set.set(t.id, t);
    for (const l of uexLocs) for (const t of this.termByLoc.get(l.key) ?? []) set.set(t.id, t);
    return [...set.values()].sort((a, b) => String(a.type).localeCompare(String(b.type)) || a.name.localeCompare(b.name));
  }

  #services(id, uex, terms) {
    const am = id ? this.game[id]?.amenities ?? [] : [];
    const listed = id && this.game[id] ? true : false;
    const gHas = (k) => am.filter((a) => AMENITY[a]?.k === k);
    const sizes = (k) => gHas(k).map((a) => AMENITY[a].size).filter(Boolean);
    const uFlag = (f) => { const v = uex.map((l) => l.flags[f]).filter((x) => x !== undefined); return v.length ? v.some(Boolean) : null; };
    const tFlag = (f) => { const v = terms.map((t) => t.flags[f]).filter((x) => x !== undefined); return v.length ? v.some(Boolean) : null; };
    const uDate = uex.map((l) => l.modified).filter(Boolean).sort().pop() ?? null;
    const tDate = terms.map((t) => t.modified).filter(Boolean).sort().pop() ?? null;
    const rows = [];
    const both = (key, label, gameKeys, uexFlag, termFlag = null, note = null) => {
      const g = gameKeys.flatMap(gHas);
      const gv = g.length ? g.map((a) => this.game[id].amenities.includes(a) ? a : null).filter(Boolean).join(', ') : null;
      const uv = uexFlag ? uFlag(uexFlag) : null; const tv = termFlag ? tFlag(termFlag) : null;
      const r = { key, label, note, values: [] };
      if (gv) r.values.push(field(key, 'file di gioco', `sì (${gv})`, { source: 'scu', version: this.meta.patch ?? null }));
      else if (listed && gameKeys.length) r.values.push(field(key, 'file di gioco', null, { display: 'non elencato', note: 'l\'elenco servizi del gioco può essere incompleto: non è una prova di assenza' }));
      if (uv !== null) r.values.push(field(key, 'UEX (luogo)', uv ? 'sì' : 'segnalato assente', { source: 'uex', status: 'segnalata', date: uDate }));
      if (tv !== null) r.values.push(field(key, 'UEX (terminali)', tv ? 'sì' : 'non segnalato', { source: 'uex', status: 'segnalata', date: tDate }));
      if (!r.values.length) r.values.push(field(key, '—', null));
      rows.push(r);
    };
    const hs = sizes('hangar'), ps = sizes('pad');
    rows.push({ key: 'hangar', label: 'Hangar', note: 'hangar, pad, docking port e cargo elevator NON sono equivalenti', values: hs.length ? [field('hangar', 'file di gioco', `sì, taglia ${hs.join(', ')}`, { source: 'scu', version: this.meta.patch ?? null })] : [field('hangar', 'file di gioco', null, { display: listed ? 'non elencato' : ND })] });
    const pads = [...new Set(uex.map((l) => l.pads).filter(Boolean))];
    rows.push({ key: 'pad', label: 'Landing pad', note: 'la presenza di un pad non dice se la tua nave ci sta', values: [ps.length ? field('pad', 'file di gioco', `sì, taglia ${ps.join(', ')}`, { source: 'scu', version: this.meta.patch ?? null }) : field('pad', 'file di gioco', null, { display: listed ? 'non elencato' : ND }), ...(pads.length ? [field('padU', 'UEX (tipi di pad)', pads.join(', '), { source: 'uex', status: 'segnalata', date: uDate })] : [])] });
    both('docking', 'Docking port', ['docking'], 'has_docking_port', 'has_docking_port');
    rows.push({ key: 'vpad', label: 'Vehicle pad', values: [field('vpad', '—', null, { note: 'nessuna fonte collegata lo distingue' })] });
    both('vservices', 'Vehicle Services (file di gioco)', ['vehicleServices'], null, null, 'voce generica del gioco: non dice quali servizi (riparazione, riarmo, carburante) siano attivi');
    rows.push({ key: 'asop', label: 'Terminale ASOP / recupero navi', values: [field('asop', '—', null, { status: 'dv', note: 'non pubblicato dalle fonti collegate' })] });
    rows.push({ key: 'atc', label: 'Atterraggio con ATC', values: [field('atc', '—', null, { status: 'dv' })] });
    const fuel = this.fuelAt(terms);
    rows.push({ key: 'h2', label: 'Rifornimento idrogeno', values: [...(fuel.h.length ? [field('h2', 'UEX (prezzo carburante)', fuel.h.map((f) => `${f.price} aUEC`).join(', '), { source: 'uex', status: 'segnalata', date: fuel.h[0].date, dynamic: true })] : []), ...(uFlag('has_refuel') !== null ? [field('h2u', 'UEX (luogo: rifornimento)', uFlag('has_refuel') ? 'sì (tipo non specificato)' : 'segnalato assente', { source: 'uex', status: 'segnalata', date: uDate })] : []), ...(!fuel.h.length && uFlag('has_refuel') === null ? [field('h2', '—', null)] : [])] });
    rows.push({ key: 'qt', label: 'Rifornimento quantum', values: fuel.q.length ? [field('qt', 'UEX (prezzo carburante)', fuel.q.map((f) => `${f.price} aUEC`).join(', '), { source: 'uex', status: 'segnalata', date: fuel.q[0].date, dynamic: true })] : [field('qt', '—', null, { note: uFlag('has_refuel') ? 'rifornimento segnalato, tipo di carburante non specificato' : null })] });
    both('repair', 'Riparazione', [], 'has_repair', 'is_repair');
    rows.push({ key: 'rearm', label: 'Riarmo', values: [field('rearm', '—', null, { status: 'dv', note: 'nessuna fonte collegata lo distingue dalla riparazione' })] });
    both('fe', 'Cargo elevator (freight elevator)', ['freightElevator'], 'has_freight_elevator', 'has_freight_elevator');
    both('dock', 'Loading dock', ['loadingDock'], 'has_loading_dock', 'has_loading_dock');
    both('cc', 'Cargo center', [], 'has_cargo_center', 'is_cargo_center');
    both('auto', 'Autoloading', [], null, 'is_auto_load');
    const mc = terms.map((t) => t.maxContainer).filter((v) => v);
    rows.push({ key: 'box', label: 'Casse gestibili (max)', values: [mc.length ? field('box', 'UEX (terminali)', `${Math.max(...mc)} SCU`, { source: 'uex', status: 'segnalata', date: tDate }) : field('box', '—', null)] });
    rows.push({ key: 'storage', label: 'Deposito merci', values: [field('storage', '—', null, { status: 'dv' })] });
    both('refinery', 'Raffineria', ['refinery'], 'has_refinery', 'is_refinery');
    both('medical', 'Servizi medici', ['clinic', 'hospital'], 'has_clinic', 'is_medical');
    const resp = id ? this.game[id]?.respawn : null;
    rows.push({ key: 'respawn', label: 'Respawn impostabile', values: [resp === 'Hospital' ? field('respawn', 'file di gioco', 'sì (punto di respawn di tipo ospedale)', { source: 'scu', version: this.meta.patch ?? null }) : field('respawn', 'file di gioco', null, { status: 'dv', note: resp ? `il gioco indica un respawn di tipo "${RESPAWN[resp] ?? resp}": se puoi impostarlo qui non è documentato` : null })] });
    both('hab', 'Alloggi (habs)', [], 'has_habitation', 'is_habitation');
    both('food', 'Cibo e bevande', ['food'], 'has_food', 'is_food');
    both('shops', 'Negozi', ['shopArmor', 'shopWeapons', 'shopClothing', 'shopShipItems'], 'has_shops', 'is_shop_fps');
    both('veh', 'Noleggio / vendita veicoli', ['rentVehicles', 'buyVehicles', 'buyRentVehicles', 'garage'], null, 'is_shop_vehicle');
    return rows;
  }

  fuelAt(terms) {
    const out = { h: [], q: [] };
    for (const f of this.market?.fuel ?? []) {
      if (!terms.some((t) => t.id === f[1])) continue;
      const rec = { name: f[0], price: f[2], date: iso(f[3]) };
      if (/quantum/i.test(f[0])) out.q.push(rec); else if (/hydrogen|idrogeno/i.test(f[0])) out.h.push(rec);
    }
    return out;
  }

  // ------------------------------------------------------------ negozi e commercio
  /** Articoli segnalati ai terminali di una destinazione. Catalogo, mai disponibilita' in tempo reale. */
  shopsOf(card, { q = '', cat = '', sort = 'nome' } = {}) {
    if (!this.market) return null;
    const qk = searchKey(q);
    const out = [];
    for (const t of card.terminals) {
      for (const r of this.priceByTerminal.get(t.id) ?? []) {
        const it = this.market.items[r[0]]; if (!it) continue;
        const [ck, cl] = itemCategory(this.market.categories[it[1]], it[0]);
        if (cat && ck !== cat) continue;
        if (qk && !searchKey(it[0]).includes(qk)) continue;
        out.push({ item: it[0], itemId: r[0], uuid: it[2], cat: cl, catKey: ck, uexCat: this.market.categories[it[1]] ? `${this.market.categories[it[1]].section} › ${this.market.categories[it[1]].name}` : null, buy: r[2] || null, sell: r[3] || null, date: iso(r[4]), terminal: t.name, terminalId: t.id, version: t.gameVersion });
      }
    }
    const S = { nome: (a, b) => a.item.localeCompare(b.item), prezzo: (a, b) => (a.buy ?? Infinity) - (b.buy ?? Infinity), data: (a, b) => String(b.date).localeCompare(String(a.date)), categoria: (a, b) => a.cat.localeCompare(b.cat) || a.item.localeCompare(b.item) };
    return out.sort(S[sort] ?? S.nome);
  }

  /** Merci trattate ai terminali di una destinazione (prezzi segnalati, con data). */
  tradeOf(card) {
    if (!this.market) return null;
    const out = [];
    for (const t of card.terminals) for (const r of this.commByTerminal.get(t.id) ?? []) out.push(this.#commRow(r, t));
    return out.sort((a, b) => a.commodity.localeCompare(b.commodity));
  }
  #commRow(r, t) {
    const c = this.market.commodities?.[r[0]] ?? { name: `#${r[0]}` };
    return { commodity: c.name, commodityId: r[0], illegal: !!c.illegal, buy: r[2] || null, sell: r[3] || null, stock: r[5], demand: r[6], statusBuy: r[7], statusSell: r[8], containers: r[9], date: iso(r[10]), terminal: t.name, terminalId: t.id, place: t._place, freightElevator: t.flags.has_freight_elevator ?? null, autoLoad: t.flags.is_auto_load ?? null, maxContainer: t.maxContainer, system: t.system, version: t.gameVersion };
  }

  /** CERCA ARTICOLO: dove e' segnalata la vendita, con prezzo, negozio e destinazione. */
  findItem(q, { system = null, limit = 200 } = {}) {
    if (!this.market) return null;
    const qk = searchKey(q); if (qk.length < 2) return [];
    const items = Object.entries(this.market.items).filter(([, it]) => searchKey(it[0]).includes(qk));
    const ids = new Set(items.map(([id]) => +id));
    const out = [];
    for (const r of this.market.itemPrices) {
      if (!ids.has(r[0]) || !(r[2] > 0)) continue;
      const t = this.terminals[r[1]]; if (!t || (system && t.system !== system)) continue;
      const it = this.market.items[r[0]];
      out.push({ item: it[0], cat: itemCategory(this.market.categories[it[1]], it[0])[1], buy: r[2], date: iso(r[4]), terminal: t.name, terminalId: t.id, system: t.system, place: t._place, placeName: t._place ? this.geo.get(t._place)?.name ?? null : null, version: t.gameVersion });
    }
    return out.sort((a, b) => a.buy - b.buy).slice(0, limit);
  }

  /** DOVE POSSO VENDERE? Terminali che acquistano la merce; distanza solo nello stesso sistema. */
  whereToSell(q, { scu = null, from = null, system = null, limit = 60 } = {}) {
    if (!this.market) return null;
    const qk = searchKey(q); if (qk.length < 2) return { commodities: [], rows: [] };
    const comms = Object.values(this.market.commodities).filter((c) => searchKey(c.name).includes(qk) || (c.code && searchKey(c.code) === qk));
    const exact = comms.filter((c) => searchKey(c.name) === qk);
    const use = new Set((exact.length ? exact : comms).map((c) => c.id));
    const fromPlace = from ? this.geo.get(from) : null;
    const rows = [];
    for (const r of this.market.commodityPrices) {
      if (!use.has(r[0]) || !(r[3] > 0)) continue;
      const t = this.terminals[r[1]]; if (!t || (system && t.system !== system)) continue;
      const row = this.#commRow(r, t);
      const pl = t._place ? this.geo.get(t._place) : null;
      row.placeName = pl?.name ?? null;
      row.distance = fromPlace && pl ? this.geo.distance(fromPlace, pl) : null;
      row.distNote = fromPlace && pl && fromPlace.system !== pl.system ? 'altro sistema: nessuna distanza in linea retta' : fromPlace && !pl ? 'terminale non abbinato alla starmap' : null;
      row.total = scu ? r[3] * scu : null;
      row.demandNote = !row.demand ? 'domanda non segnalata' : scu && row.demand < scu ? `domanda segnalata ${row.demand} SCU: inferiore ai tuoi ${scu}` : `domanda segnalata ${row.demand} SCU`;
      const boxes = String(row.containers ?? '').split(',').map(Number).filter(Boolean);
      row.boxNote = boxes.length ? `casse ${boxes.join('/')} SCU` : row.maxContainer ? `casse fino a ${row.maxContainer} SCU` : 'dimensioni casse non segnalate';
      rows.push(row);
    }
    rows.sort((a, b) => b.sell - a.sell || (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return { commodities: [...use].map((id) => this.market.commodities[id]), rows: rows.slice(0, limit), note: 'prezzi segnalati dalla community (UEX), con la data di ogni segnalazione: non garantiti' };
  }

  // ------------------------------------------------------------ mining
  miningFor(id, ctx = null) {
    const own = this.mining[id] ?? null;
    const body = ctx?.body && ctx.body.id !== id ? ctx.body : null;
    const reg = body ? this.mining[body.id] ?? null : null;
    if (!own && !reg) return null;
    const refineries = this.refineriesNear(id && !String(id).includes(':') ? id : body?.id ?? null);
    return { own, regional: reg, regionalBody: body, refineries, note: 'tabelle di generazione del gioco: il materiale PUÒ generarsi nella zona, non è un giacimento confermato' };
  }

  refineriesNear(id) {
    const p = id ? this.geo.get(id) : null; if (!p) return [];
    const out = [];
    for (const q of this.geo.places) {
      if (q.system !== p.system || q.kind === 'personal') continue;
      const g = (this.game[q.id]?.amenities ?? []).includes('Refinery');
      const u = (this.uexByPlace.get(q.id) ?? []).some((l) => l.flags.has_refinery) || (this.termByPlace.get(q.id) ?? []).some((t) => t.flags.is_refinery || t.type === 'refinery');
      if (!g && !u) continue;
      out.push({ id: q.id, name: q.name, d: this.geo.distance(p, q), source: g && u ? 'file di gioco + UEX' : g ? 'file di gioco' : 'UEX' });
    }
    return out.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  }

  /** Punti del DATABASE PUNTI vicini (stesso sistema, entro maxM) o sullo stesso corpo. */
  personalNear(pos, system, body = null, excludeId = null, maxM = 200000) {
    const out = [];
    for (const [id, p] of this.personal) {
      if (id === excludeId || p.system !== system) continue;
      const d = pos && p.pos ? distance(pos, p.pos) : null;
      const sameBody = body && p.rec.body && searchKey(p.rec.body) === searchKey(body.name);
      if ((d !== null && d <= maxM) || sameBody) out.push({ id, name: p.rec.name, d, status: p.rec.status, resource: p.rec.resource ?? null, sperimentale: p.rec.status !== 'Verificato' });
    }
    return out.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  }

  #missing(card) {
    const m = new Map();
    for (const f of [...(card.env.exterior ?? []), ...(card.env.survival ?? []), ...(card.security ?? [])]) if (f.value === null && !m.has(f.label)) m.set(f.label, f.display);
    for (const r of card.services ?? []) if (r.values.every((v) => v.value === null) && !m.has(r.label)) m.set(r.label, r.values[0]?.display ?? ND);
    return [...m].map(([label, display]) => ({ label, display }));
  }

  // ------------------------------------------------------------ PREPARA SPEDIZIONE
  /**
   * Checklist dai dati disponibili. Tre gruppi separati; nulla e' dichiarato obbligatorio senza fonte.
   * @param activity 'trasporto'|'mining_nave'|'mining_veicolo'|'mining_fps'|'esplorazione'
   */
  prepare(card, ship, { activity = 'trasporto', fromId = null } = {}) {
    const doc = [], adv = [], miss = [];
    const env = card.env; const ext = Object.fromEntries((env.exterior ?? []).map((f) => [f.key, f]));
    const surv = Object.fromEntries((env.survival ?? []).map((f) => [f.key, f]));
    const say = (arr, text, src = null) => arr.push({ text, source: src });
    if (surv.helmet?.value && surv.helmet.status === 'documentata') say(doc, `Casco: ${surv.helmet.value} (${surv.helmet.note}).`, surv.helmet.sourceLabel);
    else if (surv.helmet?.value) say(adv, `Casco: ${surv.helmet.value} (${surv.helmet.note ?? 'calcolato'}).`, surv.helmet.sourceLabel);
    else say(miss, 'Respirabilità dell\'aria: non documentata. Porta casco e undersuit finché non verifichi.');
    if (ext.tmin?.value || ext.tmax?.value) say(doc, `Temperature documentate del corpo: ${ext.tmin?.value ?? '?'} / ${ext.tmax?.value ?? '?'}. Controlla i limiti termici della tua tuta nel gioco.`, ext.tmin?.sourceLabel);
    else if (env.context.mode !== 'spazio' && env.context.mode !== 'orbita') say(miss, 'Temperature: non documentate.');
    if (ext.grav?.value) say(doc, `Gravità: ${ext.grav.value}.`, ext.grav.sourceLabel);
    say(miss, 'Pressione, meteo, vento e visibilità: nessuna fonte collegata.');
    // servizi del luogo (mai quelli dei luoghi vicini)
    const svc = Object.fromEntries((card.services ?? []).map((r) => [r.key, r]));
    const yes = (k) => (svc[k]?.values ?? []).some((v) => v.value && !/assente|non segnalato/.test(v.value));
    const known = (k) => (svc[k]?.values ?? []).some((v) => v.value !== null);
    if (yes('h2') || yes('qt')) say(doc, 'Rifornimento segnalato sul posto (UEX): verifica il prezzo e la data della segnalazione.', SRC_LABEL.uex);
    else say(adv, 'Nessun rifornimento documentato a destinazione: parti con idrogeno e quantum sufficienti per andata e ritorno.');
    if (ship) {
      if (ship.fuelQt) say(doc, `${ship.name}: serbatoio quantum ${ship.fuelQt.toLocaleString('it-IT')} (unità del gioco), autonomia QT dichiarata ${ship.qtRange ? `${(ship.qtRange / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 })} Gm` : 'n.d.'}.`, SRC_LABEL.scu);
      if (ship.fuelH) say(doc, `${ship.name}: serbatoio idrogeno ${ship.fuelH.toLocaleString('it-IT')} (unità del gioco).`, SRC_LABEL.scu);
      const from = fromId ? this.geo.get(fromId) : null;
      if (from && card.place && ship.qtRange) {
        const d = this.geo.distance(from, card.place);
        if (d === null) say(miss, `Distanza da ${from.name}: non calcolabile in linea retta (sistemi diversi o posizione mancante).`);
        else say(d * 2 <= ship.qtRange ? doc : adv, `Andata e ritorno in linea retta da ${from.name}: ${(2 * d / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 })} Gm su ${(ship.qtRange / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 })} Gm di autonomia dichiarata${d * 2 > ship.qtRange ? ': NON basta, pianifica un rifornimento' : ''}. La rotta reale è più lunga.`, SRC_LABEL.calc);
      }
      if (activity === 'trasporto' && ship.cargo) {
        say(doc, `Stiva: ${ship.cargo} SCU.`, SRC_LABEL.scu);
        if (!known('fe') && !known('dock')) say(miss, 'Cargo elevator e loading dock: non documentati a destinazione.');
      }
      if (activity.startsWith('mining') && activity === 'mining_nave' && !ship.mining) say(adv, `${ship.name} non risulta una nave mineraria nei file di gioco (ruolo: ${ship.role ?? 'n.d.'}).`, SRC_LABEL.scu);
    } else say(miss, 'Nave non selezionata: carburante, autonomia e stiva non valutati.');
    if (!yes('medical')) say(adv, 'Nessun servizio medico documentato sul posto: porta MedPen e kit di primo soccorso.');
    if (!yes('repair')) say(adv, 'Nessuna riparazione documentata sul posto.');
    const sec = Object.fromEntries((card.security ?? []).map((f) => [f.key, f]));
    const armYes = (card.security ?? []).some((f) => (f.key === 'arm' || f.key === 'armU') && f.value === 'sì');
    if (!armYes) say(adv, 'Nessuna zona di armistizio documentata: considera armatura e armi. Nessun pericolo documentato non significa località sicura.');
    if (sec.jur?.value) say(doc, `Giurisdizione: ${sec.jur.value}${sec.jur.note ? ` (${sec.jur.note})` : ''}.`, sec.jur.sourceLabel);
    if (activity.startsWith('mining')) {
      const kind = { mining_nave: 'ship', mining_veicolo: 'vehicle', mining_fps: 'fps' }[activity];
      const m = card.mining; const groups = [...(m?.own ?? []), ...(m?.regional ?? [])].flatMap((e) => e.groups).filter((g) => g.kind === kind);
      if (groups.length) say(doc, `Materiali che possono generarsi (${groups[0].label}): ${[...new Set(groups.flatMap((g) => g.materials.map((x) => x.name)))].join(', ')}. Non sono giacimenti confermati.`, SRC_LABEL.scu);
      else say(miss, 'Nessun materiale documentato per questo tipo di mining nella zona.');
      if (activity === 'mining_fps') say(adv, 'Mining a piedi: multitool con modulo di estrazione e contenitore per i minerali.');
      if (activity === 'mining_veicolo') say(adv, 'Mining con veicolo: serve un veicolo da mining e un modo per portarlo sul posto.');
      const ref = m?.refineries?.[0];
      if (ref) say(doc, `Raffineria più vicina documentata: ${ref.name}${ref.d !== null ? ` (${(ref.d / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} Gm in linea retta)` : ''}, fonte ${ref.source}.`);
    }
    if (activity === 'esplorazione') say(adv, 'Esplorazione: scorte di cibo e acqua, luce, MedPen, mezzo di risalita alla nave.');
    for (const x of card.missing ?? []) miss.push({ text: `${x.label}: ${x.display}`, source: null });
    return { documented: doc, advice: adv, missing: miss };
  }
}
