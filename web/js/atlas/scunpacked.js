// Adattatore scunpacked-data (github.com/StarCitizenWiki/scunpacked-data): dati estratti dai file
// del gioco dalla Star Citizen Wiki. Verificato il 2026-11-08 sul commit "4.10.2-LIVE.12881860":
//  - starmap_positions.json: {entities[{uuid,name,type,system,parent_uuid,hidden,qt_valid,x,y,z}],
//    connections[{entry_uuid,exit_uuid,entry_system,exit_system,fuel_cost}]}. Metri, frame della
//    griglia del sistema. Le 739 entita' non nascoste coincidono al metro con CitizenHQ (stessi uuid).
//  - contracts/<uuid>.json: modelli di missione (MissionBrokerEntry) con LocationPools (insiemi di
//    luoghi possibili per ogni ritiro/consegna), AvailabilityLocations (dove il contratto puo'
//    comparire, uuid della starmap), HaulingOrders, FixedReward, MinStanding, Deadline.
//  - trade_locations.json: terminali commerciali (nome visualizzato, tag), senza uuid della starmap.
//  - ships.json: navi con Cargo (SCU) e CargoGrids (dimensioni in metri).
// Nessun file LICENSE nel repository; i dati sono © Cloud Imperium. Nessun contenuto copiato oltre
// ai campi elencati qui; testi descrittivi delle missioni esclusi.
//
// Un modello di missione NON e' un'offerta: i luoghi di un pool sono alternative che il gioco sceglie
// quando genera il contratto. Il pool resta un insieme; nessun luogo viene scelto al posto del gioco.
import { normName } from '../logistics/model.js';

export const SOURCE_ID = 'scunpacked';
export const SOURCE_NAME = 'scunpacked-data (Star Citizen Wiki, file di gioco)';
export const SOURCE_URL = 'https://github.com/StarCitizenWiki/scunpacked-data';

/** Categorie di missione considerate (priorita' HAULING & DELIVERY). */
export const CATEGORIES = {
  'Hauling': 'hauling', 'Hauling - Local': 'hauling', 'Hauling - Planetary': 'hauling',
  'Hauling - Stellar': 'hauling', 'Hauling - Interstellar': 'hauling',
  'Delivery': 'delivery', 'Courier': 'delivery',
};

const compact = (n) => n.replace(/ /g, '');

/**
 * Indice dei nomi dei luoghi: nome normalizzato -> uuid. Un nome presente in piu' sistemi o piu'
 * volte resta AMBIGUO (nessuna scelta arbitraria). Il confronto "compatto" (senza spazi) serve per
 * grafie come "ArcCorp Mining Area157"; vale solo se porta a un unico luogo.
 */
export function nameIndex(places) {
  const by = new Map(), byCompact = new Map();
  const add = (m, k, p) => { if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
  for (const p of places) {
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      const k = normName(n); if (!k) continue;
      add(by, k, p); add(byCompact, compact(k), p);
    }
  }
  const uniqIds = (list) => [...new Set(list.map((p) => p.id))];
  return {
    /** @returns {{id:string|null, how:string, candidates:string[]}} */
    resolve(name, system = null) {
      const k = normName(name);
      if (!k) return { id: null, how: 'vuoto', candidates: [] };
      for (const [m, key, how] of [[by, k, 'esatto'], [byCompact, compact(k), 'compatto']]) {
        let list = m.get(key) ?? [];
        if (system) { const s = list.filter((p) => p.system === system); if (s.length) list = s; }
        const ids = uniqIds(list);
        if (ids.length === 1) return { id: ids[0], how, candidates: ids };
        if (ids.length > 1) return { id: null, how: 'ambiguo', candidates: ids };
      }
      return { id: null, how: 'non trovato', candidates: [] };
    },
  };
}

export const sysOf = (debugName) => {
  const m = /(?:^|_)(Stanton|Pyro|Nyx)(?:_|\d|$)/i.exec(debugName ?? '');
  return m ? m[1].toLowerCase() : null;
};

