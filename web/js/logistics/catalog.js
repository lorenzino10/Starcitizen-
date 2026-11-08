// CATALOGO delle missioni di trasporto: modelli presenti in database esterni.
// Un elemento del catalogo NON e' un'offerta disponibile. I luoghi di ritiro/consegna che il gioco
// assegna dinamicamente restano "candidati" (fixed:false) finche' non li verifichi tu.
//
// Fonti (verificate il 2026-11-08):
//  - SCHaulingPlanner (FSCSOFT-Official): missions.js, 266 missioni di Stanton lette dai mission
//    board via OCR tra il 2026-05-25 e il 2026-06-01. Nessun campo patch. README: licenza MIT,
//    ma il file LICENSE non e' presente nel repository.
//  - Star Citizen Wiki API (api.star-citizen.wiki, licenza MIT del codice): modelli di missione
//    estratti dai file del gioco, con versione (es. 4.10.2-LIVE.12881860), datore, grado,
//    sistemi, ordini di trasporto (SCU min/max, cassa massima). Ricompense spesso null.
import { normName, rankIndex } from './model.js';

const sysKey = (s) => String(s ?? '').trim().toLowerCase() || null;
const uniq = (a) => [...new Set(a.filter(Boolean))];

/** Hash breve e stabile (per ID deterministici di fonti senza identificativo). */
export function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** missions.js di SCHaulingPlanner -> oggetto MISSION_DATA (senza eseguire codice). */
export function parseSchpScript(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('missions.js: struttura MISSION_DATA non trovata');
  const data = JSON.parse(text.slice(a, b + 1));
  if (!Array.isArray(data.missions)) throw new Error('missions.js: campo missions assente');
  return data;
}

export function normalizeSchp(data, { fetchedAt = null, url = null } = {}) {
  const dates = [];
  const entries = data.missions.map((m) => {
    const d = /(\d{4})\.(\d{2})\.(\d{2})/.exec(m.sourceFile ?? '');
    const observed = d ? `${d[1]}-${d[2]}-${d[3]}` : null;
    if (observed) dates.push(observed);
    const system = sysKey(m.system);
    const movements = (m.deliveries ?? []).map((x) => ({
      cargo: x.cargo ?? null, scu: Number(x.scu) || null, scuMin: null, containerMax: null,
      from: { names: uniq(x.pickups ?? []), fixed: (x.pickups ?? []).length === 1, splitKnown: (x.pickups ?? []).length <= 1 },
      to: { names: uniq([x.destination]), fixed: !!x.destination },
    }));
    const key = JSON.stringify([m.contractor, m.reward, m.rank, m.sourceFile, m.deliveries]);
    return {
      id: `schp:${stableHash(key)}`, source: 'schp', title: `${m.contractor ?? 'Contratto'} · ${m.missionType ?? ''}`.trim(),
      company: m.contractor ?? null, rank: m.rank ?? null, rankIndex: rankIndex(m.rank),
      reward: Number.isFinite(m.reward) ? m.reward : null, rewardMax: null,
      systems: system ? [system] : [], offerZones: uniq(Array.isArray(m.location) ? m.location : [m.location]),
      missionType: m.missionType ?? null, combat: null, legal: null,
      patch: null, observedAt: observed, movements,
      notes: movements.some((x) => !x.from.splitKnown) ? 'più punti di ritiro per una consegna: ripartizione delle quantità non indicata dalla fonte' : '',
    };
  });
  dates.sort();
  return {
    meta: {
      source: 'SCHaulingPlanner (FSCSOFT-Official)', url, fetchedAt, entries: entries.length,
      patch: null, observedFrom: dates[0] ?? null, observedTo: dates.at(-1) ?? null,
      coverage: countBy(entries, (e) => e.systems.join('+') || 'n.d.'),
      license: 'MIT dichiarata nel README; file LICENSE assente nel repository',
      method: 'mission board di gioco letti con OCR e verifica manuale (dichiarato dalla fonte)',
    },
    entries,
  };
}

