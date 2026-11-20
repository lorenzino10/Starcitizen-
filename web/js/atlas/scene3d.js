// ATLANTE 3D v2: matematica pura (testabile in Node, nessun DOM, nessun WebGL).
//  - rotazione dei corpi nel tempo reale ("ADESSO") e posizione attuale dei luoghi in superficie
//  - occlusione: un luogo e' nascosto se un pianeta/luna sta fra la camera e il luogo
//  - ritaglio dei segmenti sul piano vicino, raggio-sfera, zoom verso il cursore, volo ad arco
//
// ROTAZIONE. In Star Citizen pianeti e lune NON orbitano: le posizioni dei file di gioco sono fisse e
// restano quelle. Cambia solo la rotazione di ogni corpo sul proprio asse (+Z del sistema), quindi dove
// si trova ORA una base in superficie, se e' giorno o notte e l'ora locale.
// Fonte dei parametri: dataset della community raccolto da Murphy Exploration Group dai file di gioco,
// pubblicato nel progetto VerseTime (data/bodies.csv): durata del giorno in ore reali e correzione di
// fase in gradi, riferite al 2020-01-01 00:00 UTC. Solo i numeri: nessun codice copiato.
// Formula (ricavata qui): phi(t) = 360 * frac(giorni dal 2020 / (ore/24)) + correzione + 90 gradi, in
// senso antiorario attorno a +Z; posizione attuale = centro + Rz(phi) * (posizione statica - centro).
// Verifica: le coordinate locali delle basi in quel dataset coincidono con quelle di scunpacked
// (New Babbage 520,723 / 419,364 / 743,655 km in entrambe), quindi il frame del corpo e' lo stesso.
// Stato: DATO DELLA COMMUNITY, DA COLLAUDARE IN GIOCO (alba/tramonto osservati a una base). Nyx: assente.

export const ROTATION_SOURCE = {
  label: 'Murphy Exploration Group via VerseTime (data/bodies.csv)',
  url: 'https://github.com/dydrmr/VerseTime',
  epoch: '2020-01-01T00:00:00Z',
  status: 'dato della community, da collaudare in gioco',
};
const EPOCH_MS = Date.UTC(2020, 0, 1);

/** [ore reali per rotazione, correzione in gradi]. Fuego: 0 nel dataset = rotazione non nota. */
export const ROTATION = {
  stanton: {
    hurston: [2.48, 27.481], arial: [5.51, 293.738], aberdeen: [2.6, 198.981], magda: [1.94, 117.217], ita: [4.85, 143.818],
    crusader: [5.1, 152.311], cellin: [4.45, 300.531], daymar: [2.48, 27.482], yela: [1.82, 271.832],
    arccorp: [3.11, 88.718], lyria: [6.43, 85.383], wala: [6.32, 294.841],
    microtech: [4.12, 131.621], calliope: [4.59, 114.335], clio: [3.25, 285.42], euterpe: [4.28, 72.554],
  },
  pyro: {
    pyroi: [2.42, 342.024], monox: [3.11, 173.951], bloom: [5.03, 194.822], pyrov: [5.1, 255.394], pyroiv: [4.09, 198.548],
    terminus: [2.87, 121.41], ignis: [3.44, 335.794], vatra: [3.42, 315.865], adir: [2.37, 312.525], fairo: [5.08, 349.722], vuur: [5.16, 125.782],
  },
};
/** Raggi delle stelle (m) dallo stesso dataset: usati solo per grafica ed eclissi. */
export const STAR_RADIUS = { stanton: 696000e3, pyro: 570720e3 };

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const frac = (x) => x - Math.floor(x);
export const DEG = Math.PI / 180;

/** Parametri di rotazione di un corpo, o null se non noti. */
export function rotationOf(system, name) {
  const r = ROTATION[key(system)]?.[key(name)];
  return r && r[0] > 0 ? { hours: r[0], correction: r[1] } : null;
}

