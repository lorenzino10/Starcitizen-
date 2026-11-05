// Istruzioni per il pilota e controlli sulle coordinate: testo semplice, senza HTML.
import { fmtAuto, fmtKm } from './units.js';
import { distance, sub } from './vector.js';
import { ROUNDING_LABEL } from './hud.js';
import { SYSTEM_NAMES } from './systems.js';


const km3 = (v) => [v.x, v.y, v.z].map((c) => (c / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 })).join(' / ');
export const fmtTime = (s) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return 'non determinabile';
  if (s < 60) return `${s.toFixed(1).replace('.', ',')} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.round(s % 60);
  return h ? `${h} h ${m} min` : `${m} min ${r} s`;
};
const angle = (u, v) => {
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z));
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
};

/** Lettura /showlocation: "Coordinates: x:12850457093 y:0 z:0" (metri, frame del sistema). */
export function parseShowLocation(text) {
  const n = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
  const m = new RegExp(`x\\s*:\\s*${n}[\\s,;]+y\\s*:\\s*${n}[\\s,;]+z\\s*:\\s*${n}`, 'i').exec(String(text ?? ''));
  return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
}

/** Descrizione dell'uscita dal salto per lo step qt-drop. */
export function dropText(step) {
  const h = step.hud;
  const lines = [
    `Esci dal salto nell'istante in cui la distanza verso ${step.to.name} passa da ${h.fromText} a ${h.toText}.`,
    `Valore teorico ideale: ${fmtKm(step.h0)} (lettura HUD ≈ ${h.idealText}). Regola di arrotondamento dell'HUD: ${ROUNDING_LABEL[h.rounding]}.`,
  ];
  const [lo, hi] = h.roundingInterval;
  lines.push(lo === hi
    ? `Con la regola impostata il cambio di lettura avviene a ${fmtKm(lo)} da ${step.to.name}.`
    : `Il cambio di lettura avviene fra ${fmtKm(lo)} e ${fmtKm(hi)} da ${step.to.name} (passo HUD ${fmtAuto(h.step)}).`);
  if (h.reaction) lines.push(`Con la velocità prevista di ${fmtAuto(h.reaction.speed)}/s e il tuo tempo di reazione esci in realtà fra ${fmtKm(h.reaction.interval[0])} e ${fmtKm(h.reaction.interval[1])}: la scelta del cambio di lettura ne tiene già conto.`);
  else lines.push('Errore dovuto al tempo di reazione: non determinabile (mancano velocità QT o tempo di reazione nelle impostazioni).');
  return lines;
}

/** Sequenza numerata di istruzioni per il pilota. */
export function pilotInstructions(plan, { targetName = 'P' } = {}) {
  const out = [];
  const start = plan.steps[0]?.from;
  if (start) out.push(`Posizionati a ${start.name} (sistema ${SYSTEM_NAMES[plan.steps[0].system] ?? plan.steps[0].system}), ai comandi della nave.`);
  plan.steps.forEach((s, i) => {
    if (s.kind === 'jump') {
      out.push(`Attraversa il jump point vicino a ${s.from.name} (${SYSTEM_NAMES[s.system]} → ${SYSTEM_NAMES[s.toSystem]}). All'uscita sarai vicino a ${s.to.name}.`);
    } else if (s.kind === 'qt') {
      out.push(`Seleziona ${s.to.name} come destinazione QT e salta (${fmtKm(s.length)}). Completa il salto.`);
    } else if (s.kind === 'qt-drop') {
      const fromFree = s.from.kind !== 'marker';
      out.push(`${fromFree ? 'Dal punto di uscita, seleziona' : 'Seleziona'} ${s.to.name} come destinazione QT e avvia il salto (tratta di ${fmtKm(s.length)}).`);
      out.push(...dropText(s).map((l, k) => (k === 0 ? `${l} Per uscire: le guide indicano di tenere premuto B, ma verifica la tua assegnazione dei tasti.` : `   ${l}`)));
      const next = plan.steps[i + 1];
      if (next && next.kind === 'qt-drop') {
        out.push(`Consigliato: digita /showlocation nella chat e incolla le coordinate in NAVCOM come partenza, poi ricalcola: la seconda fase verrà corretta sulla tua posizione reale.`);
      }
    } else if (s.kind === 'conv') {
      const prev = plan.steps[i - 1];
      const ref = prev?.to?.pos ? angle(sub(prev.to.pos, s.from), sub(s.to, s.from)) : null;
      const star = angle(sub({ x: 0, y: 0, z: 0 }, s.from), sub(s.to, s.from));
      out.push(`Volo convenzionale fino a ${targetName}: ${fmtKm(s.length)}${s.time !== null ? ` (circa ${fmtTime(s.time)})` : ''}. Coordinate teoriche di arrivo del salto: ${km3(s.from)} km.`);
      if (ref !== null && s.length >= 1) out.push(`   Direzione: ${targetName} è a ${ref.toFixed(1).replace('.', ',')}° dalla direzione di ${prev.to.name} e a ${star.toFixed(1).replace('.', ',')}° dalla direzione della stella. Nessun marker di gioco indica ${targetName}: usa "Correzione in volo" con due letture /showlocation per controllare la rotta.`);
    }
  });
  return out;
}

const FAR_FROM_MARKER = 5e9; // 5 Gm: soglia informativa documentata in docs/NAVIGAZIONE_OPERATIVA.md

/**
 * Controlli sulle coordinate di P (m). unitFactor: 1000 se l'utente ha scelto km, 1 se metri.
 * @returns {{level:'err'|'warn'|'info', text}[]}
 */
export function coordinateChecks(P, { points = [], model = null, unitFactor = 1000, nearest = null } = {}) {
  const out = [];
  if (model) {
    for (const b of model.bodies) {
      const d = distance(P, b.center);
      if (d < b.radius) out.push({ level: b.uncertain ? 'warn' : 'err', text: `Il punto è dentro ${b.name} (${fmtAuto(b.radius - d)} sotto la superficie nominale${b.uncertain ? ', raggio incerto' : ''}).` });
    }
    if (!model.complete) out.push({ level: 'warn', text: `Dati sui corpi celesti incompleti per questo sistema${model.missing?.length ? ` (mancano: ${model.missing.slice(0, 8).join(', ')})` : ''}: ostacoli e punti interni non sono verificabili.` });
  }
  if (points.length) {
    let rMax = 0;
    for (const p of points) rMax = Math.max(rMax, Math.hypot(p.pos.x, p.pos.y, p.pos.z));
    const r = Math.hypot(P.x, P.y, P.z);
    if (r > rMax * 1.05) {
      out.push({ level: 'warn', text: `Il punto è a ${fmtAuto(r)} dall'origine, oltre la regione coperta dai dati (punto noto più lontano: ${fmtAuto(rMax)}).` });
      if (unitFactor === 1000 && r / 1000 <= rMax * 1.05) out.push({ level: 'warn', text: 'Unità sospetta: i valori sembrano metri inseriti come chilometri. In metri il punto cadrebbe dentro la regione dei dati.' });
    } else if (unitFactor === 1 && r < 1e8 && r * 1000 <= rMax * 1.05) {
      out.push({ level: 'warn', text: `Unità sospetta: il punto è a soli ${fmtAuto(r)} dal centro del sistema. Se i valori erano in km, seleziona "km".` });
    }
  }
  if (nearest && nearest.distance > FAR_FROM_MARKER) out.push({ level: 'warn', text: `Il marker QT più vicino (${nearest.name}) è a ${fmtAuto(nearest.distance)}: punto molto lontano dalla rete di navigazione.` });
  return out;
}
