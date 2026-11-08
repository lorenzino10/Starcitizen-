// Archivio della logistica nel browser: IndexedDB, database separato "navcom-logistics" (il
// DATABASE PUNTI "navcom" non viene toccato ne' aggiornato di versione). Stesse regole: i dati
// restano su questo browser; senza IndexedDB si lavora in memoria e lo si dice.
const DB_NAME = 'navcom-logistics';
const DB_VERSION = 1;
const STORES = ['contracts', 'observations'];

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('transazione annullata')); });

class Memory {
  constructor() { this.s = { contracts: new Map(), observations: new Map(), meta: new Map() }; }
  async all(st) { return [...this.s[st].values()].map((x) => structuredClone(x)); }
  async putMany(st, list) { for (const x of list) this.s[st].set(x.id, structuredClone(x)); }
  async deleteMany(st, ids) { for (const id of ids) this.s[st].delete(id); }
  async clear(st) { this.s[st].clear(); }
  async getMeta(k) { return this.s.meta.has(k) ? structuredClone(this.s.meta.get(k)) : null; }
  async setMeta(k, v) { this.s.meta.set(k, structuredClone(v)); }
  close() {}
}

class Idb {
  constructor(db) { this.db = db; }
  static async open(factory) {
    const r = factory.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const st of STORES) if (!db.objectStoreNames.contains(st)) db.createObjectStore(st, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    const blocked = new Promise((_, reject) => { r.onblocked = () => reject(new Error('archivio bloccato da un\'altra scheda di NAVCOM aperta')); });
    const db = await Promise.race([req(r), blocked]);
    db.onversionchange = () => db.close();
    return new Idb(db);
  }
  async all(st) { return req(this.db.transaction(st).objectStore(st).getAll()); }
  async putMany(st, list) { const tx = this.db.transaction(st, 'readwrite'); const s = tx.objectStore(st); for (const x of list) s.put(x); await done(tx); }
  async deleteMany(st, ids) { const tx = this.db.transaction(st, 'readwrite'); const s = tx.objectStore(st); for (const id of ids) s.delete(id); await done(tx); }
  async clear(st) { const tx = this.db.transaction(st, 'readwrite'); tx.objectStore(st).clear(); await done(tx); }
  async getMeta(k) { return (await req(this.db.transaction('meta').objectStore('meta').get(k)))?.value ?? null; }
  async setMeta(k, v) { const tx = this.db.transaction('meta', 'readwrite'); tx.objectStore('meta').put({ key: k, value: v }); await done(tx); }
  close() { this.db.close(); }
}

export class LogisticsDB {
  constructor(backend, { persistent, warning = null }) { this.b = backend; this.persistent = persistent; this.warning = warning; this.listeners = new Set(); }
  static async open({ indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) return new LogisticsDB(new Memory(), { persistent: false, warning: 'IndexedDB non disponibile: contratti e osservazioni restano solo fino alla chiusura della pagina. Esporta il backup.' });
    try { return new LogisticsDB(await Idb.open(indexedDB), { persistent: true }); }
    catch (e) { return new LogisticsDB(new Memory(), { persistent: false, warning: `Archivio permanente non disponibile (${e.message}): i dati restano solo fino alla chiusura della pagina.` }); }
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #changed() { for (const fn of this.listeners) { try { fn(); } catch { /* listener */ } } }
  async #w(fn) { await fn(); this.#changed(); }
  contracts() { return this.b.all('contracts'); }
  observations() { return this.b.all('observations'); }
  putContracts(list) { return list.length ? this.#w(() => this.b.putMany('contracts', list)) : Promise.resolve(); }
  putObservations(list) { return list.length ? this.#w(() => this.b.putMany('observations', list)) : Promise.resolve(); }
  deleteContracts(ids) { return this.#w(() => this.b.deleteMany('contracts', ids)); }
  deleteObservations(ids) { return this.#w(() => this.b.deleteMany('observations', ids)); }
  getMeta(k) { return this.b.getMeta(k); }
  setMeta(k, v) { return this.b.setMeta(k, v); }
  async replaceAll({ contracts = [], observations = [] }) {
    await this.#w(async () => {
      await this.b.clear('contracts'); await this.b.clear('observations');
      await this.b.putMany('contracts', contracts); await this.b.putMany('observations', observations);
    });
  }
  close() { this.b.close(); }
}
