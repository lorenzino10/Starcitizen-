// MISSION FINDER e classificazione delle missioni (logica pura, nel browser e nei test).
// Lavora sulle "viste missione" dell'ATLANTE (catalogViews/userViews) arricchite con i campi del
// Mission Database 2.0. Nessuna missione e' dichiarata DISPONIBILE ORA: il catalogo dice cosa il
// gioco PUO' generare; disponibile e' solo cio' che vedi tu nel MobiGlas.
import { catalogViews } from '../atlas/missions.js';
import { systemsPath, CATEGORY_LABEL } from './build.js';
import { SHIPS } from '../logistics/model.js';

export const CLASS = {
  catalogata: { icon: '🟠', label: 'CATALOGATA', note: 'presente nei file del gioco: non è un\'offerta' },
  potenziale: { icon: '🟡', label: 'POTENZIALMENTE DISPONIBILE', note: 'compatibile con i requisiti noti; va trovata nel MobiGlas' },
  storica: { icon: '🟤', label: 'OSSERVAZIONE STORICA', note: 'vista in passato da una fonte terza (SCHaulingPlanner): non è un\'offerta attuale' },
  osservata: { icon: '🔵', label: 'OSSERVATA NEL MOBIGLAS', note: 'vista e registrata da te' },
  accettata: { icon: '🟢', label: 'ACCETTATA', note: 'confermata da te' },
  completata: { icon: '✔', label: 'COMPLETATA', note: 'stato inserito da te' },
  fallita: { icon: '✖', label: 'FALLITA', note: 'stato inserito da te' },
  non_disponibile: { icon: '⚪', label: 'NON PIÙ DISPONIBILE', note: 'segnata da te' },
};
export const ROUTE = {
  certa: { label: 'ROTTA CERTA', note: 'ogni ritiro e consegna è un unico luogo noto' },
  variabile: { label: 'DESTINAZIONI VARIABILI', note: 'il gioco sceglie uno fra più luoghi del pool' },
  incompleta: { label: 'DATI INCOMPLETI', note: 'luoghi non riconosciuti o assenti nei file' },
  nessuna: { label: 'SENZA TRASPORTO', note: 'missione senza ritiri/consegne nei file' },
};
export { CATEGORY_LABEL };

/** Viste del Mission Database 2.0: formato dell'atlante + campi aggiuntivi (alternative ambigue comprese). */
export function dbViews(cat) {
  if (!cat?.missions) return [];
  const views = catalogViews(cat);
  return views.map((v, i) => {
    const m = cat.missions[i];
    m.pools.forEach((p, k) => { const o = v.ops[k]; if (o) { o.alt = (p.alt ?? []).map((x) => cat.places[x]); o.src = p.src ?? 'pool'; } });
    return Object.assign(v, {
      uuid: m.uuid, group: m.group ?? null, variants: m.variants ?? null, groupHow: m.groupHow ?? null, faction: m.faction ?? null,
      description: m.description ?? null, systems: m.systems ?? (m.system ? [m.system] : []), interstellar: !!m.interstellar, transit: m.transit ?? null,
      rewardInfo: m.rewardInfo ?? (m.reward ? { kind: 'fissa', min: m.reward, max: m.reward } : { kind: 'nd' }),
      risk: m.risk ?? null, repReq: m.repReq ?? null, prereq: m.prereq ?? 0, duration: m.duration ?? null, onceOnly: !!m.onceOnly, shareable: !!m.shareable,
      titleStatus: m.titleStatus ?? null, titleRaw: m.titleRaw ?? null, titleFrom: m.titleFrom ?? null, titleKey: m.titleKey ?? null, debug: m.debug ?? null,
      rankRep: m.rankRep ?? null, rankMax: m.rankMax ?? null, rankMaxRep: m.rankMaxRep ?? null, repScope: m.repScope ?? null, prereqs: m.prereqs ?? [], scope: m.scope ?? null,
      cooldown: m.cooldown ?? null, inPrison: !!m.inPrison, failCriminal: !!m.failCriminal,
      objectives: (m.objectives ?? []).map((p) => ({ role: 'objective', slot: p.slot, token: p.token, ids: p.ids.map((x) => cat.places[x]), alt: (p.alt ?? []).map((x) => cat.places[x]), unresolved: (p.unresolved ?? []).map((x) => cat.names[x]), size: p.size })),
    });
  });
}

