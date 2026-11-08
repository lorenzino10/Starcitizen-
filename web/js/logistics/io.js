// Importazione ed esportazione della logistica: JSON (backup completo) e CSV dei contratti.
import { normalizeContract } from './model.js';
import { normalizeObservation } from './intel.js';

export const FORMAT = 'navcom-logistics';
export const FULL_FORMAT = 'navcom-backup-completo';

export function exportLogistics({ contracts, observations, settings = null, version = '', plans = [], attachments = [] }) {
  return { format: FORMAT, version: 2, app: version, exportedAt: new Date().toISOString(), contracts, observations, settings, plans, attachments };
}

/** Backup completo NAVCOM: DATABASE PUNTI + logistica, in un solo file. */
export function exportFull({ points, contracts, observations, settings = null, version = '', plans = [], attachments = [] }) {
  return { format: FULL_FORMAT, version: 2, app: version, exportedAt: new Date().toISOString(), points, logistics: exportLogistics({ contracts, observations, settings, version, plans, attachments }) };
}

/**
 * Lettura di un backup (logistica o completo). Ogni record viene rivalidato.
 * @returns {{contracts, observations, points:null|object[], settings, errors:string[]}}
 */
export function parseBackup(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  const lg = j.format === FULL_FORMAT ? j.logistics : j;
  if (lg?.format !== FORMAT) throw new Error('File non riconosciuto: serve un backup "navcom-logistics" o "navcom-backup-completo".');
  const errors = [];
  const contracts = [], observations = [];
  for (const c of lg.contracts ?? []) {
    const r = normalizeContract(c, { now: c.updatedAt });
    if (r.contract) contracts.push({ ...r.contract, createdAt: c.createdAt ?? r.contract.createdAt, updatedAt: c.updatedAt ?? r.contract.updatedAt, history: c.history ?? r.contract.history });
    else errors.push(`contratto "${c.title ?? c.id}": ${r.errors.join('; ')}`);
  }
  for (const o of lg.observations ?? []) {
    const r = normalizeObservation(o);
    if (r.observation) observations.push(r.observation); else errors.push(`osservazione ${o.id ?? ''}: ${r.errors.join('; ')}`);
  }
  const plans = (lg.plans ?? []).filter((p) => p && p.id && Array.isArray(p.seq) && Array.isArray(p.contracts));
  const attachments = (lg.attachments ?? []).filter((a) => a && a.id && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/'));
  return { contracts, observations, plans, attachments, points: j.format === FULL_FORMAT ? (j.points ?? []) : null, settings: lg.settings ?? null, errors };
}

/** Unione senza perdita: per ID vince il record aggiornato piu' di recente; nulla viene cancellato. */
export function mergeById(existing, incoming, stamp = (x) => x.updatedAt ?? x.at ?? '') {
  const m = new Map(existing.map((x) => [x.id, x]));
  let added = 0, updated = 0, kept = 0;
  for (const x of incoming) {
    const old = m.get(x.id);
    if (!old) { m.set(x.id, x); added++; }
    else if (stamp(x) > stamp(old)) { m.set(x.id, x); updated++; }
    else kept++;
  }
  return { list: [...m.values()], added, updated, kept };
}

// ------------------------------------------------------------------ CSV
export const CSV_COLUMNS = ['contract_id', 'offer_id', 'title', 'company', 'rank', 'reward', 'system', 'offer_zone', 'status', 'deadline', 'patch', 'observed_at', 'source',
  'movement_id', 'cargo', 'scu', 'container_max', 'pickup', 'pickup_system', 'delivery', 'delivery_system', 'loaded', 'delivered', 'notes'];

const q = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Una riga per movimento: una missione con piu' ritiri/consegne occupa piu' righe con lo stesso contract_id. */
export function contractsToCsv(contracts) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const c of contracts) for (const m of c.movements) {
    rows.push([c.id, c.offerId, c.title, c.company, c.rank, c.reward, c.system, c.offerZone, c.status, c.deadline, c.patch, c.observedAt, c.source,
      m.id, m.cargo, m.scu, m.containerMax, m.from?.name, m.from?.system, m.to?.name, m.to?.system, m.loaded, m.delivered, c.notes].map(q).join(','));
  }
  return rows.join('\n');
}

export function parseCsv(text) {
  const sep = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inq) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inq = false; else cur += ch; continue; }
    if (ch === '"') inq = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}

/** CSV -> contratti (righe con lo stesso contract_id, o stesso titolo senza ID, si uniscono). */
export function csvToContracts(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { contracts: [], errors: ['file vuoto'], warnings: [] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r, k) => { const i = head.indexOf(k); return i < 0 ? '' : (r[i] ?? '').trim(); };
  if (!head.includes('scu')) return { contracts: [], errors: ['colonna "scu" mancante: usa le intestazioni dell\'esportazione CSV di NAVCOM'], warnings: [] };
  const groups = new Map();
  rows.slice(1).forEach((r, i) => {
    const key = col(r, 'contract_id') || `${col(r, 'title')}|${col(r, 'company')}|${col(r, 'observed_at')}` || `riga${i}`;
    if (!groups.has(key)) groups.set(key, { line: i + 2, rows: [] });
    groups.get(key).rows.push(r);
  });
  const contracts = [], errors = [], warnings = [];
  for (const [, g] of groups) {
    const r0 = g.rows[0];
    const input = {
      id: col(r0, 'contract_id') || undefined, offerId: col(r0, 'offer_id'), title: col(r0, 'title'), company: col(r0, 'company'), rank: col(r0, 'rank'),
      reward: col(r0, 'reward'), system: col(r0, 'system'), offerZone: col(r0, 'offer_zone'), status: col(r0, 'status') || 'osservata',
      deadline: col(r0, 'deadline'), patch: col(r0, 'patch'), observedAt: col(r0, 'observed_at') || undefined, source: col(r0, 'source') || 'import CSV', notes: col(r0, 'notes'),
      movements: g.rows.map((r, k) => ({
        id: col(r, 'movement_id') || `m${k + 1}`, cargo: col(r, 'cargo'), scu: col(r, 'scu'), containerMax: col(r, 'container_max'),
        from: { name: col(r, 'pickup'), system: col(r, 'pickup_system') }, to: { name: col(r, 'delivery'), system: col(r, 'delivery_system') },
        loaded: col(r, 'loaded'), delivered: col(r, 'delivered'),
      })),
    };
    const res = normalizeContract(input);
    if (res.contract) { contracts.push(res.contract); for (const w of res.warnings) warnings.push(`riga ${g.line}: ${w}`); }
    else errors.push(`riga ${g.line}: ${res.errors.join('; ')}`);
  }
  return { contracts, errors, warnings };
}

/** JSON di contratti (array o {contracts:[...]}) -> contratti validati. */
export function jsonToContracts(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  const list = Array.isArray(j) ? j : j.contracts ?? [];
  const contracts = [], errors = [], warnings = [];
  list.forEach((c, i) => {
    const r = normalizeContract({ source: 'import JSON', ...c });
    if (r.contract) { contracts.push(r.contract); warnings.push(...r.warnings.map((w) => `#${i + 1}: ${w}`)); }
    else errors.push(`#${i + 1} ${c.title ?? ''}: ${r.errors.join('; ')}`);
  });
  return { contracts, errors, warnings };
}
