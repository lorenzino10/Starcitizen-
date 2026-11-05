// Archivio locale nel browser (localStorage). Tutto resta sul dispositivo: export/import
// in JSON per backup o per spostare i dati su un altro PC/browser.
// `backend` e' iniettabile per i test (oggetto con getItem/setItem).

const KEY = 'navcom.v1';
const EMPTY = () => ({
  version: 1,
  locations: {},          // system -> {meta, rows}
  customPoints: [],       // {id, name, system, x, y, z, notes, createdAt}
  starmapReadings: [],    // {id, name, system, raw:{...}, notes, createdAt}  NON convertite
  verified: [],           // {start, dest, system, verifiedAt}
  savedRoutes: [],        // {id, name, system, payload, createdAt}
  importLog: [],          // {at, system, origin, ok, stored, gameVersion, errors, warnings}
});

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

export class Store {
  constructor(backend) {
    try { this.backend = backend ?? globalThis.localStorage ?? memory(); } catch { this.backend = memory(); }
    this.persistent = true;
    this.data = this.#load();
  }

  #load() {
    try {
      const raw = this.backend.getItem(KEY);
      return raw ? { ...EMPTY(), ...JSON.parse(raw) } : EMPTY();
    } catch {
      this.persistent = false;
      return EMPTY();
    }
  }

  save() {
    try { this.backend.setItem(KEY, JSON.stringify(this.data)); this.persistent = true; }
    catch { this.persistent = false; }
  }

  #id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  now() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }

  // ---- posizioni ------------------------------------------------------
  /** Sostituisce le posizioni di un sistema solo se l'import e' riuscito e non vuoto. */
  replaceLocations(system, rows, meta, origin) {
    const ok = Array.isArray(rows) && rows.length > 0;
    this.logImport({ system, origin, ok, stored: ok ? rows.length : 0, gameVersion: meta?.gameVersion ?? null });
    if (!ok) return 0;
    this.data.locations[system] = { meta: { ...meta, origin, importedAt: this.now() }, rows };
    this.save();
    return rows.length;
  }

  logImport(entry) {
    this.data.importLog.unshift({ at: this.now(), errors: [], warnings: [], ...entry });
    this.data.importLog = this.data.importLog.slice(0, 50);
    this.save();
  }

  locations(system) { return this.data.locations[system]?.rows ?? []; }
  locationMeta(system) { return this.data.locations[system]?.meta ?? null; }

  // ---- punti personali -------------------------------------------------
  addCustomPoint(p) {
    const i = this.data.customPoints.findIndex((c) => c.system === p.system && c.name === p.name);
    const rec = { id: i >= 0 ? this.data.customPoints[i].id : this.#id(), createdAt: this.now(), notes: '', ...p };
    if (i >= 0) this.data.customPoints[i] = rec; else this.data.customPoints.push(rec);
    this.save();
    return rec;
  }
  customPoints(system) { return this.data.customPoints.filter((c) => c.system === system); }
  deleteCustomPoint(id) { this.data.customPoints = this.data.customPoints.filter((c) => c.id !== id); this.save(); }

  // ---- letture Starmap grezze -----------------------------------------
  addStarmapReading(r) { const rec = { id: this.#id(), createdAt: this.now(), ...r }; this.data.starmapReadings.unshift(rec); this.save(); return rec; }
  starmapReadings(system) { return this.data.starmapReadings.filter((r) => r.system === system); }
  deleteStarmapReading(id) { this.data.starmapReadings = this.data.starmapReadings.filter((r) => r.id !== id); this.save(); }

  // ---- tratte verificate ----------------------------------------------
  markVerified(start, dest, system) {
    if (!this.data.verified.some((v) => v.start === start && v.dest === dest)) {
      this.data.verified.push({ start, dest, system, verifiedAt: this.now() });
      this.save();
    }
  }
  verifiedPairs(system) { return new Set(this.data.verified.filter((v) => v.system === system).map((v) => `${v.start}|${v.dest}`)); }

  // ---- rotte salvate ---------------------------------------------------
  saveRoute(name, system, payload) { const rec = { id: this.#id(), name, system, payload, createdAt: this.now() }; this.data.savedRoutes.unshift(rec); this.save(); return rec; }
  savedRoutes(system) { return this.data.savedRoutes.filter((r) => r.system === system); }
  deleteRoute(id) { this.data.savedRoutes = this.data.savedRoutes.filter((r) => r.id !== id); this.save(); }

  // ---- backup ------------------------------------------------------------
  exportJson() { return JSON.stringify(this.data, null, 1); }
  /** Importa un backup. Le posizioni si sostituiscono, i dati personali si uniscono. */
  importJson(text) {
    const d = JSON.parse(text);
    if (!d || d.version !== 1) throw new Error('file di backup non riconosciuto');
    const merge = (a, b, key) => { const seen = new Set(a.map(key)); return a.concat((b ?? []).filter((x) => !seen.has(key(x)))); };
    this.data.locations = { ...this.data.locations, ...(d.locations ?? {}) };
    this.data.customPoints = merge(this.data.customPoints, d.customPoints, (c) => `${c.system}|${c.name}`);
    this.data.starmapReadings = merge(this.data.starmapReadings, d.starmapReadings, (r) => r.id);
    this.data.verified = merge(this.data.verified, d.verified, (v) => `${v.start}|${v.dest}`);
    this.data.savedRoutes = merge(this.data.savedRoutes, d.savedRoutes, (r) => r.id);
    this.save();
  }
}
