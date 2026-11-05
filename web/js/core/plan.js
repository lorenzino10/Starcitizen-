// PIANIFICATORE DI NAVIGAZIONE OPERATIVA (Fasi 4 e 5).
//
// Domande a cui risponde: da dove partire, quali salti fare, quando interrompere,
// quanto si resta lontani dal punto P, quanto tempo serve.
//
// Strategie esaminate (tutte esatte geometricamente, nessuna approssimazione numerica):
//  S1 "una interruzione":  [partenza ->] A (salti completi, Dijkstra) -> salto A->B interrotto in C -> volo convenzionale C->P
//  S0 "diretta":           partenza libera -> salto verso M interrotto -> volo convenzionale
//  S2 "due interruzioni":  [partenza ->] A -> salto A->B interrotto in C1 -> nuovo salto C1->M interrotto in C2 -> volo
//                          C1 e' scelto in modo che la retta C1->M passi il piu' vicino possibile a P.
//                          Richiede di avviare un salto QT da spazio profondo (vedi opts.deepSpace).
//
// Livelli di evidenza di ogni tratta (mai promossi automaticamente):
//  gioco     -> l'hai provata e segnata tu                              => "Verificata nel gioco"
//  dati      -> marker QT da fonte dati, nessun ostacolo noto            => "Supportata"
//  fonti     -> comportamento documentato da fonti terze (spazio profondo) => "Supportata"
//  geometria -> solo calcolo (dati incompleti, ostacolo incerto, marker in superficie/al centro) => "Teorica"
// Modalita' operativa: solo Verificata/Supportata, mai tratte bloccate o segnate non disponibili.
// Modalita' geometrica: tutto, con lo stato bene indicato.
import { projectPointOnSegment } from './geometry.js';
import { add, distance, scale, sub } from './vector.js';
import { checkObstructions, STATUS } from './qt.js';
import { surfaceBody } from './reverse.js';
import { DEFAULT_HUD, planDrop } from './hud.js';
import { convTime, dropState, jumpTime } from './qtdrive.js';
import { dijkstraDense, pathTo, systemsPath } from './navgraph.js';

export const EVIDENCE = {
  gioco: 'provata da te in gioco',
  dati: 'marker QT da fonte dati, nessun ostacolo noto',
  fonti: 'comportamento documentato da fonti terze, non provato da te',
  geometria: 'solo calcolo geometrico',
};
const EV_RANK = { gioco: 0, dati: 1, fonti: 1, geometria: 2 };
const EV_STATUS = { gioco: STATUS.VERIFIED, dati: STATUS.DATA, fonti: STATUS.DATA, geometria: STATUS.THEORETICAL };

export const CRITERIA = {
  residuo: 'Minima distanza residua',
  tempo: 'Minimo tempo di viaggio',
  operativo: 'Migliore raggiungibilità operativa',
};
export const STRATEGY = {
  S0: 'Salto diretto dalla posizione attuale',
  S1: 'Una interruzione',
  S2: 'Due interruzioni (avvicinamento in due fasi)',
};

export const DEFAULT_OPTS = {
  mode: 'operativa',          // 'operativa' | 'geometrica'
  criterion: 'residuo',       // 'residuo' | 'tempo' | 'operativo'
  allowTwoStage: true,
  kNear: 40,                  // marker piu' vicini a P usati come destinazione della seconda fase
  pool2: 3000,                // candidati a due interruzioni conservati (i migliori per residuo nominale)
  poolOperativo: 300,         // candidati accettati prima dell'ordinamento "operativo"
  maxEvaluations: 40000,      // limite di candidati valutati in dettaglio
  deepSpace: 'fonti',         // 'fonti' | 'verificato' | 'escluso'
  includeBlocked: false,
  limit: 30,
  drive: null,                // {vmax, ve, a1, a2} m/s, m/s^2
  prep: null,                 // s, spool + calibrazione + allineamento
  conv: null,                 // {v, a} m/s, m/s^2
  reaction: null,             // {min, max} s
  hud: DEFAULT_HUD,
  maxFinal: null,             // m, distanza finale accettabile (criterio operativo)
  jpTransit: null,            // s, transito in un jump point
  minJump: null,              // m, distanza minima di un salto QT (se nota)
};

