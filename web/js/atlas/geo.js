// DATABASE GEOGRAFICO UNIFICATO dell'atlante: Sistema -> corpo -> luna -> stazione/base/POI.
// Fonti delle posizioni (stesso frame, stessi uuid, verificato il 2026-11-08):
//  - scunpacked-data starmap_positions.json (1.840 entita', comprese quelle nascoste sulla starmap)
//  - CitizenHQ /positions (739 entita' non nascoste), gia' usato da NAVCOM: fallback se il catalogo
//    dell'atlante non e' disponibile.
// Coordinate in metri nel frame della griglia del sistema, valori STATICI: non simulano le orbite
// o la rotazione dei pianeti. Nessuna coordinata viene inventata; i sistemi non si combinano mai.
import { distance, sub, norm } from '../core/vector.js';
import { normName } from '../logistics/model.js';
import { BODY_SEED } from '../data/bodies_seed.js';
import { RADII } from '../data/bodies.js';

export const SYSTEMS = ['stanton', 'pyro', 'nyx'];
export const SYSTEM_LABEL = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };

/** Tipo della starmap -> categoria dell'atlante. */
export function kindOf(type, name = '') {
  const t = String(type ?? '').toLowerCase();
  if (t === 'star') return 'star';
  if (t === 'planet') return 'planet';
  if (t === 'moon') return 'moon';
  if (t.startsWith('manmade')) return /gateway$/i.test(name) ? 'gateway' : 'station';
  if (t.startsWith('outpost')) return 'outpost';
  if (t === 'landingzone') return 'city';
  if (t === 'pointofinterest' || t === 'anomaly') return 'poi';
  if (t.startsWith('asteroid')) return 'asteroid';
  if (t === 'jumppoint') return 'jumppoint';
  if (t === 'navpoint') return 'navpoint';
  return 'other';
}
export const KIND_LABEL = {
  star: 'Stella', planet: 'Pianeta', moon: 'Luna', station: 'Stazione', gateway: 'Stazione gateway',
  outpost: 'Avamposto / base', city: 'Città / zona di atterraggio', poi: 'Punto di interesse', asteroid: 'Asteroide / campo',
  jumppoint: 'Jump point', navpoint: 'Punto di navigazione', other: 'Altro', personal: 'Punto personale',
};
/**
 * Alias curati: nomi usati dai contratti per luoghi che la starmap rappresenta con un altro nome.
 * Solo corrispondenze note e univoche (spazioporto -> citta' che lo ospita); nessuna coordinata nuova:
 * il luogo prende la posizione della citta' e lo dice.
 */
export const ALIASES = {
  'Teasa Spaceport': 'Lorville',
  'August Dunlow Spaceport': 'Orison',
  'Riker Memorial Spaceport': 'Area18',
  'NB Int. Spaceport': 'New Babbage',
  'New Babbage Interstellar Spaceport': 'New Babbage',
};
export const BODY_KINDS = new Set(['star', 'planet', 'moon']);

const seedRadius = (() => {
  const m = new Map();
  for (const b of BODY_SEED.stanton?.bodies ?? []) m.set(`stanton|${normName(b.name)}`, { r: b.body_radius_m, src: 'starmap.space (seed NAVCOM)' });
  for (const [sys, list] of Object.entries(RADII)) for (const [n, r] of Object.entries(list)) m.set(`${sys}|${normName(n)}`, { r, src: 'starmap.space (seed NAVCOM)' });
  return m;
})();

/**
 * Normalizza le entita' della starmap (scunpacked o CitizenHQ) in luoghi canonici.
 * @param rows [{uuid,name,type,system,parent_uuid|parentUuid,hidden?,qt_valid|qtValid,x,y,z}]
 */
export function normalizePlaces(rows, { source, patch = null, updatedAt = null, terminals = [] } = {}) {
  const term = new Map();
  for (const t of terminals) {
    if (t.Disabled || !t.DisplayName) continue;
    const k = normName(t.DisplayName);
    if (!term.has(k)) term.set(k, []);
    term.get(k).push({ tags: [...new Set((t.ProducesTags?.Positive ?? []).concat(t.ConsumesTags?.Positive ?? []).map((x) => x.Name))].slice(0, 40) });
  }
  const out = [];
  for (const r of rows) {
    if (!r?.uuid || !r.name) continue;
    const x = Number(r.x), y = Number(r.y), z = Number(r.z);
    const hasPos = [x, y, z].every(Number.isFinite);
    const system = String(r.system ?? '').toLowerCase();
    if (!SYSTEMS.includes(system)) continue;
    const kind = kindOf(r.type, r.name);
    const services = [];
    if (term.has(normName(r.name)) && !BODY_KINDS.has(kind)) services.push({ id: 'terminale', label: 'Terminale commerciale nei file di gioco', source: 'scunpacked trade_locations (abbinato per nome)', tags: term.get(normName(r.name))[0].tags });
    const rad = BODY_KINDS.has(kind) ? seedRadius.get(`${system}|${normName(r.name)}`) ?? null : null;
    out.push({
      id: r.uuid, name: String(r.name).trim(), aliases: [], type: r.type ?? null, kind, system,
      parentId: r.parent_uuid ?? r.parentUuid ?? null,
      pos: hasPos ? { x, y, z } : null, frame: 'sistema (statico)',
      hidden: !!r.hidden, qtValid: !!(r.qt_valid ?? r.qtValid),
      radius: rad?.r ?? null, radiusSource: rad?.src ?? null,
      services, source, patch, updatedAt,
      ext: { starmap: r.uuid },
    });
  }
  return out;
}

