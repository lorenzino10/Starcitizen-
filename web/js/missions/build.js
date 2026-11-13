// MISSION DATABASE 2.0: costruzione del catalogo dei modelli di missione (Node, GitHub Actions) e
// funzioni pure di validazione e confronto (usate anche dai test).
//
// Fonti, verificate con richieste reali il 2026-11-12 (vedi docs/MISSIONS.md):
//  - scunpacked-data contracts/<uuid>.json: struttura del contratto (pool di ritiro/consegna con i
//    nomi dei luoghi, luoghi d'offerta, ordini di trasporto, ricompensa fissa o calcolata, grado,
//    scadenza, combattimento, rischio). E' l'UNICA fonte con i pool di ritiro e consegna.
//  - Star Citizen Wiki API /api/missions (stessi uuid, 5.153 record): versione LIVE di riferimento
//    (/api/game-versions/default), raggruppamento delle varianti (filter[grouped]=true), sistemi,
//    ricompense min/max, descrizione, crime stat, nemici. NON contiene i pool di ritiro/consegna.
// Un modello NON e' un'offerta: e' cio' che il gioco PUO' generare. I pool restano insiemi interi.
import { nameIndex, cleanTitle, giverOf, role as poolRole, slotOf, sysOf } from '../atlas/scunpacked.js';
import { normName } from '../logistics/model.js';

export const DB_VERSION = 2;
export const SYSTEMS = ['stanton', 'pyro', 'nyx'];

/** Categoria operativa dal tipo di missione dei file di gioco. */
export const CATEGORY = {
  'Hauling': 'hauling', 'Hauling - Local': 'hauling', 'Hauling - Planetary': 'hauling', 'Hauling - Stellar': 'hauling', 'Hauling - Interstellar': 'hauling',
  'Delivery': 'delivery', 'Courier': 'delivery', 'Priority': 'priority',
  'Ship Mining': 'mining', 'Ground Vehicle Mining': 'mining', 'Hand Mining': 'mining', 'Mining': 'mining', 'Refueling': 'service', 'Maintenance': 'service',
  'Salvage': 'salvage', 'Mercenary': 'combat', 'Bounty Hunter': 'combat', 'Battaglia': 'combat', 'PvP Missions': 'combat', 'ECN Alert': 'combat',
  'Investigation': 'investigation', 'Search': 'investigation', 'Research': 'investigation', 'Collection': 'collection',
  'Racing': 'racing', 'Wikelo - Other Items': 'wikelo', 'Wikelo - Vehicles': 'wikelo',
};
export const CATEGORY_LABEL = {
  hauling: 'Hauling (trasporto merci)', delivery: 'Delivery / corriere', priority: 'Priority', mining: 'Mining', service: 'Servizi (rifornimento, manutenzione)',
  salvage: 'Salvage', combat: 'Combattimento', investigation: 'Indagine / ricerca', collection: 'Raccolta', racing: 'Corse', wikelo: 'Wikelo (scambi)', other: 'Altro',
};
/** Missioni di trasporto per l'ATLANTE: tipi hauling/delivery (come prima) */
export const ATLAS_CATEGORIES = new Set(['hauling', 'delivery']);

const uniq = (a) => [...new Set(a.filter((x) => x !== null && x !== undefined && x !== ''))];
const PLACEHOLDER = /^<=.*=>$|~mission\(|\[[A-Za-z][^\]]*\]/; // parametri del gioco: [TargetName], [Contractor|DataHeistTitle_VE]
const systemKey = (s) => { const k = String(s ?? '').toLowerCase().replace(/ system$/, '').trim(); return SYSTEMS.includes(k) ? k : null; };

/** "4.10.2-LIVE.12881860" -> {version:'4.10.2', channel:'LIVE', build:'12881860'} */
export function parseGameVersion(code) {
  const m = /^(\d+\.\d+(?:\.\d+)?)(?:-([A-Za-z]+))?(?:\.(\d+))?/.exec(String(code ?? '').trim());
  return m ? { code: String(code).trim(), version: m[1], channel: m[2]?.toUpperCase() ?? null, build: m[3] ?? null } : null;
}
/** Confronto di versioni numeriche (build come ultimo criterio). */
export function compareVersions(a, b) {
  const pa = parseGameVersion(a), pb = parseGameVersion(b);
  if (!pa || !pb) return 0;
  const na = pa.version.split('.').map(Number), nb = pb.version.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (na[i] ?? 0) - (nb[i] ?? 0); if (d) return Math.sign(d); }
  return Math.sign((+pa.build || 0) - (+pb.build || 0));
}

