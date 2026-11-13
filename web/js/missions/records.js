// Registro personale del MISSION CONTROL: offerte viste nel mobiGlas, accettate, completate, fallite,
// e PLAYER PROFILE. Vive nelle chiavi "meta" dell'archivio della logistica (IndexedDB "navcom-logistics"):
// nessuna modifica di schema, nessun dato esistente toccato, indipendente dal catalogo (che si aggiorna).
// "ACCETTATA" aggiorna solo questo archivio: NAVCOM non sa e non dice se il contratto e' accettato nel gioco.
import { EMPTY_PROFILE, RECORD_STATES } from './control.js';

export const MC_KEYS = { records: 'mcRecords', profile: 'playerProfile' };
const now = () => new Date().toISOString();
const rid = () => `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Nuovo record da un modello del catalogo (titolo e identificativi copiati dal modello, mai inventati). */
export function newRecord(v, { status = 'visibile', reward = null, offerAt = null, notes = '', contractId = null, patch = null, locations = null } = {}) {
  if (!RECORD_STATES.includes(status)) throw new Error(`stato "${status}" non valido (${RECORD_STATES.join(', ')})`);
  const r = reward === '' || reward === null || reward === undefined ? null : Number(reward);
  if (r !== null && !(r >= 0)) throw new Error('ricompensa non valida');
  const t = now();
  return {
    id: rid(), ref: { id: v.id, uuid: v.uuid ?? null, group: v.group ?? null, title: v.title, titleStatus: v.titleStatus ?? null, category: v.category ?? null, type: v.type ?? null, company: v.company ?? null, patch: v.patch ?? null },
    status, reward: r, offerAt: offerAt || null, locations: locations ?? null, notes: String(notes ?? ''), contractId, patch,
    createdAt: t, updatedAt: t, history: [{ status, at: t }],
  };
}
/** Cambio di stato con storico (solo stati dell'utente). */
export function withStatus(rec, status) {
  if (!RECORD_STATES.includes(status)) throw new Error(`stato "${status}" non valido`);
  const t = now();
  return { ...rec, status, updatedAt: t, history: [...(rec.history ?? []), { status, at: t }] };
}
/** Indice catalogo -> registrazioni. */
export function byCatalog(records) {
  const m = new Map();
  for (const r of records) { const k = r.ref?.id; if (!k) continue; const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
  return m;
}
/** Profilo ripulito (valori validi, nessun default che presuma un grado). */
export function cleanProfile(p) {
  const e = EMPTY_PROFILE();
  if (!p || typeof p !== 'object') return e;
  const crime = p.crime === '' || p.crime === null || p.crime === undefined ? null : Number(p.crime);
  return {
    standings: (p.standings ?? []).filter((s) => s?.faction && (s.standing || Number.isFinite(+s.rep))).map((s) => ({ faction: String(s.faction), scope: s.scope || null, standing: s.standing || null, rep: s.rep === '' || s.rep === null || s.rep === undefined ? null : Number(s.rep) })),
    completed: (p.completed ?? []).filter((c) => c?.uuid || c?.title).map((c) => ({ uuid: c.uuid ?? null, title: c.title ?? null })),
    tags: [...new Set((p.tags ?? []).filter(Boolean).map(String))],
    crime: Number.isInteger(crime) && crime >= 0 && crime <= 5 ? crime : null,
    notes: String(p.notes ?? ''), updatedAt: p.updatedAt ?? null,
  };
}

/** Accesso all'archivio (db = LogisticsDB o qualsiasi oggetto con getMeta/setMeta). */
export class McStore {
  constructor(db) { this.db = db; this.records = []; this.profile = EMPTY_PROFILE(); this.listeners = new Set(); }
  async load() {
    if (!this.db) return this;
    this.records = (await this.db.getMeta(MC_KEYS.records).catch(() => null)) ?? [];
    this.profile = cleanProfile(await this.db.getMeta(MC_KEYS.profile).catch(() => null));
    return this;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(what) { for (const f of this.listeners) { try { f(what); } catch (e) { console.warn(e); } } }
  async #saveRecords() { if (this.db) await this.db.setMeta(MC_KEYS.records, this.records); this.#emit('records'); }
  async add(rec) { this.records = [rec, ...this.records]; await this.#saveRecords(); return rec; }
  async setStatus(id, status) { this.records = this.records.map((r) => (r.id === id ? withStatus(r, status) : r)); await this.#saveRecords(); return this.records.find((r) => r.id === id); }
  async update(id, patch) { this.records = this.records.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now() } : r)); await this.#saveRecords(); }
  async remove(id) { this.records = this.records.filter((r) => r.id !== id); await this.#saveRecords(); }
  async saveProfile(p) { this.profile = { ...cleanProfile(p), updatedAt: now() }; if (this.db) await this.db.setMeta(MC_KEYS.profile, this.profile); this.#emit('profile'); return this.profile; }
  exportJson() { return { [MC_KEYS.records]: this.records, [MC_KEYS.profile]: this.profile }; }
}
