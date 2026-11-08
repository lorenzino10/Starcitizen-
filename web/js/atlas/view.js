// Matematica della mappa (pura, testabile senza browser): camera orbitale, proiezione prospettica o
// ortogonale (vista 2D), scala visiva compressa, raggruppamento dei punti vicini sullo schermo,
// selezione con il mouse. La geometria VISIVA non entra mai nei calcoli di distanza: quelli usano
// sempre le coordinate reali (geo.js).

export const DEG = Math.PI / 180;

/** Camera: target (metri, frame del sistema), distanza, azimut, elevazione. */
export function camera({ target = { x: 0, y: 0, z: 0 }, dist = 1e10, yaw = -60 * DEG, pitch = 35 * DEG, fov = 50 * DEG, ortho = false } = {}) {
  return { target, dist, yaw, pitch, fov, ortho };
}

/** Prepara la proiezione per una camera e una dimensione di schermo. */
export function projector(cam, w, h) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const dir = { x: cp * cy, y: cp * sy, z: sp }; // dal target verso la camera
  const eye = { x: cam.target.x + dir.x * cam.dist, y: cam.target.y + dir.y * cam.dist, z: cam.target.z + dir.z * cam.dist };
  const f = { x: -dir.x, y: -dir.y, z: -dir.z };
  // destra = f x su(z); se la camera guarda in verticale si usa l'azimut
  let r = { x: f.y, y: -f.x, z: 0 };
  let rl = Math.hypot(r.x, r.y);
  if (rl < 1e-9) { r = { x: Math.sin(cam.yaw), y: -Math.cos(cam.yaw), z: 0 }; rl = 1; }
  r = { x: r.x / rl, y: r.y / rl, z: 0 };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const F = (h / 2) / Math.tan(cam.fov / 2);
  const near = cam.dist * 1e-4;
  return {
    w, h, eye, f, r, u, F,
    /** @returns {{x,y,depth,visible}} */
    project(p) {
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const X = dx * r.x + dy * r.y + dz * r.z, Y = dx * u.x + dy * u.y + dz * u.z, Z = dx * f.x + dy * f.y + dz * f.z;
      if (cam.ortho) { const k = F / cam.dist; return { x: w / 2 + X * k, y: h / 2 - Y * k, depth: Z, visible: true }; }
      if (Z <= near) return { x: NaN, y: NaN, depth: Z, visible: false };
      return { x: w / 2 + (X / Z) * F, y: h / 2 - (Y / Z) * F, depth: Z, visible: true };
    },
    /** Metri per pixel alla distanza del target (per scale e soglie). */
    metersPerPixel() { return cam.ortho ? cam.dist / F : cam.dist / F; },
  };
}

/**
 * Scala visiva compressa (solo grafica): la distanza dal centro c diventa s*ln(1 + r/s).
 * Rende leggibili orbite molto diverse; le distanze mostrate restano quelle reali.
 */
export function compressor(center, s) {
  return (p) => {
    const v = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z };
    const r = Math.hypot(v.x, v.y, v.z);
    if (r === 0) return { ...center };
    const k = (s * Math.log1p(r / s)) / r;
    return { x: center.x + v.x * k, y: center.y + v.y * k, z: center.z + v.z * k };
  };
}

/**
 * Raggruppa i punti proiettati troppo vicini (raggio in pixel). Il punto con priorita' piu' alta
 * rappresenta il gruppo; zoomando i gruppi si separano da soli.
 * @param pts [{id, x, y, depth, priority}]
 * @returns [{lead, members:[...]}]
 */
export function cluster(pts, radius = 14) {
  const sorted = pts.filter((p) => Number.isFinite(p.x)).sort((a, b) => b.priority - a.priority || a.depth - b.depth || (a.id < b.id ? -1 : 1));
  const cell = Math.max(1, radius), grid = new Map(), out = [];
  const key = (i, j) => `${i},${j}`;
  for (const p of sorted) {
    const i = Math.floor(p.x / cell), j = Math.floor(p.y / cell);
    let hit = null;
    for (let a = -1; a <= 1 && !hit; a++) for (let b = -1; b <= 1 && !hit; b++) {
      for (const c of grid.get(key(i + a, j + b)) ?? []) if (Math.hypot(c.lead.x - p.x, c.lead.y - p.y) < radius) { hit = c; break; }
    }
    if (hit) hit.members.push(p);
    else { const c = { lead: p, members: [p] }; out.push(c); const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
  }
  return out;
}

/** Etichette senza sovrapposizioni (in ordine di priorita'). */
export function placeLabels(items, { charW = 6.5, h = 12, pad = 3 } = {}) {
  const taken = [], out = [];
  for (const it of items) {
    const w = it.text.length * charW;
    const box = { x0: it.x + 8, y0: it.y - h / 2, x1: it.x + 8 + w, y1: it.y + h / 2 };
    if (taken.some((b) => !(box.x1 + pad < b.x0 || box.x0 - pad > b.x1 || box.y1 + pad < b.y0 || box.y0 - pad > b.y1))) continue;
    taken.push(box); out.push({ ...it, box });
  }
  return out;
}

/** Distanza di un punto dal segmento (pixel). */
export function segDist(px, py, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / L)) : 0;
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

/** Selezione: gruppo piu' vicino entro 12 px, altrimenti collegamento entro 6 px. */
export function pick(px, py, clusters, lines = []) {
  let best = null, bd = 12;
  for (const c of clusters) { const d = Math.hypot(c.lead.x - px, c.lead.y - py); if (d < bd) { bd = d; best = c; } }
  if (best) return { kind: best.members.length > 1 ? 'cluster' : 'place', cluster: best, id: best.lead.id };
  let bl = null, ld = 6;
  for (const l of lines) { if (!l.a?.visible || !l.b?.visible || !l.pickable) continue; const d = segDist(px, py, l.a, l.b); if (d < ld) { ld = d; bl = l; } }
  return bl ? { kind: 'line', line: bl, id: bl.id } : null;
}

/** Distanza della camera che inquadra un insieme di punti (raggio massimo dal centro). */
export function frameDistance(center, pts, fov = 50 * DEG, margin = 1.4) {
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z));
  return Math.max(r * margin / Math.tan(fov / 2), 2000);
}
