// Cataloghi delle missioni di trasporto per NAVCOM LOGISTICS, scritti in web/data/logistics/ come
// JSON statici serviti dal sito (il browser non dipende da API esterne ne' da CORS).
// Usato dal workflow GitHub Actions a ogni pubblicazione e una volta al giorno.
// Ogni fonte e' indipendente: se una fallisce si scrive il suo stato di errore e il sito si
// pubblica comunque. Nessuna chiave API.
import { mkdirSync, writeFileSync } from 'node:fs';
import { normalizeSchp, parseSchpScript, wikiCatalog } from '../js/logistics/catalog.js';

const outDir = new URL('../data/logistics/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const UA = { 'User-Agent': 'NAVCOM-logistics-snapshot (github.com/lorenzino10/Starcitizen-)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchedAt = new Date().toISOString();
const index = { generatedAt: fetchedAt, sources: {} };

async function get(url, { json = true, tries = 4 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { fatal: true });
      return json ? await r.json() : await r.text();
    } catch (e) { last = e; if (e.fatal) break; await sleep(1000 * 2 ** i); }
  }
  throw last;
}

// ---------------------------------------------------------------- SCHaulingPlanner
const SCHP_URL = 'https://raw.githubusercontent.com/FSCSOFT-Official/SCHaulingPlanner/main/missions.js';
try {
  const cat = normalizeSchp(parseSchpScript(await get(SCHP_URL, { json: false })), { fetchedAt, url: SCHP_URL });
  writeFileSync(new URL('catalog-schp.json', outDir), JSON.stringify(cat));
  index.sources.schp = { ok: true, ...cat.meta };
  console.log(`SCHaulingPlanner: ${cat.entries.length} missioni (${cat.meta.observedFrom} → ${cat.meta.observedTo}), copertura ${JSON.stringify(cat.meta.coverage)}`);
} catch (e) {
  index.sources.schp = { ok: false, error: e.message, url: SCHP_URL };
  console.error(`SCHaulingPlanner: ERRORE ${e.message}`);
}

// ---------------------------------------------------------------- Star Citizen Wiki API
const WIKI = 'https://api.star-citizen.wiki/api/missions';
try {
  const list = [];
  let page = 1, last = 1;
  do {
    const j = await get(`${WIKI}?filter[grouped]=false&page[size]=100&page[number]=${page}`);
    list.push(...(j.data ?? []));
    last = j.meta?.last_page ?? page;
    page++;
    await sleep(250);
  } while (page <= last && page < 200);
  const hauling = list.filter((m) => m.has_hauling === true);
  console.log(`Wiki API: ${list.length} missioni elencate, ${hauling.length} con trasporto`);
  const details = [];
  let failed = 0;
  for (const m of hauling) {
    try { details.push((await get(`${WIKI}/${m.uuid}`)).data); } catch { failed++; }
    await sleep(200);
  }
  const versions = [...new Set(list.map((m) => m.version).filter(Boolean))];
  const cat = wikiCatalog(details, { fetchedAt, version: versions.length === 1 ? versions[0] : null });
  cat.meta.listed = list.length; cat.meta.haulingListed = hauling.length; cat.meta.detailFailed = failed; cat.meta.versions = versions;
  writeFileSync(new URL('catalog-wiki.json', outDir), JSON.stringify(cat));
  index.sources.wiki = { ok: cat.entries.length > 0, ...cat.meta };
  console.log(`Wiki API: ${cat.entries.length} modelli di trasporto, versione ${cat.meta.patch}, con ricompensa ${cat.meta.withReward}, dettagli falliti ${failed}, copertura ${JSON.stringify(cat.meta.coverage)}`);
} catch (e) {
  index.sources.wiki = { ok: false, error: e.message, url: WIKI };
  console.error(`Wiki API: ERRORE ${e.message}`);
}

writeFileSync(new URL('index.json', outDir), JSON.stringify(index, null, 1));
if (!Object.values(index.sources).some((s) => s.ok)) process.exitCode = 1;
