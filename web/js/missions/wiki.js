// Accesso alla Star Citizen Wiki API (https://api.star-citizen.wiki/api), solo da GitHub Actions.
// Endpoint verificati con richieste reali il 2026-11-12: /game-versions/default, /game-versions,
// /missions (paginato: meta.total, meta.last_page; filter[grouped]=true|false). Logica pura con il
// fetch iniettato, cosi' paginazione e versione LIVE sono provate nei test senza rete.

export const WIKI_API = 'https://api.star-citizen.wiki/api';

/** URL di una pagina dell'elenco missioni. */
export const missionsPageUrl = (grouped, page, size = 100, base = WIKI_API) => `${base}/missions?filter[grouped]=${grouped ? 'true' : 'false'}&page[size]=${size}&page[number]=${page}`;

/**
 * Scarica tutte le pagine e verifica il totale dichiarato dall'API.
 * L'elenco reale contiene record ripetuti tra pagine (2026-11-12: 5153 righe, 4922 uuid distinti):
 * si tengono una volta sola e si contano, senza scartare l'intero download.
 * @param getJson async (url) => json
 * @returns {Promise<object[]>} record unici, con .stats = {total, received, unique, duplicates}
 */
export async function fetchAllPages(getJson, urlOf, { maxPages = 500, sleep = null } = {}) {
  const raw = []; let page = 1, last = 1, total = null;
  do {
    const j = await getJson(urlOf(page));
    if (!Array.isArray(j?.data)) throw new Error(`pagina ${page}: risposta senza "data"`);
    raw.push(...j.data);
    last = j.meta?.last_page ?? page; total = j.meta?.total ?? total; page++;
    if (sleep) await sleep();
  } while (page <= last && page <= maxPages);
  if (page <= last) throw new Error(`paginazione interrotta a ${maxPages} pagine su ${last}`);
  if (total !== null && raw.length !== total) throw new Error(`paginazione incompleta: ${raw.length} record su ${total}`);
  const seen = new Set(); const out = [];
  for (const m of raw) { const k = m?.uuid; if (k && seen.has(k)) continue; if (k) seen.add(k); out.push(m); }
  out.stats = { total, received: raw.length, unique: out.length, duplicates: raw.length - out.length };
  return out;
}

/** Versione LIVE predefinita da /game-versions/default; null se la risposta non e' riconoscibile. */
export function liveVersion(def) {
  const d = def?.data ?? def;
  const code = typeof d?.code === 'string' ? d.code : null;
  if (!code || !/^\d+\.\d+(\.\d+)?-[A-Z]+\.\d+$/.test(code)) return null;
  return { code, channel: d.channel ?? null, releasedAt: d.released_at ?? null };
}
