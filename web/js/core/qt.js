// Tratte quantiche verso un bersaglio arbitrario (stesso modello della versione Python).
//  - tratta QT = segmento S->D; il pilota puo' interrompere ovunque sul segmento
//  - punto di interruzione C = proiezione del bersaglio P sul segmento (t in [0,1])
//  - l'HUD mostra la distanza verso D: valore da attendere |D-C|
//  - dopo l'interruzione: volo convenzionale |P-C|
// Una retta geometricamente possibile NON e' una rotta disponibile: ogni tratta e' classificata.
import { projectPointOnSegment } from './geometry.js';
import { distance } from './vector.js';

export const STATUS = {
  VERIFIED: 'Verificata nel gioco',
  DATA: 'Supportata dai dati di navigazione',
  THEORETICAL: 'Teorica, da verificare',
};

/**
 * Corpi il cui volume (raggio x margine) interseca il segmento A->B.
 * Se un estremo e' dentro il volume (avamposto in superficie, stazione bassa) il raggio
 * si riduce a 0,999 x la distanza dell'estremo dal centro: allontanarsi dalla superficie
 * e' consentito, attraversare il pianeta no.
 * model: {bodies:[{name, center, radius, uncertain}], margin, complete}
 */
export function checkObstructions(a, b, model) {
  const hits = [];
  for (const body of model.bodies) {
    const r = Math.min(body.radius * model.margin,
      0.999 * distance(a, body.center), 0.999 * distance(b, body.center));
    if (r <= 0) continue;
    const d = projectPointOnSegment(a, b, body.center).distance;
    if (d < r) hits.push({ body: body.name, clearance: d - r, uncertain: !!body.uncertain });
  }
  return hits;
}

export function classify(start, dest, obstructions, model, verified) {
  if (verified) return { status: STATUS.VERIFIED, notes: ['Tratta segnata come provata in gioco.'] };
  const notes = [];
  let ok = true;
  if (!dest.qtValid) { ok = false; notes.push("La destinazione non e' indicata come marker QT dalla fonte dati."); }
  if (!start.qtValid) { ok = false; notes.push("La partenza non e' un marker QT noto: la tratta parte da una posizione libera."); }
  if (!model.complete) { ok = false; notes.push('Dati sui corpi celesti incompleti per questo sistema: ostacoli non verificabili.'); }
  if (obstructions.some((o) => o.uncertain)) { ok = false; notes.push('Possibile ostacolo con dati in conflitto fra fonti.'); }
  return { status: ok ? STATUS.DATA : STATUS.THEORETICAL, notes };
}

/** Valuta la tratta start->dest come mezzo per avvicinarsi a target. */
export function evaluateLeg(start, dest, target, model, verified = false) {
  const proj = projectPointOnSegment(start.pos, dest.pos, target);
  const obstructions = checkObstructions(start.pos, dest.pos, model);
  const { status, notes } = classify(start, dest, obstructions, model, verified);
  const r = {
    start, dest, target,
    legLength: distance(start.pos, dest.pos),
    t: proj.t, tUnclamped: proj.tUnclamped, dropPoint: proj.point,
    qtTravel: distance(start.pos, proj.point),
    hudRemaining: distance(proj.point, dest.pos),
    residual: proj.distance,
    direct: distance(start.pos, target),
    status, notes, obstructions,
  };
  r.gain = r.direct - r.residual;
  r.needsDrop = r.t > 0 && r.t < 1;
  r.blocked = obstructions.some((o) => !o.uncertain);
  if (r.t >= 1) notes.push("Il bersaglio e' oltre la destinazione: nessuna interruzione, si arriva a destinazione.");
  if (r.t <= 0) notes.push("Il bersaglio e' alle spalle: questa tratta non avvicina.");
  return r;
}

/**
 * Valuta tutte le destinazioni candidate. Ordine: residuo convenzionale crescente,
 * poi distanza QT. Escluse le tratte senza guadagno e, salvo includeBlocked, quelle bloccate.
 */
export function rankCandidates(start, target, candidates, model, verifiedPairs = new Set(), includeBlocked = false) {
  const out = [];
  for (const d of candidates) {
    if (d.key === start.key) continue;
    const r = evaluateLeg(start, d, target, model, verifiedPairs.has(`${start.key}|${d.key}`));
    if (r.gain <= 0) continue;
    if (r.blocked && !includeBlocked) continue;
    out.push(r);
  }
  out.sort((a, b) => (a.blocked - b.blocked) || (a.residual - b.residual) || (a.qtTravel - b.qtTravel));
  return out;
}