/** Titolo leggibile: i segnaposto ~mission(X) con un solo valore noto vengono sostituiti. */
const PLACEHOLDER = /^<=.*=>$/;
/** Datore della missione; i segnaposto non inizializzati dei file ("<= UNINITIALIZED =>") diventano null. */
export const giverOf = (c) => [c.MissionGiver, c.Faction?.Name].map((x) => (x == null ? null : String(x).trim())).find((x) => x && !PLACEHOLDER.test(x)) ?? null;

export function cleanTitle(title, tokens = {}, fallback = 'Missione') {
  if (!title || /^<=.*=>$/.test(String(title).trim())) return fallback;
  return String(title).replace(/~mission\(([^)]+)\)/g, (_, k) => {
    const v = tokens[k];
    return Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && v[0].length < 40 ? v[0] : `[${k}]`;
  });
}

// Ruolo dal nome del pool (PickupLocationBP, DropoffLocation2BP, Pickup1, DropOff1, DeliveryLocationBP);
// numero dal token (Location = 1, Location1 = 2, Destination2 = 3; Pickup1 = 1).
export const role = (key) => (/^pick/i.test(key) ? 'pickup' : /^(drop|deliver)/i.test(key) ? 'dropoff' : null);
export const slotOf = (key, purpose) => {
  const t = /^(?:Location|Destination)(\d*)$/.exec(purpose ?? '');
  if (t) return (t[1] ? Number(t[1]) : 0) + 1;
  return Number(/(\d+)/.exec(purpose ?? key)?.[1] ?? 1);
};

/**
 * Converte i contratti di scunpacked in modelli di missione compatti.
 * @param contracts array di oggetti contracts/<uuid>.json
 * @param geoPlaces luoghi canonici [{id, name, system, aliases}]
 * @returns {{meta, places:string[], names:string[], missions:object[], queue:object[]}}
 *   pool = {role, slot, ids:number[] (indici in places), ambiguous:number[] (indici in names),
 *           unresolved:number[] (indici in names), anonymous:number, size:number}
 */
