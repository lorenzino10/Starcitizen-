// NAVCOM LOGISTICS INTELLIGENCE: modello dati dei contratti di trasporto.
//
// Principio: un dato che non si conosce resta "non noto". Una missione del CATALOGO e' un modello
// (template) presente in un database, mai un'offerta disponibile: diventa OSSERVATA solo quando
// l'utente dichiara di averla vista in un luogo e in un momento precisi.
import { newId, nowIso } from '../core/points.js';

/** Stati di un contratto (ordine = ciclo di vita). Il catalogo NON e' uno stato dei contratti. */
export const STATUS = {
  osservata: 'Osservata',            // offerta vista in un luogo e momento precisi
  confermata: 'Confermata',          // verificata ora nel MobiGlas, non ancora accettata
  accettata: 'Accettata',            // contratto acquisito
  in_esecuzione: 'In esecuzione',    // carico ritirato o consegnato in parte
  completata: 'Completata',
  fallita: 'Fallita',
  non_disponibile: 'Non disponibile',
};
export const STATUS_KEYS = Object.keys(STATUS);
/** Livello di evidenza mostrato in interfaccia (indicatori distinti). */
export const EVIDENCE = {
  verificata: { icon: '🟢', label: 'Disponibilità verificata' },
  storica: { icon: '🔵', label: 'Dato storico (osservato in passato)' },
  catalogo: { icon: '🟠', label: 'Catalogo: modello di missione, non un\'offerta' },
  incerta: { icon: '⚪', label: 'Dato incerto o incompleto' },
  incompatibile: { icon: '🔴', label: 'Incompatibilità operativa' },
};

const NEXT = {
  osservata: ['confermata', 'accettata', 'non_disponibile'],
  confermata: ['accettata', 'non_disponibile', 'osservata'],
  accettata: ['in_esecuzione', 'completata', 'fallita'],
  in_esecuzione: ['completata', 'fallita'],
  completata: [],
  fallita: [],
  non_disponibile: ['osservata', 'confermata'],
};
export const canTransition = (from, to) => (NEXT[from] ?? []).includes(to);

/** Contratti che vincolano il piano (non sacrificabili): accettati o con merce gia' in stiva. */
export const isCommitted = (c) => c.status === 'accettata' || c.status === 'in_esecuzione';
/** Contratti che il piano puo' proporre di accettare (mai come gia' disponibili). */
export const isCandidate = (c) => c.status === 'confermata';

export const RANKS = ['Trainee', 'Rookie', 'Junior', 'Member', 'Experienced', 'Senior', 'Master'];
export const rankIndex = (name) => {
  const i = RANKS.findIndex((r) => r.toLowerCase() === String(name ?? '').trim().toLowerCase());
  return i < 0 ? null : i;
};

export const normName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const place = (p, system) => {
  if (!p) return { name: null, system: system ?? null };
  if (typeof p === 'string') return { name: str(p) || null, system: system ?? null };
  return { name: str(p.name) || null, system: str(p.system).toLowerCase() || system || null };
};

/**
 * Normalizza un contratto (inserimento manuale o importazione).
 * Ogni movimento e' una quantita' di merce da UN punto di ritiro a UN punto di consegna: una
 * missione con piu' ritiri e consegne ha piu' movimenti, mai un singolo collegamento A->B.
 * @returns {{contract:object|null, errors:string[], warnings:string[]}}
 */
export function normalizeContract(input, { now = nowIso() } = {}) {
  const errors = [], warnings = [];
  const system = str(input.system).toLowerCase() || null;
  const status = str(input.status || 'osservata').toLowerCase().replace(/\s+/g, '_');
  if (!STATUS[status]) errors.push(`stato "${input.status}" non valido (${STATUS_KEYS.join(', ')})`);
  if (status === 'catalogo') errors.push('un contratto non può avere stato "catalogo": il catalogo contiene modelli, non offerte');
  const movements = (input.movements ?? []).map((m, i) => {
    const scu = num(m.scu);
    if (scu === null || scu <= 0) errors.push(`movimento ${i + 1}: quantità SCU mancante o non valida`);
    const from = place(m.from ?? m.pickup, system), to = place(m.to ?? m.delivery, system);
    if (!from.name) warnings.push(`movimento ${i + 1}: punto di ritiro non noto (assegnato dinamicamente?): non pianificabile finché non lo inserisci`);
    if (!to.name) warnings.push(`movimento ${i + 1}: punto di consegna non noto: non pianificabile finché non lo inserisci`);
    const loaded = Math.max(0, num(m.loaded) ?? 0), delivered = Math.max(0, num(m.delivered) ?? 0);
    if (scu !== null && (loaded > scu || delivered > loaded)) errors.push(`movimento ${i + 1}: caricato ${loaded} / consegnato ${delivered} incoerenti con ${scu} SCU`);
    return {
      id: str(m.id) || `m${i + 1}`, cargo: str(m.cargo) || null, scu,
      from, to,
      containerMax: num(m.containerMax), containerSizes: Array.isArray(m.containerSizes) ? m.containerSizes.map(num).filter((x) => x) : null,
      loaded, delivered,
    };
  });
  if (!movements.length) errors.push('nessun movimento: servono almeno un ritiro e una consegna con la quantità');
  const ids = new Set();
  for (const m of movements) { if (ids.has(m.id)) errors.push(`movimento "${m.id}" duplicato`); ids.add(m.id); }
  const reward = num(input.reward);
  if (reward === null) warnings.push('ricompensa non indicata: profitto non calcolabile per questo contratto');
  const patch = str(input.patch) || null;
  if (!patch) warnings.push('versione del gioco non indicata: non si potrà riconoscere se il dato è obsoleto');
  if (errors.length) return { contract: null, errors, warnings };
  const contract = {
    id: str(input.id) || newId(),
    offerId: str(input.offerId) || null,
    title: str(input.title) || 'Contratto senza titolo',
    company: str(input.company) || null,
    rank: str(input.rank) || null,
    reward,
    system,
    offerZone: str(input.offerZone) || null,
    status,
    deadline: str(input.deadline) || null,
    reputationReq: str(input.reputationReq) || null,
    patch,
    observedAt: str(input.observedAt) || now,
    source: str(input.source) || 'manuale',
    catalogRef: input.catalogRef ?? null,
    notes: str(input.notes),
    risk: num(input.risk) ?? 0,
    movements,
    history: Array.isArray(input.history) ? input.history : [{ at: now, to: status, note: 'creato' }],
    createdAt: str(input.createdAt) || now,
    updatedAt: now,
  };
  return { contract, errors, warnings };
}

