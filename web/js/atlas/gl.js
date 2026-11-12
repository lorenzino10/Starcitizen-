// Strato grafico WebGL dell'ATLANTE (nessuna libreria): cielo stellato, stella con corona, pianeti e
// lune come sfere illuminate dalla stella, orbite. Disegna SOTTO il canvas 2D, che resta l'unico
// responsabile di marker, etichette, linee delle missioni e selezione con il mouse.
// Le superfici sono procedurali e ILLUSTRATIVE: non sono texture del gioco ne' dati verificati.
// Precisione: tutte le posizioni sono calcolate in JS (doppia precisione) e passate alla GPU gia'
// proiettate in pixel, quindi le distanze di sistema (1e10 m) non perdono precisione in float32.

const VS_QUAD = `
attribute vec2 aCorner;
uniform vec2 uRes; uniform vec2 uCenter; uniform float uSize;
varying vec2 vP;
void main() {
  vP = aCorner;
  vec2 px = uCenter + vec2(aCorner.x, -aCorner.y) * uSize;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const NOISE = `
float h3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;

// tipo: 0 roccioso, 1 gassoso, 2 ghiacciato, 3 urbano, 4 vulcanico
const FS_BODY = `precision highp float;
varying vec2 vP;
uniform vec3 uL; uniform mat3 uBasis; uniform vec3 uSeed; uniform int uType;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uAtm; uniform float uAtmK; uniform float uSel;
${NOISE}
void main() {
  float d2 = dot(vP, vP);
  float edge = 1.0 / 1.12;
  vec2 p = vP / edge; float r2 = dot(p, p);
  if (r2 > 1.0) {
    // alone dell'atmosfera (solo verso la stella)
    float t = (sqrt(r2) - 1.0) / 0.12; if (t > 1.0) discard;
    vec3 n = normalize(vec3(p, 0.0));
    float lit = clamp(dot(n, uL) * 0.8 + 0.45, 0.15, 1.0);
    float a = (1.0 - t) * (1.0 - t) * uAtmK * lit;
    gl_FragColor = vec4(uAtm * a, a); return;
  }
  vec3 nv = vec3(p, sqrt(1.0 - r2));
  vec3 n = normalize(uBasis * nv);
  vec3 q = n * 2.2 + uSeed;
  vec3 col;
  if (uType == 1) {
    float lat = n.z + 0.12 * fbm(q * 3.0);
    float b = sin(lat * 18.0 + uSeed.x) * 0.5 + 0.5;
    float b2 = sin(lat * 41.0 + uSeed.y) * 0.5 + 0.5;
    col = mix(mix(uA, uB, b), uC, b2 * 0.35 + 0.1 * fbm(q * 6.0));
  } else {
    float h = fbm(q * 1.6);
    float m = fbm(q * 5.0 + 3.0);
    col = mix(uA, uB, smoothstep(0.35, 0.65, h));
    col = mix(col, uC, smoothstep(0.55, 0.8, m) * 0.6);
    if (uType == 2) col = mix(col, vec3(0.93, 0.97, 1.0), smoothstep(0.55, 0.85, abs(n.z) + 0.2 * h));
    if (uType == 4) col += vec3(1.0, 0.35, 0.05) * smoothstep(0.72, 0.8, m) * 0.6;
  }
  float diff = dot(nv, uL);
  float light = smoothstep(-0.08, 0.35, diff) * (0.25 + 0.75 * clamp(diff, 0.0, 1.0)) + 0.11;
  vec3 c = col * light;
  if (uType == 3) {
    // luci della citta' sul lato notturno
    float city = smoothstep(0.62, 0.7, fbm(q * 9.0)) * (1.0 - smoothstep(-0.15, 0.05, diff));
    c += vec3(1.0, 0.72, 0.35) * city * 0.9;
  }
  float rim = pow(1.0 - nv.z, 3.0) * uAtmK;
  c += uAtm * rim * (0.25 + 0.75 * clamp(diff + 0.3, 0.0, 1.0));
  if (uSel > 0.5) c += vec3(0.25, 0.8, 1.0) * pow(1.0 - nv.z, 6.0) * 0.6;
  gl_FragColor = vec4(c, 1.0);
}`;