/** Contesto di un sistema: marker QT, ostacoli, tratte verificate/non disponibili, cache. */
export function buildContext(system, points, model, { verified = new Set(), unavailable = new Set() } = {}) {
  const markers = points.filter((p) => p.qtValid);
  const n = markers.length;
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  markers.forEach((p, i) => { X[i] = p.pos.x; Y[i] = p.pos.y; Z[i] = p.pos.z; });
  return {
    system, markers, model, verified, unavailable, X, Y, Z,
    index: new Map(markers.map((p, i) => [p.key, i])),
    surface: markers.map((p) => surfaceBody(p.pos, model)),
    obs: new Map(), // ostacoli per coppia non ordinata di marker (simmetrici)
  };
}

const node = (ctx, i) => ({ kind: 'marker', idx: i, key: ctx.markers[i].key, name: ctx.markers[i].name, pos: ctx.markers[i].pos });
const freeNode = (pos, name, kind = 'free') => ({ kind, idx: -1, key: null, name, pos });

function obstructions(ctx, from, to) {
  if (from.kind === 'marker' && to.kind === 'marker') {
    const k = from.idx < to.idx ? `${from.idx}|${to.idx}` : `${to.idx}|${from.idx}`;
    let o = ctx.obs.get(k);
    if (!o) { o = checkObstructions(from.pos, to.pos, ctx.model); ctx.obs.set(k, o); }
    return o;
  }
  return checkObstructions(from.pos, to.pos, ctx.model);
}

/** Stato e ammissibilita' di un salto QT from->to (to e' sempre un marker QT). */
export function legStatus(ctx, from, to, opts) {
  const obs = obstructions(ctx, from, to);
  const notes = [];
  const pairKey = from.key && to.key ? `${from.key}|${to.key}` : null;
  const verified = pairKey ? ctx.verified.has(pairKey) : false;
  const unavailable = pairKey ? ctx.unavailable.has(pairKey) : false;
  const hard = obs.filter((o) => !o.uncertain);
  const blocked = hard.length > 0 && !verified;
  if (hard.length) notes.push(`${verified ? 'Il modello la considera ostruita' : 'Bloccata'} da ${hard.map((o) => o.body).join(', ')} (stima con margine ×${ctx.model.margin}).`);
  if (unavailable) notes.push('Segnata da te come NON disponibile in gioco.');
  let evidence;
  if (verified) { evidence = 'gioco'; notes.push('Tratta provata in gioco e segnata da te.'); }
  else {
    let ok = true;
    if (from.kind !== 'marker') {
      evidence = opts.deepSpace === 'verificato' ? 'gioco' : 'fonti';
      notes.push(opts.deepSpace === 'verificato'
        ? 'Salto da una posizione libera: capacità che hai verificato in gioco.'
        : 'Salto da una posizione libera (spazio profondo): pratica documentata da fonti terze, non ancora provata da te.');
    } else evidence = 'dati';
    if (!ctx.model.complete) { ok = false; notes.push(`Dati sui corpi celesti incompleti${ctx.model.missing?.length ? ` (mancano: ${ctx.model.missing.slice(0, 6).join(', ')}${ctx.model.missing.length > 6 ? '…' : ''})` : ''}: ostacoli non verificabili.`); }
    const unc = obs.filter((o) => o.uncertain);
    if (unc.length) { ok = false; notes.push(`Possibile ostacolo con dati incerti: ${unc.map((o) => o.body).join(', ')}.`); }
    for (const nd of [from, to]) {
      const sb = nd.kind === 'marker' ? ctx.surface[nd.idx] : null;
      if (!sb) continue;
      ok = false;
      notes.push(sb.kind === 'centro'
        ? `${nd.name} coincide con il centro di ${sb.body}: in gioco il salto termina prima, alla distanza di arrivo del marker orbitale.`
        : `${nd.name} è sulla superficie di ${sb.body}, che ruota: la posizione reale cambia nel tempo.`);
    }
    if (!ok) evidence = 'geometria';
  }
  const deepExcluded = from.kind !== 'marker' && opts.deepSpace === 'escluso';
  if (deepExcluded) notes.push('Salti da posizione libera esclusi nelle impostazioni.');
  const status = EV_STATUS[evidence];
  const operational = !blocked && !unavailable && !deepExcluded && status !== STATUS.THEORETICAL;
  return { status, evidence, notes, blocked, unavailable, operational, obstructions: obs };
}

