// MOTORE DI OTTIMIZZAZIONE: pickup-and-delivery con capacita', precedenze e vincoli.
//
// Regole inderogabili (verificate da validateSequence su OGNI piano restituito):
//  - nessuna consegna prima del relativo ritiro;
//  - in nessun segmento il carico supera la capacita' operativa;
//  - quantita' contabilizzate per singolo movimento (contratto + tratta), anche se parziali;
//  - solo contratti ACCETTATI/IN ESECUZIONE sono vincolanti; i CONFERMATI possono essere proposti
//    "da accettare", mai trattati come gia' acquisiti; catalogo e osservate non entrano mai;
//  - nessuna distanza o tempo inventati: le tratte non note restano non note e penalizzano il piano.
//
// Metodo: esatto (ricerca in profondita' con limite) fino a EXACT_LIMIT operazioni, oltre
// euristico deterministico (inserimento a costo minimo + reinserimento iterato): stesso input,
// stesso risultato.
import { contractDone, inHold, isCandidate, isCommitted, rankIndex, toDeliver, toLoad } from './model.js';
import { placeKey } from './places.js';

export const EXACT_LIMIT = 10;
const UNKNOWN_LEG = 1e15; // penalita' per tratta di lunghezza non nota (mai sommata come distanza)

export const PRIORITIES = {
  profitto: 'Profitto',
  profitto_ora: 'Profitto per ora',
  pochi_scali: 'Pochi scali',
  rischio: 'Riduzione del rischio',
  stiva: 'Utilizzo della stiva',
};

/**
 * Operazioni elementari da pianificare. Un movimento con merce da ritirare produce un ritiro e una
 * consegna; uno gia' caricato (in stiva) solo la consegna. Con splitTrips un movimento piu' grande
 * della capacita' si divide in viaggi da al massimo `capacity` SCU (deterministico).
 */
export function buildTasks(contracts, { capacity, splitTrips = true } = {}) {
  const tasks = [], issues = [];
  let initialLoad = 0;
  for (const c of contracts) {
    for (const m of c.movements) {
      const ref = { contractId: c.id, movementId: m.id, cargo: m.cargo, containerMax: m.containerMax ?? null };
      const held = inHold(m), load = toLoad(m);
      initialLoad += held;
      if (held > 0) {
        if (!m.to?.name) { issues.push({ contractId: c.id, movementId: m.id, reason: 'consegna senza luogo noto per merce già in stiva' }); continue; }
        tasks.push({ id: `${c.id}/${m.id}/D0`, type: 'scarico', place: m.to, qty: held, pair: null, ...ref });
      }
      if (load > 0) {
        if (!m.from?.name || !m.to?.name) { issues.push({ contractId: c.id, movementId: m.id, reason: 'punto di ritiro o consegna non noto' }); continue; }
        const chunks = [];
        if (load > capacity && splitTrips) { for (let left = load; left > 0; left -= capacity) chunks.push(Math.min(capacity, left)); }
        else chunks.push(load);
        chunks.forEach((q, k) => {
          const pid = `${c.id}/${m.id}/P${k + 1}`;
          tasks.push({ id: pid, type: 'carico', place: m.from, qty: q, ...ref });
          tasks.push({ id: `${c.id}/${m.id}/D${k + 1}`, type: 'scarico', place: m.to, qty: q, pair: pid, ...ref });
        });
      }
    }
  }
  return { tasks, initialLoad, issues };
}

/**
 * Verifica indipendente di una sequenza (usata anche dai test): precedenze, capacita',
 * contabilita' per movimento.
 * @returns {{ok:boolean, errors:string[], loads:number[], peak:number}}
 */
export function validateSequence(seq, { capacity, initialLoad = 0, held = new Map() } = {}) {
  const errors = [], done = new Set(), loads = [];
  let load = initialLoad, peak = initialLoad;
  const acc = new Map(held); // movimento -> SCU in stiva
  for (const t of seq) {
    const k = `${t.contractId}/${t.movementId}`;
    if (t.type === 'carico') { load += t.qty; acc.set(k, (acc.get(k) ?? 0) + t.qty); }
    else {
      if (t.pair && !done.has(t.pair)) errors.push(`consegna ${t.id} prima del ritiro ${t.pair}`);
      if ((acc.get(k) ?? 0) < t.qty - 1e-9) errors.push(`consegna ${t.id}: ${t.qty} SCU ma in stiva per quel movimento solo ${acc.get(k) ?? 0}`);
      acc.set(k, (acc.get(k) ?? 0) - t.qty);
      load -= t.qty;
    }
    if (load > capacity + 1e-9) errors.push(`capacità superata dopo ${t.id}: ${load} SCU su ${capacity}`);
    done.add(t.id); loads.push(load); peak = Math.max(peak, load);
  }
  return { ok: errors.length === 0, errors, loads, peak };
}

