// Esegue il pianificatore in un thread separato: l'interfaccia resta reattiva anche con
// centinaia di marker (oltre 180.000 combinazioni direzionali). I contesti dei sistemi
// (marker, ostacoli gia' calcolati per coppia) restano in cache finche' i dati non cambiano.
import { buildContext, planRoutes } from './core/plan.js';
import { gatewayLinks } from './core/systems.js';

const cache = new Map(); // sys -> {version, ctx}

export function contextsFrom(systems, store = cache) {
  const contexts = {};
  for (const [sys, d] of Object.entries(systems)) {
    let c = store.get(sys);
    if (!c || c.version !== d.version) {
      c = { version: d.version, ctx: buildContext(sys, d.points, d.model, { verified: new Set(d.verified), unavailable: new Set(d.unavailable) }) };
      store.set(sys, c);
    }
    contexts[sys] = c.ctx;
  }
  return contexts;
}

export function runPlan({ systems, target, start, opts }, store = cache) {
  const contexts = contextsFrom(systems, store);
  const links = gatewayLinks(Object.fromEntries(Object.entries(contexts).map(([s, c]) => [s, c.markers])));
  return { ...planRoutes({ contexts, links, target, start, opts }), links };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e) => {
    const { id, payload } = e.data;
    try { self.postMessage({ id, result: runPlan(payload) }); }
    catch (err) { self.postMessage({ id, error: String(err?.message ?? err) }); }
  };
}
