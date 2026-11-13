// MISSION CONTROL: logica pura del Contract Manager di NAVCOM (browser e test).
// Lavora sulle viste del Mission Database 2.0 (dbViews) e sui contratti registrati da te.
// Regole: nessuna missione e' "disponibile adesso"; la regione d'OFFERTA non e' il luogo di RITIRO;
// un pool resta un insieme di luoghi possibili; un requisito non registrato non si presume soddisfatto.
import { cargoOf } from './finder.js';
import { systemsPath } from './build.js';
import { evaluateStack, stackTypes, jumpLeg } from '../atlas/stack.js';
import { stopsOf } from '../atlas/plan.js';

// ---------------------------------------------------------------- categorie (stile mobiGlas, calcolate da NAVCOM)
export const MC_CATS = {
  tr_local: { label: 'Trasporto locale', note: 'ritiro e consegna sullo stesso corpo celeste (o nella stessa area senza corpo)' },
  tr_inter: { label: 'Trasporto fra pianeti e lune', note: 'corpi diversi dello stesso sistema' },
  tr_star: { label: 'Trasporto fra sistemi', note: 'ritiro e consegna in sistemi diversi' },
  tr_multi: { label: 'Trasporto multidestinazione', note: 'più ritiri o più consegne' },
  tr_open: { label: 'Trasporto: destinazioni da determinare', note: 'il pool ammette più classi o i luoghi non sono nei dati' },
  delivery: { label: 'Consegne e piccoli pacchi', note: 'Delivery e Courier' },
  bounty: { label: 'Bounty hunting', note: 'Bounty Hunter e PvP' },
  merc: { label: 'Mercenary e combattimento', note: 'Mercenary, Battaglia, ECN Alert' },
  invest: { label: 'Investigazione', note: 'Investigation, Search, Research' },
  recovery: { label: 'Recupero, raccolta e manutenzione', note: 'Collection, Maintenance, Refueling, Salvage, Service Beacons' },
  mining: { label: 'Mining', note: 'nave, veicolo, a mano' },
  event: { label: 'Eventi e missioni speciali', note: 'Priority, RSI Discovery Event' },
  wikelo: { label: 'Wikelo (scambi)', note: '' },
  racing: { label: 'Corse', note: '' },
  other: { label: 'Altre', note: 'tipi presenti nel catalogo senza una categoria dedicata' },
  illegal: { label: 'Illegali / non verificate', note: 'contratti marcati illegali nei file, di qualsiasi tipo' },
};
const TYPE_KIND = {
  'Delivery': 'delivery', 'Courier': 'delivery',
  'Bounty Hunter': 'bounty', 'PvP Missions': 'bounty',
  'Mercenary': 'merc', 'Battaglia': 'merc', 'ECN Alert': 'merc',
  'Investigation': 'invest', 'Search': 'invest', 'Research': 'invest',
  'Collection': 'recovery', 'Maintenance': 'recovery', 'Refueling': 'recovery', 'Salvage': 'recovery', 'Service Beacons': 'recovery',
  'Priority': 'event', 'RSI Discovery Event': 'event',
  'Racing': 'racing', 'Wikelo - Vehicles': 'wikelo', 'Wikelo - Other Items': 'wikelo',
};
const isTransportType = (v) => /^Hauling/.test(v.type ?? '') || (v.origin !== 'catalogo' && v.ops?.some((o) => o.role === 'pickup'));

/** Natura della missione (senza la geografia). */
export function missionKind(v) {
  if (isTransportType(v)) return 'transport';
  if (v.type === 'Mercenary' && v.scope === 'Bounty Hunter') return 'bounty';
  if (TYPE_KIND[v.type]) return TYPE_KIND[v.type];
  if (v.category === 'mining') return 'mining';
  if (v.category === 'hauling') return 'transport';
  return 'other';
}

// ---------------------------------------------------------------- geografia
export const GEO = {
  locale: { label: 'LOCALE', note: 'stesso corpo celeste' },
  interplanetario: { label: 'INTERPLANETARIO', note: 'corpi diversi, stesso sistema' },
  interstellare: { label: 'INTERSTELLARE', note: 'sistemi diversi: passa dai jump point' },
  da_determinare: { label: 'DA DETERMINARE', note: 'il gioco sceglie i luoghi dal pool: più classi possibili' },
  sistema: { label: 'IN UN SISTEMA', note: 'luoghi operativi su più corpi dello stesso sistema' },
  multisistema: { label: 'PIÙ SISTEMI', note: 'luoghi operativi in più sistemi' },
  ignota: { label: 'NON NOTA', note: 'nessun luogo nei dati' },
};
/** Area locale di un luogo: il suo corpo (pianeta o luna) o, senza corpo, il luogo stesso. */
export const areaOf = (geo, id) => geo.bodyOf(id)?.id ?? id;
/** Sistema planetario (pianeta con lune e stazioni): per "destinazioni vicine". */
export const planetAreaOf = (geo, id) => geo.planetOf(id)?.id ?? geo.bodyOf(id)?.id ?? id;
const cands = (o) => [...new Set([...(o.ids ?? []), ...(o.alt ?? [])])];
const anc = new WeakMap();
/** Il luogo sta nell'area ({system} o {id})? Antenati in cache: l'elenco si ricalcola a ogni filtro. */
export function inArea(geo, id, area) {
  if (!id || !area) return false;
  let m = anc.get(geo); if (!m) { m = new Map(); anc.set(geo, m); }
  let a = m.get(id); if (!a) { a = new Set(geo.path(id).map((p) => p.id)); a.sys = geo.get(id)?.system ?? null; m.set(id, a); }
  if (!area.id) return !!area.system && a.sys === area.system;
  return a.has(area.id);
}
/** Come matchRole del finder, con il test d'area in cache. */
export function roleIn(v, role, area, geo) {
  const ops = (v.ops ?? []).filter((o) => o.role === role); if (!ops.length) return null;
  let best = 'no';
  for (const o of ops) {
    const c = cands(o); const inside = c.filter((id) => inArea(geo, id, area)); if (!inside.length) continue;
    if (inside.length === c.length && !(o.unresolved ?? []).length && !o.anonymous) return 'certo';
    best = 'possibile';
  }
  return best;
}
const isFixed = (o) => (o.fixed !== undefined ? !!o.fixed : (o.ids?.length === 1 && !(o.alt ?? []).length && !(o.unresolved ?? []).length && (o.size ?? 1) <= 1));

