// DATABASE PUNTI: modello dei dati, validazione, duplicati, filtri, import/export.
// Regola fondamentale: NAVCOM non genera coordinate e non crea destinazioni. Ogni punto nasce
// da un inserimento manuale, da un file Excel/JSON dell'utente o dalle coordinate che l'utente
// ha gia' scritto nel pianificatore.

export const SYSTEMS = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
export const CATEGORIES = ['Mining', 'Esplorazione', 'Relitto', 'Punto personale', 'Altro'];
export const STATUSES = ['Da verificare', 'Verificato', 'Non interessante'];
/** Sinonimi accettati in import (senza avviso). "Da georeferenziare" = scheda senza XYZ ancora da verificare. */
const STATUS_ALIASES = { 'da georeferenziare': 'Da verificare', 'da controllare': 'Da verificare' };
export const PRIORITIES = ['Alta', 'Media', 'Bassa'];
export const UNITS = { km: 1000, m: 1 };
/** Tolleranza per considerare due punti "alle stesse coordinate" (m). */
export const DUPLICATE_TOLERANCE_M = 1;

export const FIELDS = [
  { key: 'name', label: 'Nome del punto', aliases: ['nome', 'name', 'punto', 'nome punto', 'destinazione'] },
  { key: 'system', label: 'Sistema stellare', aliases: ['sistema', 'system', 'sistema stellare', 'star system'] },
  { key: 'x', label: 'Coordinata X', aliases: ['x', 'coordinata x', 'coord x', 'pos x'] },
  { key: 'y', label: 'Coordinata Y', aliases: ['y', 'coordinata y', 'coord y', 'pos y'] },
  { key: 'z', label: 'Coordinata Z', aliases: ['z', 'coordinata z', 'coord z', 'pos z'] },
  { key: 'unit', label: 'Unità di misura', aliases: ['unita', 'unità', 'unit', 'unita di misura', 'unità di misura', 'um'] },
  { key: 'category', label: 'Categoria', aliases: ['categoria', 'category', 'tipo'] },
  { key: 'resource', label: 'Materiale o risorsa', aliases: ['materiale', 'risorsa', 'materiale o risorsa', 'risorsa cercata', 'materiale/risorsa', 'resource', 'minerale'] },
  { key: 'group', label: 'Classificazione', aliases: ['classificazione', 'gruppo', 'group', 'classe'] },
  { key: 'priority', label: 'Priorità', aliases: ['priorita', 'priority'] },
  { key: 'sourceRef', label: 'Fonte dei dati', aliases: ['fonte dei dati', 'fonte dati', 'fonte geometria', 'fonte'] },
  { key: 'method', label: 'Metodo di origine', aliases: ['metodo di origine', 'metodo'] },
  { key: 'resourceSource', label: 'Fonte risorse', aliases: ['fonte risorse', 'fonte delle risorse'] },
  // coordinate planetarie: conservate come scritte, MAI convertite in XYZ di sistema (il corpo ruota)
  { key: 'body', label: 'Corpo celeste', aliases: ['corpo celeste', 'corpo', 'body', 'pianeta/luna', 'pianeta o luna'] },
  { key: 'lat', label: 'Latitudine (°)', aliases: ['latitudine', 'latitudine (°)', 'latitudine (gradi)', 'lat', 'latitude'] },
  { key: 'lon', label: 'Longitudine (°)', aliases: ['longitudine', 'longitudine (°)', 'longitudine (gradi)', 'lon', 'long', 'longitude'] },
  { key: 'alt', label: 'Altitudine (m)', aliases: ['altitudine (m)', 'altitudine', 'alt', 'altitude'] },
  { key: 'localX', label: 'X locale (km)', aliases: ['x locale (km)', 'x locale'] },
  { key: 'localY', label: 'Y locale (km)', aliases: ['y locale (km)', 'y locale'] },
  { key: 'localZ', label: 'Z locale (km)', aliases: ['z locale (km)', 'z locale'] },
  { key: 'planetFrame', label: 'Sistema di riferimento planetario', aliases: ['sistema di riferimento planetario', 'sistema di riferimento', 'riferimento coordinate', 'riferimento planetario', 'frame'] },
  { key: 'status', label: 'Stato', aliases: ['stato', 'status'] },
  { key: 'notes', label: 'Note personali', aliases: ['note', 'notes', 'note personali', 'commento'] },
  { key: 'createdAt', label: 'Data di inserimento', aliases: ['data inserimento', 'data di inserimento', 'inserito', 'creato', 'created'] },
  { key: 'verifiedAt', label: 'Data ultima verifica', aliases: ['data verifica', 'ultima verifica', 'data ultima verifica', "data dell'ultima verifica", 'verificato il', 'verificato'] },
  { key: 'id', label: 'ID', aliases: ['id', 'id univoco'] },
];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * Numero da cella o testo. Accetta 1234.5, "1234,5", "1.234,5", "1,234.5", "1 234,5", "-1,2e9".
 * Un solo punto seguito da esattamente tre cifre ("1.234") e' ambiguo: letto come decimale, con avviso.
 * @returns {{value:number|null, error?:string, warning?:string}}
 */