const allowed = (st, opts) => (opts.mode === 'operativa' ? st.operational : (!st.blocked || opts.includeBlocked));

function legTime(L, opts, prep = true) {
  const t = jumpTime(L, opts.drive);
  return t === null ? null : t + (prep && opts.prep ? opts.prep : 0);
}

/**
 * Dijkstra dalla partenza a tutti i marker (salti completi ammessi dalla modalita').
 * Peso: tempo (criterio "tempo" con velocita' QT nota) altrimenti distanza.
 */
function prefixGraph(ctx, start, opts) {
  const n = ctx.markers.length;
  const sIdx = start.kind === 'marker' ? start.idx : n;
  const N = start.kind === 'marker' ? n : n + 1;
  const useTime = opts.criterion === 'tempo' && opts.drive?.vmax > 0;
  const nodeOf = (u) => (u === n ? start : node(ctx, u));
  const cache = new Map();
  const weight = (u, v) => {
    if (v === n) return Infinity; // non si salta verso una posizione libera
    const k = `${u}>${v}`;
    let w = cache.get(k);
    if (w !== undefined) return w;
    const a = nodeOf(u), b = nodeOf(v);
    const L = distance(a.pos, b.pos);
    if (opts.minJump && L < opts.minJump) w = Infinity;
    else w = allowed(legStatus(ctx, a, b, opts), opts) ? (useTime ? legTime(L, opts) : L) : Infinity;
    cache.set(k, w);
    return w;
  };
  const { dist, prev } = dijkstraDense(N, sIdx, weight);
  return { dist, prev, sIdx, n, nodeOf };
}

function prefixSteps(ctx, pg, aIdx, opts) {
  const seq = pathTo(pg.prev, pg.sIdx, aIdx);
  const steps = [];
  for (let i = 1; i < seq.length; i++) steps.push(fullJump(ctx, pg.nodeOf(seq[i - 1]), pg.nodeOf(seq[i]), opts));
  return steps;
}

function fullJump(ctx, a, b, opts) {
  const st = legStatus(ctx, a, b, opts);
  const L = distance(a.pos, b.pos);
  return { kind: 'qt', system: ctx.system, from: a, to: b, length: L, ...st, time: legTime(L, opts) };
}

function dropJump(ctx, a, b, dropPoint, h0, res0, opts) {
  const st = legStatus(ctx, a, b, opts);
  const L = distance(a.pos, b.pos);
  const travel = L - h0;
  const ds = dropState(travel, L, opts.drive);
  const hud = planDrop({ h0, res0, legLength: L, hud: opts.hud, speed: ds?.speed ?? null, reaction: opts.reaction });
  return {
    kind: 'qt-drop', system: ctx.system, from: a, to: b, length: L, travel, h0, dropPoint, hud, ...st,
    speedAtDrop: ds?.speed ?? null, phaseAtDrop: ds?.phase ?? null,
    time: ds ? ds.time + (opts.prep ?? 0) : null,
  };
}

function convStep(ctx, from, to, opts) {
  const d = distance(from, to);
  const ct = opts.conv ? convTime(d, opts.conv.v, opts.conv.a) : null;
  return { kind: 'conv', system: ctx.system, from, to, length: d, time: ct?.time ?? null, lowerBound: ct?.lowerBound ?? false };
}

// ---------------------------------------------------------------------------- candidati

/** S1 (e S0 da partenza libera): tutte le coppie, in entrambi i versi. */
function collectSingle(ctx, P, start, pg, opts, out) {
  const { markers } = ctx;
  const n = markers.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const proj = projectPointOnSegment(markers[i].pos, markers[j].pos, P);
      if (proj.t <= 0 || proj.t >= 1) continue;
      const L = distance(markers[i].pos, markers[j].pos);
      for (const [a, b, tA] of [[i, j, proj.t], [j, i, 1 - proj.t]]) {
        if (pg && pg.dist[a] === Infinity) continue;
        out.push({ type: 'S1', a, b, res: proj.distance, h0: (1 - tA) * L, drop: proj.point, L, pre: pg ? pg.dist[a] : 0 });
      }
    }
  }
  if (start && start.kind !== 'marker') {
    for (let j = 0; j < n; j++) {
      const proj = projectPointOnSegment(start.pos, markers[j].pos, P);
      if (proj.t <= 0 || proj.t >= 1) continue;
      const L = distance(start.pos, markers[j].pos);
      out.push({ type: 'S0', a: -1, b: j, res: proj.distance, h0: (1 - proj.t) * L, drop: proj.point, L, pre: 0 });
    }
  }
}

