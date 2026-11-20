// Renderer della mappa su <canvas> 2D (nessuna libreria esterna, nessun WebGL richiesto: funziona
// anche dove WebGL manca). Prospettiva 3D con rotazione/zoom/pan, oppure vista 2D ortogonale dall'alto.
// Sotto il canvas 2D (marker, etichette, selezione) c'e' uno strato grafico:
//  - WebGL2 (gl3d.js, ATLANTE 3D v2): profondita' vera, rotte e orbite sulla GPU, eclissi;
//  - WebGL1 (gl.js, 0.9.0) se WebGL2 manca;
//  - nessuno: resta il disegno 2D completo.
// Disegna solo quando qualcosa cambia; le animazioni (frecce delle rotte, stella) girano solo se
// accese, a mappa visibile e per 20 s dopo l'ultimo tocco, con un tetto di fotogrammi.
import { camera, projector, cluster, placeLabels, pick, frameDistance, compressor, DEG } from './view.js';
import { GLLayer, orbitPoints } from './gl.js';
import { GL3D, hexRgb } from './gl3d.js';
import { occluded, raySphere, zoomAt, flyPath, flyDuration, pinch, frameDecision } from './scene3d.js';

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
  regionale: { c: '#c9a0ff', w: 1.2, dash: [10, 6] },
};
export const styleOf = (kind) => STYLE[kind] ?? STYLE.other;
const KEY_ROT = 0.06, KEY_ZOOM = 0.16;