const FS_STAR = `precision highp float;
varying vec2 vP;
uniform vec3 uA; uniform vec3 uSeed; uniform float uCore; uniform float uT;
${NOISE}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float core = uCore;
  vec3 c;
  float a;
  if (r < core) {
    float x = r / core; float mu = sqrt(1.0 - x * x);
    float gran = fbm(vec3(vP / core * 7.0, uT) + uSeed);
    c = mix(uA, vec3(1.0, 0.98, 0.9), 0.55) * (0.6 + 0.4 * mu) * (0.85 + 0.3 * gran);
    a = 1.0;
  } else {
    float t = (r - core) / (1.0 - core);
    float ang = atan(vP.y, vP.x);
    float rays = 0.75 + 0.25 * fbm(vec3(ang * 3.0, t * 2.0, 0.0) + uSeed);
    a = pow(1.0 - t, 3.2) * rays;
    c = uA * a * 1.4;
  }
  gl_FragColor = vec4(c, a);
}`;

const FS_GLOW = `precision mediump float;
varying vec2 vP; uniform vec3 uA; uniform float uK;
void main() { float r = length(vP); if (r > 1.0) discard; float a = pow(1.0 - r, 2.2) * uK; gl_FragColor = vec4(uA * a, a); }`;

const VS_STARS = `
attribute vec3 aDir; attribute float aMag;
uniform vec3 uR; uniform vec3 uU; uniform vec3 uF; uniform float uFocal; uniform vec2 uRes;
varying float vM;
void main() {
  float X = dot(aDir, uR), Y = dot(aDir, uU), Z = dot(aDir, uF);
  vM = aMag;
  if (Z <= 0.01) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 s = vec2(X / Z, Y / Z) * uFocal / (uRes * 0.5);
  gl_Position = vec4(s, 0.0, 1.0);
  gl_PointSize = 1.0 + aMag * 1.6;
}`;
const FS_STARS = `precision mediump float; varying float vM;
void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * (0.25 + 0.75 * vM);
  gl_FragColor = vec4(mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.9, 0.8), fract(vM * 7.0)) * a, a); }`;

const VS_LINE = `
attribute vec2 aPx; attribute float aA; uniform vec2 uRes; varying float vA;
void main() { vA = aA; gl_Position = vec4(aPx.x / uRes.x * 2.0 - 1.0, 1.0 - aPx.y / uRes.y * 2.0, 0.0, 1.0); }`;
const FS_LINE = `precision mediump float; varying float vA; uniform vec3 uA;
void main() { gl_FragColor = vec4(uA * vA, vA); }`;

