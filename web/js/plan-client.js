// Avvia il pianificatore nel Web Worker; se il browser non supporta i worker a modulo,
// lo esegue nel thread principale (stesso codice, stessi risultati).
let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./plan-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result); };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'errore nel worker')); pending.clear(); worker = false; };
  } catch { worker = false; }
  return worker;
}

export async function plan(payload) {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.postMessage({ id, payload }); });
    } catch (e) { if (worker !== false) throw e; /* worker non avviabile: ripiego */ }
  }
  const { runPlan } = await import('./plan-worker.js');
  return runPlan(payload);
}
