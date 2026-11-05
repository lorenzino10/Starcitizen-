// Archivio permanente del DATABASE PUNTI nel browser: IndexedDB.
// I dati restano su QUESTO browser e QUESTO dispositivo. Si perdono se si cancellano i dati del
// sito (o in navigazione privata alla chiusura): l'esportazione JSON/Excel serve anche da backup.
// Se IndexedDB non e' disponibile si usa la memoria, con avviso: nulla viene salvato.
import { fromLegacy } from '../core/points.js';

const DB_NAME = 'navcom';
const DB_VERSION = 1;

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('transazione annullata'));
});

function explain(err) {
  const n = err?.name ?? '';
  if (n === 'QuotaExceededError') return 'spazio di archiviazione del browser esaurito';
  if (n === 'InvalidStateError' || n === 'SecurityError') return 'il browser non consente l\'archiviazione (navigazione privata o impostazioni)';
  if (n === 'VersionError') return 'archivio creato da una versione più recente di NAVCOM';
  return err?.message ?? String(err);
}

class MemoryBackend {
  constructor() { this.points = new Map(); this.meta = new Map(); }
  async all() { return [...this.points.values()].map((p) => ({ ...p })); }
  async get(id) { const p = this.points.get(id); return p ? { ...p } : null; }
  async putMany(list) { for (const p of list) this.points.set(p.id, { ...p }); }
  async deleteMany(ids) { for (const id of ids) this.points.delete(id); }
  async clear() { this.points.clear(); }
  async getMeta(k) { return this.meta.get(k) ?? null; }
  async setMeta(k, v) { this.meta.set(k, v); }
  close() {}
}

class IdbBackend {
  constructor(db) { this.db = db; }
  static async open(factory) {
    const r = factory.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('points')) {
        const s = db.createObjectStore('points', { keyPath: 'id' });
        s.createIndex('system', 'system');
        s.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    const blocked = new Promise((_, reject) => { r.onblocked = () => reject(new Error('archivio bloccato da un\'altra scheda di NAVCOM aperta: chiudila e ricarica')); });
    const db = await Promise.race([req(r), blocked]);
    db.onversionchange = () => db.close();
    return new IdbBackend(db);
  }
  async all() { return req(this.db.transaction('points').objectStore('points').getAll()); }
  async get(id) { return (await req(this.db.transaction('points').objectStore('points').get(id))) ?? null; }
  async putMany(list) { const tx = this.db.transaction('points', 'readwrite'); const s = tx.objectStore('points'); for (const p of list) s.put(p); await done(tx); }
  async deleteMany(ids) { const tx = this.db.transaction('points', 'readwrite'); const s = tx.objectStore('points'); for (const id of ids) s.delete(id); await done(tx); }
  async clear() { const tx = this.db.transaction('points', 'readwrite'); tx.objectStore('points').clear(); await done(tx); }
  async getMeta(k) { return (await req(this.db.transaction('meta').objectStore('meta').get(k)))?.value ?? null; }
  async setMeta(k, v) { const tx = this.db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ key: k, value: v }); await done(tx); }
  close() { this.db.close(); }
}

export class PointsDB {
  constructor(backend, { persistent, warning = null }) { this.backend = backend; this.persistent = persistent; this.warning = warning; this.listeners = new Set(); }

  /** Apre l'archivio. indexedDB iniettabile per i test. */
  static async open({ indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) return new PointsDB(new MemoryBackend(), { persistent: false, warning: 'IndexedDB non disponibile in questo browser: i punti NON verranno salvati alla chiusura. Esporta il database prima di uscire.' });
    try {
      return new PointsDB(await IdbBackend.open(indexedDB), { persistent: true });
    } catch (e) {
      return new PointsDB(new MemoryBackend(), { persistent: false, warning: `Archivio permanente non disponibile (${explain(e)}): i punti restano solo fino alla chiusura della pagina. Esporta il database per non perderli.` });
    }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #changed() { for (const fn of this.listeners) { try { fn(); } catch { /* listener */ } } }
  async #write(fn) {
    try { await fn(); } catch (e) { throw new Error(`Salvataggio non riuscito: ${explain(e)}`); }
    this.#changed();
  }

  async all() { return (await this.backend.all()).sort((a, b) => a.name.localeCompare(b.name, 'it')); }
  get(id) { return this.backend.get(id); }
  put(point) { return this.#write(() => this.backend.putMany([point])); }
  putMany(points) { return points.length ? this.#write(() => this.backend.putMany(points)) : Promise.resolve(); }
  delete(id) { return this.#write(() => this.backend.deleteMany([id])); }
  deleteMany(ids) { return ids.length ? this.#write(() => this.backend.deleteMany(ids)) : Promise.resolve(); }
  /** Ripristino: sostituisce tutto il contenuto. */
  replaceAll(points) { return this.#write(async () => { await this.backend.clear(); await this.backend.putMany(points); }); }
  getMeta(k) { return this.backend.getMeta(k); }
  setMeta(k, v) { return this.backend.setMeta(k, v); }
  close() { this.backend.close(); }

  /**
   * Migrazione dei punti personali della versione precedente (localStorage). Ogni punto viene
   * migrato una sola volta (anche se poi lo elimini dal database non ricompare).
   * @returns {Promise<number>} punti migrati
   */
  async migrateLegacy(customPoints) {
    const done = new Set((await this.getMeta('migratedLegacyIds')) ?? []);
    const todo = customPoints.filter((c) => c.id && !done.has(c.id));
    if (!todo.length) return 0;
    const recs = todo.map((c) => fromLegacy(c).point).filter(Boolean);
    await this.putMany(recs);
    for (const c of todo) done.add(c.id);
    await this.setMeta('migratedLegacyIds', [...done]);
    return recs.length;
  }
}

/** Chiede al browser di non cancellare automaticamente l'archivio (se supportato). */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}