/**
 * S2: per ogni marker M fra i piu' vicini a P, il punto C1 della tratta A-B tale che la retta C1->M
 * passi il piu' vicino possibile a P. Forma chiusa: le direzioni da M verso i punti di AB stanno
 * nel piano (M, A, B); la direzione piu' vicina a u = (P-M)/|P-M| e' la proiezione di u su quel
 * piano. Residuo = |P-M|·sin(theta), con sin(theta) = |u·n| (n normale al piano).
 */
function collectTwoStage(ctx, P, start, pg, opts, out) {
  const { markers, X, Y, Z } = ctx;
  const n = markers.length;
  const near = markers.map((m, i) => [i, distance(m.pos, P)]).sort((a, b) => a[1] - b[1]).slice(0, opts.kNear);
  const firstLegs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) firstLegs.push([i, j]);
  if (start && start.kind !== 'marker') for (let j = 0; j < n; j++) firstLegs.push([-1, j]);
  const px = P.x, py = P.y, pz = P.z;
  const sx = start?.pos.x ?? 0, sy = start?.pos.y ?? 0, sz = start?.pos.z ?? 0;
  const cand = [];
  let threshold = Infinity;
  for (const [m, dPM] of near) {
    if (dPM === 0) continue;
    const mx = X[m], my = Y[m], mz = Z[m];
    const ux = (px - mx) / dPM, uy = (py - my) / dPM, uz = (pz - mz) / dPM;
    for (const [i, j] of firstLegs) {
      if (i === m || j === m) continue;
      const ax = i < 0 ? sx : X[i], ay = i < 0 ? sy : Y[i], az = i < 0 ? sz : Z[i];
      const bx = X[j], by = Y[j], bz = Z[j];
      // a = A-M, b = B-M, normale n = a x b
      const a1 = ax - mx, a2 = ay - my, a3 = az - mz, b1 = bx - mx, b2 = by - my, b3 = bz - mz;
      let n1 = a2 * b3 - a3 * b2, n2 = a3 * b1 - a1 * b3, n3 = a1 * b2 - a2 * b1;
      const nn = Math.hypot(n1, n2, n3);
      if (nn === 0) continue;
      n1 /= nn; n2 /= nn; n3 /= nn;
      const un = ux * n1 + uy * n2 + uz * n3;
      const res = dPM * Math.abs(un);
      if (res >= threshold) continue;
      let w1 = ux - un * n1, w2 = uy - un * n2, w3 = uz - un * n3;
      const wn = Math.hypot(w1, w2, w3);
      if (wn < 1e-12) continue;
      w1 /= wn; w2 /= wn; w3 /= wn;
      // A + t·d = M + λ·w  ->  t = ((M-A) x w)·n / ((d x w)·n)
      const d1 = bx - ax, d2 = by - ay, d3 = bz - az;
      const den = (d2 * w3 - d3 * w2) * n1 + (d3 * w1 - d1 * w3) * n2 + (d1 * w2 - d2 * w1) * n3;
      if (den === 0) continue;
      const m1 = -a1, m2 = -a2, m3 = -a3;
      const t = ((m2 * w3 - m3 * w2) * n1 + (m3 * w1 - m1 * w3) * n2 + (m1 * w2 - m2 * w1) * n3) / den;
      if (!(t > 0 && t < 1)) continue; // estremi = strategia a una interruzione, gia' esaminata
      const c1 = ax + t * d1 - mx, c2 = ay + t * d2 - my, c3 = az + t * d3 - mz;
      const lam = c1 * w1 + c2 * w2 + c3 * w3; // = |C1-M|
      const h2 = dPM * wn; // = |P-M|·cos(theta): distanza HUD verso M all'uscita
      if (!(lam > h2)) continue; // P deve stare fra C1 e M
      if (opts.minJump && lam < opts.minJump) continue;
      cand.push({ type: 'S2', a: i, b: j, m, t, res, h2, L2: lam, C1: { x: mx + c1, y: my + c2, z: mz + c3 } });
      if (cand.length > 2 * opts.pool2) {
        cand.sort((p, q) => p.res - q.res);
        cand.length = opts.pool2;
        threshold = cand[cand.length - 1].res;
      }
    }
  }
  cand.sort((p, q) => p.res - q.res);
  if (cand.length > opts.pool2) cand.length = opts.pool2;
  for (const c of cand) {
    const A = c.a < 0 ? start.pos : markers[c.a].pos, B = markers[c.b].pos;
    const L = distance(A, B);
    // due versi della prima tratta (A->B e B->A): stesso C1, lettura HUD e tempi diversi
    if (!(c.a >= 0 && pg && pg.dist[c.a] === Infinity)) out.push({ ...c, L, h0: (1 - c.t) * L, pre: c.a < 0 ? 0 : (pg ? pg.dist[c.a] : 0) });
    if (c.a >= 0 && !(pg && pg.dist[c.b] === Infinity)) out.push({ ...c, a: c.b, b: c.a, t: 1 - c.t, L, h0: c.t * L, pre: pg ? pg.dist[c.b] : 0 });
  }
}

