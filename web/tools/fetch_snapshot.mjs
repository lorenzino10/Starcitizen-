// Scarica da CitizenHQ le posizioni di Stanton, Pyro e Nyx e le scrive in web/data/ come
// snapshot statico servito insieme al sito (stessa origine: niente problemi di CORS).
// Usato dal workflow GitHub Actions a ogni deploy e una volta al giorno.
// Uscita con codice 1 solo se TUTTI i sistemi falliscono: un sistema mancante non blocca il sito.
import { mkdirSync, writeFileSync } from 'node:fs';
import { ATTRIBUTION, SYSTEMS, fetchSystem } from '../js/data/citizenhq.js';

const outDir = new URL('../data/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const index = { generatedAt: new Date().toISOString(), attribution: ATTRIBUTION, systems: {} };
let okCount = 0;

for (const system of SYSTEMS) {
  const r = await fetchSystem(system);
  if (r.ok && r.locations.length) {
    writeFileSync(new URL(`positions-${system}.json`, outDir), JSON.stringify({ meta: r.meta, locations: r.locations }));
    index.systems[system] = { ok: true, count: r.locations.length, gameVersion: r.meta.gameVersion, warnings: r.warnings };
    okCount++;
    console.log(`${system}: ${r.locations.length} posizioni (versione ${r.meta.gameVersion ?? 'n.d.'})`);
  } else {
    index.systems[system] = { ok: false, errors: r.errors, warnings: r.warnings };
    console.error(`${system}: ERRORE ${r.errors.join('; ')}`);
  }
}
writeFileSync(new URL('index.json', outDir), JSON.stringify(index, null, 1));
if (okCount === 0) process.exit(1);
