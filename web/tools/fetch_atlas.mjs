// Cataloghi dell'ATLANTE (luoghi, modelli di missione di trasporto, navi) da scunpacked-data,
// scritti in web/data/atlas/ come JSON statici serviti dal sito.
// Uso: node web/tools/fetch_atlas.mjs [cartella-scunpacked]
//  - con una cartella: legge i file da li' (sviluppo locale)
//  - senza: clone superficiale e parziale del repository (GitHub Actions)
// Se la fonte non e' raggiungibile si prova a riprendere l'ultimo snapshot pubblicato sul sito
// (PAGES_URL), cosi' l'atlante non perde i luoghi solo perche' una fonte non risponde.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizePlaces, Geo } from '../js/atlas/geo.js';
import { buildMissionCatalog, buildShips, SOURCE_URL } from '../js/atlas/scunpacked.js';

const outDir = new URL('../data/atlas/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const PAGES_URL = process.env.PAGES_URL ?? 'https://lorenzino10.github.io/Starcitizen-/';
const fetchedAt = new Date().toISOString();
const write = (name, obj) => writeFileSync(new URL(name, outDir), JSON.stringify(obj));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function checkout() {
  if (process.argv[2]) return process.argv[2];
  const dir = join(tmpdir(), `scunpacked-${Date.now()}`);
  const git = (...a) => execFileSync('git', a, { stdio: ['ignore', 'inherit', 'inherit'], timeout: 900000 });
  git('clone', '--depth', '1', '--filter=blob:none', '--sparse', `${SOURCE_URL}.git`, dir);
  git('-C', dir, 'sparse-checkout', 'set', '--no-cone', '/starmap_positions.json', '/trade_locations.json', '/ships.json', '/contracts/');
  return dir;
}

async function fallback(reason) {
  console.error(`scunpacked non disponibile (${reason}): provo l'ultimo snapshot pubblicato`);
  const got = {};
  for (const f of ['index.json', 'geo.json', 'missions.json', 'ships.json']) {
    const r = await fetch(new URL(`data/atlas/${f}`, PAGES_URL));
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    got[f] = await r.json();
  }
  got['index.json'].fallback = { at: fetchedAt, reason, note: 'snapshot precedente riutilizzato: dati non aggiornati' };
  for (const [f, v] of Object.entries(got)) write(f, v);
  console.log(`riutilizzato lo snapshot del ${got['index.json'].generatedAt}`);
}

try {
  const dir = checkout();
  let patch = null;
  try { patch = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(); } catch { /* cartella non git */ }
  if (!/^\d+\.\d+/.test(patch ?? '')) patch = null;
  const star = readJson(join(dir, 'starmap_positions.json'));
  const terminals = existsSync(join(dir, 'trade_locations.json')) ? readJson(join(dir, 'trade_locations.json')) : [];
  const places = normalizePlaces(star.entities, { source: 'scunpacked starmap_positions', patch, updatedAt: fetchedAt, terminals });
  const connections = (star.connections ?? []).map((c) => ({ entry: c.entry_uuid, exit: c.exit_uuid, from: c.entry_system, to: c.exit_system, fuelCost: c.fuel_cost ?? null }));
  const cdir = join(dir, 'contracts');
  const contracts = readdirSync(cdir).filter((f) => f.endsWith('.json')).map((f) => readJson(join(cdir, f)));
  const cat = buildMissionCatalog(contracts, places, { patch, fetchedAt, geo: new Geo(places) });
  const ships = existsSync(join(dir, 'ships.json')) ? buildShips(readJson(join(dir, 'ships.json')), { patch }) : [];
  const bySys = {}; for (const p of places) bySys[p.system] = (bySys[p.system] ?? 0) + 1;
  write('geo.json', { meta: { source: 'scunpacked-data starmap_positions.json', url: SOURCE_URL, patch, fetchedAt, places: places.length, systems: bySys, hidden: places.filter((p) => p.hidden).length, terminals: places.filter((p) => p.services.length).length }, places, connections });
  write('missions.json', cat);
  write('ships.json', { meta: { source: 'scunpacked-data ships.json', patch, fetchedAt, ships: ships.length }, ships });
  const index = { generatedAt: fetchedAt, patch, source: SOURCE_URL, geo: { places: places.length, systems: bySys }, missions: cat.meta, ships: ships.length, queue: cat.queue.length, contractsRead: contracts.length };
  write('index.json', index);
  console.log(`atlante: ${places.length} luoghi ${JSON.stringify(bySys)}, ${cat.meta.missions} modelli di trasporto ${JSON.stringify(cat.meta.coverage)}, ${cat.meta.withReward} con ricompensa fissa, pool ${cat.meta.pools} (fissi ${cat.meta.fixedPools}), ${cat.queue.length} nomi in coda di normalizzazione, ${ships.length} navi con stiva, patch ${patch}`);
} catch (e) {
  try { await fallback(e.message); } catch (e2) { console.error(`nessuno snapshot riutilizzabile: ${e2.message}`); process.exitCode = 1; }
}