/** Angolo di rotazione (radianti, 0..2pi) del corpo all'istante t (ms epoch), o null. */
export function rotationAngle(system, name, t = Date.now()) {
  const r = rotationOf(system, name); if (!r) return null;
  const days = (t - EPOCH_MS) / 86400000;
  const deg = 360 * frac(days / (r.hours / 24)) + r.correction + 90;
  return ((deg % 360) + 360) % 360 * DEG;
}

/** Ruota p attorno all'asse Z passante per c. */
export function rotateZ(p, c, a) {
  const dx = p.x - c.x, dy = p.y - c.y, ca = Math.cos(a), sa = Math.sin(a);
  return { x: c.x + dx * ca - dy * sa, y: c.y + dx * sa + dy * ca, z: p.z };
}

/**
 * Ora solare locale (0..24) e altezza della stella (gradi) per un luogo in superficie all'istante t.
 * @param local offset statico dal centro del corpo (m), body {pos}, star {pos}
 */
export function localSun(local, body, starPos, angle) {
  if (angle == null || !starPos) return null;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const n = { x: local.x * ca - local.y * sa, y: local.x * sa + local.y * ca, z: local.z };
  const r = Math.hypot(n.x, n.y, n.z) || 1;
  const s = { x: starPos.x - body.pos.x, y: starPos.y - body.pos.y, z: starPos.z - body.pos.z };
  const sl = Math.hypot(s.x, s.y, s.z) || 1;
  const elev = Math.asin(Math.max(-1, Math.min(1, (n.x * s.x + n.y * s.y + n.z * s.z) / (r * sl)))) / DEG;
  // angolo orario: differenza di longitudine fra il luogo e il punto sotto la stella (rotazione antioraria)
  let h = Math.atan2(n.y, n.x) - Math.atan2(s.y, s.x);
  h = ((h / (2 * Math.PI)) % 1 + 1.5) % 1; // 0.5 = mezzogiorno
  return { hour: h * 24, elevation: elev, day: elev > 0 };
}

/** "07:42" da ore decimali. */
export const fmtHour = (h) => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/** Prossimo cambio luce (alba o tramonto) in minuti reali, cercando in avanti a passi di 1 minuto (max 1 giorno). */
export function nextLightChange(system, bodyName, local, body, starPos, t = Date.now()) {
  const r = rotationOf(system, bodyName); if (!r) return null;
  const s0 = localSun(local, body, starPos, rotationAngle(system, bodyName, t)); if (!s0) return null;
  const limit = Math.ceil(r.hours * 60) + 1;
  for (let m = 1; m <= limit; m++) {
    const s = localSun(local, body, starPos, rotationAngle(system, bodyName, t + m * 60000));
    if (s.day !== s0.day) return { minutes: m, event: s.day ? 'alba' : 'tramonto' };
  }
  return { minutes: null, event: s0.day ? 'sempre giorno' : 'sempre notte' };
}

// ---------------------------------------------------------------- geometria della vista

/** Intersezione raggio-sfera: distanza t >= 0 del primo contatto, o null. dir normalizzata. */
export function raySphere(o, dir, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s, t1 = -b + s;
  if (t1 < 0) return null;
  return t0 >= 0 ? t0 : 0; // camera dentro la sfera: contatto immediato
}

/**
 * Il punto p e' nascosto da una delle sfere viste dall'occhio? Una sfera non nasconde i luoghi che le
 * appartengono quando sono sul lato visibile: la tolleranza (0,2 % del raggio + 50 m) evita che un
 * luogo esattamente in superficie sia coperto dal proprio corpo.
 */
export function occluded(eye, p, spheres) {
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z, L = Math.hypot(dx, dy, dz);
  if (!(L > 0)) return false;
  const dir = { x: dx / L, y: dy / L, z: dz / L };
  for (const s of spheres) {
    const t = raySphere(eye, dir, s.center, s.radius);
    if (t != null && t < L - (s.radius * 0.002 + 50)) return true;
  }
  return false;
}