/** Livello di rischio dichiarato nei file (Difficulty.RiskOfLoss "..._4") -> 1..5, altrimenti null. */
export function riskLevel(d) {
  const m = /_(\d)$/.exec(d?.RiskOfLoss ?? '');
  return m ? Number(m[1]) : null;
}

/** Percorso fra sistemi sulla rete dei jump point: ['stanton','pyro'] o null se non collegati. */
export function systemsPath(from, to, links) {
  if (!from || !to) return null;
  if (from === to) return [from];
  const adj = new Map();
  for (const l of links ?? []) {
    const a = systemKey(l.from), b = systemKey(l.to); if (!a || !b || a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  }
  const prev = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const x = q.shift(); if (x === to) break;
    for (const y of adj.get(x) ?? []) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
  }
  if (!prev.has(to)) return null;
  const path = []; for (let x = to; x; x = prev.get(x)) path.unshift(x);
  return path;
}

/**
 * Raggruppamento delle varianti dalla Wiki API (lista con filter[grouped]=true): uuid -> gruppo.
 * Senza la Wiki: chiave euristica dichiarata (tipo, datore, titolo, sistemi).
 */
/** Testo della Wiki ripulito: tag di formattazione tolti; un solo segnaposto ("[Contractor|...]") non e' una descrizione. */
export function cleanDescription(text, max = 280) {
  const t = String(text ?? '').replace(/<\/?EM\d*>/g, '').replace(/\s+/g, ' ').trim();
  if (!t || /^\[[^\]]*\]$/.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Titolo come lo riportano le fonti, mai tradotto ne' inventato.
 *  verificato: testo letterale (Wiki o file), senza parametri
 *  dinamico:   contiene parametri riempiti dal gioco alla generazione ([TargetName], [Location]...)
 *  risolto:    parametri sostituiti con l'unico valore presente nei file (titolo mobiGlas non verificato)
 *  assente:    nessun titolo nelle fonti: si mostra il nome interno (titolo mobiGlas non verificato)
 * @returns {{title, status, raw, from}}
 */
export function missionTitle(c, w, tokens = {}, fallback = 'Missione (titolo assente nei file)') {
  const lit = [[c?.DisplayTitle, 'file'], [w?.title, 'Wiki'], [c?.Title, 'file']].find(([x]) => x && !/^<=.*=>$/.test(String(x).trim()) && !PLACEHOLDER.test(x));
  if (lit) return { title: String(lit[0]), status: 'verificato', raw: null, from: lit[1] };
  // titolo con parametri: si preferisce la forma della Wiki ("[TargetName]"), altrimenti quella dei file
  const raw = w?.title && !/^<=.*=>$/.test(w.title) ? { t: w.title, from: 'Wiki' } : c?.Title && !/^<=.*=>$/.test(String(c.Title).trim()) ? { t: String(c.Title).replace(/~mission\(([^)]+)\)/g, '[$1]'), from: 'file' } : null;
  if (!raw) return { title: fallback, status: 'assente', raw: null, from: null };
  if (/^\[[^\]]+\]$/.test(raw.t.trim())) return { title: raw.t, status: 'dinamico', raw: raw.t, from: raw.from };
  const solved = cleanTitle(c?.Title ?? raw.t, tokens, raw.t);
  if (c?.Title && !/\[[^\]]+\]/.test(solved) && solved !== raw.t) return { title: solved, status: 'risolto', raw: raw.t, from: 'file' };
  return { title: raw.t, status: 'dinamico', raw: raw.t, from: raw.from };
}

/** Prerequisiti dai file: gruppi "N fra queste missioni o tag" con i titoli come nei file. */
export function prereqGroups(list) {
  return (list ?? []).map((p) => ({
    need: Number.isFinite(p.RequiredCount) ? p.RequiredCount : null,
    missions: (p.RequiredMissions ?? []).map((r) => ({ uuid: r.UUID ?? null, title: r.Title && !/^<=.*=>$/.test(r.Title) ? r.Title : null, debug: r.DebugName ?? null })),
    tags: (p.RequiredTags ?? []).map((t) => t.Name).filter(Boolean),
    excluded: (p.ExcludedTags ?? []).map((t) => t.Name).filter(Boolean),
  })).filter((g) => g.missions.length || g.tags.length);
}

