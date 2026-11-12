// PLANCIA (Command Dashboard): logica pura, testabile senza browser. Nessuna telemetria: tutto cio'
// che la plancia mostra viene da dati inseriti da te, dai moduli NAVCOM o dagli snapshot pubblici.
import { parseShowLocation } from '../core/instructions.js';

export const NOT_SET = 'POSIZIONE NON IMPOSTATA';
export const DEFAULT_SHIP = 'RSI Constellation Mk V Centaurus';
const SYS = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Posizione da testo: formato /showlocation verificato ("Coordinates: x:… y:… z:…", metri nel
 * frame del sistema) oppure tre numeri con unita' dichiarata. Mai coordinate dedotte.
 * @returns {{x,y,z,source}|{error}}
 */
export function parsePosition(text, { unit = 'm' } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return { error: 'testo vuoto' };
  const sl = parseShowLocation(t);
  if (sl) return { ...sl, source: '/showlocation' };
  const nums = t.replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?/gi);
  if (nums?.length === 3 && !/[a-z]{3,}/i.test(t.replace(/e[-+]?\d+/gi, ''))) {
    const k = unit === 'km' ? 1000 : 1;
    const [x, y, z] = nums.map((n) => +n.replace(',', '.') * k);
    if ([x, y, z].every(Number.isFinite)) return { x, y, z, source: 'manuale' };
  }
  return { error: 'formato non riconosciuto: incolla l\'output di /showlocation ("Coordinates: x:… y:… z:…") o tre numeri X Y Z' };
}

/** Marker QT piu' vicino (solo marker QT validi del sistema). */
export function nearestMarker(pos, markers) {
  let best = null;
  for (const m of markers ?? []) { if (!m.qtValid || !m.pos) continue; const d = d3(pos, m.pos); if (!best || d < best.d) best = { name: m.name, d }; }
  return best;
}

/** Corpo celeste piu' vicino: distanza dalla superficie se il raggio e' noto, altrimenti dal centro. */
export function nearestBody(pos, places, system) {
  let best = null;
  for (const b of places ?? []) {
    if (b.system !== system || !(b.kind === 'planet' || b.kind === 'moon') || !b.pos) continue;
    const dc = d3(pos, b.pos); const d = b.radius ? dc - b.radius : dc;
    if (!best || d < best.d) best = { name: b.name, id: b.id, d, fromSurface: !!b.radius };
  }
  return best;
}

/** Riepilogo della rotta calcolata dal PIANIFICATORE (nessun ricalcolo). */
export function planSummary(p) {
  if (!p?.result) return null;
  const st = p.result.steps ?? [];
  return {
    target: p.inputs?.target?.name ?? 'P', system: p.inputs?.target?.system ?? null, departure: p.result.departure ?? p.inputs?.start?.name ?? null,
    qtLegs: st.filter((s) => s.kind === 'qt' || s.kind === 'qt-drop').length, drops: st.filter((s) => s.kind === 'qt-drop').length,
    jumps: st.filter((s) => s.kind === 'jump').length, path: st.filter((s) => s.kind !== 'conv').map((s) => s.to).filter(Boolean),
    residual: p.result.residual_m ?? null, residualWorst: p.result.residualWorst_m ?? null, time: p.result.time_s ?? null,
    status: p.result.status ?? null, evidence: p.result.evidence ?? null, at: p.at ?? null, gameVersion: p.data?.gameVersion ?? null,
  };
}

/** Distanza fra posizione e destinazione: solo nello stesso sistema, in linea retta. */
export function straightDistance(position, dest) {
  if (!position || !dest?.pos) return { d: null, note: dest && !dest.pos ? 'destinazione senza XYZ di sistema' : 'posizione non impostata' };
  if (position.system !== dest.system) return { d: null, note: `sistemi diversi (${SYS[position.system] ?? position.system} → ${SYS[dest.system] ?? dest.system}): la distanza passa da un jump point, non è una linea retta` };
  return { d: d3(position, dest.pos), note: 'in linea retta, non è il percorso' };
}

/** Elenco recente senza duplicati (il piu' nuovo in testa). */
export function pushRecent(list, entry, max = 12) {
  return [entry, ...(list ?? []).filter((e) => e.id !== entry.id)].slice(0, max);
}

/** Scheda nave: dati dei file di gioco (configurazione di serie) + note tue. */
export function shipSheet(ship, notes = '') {
  if (!ship) return null;
  const rows = [
    ['Produttore', ship.maker], ['Modello', ship.name], ['Ruolo', [ship.career, ship.role].filter(Boolean).join(' · ') || null],
    ['Equipaggio', ship.crew], ['Cargo (griglia)', ship.cargo !== null && ship.cargo !== undefined ? `${ship.cargo} SCU${ship.mining && !ship.cargo ? ' (il carico minerario non è cargo)' : ''}` : null],
    ['Serbatoio idrogeno', ship.fuelH ? `${ship.fuelH.toLocaleString('it-IT')} (unità del gioco)` : null],
    ['Serbatoio quantum', ship.fuelQt ? `${ship.fuelQt.toLocaleString('it-IT')} (unità del gioco)` : null],
    ['Autonomia quantum', ship.qtRange ? `${(ship.qtRange / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 })} Gm con il quantum drive di serie a pieno carico` : null],
    ['Velocità quantum', ship.qtSpeed ? `${Math.round(ship.qtSpeed / 1000).toLocaleString('it-IT')} km/s (drive di serie)` : null],
    ['Quantum drive (di serie)', ship.stock?.quantumDrive?.join(', ') || null],
    ['Power plant (di serie)', ship.stock?.powerPlant?.join(', ') || null], ['Cooler (di serie)', ship.stock?.cooler?.join(', ') || null], ['Scudi (di serie)', ship.stock?.shield?.join(', ') || null],
    ['Dimensioni', ship.dims ? `${ship.dims.l} × ${ship.dims.w} × ${ship.dims.h} m` : null],
  ].map(([label, value]) => ({ label, value: value ?? null }));
  return { name: ship.name, rows, notes, source: `scunpacked-data (file di gioco${ship.patch ? `, ${ship.patch}` : ''}): configurazione di serie. Se hai cambiato componenti, autonomia e velocità possono differire.` };
}

/** Proiezione per la mini mappa: piano XY del sistema, scala lineare reale adattata al riquadro. */
export function miniProjector(points, w, h, pad = 14) {
  const ps = points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  let r = 1; for (const p of ps) r = Math.max(r, Math.abs(p.x), Math.abs(p.y));
  const k = (Math.min(w, h) / 2 - pad) / r;
  return { k, r, at: (p) => ({ x: w / 2 + p.x * k, y: h / 2 - p.y * k }) };
}