/**
 * Classificazione geografica (indipendente dalla categoria).
 * @returns {{cls, sure, possible:string[], multi, basis:'luoghi'|'pool'|'obiettivo'|'offerta'|'tipo'|'nessuna', areas, systems, note}}
 */
export function geoClass(v, geo) {
  const picks = v.ops?.filter((o) => o.role === 'pickup') ?? [], drops = v.ops?.filter((o) => o.role === 'dropoff') ?? [];
  const slots = (list) => new Set(list.map((o) => o.slot)).size;
  if (picks.length && drops.length) {
    const multi = slots(picks) > 1 || slots(drops) > 1;
    const known = [...picks, ...drops].every((o) => cands(o).some((id) => geo.get(id)));
    if (!known) return { cls: 'da_determinare', sure: false, possible: [], multi, basis: 'nessuna', note: 'ritiro o consegna senza luoghi riconosciuti nei dati' };
    const by = (list) => { const m = new Map(); for (const o of list) for (const id of cands(o)) { const p = geo.get(id); if (!p) continue; const s = m.get(p.system) ?? new Set(); s.add(areaOf(geo, id)); m.set(p.system, s); } return m; };
    const P = by(picks), D = by(drops);
    const possible = new Set();
    for (const [sp, ap] of P) for (const [sd, ad] of D) {
      if (sp !== sd) { possible.add('interstellare'); continue; }
      if ([...ap].some((a) => ad.has(a))) possible.add('locale');
      if (ap.size > 1 || ad.size > 1 || [...ap].some((a) => !ad.has(a))) possible.add('interplanetario');
    }
    const all = [...picks, ...drops].every(isFixed);
    const list = ['locale', 'interplanetario', 'interstellare'].filter((k) => possible.has(k));
    const sure = list.length === 1;
    return {
      cls: sure ? list[0] : 'da_determinare', sure, possible: list, multi, basis: all ? 'luoghi' : 'pool',
      systems: { pickup: [...P.keys()], dropoff: [...D.keys()] },
      note: sure ? (all ? 'ritiro e consegna fissi' : 'tutti i luoghi possibili del pool danno la stessa classe') : `il pool ammette: ${list.map((k) => GEO[k].label).join(', ')}`,
    };
  }
  const obj = (v.objectives ?? []).filter((o) => cands(o).some((id) => geo.get(id)));
  const fromPlaces = (ids, basis, note) => {
    const sys = new Set(ids.map((id) => geo.get(id)?.system).filter(Boolean)); const areas = new Set(ids.map((id) => areaOf(geo, id)));
    const cls = sys.size > 1 ? 'multisistema' : areas.size > 1 ? 'sistema' : 'locale';
    return { cls, sure: basis === 'obiettivo' && obj.every(isFixed), possible: [cls], multi: false, basis, areas: [...areas], systems: { all: [...sys] }, note };
  };
  if (obj.length) return fromPlaces(obj.flatMap(cands).filter((id) => geo.get(id)), 'obiettivo', obj.every(isFixed) ? 'luogo dell\'obiettivo fisso' : `obiettivo in uno fra ${obj.flatMap(cands).length} luoghi`);
  const off = (v.offer ?? []).map((o) => o.id).filter((id) => id && geo.get(id));
  if (off.length) { const f = fromPlaces(off, 'offerta', ''); return { ...f, cls: 'ignota', possible: [], sure: false, note: `luogo operativo non nei dati; offerta in ${off.length > 1 ? `${off.length} regioni` : geo.get(off[0]).name}` }; }
  return { cls: 'ignota', sure: false, possible: [], multi: false, basis: 'nessuna', note: 'nessun luogo nei dati' };
}

/** Categoria del Mission Control. */
export function mcCategory(v, geo, gc = geoClass(v, geo)) {
  const k = missionKind(v);
  if (k !== 'transport') return k;
  if (gc.multi) return 'tr_multi';
  return gc.sure ? { locale: 'tr_local', interplanetario: 'tr_inter', interstellare: 'tr_star' }[gc.cls] ?? 'tr_open' : 'tr_open';
}

// ---------------------------------------------------------------- posizione e regione
/** Regione di un luogo: luogo, corpo, pianeta, sistema. */
export function regionOf(geo, placeId) {
  const place = geo.get(placeId); if (!place) return null;
  const body = geo.bodyOf(placeId); const planet = geo.planetOf(placeId);
  return { place, body, planet, system: place.system, chain: geo.path(placeId) };
}
export const SCOPES = {
  luogo: { label: 'solo questo luogo' },
  corpo: { label: 'corpo celeste (regione)' },
  sistema: { label: 'intero sistema' },
};
/** Area di ricerca per i ruoli ritiro/consegna/obiettivo. */
export function scopeArea(region, scope) {
  if (!region) return null;
  if (scope === 'sistema') return { system: region.system };
  if (scope === 'luogo') return { id: region.place.id, system: region.system };
  return { id: (region.body ?? region.place).id, system: region.system };
}
const OFFER_RANK = { luogo: 0, area: 1, corpo: 2, sistema: 3 };
/**
 * Dove la missione puo' essere OFFERTA rispetto alla regione.
 * luogo = il luogo stesso; corpo = il suo pianeta/luna; area = un luogo dentro l'area scelta; sistema = la stella.
 * @returns {{level, via}|null}
 */