export function variantGroups(grouped) {
  const map = new Map();
  for (const g of grouped ?? []) {
    const ids = uniq([g.uuid, ...(g.variants ?? []).map((v) => v.uuid)]);
    for (const id of ids) map.set(id, { group: g.uuid, count: ids.length });
  }
  return map;
}

/**
 * Converte i contratti in record del Mission Database 2.0 (formato compatto, indici in places/names).
 * Il formato contiene i campi gia' usati dall'ATLANTE (pools, offer, orders, reward, system...).
 */
export function buildMissionDb(contracts, geoPlaces, { geo = null, links = [], patch = null, fetchedAt = null, wiki = null } = {}) {
  const exact = nameIndex(geoPlaces);
  const resolve = (n, sys) => {
    if (geo) { const r = geo.resolve(n, sys); if (r) return { id: r.place.id, how: r.how, candidates: [r.place.id] }; }
    return exact.resolve(n, sys);
  };
  const known = new Set(geoPlaces.map((p) => p.id));
  const systemOf = new Map(geoPlaces.map((p) => [p.id, p.system]));
  const places = [], placeIdx = new Map(), names = [], nameIdx = new Map();
  const pi = (id) => { if (!placeIdx.has(id)) { placeIdx.set(id, places.length); places.push(id); } return placeIdx.get(id); };
  const ni = (n) => { if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
  const wikiBy = new Map((wiki?.list ?? []).map((m) => [m.uuid, m]));
  const groups = variantGroups(wiki?.grouped);
  const queue = new Map();
  const excluded = { notForRelease: 0, workInProgress: 0, invalid: 0 };
  const missions = [];

  for (const c of contracts) {
    if (!c?.UUID) { excluded.invalid++; continue; }
    if (c.NotForRelease) { excluded.notForRelease++; continue; }
    if (c.WorkInProgress) { excluded.workInProgress++; continue; }
    const w = wikiBy.get(c.UUID) ?? null;
    const type = c.MissionType?.Name ?? null;
    const category = CATEGORY[type] ?? 'other';
    const tokens = c.MissionTokens ?? {};
    const orders = (c.HaulingOrders ?? []).map((o) => ({
      cargo: o.Name ?? null, kind: o.Kind ?? null,
      scuMin: o.MinScu > 0 ? o.MinScu : null, scuMax: o.MaxScu > 0 ? o.MaxScu : null,
      amountMin: o.MinAmount > 0 ? o.MinAmount : null, amountMax: o.MaxAmount > 0 ? o.MaxAmount : null,
      containerMax: o.MaxContainerSize > 0 ? o.MaxContainerSize : null,
    }));
    // luoghi d'OFFERTA (dove il contratto puo' comparire): mai copiati nel ritiro
    const offer = [], offerUnknown = [];
    for (const a of c.AvailabilityLocations ?? []) for (const r of a.ResolvedLocations ?? []) {
      if (known.has(r.UUID)) offer.push(pi(r.UUID)); else offerUnknown.push(r.UUID);
    }
    const offerSystems = uniq([...new Set(offer)].map((i) => systemOf.get(places[i])));
    const routeTok = (tokens.CargoRouteToken ?? [])[0] ?? null;
    const interstellarDeclared = type === 'Hauling - Interstellar' || routeTok === 'Interstellar';
    const wikiSystems = uniq((w?.star_systems ?? []).map(systemKey));
    const reqSystems = uniq((c.RequiredLocations ?? []).map((r) => systemKey(r.Name)));
    // contesto per i nomi: un solo sistema certo (e missione non interstellare), altrimenti nessuna preferenza
    const ctxSystems = uniq([...offerSystems, ...wikiSystems, ...reqSystems]);
    const ctxSys = !interstellarDeclared && ctxSystems.length === 1 ? ctxSystems[0] : (!interstellarDeclared ? sysOf(c.DebugName) : null);

    const pools = [], objectives = [];
    const addPool = (r, slot, token, locNames, src, into = pools) => {
      const pool = { role: r, slot, token, src, ids: [], alt: [], ambiguous: [], unresolved: [], anonymous: 0, size: 0 };
      const seen = new Set();
      for (const raw of locNames) {
        pool.size++;
        const n = String(raw ?? '').trim();
        if (!n || n === 'undefined') { pool.anonymous++; continue; }
        if (seen.has(n)) continue; seen.add(n);
        const res = resolve(n, ctxSys);
        if (res.id) { pool.ids.push(pi(res.id)); continue; }
        if (res.how === 'ambiguo') { pool.ambiguous.push(ni(n)); for (const id of res.candidates) pool.alt.push(pi(id)); } else pool.unresolved.push(ni(n));
        if (into !== pools) continue; // i luoghi degli obiettivi non entrano nella coda di normalizzazione dei trasporti
        const q = queue.get(n) ?? { name: n, how: res.how, count: 0, candidates: res.candidates };
        q.count++; queue.set(n, q);
      }
      pool.ids = [...new Set(pool.ids)]; pool.alt = [...new Set(pool.alt)];
      into.push(pool);
    };
    for (const [purpose, v] of Object.entries(c.LocationPools ?? {})) {
      const r = poolRole(purpose);
      // pool senza ruolo cargo: luoghi operativi dell'obiettivo (bounty, mercenari, indagini...), mai ritiri
      if (!r) { const names = (v.ResolvedLocations ?? []).map((l) => l.Name).filter((n) => n && n !== 'undefined'); if (names.length) addPool('objective', objectives.length + 1, purpose, names, 'pool', objectives); continue; }
      addPool(r, slotOf(purpose, v.Purpose), v.Purpose ?? null, (v.ResolvedLocations ?? []).map((l) => l.Name), 'pool');
    }
    // pool vuoti nei file: i nomi del testo della missione (token "Location|Address", "Destination|Address")
    for (const r of ['pickup', 'dropoff']) {
      const have = pools.filter((p) => p.role === r);
      if (have.some((p) => p.size > 0)) continue;
      const re = r === 'pickup' ? /^(Location|Pickup)(\d*)\|Address$/ : /^(Destination|DropOff)(\d*)\|Address$/;
      const tok = Object.entries(tokens).filter(([k]) => re.test(k));
      if (!tok.length) continue;
      for (let i = pools.length - 1; i >= 0; i--) if (pools[i].role === r && pools[i].size === 0) pools.splice(i, 1);
      for (const [k, vals] of tok) {
        const m = re.exec(k); const slot = m[1] === 'Location' || m[1] === 'Destination' ? (m[2] ? Number(m[2]) + 1 : 1) : Number(m[2] || 1);
        addPool(r, slot, k.split('|')[0], (vals ?? []).filter((x) => typeof x === 'string' && x.length < 80), 'testo');
      }
    }
    pools.sort((a, b) => (a.role === b.role ? a.slot - b.slot : a.role === 'pickup' ? -1 : 1));

    const sysOfPool = (p) => uniq([...p.ids, ...p.alt].map((i) => systemOf.get(places[i])));
    const pickSys = uniq(pools.filter((p) => p.role === 'pickup').flatMap(sysOfPool));
    const dropSys = uniq(pools.filter((p) => p.role === 'dropoff').flatMap(sysOfPool));
    const systems = uniq([...ctxSystems, ...pickSys, ...dropSys, sysOf(c.DebugName)]).filter((s) => SYSTEMS.includes(s));
    const interstellar = interstellarDeclared || systems.length > 1 && (pickSys.length && dropSys.length && (pickSys.some((s) => !dropSys.includes(s)) || dropSys.some((s) => !pickSys.includes(s))));
    const transit = pickSys.length === 1 && dropSys.length === 1 ? systemsPath(pickSys[0], dropSys[0], links) : null;

    const fixed = c.FixedReward?.Amount > 0 ? c.FixedReward.Amount : null;
    const fixedMax = c.FixedReward?.Max > 0 ? c.FixedReward.Max : null;
    const rewardInfo = fixed !== null ? { kind: fixedMax && fixedMax !== fixed ? 'intervallo' : 'fissa', min: fixed, max: fixedMax ?? fixed, currency: c.FixedReward?.Currency ?? 'UEC' }
      : c.CalculatedReward ? { kind: 'dinamica', min: null, max: null, currency: 'UEC' } : { kind: 'nd', min: null, max: null, currency: null };
    const t = missionTitle(c, w, tokens, `${type ?? 'Missione'} · ${giverOf(c) ?? 'datore non indicato'} (titolo assente nei file)`);
    const title = t.title;
    const grp = groups.get(c.UUID);
    const maxBoxTok = /(\d+)\s*SCU/i.exec((tokens.MissionMaxSCUSize ?? [])[0] ?? '');
    const rep = c.ReputationPrerequisite;
    missions.push({
      id: `scu:${c.UUID}`, uuid: c.UUID, group: grp?.group ?? null, variants: grp?.count ?? null,
      source: 'scunpacked', category, type, title, titleStatus: t.status, titleRaw: t.raw, titleFrom: t.from, titleKey: c.TitleKey ?? null, company: giverOf(c), faction: c.Faction?.Name && !/^<=/.test(c.Faction.Name) ? c.Faction.Name : null,
      description: cleanDescription(w?.description),
      rank: c.MinStanding?.Name ?? w?.min_standing_name ?? null, rankIndex: Number.isInteger(c.RankIndex) ? c.RankIndex : (Number.isInteger(w?.rank_index) ? w.rank_index : null),
      rankRep: Number.isFinite(c.MinStanding?.MinReputation) ? c.MinStanding.MinReputation : null, rankMax: c.MaxStanding?.Name ?? null, rankMaxRep: Number.isFinite(c.MaxStanding?.MinReputation) ? c.MaxStanding.MinReputation : null, repScope: c.ReputationScope ?? null,
      repReq: rep ? { faction: rep.Faction ?? null, scope: rep.Scope ?? null, min: rep.MinStanding?.Name ?? null, minRep: Number.isFinite(rep.MinStanding?.MinReputation) ? rep.MinStanding.MinReputation : null, max: rep.MaxStanding?.Name ?? null, maxRep: Number.isFinite(rep.MaxStanding?.MinReputation) ? rep.MaxStanding.MinReputation : null } : null,
      prereq: (c.Prerequisites ?? []).reduce((n, p) => n + (p.RequiredMissions?.length ?? 0) + (p.RequiredTags?.length ?? 0), 0),
      prereqs: prereqGroups(c.Prerequisites),
      cooldown: c.Cooldown?.PersonalSeconds > 0 ? c.Cooldown.PersonalSeconds : null, inPrison: !!c.AvailableInPrison, failCriminal: !!c.FailIfBecameCriminal,
      objectives,
      reward: fixed, rewardInfo, scope: w?.reward_scope ?? null,
      system: systems.length === 1 ? systems[0] : null, systems, interstellar: !!interstellar, transit,
      route: routeTok, offer: [...new Set(offer)], offerUnknown: offerUnknown.length, pools, orders,
      maxBox: maxBoxTok ? Number(maxBoxTok[1]) : null,
      timeLimit: c.Deadline?.CompletionTime > 0 ? c.Deadline.CompletionTime : null,
      duration: c.TimeToComplete > 0 ? c.TimeToComplete : (w?.time_to_complete_minutes ?? null),
      risk: { combat: (c.Combat?.length ?? 0) > 0 || !!w?.has_combat, enemies: w?.enemy_count_max ?? null, level: riskLevel(c.Difficulty), crime: c.CrimeStat ? [c.CrimeStat.Min ?? null, c.CrimeStat.Max ?? null] : w ? [w.min_crime_stat ?? null, w.max_crime_stat ?? null] : null },
      illegal: !!c.Illegal, shareable: !!c.Shareable, onceOnly: !!c.OnceOnly,
      debug: c.DebugName ?? null, patch, _hk: String(c.Title ?? '').replace(/~mission\([^)]*\)/g, '*'),
    });
  }
  // senza la Wiki: varianti raggruppate con una chiave dichiarata (tipo, datore, titolo del modello, sistemi)
  // con la Wiki: chi non compare nel suo elenco (paginazione con buchi) riceve la stessa chiave euristica, dichiarata
  for (const m of missions) if (m.group) m.groupHow = 'wiki';
  const loose = missions.filter((m) => !m.group);
  if (loose.length) {
    const by = new Map();
    for (const m of loose) { const k = `h:${[m.type, m.company, m._hk, m.systems.join('+'), m.category].join('|')}`; m.group = k; by.set(k, (by.get(k) ?? 0) + 1); }
    for (const m of loose) { m.variants = by.get(m.group); m.groupHow = 'euristica'; }
  }
  for (const m of missions) delete m._hk;
  // titoli dei prerequisiti: nei file spesso mancano; si prendono dal modello richiesto (stesso uuid), se ha un titolo letterale
  const titleOf = new Map();
  for (const c of contracts) { if (!c?.UUID) continue; const t = missionTitle(c, wikiBy.get(c.UUID), c.MissionTokens ?? {}); if (t.status === 'verificato') titleOf.set(c.UUID, t.title); }
  for (const m of missions) for (const g of m.prereqs) for (const r of g.missions) if (!r.title && titleOf.has(r.uuid)) { r.title = titleOf.get(r.uuid); r.titleFrom = 'modello richiesto'; }
  missions.sort((a, b) => a.id.localeCompare(b.id));
  return { meta: catalogMeta(missions, { patch, fetchedAt, excluded, wiki, read: contracts.length }), places, names, missions, queue: [...queue.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) };
}

