// Partenze e cause di scarto del pianificatore (0.5.6): partenza planetaria (marker al centro del
// corpo, come "microTech" di CitizenHQ), partenza orbitale, nessuna partenza, partenza e
// destinazione XYZ arbitrarie. Nessun criterio di sicurezza viene abbassato: si verifica anzi che
// le tratte teoriche restino escluse dalla modalita' operativa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec, distance } from '../js/core/vector.js';
import { buildContext, legRejectCode, legStatus, planInSystem, planRoutes, REJECT } from '../js/core/plan.js';
import { checkObstructions } from '../js/core/qt.js';

const R = 1e6; // 1000 km
const C = vec(1e9, 0, 0);
const PLANET = { name: 'Pianeta', center: C, radius: R, uncertain: false };
const MODEL = { bodies: [PLANET], margin: 1.2, complete: true, missing: [] };
const pts = (list) => list.map(([name, x, y, z, qtValid = true]) => ({ key: name, name, pos: vec(x, y, z), qtValid }));
const MARKERS = [
  ['Pianeta', 1e9, 0, 0],          // marker "pianeta": esattamente al centro del corpo
  ['Stazione', 1e9, 3 * R, 0],      // stazione orbitale a 3 raggi dal centro
  ['A', 0, 0, 0], ['B', 0, 2e9, 0], ['D', -1e9, 1e9, 0],
];
const P = vec(1e7, 8e8, 0);         // 10.000 km dalla tratta A-B
const OP = { mode: 'operativa', criterion: 'operativo', allowTwoStage: true };
const ctxOf = (extra = {}) => buildContext('t', pts(MARKERS), MODEL, extra);
const at = (name) => MARKERS.find((m) => m[0] === name);
const start = (name) => ({ key: name, name, pos: vec(...at(name).slice(1, 4)) });
const opSteps = (p) => p.steps.filter((s) => s.kind === 'qt' || s.kind === 'qt-drop');

test('Partenza planetaria: marker al centro del pianeta -> nessun piano, causa e marker orbitali suggeriti', () => {
  const ctx = ctxOf();
  const r = planInSystem(ctx, P, start('Pianeta'), OP);
  assert.equal(r.plans.length, 0);
  assert.ok(r.startIssue, 'diagnosi della partenza presente');
  assert.equal(r.startIssue.surface.kind, 'centro');
  assert.equal(r.startIssue.surface.body, 'Pianeta');
  assert.equal(r.startIssue.reasons.centro, MARKERS.length - 1, 'tutte le tratte in uscita sono teoriche per "centro"');
  // suggerimenti: solo marker non al centro/superficie, con tratte operative, dal piu' vicino
  assert.equal(r.startIssue.suggestions[0].name, 'Stazione');
  assert.ok(r.startIssue.suggestions[0].operationalLegs > 0);
  close(r.startIssue.suggestions[0].distance, 3 * R);
  assert.ok(r.startIssue.suggestions.every((s) => s.name !== 'Pianeta'));
  // le cause di scarto dicono "partenza", non "ostacolo"
  assert.ok(r.stats.rejected1.partenza > 0);
  assert.equal(r.stats.rejected1.ostacolo ?? 0, 0);
  // nessuna sostituzione automatica: il motore non ha cambiato la partenza
  assert.equal(r.start.name, 'Pianeta');
});

test('Partenza planetaria in modalità geometrica: piani presenti ma tutti teorici (alternative non operative)', () => {
  const r = planInSystem(ctxOf(), P, start('Pianeta'), { ...OP, mode: 'geometrica' });
  assert.ok(r.plans.length > 0);
  assert.ok(r.plans.every((p) => p.status === 'Teorica' || opSteps(p).some((s) => !s.operational)));
  assert.equal(r.startIssue, null, 'la diagnosi riguarda solo la modalità operativa');
});

test('Partenza orbitale: piani operativi dalla stazione', () => {
  const r = planInSystem(ctxOf(), P, start('Stazione'), OP);
  assert.ok(r.plans.length > 0);
  assert.equal(r.startIssue, null);
  assert.equal(r.plans[0].departure.name, 'Stazione');
  assert.ok(r.plans.every((p) => opSteps(p).every((s) => s.operational && !s.blocked)));
});

test('Nessuna partenza: NAVCOM trova da dove partire', () => {
  const r = planInSystem(ctxOf(), P, null, OP);
  assert.ok(r.plans.length > 0);
  assert.equal(r.startIssue, null);
  const best = r.plans[0];
  assert.ok(opSteps(best).every((s) => s.operational));
  assert.ok(opSteps(best).every((s) => s.from.name !== 'Pianeta' && s.to.name !== 'Pianeta'));
});