/** Il luogo sta nell'area? area = {system} oppure {id} (sistema, pianeta, luna, stazione, base). */
export function within(geo, placeId, area) {
  if (!placeId || !area) return false;
  const p = geo.get(placeId); if (!p) return false;
  if (!area.id) return !!area.system && p.system === area.system;
  if (placeId === area.id) return true;
  return geo.path(placeId).some((x) => x.id === area.id);
}

/**
 * Corrispondenza di un ruolo (ritiro/consegna) con un'area.
 * @returns {null|'certo'|'possibile'|'no'} null = nessuna operazione di quel ruolo nei dati
 */
export function matchRole(v, role, area, geo) {
  const ops = v.ops.filter((o) => o.role === role); if (!ops.length) return null;
  let best = 'no';
  for (const o of ops) {
    const cand = [...o.ids, ...(o.alt ?? [])];
    const inside = cand.filter((id) => within(geo, id, area));
    if (!inside.length) continue;
    const allIn = inside.length === cand.length && !o.unresolved?.length && !o.anonymous;
    // tutti i luoghi possibili stanno nell'area: il ruolo e' certamente li' (anche se il punto preciso varia)
    if (allIn) return 'certo';
    best = 'possibile';
  }
  return best;
}

/** Certezza della rotta di una missione. */
export function routeCertainty(v) {
  const ops = v.ops.filter((o) => o.role === 'pickup' || o.role === 'dropoff');
  if (!ops.length) return 'nessuna';
  if (ops.some((o) => !o.ids.length && !(o.alt ?? []).length)) return 'incompleta';
  if (ops.every((o) => o.fixed)) return 'certa';
  return 'variabile';
}

/** Box SCU standard (unita' da 1,25 m): dimensioni note delle casse del gioco. */
const BOX = [[1, [1, 1, 1]], [2, [1, 1, 2]], [4, [1, 2, 2]], [8, [2, 2, 2]], [16, [2, 2, 4]], [24, [2, 2, 6]], [32, [2, 2, 8]]];
/** Cassa piu' grande che entra nella griglia (dimensioni reali dai file); null se ignote. */
export function maxBoxFromGrid(dims) {
  if (!Array.isArray(dims) || dims.length !== 3 || dims.some((d) => !(d > 0))) return null;
  const g = dims.map((d) => d / 1.25).sort((a, b) => a - b);
  let best = null;
  for (const [scu, b] of BOX) { const s = [...b].sort((a, c) => a - c); if (s.every((x, i) => x <= g[i] + 1e-9)) best = scu; }
  return best;
}
/** Capacita' della nave: stiva e cassa massima, con la fonte. */
export function shipCaps(name, atlasShips = []) {
  const known = Object.values(SHIPS).find((s) => s.name === name && s.scu);
  if (known) return { name, scu: known.scu, maxBox: known.maxBox, source: known.source };
  const s = atlasShips.find((x) => x.name === name);
  if (!s) return { name, scu: null, maxBox: null, source: null };
  const boxes = (s.grids ?? []).map((g) => maxBoxFromGrid(g.maxItem ?? g.dims)).filter(Boolean);
  return { name, scu: s.scu ?? null, maxBox: boxes.length ? Math.max(...boxes) : null, source: `file di gioco (griglia cargo${boxes.length ? ', cassa massima dalle dimensioni' : ''})` };
}

