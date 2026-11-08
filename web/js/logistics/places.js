// Luoghi della logistica -> posizioni NAVCOM (CitizenHQ, frame del sistema).
// Nessuna posizione inventata: un nome si risolve solo se coincide con un luogo importato, oppure
// se e' la parte finale di UN SOLO nome importato ("Wide Forest Station" -> "ARC-L1 Wide Forest
// Station"). Altrimenti il luogo resta "posizione non nota" e nessuna distanza viene calcolata.
import { distance } from '../core/vector.js';
import { jumpTime } from '../core/qtdrive.js';
import { normName } from './model.js';

export class PlaceIndex {
  /** @param {{[system:string]: {name:string, pos:{x,y,z}, key?:string, type?:string}[]}} bySystem */
  constructor(bySystem = {}, aliases = {}) {
    this.exact = new Map(); this.list = []; this.aliases = new Map();
    for (const [sys, pts] of Object.entries(bySystem)) {
      for (const p of pts) {
        const rec = { system: sys, name: p.name, pos: p.pos, key: p.key ?? null, type: p.type ?? null, n: normName(p.name) };
        this.list.push(rec);
        const k = `${sys}|${rec.n}`;
        if (!this.exact.has(k)) this.exact.set(k, rec);
      }
    }
    for (const [a, b] of Object.entries(aliases)) this.aliases.set(normName(a), b);
  }

  /** @returns {{system, name, pos, key, how:'esatto'|'suffisso'|'alias'}|null} */
  resolve(name, system = null) {
    if (!name) return null;
    let n = normName(name);
    let how = 'esatto';
    if (this.aliases.has(n)) { n = normName(this.aliases.get(n)); how = 'alias'; }
    const systems = system ? [system] : [...new Set(this.list.map((r) => r.system))];
    for (const s of systems) {
      const r = this.exact.get(`${s}|${n}`);
      if (r) return { ...r, how };
    }
    const tail = this.list.filter((r) => (!system || r.system === system) && r.n.endsWith(` ${n}`));
    if (tail.length === 1) return { ...tail[0], how: how === 'alias' ? 'alias' : 'suffisso' };
    return null;
  }

  /** Nomi dei sistemi in cui il luogo e' noto. */
  get systems() { return [...new Set(this.list.map((r) => r.system))]; }
}

/**
 * Tratta fra due luoghi. Distanza in linea retta fra i marker (minimo teorico: un ostacolo puo'
 * richiedere un salto intermedio). Fra sistemi diversi la distanza NON si somma (frame diversi):
 * la tratta e' interstellare e il valore resta non determinabile.
 * @returns {{distance:number|null, time:number|null, interstellar:boolean, known:boolean, note:string|null}}
 */
export function leg(index, a, b, { drive = null, prep = null } = {}) {
  if (!a?.name || !b?.name) return { distance: null, time: null, interstellar: false, known: false, note: 'luogo non indicato' };
  if (normName(a.name) === normName(b.name)) return { distance: 0, time: 0, interstellar: false, known: true, note: null };
  const pa = index.resolve(a.name, a.system), pb = index.resolve(b.name, b.system);
  if (!pa || !pb) return { distance: null, time: null, interstellar: false, known: false, note: `posizione non nota: ${[!pa ? a.name : null, !pb ? b.name : null].filter(Boolean).join(', ')}` };
  if (pa.system !== pb.system) return { distance: null, time: null, interstellar: true, known: false, note: `tratta interstellare ${pa.system} → ${pb.system}: distanza non sommabile, passa dal jump point` };
  const d = distance(pa.pos, pb.pos);
  const t = drive ? jumpTime(d, drive) : null;
  return { distance: d, time: t === null ? null : t + (prep ?? 0), interstellar: false, known: true, note: null };
}

/** Funzione tratta con memoria (usata dall'ottimizzatore: stesse coppie, stesso risultato). */
export function legCache(index, opts = {}) {
  const m = new Map();
  return (a, b) => {
    const k = `${placeKey(a)}>${placeKey(b)}`;
    if (!m.has(k)) m.set(k, leg(index, a, b, opts));
    return m.get(k);
  };
}

/** Chiave di un luogo: il nome normalizzato (i nomi dei luoghi non si ripetono fra sistemi). */
export const placeKey = (p) => normName(p?.name);