function countBy(list, f) { const o = {}; for (const x of list) for (const k of [].concat(f(x))) o[k] = (o[k] ?? 0) + 1; return o; }

export function catalogMeta(missions, { patch, fetchedAt, excluded, wiki, read }) {
  const v = parseGameVersion(patch);
  const groupsN = new Set(missions.map((m) => m.group ?? m.id)).size;
  return {
    db: DB_VERSION, source: 'scunpacked-data (contratti) + Star Citizen Wiki API (versioni, varianti, ricompense)',
    patch, version: v?.version ?? null, channel: v?.channel ?? null, build: v?.build ?? null, fetchedAt,
    read, missions: missions.length, excluded,
    templates: groupsN, variantsFrom: wiki?.grouped ? 'Star Citizen Wiki API (filter[grouped]=true)' : 'chiave euristica NAVCOM (tipo, datore, titolo, sistemi): Wiki non disponibile',
    byCategory: countBy(missions, (m) => m.category), bySystem: countBy(missions, (m) => (m.systems.length ? m.systems : ['n.d.'])),
    interstellar: missions.filter((m) => m.interstellar).length,
    rewardKinds: countBy(missions, (m) => m.rewardInfo.kind),
    withCargo: missions.filter((m) => m.orders.length).length,
    wiki: wiki ? { liveDefault: wiki.liveDefault ?? null, listed: wiki.list?.length ?? null, grouped: wiki.grouped?.length ?? null, matched: missions.filter((m) => m.groupHow === 'wiki').length, heuristic: missions.filter((m) => m.groupHow === 'euristica').length, pages: wiki.pages ?? null } : null,
    license: 'scunpacked-data: nessun file LICENSE; Wiki API: codice MIT; dati di gioco © Cloud Imperium',
    method: 'modelli di missione dai file di gioco: CATALOGATE, non offerte disponibili',
  };
}

