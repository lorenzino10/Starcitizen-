// ATLANTE 3D v2 (3.2.0): rotazione "ADESSO", occlusione, camera, nastri delle rotte, risparmio GPU,
// layout HONOR V5. Solo matematica pura e controlli sul sorgente: il WebGL si prova nel browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROTATION, rotationOf, rotationAngle, rotateZ, localSun, nextLightChange, fmtHour, raySphere, occluded, clipNear,
  toView, zoomAt, flyPath, flyDuration, pinch, frameDecision,
} from '../js/atlas/scene3d.js';
import { buildLineBuffer, hexRgb } from '../js/atlas/gl3d.js';
import { camera, projector, DEG } from '../js/atlas/view.js';

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// microTech e New Babbage con le coordinate di scunpacked (statiche, metri)
const MT = { name: 'microTech', system: 'stanton', pos: { x: 22462085252.484795, y: 37185744964.8301, z: 0 }, radius: 1e6 };
const NB_LOCAL = { x: 520722.99, y: 419364.31, z: 743654.68 };
const HU = { name: 'Hurston', system: 'stanton', pos: { x: 12850457093, y: 0, z: 0 }, radius: 1e6 };
const LOR_LOCAL = { x: -328989, y: -752435, z: 572120 };
const STAR = { x: 0, y: 0, z: 0 };
const sunAt = (body, local, t) => localSun(local, body, STAR, rotationAngle(body.system, body.name, t));

test('3D-1 rotazione: tutti i corpi di Stanton e Pyro, Nyx assente, nessuna orbita', () => {
  assert.equal(Object.keys(ROTATION.stanton).length, 16);
  assert.equal(Object.keys(ROTATION.pyro).length, 11);
  assert.equal(rotationOf('nyx', 'Nyx I'), null, 'Nyx: nessun dato, nessuna rotazione inventata');
  assert.equal(rotationOf('pyro', 'Fuego'), null, 'Fuego ha 0 nel dataset: rotazione non nota');
  assert.deepEqual(rotationOf('stanton', 'microTech'), { hours: 4.12, correction: 131.621 });
  assert.ok(rotationOf('pyro', 'Pyro V'));
});