export function offerRelation(v, region, geo, scope = 'corpo') {
  if (!region) return null;
  const chain = new Map(region.chain.map((p) => [p.id, p]));
  const area = scopeArea(region, scope);
  let best = null;
  for (const o of v.offer ?? []) {
    if (!o.id) continue;
    let level = null; const p = geo.get(o.id); if (!p) continue;
    if (o.id === region.place.id) level = 'luogo';
    else if (chain.has(o.id)) level = p.kind === 'star' ? 'sistema' : (p.kind === 'planet' || p.kind === 'moon') ? 'corpo' : 'corpo';
    else if (area?.id && inArea(geo, o.id, area)) level = 'area';
    else if (scope === 'sistema' && p.system === region.system) level = 'area';
    if (level && (!best || OFFER_RANK[level] < OFFER_RANK[best.level])) best = { level, via: p };
  }
  if (!best) return null;
  if (scope === 'luogo' && best.level !== 'luogo') return null;
  if (scope === 'corpo' && best.level === 'sistema') return { ...best, wide: true };
  return best;
}
/** Testo onesto per la relazione d'offerta. */
export function offerText(rel, region) {
  if (!rel) return null;
  if (rel.level === 'luogo') return `offerta indicata a ${rel.via.name}`;
  if (rel.level === 'corpo') return `offerta nella regione ${rel.via.name} (non specificamente a ${region.place.name})`;
  if (rel.level === 'area') return `offerta a ${rel.via.name}, nella regione scelta`;
  return `offerta in tutto il sistema ${rel.via.name}`;
}
/** Ruolo dell'obiettivo (bounty, mercenari...) nell'area. */
export function matchObjective(v, area, geo) {
  const obj = v.objectives ?? []; if (!obj.length) return null;
  let best = 'no';
  for (const o of obj) {
    const c = cands(o); const inside = c.filter((id) => inArea(geo, id, area)); if (!inside.length) continue;
    if (inside.length === c.length && !(o.unresolved ?? []).length) return 'certo';
    best = 'possibile';
  }
  return best;
}
/** Relazioni della missione con la regione (sempre separate: offerta / ritiro / consegna / obiettivo). */
export function regionRelation(v, region, geo, scope = 'corpo') {
  if (!region) return { offer: null, pickup: null, dropoff: null, objective: null };
  const area = scopeArea(region, scope);
  const norm = (x) => (x === 'no' ? null : x);
  return { offer: offerRelation(v, region, geo, scope), pickup: norm(roleIn(v, 'pickup', area, geo)), dropoff: norm(roleIn(v, 'dropoff', area, geo)), objective: norm(matchObjective(v, area, geo)) };
}

// ---------------------------------------------------------------- profilo e requisiti
export const EMPTY_PROFILE = () => ({ standings: [], completed: [], tags: [], crime: null, notes: '', updatedAt: null });
/**
 * Scale di reputazione ricavate dal catalogo: (fazione|scope) -> [{name, rep}] ordinate.
 * Fonti: grado minimo/massimo del modello (MinStanding/MaxStanding) e prerequisito di reputazione.
 */
export function ladders(views) {
  const L = new Map();
  const add = (faction, scope, name, rep) => {
    if (!faction || !name || !Number.isFinite(rep) || /^<=/.test(name)) return;
    for (const k of [`${faction}|${scope ?? '*'}`, `${faction}|*`]) { const m = L.get(k) ?? new Map(); if (!m.has(name)) m.set(name, rep); L.set(k, m); }
  };
  for (const v of views) {
    add(v.company, v.repScope, v.rank, v.rankRep); add(v.company, v.repScope, v.rankMax, v.rankMaxRep);
    if (v.faction && v.faction !== v.company) { add(v.faction, v.repScope, v.rank, v.rankRep); add(v.faction, v.repScope, v.rankMax, v.rankMaxRep); }
    if (v.repReq) { add(v.repReq.faction, v.repReq.scope, v.repReq.min, v.repReq.minRep); add(v.repReq.faction, v.repReq.scope, v.repReq.max, v.repReq.maxRep); }
  }
  const out = new Map();
  for (const [k, m] of L) out.set(k, [...m].map(([name, rep]) => ({ name, rep })).sort((a, b) => a.rep - b.rep || a.name.localeCompare(b.name)));
  return out;
}
const ladderOf = (L, faction, scope) => L.get(`${faction}|${scope ?? '*'}`) ?? L.get(`${faction}|*`) ?? null;
/** Reputazione del giocatore presso una fazione (dal profilo): numero o null se non registrata. */
export function standingRep(profile, L, faction, scope) {
  if (!faction) return null;
  const list = (profile?.standings ?? []).filter((s) => s.faction === faction);
  const e = list.find((s) => s.scope && s.scope === scope) ?? list.find((s) => !s.scope) ?? null;
  if (!e) return null;
  if (Number.isFinite(e.rep)) return e.rep;
  const lad = ladderOf(L, faction, e.scope ?? scope); const t = lad?.find((x) => x.name === e.standing);
  return t ? t.rep : null;
}
const tierIndex = (lad, rep) => { let i = -1; for (let k = 0; k < lad.length; k++) if (lad[k].rep <= rep) i = k; return i; };

/**
 * Requisiti noti contro il profilo. ok:true soddisfatto, false non soddisfatto, null non verificabile.
 * @returns {{state:'ok'|'no'|'unknown', checks:{what, ok, note}[]}}
 */