// aspetto per nome (illustrativo); il resto per tipo con variazioni dal nome
const LOOK = {
  hurston: { t: 0, a: [0.42, 0.33, 0.24], b: [0.62, 0.5, 0.36], c: [0.3, 0.26, 0.22], atm: [0.9, 0.75, 0.5], k: 0.45 },
  crusader: { t: 1, a: [0.85, 0.72, 0.68], b: [0.55, 0.62, 0.78], c: [0.95, 0.9, 0.85], atm: [0.7, 0.8, 1.0], k: 0.6 },
  arccorp: { t: 3, a: [0.55, 0.42, 0.33], b: [0.72, 0.56, 0.4], c: [0.35, 0.3, 0.3], atm: [1.0, 0.7, 0.45], k: 0.45 },
  microtech: { t: 2, a: [0.55, 0.65, 0.75], b: [0.85, 0.9, 0.95], c: [0.3, 0.4, 0.5], atm: [0.6, 0.85, 1.0], k: 0.55 },
  daymar: { t: 0, a: [0.6, 0.42, 0.27], b: [0.78, 0.58, 0.38], c: [0.45, 0.3, 0.2], atm: [1.0, 0.75, 0.5], k: 0.25 },
  cellin: { t: 0, a: [0.4, 0.4, 0.38], b: [0.58, 0.56, 0.5], c: [0.3, 0.3, 0.3], atm: [0.8, 0.8, 0.8], k: 0.1 },
  yela: { t: 2, a: [0.55, 0.65, 0.75], b: [0.82, 0.88, 0.95], c: [0.45, 0.55, 0.65], atm: [0.7, 0.85, 1.0], k: 0.15 },
  aberdeen: { t: 4, a: [0.55, 0.5, 0.25], b: [0.72, 0.65, 0.35], c: [0.4, 0.35, 0.2], atm: [0.95, 0.9, 0.4], k: 0.45 },
  arial: { t: 4, a: [0.5, 0.25, 0.15], b: [0.7, 0.4, 0.22], c: [0.3, 0.15, 0.1], atm: [1.0, 0.55, 0.3], k: 0.3 },
  magda: { t: 0, a: [0.42, 0.4, 0.38], b: [0.6, 0.55, 0.5], c: [0.3, 0.28, 0.27], atm: [0.8, 0.8, 0.8], k: 0.1 },
  ita: { t: 0, a: [0.32, 0.3, 0.3], b: [0.48, 0.46, 0.44], c: [0.22, 0.22, 0.22], atm: [0.7, 0.7, 0.8], k: 0.05 },
  lyria: { t: 2, a: [0.6, 0.68, 0.78], b: [0.86, 0.9, 0.96], c: [0.4, 0.5, 0.6], atm: [0.7, 0.85, 1.0], k: 0.1 },
  wala: { t: 0, a: [0.45, 0.4, 0.36], b: [0.62, 0.56, 0.5], c: [0.3, 0.28, 0.25], atm: [0.8, 0.8, 0.8], k: 0.1 },
  calliope: { t: 2, a: [0.6, 0.66, 0.75], b: [0.88, 0.92, 0.97], c: [0.45, 0.5, 0.6], atm: [0.7, 0.85, 1.0], k: 0.15 },
  clio: { t: 2, a: [0.55, 0.65, 0.72], b: [0.85, 0.92, 0.96], c: [0.4, 0.5, 0.6], atm: [0.7, 0.85, 1.0], k: 0.15 },
  euterpe: { t: 2, a: [0.62, 0.68, 0.76], b: [0.9, 0.93, 0.97], c: [0.5, 0.55, 0.65], atm: [0.7, 0.85, 1.0], k: 0.15 },
};
const PAL = {
  planet: [[0.45, 0.35, 0.28], [0.65, 0.52, 0.4], [0.3, 0.32, 0.36]],
  moon: [[0.38, 0.37, 0.36], [0.58, 0.56, 0.52], [0.26, 0.26, 0.27]],
};
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

export function lookOf(name, kind, system, radius) {
  const key = String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const L = LOOK[key];
  const hv = hash(name);
  const seed = [hv * 97.3, hash(`${name}#`) * 51.7, hash(`#${name}`) * 23.9];
  if (L) return { type: L.t, a: L.a, b: L.b, c: L.c, atm: L.atm, atmK: L.k, seed };
  const pyro = String(system).toLowerCase() === 'pyro';
  const gas = kind === 'planet' && radius && radius > 5e6;
  const base = PAL[kind] ?? PAL.moon;
  const tint = (c, k) => c.map((v, i) => Math.min(1, v * (0.85 + 0.3 * hash(`${name}${i}${k}`))));
  if (gas) return { type: 1, a: tint([0.8, 0.55, 0.4], 1), b: tint([0.6, 0.45, 0.4], 2), c: tint([0.95, 0.85, 0.7], 3), atm: [1.0, 0.75, 0.55], atmK: 0.55, seed };
  if (pyro) return { type: hv > 0.5 ? 4 : 0, a: tint([0.45, 0.22, 0.14], 1), b: tint([0.65, 0.38, 0.22], 2), c: tint([0.25, 0.14, 0.1], 3), atm: [1.0, 0.5, 0.3], atmK: kind === 'planet' ? 0.35 : 0.1, seed };
  const ice = hv > 0.72;
  return { type: ice ? 2 : 0, a: tint(base[0], 1), b: tint(base[1], 2), c: tint(base[2], 3), atm: ice ? [0.7, 0.85, 1.0] : [0.85, 0.8, 0.75], atmK: kind === 'planet' ? 0.4 : 0.12, seed };
}