export class Geo {
  /** @param places luoghi canonici; personal = punti personali [{id,name,system,pos,notes}] */
  constructor(places, { connections = [], meta = {}, personal = [] } = {}) {
    this.meta = meta;
    this.places = places.slice();
    for (const p of personal) {
      if (!p.pos || !SYSTEMS.includes(p.system)) continue;
      this.places.push({ id: `personal:${p.id}`, name: p.name, aliases: [], type: 'personale', kind: 'personal', system: p.system, parentId: null, pos: p.pos, frame: 'sistema (punto personale)', hidden: false, qtValid: false, radius: null, services: [], source: 'DATABASE PUNTI (personale)', patch: null, updatedAt: p.updatedAt ?? null, ext: {}, personal: p });
    }
    this.byId = new Map(this.places.map((p) => [p.id, p]));
    this.kids = new Map();
    for (const p of this.places) {
      if (!p.parentId || !this.byId.has(p.parentId)) continue;
      if (!this.kids.has(p.parentId)) this.kids.set(p.parentId, []);
      this.kids.get(p.parentId).push(p);
    }
    // punti personali: associati al corpo piu' vicino entro 1,5 raggi (solo se il raggio e' noto)
    for (const p of this.places.filter((x) => x.kind === 'personal')) {
      const b = this.places.filter((x) => (x.kind === 'planet' || x.kind === 'moon') && x.system === p.system && x.radius && x.pos)
        .map((x) => ({ x, d: distance(x.pos, p.pos) })).filter((o) => o.d <= o.x.radius * 1.5).sort((a, b) => a.d - b.d)[0];
      if (b) { p.parentId = b.x.id; p.parentHow = 'corpo più vicino (entro 1,5 raggi)'; if (!this.kids.has(b.x.id)) this.kids.set(b.x.id, []); this.kids.get(b.x.id).push(p); }
    }
    this.connections = connections;
    this.names = new Map();
    for (const p of this.places) {
      for (const n of [p.name, ...p.aliases]) { const k = normName(n); if (!this.names.has(k)) this.names.set(k, []); this.names.get(k).push(p); }
    }
  }

  get(id) { return this.byId.get(id) ?? null; }
  children(id) { return this.kids.get(id) ?? []; }
  inSystem(sys) { return this.places.filter((p) => p.system === sys); }
  star(sys) { return this.places.find((p) => p.system === sys && p.kind === 'star') ?? null; }

  /** Catena dei genitori, dal sistema al luogo. */
  path(id) {
    const out = []; let p = this.get(id); const seen = new Set();
    while (p && !seen.has(p.id)) { out.unshift(p); seen.add(p.id); p = p.parentId ? this.get(p.parentId) : null; }
    return out;
  }
  pathLabel(id) {
    const p = this.get(id); if (!p) return '';
    return [SYSTEM_LABEL[p.system], ...this.path(id).filter((x) => x.kind !== 'star').map((x) => x.name)].join(' → ');
  }
  /** Corpo (pianeta o luna) a cui il luogo appartiene. */
  bodyOf(id) {
    const chain = this.path(id).reverse();
    return chain.find((x) => x.kind === 'planet' || x.kind === 'moon') ?? null;
  }
  /** Pianeta di riferimento (per la vista "pianeta"). */
  planetOf(id) { return this.path(id).find((x) => x.kind === 'planet') ?? null; }

  /** Ricerca testuale (prefisso/parole). */
  search(text, { system = null, limit = 30 } = {}) {
    const q = normName(text); if (!q) return [];
    const words = q.split(' ');
    const score = (p) => { const n = normName(p.name); if (n === q) return 0; if (n.startsWith(q)) return 1; if (words.every((w) => n.includes(w))) return 2; return 9; };
    return this.places.filter((p) => (!system || p.system === system)).map((p) => [score(p), p]).filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(([, p]) => p);
  }