export function parseNumber(v) {
  if (blank(v)) return { value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v } : { value: null, error: 'numero non valido' };
  let t = String(v).trim().replace(/[\s'  ]/g, '');
  let warning;
  const dots = (t.match(/\./g) ?? []).length, commas = (t.match(/,/g) ?? []).length;
  if (dots && commas) {
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (commas > 1) t = t.replace(/,/g, '');
  else if (commas === 1) t = t.replace(',', '.');
  else if (dots > 1) t = t.replace(/\./g, '');
  else if (dots === 1 && /^-?\d{1,3}\.\d{3}$/.test(t)) warning = `"${v}" è ambiguo (migliaia o decimali?): letto come ${Number(t)}`;
  const n = Number(t);
  if (!Number.isFinite(n) || t === '') return { value: null, error: `"${v}" non è un numero` };
  return { value: n, warning };
}

export function parseSystem(v) {
  const k = norm(v);
  for (const [id, label] of Object.entries(SYSTEMS)) if (k === id || k === norm(label)) return id;
  return null;
}
export function parseUnit(v) {
  const k = norm(v);
  if (['km', 'chilometri', 'kilometri', 'kilometers', 'kilometres', 'chilometro'].includes(k)) return 'km';
  if (['m', 'metri', 'metro', 'meters', 'metres'].includes(k)) return 'm';
  return null;
}
export function parseCategory(v) { const k = norm(v); return CATEGORIES.find((c) => norm(c) === k) ?? null; }
export function parseStatus(v) { const k = norm(v); return STATUSES.find((c) => norm(c) === k) ?? STATUS_ALIASES[k] ?? null; }
/** Priorità: Alta/Media/Bassa; vuota o "non assegnata" -> ''. null = valore non riconosciuto. */
export function parsePriority(v) {
  const k = norm(v);
  if (!k || k === 'non assegnata' || k === 'nessuna' || k === '-') return '';
  return PRIORITIES.find((c) => norm(c) === k) ?? null;
}

/** Data da cella Excel (ISO gia' convertita, numero seriale), Date, "gg/mm/aaaa [hh:mm]" o ISO. */
export function parseDate(v) {
  if (blank(v)) return { value: null };
  if (v instanceof Date) return Number.isNaN(+v) ? { value: null, error: 'data non valida' } : { value: v.toISOString().replace(/\.\d+Z$/, 'Z') };
  if (typeof v === 'number') return { value: new Date(Math.round((v - 25569) * 86400000)).toISOString().replace(/\.\d+Z$/, 'Z') };
  const s = String(v).trim();
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (it) {
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = it;
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
    if (dt.getUTCDate() !== +d || dt.getUTCMonth() !== +mo - 1) return { value: null, error: `data "${s}" non valida` };
    return { value: dt.toISOString().replace(/\.\d+Z$/, 'Z') };
  }
  const t = Date.parse(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && Number.isFinite(t)) return { value: new Date(t).toISOString().replace(/\.\d+Z$/, 'Z') };
  return { value: null, error: `data "${s}" non riconosciuta (usa gg/mm/aaaa)` };
}

/**
 * Valida e normalizza un punto. input: campi grezzi (testo o numeri).
 * @param {object} opts {defaultUnit, defaultSystem, keepId}
 * @returns {{point:object|null, errors:string[], warnings:string[], complete:boolean}}
 */
export function normalizePoint(input, { defaultUnit = null, defaultSystem = null, now = nowIso() } = {}) {
  const errors = [], warnings = [];
  const name = String(input.name ?? '').trim();
  if (!name) errors.push('nome mancante');
  let system = parseSystem(input.system);
  if (!system && blank(input.system) && defaultSystem) system = defaultSystem;
  if (!system) errors.push(blank(input.system) ? 'sistema mancante' : `sistema "${input.system}" sconosciuto (ammessi: Stanton, Pyro, Nyx)`);
  const coords = {};
  for (const k of ['x', 'y', 'z']) {
    const r = parseNumber(input[k]);
    if (r.error) errors.push(`${k.toUpperCase()}: ${r.error}`);
    if (r.warning) warnings.push(`${k.toUpperCase()}: ${r.warning}`);
    coords[k] = r.value;
  }
  const complete = ['x', 'y', 'z'].every((k) => coords[k] !== null);
  const any = ['x', 'y', 'z'].some((k) => coords[k] !== null);
  let unit = parseUnit(input.unit);
  if (!unit && !blank(input.unit)) errors.push(`unità "${input.unit}" non valida (usa km o m)`);
  if (!unit && blank(input.unit)) {
    if (defaultUnit) unit = defaultUnit;
    else if (any) errors.push('unità di misura mancante');
    else unit = 'km';
  }
  if (!complete) warnings.push(any ? 'coordinate incomplete: scheda conservata ma non inviabile al pianificatore' : 'nessuna coordinata: scheda incompleta');
  let category = parseCategory(input.category);
  if (!category) { if (!blank(input.category)) warnings.push(`categoria "${input.category}" non prevista: impostata "Altro"`); category = 'Altro'; }
  let status = parseStatus(input.status);
  if (!status) { if (!blank(input.status)) warnings.push(`stato "${input.status}" non previsto: impostato "Da verificare"`); status = 'Da verificare'; }
  let priority = parsePriority(input.priority);
  if (priority === null) { warnings.push(`priorità "${input.priority}" non prevista (Alta, Media, Bassa): lasciata vuota`); priority = ''; }
  // coordinate planetarie (facoltative): solo controllo di formato e di intervallo, nessuna conversione
  const planet = {};
  for (const [k, label, min, max] of [['lat', 'latitudine', -90, 90], ['lon', 'longitudine', -180, 360], ['alt', 'altitudine', -Infinity, Infinity], ['localX', 'X locale', -Infinity, Infinity], ['localY', 'Y locale', -Infinity, Infinity], ['localZ', 'Z locale', -Infinity, Infinity]]) {
    const r = parseNumber(input[k]);
    if (r.error) warnings.push(`${label}: ${r.error} (campo lasciato vuoto)`);
    else if (r.value !== null && (r.value < min || r.value > max)) { warnings.push(`${label} ${r.value} fuori intervallo (${min}…${max}): campo lasciato vuoto`); r.value = null; }
    planet[k] = r.error ? null : r.value;
  }
  const hasPlanet = !blank(input.body) || planet.lat !== null || planet.lon !== null;
  if (hasPlanet && !complete) warnings.push('coordinate planetarie conservate ma non convertite in XYZ di sistema: CALCOLA ROTTA non disponibile');
  const created = parseDate(input.createdAt), verified = parseDate(input.verifiedAt);
  if (created.error) warnings.push(`data di inserimento: ${created.error}`);
  if (verified.error) warnings.push(`data di verifica: ${verified.error}`);
  // campi effettivamente presenti nell'input (servono per aggiornare un punto senza cancellare il resto)
  const provided = Object.keys(input).filter((k) => !blank(input[k]) && k !== 'source');
  if (errors.length) return { point: null, errors, warnings, complete, provided };
  return {
    point: {
      id: blank(input.id) ? newId() : String(input.id).trim(),
      name, system, x: coords.x, y: coords.y, z: coords.z, unit,
      category, resource: String(input.resource ?? '').trim(), status, notes: String(input.notes ?? '').trim(),
      group: String(input.group ?? '').trim(), priority, sourceRef: String(input.sourceRef ?? '').trim(),
      method: String(input.method ?? '').trim(), resourceSource: String(input.resourceSource ?? '').trim(),
      body: String(input.body ?? '').trim(), ...planet, planetFrame: String(input.planetFrame ?? '').trim(),
      createdAt: created.value ?? now, verifiedAt: verified.value ?? null, updatedAt: now,
      source: input.source ?? 'manuale',
      ...(input.legacyId ? { legacyId: input.legacyId } : {}),
    },
    errors, warnings, complete, provided,
  };
}

/** Ha coordinate planetarie (corpo e/o lat/lon) conservate? */
export const hasPlanetary = (p) => Boolean(p.body) || (typeof p.lat === 'number' && typeof p.lon === 'number');

/**
 * Aggiornamento da import: sovrascrive SOLO i campi presenti (non vuoti) nella riga importata;
 * tutto il resto del punto esistente resta com'era. X/Y/Z e unita' si aggiornano insieme.
 */
export function mergeUpdate(existing, incoming, provided = null) {
  const keys = provided ? new Set(provided) : new Set(Object.keys(incoming).filter((k) => incoming[k] !== '' && incoming[k] !== null && incoming[k] !== undefined));
  const out = { ...existing };
  const coordKeys = ['x', 'y', 'z', 'unit'];
  if (coordKeys.some((k) => keys.has(k) && k !== 'unit')) for (const k of coordKeys) out[k] = incoming[k];
  const skip = new Set(['id', 'createdAt', 'source', 'updatedAt', ...coordKeys]);
  for (const k of keys) if (!skip.has(k) && incoming[k] !== null && incoming[k] !== undefined && incoming[k] !== '') out[k] = incoming[k];
  out.updatedAt = nowIso();
  return out;
}

export const isComplete = (p) => [p.x, p.y, p.z].every((v) => typeof v === 'number' && Number.isFinite(v));
/** Coordinate in metri (frame del sistema) oppure null se la scheda e' incompleta. */
export function toMeters(p) {
  if (!isComplete(p)) return null;
  const k = UNITS[p.unit] ?? 1;
  return { x: p.x * k, y: p.y * k, z: p.z * k };
}

/**
 * Avvisi di plausibilita' (non bloccano): punto oltre la regione dei dati del sistema.
 * rMax: distanza dall'origine del punto noto piu' lontano del sistema (m), se disponibile.
 */
export function plausibility(p, rMax) {
  const m = toMeters(p);
  if (!m || !(rMax > 0)) return [];
  const r = Math.hypot(m.x, m.y, m.z);
  const out = [];
  if (r > rMax * 1.05) {
    out.push(`a ${(r / 1e9).toFixed(2)} Gm dall'origine, oltre i dati di ${SYSTEMS[p.system]} (${(rMax / 1e9).toFixed(2)} Gm)`);
    if (p.unit === 'km' && r / 1000 <= rMax * 1.05) out.push('i valori sembrano metri: controlla l\'unità (scelto km)');
  } else if (p.unit === 'm' && r < 1e8 && r * 1000 <= rMax * 1.05) out.push('il punto è vicinissimo al centro del sistema: i valori sono forse in km?');
  return out;
}

/** Due punti sono duplicati se: stesso sistema e coordinate entro la tolleranza, oppure stesso nome. */
export function duplicateReason(a, b, tol = DUPLICATE_TOLERANCE_M) {
  if (a.system !== b.system) return null;
  const ma = toMeters(a), mb = toMeters(b);
  if (ma && mb && Math.hypot(ma.x - mb.x, ma.y - mb.y, ma.z - mb.z) <= tol) return 'coordinate';
  if (norm(a.name) && norm(a.name) === norm(b.name)) return 'nome';
  return null;
}

/**
 * Indice per trovare i duplicati senza confronti a coppie (migliaia di punti): per ID, per nome
 * nello stesso sistema e per celle di una griglia di lato pari alla tolleranza (si controllano le
 * 27 celle vicine, poi la distanza esatta). Stesse regole di duplicateReason.
 */
export class DupIndex {
  constructor(points = [], tol = DUPLICATE_TOLERANCE_M) {
    this.tol = tol; this.byId = new Map(); this.byName = new Map(); this.grid = new Map();
    for (const p of points) this.add(p);
  }
  #cells(p, m, around) {
    const c = [m.x, m.y, m.z].map((v) => Math.floor(v / this.tol));
    if (!around) return [`${p.system}|${c.join('|')}`];
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) out.push(`${p.system}|${c[0] + i}|${c[1] + j}|${c[2] + k}`);
    return out;
  }
  #push(map, k, p) { const a = map.get(k); if (a) a.push(p); else map.set(k, [p]); }
  #pull(map, k, p) { const a = map.get(k); if (!a) return; const i = a.indexOf(p); if (i >= 0) a.splice(i, 1); if (!a.length) map.delete(k); }
  add(p) {
    if (p.id) this.byId.set(p.id, p);
    const n = norm(p.name); if (n) this.#push(this.byName, `${p.system}|${n}`, p);
    const m = toMeters(p); if (m) this.#push(this.grid, this.#cells(p, m, false)[0], p);
  }
  remove(p) {
    if (p.id && this.byId.get(p.id) === p) this.byId.delete(p.id);
    const n = norm(p.name); if (n) this.#pull(this.byName, `${p.system}|${n}`, p);
    const m = toMeters(p); if (m) this.#pull(this.grid, this.#cells(p, m, false)[0], p);
  }
  /** Punti a coordinate entro la tolleranza (stesso sistema), escluso rec. */
  near(rec) {
    const m = toMeters(rec); if (!m) return [];
    const out = [];
    for (const k of this.#cells(rec, m, true)) for (const e of this.grid.get(k) ?? []) {
      if (e === rec) continue;
      const me = toMeters(e);
      if (Math.hypot(me.x - m.x, me.y - m.y, me.z - m.z) <= this.tol) out.push(e);
    }
    return out;
  }
  sameName(rec) { const n = norm(rec.name); return n ? (this.byName.get(`${rec.system}|${n}`) ?? []).filter((e) => e !== rec) : []; }
  /** Esistente che corrisponde a rec: prima per ID, poi per coordinate, poi per nome. */
  find(rec) {
    const byId = rec.id ? this.byId.get(rec.id) : null;
    if (byId && byId !== rec) return { point: byId, reason: 'ID' };
    const c = this.near(rec)[0]; if (c) return { point: c, reason: 'coordinate' };
    const n = this.sameName(rec)[0]; if (n) return { point: n, reason: 'nome' };
    return null;
  }
}

/** Gruppi di duplicati nel database: [{reason, ids}]. */
export function findDuplicates(points, tol = DUPLICATE_TOLERANCE_M) {
  const idx = new DupIndex(points, tol);
  const order = new Map(points.map((p, i) => [p, i]));
  const groups = [];
  const seen = new Set();
  points.forEach((p, i) => {
    if (seen.has(p)) return;
    const byCoord = idx.near(p).filter((e) => order.get(e) > i && !seen.has(e));
    const byName = idx.sameName(p).filter((e) => order.get(e) > i && !seen.has(e) && !byCoord.includes(e));
    const all = [...byCoord, ...byName].sort((a, b) => order.get(a) - order.get(b));
    if (!all.length) return;
    for (const e of all) seen.add(e);
    groups.push({ reason: byCoord.length ? 'coordinate' : 'nome', ids: [p.id, ...all.map((e) => e.id)] });
  });
  return groups;
}

export function findExisting(rec, existing, tol = DUPLICATE_TOLERANCE_M) {
  return new DupIndex(existing, tol).find(rec);
}

/** Filtri della tabella. criteria: {q, system, category, resource, status, group, priority, completeOnly}. priority '-' = non assegnata. */
export function filterPoints(points, { q = '', system = '', category = '', resource = '', status = '', group = '', priority = '', completeOnly = false } = {}) {
  const nq = norm(q), nr = norm(resource);
  return points.filter((p) => (!nq || norm(p.name).includes(nq))
    && (!system || p.system === system) && (!category || p.category === category) && (!status || p.status === status)
    && (!group || (p.group ?? '') === group) && (!priority || (priority === '-' ? !p.priority : p.priority === priority))
    && (!nr || norm(p.resource).includes(nr)) && (!completeOnly || isComplete(p)));
}

// ---------------------------------------------------------------- import Excel
/** Associazione automatica intestazioni -> campi (modificabile dall'utente). */
export function guessMapping(headers) {
  const map = {};
  const used = new Set();
  for (const f of FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && f.aliases.includes(norm(h)));
    if (i >= 0) { map[f.key] = i; used.add(i); }
  }
  return map;
}

