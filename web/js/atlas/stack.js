// MISSION STACKING ENGINE e BEST STACK FINDER.
// Riusa il motore della logistica (routeContracts: esatto fino a 10 operazioni, poi euristico
// deterministico; validateSequence su ogni piano): capacita' dopo ogni ritiro e scarico, nessuna
// consegna prima del ritiro, quantita' contabilizzate per singola partita di carico.
// Le distanze sono quelle reali del database geografico (stesso sistema); fra sistemi diversi la
// tratta resta non nota (passa da un jump point, distanza non sommabile).
import { routeContracts } from '../logistics/optimizer.js';
import { jumpTime } from '../core/qtdrive.js';
import { plannable } from './missions.js';

export const CLASSES = {
  eseguibile: { icon: '🟢', label: 'ESEGUIBILE', note: 'contratti già accettati, vincoli noti rispettati' },
  potenziale: { icon: '🟡', label: 'POTENZIALMENTE ACCUMULABILE', note: 'almeno un contratto va ancora trovato e accettato' },
  verificare: { icon: '⚪', label: 'DA VERIFICARE', note: 'mancano dati essenziali' },
  incompatibile: { icon: '🔴', label: 'INCOMPATIBILE', note: 'un vincolo noto non è rispettato' },
};
export const STACK_TYPES = {
  same_pickup: 'SAME PICKUP', same_dropoff: 'SAME DROPOFF', multi_pickup: 'MULTI PICKUP', multi_dropoff: 'MULTI DROPOFF',
  route_overlap: 'ROUTE OVERLAP', return_trip: 'RETURN TRIP', sequential: 'SEQUENTIAL LOADING',
};
export const SCENARIOS = {
  guadagno: { label: 'MASSIMO GUADAGNO', note: 'massima ricompensa nota compatibile con i vincoli' },
  efficienza: { label: 'MASSIMA EFFICIENZA', note: 'guadagno per ora (o per Gm percorso se il tempo non è calcolabile), pochi scali improduttivi' },
  viaggio: { label: 'MINIMO VIAGGIO', note: 'solo missioni che allungano il percorso al massimo del 15 % e di uno scalo' },
};

/** Funzione tratta sul database geografico (luoghi canonici). */
export function geoLegOf(geo, { drive = null, prep = null } = {}) {
  const cache = new Map();
  return (a, b) => {
    const k = `${a.id}>${b.id}`;
    if (cache.has(k)) return cache.get(k);
    let r;
    if (a.id === b.id) r = { distance: 0, time: 0, interstellar: false, known: true, note: null };
    else {
      const pa = geo.get(a.id), pb = geo.get(b.id);
      if (!pa?.pos || !pb?.pos) r = { distance: null, time: null, interstellar: false, known: false, note: 'posizione non nota' };
      else if (pa.system !== pb.system) r = { distance: null, time: null, interstellar: true, known: false, note: `tratta interstellare ${pa.system} → ${pb.system}: passa dal jump point, distanza non sommabile` };
      else { const d = geo.distance(pa, pb); const t = drive ? jumpTime(d, drive) : null; r = { distance: d, time: t === null ? null : t + (prep ?? 0), interstellar: false, known: true, note: null }; }
    }
    cache.set(k, r);
    return r;
  };
}

const placeRef = (geo, id) => { const p = geo.get(id); return { id, name: p?.name ?? id, system: p?.system ?? null }; };

/**
 * Vista missione -> contratto pianificabile (movimenti ritiro->consegna) o motivo del rifiuto.
 * Per i contratti dell'utente si usano i movimenti registrati (quantita' gia' caricate comprese).
 */
