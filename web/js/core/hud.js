// PRECISIONE DELL'INTERRUZIONE QT: cosa mostra l'HUD e quanto e' incerto il punto di uscita.
//
// Fatti e ipotesi (dettagli in docs/NAVIGAZIONE_OPERATIVA.md):
//  - durante il salto l'HUD mostra la distanza residua verso la destinazione QT;
//  - sopra 1 Gm il formato "14.3 Gm" (un decimale) e' documentato da terzi (SCMiner): passo 0,1 Gm;
//  - il formato sotto 1 Gm (Mm, km) e la regola di arrotondamento NON sono documentati:
//    sono parametri, con valore predefinito marcato come ipotesi.
//
// Metodo: il pilota non esce "quando legge 13,9" (posizione incerta di un intero passo) ma
// nell'istante in cui la lettura CAMBIA da (k+1) a k passi. Quell'istante corrisponde a una
// distanza precisa che dipende dalla regola di arrotondamento:
//   troncamento (floor)  -> (k+1)·passo
//   arrotondamento       -> (k+½)·passo
//   eccesso (ceil)       ->  k·passo
//   sconosciuta          -> intervallo [k·passo, (k+1)·passo]
// Il tempo di reazione τ fa uscire DOPO il cambio: la nave percorre v·τ in piu' verso la
// destinazione, quindi la distanza HUD all'uscita e' minore di v·τ.

export const UNIT_DIV = { Gm: 1e9, Mm: 1e6, km: 1e3, m: 1 };

export const DEFAULT_HUD = {
  units: [
    { unit: 'Gm', min: 1e9, dec: 1, evidence: 'fonte terza (SCMiner: "14.3 Gm")' },
    { unit: 'Mm', min: 1e6, dec: 1, evidence: 'ipotesi da collaudare' },
    { unit: 'km', min: 0, dec: 0, evidence: 'ipotesi da collaudare' },
  ],
  rounding: 'unknown', // 'floor' | 'round' | 'ceil' | 'unknown'
};

export const ROUNDING_LABEL = {
  unknown: 'sconosciuta (da collaudare)', floor: 'troncamento', round: 'arrotondamento al più vicino', ceil: 'per eccesso',
};
const OFFSET = { floor: 1, round: 0.5, ceil: 0 };

/** Unita' HUD usata per una distanza d (m). */
export function hudUnit(d, hud = DEFAULT_HUD) {
  const u = hud.units.find((x) => Math.abs(d) >= x.min) ?? hud.units[hud.units.length - 1];
  const div = UNIT_DIV[u.unit];
  return { unit: u.unit, div, dec: u.dec, step: div / 10 ** u.dec, evidence: u.evidence };
}

const fmtNum = (v, dec) => v.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: true });

/** Testo come apparirebbe sull'HUD (con regola sconosciuta si mostra l'arrotondamento). */
export function hudText(d, hud = DEFAULT_HUD) {
  const u = hudUnit(d, hud);
  const steps = d / u.step;
  const k = hud.rounding === 'floor' ? Math.floor(steps + 1e-9) : hud.rounding === 'ceil' ? Math.ceil(steps - 1e-9) : Math.round(steps);
  return `${fmtNum((k * u.step) / u.div, u.dec)} ${u.unit}`;
}

/** Valore k·passo scritto nell'unita' del passo (per "da 14,0 a 13,9 Gm"). */
export function stepText(k, u) { return `${fmtNum((k * u.step) / u.div, u.dec)} ${u.unit}`; }

/** Distanze HUD (m) compatibili con il cambio di lettura da (k+1) a k passi. */
export function transitionInterval(k, step, rounding) {
  if (rounding in OFFSET) { const h = (k + OFFSET[rounding]) * step; return [h, h]; }
  return [k * step, (k + 1) * step];
}

/** Residuo verso il bersaglio se l'uscita avviene a distanza HUD h invece che h0. */
export const residualAt = (h, h0, res0) => Math.hypot(res0, h - h0);

function rangeResidual([lo, hi], h0, res0) {
  const max = Math.max(residualAt(lo, h0, res0), residualAt(hi, h0, res0));
  const min = h0 >= lo && h0 <= hi ? res0 : Math.min(residualAt(lo, h0, res0), residualAt(hi, h0, res0));
  return { min, max };
}

/**
 * Pianifica l'uscita dal salto.
 * @param {object} p
 * @param {number} p.h0        distanza HUD ideale all'uscita (m), verso la destinazione QT
 * @param {number} p.res0      distanza minima teorica dal bersaglio (m), perpendicolare alla tratta
 * @param {number} p.legLength lunghezza della tratta (m)
 * @param {object} [p.hud]     formato HUD e regola di arrotondamento
 * @param {number|null} [p.speed]    velocita' QT al momento dell'uscita (m/s), se nota
 * @param {{min:number,max:number}|null} [p.reaction] tempo di reazione (s), se noto
 */
export function planDrop({ h0, res0, legLength, hud = DEFAULT_HUD, speed = null, reaction = null }) {
  const u = hudUnit(h0, hud);
  const reactKnown = speed > 0 && reaction && Number.isFinite(reaction.min) && Number.isFinite(reaction.max);
  const shift = reactKnown ? [speed * reaction.min, speed * reaction.max] : null;
  const clampH = (h) => Math.min(Math.max(h, 0), legLength);
  let best = null;
  const k0 = Math.floor(h0 / u.step);
  for (let k = k0 - 4; k <= k0 + 4; k++) {
    if (k < 0 || k * u.step > legLength) continue;
    const roundI = transitionInterval(k, u.step, hud.rounding).map(clampH);
    const totalI = shift ? [clampH(roundI[0] - shift[1]), clampH(roundI[1] - shift[0])] : roundI;
    const worst = rangeResidual(totalI, h0, res0).max;
    if (!best || worst < best.worst - 1e-6) best = { k, roundI, totalI, worst };
  }
  const { k, roundI, totalI } = best;
  return {
    h0, res0, unit: u.unit, step: u.step, unitEvidence: u.evidence, rounding: hud.rounding,
    idealText: hudText(h0, hud),
    k, fromText: stepText(k + 1, u), toText: stepText(k, u),
    roundingInterval: roundI, roundingResidual: rangeResidual(roundI, h0, res0),
    reaction: reactKnown ? { speed, shift, interval: totalI, residual: rangeResidual(totalI, h0, res0) } : null,
    // il caso peggiore e' determinabile solo per le componenti quantificate
    worst: rangeResidual(totalI, h0, res0).max,
    worstIncludesReaction: !!reactKnown,
  };
}
