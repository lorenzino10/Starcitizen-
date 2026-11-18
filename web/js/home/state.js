// Stato della PLANCIA: posizione, nave, destinazione, ultima rotta, recenti, preferiti, visite.
// Vive nelle chiavi "meta" dell'archivio IndexedDB gia' esistente (nessuna modifica di schema, nessun
// punto del DATABASE PUNTI toccato). Senza archivio resta in memoria per la sessione e lo dice.
import { DEFAULT_FLEET, DEFAULT_SHIP, OLD_DEFAULT_SHIP, pushRecent } from './model.js';

export const META_KEYS = { state: 'homeState', recent: 'destRecent', fav: 'destFavorites', visits: 'destVisits' };
const EMPTY = () => ({ position: null, ship: DEFAULT_SHIP, shipNotes: {}, destination: null, lastPlan: null, fleet: null });

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
    this.#initFleet();
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
  /** FLOTTA: i tuoi mezzi (navi, veicoli a ruote, tank). La nave attiva e' state.ship. */
  get fleet() { return this.s.fleet ?? []; }
  /**
   * Prima apertura con la flotta: Hercules C2 + Prospector. Se la nave attiva era ancora la vecchia
   * di serie (Centaurus) passa alla C2; una nave scelta da te resta e viene aggiunta alla flotta.
   * Le note sulle navi non vengono toccate.
   */
  #initFleet() {
    if (Array.isArray(this.s.fleet)) return;
    const fleet = DEFAULT_FLEET.map((v) => ({ ...v }));
    if (!this.s.ship || this.s.ship === OLD_DEFAULT_SHIP) this.s.ship = DEFAULT_SHIP;
    else if (!fleet.some((v) => v.name === this.s.ship)) fleet.unshift({ id: 'f-prev', name: this.s.ship, kind: 'nave' });
    this.s.fleet = fleet;
  }
  addVehicle(v) { this.s.fleet = [...this.fleet, v]; return this.#saveState('ship'); }
  removeVehicle(id) {
    const gone = this.fleet.find((v) => v.id === id);
    this.s.fleet = this.fleet.filter((v) => v.id !== id);
    if (gone && gone.name === this.s.ship) this.s.ship = this.s.fleet.find((v) => v.kind === 'nave')?.name ?? this.s.fleet[0]?.name ?? DEFAULT_SHIP;
    return this.#saveState('ship');
  }
  shipNote(name) { return this.s.shipNotes?.[name] ?? ''; }

  /** pos {system,x,y,z (m), source} - registrata con l'ora della lettura. */
  setPosition(pos) { this.s.position = pos ? { ...pos, at: pos.at ?? new Date().toISOString() } : null; return this.#saveState('position'); }
  setShip(name) { this.s.ship = name || DEFAULT_SHIP; return this.#saveState('ship'); }
  setShipNote(name, text) { this.s.shipNotes = { ...(this.s.shipNotes ?? {}), [name]: text }; if (!text) delete this.s.shipNotes[name]; return this.#saveState('ship'); }
  /** d {id, name, system, pos|null, kind} */
  setDestination(d) { this.s.destination = d ? { ...d, at: new Date().toISOString() } : null; return this.#saveState('destination'); }
  setPlan(p) { this.s.lastPlan = p; return this.#saveState('plan'); }
  /** Preferenze del Command Bridge (filtri del Mission Finder, vista in basso): stessa chiave homeState. */
  get bridge() { return this.s.bridge ?? {}; }
  setBridge(patch) { this.s.bridge = { ...(this.s.bridge ?? {}), ...patch }; return this.#saveState('bridge'); }

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
