// Corpi celesti per il controllo ostacoli. CitizenHQ non fornisce i raggi: seed locale
// estratto dal dataset community starmap.space (vedi docs/FONTI.md). Solo Stanton:
// per Pyro e Nyx il modello e' incompleto e le tratte risultano "Teoriche".
import { vec } from '../core/vector.js';
import { BODY_SEED } from './bodies_seed.js';

const UNCERTAIN = new Set(['Stanton Star']);

export const bodySeed = (system) => BODY_SEED[system] ?? null;

export function obstructionModel(system, margin = 1.2) {
  const seed = bodySeed(system);
  if (!seed) return { bodies: [], margin, complete: false };
  const bodies = [];
  for (const b of seed.bodies) {
    bodies.push({ name: b.name, center: vec(b.x, b.y, b.z), radius: b.body_radius_m, uncertain: UNCERTAIN.has(b.name) });
    if (b.name === 'Stanton Star') {
      // posizione alternativa secondo CitizenHQ: origine
      bodies.push({ name: 'Stanton Star (origine, CitizenHQ)', center: vec(0, 0, 0), radius: b.body_radius_m, uncertain: true });
    }
  }
  return { bodies, margin, complete: true };
}