/**
 * Righe Excel -> candidati validati.
 * @param {any[][]} rows  righe dopo l'intestazione
 * @param {object} mapping campo -> indice di colonna (assente = campo non importato)
 * @returns {{rowNo:number, point, errors, warnings, complete}[]} (rowNo = riga nel foglio, 1-based)
 */
export function rowsToCandidates(rows, mapping, { firstRowNo = 2, defaultUnit = null, defaultSystem = null, source = 'excel', rMaxBySystem = {} } = {}) {
  const out = [];
  rows.forEach((row, i) => {
    if (!row || row.every(blank)) return; // righe vuote ignorate
    const input = { source };
    for (const [k, col] of Object.entries(mapping)) if (col !== null && col !== undefined && col >= 0) input[k] = row[col];
    const r = normalizePoint(input, { defaultUnit, defaultSystem });
    if (r.point) r.warnings.push(...plausibility(r.point, rMaxBySystem[r.point.system]));
    out.push({ rowNo: firstRowNo + i, ...r });
  });
  return out;
}

/**
 * Piano di importazione: nuovi, aggiornamenti, duplicati ignorati, errori.
 * onDuplicate: 'ignore' | 'update' (aggiorna il punto esistente mantenendo ID e data di inserimento).
 * keepIncomplete: false -> le schede senza coordinate complete vengono scartate.
 */
