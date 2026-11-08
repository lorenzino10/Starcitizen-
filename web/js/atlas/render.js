// Renderer della mappa su <canvas> 2D (nessuna libreria esterna, nessun WebGL richiesto: funziona
// anche dove WebGL manca). Prospettiva 3D con rotazione/zoom/pan, oppure vista 2D ortogonale dall'alto.
// Disegna solo quando qualcosa cambia.
import { camera, projector, cluster, placeLabels, pick, frameDistance, compressor, DEG } from './view.js';

const STYLE = {
  star: { c: '#ffd36b', r: 9, shape: 'circle', p: 100 },
  planet: { c: '#3fd0ff', r: 7, shape: 'circle', p: 90 },
  gateway: { c: '#ffb347', r: 6, shape: 'diamond', p: 85 },
  moon: { c: '#7fb6d9', r: 5, shape: 'circle', p: 80 },
  city: { c: '#cfe8ff', r: 5, shape: 'square', p: 75 },
  station: { c: '#9fe0ff', r: 5, shape: 'diamond', p: 70 },
  personal: { c: '#ff7ad9', r: 5, shape: 'triangle', p: 55 },
  outpost: { c: '#8fd19e', r: 4, shape: 'square', p: 50 },
  poi: { c: '#a98fd1', r: 3, shape: 'circle', p: 30 },
  jumppoint: { c: '#ffb347', r: 5, shape: 'diamond', p: 60 },
  navpoint: { c: '#5b7a99', r: 2, shape: 'circle', p: 15 },
  asteroid: { c: '#6b7f90', r: 2, shape: 'circle', p: 10 },
  other: { c: '#5b7a99', r: 2, shape: 'circle', p: 5 },
};
export const LINE_STYLE = {
  confermata: { c: '#5dff9d', w: 2.5, dash: [] },
  ipotetica: { c: '#ffb347', w: 2, dash: [7, 5] },
  navcom: { c: '#3fd0ff', w: 2.5, dash: [] },
  nonverificata: { c: '#ff5f6d', w: 1.5, dash: [2, 4] },
  fisso: { c: '#cfe8ff', w: 1.5, dash: [] },
  possibile: { c: '#5b7a99', w: 1, dash: [3, 4] },
  offerta: { c: '#a98fd1', w: 1.5, dash: [1, 4] },
};
export const styleOf = (kind) => STYLE[kind] ?? STYLE.other;

export class AtlasView {
  constructor(canvas, { onPick = () => {}, onHover = () => {} } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.onPick = onPick; this.onHover = onHover;
    this.cam = camera(); this.scene = { items: [], lines: [], sphere: null, compress: null };
    this.clusters = []; this.plines = []; this.dirty = true; this.anim = null; this.hover = null;
    this.ok = !!this.ctx;
    if (!this.ok) return;
    this.#bind();
    const loop = () => { this.#step(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setScene(scene) { this.scene = { items: [], lines: [], sphere: null, compress: null, ...scene }; this.dirty = true; }
  setOrtho(on) { this.cam.ortho = on; if (on) this.cam.pitch = 89.9 * DEG; else if (this.cam.pitch > 80 * DEG) this.cam.pitch = 35 * DEG; this.dirty = true; }

  /** Inquadra un insieme di posizioni reali (con animazione). */
  frame(points, center = null) {
    const vis = this.scene.compress ? points.map(this.scene.compress) : points;
    const c = center ? (this.scene.compress ? this.scene.compress(center) : center) : centroid(vis);
    const d = frameDistance(c, vis.length ? vis : [c], this.cam.fov);
    this.flyTo(c, d);
  }
  flyTo(target, dist) {
    this.anim = { t0: performance.now(), from: { ...this.cam.target, d: this.cam.dist }, to: { ...target, d: dist } };
    this.dirty = true;
  }
  /** Posizione visiva di un punto reale (scala compressa inclusa). */
  vis(p) { return this.scene.compress ? this.scene.compress(p) : p; }

  #step() {
    if (this.anim) {
      const k = Math.min(1, (performance.now() - this.anim.t0) / 450), e = 1 - (1 - k) ** 3;
      const a = this.anim.from, b = this.anim.to;
      this.cam.target = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
      this.cam.dist = Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * e);
      if (k >= 1) this.anim = null;
      this.dirty = true;
    }
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    const dpr = globalThis.devicePixelRatio || 1;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    this.#draw(W, H, dpr);
  }