export class GLLayer {
  constructor(canvas) {
    this.cv = canvas;
    const opt = { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opt) || canvas.getContext('experimental-webgl', opt);
    this.gl = gl; this.ok = false;
    if (!gl) return;
    try {
      this.pBody = this.#prog(VS_QUAD, FS_BODY); this.pStar = this.#prog(VS_QUAD, FS_STAR); this.pGlow = this.#prog(VS_QUAD, FS_GLOW);
      this.pSky = this.#prog(VS_STARS, FS_STARS); this.pLine = this.#prog(VS_LINE, FS_LINE);
    } catch (e) { console.warn('WebGL non disponibile per l\'atlante:', e.message); return; }
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // cielo: 2400 stelle fisse (direzioni deterministiche)
    const N = 2400, sky = new Float32Array(N * 4); let s = 1234567;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
    for (let i = 0; i < N; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      // addensamento lungo una "via lattea" inclinata
      const band = Math.exp(-(((r * Math.sin(t)) * 0.8 + z * 0.6) ** 2) * 18);
      sky.set([r * Math.cos(t), r * Math.sin(t), z, Math.min(1, rnd() ** 3 * 1.4 + band * rnd() * 0.5)], i * 4);
    }
    this.sky = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.sky); gl.bufferData(gl.ARRAY_BUFFER, sky, gl.STATIC_DRAW); this.skyN = N;
    this.lineBuf = gl.createBuffer();
    this.t0 = performance.now();
    this.ok = true;
  }

  #prog(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
    return { p, loc, a: (name) => gl.getAttribLocation(p, name) };
  }

  /**
   * @param P projector (view.js) in pixel CSS
   * @param scene { bodies:[{pos (visiva), radius (m reali, null se ignoto o scala compressa), kind, name, system, selected}], star: {pos, name}|null, orbits:[{center, radius, kind}] (posizioni visive gia' calcolate: [{x,y,z}...]), dpr }
   */
  render(P, scene, W, H, dpr) {
    const gl = this.gl; if (!this.ok) return;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.018, 0.035, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // cielo (solo rotazione della camera)
    gl.blendFunc(gl.ONE, gl.ONE);
    const k = this.pSky; gl.useProgram(k.p);
    gl.uniform3f(k.loc.uR, P.r.x, P.r.y, P.r.z); gl.uniform3f(k.loc.uU, P.u.x, P.u.y, P.u.z); gl.uniform3f(k.loc.uF, P.f.x, P.f.y, P.f.z);
    gl.uniform1f(k.loc.uFocal, P.F); gl.uniform2f(k.loc.uRes, W, H);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sky);
    const aD = k.a('aDir'), aM = k.a('aMag');
    gl.enableVertexAttribArray(aD); gl.vertexAttribPointer(aD, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aM); gl.vertexAttribPointer(aM, 1, gl.FLOAT, false, 16, 12);
    gl.drawArrays(gl.POINTS, 0, this.skyN);
    gl.disableVertexAttribArray(aD); gl.disableVertexAttribArray(aM);

    // orbite
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    for (const o of scene.orbits ?? []) this.#polyline(P, o.points, W, H, o.color, o.alpha ?? 0.22);

    const quad = (prog) => { gl.useProgram(prog.p); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); const a = prog.a('aCorner'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0); gl.uniform2f(prog.loc.uRes, W, H); return a; };
    const t = (performance.now() - this.t0) / 1000;
    const starPos = scene.star?.pos ?? null;

    // stella
    if (scene.star) {
      const c = P.project(scene.star.pos);
      if (c.visible) {
        const rpx = scene.star.radius ? this.#pxRadius(P, scene.star.pos, scene.star.radius) : 0;
        const core = Math.max(5, rpx);
        const size = Math.max(core * 3.2, 80);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const a = quad(this.pStar);
        gl.uniform2f(this.pStar.loc.uCenter, c.x, c.y); gl.uniform1f(this.pStar.loc.uSize, size);
        gl.uniform3f(this.pStar.loc.uA, ...(scene.star.color ?? [1.0, 0.72, 0.35])); gl.uniform3f(this.pStar.loc.uSeed, 3.1, 7.7, 1.3);
        gl.uniform1f(this.pStar.loc.uCore, core / size); gl.uniform1f(this.pStar.loc.uT, t * 0.05);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disableVertexAttribArray(a);
      }
    }

    // corpi, dal piu' lontano
    const bodies = [];
    for (const b of scene.bodies ?? []) {
      const c = P.project(b.pos); if (!c.visible) continue;
      const rpx = b.radius ? this.#pxRadius(P, b.pos, b.radius) : 0;
      if (c.x < -rpx - 60 || c.y < -rpx - 60 || c.x > W + rpx + 60 || c.y > H + rpx + 60) continue;
      bodies.push({ b, c, rpx });
    }
    bodies.sort((p, q) => q.c.depth - p.c.depth);
    for (const { b, c, rpx } of bodies) {
      const look = b.look ?? (b.look = lookOf(b.name, b.kind, b.system, b.radius));
      const col = mixc(look.a, look.b, 0.5);
      if (rpx < 3.5) {
        // troppo piccolo per una sfera: bagliore del colore del corpo
        gl.blendFunc(gl.ONE, gl.ONE);
        const a = quad(this.pGlow);
        gl.uniform2f(this.pGlow.loc.uCenter, c.x, c.y); gl.uniform1f(this.pGlow.loc.uSize, b.kind === 'planet' ? 28 : 14);
        gl.uniform3f(this.pGlow.loc.uA, ...col); gl.uniform1f(this.pGlow.loc.uK, b.kind === 'planet' ? 0.55 : 0.35);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disableVertexAttribArray(a);
        continue;
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const pr = this.pBody; const a = quad(pr);
      gl.uniform2f(pr.loc.uCenter, c.x, c.y); gl.uniform1f(pr.loc.uSize, rpx * 1.12);
      let L = starPos ? norm(sub(starPos, b.pos)) : norm({ x: -P.f.x + P.r.x, y: -P.f.y + P.r.y, z: -P.f.z + P.r.z });
      gl.uniform3f(pr.loc.uL, dot(L, P.r), dot(L, P.u), -dot(L, P.f));
      gl.uniformMatrix3fv(pr.loc.uBasis, false, new Float32Array([P.r.x, P.r.y, P.r.z, P.u.x, P.u.y, P.u.z, -P.f.x, -P.f.y, -P.f.z]));
      gl.uniform3f(pr.loc.uSeed, ...look.seed); gl.uniform1i(pr.loc.uType, look.type);
      gl.uniform3f(pr.loc.uA, ...look.a); gl.uniform3f(pr.loc.uB, ...look.b); gl.uniform3f(pr.loc.uC, ...look.c);
      gl.uniform3f(pr.loc.uAtm, ...look.atm); gl.uniform1f(pr.loc.uAtmK, look.atmK); gl.uniform1f(pr.loc.uSel, b.selected ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disableVertexAttribArray(a);
    }
  }

  #pxRadius(P, pos, radius) {
    const c = P.project(pos);
    const e = P.project({ x: pos.x + P.u.x * radius, y: pos.y + P.u.y * radius, z: pos.z + P.u.z * radius });
    return c.visible && e.visible ? Math.hypot(e.x - c.x, e.y - c.y) : 0;
  }

  #polyline(P, pts, W, H, color, alpha) {
    const gl = this.gl; const data = []; let prev = null;
    for (const p of pts) {
      const q = P.project(p);
      const cur = q.visible && Math.abs(q.x) < 1e6 && Math.abs(q.y) < 1e6 ? q : null;
      if (prev && cur) data.push(prev.x, prev.y, alpha, cur.x, cur.y, alpha);
      prev = cur;
    }
    if (!data.length) return;
    const pr = this.pLine; gl.useProgram(pr.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
    const a1 = pr.a('aPx'), a2 = pr.a('aA');
    gl.enableVertexAttribArray(a1); gl.vertexAttribPointer(a1, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(a2); gl.vertexAttribPointer(a2, 1, gl.FLOAT, false, 12, 8);
    gl.uniform2f(pr.loc.uRes, W, H); gl.uniform3f(pr.loc.uA, ...color);
    gl.drawArrays(gl.LINES, 0, data.length / 3);
    gl.disableVertexAttribArray(a1); gl.disableVertexAttribArray(a2);
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Punti di un'orbita circolare attorno a center, nel piano XY del sistema (quota del corpo). Pura. */
export function orbitPoints(center, pos, n = 160) {
  const dx = pos.x - center.x, dy = pos.y - center.y, r = Math.hypot(dx, dy);
  if (!(r > 0)) return [];
  const z = pos.z; const a0 = Math.atan2(dy, dx);
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (i / n) * Math.PI * 2; return { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a), z: center.z + (z - center.z) }; });
}