/** Quantita' totale (SCU) e cassa massima richiesta dai dati della missione. */
export function cargoOf(v) {
  const scu = v.orders?.length ? v.orders.reduce((n, o) => n + (o.scuMax ?? o.scuMin ?? 0), 0) : v.ops.filter((o) => o.role === 'dropoff').reduce((n, o) => n + (o.scu ?? 0), 0);
  const scuMin = v.orders?.length ? v.orders.reduce((n, o) => n + (o.scuMin ?? 0), 0) : null;
  const boxes = [...(v.orders ?? []).map((o) => o.containerMax), v.maxBox, ...v.ops.map((o) => o.containerMax)].filter((x) => x > 0);
  return { scu: scu || null, scuMin: scuMin || null, box: boxes.length ? Math.max(...boxes) : null };
}

/** Classificazione (B4). profile = {ranks:{company:index}} */
export function classify(v, profile = {}) {
  if (v.origin === 'utente') {
    const s = v.status;
    const k = s === 'accettata' || s === 'in_esecuzione' ? 'accettata' : s === 'completata' ? 'completata' : s === 'fallita' ? 'fallita' : s === 'non_disponibile' ? 'non_disponibile' : 'osservata';
    return { cls: k, notes: [] };
  }
  if (v.origin === 'storica') return { cls: 'storica', notes: [] };
  const notes = [];
  let ok = true;
  if (Number.isInteger(v.rankIndex) && v.rankIndex > 0) {
    const mine = profile.ranks?.[v.company];
    if (mine === undefined || mine === null) { ok = false; notes.push(`richiede il grado ${v.rank ?? v.rankIndex} con ${v.company ?? 'il datore'}: il tuo grado non è dichiarato`); }
    else if (mine < v.rankIndex) { ok = false; notes.push(`richiede il grado ${v.rank ?? v.rankIndex}: il tuo è inferiore`); }
  }
  if (v.prereq > 0) { ok = false; notes.push('richiede missioni precedenti (catena)'); }
  if (!v.offer?.length && !v.offerUnknown) notes.push('luogo d\'offerta non indicato nei file');
  return { cls: ok ? 'potenziale' : 'catalogata', notes };
}

/**
 * MISSION FINDER.
 * @param q {from:{system}|{id}, to, categories:Set|null, minReward, ship:{scu,maxBox}, maxScu, risk:'any'|'nocombat'|number, legalOnly, includeUnknownReward, profile}
 * @returns {{rows, excluded:{[reason]:n}, total}}
 */
