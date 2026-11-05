// RICERCA INVERSA QT
// Dato un punto P qualsiasi, esamina tutte le tratte A->B fra i punti QT noti del sistema e
// le ordina per distanza minima segmento-P, cioe' per volo convenzionale residuo.
// A->B e B->A sono voci distinte: il punto di interruzione C e il residuo sono gli stessi,
// ma la distanza da leggere sull'HUD cambia (|B-C| oppure |A-C|).
//
// Cosa NON si sa e quindi non si afferma: nessuna fonte pubblica elenca i collegamenti QT
// realmente disponibili. Una coppia di marker QT selezionabili senza ostacoli noti e' al
// massimo "Supportata dai dati"; diventa "Verificata" solo se l'hai segnata tu dopo averla provata.
import { projectPointOnSegment } from './geometry.js';
import { checkObstructions, classify, STATUS } from './qt.js';
import { distance } from './vector.js';

/**
 * @param {{key,name,pos,qtValid}[]} qtPoints  punti QT del sistema (devono avere qtValid=true)
 * @param {{x,y,z}} target                     punto desiderato P (m)
 * @param {object} model                       modello ostacoli {bodies, margin, complete}
 * @param {{verifiedPairs?:Set<string>, includeBlocked?:boolean, limit?:number}} opts
 * @returns {{routes:object[], examined:number, blocked:number, endpointOnly:number, nearestMarker:object|null}}
 */
export function reverseSearch(qtPoints, target, model, opts = {}) {
  const { verifiedPairs = new Set(), includeBlocked = false, limit = 200 } = opts;
  const pts = qtPoints.filter((p) => p.qtValid);
  const surface = new Map(pts.map((p) => [p.key, surfaceBody(p.pos, model)]));
  const routes = [];
  let examined = 0, blocked = 0, endpointOnly = 0;
  const obsCache = new Map(); // ostacoli simmetrici: calcolati una volta per coppia non ordinata

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const A = pts[i], B = pts[j];
      const proj = projectPointOnSegment(A.pos, B.pos, target);
      examined += 2;
      // t = 0 o 1: il punto piu' vicino e' un estremo, quindi basta andare al marker: non e' una
      // interruzione. Questi casi finiscono nel riferimento "marker piu' vicino".
      if (proj.t <= 0 || proj.t >= 1) { endpointOnly += 2; continue; }
      const pairKey = `${A.key}|${B.key}`;
      if (!obsCache.has(pairKey)) obsCache.set(pairKey, checkObstructions(A.pos, B.pos, model));
      const obs = obsCache.get(pairKey);
      const isBlocked = obs.some((o) => !o.uncertain);
      if (isBlocked) blocked += 2;
      if (isBlocked && !includeBlocked) continue;
      const leg = distance(A.pos, B.pos);
      const fromA = proj.t * leg;
      for (const [from, to, fromStart] of [[A, B, fromA], [B, A, leg - fromA]]) {
        const verified = verifiedPairs.has(`${from.key}|${to.key}`);
        let { status, notes } = classify(from, to, obs, model, verified);
        for (const p of [from, to]) {
          const sb = surface.get(p.key);
          if (sb && !verified) {
            status = STATUS.THEORETICAL;
            notes = [...notes, sb.kind === 'centro'
              ? `${p.name} coincide con il centro di ${sb.body}: in gioco il salto si ferma prima, alla distanza di arrivo dell'orbital marker, quindi la geometria reale è diversa.`
              : `${p.name} è sulla superficie di ${sb.body}: il corpo ruota, quindi in gioco la posizione reale del marker cambia nel tempo.`];
          }
        }
        routes.push({
          from, to, legLength: leg,
          t: from === A ? proj.t : 1 - proj.t,
          dropPoint: proj.point,
          fromStart,                 // distanza da A al punto di interruzione
          hudRemaining: leg - fromStart, // distanza sull'HUD verso B al momento dell'interruzione
          residual: proj.distance,  // volo convenzionale residuo verso P
          status, notes: [...notes], obstructions: obs, blocked: isBlocked,
        });
      }
    }
  }
  // Priorita': residuo minimo. A parita' (A->B e B->A) prima la tratta QT piu' corta fino al drop.
  routes.sort((a, b) => (a.blocked - b.blocked) || (a.residual - b.residual) || (a.fromStart - b.fromStart));

  let nearestMarker = null;
  for (const p of pts) {
    const d = distance(p.pos, target);
    if (!nearestMarker || d < nearestMarker.distance) nearestMarker = { point: p, distance: d };
  }
  return { routes: routes.slice(0, limit), total: routes.length, examined, blocked, endpointOnly, nearestMarker };
}