export function buildMissionCatalog(contracts, geoPlaces, { patch = null, fetchedAt = null, geo = null } = {}) {
  // con un Geo si usano le stesse regole dell'atlante (alias curati, suffisso unico); altrimenti nomi esatti
  const exact = nameIndex(geoPlaces);
  const idx = geo ? { resolve: (n, sys) => { const r = geo.resolve(n, sys); return r ? { id: r.place.id, how: r.how, candidates: [r.place.id] } : exact.resolve(n, sys); } } : exact;
  const known = new Set(geoPlaces.map((p) => p.id));
  const systemOf = new Map(geoPlaces.map((p) => [p.id, p.system]));
  const places = [], placeIdx = new Map(), names = [], nameIdx = new Map();
  const pi = (id) => { if (!placeIdx.has(id)) { placeIdx.set(id, places.length); places.push(id); } return placeIdx.get(id); };
  const ni = (n) => { if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
  const queue = new Map(); // nome -> {name, how, count, candidates}
  const missions = [];
  const cov = {}; let withReward = 0, poolsTotal = 0, poolsFixed = 0;

  for (const c of contracts) {
    const category = CATEGORIES[c?.MissionType?.Name];
    if (!category || c.NotForRelease || c.WorkInProgress) continue;
    const tokens = c.MissionTokens ?? {};
    const offer = [], offerUnknown = [];
    for (const a of c.AvailabilityLocations ?? []) for (const r of a.ResolvedLocations ?? []) {
      if (known.has(r.UUID)) offer.push(pi(r.UUID)); else offerUnknown.push(r.UUID);
    }
    const offerSystems = [...new Set(offer.map((i) => systemOf.get(places[i])))];
    const sys = offerSystems.length === 1 ? offerSystems[0] : sysOf(c.DebugName);
    const pools = [];
    for (const [purpose, v] of Object.entries(c.LocationPools ?? {})) {
      const r = role(purpose); if (!r) continue;
      const pool = { role: r, slot: slotOf(purpose, v.Purpose), token: v.Purpose ?? null, ids: [], ambiguous: [], unresolved: [], anonymous: 0, size: 0 };
      const seen = new Set();
      for (const loc of v.ResolvedLocations ?? []) {
        pool.size++;
        const n = (loc.Name ?? '').trim();
        if (!n) { pool.anonymous++; continue; }
        if (seen.has(n)) continue; seen.add(n);
        const res = idx.resolve(n, sys);
        if (res.id) { pool.ids.push(pi(res.id)); continue; }
        (res.how === 'ambiguo' ? pool.ambiguous : pool.unresolved).push(ni(n));
        const q = queue.get(n) ?? { name: n, how: res.how, count: 0, candidates: res.candidates };
        q.count++; queue.set(n, q);
      }
      pool.ids = [...new Set(pool.ids)];
      poolsTotal++; if (pool.size === 1 && pool.ids.length === 1) poolsFixed++;
      pools.push(pool);
    }
    pools.sort((a, b) => (a.role === b.role ? a.slot - b.slot : a.role === 'pickup' ? -1 : 1));
    const orders = (c.HaulingOrders ?? []).map((o) => ({
      cargo: o.Name ?? null,
      scuMin: o.MinScu > 0 ? o.MinScu : null,
      scuMax: o.MaxScu > 0 ? o.MaxScu : null,
      containerMax: o.MaxContainerSize > 0 ? o.MaxContainerSize : null,
    }));
    const reward = c.FixedReward?.Amount > 0 ? c.FixedReward.Amount : null;
    if (reward !== null) withReward++;
    const maxBoxTok = /(\d+)\s*SCU/i.exec((tokens.MissionMaxSCUSize ?? [])[0] ?? '');
    missions.push({
      id: `scu:${c.UUID}`, source: SOURCE_ID, category, type: c.MissionType.Name,
      title: cleanTitle(c.Title, tokens, `${c.MissionType.Name} · ${giverOf(c) ?? 'datore non indicato'} (titolo assente nei file)`), company: giverOf(c),
      rank: c.MinStanding?.Name ?? null, rankIndex: Number.isInteger(c.RankIndex) ? c.RankIndex : null,
      reward, system: sys, route: (tokens.CargoRouteToken ?? [])[0] ?? null,
      offer: [...new Set(offer)], offerUnknown: offerUnknown.length,
      pools, orders, maxBox: maxBoxTok ? Number(maxBoxTok[1]) : null,
      timeLimit: c.Deadline?.CompletionTime > 0 ? c.Deadline.CompletionTime : null,
      illegal: !!c.Illegal, debug: c.DebugName ?? null, patch,
    });
    cov[sys ?? 'n.d.'] = (cov[sys ?? 'n.d.'] ?? 0) + 1;
  }
  missions.sort((a, b) => a.id.localeCompare(b.id));
  return {
    meta: {
      source: SOURCE_NAME, url: SOURCE_URL, patch, fetchedAt, missions: missions.length, coverage: cov, withReward,
      pools: poolsTotal, fixedPools: poolsFixed,
      license: 'nessun file LICENSE nel repository; dati di gioco © Cloud Imperium',
      method: 'modelli di missione dai file di gioco: non sono offerte disponibili',
    },
    places, names, missions,
    queue: [...queue.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** Navi con stiva (ships.json). La compatibilita' fisica delle casse NON si deduce da qui. */
export function buildShips(ships, { patch = null } = {}) {
  const out = new Map();
  for (const s of ships ?? []) {
    if (!(s?.Cargo > 0) || /_Display$|_Template$|_AI_|_PU_AI/i.test(s.ClassName ?? '')) continue;
    const grids = (s.CargoGrids ?? []).map((g) => ({ scu: g.SCU ?? g.Capacity ?? null, dims: [g.X, g.Y, g.Z], maxItem: g.MaxSize ? [g.MaxSize.X, g.MaxSize.Y, g.MaxSize.Z] : null, external: !!g.IsExternalContainer }));
    const key = s.Name ?? s.ClassName;
    if (!out.has(key)) out.set(key, { id: s.ClassName, name: s.Name, manufacturer: typeof s.Manufacturer === 'string' ? s.Manufacturer : s.Manufacturer?.Name ?? null, scu: s.Cargo, grids, patch });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