/** Costo e metriche di una sequenza. */
function evaluate(seq, ctx) {
  let pos = ctx.start, dist = 0, unknown = 0, time = 0, timeKnown = !!ctx.start, stops = 0, interstellar = 0;
  let loadDist = 0, load = ctx.initialLoad;
  const legs = [];
  const hop = (to) => {
    if (pos && placeKey(pos) === placeKey(to)) return;
    stops++;
    if (!pos) { unknown++; timeKnown = false; legs.push({ from: null, to, distance: null, time: null, note: 'posizione attuale non indicata' }); pos = to; return; }
    const l = ctx.legOf(pos, to);
    legs.push({ from: pos, to, ...l });
    if (l.distance === null) { unknown++; timeKnown = false; if (l.interstellar) interstellar++; }
    else { dist += l.distance; loadDist += load * l.distance; if (l.time === null) timeKnown = false; else time += l.time; }
    pos = to;
  };
  for (const t of seq) { hop(t.place); load += t.type === 'carico' ? t.qty : -t.qty; }
  if (ctx.end) hop(ctx.end);
  const cost = ctx.priority === 'pochi_scali'
    ? stops * 1e13 + unknown * UNKNOWN_LEG + dist
    : unknown * UNKNOWN_LEG + dist + stops * (ctx.stopWeight ?? 0);
  return { cost, distance: dist, unknownLegs: unknown, interstellarLegs: interstellar, travelTime: timeKnown ? time : null, stops, legs, loadDist };
}

function feasiblePrefix(seq, ctx) {
  let load = ctx.initialLoad;
  const done = new Set();
  for (const t of seq) {
    if (t.type === 'scarico' && t.pair && !done.has(t.pair)) return false;
    load += t.type === 'carico' ? t.qty : -t.qty;
    if (load > ctx.capacity + 1e-9) return false;
    done.add(t.id);
  }
  return true;
}

function stopsOf(seq, ctx) {
  let pos = ctx.start, s = 0;
  for (const t of seq) { if (!pos || placeKey(pos) !== placeKey(t.place)) { s++; pos = t.place; } }
  if (ctx.end && (!pos || placeKey(pos) !== placeKey(ctx.end))) s++;
  return s;
}

/** Ricerca esatta (piccoli insiemi). Ordine dei rami deterministico (per id). */
function exact(tasks, ctx) {
  const n = tasks.length;
  const sorted = [...tasks].sort((a, b) => (a.id < b.id ? -1 : 1));
  let best = null, bestCost = Infinity;
  const used = new Array(n).fill(false), seq = [], done = new Set();
  let load = ctx.initialLoad, nodes = 0;
  const rec = () => {
    if (++nodes > 2e6) return; // limite di sicurezza: oltre, il risultato resta il migliore trovato
    if (seq.length === n) {
      if (ctx.maxStops && stopsOf(seq, ctx) > ctx.maxStops) return;
      const e = evaluate(seq, ctx);
      if (e.cost < bestCost) { bestCost = e.cost; best = [...seq]; }
      return;
    }
    if (bestCost < Infinity && evaluate(seq, { ...ctx, end: null }).cost >= bestCost) return;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const t = sorted[i];
      if (t.type === 'scarico' && t.pair && !done.has(t.pair)) continue;
      const nl = load + (t.type === 'carico' ? t.qty : -t.qty);
      if (nl > ctx.capacity + 1e-9) continue;
      used[i] = true; seq.push(t); done.add(t.id); const pl = load; load = nl;
      rec();
      used[i] = false; seq.pop(); done.delete(t.id); load = pl;
    }
  };
  rec();
  return { seq: best, exhaustive: nodes <= 2e6 };
}