export function planImport(cands, existing, { onDuplicate = 'ignore', keepIncomplete = true } = {}) {
  const insert = [], update = [], skipped = [], errors = [], incomplete = [];
  const idx = new DupIndex(existing);
  const fromFile = new Set();
  for (const c of cands) {
    if (!c.point) { errors.push({ rowNo: c.rowNo, errors: c.errors }); continue; }
    if (!c.complete && !keepIncomplete) { skipped.push({ rowNo: c.rowNo, reason: 'scheda incompleta (esclusa)' }); continue; }
    const dup = idx.find(c.point);
    if (dup) {
      const inFile = fromFile.has(dup.point);
      if (onDuplicate === 'update' && !inFile) {
        const after = mergeUpdate(dup.point, c.point, c.provided);
        update.push({ rowNo: c.rowNo, before: dup.point, after, reason: dup.reason });
        idx.remove(dup.point); idx.add(after); fromFile.add(after);
      } else skipped.push({ rowNo: c.rowNo, reason: `duplicato (${dup.reason}) di "${dup.point.name}"${inFile ? ' nello stesso file' : ''}` });
      continue;
    }
    if (!c.complete) incomplete.push(c.rowNo);
    insert.push(c.point);
    idx.add(c.point); fromFile.add(c.point);
  }
  return { insert, update, skipped, errors, incomplete };
}