/** Cambio di stato esplicito (azione dell'utente). Mai automatico. */
export function transition(c, to, { now = nowIso(), note = '' } = {}) {
  if (c.status === to) return c;
  if (!canTransition(c.status, to)) throw new Error(`Passaggio non ammesso: ${STATUS[c.status]} → ${STATUS[to] ?? to}`);
  return { ...c, status: to, updatedAt: now, history: [...(c.history ?? []), { at: now, from: c.status, to, note }] };
}

/** Quantita' in stiva, da ritirare e da consegnare per un movimento. */
export const inHold = (m) => m.loaded - m.delivered;
export const toLoad = (m) => (m.scu ?? 0) - m.loaded;
export const toDeliver = (m) => (m.scu ?? 0) - m.delivered;
export const contractDone = (c) => c.movements.every((m) => m.delivered >= m.scu);

/** Ritiro (anche parziale) registrato dall'utente. */
export function recordLoad(c, movementId, qty, { now = nowIso() } = {}) {
  const movements = c.movements.map((m) => {
    if (m.id !== movementId) return m;
    const q = qty ?? toLoad(m);
    if (q <= 0 || q > toLoad(m)) throw new Error(`Quantità da caricare non valida (${q}, restano ${toLoad(m)} SCU)`);
    return { ...m, loaded: m.loaded + q };
  });
  let out = { ...c, movements, updatedAt: now };
  if (out.status === 'accettata') out = transition(out, 'in_esecuzione', { now, note: 'carico ritirato' });
  return out;
}

/** Consegna (anche parziale): non si puo' consegnare piu' di quanto e' in stiva. */
export function recordDelivery(c, movementId, qty, { now = nowIso() } = {}) {
  const movements = c.movements.map((m) => {
    if (m.id !== movementId) return m;
    const q = qty ?? inHold(m);
    if (q <= 0 || q > inHold(m)) throw new Error(`Consegna non valida: ${q} SCU richiesti, ${inHold(m)} SCU in stiva per questo movimento`);
    return { ...m, delivered: m.delivered + q };
  });
  let out = { ...c, movements, updatedAt: now };
  if (out.status === 'accettata') out = transition(out, 'in_esecuzione', { now, note: 'consegna' });
  if (contractDone(out) && out.status !== 'completata') out = transition(out, 'completata', { now, note: 'tutte le consegne effettuate' });
  return out;
}

// ------------------------------------------------------------------ versioni del gioco
/** "4.10.2-LIVE.12881860" -> [4,10,2]; null se non riconoscibile. */
export function parsePatch(s) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(s ?? ''));
  return m ? [+m[1], +m[2], +(m[3] ?? 0)] : null;
}
/**
 * Un dato e' potenzialmente obsoleto se registrato in una patch diversa (major.minor) da quella
 * attuale. Senza patch nota il dato e' "non verificabile" (mai considerato attuale).
 * @returns {'attuale'|'obsoleto'|'sconosciuta'}
 */
export function patchAge(dataPatch, currentPatch) {
  const a = parsePatch(dataPatch), b = parsePatch(currentPatch);
  if (!a || !b) return 'sconosciuta';
  return a[0] === b[0] && a[1] === b[1] ? 'attuale' : 'obsoleto';
}

// ------------------------------------------------------------------ navi
/**
 * Nave predefinita: RSI Constellation Mk V Centaurus. Dati verificati sulla Star Citizen Wiki API
 * (vehicles/d26ba152-8cfb-4f2c-9995-2c5ec3f0707f, versione 4.10.2-LIVE.12881860, letti 2026-11-08):
 * cargo_capacity 240, una griglia aperta 7,5 x 5 x 12,5 m, cassa massima 32 SCU.
 */
export const SHIPS = {
  'rsi-constellation-mk5-centaurus': {
    name: 'RSI Constellation Mk V Centaurus', scu: 240, maxBox: 32, minBox: 1,
    grids: [{ width: 7.5, height: 5, length: 12.5, scu: 240, maxBox: 32 }],
    source: 'Star Citizen Wiki API, 4.10.2-LIVE.12881860 (2026-11-08)', patch: '4.10.2',
  },
  custom: { name: 'Nave personalizzata', scu: null, maxBox: null, minBox: null, grids: null, source: 'inserita da te', patch: null },
};