export function accessCheck(v, profile, L) {
  const checks = [];
  const repCheck = (what, faction, scope, minName, minRep, maxName) => {
    const lad = ladderOf(L, faction, scope);
    const need = Number.isFinite(minRep) ? minRep : lad?.find((x) => x.name === minName)?.rep ?? null;
    const capped = !!(maxName && lad?.some((x) => x.name === maxName));
    // grado minimo nullo e nessun tetto: nessun requisito reale (il grado di partenza lo hanno tutti)
    if ((need === null || need <= 0) && !capped) return;
    const mine = standingRep(profile, L, faction, scope);
    if (mine === null) { checks.push({ what, ok: null, note: need > 0 ? `richiede ${minName ?? need} con ${faction}: grado non registrato nel profilo` : `offerta fino al grado ${maxName} con ${faction}: grado non registrato nel profilo` }); return; }
    if (need > 0 && mine < need) { checks.push({ what, ok: false, note: `richiede ${minName ?? need} (${need}) con ${faction}: il tuo profilo ha ${mine}` }); return; }
    if (maxName && lad) {
      const iMax = lad.findIndex((x) => x.name === maxName);
      if (iMax >= 0 && tierIndex(lad, mine) > iMax) { checks.push({ what, ok: false, note: `offerta fino al grado ${maxName} con ${faction}: il tuo grado è superiore` }); return; }
    }
    checks.push({ what, ok: true, note: `${minName ?? need} con ${faction}: soddisfatto` });
  };
  if (v.company && (Number.isFinite(v.rankRep) || v.rank)) repCheck('grado', v.company, v.repScope, v.rank, v.rankRep, v.rankMax);
  // stesso requisito scritto due volte (grado del modello e prerequisito con il nome breve della fazione): contato una volta
  const sameAsRank = (r) => r.min && r.min === v.rank && v.company && (v.company.startsWith(r.faction) || r.faction.startsWith(v.company));
  if (v.repReq?.faction && !sameAsRank(v.repReq)) repCheck('reputazione', v.repReq.faction, v.repReq.scope, v.repReq.min, v.repReq.minRep, null);
  const done = new Set((profile?.completed ?? []).flatMap((c) => [c.uuid, c.title].filter(Boolean)));
  const tags = new Set(profile?.tags ?? []);
  for (const g of v.prereqs ?? []) {
    const hits = g.missions.filter((m) => done.has(m.uuid) || (m.title && done.has(m.title))).length + g.tags.filter((t) => tags.has(t)).length;
    const need = g.need ?? 1;
    const label = [...g.missions.map((m) => m.title ?? m.debug ?? 'missione senza titolo'), ...g.tags.map((t) => `tag ${t}`)].slice(0, 4).join(', ');
    if (hits >= need) checks.push({ what: 'prerequisito', ok: true, note: `${label}: registrato come completato` });
    else checks.push({ what: 'prerequisito', ok: null, note: `richiede ${need > 1 ? `${need} completamenti fra` : ''} ${label}${g.missions.length + g.tags.length > 4 ? '…' : ''}: non registrato nel profilo` });
  }
  const cr = v.risk?.crime;
  if (Array.isArray(cr) && cr.some((x) => x !== null) && !((cr[0] ?? 0) <= 0 && (cr[1] ?? 5) >= 5)) {
    const c = profile?.crime;
    if (c === null || c === undefined || c === '') checks.push({ what: 'CrimeStat', ok: null, note: `CrimeStat ammesso ${cr[0] ?? 0}–${cr[1] ?? 5}: il tuo non è registrato` });
    else checks.push({ what: 'CrimeStat', ok: c >= (cr[0] ?? 0) && c <= (cr[1] ?? 5), note: `CrimeStat ammesso ${cr[0] ?? 0}–${cr[1] ?? 5}, il tuo ${c}` });
  }
  const state = checks.some((c) => c.ok === false) ? 'no' : checks.some((c) => c.ok === null) ? 'unknown' : 'ok';
  return { state, checks };
}

// ---------------------------------------------------------------- disponibilita'
export const AVAIL = {
  catalogata: { icon: '🟠', label: 'CATALOGATA', note: 'presente nei dati del gioco: non è un\'offerta' },
  regione: { icon: '🟣', label: 'COMPATIBILE CON LA REGIONE', note: 'i dati la offrono nella regione; requisiti da verificare' },
  accessibile: { icon: '🟡', label: 'POTENZIALMENTE ACCESSIBILE', note: 'regione e requisiti registrati compatibili: va trovata nel mobiGlas' },
  non_accessibile: { icon: '⛔', label: 'NON ACCESSIBILE', note: 'un requisito registrato nel profilo non è soddisfatto' },
  visibile: { icon: '🔵', label: 'VISIBILE NEL MIO MOBIGLAS', note: 'confermata da te' },
  accettata: { icon: '🟢', label: 'ACCETTATA', note: 'confermata da te (solo nell\'archivio di NAVCOM)' },
  completata: { icon: '✔', label: 'COMPLETATA', note: 'stato inserito da te' },
  fallita: { icon: '✖', label: 'FALLITA', note: 'stato inserito da te' },
};
export const RECORD_STATES = ['visibile', 'accettata', 'completata', 'fallita'];

/** Stato di disponibilita' di un modello, dati regione, profilo e le tue registrazioni. */
export function availability(v, { region = null, scope = 'corpo', geo, profile = null, L = new Map(), record = null } = {}) {
  if (record) return { state: record.status, notes: [], access: null, rel: null };
  const access = accessCheck(v, profile, L);
  const rel = region ? regionRelation(v, region, geo, scope) : null;
  const notes = [];
  if (!region) notes.push('posizione non impostata: regione non valutata');
  else if (!(v.offer ?? []).length) notes.push(v.offerUnknown ? 'luoghi d\'offerta non riconosciuti nella starmap' : 'luogo d\'offerta non indicato nei dati');
  if (!rel?.offer) return { state: 'catalogata', notes, access, rel };
  if (access.state === 'no') return { state: 'non_accessibile', notes, access, rel };
  return { state: access.state === 'ok' ? 'accessibile' : 'regione', notes, access, rel };
}

// ---------------------------------------------------------------- elenco
export const TABS = {
  offerte: { label: 'OFFERTE', note: 'modelli del catalogo filtrati per regione e profilo' },
  visibili: { label: 'VISTE NEL MOBIGLAS', note: 'registrate da te' },
  accettate: { label: 'ACCETTATE', note: 'confermate da te' },
  storico: { label: 'STORICO', note: 'completate e fallite' },
  eventi: { label: 'PRIORITY / EVENTI', note: 'Priority e RSI Discovery Event' },
};
const tabOfRecord = (r) => (r.status === 'visibile' ? 'visibili' : r.status === 'accettata' ? 'accettate' : 'storico');

