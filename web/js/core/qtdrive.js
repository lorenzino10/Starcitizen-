// TEMPI DI VIAGGIO. Modello del salto QT da starcitizen.tools "Guide:Quantum travel mechanics"
// (Alpha 4.10.0, guida non ufficiale basata su misure):
//  - accelerazione stadio 1: costante a1 fino alla velocita' di ingaggio Ve;
//  - stadio 2: accelerazione che varia linearmente da a1 ad a2 fino a Vmax,
//    T2 = 2(Vmax-Ve)/(a1+a2);
//  - crociera a Vmax; decelerazione speculare all'accelerazione;
//  - se la tratta e' piu' corta di 2·D (D = distanza di accelerazione), niente crociera.
// I parametri del drive NON sono nei dati importati: li inserisce il pilota. Senza Ve/a1/a2
// l'accelerazione e' istantanea e il tempo e' un LIMITE INFERIORE.
// Uscita manuale: si assume istantanea al punto di interruzione (nessuna decelerazione).

/** Fasi di accelerazione. profile: {vmax, ve, a1, a2} in m/s e m/s^2. */
export function accelPhase(profile) {
  const { vmax, ve = 0, a1 = 0, a2 = 0 } = profile ?? {};
  if (!(vmax > 0)) return null;
  if (a1 > 0 && a2 > 0 && ve > 0 && ve < vmax) {
    const T1 = ve / a1, D1 = 0.5 * a1 * T1 * T1;
    const T2 = (2 * (vmax - ve)) / (a1 + a2);
    const D2 = ve * T2 + 0.5 * a1 * T2 * T2 + ((a2 - a1) * T2 * T2) / 6;
    return { kind: 'due stadi', T1, T2, T: T1 + T2, D1, D: D1 + D2, a1, a2, ve, vmax, lowerBound: false };
  }
  if (a1 > 0) { const T = vmax / a1; return { kind: 'accelerazione costante', T1: T, T2: 0, T, D1: 0.5 * vmax * T, D: 0.5 * vmax * T, a1, a2: a1, ve: vmax, vmax, lowerBound: false }; }
  return { kind: 'istantanea', T1: 0, T2: 0, T: 0, D1: 0, D: 0, a1: 0, a2: 0, ve: vmax, vmax, lowerBound: true };
}

/** Posizione e velocita' al tempo t (0..T) durante l'accelerazione. */
function accelState(ph, t) {
  if (t <= ph.T1) return { x: 0.5 * ph.a1 * t * t, v: ph.a1 * t };
  const s = Math.min(t - ph.T1, ph.T2);
  const k = ph.T2 > 0 ? (ph.a2 - ph.a1) / ph.T2 : 0;
  return { x: ph.D1 + ph.ve * s + 0.5 * ph.a1 * s * s + (k * s * s * s) / 6, v: ph.ve + ph.a1 * s + 0.5 * k * s * s };
}

/** Tempo per percorrere x (0..D) in accelerazione: x(t) e' monotona, bisezione. */
function accelTime(ph, x) {
  if (x <= 0 || ph.T === 0) return 0;
  let lo = 0, hi = ph.T;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (accelState(ph, m).x < x) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Durata di un salto completo di lunghezza L (s, senza preparazione). */
export function jumpTime(L, profile) {
  const ph = accelPhase(profile);
  if (!ph) return null;
  if (ph.T === 0) return L / ph.vmax;
  if (L >= 2 * ph.D) return 2 * ph.T + (L - 2 * ph.D) / ph.vmax;
  return 2 * accelTime(ph, L / 2);
}

/** Tempo e velocita' dopo aver percorso s su una tratta di lunghezza L (uscita manuale in s). */
export function dropState(s, L, profile) {
  const ph = accelPhase(profile);
  if (!ph) return null;
  if (ph.T === 0) return { time: s / ph.vmax, speed: ph.vmax, phase: 'crociera', lowerBound: true };
  const half = L >= 2 * ph.D ? ph.D : L / 2;
  const cruise = L >= 2 * ph.D ? (L - 2 * ph.D) / ph.vmax : 0;
  const tHalf = L >= 2 * ph.D ? ph.T : accelTime(ph, half);
  if (s <= half) { const t = accelTime(ph, s); return { time: t, speed: accelState(ph, t).v, phase: 'accelerazione', lowerBound: false }; }
  if (s <= L - half) return { time: tHalf + (s - half) / ph.vmax, speed: ph.vmax, phase: 'crociera', lowerBound: false };
  const tBack = accelTime(ph, L - s); // decelerazione speculare
  return { time: 2 * tHalf + cruise - tBack, speed: accelState(ph, tBack).v, phase: 'decelerazione', lowerBound: false };
}

/** Volo convenzionale: profilo trapezoidale con accelerazione a = decelerazione. */
export function convTime(d, v, a = 0) {
  if (!(v > 0)) return null;
  if (!(a > 0)) return { time: d / v, lowerBound: true };
  return { time: d >= (v * v) / a ? d / v + v / a : 2 * Math.sqrt(d / a), lowerBound: false };
}
