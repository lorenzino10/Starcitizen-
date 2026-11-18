// HERCULES · PIANO DI CARICO — motore puro (nessun DOM), testabile con node --test.
//
// Idea: la stiva e' una griglia di celle da 1,25 m. Le casse della consegna PIU' LONTANA nel
// viaggio vanno in fondo (verso la prua), quelle della prima consegna vicino alla rampa e sopra.
// Ogni cassa viene posata solo se puo' uscire dalla rampa senza spostare casse di tappe successive
// (scorrendo verso la rampa, eventualmente dopo averla sollevata se sopra c'e' spazio libero).
// Se non c'e' posto "pulito" la cassa viene posata comunque e il piano dice cosa spostare.
//
// Assi (in celle): x = laterale (0 = sinistra guardando dalla rampa verso la prua),
// y = profondita' (0 = bordo rampa, cresce verso la prua), z = altezza (0 = pavimento).

export const CELL_M = 1.25;

/** Casse standard: dimensioni in celle [x, y, z] lette dai file di gioco (inventoryOccupancyDimensions). */
export const BOXES = {
  1: [1, 1, 1],   // 1,25 × 1,25 × 1,25 m
  2: [1, 2, 1],   // 1,25 × 2,5 × 1,25 m
  4: [2, 2, 1],   // 2,5 × 2,5 × 1,25 m
  8: [2, 2, 2],   // 2,5 × 2,5 × 2,5 m
  16: [2, 4, 2],  // 2,5 × 5 × 2,5 m
  24: [2, 6, 2],  // 2,5 × 7,5 × 2,5 m
  32: [2, 8, 2],  // 2,5 × 10 × 2,5 m
};
export const SIZES = [32, 24, 16, 8, 4, 2, 1];

export const SOURCE = {
  name: 'scunpacked-data (StarCitizenWiki), ships.json + items/carryable_tbo_fl_*scu_commodity_*.json',
  patch: '4.10.3-LIVE.13165946',
  url: 'https://github.com/StarCitizenWiki/scunpacked-data',
};

/**
 * Griglie di carico dai file di gioco. m = dimensioni in metri [x, y, z], max = cassa piu' grande
 * accettata [x, y, z] in metri. La POSIZIONE delle griglie nella nave non e' nei dati: l'ordine
 * dalla rampa e' un'ipotesi da verificare in gioco (si puo' invertire dall'interfaccia).
 */
export const SHIPS = {
  c2: {
    id: 'CRUS_Starlifter_C2', name: 'C2 Hercules Starlifter', scu: 696,
    grids: [
      { id: 'grande', name: 'Griglia grande', cls: 'CRUS_Starlifter_CargoGrid_Large_C2', scu: 480, m: [10, 18.75, 5], max: [10, 10, 2.5] },
      { id: 'piccola', name: 'Griglia piccola', cls: 'CRUS_Starlifter_CargoGrid_Small_C2', scu: 216, m: [7.5, 11.25, 5], max: [7.5, 10, 2.5] },
    ],
  },
  m2: {
    id: 'CRUS_Starlifter_M2', name: 'M2 Hercules Starlifter', scu: 522,
    grids: [
      { id: 'grande', name: 'Griglia grande', cls: 'CRUS_Starlifter_CargoGrid_Large_M2', scu: 360, m: [10, 18.75, 3.75], max: [10, 10, 2.5] },
      { id: 'piccola', name: 'Griglia piccola', cls: 'CRUS_Starlifter_CargoGrid_Small_M2', scu: 162, m: [7.5, 11.25, 3.75], max: [7.5, 10, 2.5] },
    ],
  },
  a2: {
    id: 'CRUS_Starlifter_A2', name: 'A2 Hercules Starlifter', scu: 216,
    grids: [
      { id: 'unica', name: 'Griglia', cls: 'CRUS_Starlifter_CargoGrid_Small_A2', scu: 216, m: [7.5, 22.5, 2.5], max: [7.5, 10, 2.5] },
    ],
  },
};

const cells = (m) => Math.round(m / CELL_M);