/** Distanza dalla posizione al primo luogo operativo noto (ritiro o obiettivo), anche fra sistemi via gateway. */
export function distanceFrom(v, from, geo, links = []) {
  if (!from) return null;
  const ops = [...(v.ops ?? []).filter((o) => o.role === 'pickup'), ...(v.objectives ?? [])];
  let best = null;
  for (const o of ops) for (const id of cands(o)) {
    const p = geo.get(id); if (!p?.pos || !from.pos) continue;
    const d = p.system === from.system ? geo.distance(from, p) : jumpMemo(geo, from, p, links);
    if (d !== null && (best === null || d < best.d)) best = { d, fixed: isFixed(o), via: p.system !== from.system };
  }
  return best;
}
const jm = new WeakMap();
function jumpMemo(geo, from, p, links) {
  let m = jm.get(geo); if (!m) { m = new Map(); jm.set(geo, m); }
  const k = `${from.id ?? `${from.pos.x},${from.pos.y}`}>${p.id}`;
  if (!m.has(k)) m.set(k, jumpLeg(geo, from, p, links)?.distance ?? null);
  return m.get(k);
}
const FIT_ORDER = { ok: 0, viaggi: 1, nd: 2, cassa: 3 };
/** Compatibilita' con la nave dai dati del modello (casse e quantita'). */
export function shipFit(v, ship) {
  const c = cargoOf(v);
  if (!c.scu && !c.box) return { fit: 'nd', trips: null, cargo: c, note: missionKind(v) === 'transport' || missionKind(v) === 'delivery' ? 'quantità e casse non nei dati' : 'nessun carico' };
  if (c.box && ship?.maxBox && c.box > ship.maxBox) return { fit: 'cassa', trips: null, cargo: c, note: `casse da ${c.box} SCU oltre la cassa massima della nave (${ship.maxBox} SCU)` };
  if (c.scu && ship?.scu) { const trips = Math.ceil(c.scu / ship.scu); return { fit: trips <= 1 ? 'ok' : 'viaggi', trips, cargo: c, note: trips <= 1 ? `${c.scu} SCU su ${ship.scu}` : `${c.scu} SCU: ${trips} viaggi con ${ship.scu} SCU` }; }
  return { fit: 'nd', trips: null, cargo: c, note: c.box && !ship?.maxBox ? 'cassa massima della nave non nota' : 'quantità non nei dati' };
}

/**
 * Elenco del Mission Control.
 * @param q {tab, text, cats:Set|null, legal:'tutte'|'verificate'|'non_verificate', relation:'da'|'verso'|'tutte',
 *           region, scope, showAll, from:{id}|null, to:{id}|null, minReward, fitOnly, sort:'ricompensa'|'distanza'|'nave'|'titolo', collapse}
 * @param ctx {geo, links, profile, L, ship, records:Map(catalogId -> record[]), userViews}
 */
export function controlList(views, q, ctx) {
  const { geo } = ctx;
  const text = String(q.text ?? '').trim().toLowerCase();
  const rows = []; const counts = { cats: {}, tabs: { offerte: 0, visibili: 0, accettate: 0, storico: 0, eventi: 0 } }; const excluded = {};
  const ex = (k) => { excluded[k] = (excluded[k] ?? 0) + 1; };
  const recs = ctx.records ?? new Map();
  const add = (v, rec) => {
    const gc = cached(v, 'gc', () => geoClass(v, geo));
    const cat = cached(v, 'cat', () => mcCategory(v, geo, gc));
    const av = availability(v, { region: q.region, scope: q.scope, geo, profile: ctx.profile, L: ctx.L, record: rec });
    const rel = av.rel ?? (q.region ? regionRelation(v, q.region, geo, q.scope) : null);
    const tab = rec ? tabOfRecord(rec) : cat === 'event' ? 'eventi' : 'offerte';
    // filtro regione: "da qui" = offerta o ritiro/obiettivo nella regione; "verso qui" = consegna/obiettivo nella regione
    if (!rec && q.region && !q.showAll) {
      const da = !!(rel?.offer || rel?.pickup || (rel?.objective && !v.ops?.length));
      const verso = !!(rel?.dropoff || rel?.objective);
      if (q.relation === 'da' && !da) { ex('fuori regione'); return; }
      if (q.relation === 'verso' && !verso) { ex('non diretta nella regione'); return; }
      if (q.relation === 'tutte' && !da && !verso) { ex('fuori regione'); return; }
    }
    if (q.legal === 'verificate' && v.illegal) { ex('illegale'); return; }
    if (q.legal === 'non_verificate' && !v.illegal) { ex('legale'); return; }
    if (q.from && !['certo', 'possibile'].includes(roleIn(v, 'pickup', q.from, geo))) { ex('ritiro'); return; }
    if (q.to && !['certo', 'possibile'].includes(roleIn(v, 'dropoff', q.to, geo)) && !['certo', 'possibile'].includes(matchObjective(v, q.to, geo))) { ex('destinazione'); return; }
    if (q.minReward > 0) { const r = rec?.reward ?? v.rewardInfo?.max ?? v.reward; if (!(r >= q.minReward)) { ex('ricompensa'); return; } }
    if (text && !`${v.title} ${v.titleRaw ?? ''} ${v.debug ?? ''} ${v.company ?? ''} ${v.faction ?? ''} ${v.type ?? ''}`.toLowerCase().includes(text)) { ex('testo'); return; }
    const fit = shipFit(v, ctx.ship);
    if (q.fitOnly && fit.fit === 'cassa') { ex('incompatibile con la nave'); return; }
    if (!q.showAll && !rec && av.state === 'non_accessibile' && q.hideBlocked) { ex('non accessibile'); return; }
    // conteggi prima dei filtri di scheda e categoria
    counts.tabs[tab]++;
    if (tab === (q.tab ?? 'offerte')) { counts.cats[cat] = (counts.cats[cat] ?? 0) + 1; if (v.illegal) counts.cats.illegal = (counts.cats.illegal ?? 0) + 1; }
    if (tab !== (q.tab ?? 'offerte')) return;
    if (q.cats?.size && !q.cats.has(cat) && !(q.cats.has('illegal') && v.illegal)) { ex('categoria'); return; }
    rows.push({ v, rec, gc, cat, av, rel, fit, dist: q.sort === 'distanza' && q.region ? distanceFrom(v, q.region.place, geo, ctx.links) : undefined });
  };
  for (const v of views) {
    const list = recs.get(v.id) ?? [];
    if (list.length) for (const r of list) add(v, r);
    if (!list.some((r) => r.status === 'visibile' || r.status === 'accettata')) add(v, null);
  }
  const RANK = { accessibile: 0, regione: 1, catalogata: 2, non_accessibile: 3, visibile: 0, accettata: 0, completata: 1, fallita: 1 };
  const rew = (r) => r.rec?.reward ?? r.v.rewardInfo?.max ?? r.v.reward ?? -1;
  const sorts = {
    ricompensa: (a, b) => rew(b) - rew(a),
    distanza: (a, b) => (a.dist?.d ?? Infinity) - (b.dist?.d ?? Infinity),
    nave: (a, b) => FIT_ORDER[a.fit.fit] - FIT_ORDER[b.fit.fit],
    titolo: (a, b) => a.v.title.localeCompare(b.v.title),
  };
  const s = sorts[q.sort] ?? sorts.ricompensa;
  rows.sort((a, b) => RANK[a.av.state] - RANK[b.av.state] || s(a, b) || rew(b) - rew(a) || a.v.id.localeCompare(b.v.id));
  let out = rows;
  if (q.collapse) {
    const by = new Map();
    for (const r of rows) { const k = !r.rec && r.v.group ? `g:${r.v.group}` : `${r.v.id}|${r.rec?.id ?? ''}`; const o = by.get(k); if (o) o.found++; else by.set(k, Object.assign(r, { found: 1 })); }
    out = [...by.values()];
  }
  return { rows: out, total: rows.length, counts, excluded };
}
const memo = new WeakMap();
function cached(v, k, f) { let m = memo.get(v); if (!m) { m = {}; memo.set(v, m); } if (!(k in m)) m[k] = f(); return m[k]; }

