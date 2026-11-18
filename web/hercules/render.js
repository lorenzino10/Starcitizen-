// HERCULES · disegni della stiva in SVG (nessuna libreria): vista 3D isometrica e piani dall'alto.

export const STOP_COLORS = ['#3fd0ff', '#ffb347', '#5dff9d', '#ff5f6d', '#c58cff', '#ffe066', '#4dd4ac', '#ff8fc7', '#8fa8ff', '#d9d9d9', '#ff9f43', '#7bed9f'];
export const colorOf = (stop) => STOP_COLORS[stop % STOP_COLORS.length];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/**
 * Vista 3D isometrica. Chi guarda sta dietro la rampa, in alto a destra: la rampa e' in basso a
 * sinistra, la prua in alto a destra. Si disegnano solo le casse delle tappe > afterStop.
 */
export function isoSvg(plan, { afterStop = -1, labels = new Map(), highlight = null } = {}) {
  const h = plan.hold, { W, L, H } = h;
  const u = 20, c = Math.cos(Math.PI / 6) * u, s = 0.5 * u;
  // X = laterale, Y = L - y (rampa vicina a chi guarda), Z = altezza
  const P = (X, Y, Z) => [(X - Y) * c, (X + Y) * s - Z * u];
  const occ = new Int32Array(W * L * H);
  const at = (X, Y, Z) => (X < 0 || Y < 0 || Z < 0 || X >= W || Y >= L || Z >= H) ? 0 : occ[(Z * L + Y) * W + X];
  const shown = plan.boxes.filter((b) => b.stop > afterStop);
  for (const b of shown) for (let z = b.z; z < b.z + b.h; z++) for (let y = b.y; y < b.y + b.l; y++) for (let x = b.x; x < b.x + b.w; x++) occ[(z * L + (L - 1 - y)) * W + x] = b.id + 1;
  const pts = (arr) => arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const out = [];
  // pavimento delle griglie
  for (const g of h.grids) {
    const Y0 = L - (g.y0 + g.l), Y1 = L - g.y0, X0 = g.x0, X1 = g.x0 + g.w;
    out.push(`<polygon class="floor" points="${pts([P(X0, Y0, 0), P(X1, Y0, 0), P(X1, Y1, 0), P(X0, Y1, 0)])}"/>`);
    for (let X = X0 + 1; X < X1; X++) out.push(`<line class="floorline" x1="${P(X, Y0, 0)[0]}" y1="${P(X, Y0, 0)[1]}" x2="${P(X, Y1, 0)[0]}" y2="${P(X, Y1, 0)[1]}"/>`);
    for (let Y = Y0 + 1; Y < Y1; Y++) out.push(`<line class="floorline" x1="${P(X0, Y, 0)[0]}" y1="${P(X0, Y, 0)[1]}" x2="${P(X1, Y, 0)[0]}" y2="${P(X1, Y, 0)[1]}"/>`);
    // sagoma dell'altezza della griglia (spigoli verticali)
    for (const [X, Y] of [[X0, Y1], [X1, Y1], [X1, Y0]]) { const a = P(X, Y, 0), b = P(X, Y, g.h); out.push(`<line class="wall" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`); }
    out.push(`<polyline class="wall" points="${pts([P(X0, Y1, g.h), P(X1, Y1, g.h), P(X1, Y0, g.h)])}"/>`);
  }
  // celle in ordine di pittura (X+Y+Z crescente)
  const cellsList = [];
  for (let Z = 0; Z < H; Z++) for (let Y = 0; Y < L; Y++) for (let X = 0; X < W; X++) { const v = at(X, Y, Z); if (v) cellsList.push([X, Y, Z, v]); }
  cellsList.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  for (const [X, Y, Z, v] of cellsList) {
    const b = plan.boxes[v - 1], col = colorOf(b.stop), hl = highlight === b.id ? ' hl' : '';
    const faces = [];
    if (!at(X, Y, Z + 1)) faces.push(['top', [P(X, Y, Z + 1), P(X + 1, Y, Z + 1), P(X + 1, Y + 1, Z + 1), P(X, Y + 1, Z + 1)], 1.0,
      [[at(X, Y - 1, Z) !== v || at(X, Y - 1, Z + 1), 0, 1], [at(X + 1, Y, Z) !== v || at(X + 1, Y, Z + 1), 1, 2], [at(X, Y + 1, Z) !== v || at(X, Y + 1, Z + 1), 2, 3], [at(X - 1, Y, Z) !== v || at(X - 1, Y, Z + 1), 3, 0]]]);
    if (!at(X + 1, Y, Z)) faces.push(['side', [P(X + 1, Y, Z), P(X + 1, Y + 1, Z), P(X + 1, Y + 1, Z + 1), P(X + 1, Y, Z + 1)], 0.62,
      [[at(X, Y, Z - 1) !== v, 0, 1], [at(X, Y + 1, Z) !== v || at(X + 1, Y + 1, Z), 1, 2], [at(X, Y, Z + 1) !== v, 2, 3], [at(X, Y - 1, Z) !== v || at(X + 1, Y - 1, Z), 3, 0]]]);
    if (!at(X, Y + 1, Z)) faces.push(['front', [P(X, Y + 1, Z), P(X + 1, Y + 1, Z), P(X + 1, Y + 1, Z + 1), P(X, Y + 1, Z + 1)], 0.8,
      [[at(X, Y, Z - 1) !== v, 0, 1], [at(X + 1, Y, Z) !== v || at(X + 1, Y + 1, Z), 1, 2], [at(X, Y, Z + 1) !== v, 2, 3], [at(X - 1, Y, Z) !== v || at(X - 1, Y + 1, Z), 3, 0]]]);
    for (const [, poly, f, edges] of faces) {
      const fc = shade(col, f);
      out.push(`<polygon class="face${hl}" data-id="${b.id}" fill="${fc}" stroke="${fc}" stroke-width="0.8" points="${pts(poly)}"/>`);
      for (const [draw, i, j] of edges) if (draw) out.push(`<line class="edge${hl}" x1="${poly[i][0].toFixed(1)}" y1="${poly[i][1].toFixed(1)}" x2="${poly[j][0].toFixed(1)}" y2="${poly[j][1].toFixed(1)}"/>`);
    }
  }
  // etichette sul tetto delle casse visibili dall'alto
  for (const b of shown) {
    const Y = L - (b.y + b.l), Ztop = b.z + b.h;
    let covered = false;
    for (let y = b.y; y < b.y + b.l && !covered; y++) for (let x = b.x; x < b.x + b.w; x++) if (at(x, L - 1 - y, Ztop)) { covered = true; break; }
    if (covered || b.w * b.l < 2) continue;
    const [cx, cy] = P(b.x + b.w / 2, Y + b.l / 2, Ztop);
    out.push(`<text class="lbl" x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}">${esc(labels.get(b.id) ?? '')}</text>`);
  }
  // orientamento
  const r = P(W / 2, L + 1.2, 0), n = P(W / 2 + 2, -2.5, H);
  out.push(`<text class="dir" x="${r[0]}" y="${r[1] + 14}">▼ RAMPA</text><text class="dir" x="${n[0]}" y="${n[1]}">PRUA ▲</text>`);
  const xs = [P(0, L + 2, 0)[0], P(W, -2, 0)[0]], ys = [P(W, -2, H + 1)[1], P(W + 1, L + 3, 0)[1]];
  const vb = [Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) - Math.min(...xs) + 40, Math.max(...ys) - Math.min(...ys) + 40];
  return `<svg class="iso" viewBox="${vb.map((v) => v.toFixed(0)).join(' ')}" role="img" aria-label="Vista 3D della stiva: ${shown.length} casse">${out.join('')}</svg>`;
}

