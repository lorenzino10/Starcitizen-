// Controllo dei dati appena scaricati (usato dal workflow di pubblicazione): corpi celesti di
// Pyro/Nyx abbinati ai raggi e stazioni Gateway presenti. Scrive annotazioni ::notice:: leggibili
// dalla pagina dell'esecuzione su GitHub. Non fa mai fallire la pubblicazione.
import { readFileSync } from 'node:fs';
import { obstructionModel } from '../js/data/bodies.js';

for (const sys of ['stanton', 'pyro', 'nyx']) {
  let snap;
  try { snap = JSON.parse(readFileSync(new URL(`../data/positions-${sys}.json`, import.meta.url), 'utf8')); } catch { console.log(`::warning title=${sys}::snapshot assente`); continue; }
  const rows = snap.locations;
  const m = obstructionModel(sys, 1.2, rows);
  const gw = rows.filter((r) => /gateway/i.test(r.name)).map((r) => `${r.name}${r.qtValid ? '' : ' (non QT)'}`);
  const qt = rows.filter((r) => r.qtValid).length;
  console.log(`::notice title=Dati ${sys}::${rows.length} posizioni, ${qt} marker QT; corpi con raggio: ${m.bodies.filter((b) => !b.uncertain).length}; senza raggio: ${m.missing.join(', ') || 'nessuno'}; gateway: ${gw.join(', ') || 'nessuno'}`);
}