export function toPlanning(v, geo) {
  const p = plannable(v);
  if (v.splitUnknown && v.origin !== 'utente') p.missing.push('più punti di ritiro per una consegna: la ripartizione delle SCU non è indicata dalla fonte');
  if (p.missing.length) return { ok: false, missing: p.missing };
  const movements = [];
  const slots = [...new Set(v.ops.map((o) => o.slot))];
  if (v.origin === 'utente') {
    for (const m of v.contract.movements) {
      const a = v.ops.find((o) => o.role === 'pickup' && o.movementId === m.id), b = v.ops.find((o) => o.role === 'dropoff' && o.movementId === m.id);
      movements.push({ ...m, from: placeRef(geo, a.ids[0]), to: placeRef(geo, b.ids[0]) });
    }
  } else {
    const picks = v.ops.filter((o) => o.role === 'pickup'), drops = v.ops.filter((o) => o.role === 'dropoff');
    if (v.origin === 'catalogo' && !(picks.length === 1 && drops.length === 1)) return { ok: false, missing: ['modello con più ritiri o consegne: abbinamento merce-luogo non indicato dai file'] };
    for (const s of slots) {
      const a = picks.find((o) => o.slot === s) ?? (picks.length === 1 ? picks[0] : null);
      const b = drops.find((o) => o.slot === s) ?? (drops.length === 1 ? drops[0] : null);
      if (!a || !b) return { ok: false, missing: [`operazione ${s}: ritiro o consegna senza corrispondenza`] };
      if (movements.some((m) => m.id === b.movementId && b.movementId)) continue;
      movements.push({ id: b.movementId ?? `m${s}`, cargo: b.cargo, scu: b.scu, containerMax: b.containerMax ?? v.maxBox ?? null, from: placeRef(geo, a.ids[0]), to: placeRef(geo, b.ids[0]), loaded: 0, delivered: 0 });
    }
  }
  const assumed = v.origin === 'catalogo' ? ['quantità = massimo del modello (il gioco può assegnarne meno)'] : [];
  return { ok: true, contract: { id: v.id, title: v.title, company: v.company, rank: v.rank, reward: v.reward, status: v.status, movements, view: v }, assumed };
}

const fixedSet = (v, role) => new Set(v.ops.filter((o) => o.role === role && o.fixed).flatMap((o) => o.ids));
const anySet = (v, role) => new Set(v.ops.filter((o) => o.role === role).flatMap((o) => o.ids));
const meets = (a, b) => [...a].some((x) => b.has(x));

