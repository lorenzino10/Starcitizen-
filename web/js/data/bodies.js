// Corpi celesti per il controllo ostacoli. CitizenHQ non fornisce i raggi.
//  - Stanton: seed locale estratto da starmap.space (posizioni e raggi), vedi docs/FONTI.md.
//  - Pyro e Nyx: POSIZIONI dai dati importati (CitizenHQ, frame del sistema), RAGGI da
//    starmap.space abbinati per nome. Le posizioni di starmap.space per Pyro non coincidono
//    con quelle di CitizenHQ (impostazione del sistema diversa): per questo si prende solo il raggio.
//  - La stella di Pyro e di Nyx non ha un raggio affidabile: e' un ostacolo "incerto" con raggio
//    prudenziale configurabile; non blocca mai una tratta, la rende soltanto "Teorica".
import { vec } from '../core/vector.js';
import { BODY_SEED } from './bodies_seed.js';

const UNCERTAIN = new Set(['Stanton Star']);

/** Raggi (m) da starmap.space (copia in ByteCollectiveIO/sc-nav poi/containers.json, 2026-11-03). */
export const RADII = {
  pyro: {
    'Pyro I': 411700, Monox: 529500, Bloom: 413900, 'Pyro IV': 321400, 'Pyro V': 7812300, Terminus: 285000,
    Vuur: 452830, Fuego: 465670, Fairo: 392240, Adir: 431000, Vatra: 365810, Ignis: 393170,
  },
  nyx: { Delamar: 65000 },
};
export const RADII_SOURCE = 'starmap.space via ByteCollectiveIO/sc-nav poi/containers.json (2026-11-03); solo raggi, le posizioni vengono da CitizenHQ';
/** Raggio prudenziale della stella per Pyro/Nyx: ipotesi (valore della stella di Stanton). */
export const DEFAULT_STAR_RADIUS = 696000000;

export const bodySeed = (system) => BODY_SEED[system] ?? null;

/**
 * Modello ostacoli. rows = posizioni importate del sistema (servono per Pyro e Nyx).
 * @returns {{bodies, margin, complete, missing:string[], discrepancies?:{name,offset}[], source:string}}
 */
export function obstructionModel(system, margin = 1.2, rows = [], { starRadius = DEFAULT_STAR_RADIUS } = {}) {
  const seed = bodySeed(system);
  if (seed) {
    const bodies = [], discrepancies = [];
    for (const b of seed.bodies) {
      // Il corpo esiste anche nei dati importati (CitizenHQ, stesso frame dei marker QT) ma in un
      // punto diverso: i marker in superficie stanno attorno alla posizione importata, quindi il
      // corpo si controlla li'; la posizione del seed resta come ostacolo INCERTO (mai ignorata).
      const row = rows.find((r) => /^(planet|moon)$/i.test(r.type ?? '') && r.name?.toLowerCase() === b.name.toLowerCase());
      const off = row ? Math.hypot(row.x - b.x, row.y - b.y, row.z - b.z) : 0;
      if (row && off > b.body_radius_m) {
        bodies.push({ name: b.name, center: vec(row.x, row.y, row.z), radius: b.body_radius_m, uncertain: false });
        bodies.push({ name: `${b.name} (posizione starmap.space, non concorde)`, center: vec(b.x, b.y, b.z), radius: b.body_radius_m, uncertain: true });
        discrepancies.push({ name: b.name, offset: off });
        continue;
      }
      bodies.push({ name: b.name, center: vec(b.x, b.y, b.z), radius: b.body_radius_m, uncertain: UNCERTAIN.has(b.name) });
      if (b.name === 'Stanton Star') {
        // posizione alternativa secondo CitizenHQ: origine
        bodies.push({ name: 'Stanton Star (origine, CitizenHQ)', center: vec(0, 0, 0), radius: b.body_radius_m, uncertain: true });
      }
    }
    return { bodies, margin, complete: true, missing: [], discrepancies, source: seed._meta.source };
  }
  const radii = RADII[system];
  if (!radii) return { bodies: [], margin, complete: false, missing: ['tutti i corpi celesti'], source: 'nessuna' };
  const bodies = [], missing = [];
  for (const r of rows) {
    if (!/^(planet|moon)$/i.test(r.type ?? '')) continue;
    const radius = radii[r.name];
    if (radius) bodies.push({ name: r.name, center: vec(r.x, r.y, r.z), radius, uncertain: false });
    else missing.push(r.name);
  }
  const star = rows.find((r) => /^star$/i.test(r.type ?? ''));
  bodies.push({ name: `${star?.name ?? system} (stella, raggio prudenziale)`, center: star ? vec(star.x, star.y, star.z) : vec(0, 0, 0), radius: starRadius, uncertain: true });
  return { bodies, margin, complete: missing.length === 0 && bodies.length > 1, missing, source: RADII_SOURCE };
}
