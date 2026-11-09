// DESTINATION INTELLIGENCE: snapshot statico delle fonti, generato in GitHub Actions e servito
// dal sito in web/data/destinations/. Nessuna chiave API: solo endpoint pubblici in lettura.
// Uso: node web/tools/fetch_destinations.mjs [cartella-scunpacked]
//  - scunpacked-data: starmap.json (servizi, giurisdizione), resources/ (mining), ships.json
//  - UEX Corp API 2.0: luoghi, terminali, prezzi (uso personale non commerciale)
//  - starmap.space API v4: ambiente dei corpi celesti, POI (se l'endpoint risponde)
// Ogni fonte che non risponde viene sostituita dall'ultimo snapshot pubblicato, dichiarandolo.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { Geo } from '../js/atlas/geo.js';
import { SOURCE_URL } from '../js/atlas/scunpacked.js';
import { SRC, buildGameInfo, buildMining, buildEnvironment, buildSmPois, buildUexPlaces, buildMarket, buildExpeditionShips, makeResolver, makeSuggester } from '../js/dest/build.js';

const outDir = new URL('../data/destinations/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const PAGES_URL = process.env.PAGES_URL ?? 'https://lorenzino10.github.io/Starcitizen-/';
const UA = { 'User-Agent': 'NAVCOM-personal/0.8 (+https://github.com/lorenzino10/Starcitizen-)', Accept: 'application/json' };
const fetchedAt = new Date().toISOString();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (name, obj) => { const s = JSON.stringify(obj); writeFileSync(new URL(name, outDir), s); return s.length; };
const status = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { tries = 3, timeoutMs = 60000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429) throw new Error('limite di chiamate (429)');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j && !Array.isArray(j) && j.status && j.status !== 'ok') throw new Error(`risposta ${j.status}`);
      if (j && !Array.isArray(j) && j.response === 'error') throw new Error('nessun risultato');
      return Array.isArray(j) ? j : j.data ?? j;
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}
async function previous(name) {
  try { const r = await fetch(new URL(`data/destinations/${name}`, PAGES_URL)); return r.ok ? await r.json() : null; } catch { return null; }
}

// ---------------------------------------------------------------- 1. geografia di riferimento
const geoSnap = existsSync(new URL('../data/atlas/geo.json', import.meta.url)) ? readJson(new URL('../data/atlas/geo.json', import.meta.url)) : await previous('../atlas/geo.json');
if (!geoSnap) { console.error('manca data/atlas/geo.json: eseguire prima fetch_atlas.mjs'); process.exit(1); }
const geo = new Geo(geoSnap.places, { meta: geoSnap.meta });
const resolveFull = makeResolver(geo);
const resolveId = (n, s) => resolveFull(n, s)?.id ?? null;

// ---------------------------------------------------------------- 2. file di gioco
let game = null, mining = null, ships = null, patch = geoSnap.meta?.patch ?? null;
try {
  let dir = process.argv[2];
  if (!dir) {
    dir = join(tmpdir(), `scunpacked-dest-${Date.now()}`);
    const git = (...a) => execFileSync('git', a, { stdio: ['ignore', 'inherit', 'inherit'], timeout: 900000 });
    git('clone', '--depth', '1', '--filter=blob:none', '--sparse', `${SOURCE_URL}.git`, dir);
    git('-C', dir, 'sparse-checkout', 'set', '--no-cone', '/starmap.json', '/resources/locations.json', '/resources/resources.json', '/ships.json');
    try { const s = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(); if (/^\d+\.\d+/.test(s)) patch = s; } catch { /* */ }
  }
  game = buildGameInfo(readJson(join(dir, 'starmap.json')));
  for (const k of Object.keys(game)) if (!geo.get(k) && !game[k].amenities.length && !game[k].jurisdiction) delete game[k];
  mining = buildMining(readJson(join(dir, 'resources/locations.json')), readJson(join(dir, 'resources/resources.json')), { resolve: resolveId, patch });
  ships = buildExpeditionShips(readJson(join(dir, 'ships.json')), { patch });
  status.scu = { ok: true, patch, at: fetchedAt, places: Object.keys(game).length, miningPlaces: Object.keys(mining.byPlace).length, ships: ships.length };
} catch (e) {
  const prev = await previous('dest.json');
  status.scu = { ok: false, error: e.message, reused: prev?.meta?.sources?.scu?.at ?? null };
  game = prev?.game ?? {}; mining = prev?.mining ?? { byPlace: {}, unmatched: [] };
  ships = (await previous('ships.json'))?.ships ?? [];
}