export class AtlasView {
  constructor(canvas, { onPick = () => {}, onHover = () => {}, gl = true } = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    // strato grafico sotto il canvas 2D (solo grafica); se manca resta il disegno 2D completo
    this.glLayer = null; this.glOn = false; this.gl3 = false;
    if (gl && canvas.parentNode && globalThis.document) {
      try {
        const g = document.createElement('canvas'); g.className = 'at-gl'; g.setAttribute('aria-hidden', 'true');
        canvas.parentNode.insertBefore(g, canvas);
        let L = new GL3D(g);
        if (L.ok) this.gl3 = true;
        else {
          // WebGL2 assente: riserva WebGL1 (0.9.0) su un canvas nuovo (un canvas tiene un solo contesto)
          const g1 = document.createElement('canvas'); g1.className = 'at-gl'; g1.setAttribute('aria-hidden', 'true');
          g.replaceWith(g1); L = new GLLayer(g1);
        }
        if (L.ok) { this.glLayer = L; this.glOn = true; canvas.classList.add('at-over'); } else L.cv.remove();
      } catch (e) { console.warn('WebGL non attivato:', e.message); }
    }
    this.onPick = onPick; this.onHover = onHover;
    this.cam = camera(); this.scene = { items: [], lines: [], sphere: null, compress: null };
    this.clusters = []; this.plines = []; this.dirty = true; this.anim = null; this.queue = null; this.hover = null;
    this.animOn = true; this.fps = 30; this.pickRadius = 12; this.renderScale = 1; this.t0 = performance.now(); this.time = 0;
    this.lastInput = performance.now(); this.lastFrame = 0; this.vel = null; this.spheres = []; this.glScene = null; this.linesKey = 0;
    this.ok = !!this.ctx;
    if (!this.ok) return;
    canvas.tabIndex = 0;
    this.#bind();
    const loop = () => { this.#step(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setScene(scene) { this.scene = { items: [], lines: [], sphere: null, compress: null, ...scene }; this.dirty = true; }
  /** Grafica WebGL accesa/spenta (se disponibile). */
  setGL(on) { if (!this.glLayer) return false; this.glOn = !!on; this.glLayer.cv.style.display = this.glOn ? '' : 'none'; this.cv.classList.toggle('at-over', this.glOn); this.dirty = true; return this.glOn; }
  /** Animazioni (frecce che scorrono, stella) accese/spente. */
  setAnim(on) { this.animOn = !!on; this.dirty = true; }
  /** Risoluzione dello strato WebGL rispetto allo schermo (telefono: < 1 per risparmiare batteria). */
  setRenderScale(k) { this.renderScale = Math.max(0.5, Math.min(1, k)); this.dirty = true; }
  setOrtho(on) { this.cam.ortho = on; if (on) this.cam.pitch = 89.9 * DEG; else if (this.cam.pitch > 80 * DEG) this.cam.pitch = 35 * DEG; this.dirty = true; }
  get glKind() { return !this.glLayer ? 'nessuna' : this.gl3 ? 'WebGL2' : 'WebGL1'; }

  /** Inquadra un insieme di posizioni reali (con animazione). */
  frame(points, center = null) {
    const vis = this.scene.compress ? points.map(this.scene.compress) : points;
    const c = center ? (this.scene.compress ? this.scene.compress(center) : center) : centroid(vis);
    const d = frameDistance(c, vis.length ? vis : [c], this.cam.fov);
    this.flyTo(c, d);
  }
  /** Vola verso target (posizione visiva) alla distanza dist. after: dopo il volo in corso. */
  flyTo(target, dist, { after = false } = {}) {
    if (after && this.anim) { this.queue = { target, dist }; return; }
    const from = { ...this.cam.target, d: this.cam.dist }, to = { ...target, d: dist };
    this.anim = { t0: performance.now(), dur: flyDuration(from, to), path: flyPath(from, to) };
    this.vel = null; this.dirty = true; this.lastInput = performance.now();
  }
  /** Posizione visiva di un punto reale (scala compressa inclusa). */
  vis(p) { return this.scene.compress ? this.scene.compress(p) : p; }

  #visible() { return !(globalThis.document?.hidden) && this.cv.clientWidth > 0 && this.cv.clientHeight > 0; }

  #step() {
    const now = performance.now();
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.t0) / this.anim.dur);
      const s = this.anim.path(k);
      this.cam.target = s.target; this.cam.dist = s.dist;
      if (k >= 1) { this.anim = null; if (this.queue) { const q = this.queue; this.queue = null; this.flyTo(q.target, q.dist); } }
      this.dirty = true;
    }
    if (this.vel) { // inerzia dopo il trascinamento
      this.cam.yaw -= this.vel.x; this.cam.pitch = clampPitch(this.cam.pitch + this.vel.y);
      this.vel.x *= 0.9; this.vel.y *= 0.9;
      if (Math.abs(this.vel.x) + Math.abs(this.vel.y) < 2e-4) this.vel = null;
      this.dirty = true;
    }
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    const dpr = globalThis.devicePixelRatio || 1;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); this.dirty = true; }
    const gl3 = this.glOn && this.gl3;
    const d = frameDecision({ dirty: this.dirty, animOn: this.animOn && gl3, visible: this.#visible(), now, lastInput: this.lastInput, lastFrame: this.lastFrame, fps: this.fps });
    if (!d.draw) return;
    if (d.animating) this.time = (now - this.t0) / 1000;
    this.lastFrame = now;
    if (this.dirty) { this.dirty = false; this.#draw(W, H, dpr); }
    else if (gl3 && this.glScene) this.glLayer.render(this.glScene.P, this.glScene.scene, W, H, dpr * this.renderScale, this.time);
  }

  #draw(W, H, dpr) {
    const g = this.ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = projector(this.cam, W, H);
    const V = (p) => P.project(this.vis(p));
    const sc = this.scene;
    const gl3 = this.glOn && this.gl3;
    // sfere che coprono (solo con raggio noto e scala reale)
    this.spheres = sc.compress ? [] : sc.items.filter((it) => it.pos && it.radius && (it.kind === 'planet' || it.kind === 'moon')).map((it) => ({ center: it.pos, radius: it.radius, id: it.id }));
    const hidden = (p) => !this.cam.ortho && this.spheres.length && occluded(P.eye, p, this.spheres);
    if (this.glOn) { g.clearRect(0, 0, W, H); this.#gl(P, W, H, dpr); } else { g.fillStyle = '#05090f'; g.fillRect(0, 0, W, H); }
    // globo del corpo (solo se il raggio e' noto)
    if (sc.sphere) this.#sphere(g, P, sc.sphere);
    // collegamenti (con WebGL2 li disegna la GPU: qui restano etichette e selezione)
    this.plines = [];
    for (const l of sc.lines) {
      const a = V(l.a), b = V(l.b);
      if (!a.visible || !b.visible) continue;
      const s = LINE_STYLE[l.style] ?? LINE_STYLE.possibile;
      const col = l.color ?? s.c;
      if (!gl3) {
        g.strokeStyle = col; g.lineWidth = l.width ?? s.w; g.setLineDash(s.dash); g.globalAlpha = l.alpha ?? 0.9;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        g.setLineDash([]);
        if (l.arrow) arrow(g, a, b, col);
      }
      if (l.label) {
        const mid = { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2, z: (l.a.z + l.b.z) / 2 };
        if (!hidden(mid)) { g.globalAlpha = 1; g.fillStyle = col; g.font = '11px Consolas, monospace'; g.fillText(l.label, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4); }
      }
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
      // nascosto dietro un pianeta o una luna (vale anche per le stazioni dietro al globo)
      if (!back && this.glOn && it.kind !== 'star' && hidden(it.pos)) back = true;
      const body = it.kind === 'star' || it.kind === 'planet' || it.kind === 'moon' ? 200 : 0; // i corpi celesti guidano sempre il gruppo
      // con la grafica 3D un corpo abbastanza grande e' gia' visibile: il marker diventa discreto
      let big = false;
      if (this.glOn && !sc.compress && it.radius && (it.kind === 'planet' || it.kind === 'moon')) {
        const e = P.project({ x: it.pos.x + P.u.x * it.radius, y: it.pos.y + P.u.y * it.radius, z: it.pos.z + P.u.z * it.radius });
        big = e.visible && Math.hypot(e.x - q.x, e.y - q.y) > 12;
      }
      pts.push({ big, id: it.id, x: q.x, y: q.y, depth: q.depth, priority: (it.priority ?? st.p) + body + (it.selected ? 1000 : 0) + (it.badge ? 20 : 0) - (back ? 40 : 0), it, st, back });
    }
    this.clusters = cluster(pts, sc.clusterRadius ?? 14);
    const draws = [...this.clusters].sort((a, b) => b.lead.depth - a.lead.depth);
    for (const c of draws) {
      const p = c.lead, st = p.st, it = p.it;
      g.globalAlpha = p.back ? 0.3 : 1;
      if (p.big) {
        g.strokeStyle = it.selected ? '#ffffff' : 'rgba(207,232,255,0.75)'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.stroke();
        if (c.members.length > 1) { g.fillStyle = 'rgba(207,232,255,0.85)'; g.font = 'bold 10px Consolas, monospace'; g.fillText(`+${c.members.length - 1}`, p.x + 6, p.y + 14); }
      } else if (c.members.length > 1) {
        const r = Math.min(16, 7 + Math.log2(c.members.length) * 2);
        g.fillStyle = this.glOn ? 'rgba(20,48,74,0.55)' : 'rgba(20,48,74,0.85)'; g.strokeStyle = st.c; g.lineWidth = 1.2;
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
      if (it.night && !p.back && !p.big) { g.fillStyle = '#9fb8ff'; g.font = '9px Consolas, monospace'; g.fillText('☾', p.x - 4, p.y + 15); }
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
    if (sc.clock) { g.textAlign = 'right'; g.fillStyle = '#ffd36b'; g.fillText(sc.clock, W - 10, 16); g.textAlign = 'left'; }
    if (this.cam.ortho) g.fillText('VISTA 2D (piano XY dall\'alto)', 10, 16);
  }

  #sphere(g, P, s) {
    const c = P.project(s.center); if (!c.visible) return;
    const edge = P.project({ x: s.center.x + P.u.x * s.radius, y: s.center.y + P.u.y * s.radius, z: s.center.z + P.u.z * s.radius });
    const r = Math.hypot(edge.x - c.x, edge.y - c.y);
    if (!this.glOn) {
      g.fillStyle = 'rgba(30,60,90,0.35)'; g.strokeStyle = '#2a4766'; g.lineWidth = 1;
      g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // reticolo lat/lon (solo emisfero visibile); ruota con il corpo se la rotazione e' attiva
    g.strokeStyle = this.glOn ? 'rgba(160,230,255,0.13)' : 'rgba(63,208,255,0.18)';
    const spin = s.spin ?? 0;
    const pt = (lat, lon) => ({ x: s.center.x + s.radius * Math.cos(lat) * Math.cos(lon + spin), y: s.center.y + s.radius * Math.cos(lat) * Math.sin(lon + spin), z: s.center.z + s.radius * Math.sin(lat) });
    const front = (p) => dot3(sub(p, s.center), sub(P.eye, p)) >= 0;
    const poly = (list) => { let open = false; g.beginPath(); for (const p of list) { const q = P.project(p); if (!front(p) || !q.visible) { open = false; continue; } if (!open) { g.moveTo(q.x, q.y); open = true; } else g.lineTo(q.x, q.y); } g.stroke(); };
    for (let la = -60; la <= 60; la += 30) poly(Array.from({ length: 73 }, (_, i) => pt(la * DEG, i * 5 * DEG)));
    for (let lo = 0; lo < 360; lo += 30) poly(Array.from({ length: 37 }, (_, i) => pt((-90 + i * 5) * DEG, lo * DEG)));
  }

  // scena dello strato WebGL: corpi con raggio reale, stella, orbite, rotte (posizioni visive)
  #gl(P, W, H, dpr) {
    const sc = this.scene; const comp = !!sc.compress;
    const bodies = []; const orbits = [];
    const starReal = sc.star?.pos ?? null;
    for (const it of sc.items) {
      if (!it.pos || (it.kind !== 'planet' && it.kind !== 'moon')) continue;
      bodies.push({ pos: this.vis(it.pos), radius: comp ? null : it.radius ?? null, kind: it.kind, name: it.label, system: it.system, selected: it.selected, look: it.look, spin: it.spin ?? 0 });
      const center = it.kind === 'planet' ? starReal : it.parentPos;
      if (center) {
        const pts = orbitPoints(center, it.pos, this.gl3 ? 240 : 160).map((p) => this.vis(p));
        orbits.push({ points: pts, color: it.kind === 'planet' ? [0.25, 0.75, 1.0] : [0.5, 0.7, 0.85], alpha: it.selected ? 0.55 : it.kind === 'planet' ? 0.32 : 0.16 });
      }
    }
    const starVisible = sc.star && !comp ? !occluded(P.eye, sc.star.pos, this.spheres) : !!sc.star;
    const star = sc.star ? { pos: this.vis(sc.star.pos), radius: comp ? null : sc.star.radius ?? null, color: sc.star.color ?? null, visible: starVisible } : null;
    if (!this.gl3) { this.glLayer.render(P, { bodies, star, orbits }, W, H, dpr); return; }
    const lines = [];
    for (const l of sc.lines) {
      const s = LINE_STYLE[l.style] ?? LINE_STYLE.possibile;
      lines.push({ a: this.vis(l.a), b: this.vis(l.b), color: hexRgb(l.color ?? s.c), alpha: l.alpha ?? 0.95, width: l.width ?? s.w, dash: s.dash.length ? s.dash : [0, 0], arrow: !!l.arrow, glow: true });
    }
    const scene = { bodies, star, orbits, lines, ortho: this.cam.ortho, dist: this.cam.dist, linesKey: ++this.linesKey };
    this.glScene = { P, scene };
    this.glLayer.render(P, scene, W, H, dpr * this.renderScale, this.time);
  }

  /** Primo contatto con un corpo celeste sotto il punto dello schermo: {s, t, point} o null. */
  #hitSphere(px, py) {
    if (!this.spheres.length || this.cam.ortho) return null;
    const P = projector(this.cam, this.cv.clientWidth, this.cv.clientHeight);
    const x = (px - P.w / 2) / P.F, y = -(py - P.h / 2) / P.F;
    const d = { x: P.f.x + P.r.x * x + P.u.x * y, y: P.f.y + P.r.y * x + P.u.y * y, z: P.f.z + P.r.z * x + P.u.z * y };
    const L = Math.hypot(d.x, d.y, d.z); d.x /= L; d.y /= L; d.z /= L;
    let best = null, bt = Infinity;
    for (const s of this.spheres) { const t = raySphere(P.eye, d, s.center, s.radius); if (t != null && t < bt) { bt = t; best = s; } }
    if (!best) return null;
    // le sfere sono in posizione visiva: il punto e' gia' nello spazio della camera
    return { s: best, t: bt, point: { x: P.eye.x + d.x * bt, y: P.eye.y + d.y * bt, z: P.eye.z + d.z * bt } };
  }
  /** Corpo celeste sotto il punto dello schermo (clic sul disco del pianeta, non solo sul marker). */
  #pickSphere(px, py) { const h = this.#hitSphere(px, py); return h ? { kind: 'place', id: h.s.id } : null; }

  #touch() { this.lastInput = performance.now(); this.anim = null; this.queue = null; this.dirty = true; }

  #bind() {
    const cv = this.cv; let drag = null; const pts = new Map(); let gesture = null;
    const rel = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pan = (dx, dy) => {
      const P = projector(this.cam, cv.clientWidth, cv.clientHeight), k = P.metersPerPixel(), t = this.cam.target;
      this.cam.target = { x: t.x - (P.r.x * dx - P.u.x * dy) * k, y: t.y - (P.r.y * dx - P.u.y * dy) * k, z: t.z - (P.r.z * dx - P.u.z * dy) * k };
    };
    const zoom = (sx, sy, k) => {
      const P = projector(this.cam, cv.clientWidth, cv.clientHeight);
      // sopra un pianeta: ci si avvicina al punto della superficie sotto il cursore (non si entra mai)
      const hit = this.#hitSphere(sx, sy); const t = this.cam.target;
      const z = hit ? { target: { x: hit.point.x + (t.x - hit.point.x) * k, y: hit.point.y + (t.y - hit.point.y) * k, z: hit.point.z + (t.z - hit.point.z) * k }, dist: this.cam.dist * k } : zoomAt(this.cam, P, sx, sy, k);
      const dist = Math.max(500, Math.min(2e12, z.dist));
      if (dist !== z.dist) return; // al limite: niente scivolamento laterale
      this.cam.target = z.target; this.cam.dist = dist;
    };
    const pickAt = (p) => pick(p.x, p.y, this.clusters, this.plines, this.pickRadius) ?? this.#pickSphere(p.x, p.y);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId); cv.focus({ preventScroll: true });
      pts.set(e.pointerId, rel(e)); this.vel = null; this.#touch();
      if (pts.size === 2) { const [a, b] = [...pts.values()]; gesture = { a, b }; drag = null; return; }
      drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button === 2 || e.shiftKey || this.cam.ortho && e.button !== 0, vx: 0, vy: 0 };
    });
    cv.addEventListener('pointermove', (e) => {
      const p = rel(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (gesture && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const g = pinch(gesture.a, gesture.b, a, b);
        zoom(g.mid.x, g.mid.y, g.scale); pan(g.dx, g.dy);
        this.cam.yaw -= g.rot;
        gesture = { a, b }; this.#touch(); return;
      }
      if (!drag) {
        if (e.pointerType === 'touch') return;
        const h = pickAt(p);
        const id = h ? `${h.kind}:${h.id}` : null;
        if (id !== this.hover) { this.hover = id; cv.style.cursor = h ? 'pointer' : 'grab'; this.onHover(h); }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > (e.pointerType === 'touch' ? 6 : 3)) drag.moved = true;
      if (!drag.moved) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan || this.cam.ortho) pan(dx, dy);
      else {
        this.cam.yaw -= dx * 0.008; this.cam.pitch = clampPitch(this.cam.pitch + dy * 0.008);
        drag.vx = dx * 0.008; drag.vy = dy * 0.008;
      }
      this.#touch();
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (gesture) { if (pts.size < 2) gesture = null; drag = null; return; }
      const d = drag; drag = null;
      if (d && d.moved && !d.pan && !this.cam.ortho && Math.abs(d.vx) + Math.abs(d.vy) > 0.004) this.vel = { x: d.vx, y: d.vy };
      if (d && !d.moved && e.type === 'pointerup') {
        const h = pickAt(rel(e));
        if (h?.kind === 'cluster') { const ms = h.cluster.members.map((m) => m.it.pos); this.frame(ms); }
        this.onPick(h);
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    // doppio clic / doppio tocco: vola sul luogo (il corpo celeste riempie la vista, una base a 150 km)
    cv.addEventListener('dblclick', (e) => {
      const h = pickAt(rel(e)); if (!h || h.kind === 'line') return;
      const it = h.kind === 'cluster' ? h.cluster.lead.it : this.scene.items.find((x) => x.id === h.id);
      if (!it?.pos) return;
      const dist = it.radius && !this.scene.compress ? it.radius * 3.2 : Math.max(this.cam.dist * 0.25, it.kind === 'station' ? 2e5 : 1.5e5);
      this.flyTo(this.vis(it.pos), Math.min(this.cam.dist, dist));
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = rel(e);
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100) * 0.18);
      zoom(p.x, p.y, k); this.vel = null; this.#touch();
    }, { passive: false });
    // tastiera (mappa con il fuoco): frecce ruotano, WASD spostano, +/- zoom, Q/E ruotano
    cv.addEventListener('keydown', (e) => {
      const W = cv.clientWidth, H = cv.clientHeight, step = Math.min(W, H) * 0.08;
      const k = e.key.toLowerCase(); let used = true;
      if (k === 'arrowleft' || k === 'q') this.cam.yaw += KEY_ROT;
      else if (k === 'arrowright' || k === 'e') this.cam.yaw -= KEY_ROT;
      else if (k === 'arrowup') this.cam.pitch = clampPitch(this.cam.pitch + KEY_ROT);
      else if (k === 'arrowdown') this.cam.pitch = clampPitch(this.cam.pitch - KEY_ROT);
      else if (k === 'w') pan(0, step); else if (k === 's') pan(0, -step);
      else if (k === 'a') pan(step, 0); else if (k === 'd') pan(-step, 0);
      else if (k === '+' || k === '=') zoom(W / 2, H / 2, Math.exp(-KEY_ZOOM));
      else if (k === '-' || k === '_') zoom(W / 2, H / 2, Math.exp(KEY_ZOOM));
      else used = false;
      if (used) { e.preventDefault(); this.vel = null; this.#touch(); }
    });
    globalThis.addEventListener?.('resize', () => { this.dirty = true; });
    globalThis.document?.addEventListener?.('visibilitychange', () => { this.dirty = true; });
  }
}

const clampPitch = (p) => Math.max(-89 * DEG, Math.min(89.9 * DEG, p));
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