// ---------------------------------------------------------------- RAGGRUPPA MISSIONI
export const GROUPS = {
  partenza: { label: 'STESSA PARTENZA', note: 'prima operazione (ritiro o obiettivo) nello stesso luogo' },
  ritiro: { label: 'STESSO PUNTO DI RITIRO', note: 'almeno un ritiro nello stesso luogo' },
  destinazione: { label: 'STESSA DESTINAZIONE', note: 'consegna o obiettivo nello stesso luogo' },
  vicine: { label: 'DESTINAZIONI VICINE', note: 'luoghi diversi attorno allo stesso pianeta (lune e stazioni comprese)' },
  sistema: { label: 'STESSO SISTEMA STELLARE', note: 'tutte le operazioni in un solo sistema' },
  direzione: { label: 'STESSA DIREZIONE INTERSTELLARE', note: 'stessa coppia di sistemi di ritiro e consegna' },
};
/**
 * Raggruppamento della selezione. Appartenenza CERTA (luoghi fissi) o POSSIBILE (pool che si sovrappongono).
 * @returns {{groups:[{kind,label,key,keyLabel,members:[{id,title,sure}]}], isolated:[{id,title,why}], pairs:[{a,b,types}], unknown:[{id,title}]}}
 */
/** Luoghi di una missione per il raggruppamento: insiemi CERTI (luoghi fissi) e POSSIBILI (pool). */
export function placeInfo(v, geo) {
  const picks = (v.ops ?? []).filter((o) => o.role === 'pickup'), drops = (v.ops ?? []).filter((o) => o.role === 'dropoff'), obj = v.objectives ?? [];
  const first = picks.length ? picks.filter((o) => o.slot === Math.min(...picks.map((x) => x.slot))) : obj.slice(0, 1);
  const set = (list, f = (id) => id) => ({ sure: new Set(list.filter(isFixed).flatMap(cands).filter((id) => geo.get(id)).map(f)), any: new Set(list.flatMap(cands).filter((id) => geo.get(id)).map(f)) });
  const ends = [...drops, ...(picks.length ? [] : obj)];
  const sysOf = (list) => set(list, (id) => geo.get(id).system);
  const ps = sysOf(picks), ds = sysOf(drops);
  const allOps = [...picks, ...drops, ...obj];
  const dir = (x) => (x.size === 1 ? [...x][0] : null);
  return {
    v, start: set(first), pick: set(picks), dest: set(ends), near: set(ends, (id) => planetAreaOf(geo, id)), sys: sysOf(allOps),
    direction: { sure: dir(ps.sure) && dir(ds.sure) && dir(ps.sure) !== dir(ds.sure) && allOps.every(isFixed) ? new Set([`${dir(ps.sure)}>${dir(ds.sure)}`]) : new Set(), any: new Set([...ps.any].flatMap((a) => [...ds.any].filter((b) => b !== a).map((b) => `${a}>${b}`))) },
    known: allOps.some((o) => cands(o).some((id) => geo.get(id))),
  };
}
const REL_KINDS = ['partenza', 'ritiro', 'destinazione', 'vicine', 'direzione'];
const REL_FIELD = { partenza: 'start', ritiro: 'pick', destinazione: 'dest', vicine: 'near', direzione: 'direction' };
/** Contratti raggruppabili con uno dato: cosa condividono, certo o possibile. */
export function relatedTo(v, pool, geo) {
  const a = placeInfo(v, geo); if (!a.known) return [];
  const out = [];
  for (const x of pool) {
    const b = placeInfo(x, geo); if (!b.known) continue;
    const why = [];
    for (const k of REL_KINDS) {
      const f = REL_FIELD[k]; const shared = [...a[f].any].filter((id) => b[f].any.has(id)); if (!shared.length) continue;
      if (k === 'vicine' && why.some((w) => w.kind === 'destinazione')) continue;
      why.push({ kind: k, label: GROUPS[k].label, sure: shared.some((id) => a[f].sure.has(id) && b[f].sure.has(id)) });
    }
    if (why.length) out.push({ v: x, why, score: why.filter((w) => w.sure).length * 2 + why.length });
  }
  return out.sort((p, q) => q.score - p.score || (q.v.reward ?? -1) - (p.v.reward ?? -1) || p.v.id.localeCompare(q.v.id));
}