// ---------------------------------------------------------------------------- piani

function quickKey(c, opts) {
  if (opts.criterion !== 'tempo' || !(opts.drive?.vmax > 0) || !(opts.conv?.v > 0)) return c.res;
  // stima rapida per il preordinamento: salti a velocita' massima, poi dettaglio esatto
  const v = opts.drive.vmax;
  const travel = c.type === 'S2' ? (c.L - c.h0) + (c.L2 - c.h2) : c.L - c.h0;
  return (c.pre || 0) + travel / v + c.res / opts.conv.v;
}

/** Errore sul residuo della strategia S2 se la prima uscita non viene corretta con /showlocation. */
function twoStageWorst(P, A, B, M, s1, s2) {
  const dirAB = scale(sub(B, A), 1 / distance(A, B));
  let worst = 0;
  for (const h1 of s1.hud.reaction?.interval ?? s1.hud.roundingInterval) {
    const C1 = sub(B, scale(dirAB, h1));
    const dir = scale(sub(C1, M), 1 / distance(C1, M));
    for (const h2 of s2.hud.reaction?.interval ?? s2.hud.roundingInterval) worst = Math.max(worst, distance(add(M, scale(dir, h2)), P));
  }
  return worst;
}

function finalize(ctx, P, plan, opts, prefix = []) {
  const steps = [...prefix, ...plan.steps];
  const qtSteps = steps.filter((s) => s.kind === 'qt' || s.kind === 'qt-drop');
  const evidenceSteps = steps.filter((s) => s.evidence);
  const worstEv = evidenceSteps.reduce((w, s) => (EV_RANK[s.evidence] > EV_RANK[w] ? s.evidence : w), 'gioco');
  const missing = new Set();
  let total = 0, lowerBound = false;
  for (const s of steps) {
    if (s.time === null || s.time === undefined) {
      if (s.kind === 'conv') missing.add('velocità in volo convenzionale');
      else if (s.kind === 'jump') missing.add('tempo di transito nel jump point');
      else missing.add('velocità QT del drive');
    } else total += s.time;
    if (s.kind === 'conv' && s.lowerBound) lowerBound = true;
  }
  if (opts.drive?.vmax > 0 && !(opts.drive.a1 > 0)) lowerBound = true;
  const excludes = qtSteps.length && !opts.prep ? ['preparazione del salto (spool/calibrazione)'] : [];
  return {
    ...plan, steps,
    system: ctx.system,
    departure: steps[0]?.from ?? null,
    qtDistance: qtSteps.reduce((s, x) => s + (x.kind === 'qt' ? x.length : x.travel), 0),
    jumps: qtSteps.length,
    drops: steps.filter((s) => s.kind === 'qt-drop').length,
    evidence: worstEv,
    status: EV_STATUS[worstEv],
    operational: steps.every((s) => !s.evidence || s.operational),
    blocked: steps.some((s) => s.blocked),
    time: { total: missing.size ? null : total, partial: total, missing: [...missing], lowerBound, excludes },
  };
}

