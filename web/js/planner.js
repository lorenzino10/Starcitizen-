// Servizi di pianificazione: uniscono archivio, dati e motore. L'interfaccia usa solo questi.
import { BANDS, bandCrossings } from './core/halo.js';
import { checkObstructions, classify, rankCandidates } from './core/qt.js';
import { distance, vec } from './core/vector.js';
import { obstructionModel } from './data/bodies.js';
import { reverseSearch, targetWarnings } from './core/reverse.js';

export const locKey = (row) => `citizenhq:${row.uuid}`;
export const cpKey = (cp) => `cp:${cp.id}`;

// Punti personali dal DATABASE PUNTI (IndexedDB): elenco in memoria aggiornato da ui-points.js.
// Solo le schede con coordinate complete diventano punti di navigazione.
let personal = [];
export function setPersonalPoints(list) { personal = list; }

/** Punti del sistema: posizioni importate + punti personali completi (mai QT). */
export function navPoints(store, system) {
  const pts = new Map();
  for (const r of store.locations(system)) {
    pts.set(locKey(r), { key: locKey(r), name: r.name, type: r.type, pos: vec(r.x, r.y, r.z), qtValid: r.qtValid });
  }
  for (const c of personal) {
    if (c.system !== system || !c.pos) continue;
    pts.set(cpKey(c), { key: cpKey(c), name: `★ ${c.name}`, type: 'Personale', pos: c.pos, qtValid: false, dbId: c.id });
  }
  return pts;
}

export function planToTarget(store, system, start, target, margin, includeBlocked = false) {
  const candidates = [...navPoints(store, system).values()].filter((p) => p.qtValid);
  const model = obstructionModel(system, margin, store.locations(system));
  return { results: rankCandidates(start, target, candidates, model, store.verifiedPairs(system), includeBlocked), model };
}

/**
 * Tratte da start che attraversano la fascia entro la sua altezza, ordinate per finestra
 * piu' ampia. Con destKey esplicito mostra anche attraversamenti fuori quota o bloccati, con nota.
 */
export function haloOptions(store, start, bandNo, margin, destKey = null) {
  const system = 'stanton';
  const pts = navPoints(store, system);
  const model = obstructionModel(system, margin);
  const verified = store.verifiedPairs(system);
  const dests = destKey ? [pts.get(destKey)].filter(Boolean) : [...pts.values()].filter((p) => p.qtValid);
  const out = [];
  for (const d of dests) {
    if (d.key === start.key) continue;
    for (const c of bandCrossings(start.pos, d.pos, BANDS[bandNo])) {
      if (!c.withinHeight && !destKey) continue;
      const obs = checkObstructions(start.pos, d.pos, model);
      const blocked = obs.some((o) => !o.uncertain);
      if (blocked && !destKey) continue;
      const { status, notes } = classify(start, d, obs, model, verified.has(`${start.key}|${d.key}`));
      if (!c.withinHeight) notes.push('La tratta attraversa il raggio della fascia ma fuori dalla sua altezza (sopra/sotto gli asteroidi).');
      if (blocked) notes.push('Tratta bloccata da un corpo celeste (stima).');
      out.push({ start, dest: d, crossing: c, legLength: distance(start.pos, d.pos), status, notes });
      break; // primo attraversamento nel verso di marcia
    }
  }
  return out.sort((a, b) => b.crossing.window - a.crossing.window);
}

/** RICERCA INVERSA QT sul sistema corrente: nessuna partenza obbligatoria. */
export function reverseFromStore(store, system, target, margin, { includeBlocked = false, limit = 200 } = {}) {
  const all = [...navPoints(store, system).values()];
  const model = obstructionModel(system, margin, store.locations(system));
  const res = reverseSearch(all.filter((p) => p.qtValid), target, model,
    { verifiedPairs: store.verifiedPairs(system), includeBlocked, limit });
  return { ...res, model, warnings: targetWarnings(target, all, model), qtCount: all.filter((p) => p.qtValid).length };
}