export function groupSelection(views, geo, { links = [] } = {}) {
  const sysName = (s) => ({ stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' }[s] ?? s);
  const placeName = (id) => geo.get(id)?.name ?? id;
  const info = views.map((v) => placeInfo(v, geo));
  const groups = [];
  const build = (kind, f, label, { onlySingle = false } = {}) => {
    const m = new Map();
    for (const x of info) {
      const s = f(x); if (!s) continue;
      if (onlySingle && s.any.size !== 1) continue;
      for (const k of s.any) { const g = m.get(k) ?? new Map(); g.set(x.v.id, { id: x.v.id, title: x.v.title, sure: s.sure.has(k) && (!onlySingle || s.sure.size === 1) }); m.set(k, g); }
    }
    // stessi membri su piu' luoghi (pool che si sovrappongono): un solo gruppo con i luoghi in comune
    const bySig = new Map();
    for (const [k, g] of m) {
      if (g.size < 2) continue;
      const members = [...g.values()].sort((a, b) => b.sure - a.sure || a.title.localeCompare(b.title));
      const sig = members.map((x) => `${x.id}${x.sure ? '!' : ''}`).join('|');
      const e = bySig.get(sig); if (e) e.keys.push(k); else bySig.set(sig, { keys: [k], members });
    }
    for (const { keys, members } of bySig.values()) {
      const names = keys.map(label);
      groups.push({ kind, label: GROUPS[kind].label, key: keys[0], keys, keyLabel: names.length > 3 ? `${names.slice(0, 3).join(', ')} e altri ${names.length - 3} luoghi in comune` : names.join(', '), members });
    }
  };
  build('partenza', (x) => x.start, placeName);
  build('ritiro', (x) => x.pick, placeName);
  build('destinazione', (x) => x.dest, placeName);
  build('vicine', (x) => x.near, (k) => `attorno a ${placeName(k)}`);
  build('sistema', (x) => x.sys, sysName, { onlySingle: true });
  build('direzione', (x) => x.direction, (k) => k.split('>').map(sysName).join(' → '));
  // "destinazioni vicine" solo dove le destinazioni non coincidono gia'
  const same = new Set(groups.filter((g) => g.kind === 'destinazione').map((g) => g.members.map((m) => m.id).sort().join('|')));
  const filtered = groups.filter((g) => g.kind !== 'vicine' || !same.has(g.members.map((m) => m.id).sort().join('|')));
  filtered.sort((a, b) => Object.keys(GROUPS).indexOf(a.kind) - Object.keys(GROUPS).indexOf(b.kind) || b.members.filter((m) => m.sure).length - a.members.filter((m) => m.sure).length || b.members.length - a.members.length);
  const grouped = new Set(filtered.filter((g) => g.kind !== 'sistema').flatMap((g) => g.members.map((m) => m.id)));
  const unknown = info.filter((x) => !x.known).map((x) => ({ id: x.v.id, title: x.v.title }));
  const isolated = info.filter((x) => x.known && !grouped.has(x.v.id)).map((x) => ({ id: x.v.id, title: x.v.title, why: 'nessun luogo in comune o vicino con le altre: richiede una deviazione o un viaggio separato' }));
  const pairs = [];
  for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) {
    const a = views[i], b = views[j];
    if (!a.ops?.length || !b.ops?.length) continue;
    const types = stackTypes(a, b, geo); if (types.length) pairs.push({ a: a.id, b: b.id, types });
  }
  return { groups: filtered, isolated, unknown, pairs };
}

// ---------------------------------------------------------------- OTTIMIZZAZIONE
export const MODES = {
  guadagno: { label: 'MASSIMO GUADAGNO', note: 'massima ricompensa nota con i vincoli inseriti' },
  tempo: { label: 'MINIMO TEMPO', note: 'più missioni possibili con l\'itinerario più rapido (tempo se calcolabile, altrimenti distanza)' },
  efficienza: { label: 'MIGLIORE EFFICIENZA', note: 'ricompensa per ora (o per Gm se il tempo non è calcolabile), meno scali' },
};
const isCargo = (v) => (v.ops ?? []).some((o) => o.role === 'pickup') && (v.ops ?? []).some((o) => o.role === 'dropoff');

/**
 * Sceglie quali missioni cargo combinare e in che ordine; le altre (bounty, mercenari...) restano attivita'
 * separate, mai mescolate nei conti del cargo.
 * @param ctx contesto di evaluateStack (geo, capacity, ship, ranks, links, drive, handling, start)
 */
export function planSelection(views, ctx, mode = 'guadagno', { maxCargo = 8 } = {}) {
  const notes = []; const excluded = [];
  const cargo = views.filter(isCargo), others = views.filter((v) => !isCargo(v));
  const usable = [];
  for (const v of cargo) {
    const r = evaluateStack([v], ctx);
    if (r.cls === 'incompatibile') excluded.push({ v, why: r.reasons.join('; ') || 'vincolo non rispettato' });
    else if (r.cls === 'verificare') excluded.push({ v, why: [...r.missing].join('; ') || 'dati mancanti' });
    else usable.push(v);
  }
  if (usable.length > maxCargo) { notes.push(`${usable.length} missioni cargo: valutate le prime ${maxCargo} (combinazioni esaurienti fino a ${maxCargo})`); usable.length = maxCargo; }
  let best = null;
  const score = (r, set) => {
    const m = r.metrics; const reward = (m.rewardAccepted ?? 0) + (m.rewardUnconfirmed ?? 0);
    const time = m.hours ?? null; const dist = m.unknownLegs ? null : m.distance;
    if (mode === 'guadagno') return [reward, -(m.rewardUnknown ?? 0), set.length, -(dist ?? Infinity)];
    if (mode === 'tempo') return [set.length, -(time ?? (dist !== null ? dist / 1e12 : Infinity)), reward];
    const per = time ? reward / time : dist ? reward / (dist / 1e9) : 0;
    return [per / (1 + 0.05 * (m.stops ?? 0)), reward, -set.length];
  };
  const better = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] > b[i]) return true; if (a[i] < b[i]) return false; } return false; };
  const n = usable.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const set = usable.filter((_, i) => mask & (1 << i));
    const r = evaluateStack(set, ctx);
    if (r.cls !== 'potenziale' && r.cls !== 'eseguibile') continue;
    const sc = score(r, set);
    if (!best || better(sc, best.score)) best = { set, result: r, score: sc };
  }
  const dropped = best ? usable.filter((v) => !best.set.includes(v)) : usable;
  for (const v of dropped) excluded.push({ v, why: best ? `non entra nella combinazione migliore per ${MODES[mode].label}` : 'nessuna combinazione eseguibile con i vincoli noti' });
  if (mode === 'tempo' && best && best.result.metrics.hours === null) notes.push('tempo non calcolabile (velocità QT o tempi di carico non noti, o tratta interstellare): ordinato per distanza');
  if (mode === 'efficienza' && best && best.result.metrics.hours === null) notes.push('efficienza calcolata per Gm percorso: tempo non calcolabile');
  return { mode, best, excluded, others: others.map((v) => ({ v, note: otherNote(v, ctx) })), notes, summary: best ? summaryOf(best, others, ctx) : null };
}
function otherNote(v, ctx) {
  const obj = (v.objectives ?? []).filter((o) => cands(o).length);
  if (!obj.length) return 'attività separata: luogo dell\'obiettivo non nei dati (pianificazione parziale)';
  const fixed = obj.every(isFixed);
  return `attività separata, non sommata al cargo: obiettivo ${fixed ? `a ${ctx.geo.get(obj[0].ids[0])?.name ?? 'luogo noto'}` : `in uno fra ${obj.flatMap(cands).length} luoghi (pianificazione parziale)`}`;
}
/** Riepilogo con l'origine di ogni valore: noto (dai dati), calcolato (da NAVCOM), mancante. */
export function summaryOf(best, others, ctx) {
  const r = best.result; const m = r.metrics;
  const scu = r.contracts.reduce((s, c) => s + c.movements.reduce((a, x) => a + (x.scu ?? 0), 0), 0);
  const stops = r.route?.seq?.length ? stopsOf(r.route.seq) : [];
  const risks = [...best.set, ...others].flatMap((v) => [v.risk?.combat ? `${v.title}: combattimento` : null, v.illegal ? `${v.title}: illegale` : null, v.timeLimit ? `${v.title}: limite ${Math.round(v.timeLimit)} min` : null]).filter(Boolean);
  const val = (value, how, note = null) => ({ value, how, note });
  return {
    missions: val(best.set.length + others.length, 'noto'),
    reward: val((m.rewardAccepted ?? 0) + (m.rewardUnconfirmed ?? 0), m.rewardUnknown ? 'parziale' : 'noto', m.rewardUnknown ? `${m.rewardUnknown} ricompense non note (dinamiche): non sommate` : 'somma delle ricompense note; dinamiche escluse'),
    cargo: val(scu, 'calcolato', 'quantità massime dei modelli o registrate da te'),
    trips: val(ctx.capacity ? Math.max(1, Math.ceil(m.peak / ctx.capacity)) : null, ctx.capacity ? 'calcolato' : 'mancante', ctx.capacity ? `picco a bordo ${m.peak} SCU su ${ctx.capacity}` : 'capacità non indicata'),
    pickups: val(m.pickups, 'calcolato'), dropoffs: val(m.dropoffs, 'calcolato'),
    itinerary: val(stops.map((s) => ({ id: s.place.id, name: s.place.name, system: s.place.system, tasks: s.tasks })), 'calcolato'),
    distance: val(m.unknownLegs ? null : m.distance, m.unknownLegs ? 'mancante' : 'calcolato', m.unknownLegs ? `${m.unknownLegs} tratte di lunghezza non nota` : 'distanze reali dal database geografico; fra sistemi fino e dai gateway'),
    time: val(m.hours, m.hours === null ? 'mancante' : 'calcolato', m.hours === null ? 'serve la velocità QT della nave e i tempi di carico; il tunnel del salto non ha durata nei dati' : 'stima a velocità costante'),
    risks: val(risks, risks.length ? 'noto' : 'noto', risks.length ? null : 'nessun combattimento o illegalità nei dati'),
  };
}