/**
 * Stiva in celle. Le griglie stanno una dietro l'altra lungo y, centrate in larghezza.
 * @param order 'grande-rampa' (default) | 'piccola-rampa'
 */
export function buildHold(ship, { order = 'grande-rampa' } = {}) {
  let gs = ship.grids.map((g) => ({ ...g, w: cells(g.m[0]), l: cells(g.m[1]), h: cells(g.m[2]), maxc: g.max.map(cells) }));
  if (order === 'piccola-rampa') gs = [...gs].reverse();
  const W = Math.max(...gs.map((g) => g.w)), H = Math.max(...gs.map((g) => g.h));
  let y = 0;
  for (const g of gs) { g.x0 = Math.floor((W - g.w) / 2); g.y0 = y; y += g.l; }
  const L = y;
  const gridAt = new Int8Array(W * L * H).fill(-1);
  gs.forEach((g, gi) => {
    for (let z = 0; z < g.h; z++) for (let yy = g.y0; yy < g.y0 + g.l; yy++) for (let x = g.x0; x < g.x0 + g.w; x++) gridAt[(z * L + yy) * W + x] = gi;
  });
  return { W, L, H, grids: gs, gridAt, capacity: gs.reduce((s, g) => s + g.w * g.l * g.h, 0) };
}

/** Elenco casse dalle tappe: stops = [{name, boxes: {32: n, 24: n, ...}}] nell'ordine di consegna. */
export function expandBoxes(stops) {
  const out = [];
  stops.forEach((st, s) => {
    for (const size of SIZES) {
      const n = Math.max(0, Math.floor(Number(st.boxes?.[size] ?? 0)));
      for (let i = 0; i < n; i++) out.push({ stop: s, size });
    }
  });
  return out;
}

function orientations(size) {
  const [a, b, c] = BOXES[size];
  return a === b ? [{ w: a, l: b, h: c, rot: false }] : [{ w: a, l: b, h: c, rot: false }, { w: b, l: a, h: c, rot: true }];
}

/** Stato di occupazione: occ[i] = 0 libero, id+1 cassa. */
function makeState(hold) {
  return { hold, occ: new Int32Array(hold.W * hold.L * hold.H), boxes: [] };
}
const I = (h, x, y, z) => (z * h.L + y) * h.W + x;

function fits(st, x, y, z, o) {
  const h = st.hold;
  if (x < 0 || y < 0 || z < 0 || x + o.w > h.W || y + o.l > h.L || z + o.h > h.H) return -1;
  const g = h.gridAt[I(h, x, y, z)];
  if (g < 0) return -1;
  const gr = h.grids[g];
  if (x + o.w > gr.x0 + gr.w || y + o.l > gr.y0 + gr.l || z + o.h > gr.h || x < gr.x0 || y < gr.y0) return -1;
  if (o.w > gr.maxc[0] || o.l > gr.maxc[1] || o.h > gr.maxc[2]) return -1;
  for (let zz = z; zz < z + o.h; zz++) for (let yy = y; yy < y + o.l; yy++) for (let xx = x; xx < x + o.w; xx++) if (st.occ[I(h, xx, yy, zz)] !== 0) return -1;
  if (z > 0) for (let yy = y; yy < y + o.l; yy++) for (let xx = x; xx < x + o.w; xx++) if (st.occ[I(h, xx, yy, z - 1)] === 0) return -1;
  return g;
}

/**
 * Esiste un percorso di uscita verso la rampa? La cassa si solleva (se lift) fino al livello z'
 * e poi scorre verso y < 0. passable(v) dice se una cella occupata da v (id+1) e' attraversabile.
 * Le celle fuori griglia contano come spazio libero della stiva.
 */
export function exitPath(st, b, passable, lift = true) {
  const h = st.hold, { x, y, z, w, l, h: bh } = b;
  const ok = (xx, yy, zz) => { const v = st.occ[I(h, xx, yy, zz)]; return v === 0 || passable(v); };
  const top = lift ? h.H - bh : z;
  for (let zp = z; zp <= top; zp++) {
    if (zp > z) { // la colonna sopra la cassa deve essere libera per salire di un livello
      const lv = zp + bh - 1;
      for (let yy = y; yy < y + l; yy++) for (let xx = x; xx < x + w; xx++) if (!ok(xx, yy, lv)) return false;
    }
    let clear = true;
    for (let zz = zp; zz < zp + bh && clear; zz++) for (let yy = 0; yy < y && clear; yy++) for (let xx = x; xx < x + w; xx++) if (!ok(xx, yy, zz)) { clear = false; break; }
    if (clear) return true;
  }
  return false;
}

