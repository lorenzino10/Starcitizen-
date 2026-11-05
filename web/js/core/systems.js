// COLLEGAMENTI FRA SISTEMI (jump point). Ogni sistema ha il proprio frame XYZ: le coordinate
// di sistemi diversi non vengono MAI combinate. Un jump point e' un arco logico del grafo.
// Nei dati CitizenHQ il lato di ogni jump point e' rappresentato dalla stazione "<Sistema> Gateway"
// (in Pyro: "Stanton Gateway", "Nyx Gateway"; in Nyx: "Pyro Gateway", "Stanton Gateway").
// La posizione esatta dell'ingresso del tunnel rispetto alla stazione non e' nei dati.
export const SYSTEM_NAMES = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };

/**
 * @param {{[sys:string]: {key,name}[]}} pointsBySystem
 * @returns {{from,to,exit,entry,usable,evidence,notes:string[]}[]} archi direzionali
 */
export function gatewayLinks(pointsBySystem) {
  const sysIds = Object.keys(SYSTEM_NAMES);
  const find = (sys, other) => (pointsBySystem[sys] ?? []).find((p) => p.name.trim().toLowerCase() === `${SYSTEM_NAMES[other]} gateway`.toLowerCase());
  const out = [];
  for (const a of sysIds) {
    for (const b of sysIds) {
      if (a === b) continue;
      const exit = find(a, b);
      if (!exit) continue;
      const entry = find(b, a);
      const loadedB = (pointsBySystem[b] ?? []).length > 0;
      const notes = [`Il tunnel parte vicino a ${exit.name}: la distanza fra stazione e ingresso del jump point non è nei dati.`];
      if (!loadedB) notes.push(`Dati di ${SYSTEM_NAMES[b]} non caricati: impossibile pianificare oltre il jump point.`);
      else if (!entry) notes.push(`In ${SYSTEM_NAMES[b]} manca la stazione "${SYSTEM_NAMES[a]} Gateway": punto di arrivo sconosciuto.`);
      out.push({ from: a, to: b, exit, entry: entry ?? null, usable: !!entry, evidence: entry ? 'dati' : 'geometria', notes });
    }
  }
  return out;
}