// ---------------------------------------------------------------- rotta verso un luogo (anche fra sistemi)
/**
 * Passi verso un luogo dalla posizione: stesso sistema = tratta diretta per il PIANIFICATORE; altro sistema =
 * gateway di uscita, salto, poi il luogo (nessuna distanza euclidea fra sistemi).
 */
export function routeSteps(from, to, geo, links) {
  if (!to?.pos) return { ok: false, steps: [], note: 'posizione del luogo non nota' };
  if (!from) return { ok: true, steps: [{ kind: 'qt', to, note: 'partenza: scegli nel PIANIFICATORE' }], note: 'posizione attuale non impostata' };
  if (from.system === to.system) return { ok: true, steps: [{ kind: 'qt', from, to, distance: geo.distance(from, to) }] };
  const path = systemsPath(from.system, to.system, links);
  if (!path) return { ok: false, steps: [], note: `nessun collegamento noto fra ${from.system} e ${to.system}` };
  const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const gw = (sys, toward) => geo.inSystem(sys).find((p) => p.kind === 'gateway' && p.name.toLowerCase() === `${label(toward)} gateway`.toLowerCase()) ?? null;
  const steps = []; let cur = from;
  for (let i = 0; i < path.length - 1; i++) {
    const exit = gw(path[i], path[i + 1]), entry = gw(path[i + 1], path[i]);
    if (!exit || !entry) return { ok: false, steps, note: `gateway fra ${path[i]} e ${path[i + 1]} non nei dati` };
    steps.push({ kind: 'qt', from: cur, to: exit, distance: geo.distance(cur, exit) });
    steps.push({ kind: 'salto', from: exit, to: entry, note: 'tunnel del salto: lunghezza e durata non nei dati' });
    cur = entry;
  }
  steps.push({ kind: 'qt', from: cur, to, distance: geo.distance(cur, to) });
  return { ok: true, steps };
}