test('3D-2 rotazione: periodica e deterministica', () => {
  const t = Date.UTC(2026, 10, 20, 7, 0);
  const a = rotationAngle('stanton', 'Daymar', t), b = rotationAngle('stanton', 'Daymar', t + 2.48 * 3600e3);
  assert.ok(Math.abs(a - b) < 1e-6 || Math.abs(Math.abs(a - b) - 2 * Math.PI) < 1e-6);
  const q = rotationAngle('stanton', 'Daymar', t + 2.48 * 3600e3 / 4);
  const d = ((q - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  assert.ok(Math.abs(d - Math.PI / 2) < 1e-6, 'un quarto di giorno = 90 gradi in senso antiorario');
});

test('3D-3 ora locale: valori di controllo (coincidono con il calcolo di VerseTime)', () => {
  // riferimenti calcolati indipendentemente con la formula dell'angolo orario di VerseTime
  const t = Date.UTC(2025, 5, 1, 13);
  assert.ok(Math.abs(sunAt(MT, NB_LOCAL, t).hour - 1.091) < 0.01, 'New Babbage 01:05');
  assert.ok(Math.abs(sunAt(HU, LOR_LOCAL, t).hour - 4.516) < 0.01, 'Lorville 04:31');
  assert.equal(fmtHour(1.091), '01:05');
  assert.equal(fmtHour(23.999), '00:00');
});

test('3D-4 posizione attuale: rotazione rigida attorno al centro del corpo (quota e latitudine invariate)', () => {
  const p = { x: MT.pos.x + NB_LOCAL.x, y: MT.pos.y + NB_LOCAL.y, z: NB_LOCAL.z };
  const r0 = Math.hypot(NB_LOCAL.x, NB_LOCAL.y, NB_LOCAL.z);
  for (const a of [0, 0.7, 2, 4.5]) {
    const q = rotateZ(p, MT.pos, a);
    assert.ok(Math.abs(Math.hypot(q.x - MT.pos.x, q.y - MT.pos.y, q.z - MT.pos.z) - r0) < 1e-3);
    assert.equal(q.z, p.z);
  }
  const back = rotateZ(rotateZ(p, MT.pos, 1.3), MT.pos, -1.3);
  assert.ok(Math.abs(back.x - p.x) < 1e-3 && Math.abs(back.y - p.y) < 1e-3);
});

test('3D-5 luce: mezzogiorno sotto la stella, notte dall\'altra parte, prossimo cambio entro un giorno', () => {
  const body = { pos: { x: 1e10, y: 0, z: 0 } };
  const noon = localSun({ x: -1e6, y: 0, z: 0 }, body, STAR, 0);
  assert.ok(Math.abs(noon.hour - 12) < 1e-6 && noon.elevation > 89.9 && noon.day);
  const night = localSun({ x: 1e6, y: 0, z: 0 }, body, STAR, 0);
  assert.ok(!night.day && Math.abs(night.hour % 24) < 1e-6);
  const t = Date.UTC(2026, 10, 20, 7, 0);
  const n = nextLightChange('stanton', 'Hurston', LOR_LOCAL, HU, STAR, t);
  assert.ok(n.minutes > 0 && n.minutes <= Math.ceil(2.48 * 60) + 1, JSON.stringify(n));
  assert.ok(['alba', 'tramonto'].includes(n.event));
  const s1 = sunAt(HU, LOR_LOCAL, t + (n.minutes - 1) * 60000), s2 = sunAt(HU, LOR_LOCAL, t + n.minutes * 60000);
  assert.notEqual(s1.day, s2.day, 'il cambio avviene proprio in quel minuto');
  assert.equal(nextLightChange('nyx', 'Nyx I', LOR_LOCAL, HU, STAR, t), null);
});

test('3D-6 occlusione: dietro il pianeta nascosto, sul lato visibile no', () => {
  const s = [{ center: { x: 0, y: 0, z: 0 }, radius: 1e6 }];
  const eye = { x: -1e7, y: 0, z: 0 };
  assert.equal(occluded(eye, { x: 5e6, y: 0, z: 0 }, s), true, 'stazione dietro al globo');
  assert.equal(occluded(eye, { x: -1e6, y: 0, z: 0 }, s), false, 'base sulla faccia visibile');
  assert.equal(occluded(eye, { x: 1e6, y: 0, z: 0 }, s), true, 'base sulla faccia nascosta');
  assert.equal(occluded(eye, { x: 0, y: 3e6, z: 0 }, s), false, 'di lato');
  assert.equal(raySphere(eye, { x: 1, y: 0, z: 0 }, s[0].center, 1e6), 9e6);
  assert.equal(raySphere(eye, { x: -1, y: 0, z: 0 }, s[0].center, 1e6), null, 'sfera alle spalle');
  // precisione alla scala del sistema: pianeta a 4e10 m
  const far = [{ center: { x: 4e10, y: 0, z: 0 }, radius: 1e6 }];
  assert.equal(occluded({ x: 0, y: 0, z: 0 }, { x: 4e10 + 2e6, y: 0, z: 0 }, far), true);
  assert.equal(occluded({ x: 0, y: 0, z: 0 }, { x: 4e10 - 1e6, y: 0, z: 0 }, far), false);
});

test('3D-7 ritaglio sul piano vicino', () => {
  assert.equal(clipNear({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -1 }, 1), null);
  const [a, b] = clipNear({ x: 0, y: 0, z: -1 }, { x: 4, y: 0, z: 3 }, 1);
  assert.equal(a.z, 1); assert.equal(a.x, 2); assert.equal(b.z, 3);
});

test('3D-8 zoom verso il cursore: il punto sotto il cursore resta fermo', () => {
  const cam = camera({ target: { x: 1e9, y: 2e9, z: 0 }, dist: 5e8, yaw: 0.4, pitch: 0.5 });
  const P = projector(cam, 800, 600);
  const m = P.metersPerPixel(), sx = 650, sy = 120;
  const under = { x: cam.target.x + P.r.x * (sx - 400) * m + P.u.x * -(sy - 300) * m, y: cam.target.y + P.r.y * (sx - 400) * m + P.u.y * -(sy - 300) * m, z: cam.target.z + P.r.z * (sx - 400) * m + P.u.z * -(sy - 300) * m };
  const z = zoomAt(cam, P, sx, sy, 0.5);
  const P2 = projector({ ...cam, target: z.target, dist: z.dist }, 800, 600);
  const q = P2.project(under);
  assert.ok(Math.abs(q.x - sx) < 0.5 && Math.abs(q.y - sy) < 0.5, `${q.x},${q.y}`);
  assert.equal(z.dist, 2.5e8);
});

test('3D-9 volo ad arco: parte e arriva esatto, si alza fra due pianeti lontani', () => {
  const from = { x: 0, y: 0, z: 0, d: 3e6 }, to = { x: 3e10, y: 0, z: 0, d: 3e6 };
  const f = flyPath(from, to);
  assert.deepEqual(f(0).target, { x: 0, y: 0, z: 0 }); assert.ok(Math.abs(f(0).dist - 3e6) < 1);
  assert.ok(Math.abs(f(1).target.x - 3e10) < 1 && Math.abs(f(1).dist - 3e6) < 1);
  assert.ok(f(0.5).dist > 1e9, 'a meta\' volo la camera vede entrambi');
  const near = flyPath({ x: 0, y: 0, z: 0, d: 1e6 }, { x: 1e3, y: 0, z: 0, d: 5e5 });
  assert.ok(near(0.5).dist <= 1e6 * 1.01, 'spostamento corto: nessun arco');
  const ms = flyDuration(from, to); assert.ok(ms >= 420 && ms <= 1600);
});

test('3D-10 due dita: zoom, spostamento, rotazione', () => {
  const g = pinch({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 0 });
  assert.equal(g.scale, 0.5); assert.equal(g.dx, 50); assert.equal(g.rot, 0);
  const r = pinch({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
  assert.ok(Math.abs(r.rot - Math.PI / 2) < 1e-9);
});

test('3D-11 risparmio GPU: niente fotogrammi nascosto, animazioni a riposo dopo 20 s, tetto fps', () => {
  const base = { dirty: false, animOn: true, visible: true, now: 100000, lastInput: 99000, lastFrame: 99990, fps: 30 };
  assert.deepEqual(frameDecision({ ...base, visible: false, dirty: true }), { draw: false, animating: false });
  assert.equal(frameDecision(base).draw, false, 'meno di 1/30 s dall\'ultimo fotogramma');
  assert.equal(frameDecision({ ...base, lastFrame: 99960 }).draw, true);
  assert.equal(frameDecision({ ...base, lastInput: 70000, lastFrame: 0 }).draw, false, 'a riposo: fermo');
  assert.equal(frameDecision({ ...base, animOn: false, lastFrame: 0 }).draw, false);
  assert.equal(frameDecision({ ...base, animOn: false, dirty: true }).draw, true, 'un cambiamento si disegna sempre');
});

test('3D-12 nastri delle rotte: 6 vertici per segmento, segmenti dietro la camera scartati', () => {
  const cam = camera({ target: { x: 0, y: 0, z: 0 }, dist: 1e6, yaw: 0, pitch: 0 });
  const P = projector(cam, 800, 600);
  const lines = [
    { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 1e5, z: 0 }, color: [1, 0, 0], width: 2, arrow: true, glow: true },
    { a: { x: 3e6, y: 0, z: 0 }, b: { x: 4e6, y: 0, z: 0 } }, // tutto alle spalle della camera
  ];
  const buf = buildLineBuffer(P, lines, 1);
  assert.equal(buf.length, 6 * 17);
  const v0 = toView(P, { x: 0, y: 0, z: 0 });
  assert.ok(Math.abs(buf[2] - v0.z) < 1e-6 && Math.abs(v0.z - 1e6) < 1e-3, 'coordinate di vista relative alla camera');
  assert.equal(buf[15], 1, 'freccia'); assert.equal(buf[16], 1, 'alone');
  assert.deepEqual(hexRgb('#ff0000'), [1, 0, 0]);
});

test('3D-13 sorgente: WebGL2 proprio senza librerie ne\' CDN, riserve, interruttori, layout HONOR V5', () => {
  const gl3 = src('../js/atlas/gl3d.js'), r = src('../js/atlas/render.js'), html = src('../index.html'), app = src('../js/app.js'), css = src('../css/navcom.css');
  assert.match(gl3, /getContext\('webgl2'/);
  assert.doesNotMatch(gl3 + r + src('../js/atlas/scene3d.js'), /https?:\/\/(?!github\.com\/dydrmr)/, 'nessuna risorsa esterna');
  assert.match(gl3, /gl_FragDepth/); assert.match(gl3, /sunlight\(/, 'eclissi');
  assert.match(r, /new GL3D\(g\)/); assert.match(r, /new GLLayer\(g1\)/, 'riserva WebGL1'); assert.match(r, /if \(L\.ok\)/);
  assert.doesNotMatch(r, /getContext\(['"](webgl|webgl2|experimental-webgl)/i);
  for (const id of ['at-now', 'at-anim', 'layout-fold', 'at-q2', 'at-dclose-l']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /da collaudare in gioco/);
  assert.match(app, /navcom\.layout/); assert.match(css, /body\.fold \.at-left/);
  assert.match(src('../js/ui-atlas.js'), /NAVCOM continuano a usare le coordinate dei file di gioco/);
});

test('3D-14 ADESSO non tocca i calcoli: geo e pianificatore usano solo le coordinate statiche', () => {
  for (const f of ['../js/atlas/geo.js', '../js/core/plan.js', '../js/atlas/missions.js', '../js/atlas/stack.js']) {
    assert.doesNotMatch(src(f), /scene3d|rotationAngle/, f);
  }
  // DEG coerente fra i moduli
  assert.equal(DEG, Math.PI / 180);
});