function put(st, box, x, y, z, o, g) {
  const id = st.boxes.length;
  const b = { ...box, id, x, y, z, w: o.w, l: o.l, h: o.h, rot: o.rot, grid: g };
  st.boxes.push(b);
  const h = st.hold;
  for (let zz = z; zz < z + o.h; zz++) for (let yy = y; yy < y + o.l; yy++) for (let xx = x; xx < x + o.w; xx++) st.occ[I(h, xx, yy, zz)] = id + 1;
  return b;
}

function findSpot(st, box, { strict, lift, xDir, orient }) {
  const h = st.hold;
  let os = orientations(box.size);
  if (orient === 'traverso') os = [...os].reverse();
  const xs = [...Array(h.W).keys()];
  if (xDir < 0) xs.reverse();
  // la cella occupata da casse di tappe successive blocca; stessa tappa o tappe precedenti no
  const passable = (v) => st.boxes[v - 1].stop <= box.stop;
  if (strict) {
    for (const o of os) {
      for (let y = h.L - o.l; y >= 0; y--) for (let z = 0; z + o.h <= h.H; z++) for (const x of xs) {
        const g = fits(st, x, y, z, o);
        if (g < 0) continue;
        if (!exitPath(st, { x, y, z, w: o.w, l: o.l, h: o.h }, passable, lift)) continue;
        return { x, y, z, o, g };
      }
    }
    return null;
  }
  // nessun posto "pulito": il posto che costringe a spostare meno casse, poi il piu' profondo
  let best = null;
  for (const o of os) for (let y = 0; y + o.l <= h.L; y++) for (let z = 0; z + o.h <= h.H; z++) for (const x of xs) {
    const g = fits(st, x, y, z, o);
    if (g < 0) continue;
    const n = blockCount(st, { x, y, z, w: o.w, l: o.l, h: o.h }, box.stop, lift);
    if (!best || n < best.n || (n === best.n && (y > best.y || (y === best.y && z < best.z)))) best = { x, y, z, o, g, n };
  }
  return best;
}

/**
 * Casse da spostare per far uscire b (scegliendo il livello di uscita migliore).
 * counts(v) dice se la cassa v (id+1) conta come ostacolo.
 */
function blockSet(st, b, counts, lift = true) {
  const h = st.hold, { x, y, z, w, l, h: bh } = b;
  let best = null;
  const above = new Set();
  const top = lift ? h.H - bh : z;
  for (let zp = z; zp <= top; zp++) {
    if (zp > z) {
      const lv = zp + bh - 1;
      for (let yy = y; yy < y + l; yy++) for (let xx = x; xx < x + w; xx++) { const v = st.occ[I(h, xx, yy, lv)]; if (v && counts(v)) above.add(v - 1); }
    }
    const ids = new Set(above);
    for (let zz = zp; zz < zp + bh; zz++) for (let yy = 0; yy < y; yy++) for (let xx = x; xx < x + w; xx++) { const v = st.occ[I(h, xx, yy, zz)]; if (v && counts(v)) ids.add(v - 1); }
    if (!best || ids.size < best.size) best = ids;
  }
  return best ?? new Set();
}
const blockCount = (st, b, stop, lift) => blockSet(st, b, (v) => st.boxes[v - 1].stop > stop, lift).size;

function packVariant(hold, list, opts) {
  const st = makeState(hold);
  const unplaced = [];
  for (const box of list) {
    let spot = findSpot(st, box, { ...opts, strict: true }), relaxed = false;
    if (!spot) { spot = findSpot(st, box, { ...opts, strict: false }); relaxed = !!spot; }
    if (!spot) { unplaced.push(box); continue; }
    const b = put(st, box, spot.x, spot.y, spot.z, spot.o, spot.g);
    b.relaxed = relaxed;
  }
  return { st, unplaced };
}

