// DATABASE PUNTI: modello dei dati, validazione, duplicati, filtri, import/export.
// Regola fondamentale: NAVCOM non genera coordinate e non crea destinazioni. Ogni punto nasce
// da un inserimento manuale, da un file Excel/JSON dell'utente o dalle coordinate che l'utente
// ha gia' scritto nel pianificatore.

export const SYSTEMS = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
export const CATEGORIES = ['Mining', 'Esplorazione', 'Relitto', 'Punto personale', 'Altro'];
export const STATUSES = ['Da verificare', 'Verificato', 'Non interessante'];
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
  { key: 'resource', label: 'Materiale o risorsa', aliases: ['materiale', 'risorsa', 'materiale o risorsa', 'resource', 'minerale'] },
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
export function parseStatus(v) { const k = norm(v); return STATUSES.find((c) => norm(c) === k) ?? null; }

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
  const created = parseDate(input.createdAt), verified = parseDate(input.verifiedAt);
  if (created.error) warnings.push(`data di inserimento: ${created.error}`);
  if (verified.error) warnings.push(`data di verifica: ${verified.error}`);
  if (errors.length) return { point: null, errors, warnings, complete };
  return {
    point: {
      id: blank(input.id) ? newId() : String(input.id).trim(),
      name, system, x: coords.x, y: coords.y, z: coords.z, unit,
      category, resource: String(input.resource ?? '').trim(), status, notes: String(input.notes ?? '').trim(),
      createdAt: created.value ?? now, verifiedAt: verified.value ?? null, updatedAt: now,
      source: input.source ?? 'manuale',
      ...(input.legacyId ? { legacyId: input.legacyId } : {}),
    },
    errors, warnings, complete,
  };
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

/** Gruppi di duplicati nel database: [{reason, ids}]. */
export function findDuplicates(points, tol = DUPLICATE_TOLERANCE_M) {
  const groups = [];
  const seen = new Set();
  for (let i = 0; i < points.length; i++) {
    if (seen.has(points[i].id)) continue;
    const g = [points[i].id];
    let reason = null;
    for (let j = i + 1; j < points.length; j++) {
      const r = duplicateReason(points[i], points[j], tol);
      if (r) { g.push(points[j].id); seen.add(points[j].id); reason = reason === 'coordinate' ? reason : r; }
    }
    if (g.length > 1) groups.push({ reason, ids: g });
  }
  return groups;
}

export function findExisting(rec, existing, tol = DUPLICATE_TOLERANCE_M) {
  let byName = null;
  for (const e of existing) {
    if (rec.id && e.id === rec.id) return { point: e, reason: 'ID' };
    const r = duplicateReason(rec, e, tol);
    if (r === 'coordinate') return { point: e, reason: r };
    if (r === 'nome' && !byName) byName = { point: e, reason: r };
  }
  return byName;
}

/** Filtri della tabella. criteria: {q, system, category, resource, status, completeOnly} */
export function filterPoints(points, { q = '', system = '', category = '', resource = '', status = '', completeOnly = false } = {}) {
  const nq = norm(q), nr = norm(resource);
  return points.filter((p) => (!nq || norm(p.name).includes(nq))
    && (!system || p.system === system) && (!category || p.category === category) && (!status || p.status === status)
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
  const pool = [...existing];
  for (const c of cands) {
    if (!c.point) { errors.push({ rowNo: c.rowNo, errors: c.errors }); continue; }
    if (!c.complete && !keepIncomplete) { skipped.push({ rowNo: c.rowNo, reason: 'scheda incompleta (esclusa)' }); continue; }
    const dup = findExisting(c.point, pool);
    if (dup) {
      const inFile = insert.includes(dup.point) || update.some((u) => u.after === dup.point);
      if (onDuplicate === 'update' && !inFile) {
        const after = { ...c.point, id: dup.point.id, createdAt: dup.point.createdAt, source: dup.point.source, updatedAt: nowIso() };
        update.push({ rowNo: c.rowNo, before: dup.point, after, reason: dup.reason });
        pool[pool.indexOf(dup.point)] = after;
      } else skipped.push({ rowNo: c.rowNo, reason: `duplicato (${dup.reason}) di "${dup.point.name}"${inFile ? ' nello stesso file' : ''}` });
      continue;
    }
    if (!c.complete) incomplete.push(c.rowNo);
    insert.push(c.point);
    pool.push(c.point);
  }
  return { insert, update, skipped, errors, incomplete };
}

// ---------------------------------------------------------------- export
const EXPORT_COLS = [
  ['ID', 'id'], ['Nome', 'name'], ['Sistema', (p) => SYSTEMS[p.system] ?? p.system], ['X', 'x'], ['Y', 'y'], ['Z', 'z'], ['Unità', 'unit'],
  ['Categoria', 'category'], ['Risorsa', 'resource'], ['Stato', 'status'], ['Note', 'notes'],
  ['Data inserimento', (p) => fmtDate(p.createdAt)], ['Data ultima verifica', (p) => fmtDate(p.verifiedAt)], ['Fonte', 'source'],
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