test('Partenza XYZ libera dentro il pianeta: mai operativa (nessuna scorciatoia sugli ostacoli)', () => {
  for (const pos of [C, vec(1e9 + 0.3 * R, 0, 0), vec(1e9, 0, 0.9 * R)]) {
    const r = planInSystem(ctxOf(), P, { key: null, name: 'Posizione attuale', pos }, OP);
    assert.equal(r.plans.length, 0, `nessun piano da ${pos.x},${pos.y},${pos.z}`);
    assert.ok(r.startIssue);
    assert.ok(['centro', 'superficie'].includes(r.startIssue.surface.kind));
  }
});

test('Partenza XYZ libera nello spazio aperto: piani operativi', () => {
  const r = planInSystem(ctxOf(), P, { key: null, name: 'Posizione attuale', pos: vec(5e8, -5e8, 1e8) }, OP);
  assert.ok(r.plans.length > 0);
  assert.equal(r.startIssue, null);
  assert.ok(r.plans.every((p) => opSteps(p).every((s) => s.operational)));
});

test('Destinazioni XYZ arbitrarie: ogni piano operativo usa solo tratte operative, mai bloccate', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ctx = ctxOf();
  let withPlans = 0;
  for (let k = 0; k < 40; k++) {
    const T = vec((rnd() - 0.3) * 2.5e9, (rnd() - 0.2) * 2.5e9, (rnd() - 0.5) * 2e8);
    for (const st of [null, start('Stazione'), start('Pianeta')]) {
      const r = planInSystem(ctx, T, st, OP);
      if (r.plans.length) withPlans++;
      for (const p of r.plans) {
        for (const s of opSteps(p)) {
          assert.ok(s.operational && !s.blocked && !s.unavailable, `tratta non operativa in un piano operativo: ${s.from.name}->${s.to.name}`);
          assert.notEqual(s.from.name, 'Pianeta');
          assert.notEqual(s.to.name, 'Pianeta');
        }
      }
      if (st?.key === 'Pianeta') assert.equal(r.plans.length, 0);
    }
  }
  assert.ok(withPlans > 0);
});

test('legRejectCode equivale esattamente a legStatus (operatività e causa) su tutte le coppie', () => {
  const model = { ...MODEL, bodies: [PLANET, { name: 'Gas', center: vec(-5e8, 5e8, 0), radius: 5e7, uncertain: true }] };
  const list = pts([...MARKERS, ['Sup', 1e9, 0, 1.02 * R], ['E', -1e9, 0, 0], ['F', 0, 1e9, 0]]);
  for (const extra of [{}, { verified: new Set(['Pianeta|A', 'A|E']), unavailable: new Set(['B|D', 'Stazione|A']) }]) {
    for (const m of [model, { ...model, complete: false }]) {
      const ctx = buildContext('t', list, m, extra);
      const n = ctx.markers.length;
      const nd = (i) => ({ kind: 'marker', idx: i, key: ctx.markers[i].key, name: ctx.markers[i].name, pos: ctx.markers[i].pos });
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const st = legStatus(ctx, nd(i), nd(j), { mode: 'operativa' });
        const code = legRejectCode(ctx, i, j);
        assert.equal(code === null, st.operational, `${ctx.markers[i].name}->${ctx.markers[j].name}`);
        if (code) { assert.equal(code, st.reason); assert.ok(REJECT[code]); }
        assert.equal(legRejectCode(ctx, i, j), code, 'cache coerente');
      }
    }
  }
});

test('Prefiltro: combinazioni geometricamente migliori ma non operative non saturano i limiti', () => {
  // 400 coppie U-V passano a meno di 20 km da P (residuo 0) ma sono segnate "non disponibili";
  // A-B passa a 10.000 km ed e' operativa. Con limiti di valutazione minimi deve emergere A-B.
  const list = [...MARKERS];
  const unavailable = new Set();
  for (let k = 0; k < 20; k++) {
    const a = [`U${k}`, P.x - 1e8, P.y + k * 1e3, P.z + 5e7], b = [`V${k}`, P.x + 1e8, P.y + k * 1e3, P.z - 5e7];
    list.push(a, b);
  }
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) { unavailable.add(`U${i}|V${j}`); unavailable.add(`V${j}|U${i}`); }
  const ctx = buildContext('t', pts(list), MODEL, { unavailable });
  const r = planInSystem(ctx, P, null, { mode: 'operativa', allowTwoStage: false, maxEvaluations: 5, criterion: 'residuo' });
  assert.ok(r.plans.some((p) => p.steps[0].from.name === 'A' && p.steps[0].to.name === 'B'), 'A->B presente');
  assert.equal(r.stats.rejected1.non_disponibile, 800);
  assert.ok(r.plans.every((p) => opSteps(p).every((x) => !unavailable.has(`${x.from.name}|${x.to.name}`))));
  // in geometrica le stesse coppie restano visibili (nessun dato perso)
  const g = planInSystem(ctx, P, null, { mode: 'geometrica', allowTwoStage: false });
  assert.ok(g.plans.some((p) => /^U\d/.test(p.steps[0].from.name)));
});