function buildPlan(ctx, P, c, start, pg, opts) {
  const pre = c.a >= 0 && pg ? prefixSteps(ctx, pg, c.a, opts) : [];
  const A = c.a < 0 ? start : node(ctx, c.a);
  const B = node(ctx, c.b);
  if (c.type === 'S0' || c.type === 'S1') {
    const drop = dropJump(ctx, A, B, c.drop, c.h0, c.res, opts);
    if (!allowed(drop, opts) || pre.some((s) => !allowed(s, opts))) return null;
    return {
      strategy: STRATEGY[c.type], type: c.type, target: P,
      steps: [...pre, drop, convStep(ctx, c.drop, P, opts)],
      arrival: c.drop, residual: c.res, residualWorst: drop.hud.worst,
      worstIncludesReaction: drop.hud.worstIncludesReaction, residualRefined: null,
    };
  }
  // S2
  const C1node = freeNode(c.C1, 'Prima interruzione (C1)', 'drop');
  const s1 = dropJump(ctx, A, B, c.C1, c.h0, 0, opts);
  const M = node(ctx, c.m);
  const dirMC1 = scale(sub(c.C1, M.pos), 1 / c.L2);
  const C2 = add(M.pos, scale(dirMC1, c.h2));
  const s2 = dropJump(ctx, C1node, M, C2, c.h2, c.res, opts);
  if (![...pre, s1, s2].every((s) => allowed(s, opts))) return null;
  return {
    strategy: STRATEGY.S2, type: 'S2', target: P,
    steps: [...pre, s1, s2, convStep(ctx, C2, P, opts)],
    arrival: C2, residual: c.res,
    residualWorst: twoStageWorst(P, A.pos, B.pos, M.pos, s1, s2),
    residualRefined: s2.hud.worst,
    worstIncludesReaction: s1.hud.worstIncludesReaction && s2.hud.worstIncludesReaction,
  };
}

function compare(opts) {
  const thr = opts.maxFinal ?? Infinity;
  const t = (p) => (p.time.total ?? Infinity);
  const sec = (p) => (p.time.total ?? p.qtDistance);
  switch (opts.criterion) {
    case 'tempo': return (a, b) => t(a) - t(b) || a.residual - b.residual;
    case 'operativo': return (a, b) => (EV_RANK[a.evidence] - EV_RANK[b.evidence])
      || ((a.residualWorst > thr) - (b.residualWorst > thr))
      || (a.residualWorst - b.residualWorst) || (a.drops - b.drops) || (a.jumps - b.jumps) || (sec(a) - sec(b));
    default: return (a, b) => a.residual - b.residual || a.residualWorst - b.residualWorst || a.qtDistance - b.qtDistance;
  }
}

/**
 * Pianificazione in un solo sistema.
 * @param {object} ctx   contesto (buildContext)
 * @param {{x,y,z}} P    bersaglio (m, frame del sistema)
 * @param {{pos,name,key?}|null} start  partenza facoltativa nello stesso sistema
 * @param {object} opts  DEFAULT_OPTS
 * @param {object[]} prefix passi gia' fatti in altri sistemi (jump point)
 */