/** Rimuove la cassa dallo stato (occ) */
function lift(st, b) {
  const h = st.hold;
  for (let zz = b.z; zz < b.z + b.h; zz++) for (let yy = b.y; yy < b.y + b.l; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) st.occ[I(h, xx, yy, zz)] = 0;
}
function restore(st, b) {
  const h = st.hold;
  for (let zz = b.z; zz < b.z + b.h; zz++) for (let yy = b.y; yy < b.y + b.l; yy++) for (let xx = b.x; xx < b.x + b.w; xx++) st.occ[I(h, xx, yy, zz)] = b.id + 1;
}
const nearFirst = (a, b) => a.y - b.y || (b.z + b.h) - (a.z + a.h) || a.x - b.x;

/** Una cassa e' accessibile se puo' uscire senza toccare altre casse ancora a bordo. */
const accessible = (st, b, liftOk) => exitPath(st, b, (v) => v === b.id + 1, liftOk);

/**
 * Scarico simulato tappa per tappa. Se una cassa della tappa non e' raggiungibile si sposta
 * temporaneamente la cassa che la blocca (conteggiata come movimento extra) e la si rimette al
 * suo posto a fine tappa.
 */
export function simulateUnload(st, nStops, { lift: liftOk = true } = {}) {
  const left = new Set(st.boxes.map((b) => b.id));
  const stops = [];
  for (let s = 0; s < nStops; s++) {
    const seq = [], moves = [];
    let guard = 0;
    while ([...left].some((id) => st.boxes[id].stop === s) && guard++ < 10000) {
      const mine = [...left].map((id) => st.boxes[id]).filter((b) => b.stop === s).sort(nearFirst);
      const acc = mine.find((b) => accessible(st, b, liftOk));
      if (acc) { lift(st, acc); left.delete(acc.id); seq.push(acc.id); continue; }
      // nessuna raggiungibile: si libera la cassa della tappa che ha meno ostacoli, togliendo
      // temporaneamente un ostacolo raggiungibile (se serve, prima l'ostacolo dell'ostacolo)
      const others = (b) => (v) => v !== b.id + 1;
      let target = mine[0], tset = blockSet(st, target, others(target), liftOk);
      for (const b of mine) { const bs = blockSet(st, b, others(b), liftOk); if (bs.size < tset.size) { target = b; tset = bs; } }
      let mover = null;
      const seen = new Set(), queue = [...tset];
      while (queue.length && !mover) {
        const ids = queue.splice(0).filter((id) => !seen.has(id));
        ids.forEach((id) => seen.add(id));
        const cand = ids.map((id) => st.boxes[id]).sort(nearFirst);
        mover = cand.find((b) => accessible(st, b, liftOk)) ?? null;
        if (!mover) for (const c of cand) queue.push(...blockSet(st, c, others(c), liftOk));
      }
      if (!mover) { lift(st, target); left.delete(target.id); seq.push(target.id); continue; }
      lift(st, mover); left.delete(mover.id);
      if (mover.stop === s) seq.push(mover.id); else moves.push({ id: mover.id, forBox: target.id });
    }
    for (const m of moves) { restore(st, st.boxes[m.id]); left.add(m.id); }
    stops.push({ seq, moves });
  }
  // ripristina lo stato iniziale per chi lo usa dopo
  for (const b of st.boxes) restore(st, b);
  return stops;
}

/**
 * Ordine di carico fisicamente eseguibile: e' l'inverso di uno svuotamento completo della stiva
 * in cui si toglie sempre una cassa raggiungibile, preferendo le tappe vicine e le casse vicino alla rampa.
 */
export function loadOrder(st, { lift: liftOk = true } = {}) {
  const left = new Set(st.boxes.map((b) => b.id));
  const removal = [];
  let guard = 0;
  while (left.size && guard++ < 100000) {
    const all = [...left].map((id) => st.boxes[id]).sort((a, b) => a.stop - b.stop || nearFirst(a, b));
    const nxt = all.find((b) => accessible(st, b, liftOk)) ?? all[0];
    lift(st, nxt); left.delete(nxt.id); removal.push(nxt.id);
  }
  for (const b of st.boxes) restore(st, b);
  return removal.reverse();
}

