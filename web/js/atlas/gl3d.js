// ATLANTE 3D v2: renderer WebGL2 proprio (nessuna libreria, nessun CDN).
// Differenze rispetto a gl.js (0.9.0, resta come riserva WebGL1):
//  - buffer di profondita' LOGARITMICO: pianeti e lune coprono davvero orbite, rotte e bagliori dietro
//    di loro, dalla scala del sistema (1e10 m) fino a pochi metri dalla superficie;
//  - sfere calcolate per pixel (ray casting): silhouette e profondita' esatte anche da vicino;
//  - rotte e orbite disegnate dalla GPU come nastri spessi con alone, tratteggio e frecce in movimento;
//  - ombre delle eclissi (un corpo fra la stella e un altro) calcolate dalle posizioni reali;
//  - atmosfera con diffusione approssimata, stella con granulazione, corona e riflesso sull'ottica;
//  - rotazione del corpo ("ADESSO"): la superficie illustrativa gira con il corpo.
// Precisione: tutto e' passato alla GPU in coordinate di VISTA (relative alla camera) calcolate in JS
// in doppia precisione: niente coordinate di sistema da 1e10 m in float32.
// Le superfici restano procedurali e ILLUSTRATIVE (non texture del gioco).
import { toView, clipNear } from './scene3d.js';
import { lookOf } from './gl.js';

const COMMON = `
uniform vec2 uRes; uniform float uDpr; uniform float uF; uniform float uK; uniform float uOrtho; uniform float uLogFar; uniform float uOrthoRange;
float depthOf(float z) {
  if (uOrtho > 0.5) return clamp(0.5 + z / uOrthoRange, 0.0, 1.0);
  return clamp(log2(max(z, 1e-3) + 1.0) / uLogFar, 0.0, 1.0);
}
vec4 pxToClip(vec2 px) { return vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0); }
vec2 viewToPx(vec3 v) {
  if (uOrtho > 0.5) return vec2(uRes.x * 0.5 + v.x * uK, uRes.y * 0.5 - v.y * uK);
  return vec2(uRes.x * 0.5 + v.x / v.z * uF, uRes.y * 0.5 - v.y / v.z * uF);
}
`;

const RAY = `
// raggio di vista per il pixel corrente (coordinate CSS, Y in su)
void viewRay(out vec3 ro, out vec3 rd) {
  vec2 s = gl_FragCoord.xy / uDpr - uRes * 0.5;
  if (uOrtho > 0.5) { ro = vec3(s / uK, 0.0); rd = vec3(0.0, 0.0, 1.0); }
  else { ro = vec3(0.0); rd = normalize(vec3(s / uF, 1.0)); }
}`;

const NOISE = `
float h3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) { float a = 0.5, s = 0.0; for (int i = 0; i < 9; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;

const VS_QUAD = `#version 300 es
in vec2 aCorner; uniform vec2 uCenter; uniform float uHalf;
${COMMON}
out vec2 vP;
void main() { vP = aCorner; gl_Position = pxToClip(uCenter + vec2(aCorner.x, -aCorner.y) * uHalf); }`;

// tipo: 0 roccioso, 1 gassoso, 2 ghiacciato, 3 urbano, 4 vulcanico
const FS_BODY = `#version 300 es
precision highp float;
${COMMON}
${RAY}
${NOISE}
in vec2 vP; out vec4 o;
uniform vec3 uC; uniform float uR; uniform float uAtmH; uniform vec3 uS; uniform float uHasStar; uniform mat3 uBasis; uniform float uSpin;
uniform vec3 uSeed; uniform int uType; uniform vec3 uA; uniform vec3 uB; uniform vec3 uCc; uniform vec3 uAtm; uniform float uAtmK; uniform float uSel;
uniform vec4 uOcc[16]; uniform int uOccN; uniform int uSelf; uniform float uStarR; uniform int uOct;