/**
 * Piani dall'alto, uno per livello di 1,25 m. La rampa e' in basso, la prua in alto: e' come
 * vedere la stiva stando sulla rampa e guardando dentro (sinistra = sinistra).
 */
export function layersSvg(plan, { afterStop = -1, labels = new Map(), highlight = null } = {}) {
  const h = plan.hold, { W, L, H } = h, cs = 18;
  const shown = plan.boxes.filter((b) => b.stop > afterStop);
  const out = [];
  for (let z = 0; z < H; z++) {
    const parts = [];
    for (const g of h.grids) if (z < g.h) parts.push(`<rect class="cellbg" x="${g.x0 * cs}" y="${(L - g.y0 - g.l) * cs}" width="${g.w * cs}" height="${g.l * cs}"/>`
      + Array.from({ length: g.w - 1 }, (_, i) => `<line class="cellline" x1="${(g.x0 + i + 1) * cs}" x2="${(g.x0 + i + 1) * cs}" y1="${(L - g.y0 - g.l) * cs}" y2="${(L - g.y0) * cs}"/>`).join('')
      + Array.from({ length: g.l - 1 }, (_, i) => `<line class="cellline" x1="${g.x0 * cs}" x2="${(g.x0 + g.w) * cs}" y1="${(L - g.y0 - i - 1) * cs}" y2="${(L - g.y0 - i - 1) * cs}"/>`).join(''));
    for (const b of shown) {
      if (z < b.z || z >= b.z + b.h) continue;
      const x = b.x * cs, y = (L - b.y - b.l) * cs, w = b.w * cs, hh = b.l * cs;
      const cont = z > b.z ? ' cont' : '';
      parts.push(`<g class="box${cont}${highlight === b.id ? ' hl' : ''}" data-id="${b.id}"><rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${hh - 2}" fill="${colorOf(b.stop)}"/>`
        + `<text x="${x + w / 2}" y="${y + hh / 2 + 4}">${esc(z > b.z ? '↑' : labels.get(b.id) ?? '')}</text></g>`);
    }
    out.push(`<figure class="layer"><figcaption>Piano ${z + 1}<small>${(z * 1.25).toFixed(2).replace('.', ',')}–${((z + 1) * 1.25).toFixed(2).replace('.', ',')} m</small></figcaption>`
      + `<svg viewBox="-2 -16 ${W * cs + 4} ${L * cs + 34}" width="${W * cs + 4}" role="img" aria-label="Piano ${z + 1} visto dall'alto">`
      + `<text class="dir" x="${W * cs / 2}" y="-4">PRUA</text>${parts.join('')}<text class="dir" x="${W * cs / 2}" y="${L * cs + 14}">RAMPA</text></svg></figure>`);
  }
  return out.join('');
}