function score(st, unplaced, unload, nStops) {
  const unSCU = unplaced.reduce((s, b) => s + b.size, 0);
  const moves = unload.reduce((s, u) => s + u.moves.length, 0);
  // casse delle prime tappe vicine alla rampa: distanza pesata (piu' peso alle prime consegne)
  const dist = st.boxes.reduce((s, b) => s + b.y * (nStops - b.stop), 0);
  return [unSCU, moves, dist];
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/**
 * Piano completo.
 * @param shipKey 'c2' | 'm2' | 'a2'
 * @param stops [{name, boxes:{size:n}}] in ordine di consegna (0 = prima consegna)
 * @param opts {order, lift}
 */
export function planLoad(shipKey, stops, { order = 'grande-rampa', lift: liftOk = true } = {}) {
  const ship = SHIPS[shipKey] ?? SHIPS.c2;
  const hold = buildHold(ship, { order });
  const raw = expandBoxes(stops);
  // tappe piu' lontane per prime, poi casse grandi (riempiono le pareti), poi lunghe
  // (variante: casse piccole prima, utile quando la stiva e' quasi piena)
  const lists = {
    grandi: [...raw].sort((a, b) => b.stop - a.stop || b.size - a.size),
    piccole: [...raw].sort((a, b) => b.stop - a.stop || a.size - b.size),
  };
  let best = null;
  for (const sort of ['grandi', 'piccole']) for (const orient of ['lungo', 'traverso']) for (const xDir of [1, -1]) {
    const { st, unplaced } = packVariant(hold, lists[sort], { lift: liftOk, xDir, orient });
    const unload = simulateUnload(st, stops.length, { lift: liftOk });
    const sc = score(st, unplaced, unload, stops.length);
    if (!best || cmp(sc, best.sc) < 0) best = { st, unplaced, unload, sc, variant: { sort, orient, xDir } };
  }
  const { st, unplaced, unload } = best;
  const load = loadOrder(st, { lift: liftOk });
  const boxes = st.boxes.map((b) => ({ ...b, pos: describe(hold, b) }));
  const perStop = stops.map((s, i) => {
    const mine = boxes.filter((b) => b.stop === i);
    const un = unplaced.filter((b) => b.stop === i);
    return {
      name: s.name || `Tappa ${i + 1}`,
      boxes: mine.length, scu: mine.reduce((a, b) => a + b.size, 0),
      unplaced: un.length, unplacedScu: un.reduce((a, b) => a + b.size, 0),
      unload: unload[i].seq, moves: unload[i].moves,
      avgDistM: mine.length ? round1(mine.reduce((a, b) => a + (b.y + b.l / 2) * CELL_M, 0) / mine.length) : null,
    };
  });
  const totalScu = raw.reduce((s, b) => s + b.size, 0);
  return {
    ship, hold, boxes, load, perStop, unplaced,
    totals: {
      requestedScu: totalScu, placedScu: boxes.reduce((s, b) => s + b.size, 0), capacity: ship.scu,
      boxes: boxes.length, unplaced: unplaced.length, extraMoves: unload.reduce((s, u) => s + u.moves.length, 0),
      relaxed: boxes.filter((b) => b.relaxed).length,
    },
    variant: best.variant,
  };
}

const round1 = (v) => Math.round(v * 10) / 10;

/** Posizione leggibile: griglia, metri dalla rampa (dal bordo della griglia), da sinistra, piano. */
export function describe(hold, b) {
  const g = hold.grids[b.grid];
  return {
    grid: g.name,
    fromRampM: round1((b.y - g.y0) * CELL_M),
    fromRampHoldM: round1(b.y * CELL_M),
    fromLeftM: round1((b.x - g.x0) * CELL_M),
    level: b.z === 0 ? 'pavimento' : `sopra, a ${round1(b.z * CELL_M)} m`,
    tier: b.z,
    along: b.l >= b.w ? 'lungo la nave' : 'di traverso',
  };
}