/** Tipologie di accumulo fra due missioni: certe (luoghi fissi) o possibili (pool). */
export function stackTypes(a, b, geo) {
  const out = [];
  const add = (type, sure) => out.push({ type, label: STACK_TYPES[type], sure });
  const test = (pa, da, pb, db, sure) => {
    if (meets(pa, pb)) add('same_pickup', sure);
    if (meets(da, db)) add('same_dropoff', sure);
    if (meets(da, pb) && meets(db, pa)) add('return_trip', sure);
    else if (meets(da, pb) || meets(db, pa)) add('sequential', sure);
    if (meets(da, db) && new Set([...pa, ...pb]).size > 1 && !meets(pa, pb)) add('multi_pickup', sure);
    if (meets(pa, pb) && new Set([...da, ...db]).size > 1 && !meets(da, db)) add('multi_dropoff', sure);
  };
  test(fixedSet(a, 'pickup'), fixedSet(a, 'dropoff'), fixedSet(b, 'pickup'), fixedSet(b, 'dropoff'), true);
  if (!out.length) test(anySet(a, 'pickup'), anySet(a, 'dropoff'), anySet(b, 'pickup'), anySet(b, 'dropoff'), false);
  if (!out.some((x) => x.sure) && geo) { const o = overlap(a, b, geo); if (o) add('route_overlap', true); }
  const seen = new Set();
  return out.filter((x) => { const k = x.type; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Sovrapposizione di percorso: stessa direzione (coseno > 0,8) e capi di B vicini al tragitto di A (< 10 %). */
function overlap(a, b, geo) {
  const seg = (v) => {
    const p = [...fixedSet(v, 'pickup')][0], d = [...fixedSet(v, 'dropoff')][0];
    const P = geo.get(p), D = geo.get(d);
    return P?.pos && D?.pos && P.system === D.system ? [P, D] : null;
  };
  const sa = seg(a), sb = seg(b);
  if (!sa || !sb || sa[0].system !== sb[0].system) return false;
  const v = (x, y) => [y.pos.x - x.pos.x, y.pos.y - x.pos.y, y.pos.z - x.pos.z];
  const va = v(...sa), vb = v(...sb);
  const L = (u) => Math.hypot(...u), dotp = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  if (!L(va) || !L(vb)) return false;
  if (dotp(va, vb) / (L(va) * L(vb)) < 0.8) return false;
  const off = (q) => { const w = v(sa[0], q); const t = Math.max(0, Math.min(1, dotp(w, va) / dotp(va, va))); return Math.hypot(w[0] - t * va[0], w[1] - t * va[1], w[2] - t * va[2]); };
  return off(sb[0]) < 0.1 * L(va) && off(sb[1]) < 0.1 * L(va);
}

/** Vincoli noti violati (incompatibilita'). */
function violations(v, contract, ctx) {
  const out = [];
  const maxBox = ctx.ship?.maxBox;
  for (const m of contract?.movements ?? []) if (maxBox && m.containerMax && m.containerMax > maxBox) out.push(`${v.title}: casse da ${m.containerMax} SCU oltre la cassa massima della nave (${maxBox} SCU)`);
  if (maxBox && v.maxBox && v.maxBox > maxBox && !contract) out.push(`${v.title}: casse fino a ${v.maxBox} SCU oltre la cassa massima della nave (${maxBox} SCU)`);
  const mine = v.company ? ctx.ranks?.[v.company] : null;
  if (Number.isInteger(v.rankIndex) && Number.isInteger(mine) && mine < v.rankIndex) out.push(`${v.title}: grado richiesto ${v.rank ?? v.rankIndex}, il tuo presso ${v.company} è inferiore`);
  if (v.status === 'completata' || v.status === 'fallita' || v.status === 'non_disponibile') out.push(`${v.title}: contratto ${v.status}`);
  return out;
}

const metrics = (r, set, ctx) => {
  const rewards = set.map((c) => c.reward);
  const known = rewards.filter((x) => Number.isFinite(x));
  const accepted = set.filter((c) => c.view.origin === 'utente' && c.view.committed).reduce((s, c) => s + (c.reward ?? 0), 0);
  const total = known.reduce((s, x) => s + x, 0);
  const picks = r.seq.filter((t) => t.type === 'carico').length, drops = r.seq.filter((t) => t.type === 'scarico').length;
  const hours = r.eval.travelTime !== null && ctx.handling?.perScu != null ? (r.eval.travelTime + (ctx.handling.perScu * set.reduce((s, c) => s + c.movements.reduce((a, m) => a + (m.scu ?? 0), 0), 0)) + (ctx.handling.perStop ?? 0) * r.eval.stops) / 3600 : null;
  return {
    rewardAccepted: accepted, rewardUnconfirmed: total - accepted, rewardUnknown: rewards.length - known.length,
    peak: r.peak, pickups: picks, dropoffs: drops, stops: r.eval.stops, distance: r.eval.distance, unknownLegs: r.eval.unknownLegs,
    hours, perHour: hours && rewards.length === known.length ? total / hours : null,
    perGm: r.eval.distance > 0 && !r.eval.unknownLegs ? total / (r.eval.distance / 1e9) : null,
    method: r.method,
  };
};

/**
 * Classificazione di una combinazione di missioni.
 * @param ctx {geo, capacity, ship:{maxBox}, ranks:{company:rankIndex}, start:placeId, end, maxStops, drive, handling}
 */
export function evaluateStack(views, ctx) {
  const reasons = [], missing = [], assumed = [], contracts = [];
  for (const v of views) {
    const p = toPlanning(v, ctx.geo);
    if (!p.ok) { missing.push(...p.missing.map((m) => `${v.title}: ${m}`)); reasons.push(...violations(v, null, ctx)); continue; }
    contracts.push(p.contract); assumed.push(...p.assumed.map((a) => `${v.title}: ${a}`));
    reasons.push(...violations(v, p.contract, ctx));
  }
  if (!ctx.capacity) missing.push('capacità cargo non indicata');
  const base = { views, contracts, missing, assumed, reasons };
  if (reasons.length) return { ...base, cls: 'incompatibile' };
  if (missing.length) return { ...base, cls: 'verificare' };
  const legOf = geoLegOf(ctx.geo, { drive: ctx.drive, prep: ctx.prep });
  const r = routeContracts(contracts, { capacity: ctx.capacity, start: ctx.start ? placeRef(ctx.geo, ctx.start) : null, end: ctx.end ? placeRef(ctx.geo, ctx.end) : null, legOf, maxStops: ctx.maxStops ?? null, priority: ctx.priority ?? 'profitto' });
  if (!r.ok) return { ...base, cls: 'incompatibile', reasons: [r.reason] };
  const warn = [];
  for (const c of contracts) for (const m of c.movements) if ((m.scu ?? 0) - (m.loaded ?? 0) > ctx.capacity) warn.push(`${c.title}: ${m.scu} SCU oltre la capacità, il piano lo divide in più viaggi`);
  if (r.eval.unknownLegs) warn.push(`${r.eval.unknownLegs} tratte di lunghezza non nota (interstellari o senza posizione)`);
  const allAccepted = views.every((v) => v.origin === 'utente' && v.committed);
  return { ...base, cls: allAccepted ? 'eseguibile' : 'potenziale', route: r, metrics: metrics(r, contracts, ctx), warnings: warn };
}

/**
 * "Quali altre missioni posso accumulare con queste?": candidati che condividono luoghi con la
 * selezione, ciascuno valutato insieme alla selezione. Ordine: classe, tipologie certe, ricompensa.
 */
export function suggestStack(selected, index, ctx, { limit = 15 } = {}) {
  const sel = new Set(selected.map((v) => v.id));
  const places = new Set(selected.flatMap((v) => v.ops.flatMap((o) => o.ids)));
  const cand = new Map();
  for (const id of places) {
    const s = index.at.get(id); if (!s) continue;
    for (const e of [...s.out, ...s.in]) if (!sel.has(e.v.id) && keepCandidate(e.v, ctx)) cand.set(e.v.id, e.v);
  }
  const order = { eseguibile: 0, potenziale: 1, verificare: 2, incompatibile: 3 };
  const rows = [...cand.values()].map((v) => {
    const types = selected.flatMap((s) => stackTypes(s, v, ctx.geo));
    return { v, types: dedupeTypes(types) };
  }).filter((x) => x.types.length)
    .sort((a, b) => b.types.filter((t) => t.sure).length - a.types.filter((t) => t.sure).length || (a.v.origin === 'catalogo') - (b.v.origin === 'catalogo') || (b.v.reward ?? -1) - (a.v.reward ?? -1) || a.v.id.localeCompare(b.v.id))
    .slice(0, limit);
  return rows.map((x) => ({ ...x, result: evaluateStack([...selected, x.v], ctx) }))
    .sort((a, b) => order[a.result.cls] - order[b.result.cls] || b.types.filter((t) => t.sure).length - a.types.filter((t) => t.sure).length || (b.result.metrics?.rewardUnconfirmed ?? b.v.reward ?? -1) - (a.result.metrics?.rewardUnconfirmed ?? a.v.reward ?? -1))
    .slice(0, limit);
}
const dedupeTypes = (types) => { const m = new Map(); for (const t of types) { const o = m.get(t.type); if (!o || (t.sure && !o.sure)) m.set(t.type, t); } return [...m.values()]; };
const keepCandidate = (v, ctx) => !(v.origin === 'utente' && ['completata', 'fallita', 'non_disponibile'].includes(v.status)) && (!ctx.hideIllegal || !v.illegal);

/**
 * TROVA LA MIGLIORE COMBINAZIONE per un luogo: missioni con ritiro o consegna li', piu' i contratti
 * gia' accettati (sempre inclusi, mai sacrificati). Tre scenari, selezione progressiva deterministica.
 * @returns {{scenarios:{[k]:{result, added:string[]}}, mandatory, candidates, excluded, notes}}
 */
export function bestStack(placeId, index, ctx, { maxCandidates = 12, maxAdd = 6, timeBudgetMs = 4000 } = {}) {
  const t0 = Date.now();
  const mandatory = index.views.filter((v) => v.origin === 'utente' && v.committed);
  const notes = [];
  const s = index.at.get(placeId) ?? { out: [], in: [] };
  const pool = new Map();
  for (const e of [...s.out, ...s.in]) if (!mandatory.includes(e.v) && keepCandidate(e.v, ctx)) pool.set(e.v.id, e.v);
  if (ctx.destination) for (const e of index.at.get(ctx.destination)?.in ?? []) if (!mandatory.includes(e.v) && keepCandidate(e.v, ctx)) pool.set(e.v.id, e.v);
  const excluded = [], candidates = [];
  for (const v of pool.values()) {
    const p = toPlanning(v, ctx.geo);
    const viol = violations(v, p.contract ?? null, ctx);
    if (!p.ok) excluded.push({ v, why: p.missing[0] });
    else if (viol.length) excluded.push({ v, why: viol[0] });
    else candidates.push(v);
  }
  candidates.sort((a, b) => (b.reward ?? -1) - (a.reward ?? -1) || a.id.localeCompare(b.id));
  const considered = candidates.slice(0, maxCandidates);
  if (candidates.length > maxCandidates) notes.push(`${candidates.length} missioni pianificabili: valutate le ${maxCandidates} con ricompensa più alta (limite di calcolo).`);
  const run = (set) => evaluateStack(set, ctx);
  const base = run(mandatory);
  const out = {};
  for (const key of Object.keys(SCENARIOS)) {
    let cur = base, set = [...mandatory];
    const added = [];
    for (let k = 0; k < maxAdd; k++) {
      if (Date.now() - t0 > timeBudgetMs) { notes.push('tempo di calcolo esaurito: risultato parziale'); break; }
      let best = null;
      for (const v of considered) {
        if (set.includes(v)) continue;
        const r = run([...set, v]);
        if (!r.route) continue;
        if (key === 'viaggio' && cur.route && set.length) {
          const d0 = cur.metrics.distance, d1 = r.metrics.distance;
          if (d1 > d0 * 1.15 + 1 || r.metrics.stops > cur.metrics.stops + 1) continue;
        }
        const k2 = key === 'viaggio' && !set.length ? 'viaggio0' : key;
        if (!best || better(k2, r, best)) best = r;
      }
      if (!best || (cur.route && set.length && !better(key, best, cur, true))) break;
      cur = best; set = best.views.slice(); added.push(set.at(-1).id);
    }
    out[key] = { result: set.length ? cur : null, added };
  }
  if (!candidates.length) notes.push('Nessuna missione pianificabile per questo luogo nei dati disponibili: servono ritiro e consegna certi con le quantità. "Nessuna missione confermata nei dati disponibili" non significa "nessuna missione esistente nel gioco".');
  return { scenarios: out, mandatory, candidates, excluded, notes, base };
}

/** Confronto fra due risultati per uno scenario. strict: il nuovo deve migliorare davvero. */
function better(key, a, b, strict = false) {
  const ma = a.metrics, mb = b.metrics;
  const tot = (m) => m.rewardAccepted + m.rewardUnconfirmed;
  let keys;
  if (key === 'guadagno') keys = [[tot(ma), tot(mb)], [-ma.unknownLegs, -mb.unknownLegs], [-ma.distance, -mb.distance]];
  else if (key === 'efficienza') keys = ma.perHour !== null && mb.perHour !== null ? [[ma.perHour, mb.perHour], [-ma.stops, -mb.stops]] : [[ma.perGm ?? -1, mb.perGm ?? -1], [-ma.stops, -mb.stops], [tot(ma), tot(mb)]];
  else if (key === 'viaggio0') keys = [[-ma.unknownLegs, -mb.unknownLegs], [-ma.distance, -mb.distance], [tot(ma), tot(mb)]];
  else keys = [[tot(ma), tot(mb)], [-ma.distance, -mb.distance]];
  for (const [x, y] of keys) { if (x > y + 1e-9) return true; if (x < y - 1e-9) return false; }
  return !strict && a.views.length < b.views.length;
}
