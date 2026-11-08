// CARGO MANIFEST & FLIGHT PLAN dell'atlante: un piano nasce da una combinazione valutata
// (evaluateStack), si salva in IndexedDB e si puo' riordinare a mano: ogni modifica viene
// rivalidata (precedenze, capacita', contabilita' per partita) e ricalcolata subito.
import { validateSequence } from '../logistics/optimizer.js';
import { buildManifest } from '../logistics/manifest.js';
import { newId, nowIso } from '../core/points.js';

/** Raggruppa la sequenza in scali consecutivi nello stesso luogo. */
export function stopsOf(seq) {
  const out = [];
  for (const t of seq) {
    const last = out.at(-1);
    if (last && last.place.id === t.place.id) last.tasks.push(t);
    else out.push({ place: t.place, tasks: [t] });
  }
  return out;
}

/** Sposta lo scalo i in posizione j; restituisce la nuova sequenza oppure gli errori (mai applicata se non valida). */
export function moveStop(plan, i, j) {
  const st = stopsOf(plan.seq);
  if (i < 0 || j < 0 || i >= st.length || j >= st.length || i === j) return { ok: false, errors: ['spostamento non valido'] };
  const [x] = st.splice(i, 1); st.splice(j, 0, x);
  const seq = st.flatMap((s) => s.tasks);
  const v = validateSequence(seq, { capacity: plan.capacity, initialLoad: plan.initialLoad ?? 0, held: new Map(plan.held ?? []) });
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, seq, peak: v.peak, loads: v.loads };
}

/** Distanza, tempo e tratte non note di una sequenza (stesse regole dell'ottimizzatore). */
export function measure(seq, legOf, start = null) {
  let pos = start, distance = 0, time = 0, timeKnown = !!start, unknown = 0, stops = 0;
  const legs = [];
  for (const t of seq) {
    if (pos && pos.id === t.place.id) continue;
    stops++;
    if (!pos) { unknown++; timeKnown = false; legs.push({ from: null, to: t.place, distance: null, time: null, note: 'posizione di partenza non indicata' }); pos = t.place; continue; }
    const l = legOf(pos, t.place); legs.push({ from: pos, to: t.place, ...l });
    if (l.distance === null) { unknown++; timeKnown = false; } else { distance += l.distance; if (l.time === null) timeKnown = false; else time += l.time; }
    pos = t.place;
  }
  return { distance, travelTime: timeKnown ? time : null, unknownLegs: unknown, stops, legs };
}

/** Piano salvabile a partire da una combinazione valutata. */
export function planFromStack(result, { name = null, capacity, ship = null, start = null, now = nowIso() } = {}) {
  const r = result.route;
  const held = [];
  for (const c of result.contracts) for (const m of c.movements) if ((m.loaded ?? 0) - (m.delivered ?? 0) > 0) held.push([`${c.id}/${m.id}`, m.loaded - m.delivered]);
  return {
    id: newId(), name: name || `Piano ${now.slice(0, 16).replace('T', ' ')}`, createdAt: now, updatedAt: now,
    capacity, ship: ship ? { name: ship.name, scu: ship.scu, maxBox: ship.maxBox ?? null, grids: ship.grids ?? null } : null,
    start, cls: result.cls, initialLoad: r.initialLoad ?? 0, held,
    contracts: result.contracts.map((c) => ({ id: c.id, title: c.title, company: c.company, reward: c.reward, status: c.status, origin: c.view?.origin ?? null, movements: c.movements })),
    seq: r.seq, method: r.method, assumed: result.assumed ?? [], warnings: result.warnings ?? [],
    opsDone: {},
  };
}

/** Manifesto di un piano salvato (riuso del CARGO MANIFEST della logistica). */
export function manifestOf(plan) {
  return buildManifest({ contracts: plan.contracts, seq: plan.seq, initialLoad: plan.initialLoad }, { ship: plan.ship, capacity: plan.capacity, start: plan.start });
}