test('Prefiltro esatto: con e senza limiti stretti i piani operativi a una interruzione coincidono', () => {
  const ctx = ctxOf();
  const big = planInSystem(ctx, P, null, { ...OP, allowTwoStage: false, maxEvaluations: 1e6, pool2: 1e6, limit: 100 });
  const dflt = planInSystem(ctxOf(), P, null, { ...OP, allowTwoStage: false, limit: 100 });
  const sig = (r) => r.plans.map((p) => opSteps(p).map((s) => `${s.from.name}>${s.to.name}`).join(',')).sort();
  assert.deepEqual(sig(dflt), sig(big));
});

test('Modalità operativa: "Includi tratte bloccate" non ha effetto', () => {
  const ctx = buildContext('t', pts([['A', 0, 0, 0], ['B', 2e9, 0, 0]]), { ...MODEL, bodies: [{ ...PLANET, center: vec(1.5e9, 0, 0) }] });
  const T = vec(4e8, 3e7, 0);
  assert.equal(planInSystem(ctx, T, null, { mode: 'operativa', allowTwoStage: false, includeBlocked: true }).plans.length, 0);
  assert.ok(planInSystem(ctx, T, null, { mode: 'geometrica', allowTwoStage: false, includeBlocked: true }).plans.length > 0);
});

test('Ostacoli: un marker al centro non produce blocchi casuali dal proprio corpo; gli altri corpi restano', () => {
  // dal centro, 64 direzioni: prima della correzione circa meta' risultava "bloccata da Pianeta"
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * 2 * Math.PI;
    const far = vec(C.x + 1e9 * Math.cos(a), C.y + 1e9 * Math.sin(a), C.z + 1e7 * (k % 3 - 1));
    assert.equal(checkObstructions(C, far, MODEL).filter((o) => o.body === 'Pianeta').length, 0);
  }
  // una tratta che attraversa il pianeta da fuori resta bloccata
  assert.ok(checkObstructions(vec(0, 0, 0), vec(2e9, 0, 0), MODEL).some((o) => o.body === 'Pianeta'));
  // un altro corpo sulla traiettoria del marker centrale resta bloccante
  const moon = { name: 'Luna', center: vec(1.5e9, 0, 0), radius: R, uncertain: false };
  assert.ok(checkObstructions(C, vec(2e9, 0, 0), { ...MODEL, bodies: [PLANET, moon] }).some((o) => o.body === 'Luna'));
});

test('planRoutes: partenza planetaria espone la diagnosi; partenza in un sistema non collegato dà errore esplicito', () => {
  const contexts = { t: ctxOf() };
  const r = planRoutes({ contexts, target: { system: 't', pos: P, name: 'P' }, start: { system: 't', ...start('Pianeta') }, opts: OP });
  assert.equal(r.plans.length, 0);
  assert.equal(r.startIssue.suggestions[0].name, 'Stazione');
  const e = planRoutes({ contexts: { ...contexts, u: ctxOf() }, target: { system: 't', pos: P, name: 'P' }, start: { system: 'u', ...start('A') }, opts: OP });
  assert.match(e.error, /Nessun collegamento/);
});

function close(a, b, tol = 1e-9) { assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`); }
void distance;

test('Modello ostacoli Stanton: luna in posizione diversa da CitizenHQ -> corpo sui marker, posizione del seed incerta', async () => {
  const { obstructionModel, bodySeed } = await import('../js/data/bodies.js');
  const { surfaceBody } = await import('../js/core/reverse.js');
  const seed = bodySeed('stanton').bodies.find((b) => b.name === 'Calliope');
  const row = { name: 'Calliope', type: 'Moon', x: seed.x + 1.3e8, y: seed.y, z: seed.z };
  const m = obstructionModel('stanton', 1.2, [row]);
  const at = m.bodies.filter((b) => b.name.startsWith('Calliope'));
  assert.equal(at.length, 2);
  assert.deepEqual([at[0].center.x, at[0].uncertain], [row.x, false]);
  assert.deepEqual([at[1].center.x, at[1].uncertain], [seed.x, true]);
  assert.equal(m.discrepancies[0].name, 'Calliope');
  // un avamposto a 240 km dal centro importato e' "in superficie" (tratte teoriche)
  assert.equal(surfaceBody(vec(row.x + seed.body_radius_m, row.y, row.z), m)?.kind, 'superficie');
  // posizioni concordi: nessun corpo aggiunto
  const same = obstructionModel('stanton', 1.2, [{ ...row, x: seed.x }]);
  assert.equal(same.bodies.filter((b) => b.name.startsWith('Calliope')).length, 1);
  assert.equal(same.discrepancies.length, 0);
});