/**
 * Corpo (non stella) su cui si trova pos: {body, kind:'centro'|'superficie'} oppure null.
 * 'centro' = marker del pianeta stesso; 'superficie' = entro il 5% del raggio. I punti in superficie ruotano con il corpo: le loro XYZ sono istantanee.
 */
export function surfaceBody(pos, model) {
  for (const b of model.bodies) {
    if (b.uncertain || /star/i.test(b.name)) continue;
    const d = distance(pos, b.center);
    if (d < b.radius * 0.5) return { body: b.name, kind: 'centro' };
    if (d < b.radius * 1.05) return { body: b.name, kind: 'superficie' };
  }
  return null;
}

/**
 * Controlli di plausibilita' del punto P rispetto ai dati del sistema.
 * @returns {{level:'err'|'warn', text:string}[]}
 */
export function targetWarnings(target, allPoints, model) {
  const out = [];
  for (const b of model.bodies) {
    if (b.uncertain) continue;
    const d = distance(target, b.center);
    if (d < b.radius) out.push({ level: 'err', text: `Il punto è DENTRO ${b.name} (a ${Math.round((b.radius - d) / 1000).toLocaleString('it-IT')} km sotto la superficie nominale).` });
  }
  if (!model.complete) out.push({ level: 'warn', text: 'Per questo sistema mancano i dati sui corpi celesti: non posso verificare se il punto è dentro un pianeta, né gli ostacoli sulle tratte.' });
  if (allPoints.length) {
    let rMax = 0;
    for (const p of allPoints) rMax = Math.max(rMax, Math.hypot(p.pos.x, p.pos.y, p.pos.z));
    const r = Math.hypot(target.x, target.y, target.z);
    if (r > rMax * 1.05) {
      out.push({ level: 'warn', text: `Il punto è a ${(r / 1e9).toFixed(2)} Gm dall'origine, oltre la regione coperta dai dati (punto noto più lontano: ${(rMax / 1e9).toFixed(2)} Gm). Controlla sistema stellare e unità di misura.` });
    }
  }
  return out;
}

/**
 * Ottimizzazione del percorso completo partendo dalla posizione attuale S:
 * S --QT--> A --QT--> C (interruzione) --volo convenzionale--> P.
 * Il tratto S->A e' un salto QT verso il marker A (in gioco si puo' saltare verso un marker da
 * qualunque posizione, se la linea non e' ostruita).
 * Se sono note entrambe le velocita' ordina per tempo stimato, altrimenti per distanza QT totale
 * fra le rotte con residuo entro la soglia indicata.
 */
export function completePath(start, routes, model, { qtSpeed = 0, convSpeed = 0, maxResidual = Infinity } = {}) {
  const out = [];
  for (const r of routes) {
    if (r.residual > maxResidual) continue;
    const sameAsStart = start.key && start.key === r.from.key;
    const toA = sameAsStart ? 0 : distance(start.pos, r.from.pos);
    const obsToA = sameAsStart ? [] : checkObstructions(start.pos, r.from.pos, model);
    if (obsToA.some((o) => !o.uncertain)) continue;
    const qtTotal = toA + r.fromStart;
    const time = qtSpeed > 0 && convSpeed > 0 ? qtTotal / qtSpeed + r.residual / convSpeed : null;
    const notes = [];
    if (obsToA.some((o) => o.uncertain)) notes.push('Possibile ostacolo (dati in conflitto) sul salto verso A.');
    out.push({ ...r, toA, qtTotal, time, pathNotes: notes, pathStatus: obsToA.length || !model.complete ? STATUS.THEORETICAL : r.status });
  }
  out.sort((a, b) => (a.time !== null && b.time !== null ? a.time - b.time : a.qtTotal - b.qtTotal || a.residual - b.residual));
  return out;
}