/** Ritaglia il segmento (in coordinate di vista, Z avanti) sul piano Z = near. null se tutto dietro. */
export function clipNear(a, b, near) {
  if (a.z >= near && b.z >= near) return [a, b];
  if (a.z < near && b.z < near) return null;
  const t = (near - a.z) / (b.z - a.z);
  const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
  return a.z < near ? [m, b] : [a, m];
}

/** Coordinate di vista (X destra, Y su, Z avanti) dal proiettore di view.js, in doppia precisione. */
export function toView(P, p) {
  const dx = p.x - P.eye.x, dy = p.y - P.eye.y, dz = p.z - P.eye.z;
  return { x: dx * P.r.x + dy * P.r.y + dz * P.r.z, y: dx * P.u.x + dy * P.u.y + dz * P.u.z, z: dx * P.f.x + dy * P.f.y + dz * P.f.z };
}

/**
 * Zoom verso il cursore: il punto sotto il cursore (sul piano del bersaglio, perpendicolare alla vista)
 * resta fermo sullo schermo mentre la distanza cambia di un fattore k.
 */
export function zoomAt(cam, P, sx, sy, k) {
  const m = P.metersPerPixel();
  const ox = (sx - P.w / 2) * m, oy = -(sy - P.h / 2) * m;
  const under = { x: cam.target.x + P.r.x * ox + P.u.x * oy, y: cam.target.y + P.r.y * ox + P.u.y * oy, z: cam.target.z + P.r.z * ox + P.u.z * oy };
  const t = cam.target;
  return { target: { x: under.x + (t.x - under.x) * k, y: under.y + (t.y - under.y) * k, z: under.z + (t.z - under.z) * k }, dist: cam.dist * k };
}

/**
 * Volo della camera ad arco: lontano dalla meta la camera si alza (in scala logaritmica) e poi scende,
 * cosi' un salto fra due pianeti mostra il percorso invece di attraversare il sistema a pochi km.
 * @returns funzione e (0..1) -> {target, dist}
 */
export function flyPath(from, to) {
  const travel = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const top = Math.max(from.d, to.d, travel * 0.9);
  const lift = Math.max(0, Math.log(top) - Math.max(Math.log(from.d), Math.log(to.d)));
  return (e) => {
    const s = e * e * (3 - 2 * e);
    const target = { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s, z: from.z + (to.z - from.z) * s };
    const ld = Math.log(from.d) + (Math.log(to.d) - Math.log(from.d)) * e + lift * Math.sin(Math.PI * e);
    return { target, dist: Math.exp(ld) };
  };
}
/** Durata del volo (ms): piu' lunga se la scala cambia molto. */
export function flyDuration(from, to) {
  const travel = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const orders = Math.abs(Math.log10(to.d / from.d)) + Math.log10(1 + travel / Math.max(from.d, to.d));
  return Math.round(Math.min(1600, 420 + orders * 260));
}

/** Gesto a due dita: fattore di zoom, spostamento del punto medio e rotazione fra due istanti. */
export function pinch(a0, b0, a1, b1) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1, d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1;
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  let rot = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
  if (rot > Math.PI) rot -= 2 * Math.PI; if (rot < -Math.PI) rot += 2 * Math.PI;
  return { scale: d0 / d1, mid: m1, dx: m1.x - m0.x, dy: m1.y - m0.y, rot };
}

/**
 * Pianificatore dei fotogrammi: ridisegna se qualcosa e' cambiato; anima (flusso delle rotte,
 * granulazione della stella) solo se le animazioni sono accese, la mappa e' visibile e l'utente ha
 * toccato la mappa negli ultimi idleMs. Tetto di fps per non rubare GPU al gioco o batteria al telefono.
 */
export function frameDecision({ dirty, animOn, visible, now, lastInput, lastFrame, idleMs = 20000, fps = 30 }) {
  if (!visible) return { draw: false, animating: false };
  const animating = !!animOn && now - lastInput < idleMs;
  if (dirty) return { draw: true, animating };
  if (animating && now - lastFrame >= 1000 / fps - 1) return { draw: true, animating };
  return { draw: false, animating };
}