// ---------------------------------------------------------------- export
const EXPORT_COLS = [
  ['ID', 'id'], ['Nome', 'name'], ['Sistema', (p) => SYSTEMS[p.system] ?? p.system], ['X', 'x'], ['Y', 'y'], ['Z', 'z'], ['Unità', 'unit'],
  ['Categoria', 'category'], ['Classificazione', 'group'], ['Priorità', 'priority'], ['Risorsa', 'resource'], ['Stato', 'status'], ['Note', 'notes'],
  ['Data inserimento', (p) => fmtDate(p.createdAt)], ['Data ultima verifica', (p) => fmtDate(p.verifiedAt)], ['Fonte dei dati', 'sourceRef'], ['Metodo di origine', 'method'], ['Fonte risorse', 'resourceSource'],
  ['Corpo celeste', 'body'], ['Latitudine (°)', 'lat'], ['Longitudine (°)', 'lon'], ['Altitudine (m)', 'alt'],
  ['X locale (km)', 'localX'], ['Y locale (km)', 'localY'], ['Z locale (km)', 'localZ'], ['Sistema di riferimento planetario', 'planetFrame'], ['Origine', 'source'],
];
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
/** Righe per il foglio Excel (prima riga = intestazione, compatibile con l'import). */
export function exportRows(points) {
  return [EXPORT_COLS.map(([h]) => h), ...points.map((p) => EXPORT_COLS.map(([, f]) => {
    const v = typeof f === 'function' ? f(p) : p[f];
    return v === undefined ? null : v;
  }))];
}

export const BACKUP_FORMAT = 'navcom-punti';
export function backupJson(points) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: nowIso(), count: points.length, points }, null, 1);
}
/** Legge un backup JSON (formato NAVCOM o semplice array di punti). */
export function parseBackup(text) {
  const d = JSON.parse(text);
  const list = Array.isArray(d) ? d : d?.format === BACKUP_FORMAT ? d.points : null;
  if (!Array.isArray(list)) throw new Error('file non riconosciuto: serve un backup del DATABASE PUNTI di NAVCOM');
  return list;
}

/** Punto personale della versione precedente (localStorage, metri) -> scheda del database. */
export function fromLegacy(cp) {
  return normalizePoint({
    name: cp.name, system: cp.system, x: cp.x, y: cp.y, z: cp.z, unit: 'm', category: 'Punto personale',
    status: 'Da verificare', notes: cp.notes ?? '', createdAt: cp.createdAt, source: 'migrazione', legacyId: cp.id,
  });
}