/** Sottoinsieme per l'ATLANTE (stesso formato di prima: solo trasporto). */
export function atlasSubset(db) {
  const missions = db.missions.filter((m) => ATLAS_CATEGORIES.has(m.category));
  return { ...db, missions, meta: { ...db.meta, missions: missions.length, coverage: countBy(missions, (m) => m.system ?? (m.interstellar ? 'interstellare' : 'n.d.')), withReward: missions.filter((m) => m.reward !== null).length, pools: missions.reduce((n, m) => n + m.pools.length, 0), fixedPools: missions.reduce((n, m) => n + m.pools.filter((p) => p.size === 1 && p.ids.length === 1).length, 0) } };
}

/**
 * Validazione prima della pubblicazione. Un catalogo non valido NON sostituisce quello precedente.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateCatalog(cat, prev = null, { minMissions = 100, maxDrop = 0.4 } = {}) {
  const errors = [], warnings = [];
  if (!cat?.missions?.length) errors.push('catalogo vuoto');
  else if (cat.missions.length < minMissions) errors.push(`solo ${cat.missions.length} missioni (minimo atteso ${minMissions})`);
  if (!parseGameVersion(cat?.meta?.patch)) errors.push(`versione di gioco non riconosciuta (${cat?.meta?.patch ?? 'assente'})`);
  const P = cat?.places?.length ?? 0, N = cat?.names?.length ?? 0; const ids = new Set();
  for (const m of cat?.missions ?? []) {
    if (!m.id || !m.title || !m.category) { errors.push(`record incompleto ${m.id ?? '(senza id)'}`); break; }
    if (ids.has(m.id)) { errors.push(`id duplicato ${m.id}`); break; } ids.add(m.id);
    const bad = m.pools.some((p) => [...p.ids, ...p.alt].some((i) => i >= P) || [...p.unresolved, ...p.ambiguous].some((i) => i >= N)) || m.offer.some((i) => i >= P);
    if (bad) { errors.push(`indici dei luoghi fuori intervallo in ${m.id}`); break; }
    if (m.rewardInfo?.kind === 'fissa' && !(m.reward > 0)) { errors.push(`ricompensa fissa senza importo in ${m.id}`); break; }
  }
  if (prev?.meta) {
    if (compareVersions(cat?.meta?.patch, prev.meta.patch) < 0) errors.push(`versione ${cat?.meta?.patch} più vecchia di quella pubblicata (${prev.meta.patch})`);
    const a = prev.meta.missions ?? prev.missions?.length ?? 0, b = cat?.missions?.length ?? 0;
    if (a && b < a * (1 - maxDrop)) errors.push(`missioni scese da ${a} a ${b} (oltre il ${Math.round(maxDrop * 100)} %)`);
    else if (a && b < a) warnings.push(`missioni scese da ${a} a ${b}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Confronto con lo snapshot precedente (per variante). */
