// Stato della PLANCIA: posizione, nave, destinazione, ultima rotta, recenti, preferiti, visite.
// Vive nelle chiavi "meta" dell'archivio IndexedDB gia' esistente (nessuna modifica di schema, nessun
// punto del DATABASE PUNTI toccato). Senza archivio resta in memoria per la sessione e lo dice.
import { DEFAULT_SHIP, pushRecent } from './model.js';

export const META_KEYS = { state: 'homeState', recent: 'destRecent', fav: 'destFavorites', visits: 'destVisits' };
const EMPTY = () => ({ position: null, ship: DEFAULT_SHIP, shipNotes: {}, destination: null, lastPlan: null });

export class HomeState {
  /** @param db funzione che restituisce l'archivio (getMeta/setMeta) o null */
  constructor(db) {
    this.db = db; this.s = EMPTY(); this.recent = []; this.fav = []; this.visits = [];
    this.persistent = false; this.listeners = new Set();
  }

  async load() {
    const db = this.db?.();
    this.persistent = !!db;
    if (!db) return this;
    try {
      this.s = { ...EMPTY(), ...((await db.getMeta(META_KEYS.state)) ?? {}) };
      this.recent = (await db.getMeta(META_KEYS.recent)) ?? [];
      this.fav = (await db.getMeta(META_KEYS.fav)) ?? [];
      this.visits = (await db.getMeta(META_KEYS.visits)) ?? [];
    } catch { this.persistent = false; }
    return this;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (e) { console.warn(e); } } }
  async #put(key, value, what) {
    const db = this.db?.();
    if (db) { try { await db.setMeta(key, value); this.persistent = true; } catch (e) { this.persistent = false; console.warn('stato plancia non salvato', e); } }
    this.#emit(what);
  }
  #saveState(what) { return this.#put(META_KEYS.state, this.s, what); }

  get position() { return this.s.position; }
  get ship() { return this.s.ship; }
  get destination() { return this.s.destination; }
  get lastPlan() { return this.s.lastPlan; }
  shipNote(name) { return this.s.shipNotes?.[name] ?? ''; }

  /** pos {system,x,y,z (m), source} - registrata con l'ora della lettura. */
  setPosition(pos) { this.s.position = pos ? { ...pos, at: pos.at ?? new Date().toISOString() } : null; return this.#saveState('position'); }
  setShip(name) { this.s.ship = name || DEFAULT_SHIP; return this.#saveState('ship'); }
  setShipNote(name, text) { this.s.shipNotes = { ...(this.s.shipNotes ?? {}), [name]: text }; if (!text) delete this.s.shipNotes[name]; return this.#saveState('ship'); }
  /** d {id, name, system, pos|null, kind} */
  setDestination(d) { this.s.destination = d ? { ...d, at: new Date().toISOString() } : null; return this.#saveState('destination'); }
  setPlan(p) { this.s.lastPlan = p; return this.#saveState('plan'); }

  addRecent(e) { this.recent = pushRecent(this.recent, { ...e, at: new Date().toISOString() }); return this.#put(META_KEYS.recent, this.recent, 'recent'); }
  isFav(id) { return this.fav.some((f) => f.id === id); }
  toggleFav(e) {
    this.fav = this.isFav(e.id) ? this.fav.filter((f) => f.id !== e.id) : [{ ...e, at: new Date().toISOString() }, ...this.fav];
    return this.#put(META_KEYS.fav, this.fav, 'fav');
  }
  /** Visita: solo quando la confermi tu (nessun rilevamento automatico). */
  markVisited(e) { this.visits = [{ ...e, at: new Date().toISOString() }, ...this.visits].slice(0, 200); return this.#put(META_KEYS.visits, this.visits, 'visits'); }
  lastVisit(id) { return this.visits.find((v) => v.id === id) ?? null; }

  /** Per il backup: tutto quello che la plancia ha salvato. */
  exportJson() { return { [META_KEYS.state]: this.s, [META_KEYS.recent]: this.recent, [META_KEYS.fav]: this.fav, [META_KEYS.visits]: this.visits }; }
}