export function planInSystem(ctx, P, start, opts, prefix = []) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const t0 = Date.now();
  let st = null;
  if (start) {
    const idx = start.key ? ctx.index.get(start.key) : undefined;
    st = idx !== undefined ? node(ctx, idx) : freeNode(start.pos, start.name);
  }
  const pg = st ? prefixGraph(ctx, st, o) : null;
  const cands = [];
  collectSingle(ctx, P, st, pg, o, cands);
  const nSingle = cands.length;
  if (o.allowTwoStage && o.deepSpace !== 'escluso') collectTwoStage(ctx, P, st, pg, o, cands);
  for (const c of cands) c.q = quickKey(c, o);
  cands.sort((a, b) => a.q - b.q);
  const plans = [];
  const target = o.criterion === 'operativo' ? o.poolOperativo : o.criterion === 'tempo' ? o.limit * 4 : o.limit * 2;
  let evaluated = 0, rejected = 0;
  for (const c of cands) {
    if (plans.length >= target || evaluated >= o.maxEvaluations) break;
    evaluated++;
    const p = buildPlan(ctx, P, c, st, pg, o);
    if (!p) { rejected++; continue; }
    plans.push(finalize(ctx, P, p, o, prefix));
  }
  plans.sort(compare(o));
  let nearest = null;
  ctx.markers.forEach((m, i) => { const d = distance(m.pos, P); if (!nearest || d < nearest.distance) nearest = { idx: i, name: m.name, pos: m.pos, distance: d }; });
  return {
    plans: plans.slice(0, o.limit),
    stats: { markers: ctx.markers.length, singleCandidates: nSingle, twoStageCandidates: cands.length - nSingle, evaluated, rejected, ms: Date.now() - t0 },
    nearest, start: st,
  };
}

/**
 * Pianificazione completa, anche fra sistemi diversi.
 * input: {contexts:{sys:ctx}, links, target:{system,pos,name}, start:{system,pos,name,key}|null, opts}
 */
export function planRoutes({ contexts, links = [], target, start = null, opts = {} }) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const ctxT = contexts[target.system];
  if (!ctxT || !ctxT.markers.length) return { error: `Nessun marker QT in archivio per ${target.system}.`, plans: [] };
  const prefix = [];
  const notes = [];
  let localStart = start;
  if (start && start.system !== target.system) {
    const sysPath = systemsPath(links, start.system, target.system);
    if (!sysPath) return { error: `Nessun collegamento noto fra ${start.system} e ${target.system} nei dati caricati (servono le stazioni Gateway in entrambi i sistemi).`, plans: [] };
    let cur = start;
    for (const link of sysPath) {
      const ctx = contexts[link.from];
      if (!ctx) return { error: `Dati di ${link.from} non caricati.`, plans: [] };
      const exitIdx = ctx.index.get(link.exit.key);
      const idx = cur.key ? ctx.index.get(cur.key) : undefined;
      const st = idx !== undefined ? node(ctx, idx) : freeNode(cur.pos, cur.name);
      if (exitIdx !== st.idx || st.kind !== 'marker') {
        const pg = prefixGraph(ctx, st, o);
        if (pg.dist[exitIdx] === Infinity) return { error: `In ${link.from} nessun percorso ammesso (modalità ${o.mode}) fino a ${link.exit.name}.`, plans: [] };
        prefix.push(...prefixSteps(ctx, pg, exitIdx, o));
      }
      prefix.push({
        kind: 'jump', system: link.from, toSystem: link.to, from: { name: link.exit.name, pos: link.exit.pos, key: link.exit.key },
        to: { name: link.entry.name, pos: link.entry.pos, key: link.entry.key },
        evidence: link.evidence, status: EV_STATUS[link.evidence], operational: link.evidence !== 'geometria',
        blocked: false, notes: link.notes, time: o.jpTransit ?? null, length: 0,
      });
      notes.push(...link.notes);
      cur = { system: link.to, key: link.entry.key, name: link.entry.name, pos: link.entry.pos };
    }
    localStart = cur;
  }
  const res = planInSystem(ctxT, target.pos, localStart, o, prefix);
  return { ...res, notes, interstellar: prefix.some((s) => s.kind === 'jump') };
}

/** Correzione in volo: due posizioni /showlocation lette a distanza di qualche secondo. */
export function inFlightCorrection(p1, p2, target) {
  const v = sub(p2, p1);
  const traveled = distance(p1, p2);
  const toT = sub(target, p2);
  const dist = distance(p2, target);
  if (traveled === 0) return { traveled, distance: dist, angle: null, closest: null, along: null };
  const along = (v.x * toT.x + v.y * toT.y + v.z * toT.z) / traveled; // avanzamento utile fino al punto di minima distanza
  const cos = Math.max(-1, Math.min(1, along / (dist || 1)));
  const closest = along > 0 ? Math.sqrt(Math.max(0, dist * dist - along * along)) : dist;
  return { traveled, distance: dist, angle: (Math.acos(cos) * 180) / Math.PI, closest, along: Math.max(0, along) };
}