export function diffCatalog(prev, cur) {
  const sig = (m) => JSON.stringify([m.title, m.reward, m.rewardInfo?.kind, m.orders, m.pools?.map((p) => [p.role, p.size]), m.systems, m.rankIndex]);
  const a = new Map((prev?.missions ?? []).map((m) => [m.id, m])), b = new Map((cur?.missions ?? []).map((m) => [m.id, m]));
  let added = 0, removed = 0, changed = 0;
  for (const [id, m] of b) { const o = a.get(id); if (!o) added++; else if (sig(o) !== sig(m)) changed++; }
  for (const id of a.keys()) if (!b.has(id)) removed++;
  return { from: prev?.meta?.patch ?? null, to: cur?.meta?.patch ?? null, added, removed, changed, unchanged: b.size - added - changed };
}

/** Normalizza un nome per confronti (riesportato per i moduli del browser). */
export const keyOf = normName;

/**
 * Cosa pubblicare dopo la validazione (logica pura della pipeline, provata nei test).
 * Valido -> catalogo versionato + indice con diff e storico. Non valido -> si ripubblica lo snapshot
 * precedente, segnalato come tale (fallback). Nessuno snapshot -> nulla (l'app lo dice).
 * @returns {{ok:boolean, files:Array<[string, object]>, log:string}}
 */