  #draw(W, H, dpr) {
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#05090f'; g.fillRect(0, 0, W, H);
    const P = projector(this.cam, W, H);
    const V = (p) => P.project(this.vis(p));
    const sc = this.scene;
    // globo del corpo (solo se il raggio e' noto)
    if (sc.sphere) this.#sphere(g, P, sc.sphere);
    // collegamenti
    this.plines = [];
    for (const l of sc.lines) {
      const a = V(l.a), b = V(l.b);
      if (!a.visible || !b.visible) continue;
      const s = LINE_STYLE[l.style] ?? LINE_STYLE.possibile;
      g.strokeStyle = l.color ?? s.c; g.lineWidth = l.width ?? s.w; g.setLineDash(s.dash); g.globalAlpha = l.alpha ?? 0.9;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.setLineDash([]);
      if (l.arrow) arrow(g, a, b, l.color ?? s.c);
      if (l.label) { g.globalAlpha = 1; g.fillStyle = l.color ?? s.c; g.font = '11px Consolas, monospace'; g.fillText(l.label, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4); }
      g.globalAlpha = 1;
      this.plines.push({ ...l, a, b });
    }
    // punti
    const pts = [];
    for (const it of sc.items) {
      if (!it.pos) continue;
      const q = V(it.pos);
      if (!q.visible || q.x < -40 || q.y < -40 || q.x > W + 40 || q.y > H + 40) continue;
      const st = styleOf(it.kind);
      let back = false;
      if (sc.sphere && it.onSurface) { const n = sub(it.pos, sc.sphere.center); back = dot3(n, sub(P.eye, it.pos)) < 0; }
      const body = it.kind === 'star' || it.kind === 'planet' || it.kind === 'moon' ? 200 : 0; // i corpi celesti guidano sempre il gruppo
      pts.push({ id: it.id, x: q.x, y: q.y, depth: q.depth, priority: (it.priority ?? st.p) + body + (it.selected ? 1000 : 0) + (it.badge ? 20 : 0) - (back ? 40 : 0), it, st, back });
    }
    this.clusters = cluster(pts, sc.clusterRadius ?? 14);
    const draws = [...this.clusters].sort((a, b) => b.lead.depth - a.lead.depth);
    for (const c of draws) {
      const p = c.lead, st = p.st, it = p.it;
      g.globalAlpha = p.back ? 0.35 : 1;
      if (c.members.length > 1) {
        const r = Math.min(16, 7 + Math.log2(c.members.length) * 2);
        g.fillStyle = 'rgba(20,48,74,0.85)'; g.strokeStyle = st.c; g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillStyle = '#cfe8ff'; g.font = 'bold 10px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(c.members.length), p.x, p.y); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      } else {
        shape(g, st.shape, p.x, p.y, it.size ?? st.r, it.color ?? st.c);
      }
      if (it.badge) { g.strokeStyle = it.badge.color; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, (it.size ?? st.r) + 4, 0, Math.PI * 2); g.stroke(); }
      if (it.ring) { g.strokeStyle = it.ring; g.lineWidth = 2; g.setLineDash([2, 2]); g.beginPath(); g.arc(p.x, p.y, (it.size ?? st.r) + 8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
      if (it.selected) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.strokeRect(p.x - 10, p.y - 10, 20, 20); }
      if (it.tag) { g.fillStyle = '#05090f'; g.strokeStyle = it.tag.color; g.lineWidth = 1; g.fillRect(p.x - 18, p.y - 22, 14, 13); g.strokeRect(p.x - 18, p.y - 22, 14, 13); g.fillStyle = it.tag.color; g.font = 'bold 10px Consolas, monospace'; g.fillText(it.tag.text, p.x - 15, p.y - 12); }
      g.globalAlpha = 1;
    }
    // etichette
    const labels = placeLabels(this.clusters.filter((c) => !c.lead.back).sort((a, b) => b.lead.priority - a.lead.priority)
      .map((c) => ({ x: c.lead.x, y: c.lead.y, text: c.members.length > 1 ? `${c.lead.it.label} +${c.members.length - 1}` : (c.lead.it.label ?? ''), c })).filter((l) => l.text));
    g.font = '11px Consolas, monospace';
    for (const l of labels) { g.fillStyle = l.c.lead.it.selected ? '#ffffff' : '#9fc3e0'; g.fillText(l.text, l.box.x0, l.box.y1 - 2); }
    // scala
    const mpp = P.metersPerPixel() * (this.scene.compress ? NaN : 1);
    g.fillStyle = '#5b7a99'; g.font = '10px Consolas, monospace';
    g.fillText(Number.isFinite(mpp) ? `scala: 100 px ≈ ${fmtLen(mpp * 100)} (alla distanza del centro)` : 'scala visiva compressa: le distanze reali sono nelle schede', 10, H - 10);
    if (this.cam.ortho) g.fillText('VISTA 2D (piano XY dall\'alto)', 10, 16);
  }

  #sphere(g, P, s) {
    const c = P.project(s.center); if (!c.visible) return;
    const edge = P.project({ x: s.center.x + P.u.x * s.radius, y: s.center.y + P.u.y * s.radius, z: s.center.z + P.u.z * s.radius });
    const r = Math.hypot(edge.x - c.x, edge.y - c.y);
    g.fillStyle = 'rgba(30,60,90,0.35)'; g.strokeStyle = '#2a4766'; g.lineWidth = 1;
    g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    // reticolo lat/lon (solo emisfero visibile)
    g.strokeStyle = 'rgba(63,208,255,0.18)';
    const pt = (lat, lon) => ({ x: s.center.x + s.radius * Math.cos(lat) * Math.cos(lon), y: s.center.y + s.radius * Math.cos(lat) * Math.sin(lon), z: s.center.z + s.radius * Math.sin(lat) });
    const front = (p) => dot3(sub(p, s.center), sub(P.eye, p)) >= 0;
    const poly = (list) => { let open = false; g.beginPath(); for (const p of list) { const q = P.project(p); if (!front(p) || !q.visible) { open = false; continue; } if (!open) { g.moveTo(q.x, q.y); open = true; } else g.lineTo(q.x, q.y); } g.stroke(); };
    for (let la = -60; la <= 60; la += 30) poly(Array.from({ length: 73 }, (_, i) => pt(la * DEG, i * 5 * DEG)));
    for (let lo = 0; lo < 360; lo += 30) poly(Array.from({ length: 37 }, (_, i) => pt((-90 + i * 5) * DEG, lo * DEG)));
  }

  #bind() {
    const cv = this.cv; let drag = null;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button === 2 || e.shiftKey || this.cam.ortho && e.button !== 0 }; });
    cv.addEventListener('pointermove', (e) => {
      const rect = cv.getBoundingClientRect();
      if (!drag) {
        const h = pick(e.clientX - rect.left, e.clientY - rect.top, this.clusters, this.plines);
        const id = h ? `${h.kind}:${h.id}` : null;
        if (id !== this.hover) { this.hover = id; cv.style.cursor = h ? 'pointer' : 'grab'; this.onHover(h); }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan || this.cam.ortho) {
        const P = projector(this.cam, cv.clientWidth, cv.clientHeight), k = P.metersPerPixel();
        const t = this.cam.target;
        this.cam.target = { x: t.x - (P.r.x * dx - P.u.x * dy) * k, y: t.y - (P.r.y * dx - P.u.y * dy) * k, z: t.z - (P.r.z * dx - P.u.z * dy) * k };
      } else {
        this.cam.yaw -= dx * 0.008;
        this.cam.pitch = Math.max(-89 * DEG, Math.min(89.9 * DEG, this.cam.pitch + dy * 0.008));
      }
      this.anim = null; this.dirty = true;
    });
    cv.addEventListener('pointerup', (e) => {
      const d = drag; drag = null;
      if (d && !d.moved) {
        const rect = cv.getBoundingClientRect();
        const h = pick(e.clientX - rect.left, e.clientY - rect.top, this.clusters, this.plines);
        if (h?.kind === 'cluster') { const ms = h.cluster.members.map((m) => m.it.pos); this.frame(ms); }
        this.onPick(h);
      }
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist *= Math.exp(Math.sign(e.deltaY) * 0.18); this.cam.dist = Math.max(500, Math.min(2e12, this.cam.dist)); this.anim = null; this.dirty = true; }, { passive: false });
    globalThis.addEventListener?.('resize', () => { this.dirty = true; });
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const centroid = (ps) => { const n = ps.length || 1; return ps.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n, z: s.z + p.z / n }), { x: 0, y: 0, z: 0 }); };
export const fmtLen = (m) => (m >= 1e9 ? `${(m / 1e9).toFixed(m >= 1e10 ? 0 : 1)} Gm` : m >= 1e6 ? `${(m / 1e6).toFixed(1)} Mm` : m >= 1e3 ? `${Math.round(m / 1e3).toLocaleString('it-IT')} km` : `${Math.round(m)} m`);

function shape(g, s, x, y, r, c) {
  g.fillStyle = c; g.strokeStyle = '#05090f'; g.lineWidth = 1;
  g.beginPath();
  if (s === 'square') g.rect(x - r, y - r, 2 * r, 2 * r);
  else if (s === 'diamond') { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); }
  else if (s === 'triangle') { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y + r); g.lineTo(x - r - 1, y + r); g.closePath(); }
  else g.arc(x, y, r, 0, Math.PI * 2);
  g.fill(); g.stroke();
}
function arrow(g, a, b, c) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), mx = a.x + (b.x - a.x) * 0.62, my = a.y + (b.y - a.y) * 0.62;
  g.fillStyle = c; g.beginPath(); g.moveTo(mx + Math.cos(ang) * 7, my + Math.sin(ang) * 7);
  g.lineTo(mx + Math.cos(ang + 2.5) * 6, my + Math.sin(ang + 2.5) * 6); g.lineTo(mx + Math.cos(ang - 2.5) * 6, my + Math.sin(ang - 2.5) * 6); g.closePath(); g.fill();
}
export { compressor };