// frazione di luce della stella che arriva al punto p (vista), con le eclissi dei corpi in uOcc
float sunlight(vec3 p) {
  if (uHasStar < 0.5) return 1.0;
  vec3 ts = uS - p; float ds = length(ts); vec3 us = ts / ds;
  float aS = uStarR / ds; float lit = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uOccN) break; if (i == uSelf) continue;
    vec3 to = uOcc[i].xyz - p; float d = length(to); if (d > ds) continue;
    vec3 uo = to / d; if (dot(uo, us) <= 0.0) continue;
    float aO = asin(min(1.0, uOcc[i].w / d));
    float sep = atan(length(cross(us, uo)), dot(us, uo));
    float cover = 1.0 - smoothstep(abs(aO - aS), aO + aS, sep);
    lit *= 1.0 - cover * min(1.0, (aO * aO) / max(aS * aS, 1e-12));
  }
  return lit;
}

void main() {
  vec3 ro, rd; viewRay(ro, rd);
  vec3 oc = ro - uC; float b = dot(oc, rd);
  vec3 q = oc - b * rd; float ql = length(q);              // distanza del raggio dal centro (stabile)
  float Ra = uR * (1.0 + uAtmH);
  if (ql > Ra) discard;
  float sA = sqrt(max(0.0, (Ra - ql) * (Ra + ql)));
  bool hit = ql < uR;
  float s = hit ? sqrt(max(0.0, (uR - ql) * (uR + ql))) : 0.0;
  vec3 L = uHasStar > 0.5 ? normalize(uS - uC) : normalize(vec3(-0.4, 0.5, -0.75));
  vec3 col = vec3(0.0); float alpha = 0.0; float depth = 1.0;
  if (hit) {
    float t = -b - s;
    if (t < 0.0 && uOrtho < 0.5) discard;                  // camera sotto la superficie
    vec3 rel = q - s * rd;                                  // punto colpito rispetto al centro
    vec3 nv = rel / uR;
    vec3 n = uBasis * nv;                                   // normale nel frame del sistema
    float cs = cos(-uSpin), sn = sin(-uSpin);
    vec3 nb = vec3(n.x * cs - n.y * sn, n.x * sn + n.y * cs, n.z); // frame del corpo (ruota con lui)
    vec3 qq = nb * 2.2 + uSeed;
    vec3 c;
    if (uType == 1) {
      float lat = nb.z + 0.12 * fbm(qq * 3.0, 5);
      float b1 = sin(lat * 18.0 + uSeed.x) * 0.5 + 0.5, b2 = sin(lat * 41.0 + uSeed.y) * 0.5 + 0.5;
      c = mix(mix(uA, uB, b1), uCc, b2 * 0.35 + 0.1 * fbm(qq * 6.0, 4));
    } else {
      float h = fbm(qq * 1.6, uOct), m = fbm(qq * 5.0 + 3.0, uOct);
      c = mix(uA, uB, smoothstep(0.35, 0.65, h));
      c = mix(c, uCc, smoothstep(0.55, 0.8, m) * 0.6);
      if (uType == 2) c = mix(c, vec3(0.93, 0.97, 1.0), smoothstep(0.55, 0.85, abs(nb.z) + 0.2 * h));
      if (uType == 4) c += vec3(1.0, 0.35, 0.05) * smoothstep(0.72, 0.8, m) * 0.6;
    }
    vec3 pv = uC + rel;
    float diff = dot(nv, L);
    float sun = sunlight(pv);
    float light = (smoothstep(-0.06, 0.3, diff) * (0.22 + 0.78 * clamp(diff, 0.0, 1.0))) * sun + 0.06;
    col = c * light;
    // terminatore arrossato dall'atmosfera
    col += uAtm * uAtmK * 0.25 * exp(-diff * diff * 60.0) * sun;
    if (uType == 3) {
      float city = smoothstep(0.62, 0.7, fbm(qq * 9.0, 4)) * (1.0 - smoothstep(-0.15, 0.05, diff * sun));
      col += vec3(1.0, 0.72, 0.35) * city * 0.9;
    }
    if (uSel > 0.5) col += vec3(0.25, 0.8, 1.0) * pow(1.0 - abs(dot(nv, -rd)), 6.0) * 0.6;
    alpha = 1.0;
    depth = depthOf(uOrtho > 0.5 ? (ro + t * rd).z : max(t, 0.0) * rd.z);
  }
  // atmosfera: integrazione lungo la corda nel guscio (6 campioni)
  if (uAtmK > 0.01) {
    float t0 = max(-b - sA, uOrtho > 0.5 ? -1e30 : 0.0);
    float t1 = hit ? -b - s : -b + sA;
    float H = uR * uAtmH * 0.35, acc = 0.0, dt = (t1 - t0) / 6.0;
    for (int i = 0; i < 6; i++) {
      float tt = t0 + (float(i) + 0.5) * dt;
      vec3 p = q + (tt + b) * rd;                         // rispetto al centro
      float pl = length(p);
      float dens = exp(-max(pl - uR, 0.0) / H);
      float li = smoothstep(-0.25, 0.35, dot(p / pl, L)) * sunlight(uC + p);
      acc += dens * li * dt;
    }
    float k = clamp(acc / (uR * uAtmH * 2.2), 0.0, 1.5) * uAtmK;
    col += uAtm * k;
    alpha = max(alpha, clamp(k, 0.0, 1.0));
  }
  if (alpha <= 0.002) discard;
  gl_FragDepth = depth;          // il solo alone (senza superficie) non copre nulla
  o = vec4(col, alpha);
}`;

const FS_STAR = `#version 300 es
precision highp float;
${COMMON}
${NOISE}
in vec2 vP; out vec4 o;
uniform vec3 uC; uniform float uR; uniform vec3 uA; uniform float uT; uniform float uCoreFrac;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  vec3 c; float a;
  if (r < uCoreFrac) {
    float x = r / uCoreFrac; float mu = sqrt(1.0 - x * x);
    float gran = fbm(vec3(vP / uCoreFrac * 7.0, uT), 5);
    c = mix(uA, vec3(1.0, 0.98, 0.9), 0.55) * (0.55 + 0.45 * mu) * (0.85 + 0.3 * gran);
    a = 1.0;
    gl_FragDepth = depthOf(uOrtho > 0.5 ? uC.z : length(uC) - uR);
  } else {
    float t = (r - uCoreFrac) / (1.0 - uCoreFrac);
    float ang = atan(vP.y, vP.x);
    float rays = 0.7 + 0.3 * fbm(vec3(ang * 3.0, t * 2.0 - uT * 0.6, uT * 0.3), 4);
    a = pow(1.0 - t, 3.0) * rays;
    c = uA * a * 1.5;
    gl_FragDepth = 1.0;           // la corona non copre nulla (orbite e rotte dietro restano visibili)
  }
  o = vec4(c, a);
}`;

const FS_FLARE = `#version 300 es
precision mediump float;
in vec2 vP; out vec4 o; uniform vec3 uA; uniform float uGlowK;
void main() {
  float r = length(vP); if (r > 1.0) discard;
  float halo = pow(1.0 - r, 4.0) * 0.6;
  float streak = exp(-abs(vP.y) * 90.0) * pow(1.0 - abs(vP.x), 2.0);
  float spikes = (exp(-abs(vP.x) * 160.0) + exp(-abs(vP.y) * 160.0)) * pow(1.0 - r, 3.0) * 0.5;
  float a = (halo + streak * 0.7 + spikes) * uGlowK;
  o = vec4(mix(uA, vec3(1.0), 0.4) * a, a);
}`;

const FS_GLOW = `#version 300 es
precision highp float;
${COMMON}
in vec2 vP; out vec4 o; uniform vec3 uA; uniform float uGlowK; uniform float uZ;
void main() { float r = length(vP); if (r > 1.0) discard; float a = pow(1.0 - r, 2.2) * uGlowK; gl_FragDepth = depthOf(uZ); o = vec4(uA * a, a); }`;

const VS_STARS = `#version 300 es
in vec3 aDir; in float aMag;
uniform vec3 uRr; uniform vec3 uUu; uniform vec3 uFf; uniform float uFocal; uniform vec2 uRes2;
out float vM;
void main() {
  float X = dot(aDir, uRr), Y = dot(aDir, uUu), Z = dot(aDir, uFf);
  vM = aMag;
  if (Z <= 0.01) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 s = vec2(X / Z, Y / Z) * uFocal / (uRes2 * 0.5);
  gl_Position = vec4(s, 1.0, 1.0);
  gl_PointSize = 1.0 + aMag * 1.6;
}`;
const FS_STARS = `#version 300 es
precision mediump float; in float vM; out vec4 o;
void main() { vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * (0.25 + 0.75 * vM);
  o = vec4(mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.9, 0.8), fract(vM * 7.0)) * a, a); }`;

// nastri: A e B in coordinate di vista; T = estremo (0/1); S = lato (-1/+1)
const VS_LINE = `#version 300 es
in vec3 aA; in vec3 aB; in float aT; in float aS; in vec4 aCol; in float aW; in vec4 aSty;
${COMMON}
out float vSide; out float vLen; out float vInvZ; out vec4 vCol; out float vW; out vec4 vSty;
void main() {
  vec2 pa = viewToPx(aA), pb = viewToPx(aB);
  vec2 d = pb - pa; float len = length(d); vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw2 = aW * 0.5 + (aSty.w > 0.5 ? aW * 1.6 + 3.0 : 1.0);
  vec2 p = mix(pa, pb, aT) + nrm * aS * hw2;
  vSide = aS * hw2; vLen = aT * len; vCol = aCol; vW = aW; vSty = aSty;
  float z = mix(aA.z, aB.z, aT); vInvZ = 1.0 / max(z, 1e-3);
  if (uOrtho > 0.5) vInvZ = z;
  gl_Position = pxToClip(p);
}`;
const FS_LINE = `#version 300 es
precision highp float;
${COMMON}
in float vSide; in float vLen; in float vInvZ; in vec4 vCol; in float vW; in vec4 vSty; out vec4 o;
uniform float uTime;
void main() {
  float d = abs(vSide), hw = vW * 0.5;
  float core = 1.0 - smoothstep(hw - 0.6, hw + 0.6, d);
  float dash = 1.0;
  if (vSty.x > 0.0) { float per = vSty.x + vSty.y; float m = mod(vLen - uTime * 18.0 * vSty.z, per); dash = smoothstep(0.0, 0.8, m) * (1.0 - smoothstep(vSty.x - 0.8, vSty.x, m)); }
  float glow = vSty.w > 0.5 ? exp(-pow(d / (vW * 1.3 + 2.0), 2.0) * 2.2) * 0.45 : 0.0;
  float chev = 0.0;
  if (vSty.z > 0.5) {               // frecce che scorrono da A verso B
    float m = mod(vLen - uTime * 46.0, 38.0) - 19.0;
    chev = (1.0 - smoothstep(1.0, 2.2, abs(m + d * 0.95))) * (1.0 - smoothstep(hw + 3.0, hw + 5.0, d));
  }
  float a = clamp(core * dash + glow + chev * 0.9, 0.0, 1.0) * vCol.a;
  if (a < 0.003) discard;
  float z = uOrtho > 0.5 ? vInvZ : 1.0 / vInvZ;
  gl_FragDepth = depthOf(z);
  o = vec4(mix(vCol.rgb, vec3(1.0), chev * 0.35) * a, a);
}`;

const LINE_STRIDE = 17; // A3 B3 T1 S1 C4 W1 STY4

/**
 * Nastri delle linee in coordinate di vista, ritagliati sul piano vicino. Pura (testabile).
 * @param P proiettore; lines [{a, b, color:[r,g,b], alpha, width, dash:[on,off], arrow, glow}]
 * @returns Float32Array (6 vertici per segmento)
 */
export function buildLineBuffer(P, lines, near, ortho = false) {
  const out = new Float32Array(lines.length * 6 * LINE_STRIDE); let n = 0;
  for (const l of lines) {
    let a = toView(P, l.a), b = toView(P, l.b);
    if (!ortho) { const c = clipNear(a, b, near); if (!c) continue; [a, b] = c; }
    const col = l.color ?? [1, 1, 1], al = l.alpha ?? 1, w = l.width ?? 1.5, ds = l.dash ?? [0, 0];
    const sty = [ds[0] || 0, ds[1] || 0, l.arrow ? 1 : 0, l.glow ? 1 : 0];
    for (const [t, s] of [[0, -1], [1, -1], [0, 1], [0, 1], [1, -1], [1, 1]]) {
      out.set([a.x, a.y, a.z, b.x, b.y, b.z, t, s, col[0], col[1], col[2], al, w, ...sty], n); n += LINE_STRIDE;
    }
  }
  return out.subarray(0, n);
}

export const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h)); if (!m) return [1, 1, 1]; const v = parseInt(m[1], 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };

export class GL3D {
  constructor(canvas) {
    this.cv = canvas; this.ok = false; this.webgl2 = true;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
    this.gl = gl; if (!gl) return;
    try {
      this.pBody = this.#prog(VS_QUAD, FS_BODY); this.pStar = this.#prog(VS_QUAD, FS_STAR); this.pGlow = this.#prog(VS_QUAD, FS_GLOW);
      this.pFlare = this.#prog(VS_QUAD, FS_FLARE); this.pSky = this.#prog(VS_STARS, FS_STARS); this.pLine = this.#prog(VS_LINE, FS_LINE);
    } catch (e) { console.warn('WebGL2 dell\'atlante non disponibile:', e.message); return; }
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const N = 2600, sky = new Float32Array(N * 4); let s = 1234567;
    const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
    for (let i = 0; i < N; i++) {
      const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      const band = Math.exp(-(((r * Math.sin(t)) * 0.8 + z * 0.6) ** 2) * 18);
      sky.set([r * Math.cos(t), r * Math.sin(t), z, Math.min(1, rnd() ** 3 * 1.4 + band * rnd() * 0.5)], i * 4);
    }
    this.sky = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.sky); gl.bufferData(gl.ARRAY_BUFFER, sky, gl.STATIC_DRAW); this.skyN = N;
    this.lineBuf = gl.createBuffer(); this.lineN = 0; this.lineKey = null;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    this.ok = true;
  }

  #prog(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, u.name); }
    const attr = {}; const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); attr[a.name] = gl.getAttribLocation(p, a.name); }
    return { p, loc, attr };
  }

  #common(pr, C) {
    const gl = this.gl, l = pr.loc;
    gl.useProgram(pr.p);
    if (l.uRes) gl.uniform2f(l.uRes, C.W, C.H);
    if (l.uDpr) gl.uniform1f(l.uDpr, C.dpr);
    if (l.uF) gl.uniform1f(l.uF, C.F);
    if (l.uK) gl.uniform1f(l.uK, C.K);
    if (l.uOrtho) gl.uniform1f(l.uOrtho, C.ortho ? 1 : 0);
    if (l.uLogFar) gl.uniform1f(l.uLogFar, Math.log2(1e13 + 1));
    if (l.uOrthoRange) gl.uniform1f(l.uOrthoRange, 4e12);
  }
  #quad(pr, cx, cy, half) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const a = pr.attr.aCorner; gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(pr.loc.uCenter, cx, cy); gl.uniform1f(pr.loc.uHalf, half);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disableVertexAttribArray(a);
  }

  /**
   * @param P proiettore (view.js); scene {bodies:[{pos, radius|null, kind, name, system, selected, spin, look}],
   *   star:{pos, radius, color, visible}|null, orbits:[{points, color, alpha}], lines:[...], linesKey, ortho, dist}
   */
  render(P, scene, W, H, dpr, time) {
    const gl = this.gl; if (!this.ok || gl.isContextLost()) return;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0.012, 0.024, 0.045, 1); gl.clearDepth(1); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const ortho = !!scene.ortho;
    const C = { W, H, dpr, F: P.F, K: P.F / scene.dist, ortho };
    gl.enable(gl.BLEND); gl.disable(gl.CULL_FACE);

    // cielo
    gl.disable(gl.DEPTH_TEST); gl.blendFunc(gl.ONE, gl.ONE);
    { const k = this.pSky; gl.useProgram(k.p);
      gl.uniform3f(k.loc.uRr, P.r.x, P.r.y, P.r.z); gl.uniform3f(k.loc.uUu, P.u.x, P.u.y, P.u.z); gl.uniform3f(k.loc.uFf, P.f.x, P.f.y, P.f.z);
      gl.uniform1f(k.loc.uFocal, P.F); gl.uniform2f(k.loc.uRes2, W, H);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sky);
      const aD = k.attr.aDir, aM = k.attr.aMag;
      gl.enableVertexAttribArray(aD); gl.vertexAttribPointer(aD, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aM); gl.vertexAttribPointer(aM, 1, gl.FLOAT, false, 16, 12);
      gl.drawArrays(gl.POINTS, 0, this.skyN); gl.disableVertexAttribArray(aD); gl.disableVertexAttribArray(aM); }

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    const near = Math.max(0.5, scene.dist * 1e-5);
    const starV = scene.star ? toView(P, scene.star.pos) : null;
    const starR = scene.star?.radius ?? 7e8;

    // stella (nucleo con profondita', corona additiva)
    if (scene.star && (ortho || starV.z > -starR)) {
      const c = P.project(scene.star.pos);
      if (c.visible) {
        const rpx = ortho ? starR * C.K : starR / Math.max(starV.z, 1) * P.F;
        const core = Math.max(4, rpx), half = Math.max(core * 3.4, 70);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
        const pr = this.pStar; this.#common(pr, C);
        gl.uniform3f(pr.loc.uC, starV.x, starV.y, starV.z); gl.uniform1f(pr.loc.uR, starR);
        gl.uniform3f(pr.loc.uA, ...(scene.star.color ?? [1, 0.75, 0.4])); gl.uniform1f(pr.loc.uT, time * 0.05); gl.uniform1f(pr.loc.uCoreFrac, core / half);
        this.#quad(pr, c.x, c.y, half);
      }
    }

    // corpi: ray casting, dal piu' lontano
    const occ = []; const list = [];
    for (const b of scene.bodies ?? []) {
      const v = toView(P, b.pos);
      if (b.radius) occ.push({ v, r: b.radius, b });
      list.push({ b, v, D: Math.hypot(v.x, v.y, v.z) });
    }
    const occN = Math.min(16, occ.length);
    const occArr = new Float32Array(64);
    occ.slice(0, 16).forEach((o, i) => occArr.set([o.v.x, o.v.y, o.v.z, o.r], i * 4));
    list.sort((p, q) => q.D - p.D);
    for (const { b, v, D } of list) {
      const look = b.look ?? (b.look = lookOf(b.name, b.kind, b.system, b.radius));
      const atmH = look.atmK > 0.2 ? 0.06 : look.atmK > 0.08 ? 0.03 : 0.0;
      const Ra = (b.radius ?? 0) * (1 + atmH);
      const c = P.project(b.pos);
      let rpx = 0;
      if (b.radius) rpx = ortho ? b.radius * C.K : v.z > 0 ? b.radius / v.z * P.F : 0;
      const inside = !ortho && b.radius && D < Ra * 4;
      if (!b.radius || (!inside && rpx < 1.6)) {
        if (!c.visible) continue;
        if (c.x < -60 || c.y < -60 || c.x > W + 60 || c.y > H + 60) continue;
        const col = look.a.map((x, i) => (x + look.b[i]) / 2);
        gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
        const pr = this.pGlow; this.#common(pr, C);
        gl.uniform3f(pr.loc.uA, ...col); gl.uniform1f(pr.loc.uGlowK, b.kind === 'planet' ? 0.55 : 0.35); gl.uniform1f(pr.loc.uZ, ortho ? v.z : Math.max(v.z, 1));
        this.#quad(pr, c.x, c.y, b.kind === 'planet' ? 26 : 13);
        continue;
      }
      if (!ortho && v.z < -Ra) continue;
      let cx, cy, half;
      if (inside || !c.visible || rpx * 2 > Math.max(W, H) * 0.6) { cx = W / 2; cy = H / 2; half = Math.max(W, H) * 0.75; }
      else { cx = c.x; cy = c.y; half = rpx * (1 + atmH) * 1.45 + 3; if (cx < -half || cy < -half || cx > W + half || cy > H + half) continue; }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);
      const pr = this.pBody; this.#common(pr, C); const l = pr.loc;
      gl.uniform3f(l.uC, v.x, v.y, v.z); gl.uniform1f(l.uR, b.radius); gl.uniform1f(l.uAtmH, atmH);
      gl.uniform3f(l.uS, starV?.x ?? 0, starV?.y ?? 0, starV?.z ?? 0); gl.uniform1f(l.uHasStar, starV ? 1 : 0); gl.uniform1f(l.uStarR, starR);
      gl.uniformMatrix3fv(l.uBasis, false, new Float32Array([P.r.x, P.r.y, P.r.z, P.u.x, P.u.y, P.u.z, P.f.x, P.f.y, P.f.z]));
      gl.uniform1f(l.uSpin, b.spin ?? 0);
      gl.uniform3f(l.uSeed, ...look.seed); gl.uniform1i(l.uType, look.type);
      gl.uniform3f(l.uA, ...look.a); gl.uniform3f(l.uB, ...look.b); gl.uniform3f(l.uCc, ...look.c);
      gl.uniform3f(l.uAtm, ...look.atm); gl.uniform1f(l.uAtmK, look.atmK); gl.uniform1f(l.uSel, b.selected ? 1 : 0);
      gl.uniform4fv(l.uOcc, occArr); gl.uniform1i(l.uOccN, occN); gl.uniform1i(l.uSelf, occ.findIndex((o) => o.b === b));
      gl.uniform1i(l.uOct, rpx > 600 ? 8 : rpx > 150 ? 6 : 5);
      this.#quad(pr, cx, cy, half);
    }

    // orbite e rotte (nastri con profondita', senza scrivere profondita')
    gl.depthMask(false); gl.blendFunc(gl.ONE, gl.ONE);
    if (scene.linesKey !== this.lineKey) {
      const segs = [];
      for (const o of scene.orbits ?? []) for (let i = 1; i < o.points.length; i++) segs.push({ a: o.points[i - 1], b: o.points[i], color: o.color, alpha: o.alpha, width: o.width ?? 1.1 });
      for (const l of scene.lines ?? []) segs.push(l);
      const data = buildLineBuffer(P, segs, near, ortho);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.lineN = data.length / LINE_STRIDE; this.lineKey = scene.linesKey;
    }
    if (this.lineN) {
      const pr = this.pLine; this.#common(pr, C); gl.uniform1f(pr.loc.uTime, time);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      const S = LINE_STRIDE * 4; const at = pr.attr;
      const set = (name, size, off) => { const a = at[name]; if (a == null || a < 0) return; gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, size, gl.FLOAT, false, S, off * 4); };
      set('aA', 3, 0); set('aB', 3, 3); set('aT', 1, 6); set('aS', 1, 7); set('aCol', 4, 8); set('aW', 1, 12); set('aSty', 4, 13);
      gl.drawArrays(gl.TRIANGLES, 0, this.lineN);
      for (const k of ['aA', 'aB', 'aT', 'aS', 'aCol', 'aW', 'aSty']) if (at[k] >= 0) gl.disableVertexAttribArray(at[k]);
    }

    // riflesso della stella sull'ottica (solo se la stella si vede davvero)
    if (scene.star?.visible && starV && (ortho || starV.z > 0)) {
      const c = P.project(scene.star.pos);
      if (c.visible && c.x > -200 && c.y > -200 && c.x < W + 200 && c.y < H + 200) {
        gl.disable(gl.DEPTH_TEST); gl.blendFunc(gl.ONE, gl.ONE);
        const pr = this.pFlare; this.#common(pr, C);
        gl.uniform3f(pr.loc.uA, ...(scene.star.color ?? [1, 0.75, 0.4])); gl.uniform1f(pr.loc.uGlowK, 0.55);
        this.#quad(pr, c.x, c.y, Math.min(Math.max(W, H) * 0.45, 420));
        gl.enable(gl.DEPTH_TEST);
      }
    }
    gl.depthMask(true);
  }
}