export function publishMissions({ db, prev = null, check, warnings = [], sources = {}, liveDefault = null, fetchedAt }) {
  const patch = db?.meta?.patch ?? null;
  if (check.ok) {
    const file = `catalog-${patch ?? 'nd'}.json`;
    const diff = diffCatalog(prev?.cat ?? null, db);
    const history = [{ patch, generatedAt: fetchedAt, missions: db.missions.length, diff }, ...(prev?.idx?.history ?? []).filter((h) => h.patch !== patch)].slice(0, 12);
    const index = { generatedAt: fetchedAt, file, patch, version: db.meta.version, channel: db.meta.channel, build: db.meta.build, liveDefault, missions: db.missions.length, templates: db.meta.templates, sources, validation: { ok: true, warnings }, diff, history, fallback: null };
    return { ok: true, files: [[file, db], ['index.json', index]], log: `Mission DB: ${db.missions.length} modelli (${db.meta.templates} template), diff ${JSON.stringify(diff)}${warnings.length ? `, avvisi: ${warnings.join(' | ')}` : ''}` };
  }
  if (prev?.idx && prev?.cat) {
    const index = { ...prev.idx, sources, validation: { ok: false, errors: check.errors, warnings }, fallback: { at: fetchedAt, reason: `nuovo catalogo non valido: ${check.errors.join('; ')}`, note: 'snapshot precedente riutilizzato: dati non aggiornati' } };
    return { ok: false, files: [[prev.idx.file, prev.cat], ['index.json', index]], log: `Mission DB NON valido (${check.errors.join('; ')}): ripubblicato lo snapshot ${prev.idx.patch}` };
  }
  return { ok: false, files: [], log: `Mission DB NON valido e nessuno snapshot precedente: ${check.errors.join('; ')}` };
}