// ---------------------------------------------------------------- 3. starmap.space
let env = null, smPois = null;
try {
  const oc = {};
  for (const s of ['Stanton', 'Pyro', 'Nyx']) { oc[s] = await getJson(`https://starmap.space/api/v4/oc/index.php?system=${s}`); await sleep(800); }
  env = buildEnvironment(oc, { resolve: resolveId, fetchedAt });
  status.sm = { ok: true, at: fetchedAt, bodies: Object.keys(env.byPlace).length, unmatched: env.unmatched.length, suspect: env.suspect };
} catch (e) {
  const prev = await previous('dest.json');
  env = prev?.env ?? { byPlace: {}, unmatched: [], suspect: {} };
  status.sm = { ok: false, error: e.message, reused: prev?.meta?.sources?.sm?.at ?? null };
}
try {
  const planets = [...new Set(geo.places.filter((p) => p.kind === 'planet' || p.kind === 'moon').map((p) => p.name))];
  const rows = []; let fails = 0, firstErr = null;
  for (const pl of planets) {
    try { rows.push(...await getJson(`https://starmap.space/api/v4/pois/index.php?planet=${encodeURIComponent(pl)}`, { tries: 1 })); } catch (e) { fails++; firstErr ??= e.message; }
    await sleep(600);
    if (fails >= 3 && !rows.length) break; // endpoint giu': inutile insistere
  }
  if (!rows.length) throw new Error(`endpoint POI non disponibile (${firstErr ?? 'nessun dato'})`);
  smPois = buildSmPois(rows, { resolve: resolveId });
  status.smPois = { ok: true, at: fetchedAt, pois: Object.keys(smPois.byPlace).length, unmatched: smPois.unmatched.length };
} catch (e) {
  const prev = await previous('dest.json');
  smPois = prev?.smPois ?? { byPlace: {}, unmatched: [] };
  status.smPois = { ok: false, error: e.message, reused: prev?.meta?.sources?.smPois?.at ?? null };
}

// ---------------------------------------------------------------- 4. UEX
let uex = null, market = null;
try {
  const raw = {};
  for (const e of ['space_stations', 'cities', 'outposts', 'poi', 'terminals', 'categories', 'commodities', 'items_prices_all', 'commodities_prices_all', 'fuel_prices_all']) {
    raw[e] = await getJson(`https://api.uexcorp.uk/2.0/${e}`); await sleep(700);
  }
  uex = buildUexPlaces(raw, { resolve: resolveFull, suggest: makeSuggester(geo) });
  market = buildMarket(raw, { fetchedAt });
  const L = Object.values(uex.locations);
  status.uex = { ok: true, at: fetchedAt, locations: L.length, linked: L.filter((l) => l.placeId).length, ambiguous: L.filter((l) => l.candidates.length).length, terminals: Object.keys(uex.terminals).length, itemPrices: market.itemPrices.length, commodityPrices: market.commodityPrices.length };
} catch (e) {
  const prev = await previous('dest.json'); const pm = await previous('market.json');
  uex = prev?.uex ?? { locations: {}, terminals: {} }; market = pm ?? null;
  status.uex = { ok: false, error: e.message, reused: prev?.meta?.sources?.uex?.at ?? null };
}

// ---------------------------------------------------------------- 5. scrittura
const meta = { generatedAt: fetchedAt, patch, sources: status, catalog: Object.values(SRC) };
const sizes = {
  dest: write('dest.json', { meta, game, env, smPois, mining, uex }),
  market: market ? write('market.json', market) : 0,
  ships: write('ships.json', { meta: { patch, fetchedAt, source: 'scu' }, ships }),
};
write('index.json', { ...meta, files: sizes });
console.log(JSON.stringify({ status, sizes }, null, 1));
if (process.env.DEST_DUMP) {
  // solo per lo sviluppo: copia compressa nel log (nessun dato privato)
  for (const f of ['dest.json', 'market.json', 'ships.json']) {
    const p = new URL(f, outDir); if (!existsSync(p)) continue;
    const b = gzipSync(readFileSync(p)).toString('base64');
    for (let i = 0; i < b.length; i += 8000) console.log(`DUMP ${f} ${i / 8000} ${b.slice(i, i + 8000)}`);
  }
}
