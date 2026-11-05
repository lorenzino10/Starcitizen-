// Parser CitizenHQ con risposte simulate, archivio locale e pianificazione end-to-end.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, fetchSystem, findGameVersion, getJson, parsePositions } from '../js/data/citizenhq.js';
import { obstructionModel } from '../js/data/bodies.js';
import { Store } from '../js/data/store.js';
import { navPoints, planToTarget } from '../js/planner.js';
import { STATUS } from '../js/core/qt.js';

const SAMPLE = [
  { uuid: 'u1', name: 'Alpha Station', type: 'Manmade', system: 'stanton', parentUuid: 'p', x: 1e10, y: 0, z: 0, qtValid: true },
  { uuid: 'u2', name: 'Beta Station', type: 'Manmade', system: 'stanton', parentUuid: 'p', x: -1e10, y: 2e9, z: 0, qtValid: true },
  { uuid: 'u3', name: 'Senza coordinate', x: null, y: null, z: null, qtValid: true },
  { uuid: 'u4', name: 'Rotto', x: 'abc', y: 0, z: 0 },
  { name: '' },
];
const HEALTH = { status: 'ok', jobs: { scunpacked: { version: '4.10.2-LIVE.12881860' } } };

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});
const fast = { retries: 2, timeoutMs: 200 };
globalThis.setTimeout = ((orig) => (fn, ms, ...a) => orig(fn, Math.min(ms, 5), ...a))(globalThis.setTimeout);

test('parser: conta e scarta', () => {
  const { locations, report } = parsePositions(SAMPLE, 'stanton');
  assert.deepEqual(locations.map((l) => l.name), ['Alpha Station', 'Beta Station']);
  assert.equal(report.skippedNoCoords, 1); assert.equal(report.skippedInvalid, 2);
  assert.equal(parsePositions({ data: SAMPLE.slice(0, 2) }, 'stanton').locations.length, 2);
  assert.throws(() => parsePositions({ x: 1 }, 'stanton'), ApiError);
  assert.equal(findGameVersion(HEALTH), '4.10.2-LIVE.12881860');
});

test('fetchSystem ok con versione', async () => {
  const fetchImpl = async (url) => (url.endsWith('/health') ? res(200, HEALTH) : res(200, SAMPLE));
  const r = await fetchSystem('stanton', { ...fast, fetchImpl });
  assert.ok(r.ok); assert.equal(r.meta.gameVersion, '4.10.2-LIVE.12881860'); assert.equal(r.locations.length, 2);
});

test('fetchSystem: 404, 5xx, 429, rete', async () => {
  let r = await fetchSystem('stanton', { ...fast, fetchImpl: async (u) => res(u.endsWith('/health') ? 503 : 404) });
  assert.ok(!r.ok); assert.match(r.errors[0], /HTTP 404/); assert.ok(r.warnings.some((w) => w.includes('/health')));
  r = await fetchSystem('stanton', { ...fast, fetchImpl: async () => res(502) });
  assert.match(r.errors[0], /HTTP 502/);
  let calls = 0;
  const v = await getJson('x', { ...fast, fetchImpl: async () => (++calls === 1 ? res(429, null, { 'Retry-After': '0' }) : res(200, [1])) });
  assert.deepEqual(v, [1]);
  r = await fetchSystem('stanton', { ...fast, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.match(r.errors[0], /CORS/);
  r = await fetchSystem('marte', fast);
  assert.match(r.errors[0], /sconosciuto/);
});

test('archivio: import fallito non cancella, punti, rotte, backup', () => {
  const s = new Store({ m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } });
  const { locations } = parsePositions(SAMPLE, 'stanton');
  assert.equal(s.replaceLocations('stanton', locations, { gameVersion: 'v' }, 'test'), 2);
  assert.equal(s.replaceLocations('stanton', [], null, 'test'), 0);
  assert.equal(s.locations('stanton').length, 2);
  assert.deepEqual(s.data.importLog.map((l) => l.ok), [false, true]);
  s.addCustomPoint({ name: 'Relitto', system: 'stanton', x: 0, y: 1e9, z: 0 });
  s.addCustomPoint({ name: 'Relitto', system: 'stanton', x: 0, y: 2e9, z: 0 });
  assert.equal(s.customPoints('stanton').length, 1);
  const pts = navPoints(s, 'stanton');
  const start = pts.get('citizenhq:u1');
  let { results } = planToTarget(s, 'stanton', start, pts.get('cp:Relitto').pos, 1.2);
  assert.equal(results[0].dest.key, 'citizenhq:u2');
  s.markVerified('citizenhq:u1', 'citizenhq:u2', 'stanton');
  ({ results } = planToTarget(s, 'stanton', start, pts.get('cp:Relitto').pos, 1.2));
  assert.equal(results[0].status, STATUS.VERIFIED);
  s.saveRoute('prova', 'stanton', { a: 1 });
  const backup = s.exportJson();
  const s2 = new Store({ m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } });
  s2.importJson(backup);
  assert.equal(s2.savedRoutes('stanton').length, 1); assert.equal(s2.locations('stanton').length, 2);
  assert.throws(() => s2.importJson('{"version":9}'));
});

test('modello ostacoli Stanton completo, Pyro no', () => {
  const m = obstructionModel('stanton');
  assert.ok(m.complete);
  for (const n of ['Crusader', 'Hurston', 'ArcCorp', 'Microtech']) assert.ok(m.bodies.some((b) => b.name === n));
  assert.ok(!obstructionModel('pyro').complete);
});