/** Dettaglio di una missione della Wiki API (risposta di /api/missions/{uuid}, campo data). */
export function normalizeWikiMission(d) {
  const tok = d.mission_tokens ?? {};
  const pick = uniq(tok['Location|Address'] ?? []), dest = uniq(tok['Destination|Address'] ?? []);
  const orders = Array.isArray(d.hauling_orders) ? d.hauling_orders : [];
  const movements = orders.map((o) => ({
    cargo: o.name ?? null,
    scu: o.max_scu ?? o.max_amount ?? null, scuMin: o.min_scu ?? o.min_amount ?? null,
    containerMax: o.max_container_size > 0 ? o.max_container_size : null,
    from: { names: pick, fixed: false, splitKnown: false },
    to: { names: dest, fixed: false },
  }));
  return {
    id: `wiki:${d.uuid}`, source: 'wiki', title: d.title ?? 'Missione', company: d.mission_giver ?? d.faction?.name ?? null,
    rank: d.min_standing?.name ?? d.min_standing_name ?? null, rankIndex: rankIndex(d.min_standing?.name ?? d.min_standing_name),
    reward: d.reward_min > 0 ? d.reward_min : null, rewardMax: d.reward_max > 0 ? d.reward_max : null,
    systems: uniq((d.star_systems ?? []).map(sysKey)), offerZones: [],
    missionType: d.mission_type ?? null, combat: d.has_combat ?? null, legal: d.illegal === undefined ? null : !d.illegal,
    patch: d.version ?? d.game_version ?? null, observedAt: null, movements,
    debugName: d.debug_name ?? null, link: d.web_url ?? d.link ?? null,
    notes: 'modello estratto dai file del gioco: luoghi di ritiro e consegna sono candidati assegnati dinamicamente (interpretazione dei token Location/Destination non verificata in gioco)',
  };
}

/** Una missione della Wiki e' di trasporto? (lista: has_hauling; dettaglio: hauling_orders o tipo) */
export const isWikiHauling = (d) => d.has_hauling === true || (Array.isArray(d.hauling_orders) && d.hauling_orders.length > 0) || /^hauling/i.test(d.mission_type ?? '');

export function wikiCatalog(details, { fetchedAt = null, version = null } = {}) {
  const entries = details.filter(isWikiHauling).map(normalizeWikiMission);
  return {
    meta: {
      source: 'Star Citizen Wiki API (api.star-citizen.wiki)', url: 'https://api.star-citizen.wiki/api/missions', fetchedAt,
      entries: entries.length, patch: version ?? entries.find((e) => e.patch)?.patch ?? null,
      coverage: countBy(entries.flatMap((e) => (e.systems.length ? e.systems : ['n.d.']).map((s) => ({ s }))), (x) => x.s),
      withReward: entries.filter((e) => e.reward !== null).length,
      license: 'codice MIT (StarCitizenWiki/API); dati estratti dai file di gioco © Cloud Imperium',
      method: 'modelli di missione dai file di gioco (non offerte reali)',
    },
    entries,
  };
}

function countBy(list, f) { const o = {}; for (const x of list) { const k = f(x); o[k] = (o[k] ?? 0) + 1; } return o; }

/** Indice dei luoghi del catalogo: luogo -> modelli con ritiro (o consegna) li'. */
export function catalogPlaces(entries) {
  const pickup = new Map(), drop = new Map();
  for (const e of entries) for (const m of e.movements) {
    for (const n of m.from.names) { const k = normName(n); if (!pickup.has(k)) pickup.set(k, { name: n, entries: new Set() }); pickup.get(k).entries.add(e); }
    for (const n of m.to.names) { const k = normName(n); if (!drop.has(k)) drop.set(k, { name: n, entries: new Set() }); drop.get(k).entries.add(e); }
  }
  return { pickup, drop };
}

/**
 * Promozione di un modello a missione OSSERVATA: possibile solo con un'azione esplicita che indichi
 * luogo e momento dell'osservazione. I luoghi non fissi restano vuoti finche' non li inserisci.
 */
export function observeFromCatalog(entry, { place, at, patch, system }) {
  if (!place || !at) throw new Error('Per registrare un\'osservazione servono il luogo e il momento in cui hai visto l\'offerta.');
  return {
    title: entry.title, company: entry.company, rank: entry.rank, reward: null, system: system ?? entry.systems[0] ?? null,
    offerZone: place, status: 'osservata', patch: patch ?? null, observedAt: at, source: `osservata (modello ${entry.source})`,
    catalogRef: entry.id,
    notes: 'Ricompensa e quantità da confermare nel MobiGlas: i valori del catalogo non sono copiati.',
    movements: entry.movements.map((m, i) => ({
      id: `m${i + 1}`, cargo: m.cargo, scu: m.scu, containerMax: m.containerMax,
      from: m.from.fixed && m.from.names.length === 1 ? { name: m.from.names[0] } : null,
      to: m.to.fixed && m.to.names.length === 1 ? { name: m.to.names[0] } : null,
    })),
  };
}
