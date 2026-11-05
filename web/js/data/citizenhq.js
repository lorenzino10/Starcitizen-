// CitizenHQ API (https://citizenhq.space/api), verificata il 2026-11-05:
//  GET /api/v1/positions?system=stanton|pyro|nyx -> array {uuid,name,type,system,parentUuid,x,y,z,qtValid}
//  metri, frame della griglia del sistema (stella a 0,0,0), coordinate eventualmente null.
//  GET /api/v1/health -> stato sync + versione dati scunpacked (es. 4.10.2-LIVE.12881860).
//  Solo GET, nessuna chiave, 60 richieste/minuto per IP (burst 30) -> 429. CORS dichiarato attivo.
// Il parser e' condiviso fra browser e script dello snapshot (Node).

export const BASE_URL = 'https://citizenhq.space/api/v1';
export const SOURCE = 'citizenhq';
export const ATTRIBUTION = 'Dati via CitizenHQ (UEX Corp, SC Trade Tools, scunpacked, Star Citizen Wiki)';
export const SYSTEMS = ['stanton', 'pyro', 'nyx'];
const VERSION_RE = /\b\d+\.\d+(?:\.\d+)?-(?:LIVE|PTU|EPTU)\.\d+\b/;

export class ApiError extends Error {}

export function findGameVersion(health) {
  const m = JSON.stringify(health ?? '').match(VERSION_RE);
  return m ? m[0] : null;
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['data', 'items', 'positions', 'results']) if (Array.isArray(payload[k])) return payload[k];
  }
  throw new ApiError('struttura JSON inattesa per /positions');
}

function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') throw new Error('booleano');
  const f = typeof v === 'number' ? v : Number(v);
  if (typeof v === 'string' && v.trim() === '') throw new Error('vuoto');
  if (!Number.isFinite(f)) throw new Error('non numerico');
  return f;
}

/** Converte la risposta in posizioni valide e conta gli scarti. */
export function parsePositions(payload, system) {
  const report = { fetched: 0, skippedNoCoords: 0, skippedInvalid: 0 };
  const out = [];
  for (const row of rowsOf(payload)) {
    report.fetched++;
    if (!row || typeof row !== 'object' || !row.name) { report.skippedInvalid++; continue; }
    let x, y, z;
    try { x = num(row.x); y = num(row.y); z = num(row.z); } catch { report.skippedInvalid++; continue; }
    if (x === null || y === null || z === null) { report.skippedNoCoords++; continue; }
    out.push({
      uuid: String(row.uuid ?? `${system}:${row.name}`),
      name: String(row.name).trim(),
      system: String(row.system ?? system).toLowerCase(),
      type: String(row.type ?? '?'),
      x, y, z,
      qtValid: !!row.qtValid,
      parentUuid: row.parentUuid ?? null,
    });
  }
  return { locations: out, report };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET JSON con timeout, gestione 429 (Retry-After) e 5xx, al massimo `retries` tentativi. */
export async function getJson(url, { retries = 3, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  let last = '';
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (r.ok) {
        try { return await r.json(); } catch (e) { throw new ApiError(`risposta non JSON (${e.message})`); }
      }
      if (r.status === 429) {
        const wait = Number(r.headers.get('Retry-After') ?? 5) || 5;
        last = `HTTP 429 (limite richieste), attendo ${wait}s`;
        await sleep(Math.min(wait, 30) * 1000);
        continue;
      }
      if (r.status >= 500) last = `HTTP ${r.status}`;
      else throw new ApiError(`HTTP ${r.status}`);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      last = e.name === 'AbortError' ? 'timeout' : `errore di rete (${e.message}); se sei nel browser puo' essere CORS`;
    } finally {
      clearTimeout(timer);
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new ApiError(`fallito dopo ${retries} tentativi: ${last}`);
}

/** Scarica le posizioni di un sistema. Ritorna {ok, locations, meta, errors, warnings}. */
export async function fetchSystem(system, opts = {}) {
  const res = { ok: false, locations: [], meta: null, errors: [], warnings: [] };
  system = system.toLowerCase();
  if (!SYSTEMS.includes(system)) { res.errors.push(`sistema sconosciuto: ${system}`); return res; }
  let gameVersion = null;
  try { gameVersion = findGameVersion(await getJson(`${BASE_URL}/health`, { ...opts, retries: 1 })); }
  catch (e) { res.warnings.push(`/health non disponibile: ${e.message}`); }
  if (!gameVersion) res.warnings.push('versione del gioco non determinata');
  try {
    const payload = await getJson(`${BASE_URL}/positions?system=${system}`, opts);
    const { locations, report } = parsePositions(payload, system);
    res.ok = true;
    res.locations = locations;
    res.meta = { source: SOURCE, system, gameVersion, fetchedAt: new Date().toISOString(), attribution: ATTRIBUTION, ...report };
  } catch (e) {
    res.errors.push(e.message);
  }
  return res;
}