export function findMissions(views, q, { geo, links = [], limit = 300 } = {}) {
  const excluded = {}; const ex = (k) => { excluded[k] = (excluded[k] ?? 0) + 1; };
  const cap = [q.maxScu, q.ship?.scu].filter((x) => x > 0);
  const capacity = cap.length ? Math.min(...cap) : null;
  const rows = [];
  for (const v of views) {
    if (v.origin === 'utente' && ['completata', 'fallita', 'non_disponibile'].includes(v.status)) { ex('contratti chiusi'); continue; }
    if (q.categories?.size && !q.categories.has(v.category)) { ex('tipo'); continue; }
    if (q.legalOnly && v.illegal) { ex('illegale'); continue; }
    if (q.risk === 'nocombat' && v.risk?.combat) { ex('combattimento'); continue; }
    if (typeof q.risk === 'number' && v.risk?.level !== null && v.risk?.level !== undefined && v.risk.level > q.risk) { ex('rischio'); continue; }
    let from = null, offerHere = false;
    if (q.from) {
      from = matchRole(v, 'pickup', q.from, geo);
      offerHere = (v.offer ?? []).some((o) => o.id && within(geo, o.id, q.from));
      if (from === 'no' || (from === null && !offerHere)) { ex('partenza'); continue; }
    }
    let to = null;
    if (q.to) { to = matchRole(v, 'dropoff', q.to, geo); if (!to || to === 'no') { ex('destinazione'); continue; } }
    const ri = v.rewardInfo ?? { kind: v.reward ? 'fissa' : 'nd' };
    if (q.minReward > 0) {
      if (v.reward === null || v.reward === undefined) { if (!q.includeUnknownReward) { ex('ricompensa non nota'); continue; } } else if ((ri.max ?? v.reward) < q.minReward) { ex('ricompensa'); continue; }
    }
    const cargo = cargoOf(v);
    let fit = 'nd', trips = null;
    if (cargo.box && q.ship?.maxBox && cargo.box > q.ship.maxBox) { fit = 'cassa'; }
    else if (cargo.scu && capacity) { trips = Math.ceil(cargo.scu / capacity); fit = trips <= 1 ? 'ok' : 'viaggi'; }
    if (fit === 'cassa' && !q.includeIncompatible) { ex('casse troppo grandi per la nave'); continue; }
    const pickSys = [...new Set(v.ops.filter((o) => o.role === 'pickup').flatMap((o) => [...o.ids, ...(o.alt ?? [])]).map((id) => geo.get(id)?.system).filter(Boolean))];
    const dropSys = [...new Set(v.ops.filter((o) => o.role === 'dropoff').flatMap((o) => [...o.ids, ...(o.alt ?? [])]).map((id) => geo.get(id)?.system).filter(Boolean))];
    const path = pickSys.length === 1 && dropSys.length === 1 ? systemsPath(pickSys[0], dropSys[0], links) : null;
    rows.push({ v, from, to, offerHere, route: routeCertainty(v), cargo, fit, trips, path, interstellar: v.interstellar || (path?.length ?? 0) > 1, cls: classify(v, q.profile) });
  }
  const R = { certa: 0, variabile: 1, incompleta: 2, nessuna: 3 }; const O = { utente: 0, storica: 1, catalogo: 1 }; /* contratti tuoi prima; modelli e storiche mescolati */ const M = { certo: 0, possibile: 1, null: 2 };
  rows.sort((a, b) => O[a.v.origin] - O[b.v.origin] || M[a.from ?? 'null'] - M[b.from ?? 'null'] || M[a.to ?? 'null'] - M[b.to ?? 'null'] || R[a.route] - R[b.route] || (b.v.reward ?? -1) - (a.v.reward ?? -1) || a.v.id.localeCompare(b.v.id));
  return { rows: rows.slice(0, limit), total: rows.length, excluded };
}

/** Riduce le varianti: una riga per gruppo (la variante migliore), con il numero di varianti trovate. */
export function collapseVariants(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.v.origin === 'catalogo' && r.v.group ? `g:${r.v.group}` : r.v.id;
    const o = by.get(k); if (!o) by.set(k, { ...r, found: 1 }); else o.found++;
  }
  return [...by.values()];
}

/** Area da testo: sistema ("Pyro") o luogo risolto dall'atlante. */
export function parseArea(text, geo) {
  const t = String(text ?? '').trim(); if (!t) return null;
  const sys = { stanton: 'stanton', pyro: 'pyro', nyx: 'nyx' }[t.toLowerCase().replace(/ system$| sistema$/, '')];
  if (sys) return { system: sys, label: t };
  const p = geo.resolveName(t); if (!p) return { error: `"${t}" non riconosciuto` };
  if (p.kind === 'star') return { system: p.system, label: p.name };
  return { id: p.id, system: p.system, label: p.name };
}

/** Rete dei salti dal database geografico: A-B utilizzabile se in A c'e' "<B> Gateway" e in B "<A> Gateway". */
export function jumpLinks(geo) {
  const label = { stanton: 'stanton', pyro: 'pyro', nyx: 'nyx' };
  const gw = (sys) => new Set(geo.inSystem(sys).filter((p) => p.kind === 'gateway').map((p) => p.name.toLowerCase().replace(/ gateway$/, '')));
  const have = Object.fromEntries(Object.keys(label).map((s) => [s, gw(s)]));
  const out = [];
  for (const a of Object.keys(label)) for (const b of Object.keys(label)) if (a < b && have[a].has(b) && have[b].has(a)) out.push({ from: a, to: b });
  return out;
}