/** Euristica deterministica: inserimento a costo minimo per gruppi (ritiro+consegna) e reinserimento. */
function heuristic(tasks, ctx) {
  const groups = new Map();
  for (const t of tasks) {
    const g = t.pair ?? (t.type === 'carico' ? t.id : t.id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  const order = [...groups.entries()].sort((a, b) => {
    const qa = a[1][0].qty, qb = b[1][0].qty;
    return qb - qa || (a[0] < b[0] ? -1 : 1);
  }).map(([, g]) => g.sort((x, y) => (x.type === 'carico' ? 0 : 1) - (y.type === 'carico' ? 0 : 1)));
  const insertGroup = (seq, g) => {
    let best = null, bestCost = Infinity;
    if (g.length === 1) {
      for (let i = 0; i <= seq.length; i++) {
        const s = [...seq.slice(0, i), g[0], ...seq.slice(i)];
        if (!feasiblePrefix(s, ctx)) continue;
        const c = evaluate(s, ctx).cost;
        if (c < bestCost) { bestCost = c; best = s; }
      }
    } else {
      const [p, d] = g;
      for (let i = 0; i <= seq.length; i++) {
        for (let j = i; j <= seq.length; j++) {
          const s = [...seq.slice(0, i), p, ...seq.slice(i, j), d, ...seq.slice(j)];
          if (!feasiblePrefix(s, ctx)) continue;
          const c = evaluate(s, ctx).cost;
          if (c < bestCost) { bestCost = c; best = s; }
        }
      }
    }
    return best;
  };
  let seq = [];
  for (const g of order) {
    const s = insertGroup(seq, g);
    if (!s) return { seq: null };
    seq = s;
  }
  for (let iter = 0; iter < 6; iter++) {
    let improved = false;
    for (const g of order) {
      const ids = new Set(g.map((t) => t.id));
      const rest = seq.filter((t) => !ids.has(t.id));
      if (!feasiblePrefix(rest, ctx)) continue;
      const s = insertGroup(rest, g);
      if (s && evaluate(s, ctx).cost < evaluate(seq, ctx).cost - 1e-6) { seq = s; improved = true; }
    }
    if (!improved) break;
  }
  return { seq };
}

/** Sequenza ottima per un insieme fissato di contratti. */
export function routeContracts(contracts, ctx) {
  const { tasks, initialLoad, issues } = buildTasks(contracts, ctx);
  const c2 = { ...ctx, initialLoad };
  if (initialLoad > ctx.capacity) return { ok: false, reason: `merce già in stiva (${initialLoad} SCU) oltre la capacità operativa (${ctx.capacity} SCU)`, issues };
  if (!tasks.length) return { ok: true, seq: [], eval: evaluate([], c2), initialLoad, issues, method: 'esatto' };
  const useExact = ctx.method ? ctx.method === 'esatto' : tasks.length <= EXACT_LIMIT;
  const r = useExact ? exact(tasks, c2) : heuristic(tasks, c2);
  if (!r.seq) return { ok: false, reason: 'nessuna sequenza rispetta capacità, precedenze e numero massimo di scali', issues };
  const v = validateSequence(r.seq, { capacity: ctx.capacity, initialLoad, held: heldMap(contracts) });
  if (!v.ok) return { ok: false, reason: `errore interno: ${v.errors[0]}`, issues }; // non deve mai accadere
  if (ctx.maxStops && stopsOf(r.seq, c2) > ctx.maxStops) return { ok: false, reason: `servono più di ${ctx.maxStops} scali`, issues };
  return { ok: true, seq: r.seq, eval: evaluate(r.seq, c2), initialLoad, peak: v.peak, loads: v.loads, issues, method: useExact ? (r.exhaustive ? 'esatto' : 'esatto (limite di ricerca raggiunto)') : 'euristico deterministico' };
}

const heldMap = (contracts) => {
  const m = new Map();
  for (const c of contracts) for (const x of c.movements) if (inHold(x) > 0) m.set(`${c.id}/${x.id}`, inHold(x));
  return m;
};

/** Motivo per cui un contratto confermato non e' proponibile (null se proponibile). */
export function candidateBlock(c, { ship, ranks = {}, capacity }) {
  for (const m of c.movements) {
    if (!m.from?.name || !m.to?.name) return 'punto di ritiro o consegna non noto';
    if (ship?.maxBox && m.containerMax && m.containerMax > ship.maxBox) return `casse da ${m.containerMax} SCU oltre la cassa massima della nave (${ship.maxBox} SCU)`;
  }
  const r = rankIndex(c.rank), mine = c.company ? rankIndex(ranks[c.company]) : null;
  if (r !== null && c.company && mine !== null && mine < r) return `grado richiesto ${c.rank}, il tuo presso ${c.company} è ${ranks[c.company]}`;
  if (r !== null && c.company && mine === null) return `grado presso ${c.company} non indicato: requisito ${c.rank} non verificabile`;
  if (!capacity) return 'capacità operativa non indicata';
  return null; // oltre la capacita': si divide in piu' viaggi (buildTasks), con avviso
}

/**
 * Piano completo: contratti vincolanti sempre inclusi, confermati scelti per la priorita'.
 * @param ctx {capacity, start, end, legOf, priority, maxStops, ship, ranks, costs:{perGm, perStop, riskWeight}, handling:{perScu, perStop}, now}
 */
export function planDispatch(contracts, ctx) {
  const warnings = [];
  const committed = contracts.filter(isCommitted).filter((c) => !contractDone(c));
  const blocked = [];
  const cands = contracts.filter(isCandidate).filter((c) => {
    const why = candidateBlock(c, ctx);
    if (why) blocked.push({ contract: c, reason: why });
    return !why && !ctx.skip?.has(c.id);
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  const base = routeContracts(committed, ctx);
  if (!base.ok) return { ok: false, reason: `I contratti già accettati non sono pianificabili: ${base.reason}`, issues: base.issues, blocked };
  const score = (set, r) => scorePlan(set, r, ctx);
  let best = { set: committed, r: base, s: score(committed, base) };
  const tryset = (set) => {
    const r = routeContracts(set, ctx);
    if (!r.ok) return null;
    return { set, r, s: score(set, r) };
  };
  if (cands.length <= 6) {
    for (let mask = 1; mask < 1 << cands.length; mask++) {
      const set = [...committed, ...cands.filter((_, i) => mask & (1 << i))];
      const x = tryset(set);
      if (x && better(x.s, best.s)) best = x;
    }
  } else {
    warnings.push(`${cands.length} contratti confermati: selezione euristica (aggiunta progressiva), non esaustiva.`);
    const order = [...cands].sort((a, b) => ((b.reward ?? 0) - (a.reward ?? 0)) || (a.id < b.id ? -1 : 1));
    for (const c of order) {
      const x = tryset([...best.set, c]);
      if (x && better(x.s, best.s)) best = x;
    }
  }
  const proposed = best.set.filter((c) => !isCommitted(c));
  const excluded = cands.filter((c) => !best.set.includes(c)).map((c) => ({ contract: c, reason: 'non migliora il piano con la priorità scelta, oppure non entra in stiva o negli scali' }));
  if (best.r.eval.unknownLegs) warnings.push(`${best.r.eval.unknownLegs} tratte di lunghezza non nota (posizione non nota o interstellare): distanza e tempo totali sono incompleti.`);
  if (best.r.eval.travelTime === null) warnings.push('Tempo di viaggio non determinabile: mancano i parametri del drive QT (DATI E IMPOSTAZIONI) o alcune distanze.');
  if (contracts.some((c) => c.deadline) && (best.r.eval.travelTime === null)) warnings.push('Scadenze presenti ma non verificabili senza tempi di viaggio: controllale in gioco.');
  return {
    ok: true, seq: best.r.seq, eval: best.r.eval, method: best.r.method, initialLoad: best.r.initialLoad, peak: best.r.peak,
    contracts: best.set, committed, proposed, excluded, blocked, score: best.s, warnings, issues: best.r.issues,
  };
}

function scorePlan(set, r, ctx) {
  const rewards = set.map((c) => c.reward);
  const unknownReward = rewards.some((x) => x === null || x === undefined);
  const reward = rewards.reduce((s, x) => s + (x ?? 0), 0);
  const costs = ctx.costs ?? {};
  const travelCost = costs.perGm ? (r.eval.distance / 1e9) * costs.perGm : 0;
  const stopCost = (costs.perStop ?? 0) * r.eval.stops;
  const risk = set.reduce((s, c) => s + (c.risk ?? 0), 0) + r.eval.interstellarLegs;
  const net = reward - travelCost - stopCost - (costs.riskWeight ?? 0) * risk;
  const scu = set.reduce((s, c) => s + c.movements.reduce((a, m) => a + toDeliver(m), 0), 0);
  const handling = ctx.handling?.perScu ? scu * ctx.handling.perScu + (ctx.handling.perStop ?? 0) * r.eval.stops : null;
  const hours = r.eval.travelTime !== null && handling !== null ? (r.eval.travelTime + handling) / 3600 : null;
  const perHour = hours && !unknownReward ? net / hours : null;
  const util = r.eval.distance > 0 ? r.eval.loadDist / (ctx.capacity * r.eval.distance) : null;
  return { priority: ctx.priority ?? 'profitto', reward, unknownReward, net, perHour, hours, risk, stops: r.eval.stops, unknownLegs: r.eval.unknownLegs, distance: r.eval.distance, util, scu };
}

/** Confronto deterministico secondo la priorita'. Profitto/ora senza tempi: ricade sul profitto. */
function better(a, b) {
  const t = (x, y) => (x === y ? 0 : x > y ? 1 : -1);
  const keys = {
    profitto: [[a.net, b.net], [-a.unknownLegs, -b.unknownLegs], [-a.distance, -b.distance]],
    profitto_ora: a.perHour !== null && b.perHour !== null ? [[a.perHour, b.perHour], [a.net, b.net]] : [[a.net, b.net], [-a.distance, -b.distance]],
    pochi_scali: [[-a.stops, -b.stops], [a.net, b.net]],
    rischio: [[-a.risk, -b.risk], [-a.unknownLegs, -b.unknownLegs], [a.net, b.net]],
    stiva: [[a.util ?? 0, b.util ?? 0], [a.net, b.net]],
  }[a.priority] ?? [[a.net, b.net]];
  for (const [x, y] of keys) { const c = t(x, y); if (c) return c > 0; }
  return false;
}