  /** Nome -> luogo unico (esatto o compatto); null se non trovato o ambiguo. */
  resolveName(name, system = null) { return this.resolve(name, system)?.place ?? null; }

  /**
   * Risoluzione con il metodo usato: esatto, compatto (spazi), suffisso unico ("Wide Forest Station"
   * -> "ARC-L1 Wide Forest Station"), alias curato. Ambiguo o non trovato -> null.
   * @returns {{place, how}|null}
   */
  resolve(name, system = null) {
    const ck = `${system ?? ''}|${name}`;
    this.cache ??= new Map();
    if (!this.cache.has(ck)) this.cache.set(ck, this.#resolve(name, system));
    return this.cache.get(ck);
  }

  #resolve(name, system) {
    let k = normName(name); if (!k) return null;
    let how = 'esatto';
    const alias = Object.entries(ALIASES).find(([a]) => normName(a) === k);
    if (alias) { k = normName(alias[1]); how = 'alias'; }
    const pick = (list) => {
      if (system) { const s = list.filter((p) => p.system === system); if (s.length) list = s; }
      const ids = [...new Set(list.map((p) => p.id))];
      return ids.length === 1 ? this.get(ids[0]) : ids.length > 1 ? false : null;
    };
    const tries = [
      [() => this.names.get(k) ?? [], how],
      [() => this.compactIdx().get(k.replace(/ /g, '')) ?? [], 'compatto'],
      [() => this.normList().filter(([n]) => n.endsWith(` ${k}`)).map(([, p]) => p), 'suffisso'],
    ];
    for (const [f, h] of tries) {
      const r = pick(f());
      if (r === false) return null; // ambiguo: nessuna scelta arbitraria
      if (r) return { place: r, how: how === 'alias' ? 'alias' : h };
    }
    return null;
  }

  normList() { return (this._nl ??= this.places.map((p) => [normName(p.name), p])); }
  compactIdx() {
    if (!this._ci) { this._ci = new Map(); for (const [n, p] of this.normList()) { const c = n.replace(/ /g, ''); if (!this._ci.has(c)) this._ci.set(c, []); this._ci.get(c).push(p); } }
    return this._ci;
  }

  /** Distanza reale in metri; null fra sistemi diversi o senza posizione. */
  distance(a, b) {
    const pa = typeof a === 'string' ? this.get(a) : a, pb = typeof b === 'string' ? this.get(b) : b;
    if (!pa?.pos || !pb?.pos || pa.system !== pb.system) return null;
    return distance(pa.pos, pb.pos);
  }

  /**
   * Collocazione sul globo del corpo. Ammessa solo se il raggio del corpo e' noto e il luogo sta a
   * meno del 10 % dalla superficie. Latitudine/longitudine sono nel frame fisso del corpo ricavato
   * dal dato statico: NON sono le coordinate mostrate dal gioco.
   */
  surface(id) {
    const p = this.get(id); const body = this.bodyOf(id);
    if (p && body && body.id === p.id) return { ok: false, note: 'è il corpo celeste stesso' };
    if (!p?.pos || !body?.pos) return { ok: false, note: 'non appartiene a un corpo celeste' };
    const off = sub(p.pos, body.pos); const r = norm(off);
    if (!body.radius) return { ok: false, body, r, note: `raggio di ${body.name} non noto: posizione sul globo non verificabile` };
    const alt = r - body.radius;
    if (Math.abs(alt) > body.radius * 0.1) return { ok: false, orbit: alt > 0, body, r, alt, note: alt > 0 ? `in orbita a ${Math.round(alt / 1000)} km dalla superficie` : 'sotto la superficie rispetto al raggio noto: dato incoerente' };
    return { ok: true, body, r, alt, lat: Math.asin(off.z / r), lon: Math.atan2(off.y, off.x), note: 'posizione relativa nel frame fisso del corpo (dato statico); non sono le coordinate del gioco' };
  }
}

/** Geo dal catalogo dell'atlante (data/atlas/geo.json) o, in mancanza, dalle posizioni CitizenHQ. */
export function geoFromSnapshot(snap, personal = []) {
  return new Geo(snap.places, { connections: snap.connections ?? [], meta: snap.meta ?? {}, personal });
}
export function geoFromCitizenHQ(rowsBySystem, personal = []) {
  const rows = []; const meta = { source: 'CitizenHQ (posizioni importate in NAVCOM)', systems: {} };
  for (const [sys, list] of Object.entries(rowsBySystem)) {
    rows.push(...list.map((r) => ({ ...r, system: sys })));
    meta.systems[sys] = list.length;
  }
  return new Geo(normalizePlaces(rows, { source: 'CitizenHQ' }), { meta, personal });
}
