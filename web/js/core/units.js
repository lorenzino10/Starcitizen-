// Formattazione delle distanze. Unita' interna: metro.
export const KM = 1e3, MM = 1e6, GM = 1e9;

const it = (n, d = 0) => n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Distanza esatta in km arrotondata al km, es. "14.290.792 km". */
export const fmtKm = (m) => `${it(Math.round(m / KM))} km`;

/** Forma compatta: km sotto 1 Mm, poi Mm, poi Gm. */
export function fmtAuto(m) {
  const a = Math.abs(m);
  if (a < MM) return `${it(m / KM, 1)} km`;
  if (a < GM) return `${it(m / MM, 2)} Mm`;
  return `${it(m / GM, 3)} Gm`;
}

const unitFor = (m) => (Math.abs(m) >= GM ? ['Gm', GM] : Math.abs(m) >= MM ? ['Mm', MM] : ['km', KM]);

/** Valore come potrebbe apparire nell'HUD (decimali da confermare in gioco). */
export function hudReading(m, decimals = 1) {
  const [u, div] = unitFor(m);
  return `${(m / div).toFixed(decimals)} ${u}`;
}

/** Ampiezza in metri di un passo dell'ultima cifra HUD. */
export const hudResolution = (m, decimals = 1) => unitFor(m)[1] / 10 ** decimals;
