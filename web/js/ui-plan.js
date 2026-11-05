// Interfaccia del PIANIFICATORE (Fasi 4 e 5). Nessun calcolo qui: il motore e' in core/plan.js
// ed e' eseguito in un Web Worker (plan-client.js).
import { STATUS } from './core/qt.js';
import { CRITERIA, EVIDENCE, inFlightCorrection } from './core/plan.js';
import { DEFAULT_HUD, ROUNDING_LABEL } from './core/hud.js';
import { coordinateChecks, fmtTime, parseShowLocation, pilotInstructions } from './core/instructions.js';
import { fmtAuto, fmtKm } from './core/units.js';
import { toArray, vec } from './core/vector.js';
import { SYSTEM_NAMES } from './core/systems.js';
import { obstructionModel } from './data/bodies.js';
import { navPoints } from './planner.js';
import { plan as runPlanner } from './plan-client.js';
import { AMBER, CYAN, GREEN, RED, systemPlot } from './plot.js';

const STATUS_COLOR = { [STATUS.VERIFIED]: GREEN, [STATUS.DATA]: CYAN, [STATUS.THEORETICAL]: AMBER };
const ICON = { [STATUS.VERIFIED]: '🟢', [STATUS.DATA]: '🔵', [STATUS.THEORETICAL]: '🟠' };
const km = (m) => (m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 });
const xyzKm = (v) => `${km(v.x)} / ${km(v.y)} / ${km(v.z)} km`;
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) || +v <= 0 ? null : +v);

export const NAV_DEFAULTS = {
  speed: '', ve: '', a1: '', a2: '', prep: '', minJump: '', conv: '', convA: '', jp: '', rmin: '', rmax: '',
  hGm: 1, hMm: 1, hKm: 0, hRound: 'unknown', maxFinal: '', deep: 'fonti', kNear: 40, starGm: 0.696,
};

/** Impostazioni dell'interfaccia -> opzioni del motore (unita' SI). */
export function navOptions(s) {
  const vmax = numOrNull(s.speed);
  return {
    drive: vmax ? { vmax: vmax * 1e6, ve: (numOrNull(s.ve) ?? 0) * 1e6, a1: (numOrNull(s.a1) ?? 0) * 1e6, a2: (numOrNull(s.a2) ?? 0) * 1e6 } : null,
    prep: numOrNull(s.prep),
    conv: numOrNull(s.conv) ? { v: +s.conv, a: numOrNull(s.convA) ?? 0 } : null,
    reaction: numOrNull(s.rmax) ? { min: Math.min(+s.rmin || 0, +s.rmax), max: +s.rmax } : null,
    hud: {
      units: [
        { ...DEFAULT_HUD.units[0], dec: +s.hGm },
        { ...DEFAULT_HUD.units[1], dec: +s.hMm },
        { ...DEFAULT_HUD.units[2], dec: +s.hKm },
      ],
      rounding: s.hRound,
    },
    maxFinal: numOrNull(s.maxFinal) ? s.maxFinal * 1000 : null,
    jpTransit: numOrNull(s.jp),
    minJump: numOrNull(s.minJump) ? s.minJump * 1000 : null,
    deepSpace: s.deep,
    kNear: Math.max(5, Math.min(200, +s.kNear || 40)),
  };
}

export function initPlanner(app) {
  const { $, esc, parseNum, radioVal, table, store, settings, saveSettings } = app;
  let last = null;

  // ------------------------------------------------------------ impostazioni
  for (const [k, v] of Object.entries(NAV_DEFAULTS)) {
    if (settings[k] === undefined || settings[k] === null) settings[k] = v;
    if ((k === 'speed' || k === 'conv') && settings[k] === 0) settings[k] = ''; // vecchio default 0 = non indicato
  }
  const bindSetting = (id, key, conv = (x) => x) => {
    const el = $(id);
    el.value = settings[key] ?? '';
    el.onchange = () => { settings[key] = conv(el.value); saveSettings(); };
  };
  bindSetting('s-speed', 'speed'); bindSetting('s-ve', 've'); bindSetting('s-a1', 'a1'); bindSetting('s-a2', 'a2');
  bindSetting('s-prep', 'prep'); bindSetting('s-minjump', 'minJump'); bindSetting('s-conv', 'conv'); bindSetting('s-conva', 'convA');
  bindSetting('s-jp', 'jp'); bindSetting('s-rmin', 'rmin'); bindSetting('s-rmax', 'rmax');
  bindSetting('s-hgm', 'hGm', (x) => Math.max(0, Math.min(3, +x || 0))); bindSetting('s-hmm', 'hMm', (x) => Math.max(0, Math.min(3, +x || 0)));
  bindSetting('s-hkm', 'hKm', (x) => Math.max(0, Math.min(3, +x || 0))); bindSetting('s-hround', 'hRound');
  bindSetting('s-maxfinal', 'maxFinal'); bindSetting('s-deep', 'deep'); bindSetting('s-knear', 'kNear', (x) => Math.max(5, Math.min(200, +x || 40)));
  bindSetting('s-star', 'starGm', (x) => Math.max(0, +x || 0));

  const modeHint = () => {
    $('p-mode-hint').textContent = radioVal('p-mode') === 'operativa'
      ? 'Solo tratte verificate da te o supportate da dati/fonti, senza ostacoli e non segnate come indisponibili. Se i dati non bastano, NAVCOM lo dice.'
      : 'Tutte le traiettorie matematicamente possibili fra i marker, con lo stato di ciascuna. Serve a esplorare, non a volare.';
  };
  document.querySelectorAll('input[name="p-mode"]').forEach((el) => el.addEventListener('change', modeHint));
  modeHint();
  const toggle = (name, attr) => document.querySelectorAll(`input[name="${name}"]`).forEach((el) => el.addEventListener('change', () => {
    document.querySelectorAll(`[${attr}]`).forEach((d) => { d.hidden = d.getAttribute(attr) !== radioVal(name); });
  }));
  toggle('p-src', 'data-psrc'); toggle('p-start-src', 'data-pstart');

  const pasteInto = (inp, xs, unitName) => $(inp).addEventListener('input', () => {
    const c = parseShowLocation($(inp).value);
    if (!c) return;
    document.querySelector(`input[name="${unitName}"][value="1"]`).checked = true;
    [c.x, c.y, c.z].forEach((v, i) => { $(xs[i]).value = String(v); });
  });
  pasteInto('p-paste', ['p-x', 'p-y', 'p-z'], 'p-unit');
  // il nome del punto del database resta finche' non modifichi le coordinate a mano
  for (const id of ['p-x', 'p-y', 'p-z', 'p-paste']) $(id).addEventListener('input', () => { delete $('p-x').dataset.name; });
  document.querySelectorAll('input[name="p-unit"]').forEach((el) => el.addEventListener('change', () => { delete $('p-x').dataset.name; }));

  // coordinate gia' scritte nel pianificatore -> nuova scheda nel DATABASE PUNTI (la nomini e la salvi tu)
  $('p-to-db').onclick = () => {
    const unit = radioVal('p-unit') === '1' ? 'm' : 'km';
    app.openInDatabase({ system: app.system(), unit, x: $('p-x').value, y: $('p-y').value, z: $('p-z').value, source: 'pianificatore' });
  };
  pasteInto('p-spaste', ['p-sx', 'p-sy', 'p-sz'], 'p-sunit');

  // ------------------------------------------------------------ elenchi
  async function refreshStartList() {
    const sys = $('p-start-sys').value;
    if (sys !== app.system()) await app.ensureSystemData(sys);
    const pts = [...navPoints(store, sys).values()].sort((a, b) => (b.qtValid - a.qtValid) || a.name.localeCompare(b.name));
    app.fillSelect($('p-start'), pts, $('p-start-filter').value);
  }
  $('p-start-sys').onchange = refreshStartList;
  $('p-start-filter').addEventListener('input', refreshStartList);

  function refresh() {
    const pts = app.points();
    app.fillSelect($('p-custom'), [...pts.values()].filter((p) => p.key.startsWith('cp:')));
    if (!$('p-start-sys').dataset.touched) $('p-start-sys').value = app.system();
    refreshStartList();
  }
  $('p-start-sys').addEventListener('change', () => { $('p-start-sys').dataset.touched = '1'; });

  // ------------------------------------------------------------ input
  function readInputs() {
    const system = app.system();
    let target;
    if (radioVal('p-src') === 'custom') {
      const p = app.points().get($('p-custom').value);
      if (!p) throw new Error('Nessun punto personale selezionato.');
      target = { system, pos: p.pos, name: p.name, unit: 1 };
    } else {
      const k = +radioVal('p-unit');
      target = { system, pos: vec(parseNum($('p-x').value) * k, parseNum($('p-y').value) * k, parseNum($('p-z').value) * k), name: $('p-x').dataset.name || 'P', unit: k };
    }
    let start = null;
    const src = radioVal('p-start-src');
    if (src === 'point') {
      const sys = $('p-start-sys').value;
      const p = navPoints(store, sys).get($('p-start').value);
      if (!p) throw new Error('Seleziona la partenza.');
      start = { system: sys, pos: p.pos, name: p.name, key: p.qtValid ? p.key : null };
    } else if (src === 'xyz') {
      const k = +radioVal('p-sunit');
      start = { system, pos: vec(parseNum($('p-sx').value) * k, parseNum($('p-sy').value) * k, parseNum($('p-sz').value) * k), name: 'Posizione attuale', key: null };
    }
    return {
      target, start,
      opts: {
        ...navOptions(settings), mode: radioVal('p-mode'), criterion: $('p-crit').value,
        allowTwoStage: $('p-two').checked, includeBlocked: $('p-blocked').checked, limit: +$('p-limit').value,
      },
    };
  }

  function systemPayload(sys) {
    const pts = [...navPoints(store, sys).values()];
    const meta = store.locationMeta(sys);
    const verified = [...store.verifiedPairs(sys)], unavailable = [...store.unavailablePairs(sys)];
    const model = obstructionModel(sys, settings.margin, store.locations(sys), { starRadius: (settings.starGm ?? 0.696) * 1e9 });
    return {
      version: [meta?.importedAt, settings.margin, settings.starGm, verified.join(','), unavailable.join(','), pts.length].join('#'),
      points: pts.map((p) => ({ key: p.key, name: p.name, pos: p.pos, qtValid: p.qtValid, type: p.type })),
      model, verified, unavailable,
    };
  }

  async function compute(inputs, { compareWith = null } = {}) {
    const out = $('p-out');
    out.innerHTML = '<p class="hint">Calcolo in corso…</p>';
    $('p-go').disabled = true;
    try {
      const systems = {};
      for (const sys of Object.keys(SYSTEM_NAMES)) {
        if (sys !== inputs.target.system && sys !== inputs.start?.system) await app.ensureSystemData(sys).catch(() => {});
        if (store.locations(sys).length) systems[sys] = systemPayload(sys);
      }
      const t0 = performance.now();
      const res = await runPlanner({ systems, target: inputs.target, start: inputs.start, opts: inputs.opts });
      last = { inputs, res, sel: 0, view: '3D', ms: performance.now() - t0, compareWith, model: systems[inputs.target.system]?.model };
      render();
    } catch (e) {
      out.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    } finally { $('p-go').disabled = false; }
  }

  $('p-go').onclick = () => {
    let inputs;
    try { inputs = readInputs(); } catch (e) { $('p-out').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    compute(inputs);
  };

  // ------------------------------------------------------------ resa
  const timeText = (t) => {
    if (t.total === null) return `non determinabile (mancano: ${t.missing.join(', ')})`;
    return `${fmtTime(t.total)}${t.lowerBound ? ' (limite inferiore: accelerazioni non inserite)' : ''}${t.excludes.length ? `, esclusa ${t.excludes.join(', ')}` : ''}`;
  };
  const worstText = (p) => `${fmtKm(p.residualWorst)}${p.worstIncludesReaction ? '' : ' (solo arrotondamento HUD; reazione non determinabile)'}`;

  function stepLabel(s, i) {
    if (s.kind === 'jump') return `Jump point: ${SYSTEM_NAMES[s.system]} → ${SYSTEM_NAMES[s.toSystem]}`;
    if (s.kind === 'conv') return 'Volo convenzionale';
    return `Salto ${i}: ${s.from.name} → ${s.to.name}${s.kind === 'qt-drop' ? ' (interrotto)' : ''}`;
  }

  function sheet(p, target, inputs) {
    const steps = p.steps;
    let n = 0;
    const route = steps.filter((s) => s.kind !== 'conv').map((s) => {
      if (s.kind !== 'jump') n++;
      return `<li>${ICON[s.status] ?? ''} ${esc(stepLabel(s, n))} <span class="hint">${s.kind === 'jump' ? '' : fmtKm(s.kind === 'qt-drop' ? s.travel : s.length)}${s.blocked ? ' · BLOCCATA' : ''}${s.unavailable ? ' · SEGNATA NON DISPONIBILE' : ''}</span></li>`;
    }).join('');
    const drops = steps.filter((s) => s.kind === 'qt-drop').map((s, i, arr) => `
      <div class="sub"><b>${arr.length > 1 ? `Interruzione ${i + 1}` : 'Interruzione'}: verso ${esc(s.to.name)}</b><br>
      Distanza teorica dalla destinazione QT: <b>${fmtKm(s.h0)}</b><br>
      Valore HUD da attendere: esci quando la lettura passa da <span class="big">${esc(s.hud.fromText)} → ${esc(s.hud.toText)}</span><br>
      Lettura HUD all'istante ideale: ${esc(s.hud.idealText)} · passo dell'ultima cifra ${fmtAuto(s.hud.step)} (${esc(s.hud.unitEvidence)})<br>
      Intervallo dovuto all'arrotondamento: ${fmtKm(s.hud.roundingInterval[0])} – ${fmtKm(s.hud.roundingInterval[1])} da ${esc(s.to.name)} (regola: ${esc(ROUNDING_LABEL[s.hud.rounding])})<br>
      ${s.hud.reaction ? `Con il tempo di reazione: ${fmtKm(s.hud.reaction.interval[0])} – ${fmtKm(s.hud.reaction.interval[1])} (velocità all'uscita ${fmtAuto(s.speedAtDrop)}/s, fase: ${esc(s.phaseAtDrop)})` : 'Errore aggiuntivo dovuto al tempo di reazione: <b>non determinabile</b> (mancano velocità QT e/o tempo di reazione).'}
      </div>`).join('');
    const conv = steps.find((s) => s.kind === 'conv');
    const notes = [...new Set(steps.flatMap((s) => s.notes ?? []))];
    const obsList = [...new Set(steps.flatMap((s) => (s.obstructions ?? []).map((o) => `${o.body}${o.uncertain ? ' (incerto)' : ''}`)))];
    const evid = [...new Set(steps.filter((s) => s.evidence).map((s) => `${ICON[s.status]} ${s.status} – ${EVIDENCE[s.evidence]}`))];
    return `<div class="navbox ${p.blocked ? 'bad' : p.status === STATUS.THEORETICAL ? 'warn' : ''}">
      <h3>DESTINAZIONE</h3>
      ${target.name && target.name !== 'P' ? `Punto: <b>${esc(target.name)}</b><br>` : ''}Sistema: <b>${esc(SYSTEM_NAMES[target.system] ?? target.system)}</b><br>Coordinate XYZ: <b>${esc(xyzKm(target.pos))}</b>
      <h3>PERCORSO CONSIGLIATO · ${esc(p.strategy)}</h3>
      Partenza: <b>${esc(p.departure?.name ?? '—')}</b>${inputs.start ? '' : ' <span class="hint">(scelta da NAVCOM: nessuna partenza indicata)</span>'}
      <ol>${route}</ol>
      <h3>INTERRUZIONE QT</h3>${drops}
      <h3>ARRIVO</h3>
      Coordinate teoriche: <b>${esc(xyzKm(p.arrival))}</b><br>
      Distanza residua dal bersaglio: <span class="big">${fmtKm(p.residual)}</span> (teorica) · massima stimata: <b>${worstText(p)}</b>
      ${p.residualRefined !== null ? `<br>Se dopo la prima interruzione leggi /showlocation e ricalcoli: massima ${fmtKm(p.residualRefined)}` : ''}<br>
      Tempo di volo convenzionale: <b>${conv?.time !== null && conv?.time !== undefined ? fmtTime(conv.time) + (conv.lowerBound ? ' (senza accelerazione)' : '') : 'non determinabile (manca la velocità convenzionale)'}</b><br>
      Tempo complessivo: <b>${esc(timeText(p.time))}</b>
      <h3>AFFIDABILITÀ</h3>
      Stato delle tratte:<br>${evid.map(esc).join('<br>')}<br>
      Ostacoli: ${obsList.length ? esc(obsList.join(', ')) : 'nessuno rilevato con il margine impostato'}<br>
      Limitazioni:<ul class="notes">${notes.map((t) => `<li>${esc(t)}</li>`).join('')}
        <li>Distanze geometriche dai dati ${esc(store.locationMeta(target.system)?.gameVersion ?? '')}: il raggio di ostruzione reale e la distanza di arrivo dei marker non sono pubblicati.</li></ul>
      <h3>ISTRUZIONI PER IL PILOTA</h3>
      <ol class="pilot">${pilotInstructions(p, { targetName: target.name }).reduce((acc, l) => { if (l.startsWith('   ') && acc.length) acc[acc.length - 1] += `<br><span class="hint">${esc(l.trim())}</span>`; else acc.push(esc(l)); return acc; }, []).map((h) => `<li>${h}</li>`).join('')}</ol>
    </div>`;
  }

  function render() {
    const L = last, out = $('p-out');
    const { res, inputs } = L;
    const target = inputs.target;
    const pts = [...navPoints(store, target.system).values()];
    const checks = coordinateChecks(target.pos, { points: pts, model: L.model, unitFactor: target.unit, nearest: res.nearest });
    out.innerHTML = checks.map((w) => `<p class="${w.level === 'err' ? 'err' : 'warn'}">${esc(w.text)}</p>`).join('');
    if (res.error) { out.insertAdjacentHTML('beforeend', `<p class="err">${esc(res.error)}</p>`); return; }
    const plans = res.plans;
    out.insertAdjacentHTML('beforeend', `<div class="metrics">
      <div class="metric"><span>MARKER QT</span><b>${res.stats.markers}</b></div>
      <div class="metric"><span>CANDIDATI (1 / 2 INTERRUZIONI)</span><b>${res.stats.singleCandidates.toLocaleString('it-IT')} / ${res.stats.twoStageCandidates.toLocaleString('it-IT')}</b></div>
      <div class="metric"><span>MODALITÀ</span><b>${esc(inputs.opts.mode.toUpperCase())}</b></div>
      <div class="metric"><span>CRITERIO</span><b>${esc(CRITERIA[inputs.opts.criterion])}</b></div></div>
      <p class="hint">Marker QT più vicino a P: ${res.nearest ? `${esc(res.nearest.name)} a ${fmtAuto(res.nearest.distance)}` : '—'} · calcolo ${L.ms.toFixed(0)} ms (motore ${res.stats.ms} ms)${res.interstellar ? ' · percorso interstellare' : ''}</p>`);
    if (inputs.opts.criterion === 'tempo' && plans.some((p) => p.time.total === null)) {
      out.insertAdjacentHTML('beforeend', `<p class="warn">Ordinamento per tempo incompleto: ${esc([...new Set(plans.flatMap((p) => p.time.missing))].join(', '))} non indicati in DATI E IMPOSTAZIONI. I piani senza tempo determinabile sono in fondo.</p>`);
    }
    if (L.compareWith) out.insertAdjacentHTML('beforeend', compareBox(L.compareWith, plans[0]));
    if (!plans.length) {
      out.insertAdjacentHTML('beforeend', inputs.opts.mode === 'operativa'
        ? `<p class="warn">Dati insufficienti per dichiarare una rotta praticabile in modalità operativa: nessuna combinazione usa solo tratte verificate o supportate, senza ostacoli. Prova la modalità geometrica per esplorare, poi verifica in gioco le tratte e segnale.${res.nearest ? ` Alternativa sicura: vai al marker più vicino (${esc(res.nearest.name)}, ${fmtAuto(res.nearest.distance)} da P).` : ''}</p>`
        : '<p class="warn">Nessuna tratta passa vicino a P con un\'interruzione intermedia.</p>');
      return;
    }
    const p = plans[L.sel] ?? plans[0];
    out.insertAdjacentHTML('beforeend', sheet(p, target, inputs));
    out.insertAdjacentHTML('beforeend', `<div class="radios"><label><input type="radio" name="p-view" value="3D" ${L.view === '3D' ? 'checked' : ''}> 3D</label><label><input type="radio" name="p-view" value="2D" ${L.view === '2D' ? 'checked' : ''}> 2D</label>
      <span class="hint">Colori: 🟢 verificata · 🔵 supportata · 🟠 teorica · 🔴 bloccata · tratteggio = volo convenzionale. Clic sulla legenda per mostrare/nascondere una tratta.</span></div>
      <div id="p-plot" class="plot"></div>`);
    draw(p);
    out.querySelectorAll('input[name="p-view"]').forEach((el) => el.addEventListener('change', () => { L.view = radioVal('p-view'); draw(p); }));
    // azioni sulle tratte fra marker
    const legs = p.steps.filter((s) => (s.kind === 'qt' || s.kind === 'qt-drop') && s.from.key && s.to.key);
    out.insertAdjacentHTML('beforeend', `<div class="row"><label>Nome piano<input id="p-name" value="${esc(`${p.departure?.name ?? ''} → P (${xyzKm(target.pos)})`)}"></label>
      <button id="p-save">💾 Salva piano</button></div><p id="p-msg" class="ok"></p>
      ${legs.length ? `<h3>Esito in gioco delle tratte</h3><div id="p-legs"></div>` : ''}
      <h2>Alternative</h2>`);
    for (const s of legs) {
      const d = document.createElement('div');
      d.className = 'row';
      const sys = s.system;
      const ver = s.evidence === 'gioco', una = s.unavailable;
      d.innerHTML = `<span>${esc(s.from.name)} → ${esc(s.to.name)} <span class="hint">(${esc(s.status)})</span></span>`;
      const mk = (label, fn) => { const b = Object.assign(document.createElement('button'), { className: 'small', textContent: label }); b.onclick = () => { fn(); compute(L.inputs); }; d.append(b); };
      if (!ver) mk('✔ Provata in gioco', () => { store.markVerified(s.from.key, s.to.key, sys); store.unmarkUnavailable(s.from.key, s.to.key, sys); });
      else mk('Annulla verifica', () => store.unmarkVerified(s.from.key, s.to.key, sys));
      if (!una) mk('✖ Non disponibile in gioco', () => { store.markUnavailable(s.from.key, s.to.key, sys); store.unmarkVerified(s.from.key, s.to.key, sys); });
      else mk('Annulla "non disponibile"', () => store.unmarkUnavailable(s.from.key, s.to.key, sys));
      $('p-legs').append(d);
    }
    out.append(table([
      { label: '#', get: (r) => plans.indexOf(r) + 1, num: true },
      { label: 'Strategia', get: (r) => r.strategy },
      { label: 'Partenza', get: (r) => r.departure?.name ?? '—' },
      { label: 'Salti', get: (r) => r.steps.filter((s) => s.kind !== 'conv').map((s) => (s.kind === 'jump' ? `⇢${SYSTEM_NAMES[s.toSystem]}` : s.to.name)).join(' → ') },
      { label: 'HUD uscita', get: (r) => r.steps.filter((s) => s.kind === 'qt-drop').map((s) => `${s.hud.fromText}→${s.hud.toText}`).join(' · ') },
      { label: 'Residuo teorico', get: (r) => fmtKm(r.residual), num: true },
      { label: 'Residuo massimo', get: (r) => fmtKm(r.residualWorst), num: true },
      { label: 'Tempo', get: (r) => (r.time.total === null ? 'n.d.' : fmtTime(r.time.total)), num: true },
      { label: 'Stato', get: (r) => `${ICON[r.status]} ${r.status}${r.blocked ? ' · BLOCCATA' : ''}` },
    ], plans, { selected: L.sel, onClick: (i) => { L.sel = i; render(); } }));
    $('p-save').onclick = () => {
      store.saveRoute($('p-name').value || 'Piano', target.system, planPayload(p, inputs));
      $('p-msg').textContent = 'Piano salvato in ROTTE SALVATE, con parametri e versione dei dati.';
      app.renderSaved();
    };
  }

  function draw(p) {
    const L = last;
    const target = L.inputs.target;
    const segs = [], marks = [];
    // alternative (solo la tratta interrotta), tenui
    for (const alt of L.res.plans.slice(0, 10)) {
      if (alt === p) continue;
      for (const s of alt.steps.filter((x) => x.kind === 'qt-drop' && x.system === target.system)) {
        segs.push([s.from.pos, s.to.pos, 'Alternative', '#2f6f95', { legend: false, opacity: 0.45, width: L.view === '3D' ? 2 : 1, group: 'alt' }]);
      }
    }
    let n = 0;
    for (const s of p.steps) {
      if (s.kind === 'jump') continue;
      if (s.system !== target.system) continue; // altri sistemi: frame diversi, non disegnati
      if (s.kind === 'conv') { segs.push([s.from, s.to, `Volo convenzionale ${fmtKm(s.length)}`, '#e8f4ff', { dash: 'dash' }]); continue; }
      n++;
      const color = s.blocked ? RED : STATUS_COLOR[s.status];
      segs.push([s.from.pos, s.to.pos, `Salto ${n}: ${s.from.name} → ${s.to.name} (${s.status})`, color, { dash: s.kind === 'qt-drop' ? 'solid' : 'dot' }]);
      if (s.kind === 'qt-drop') marks.push([s.dropPoint, `Interruzione ${n}`, AMBER, 'x']);
      marks.push([s.to.pos, s.to.name, color, 'square']);
    }
    const first = p.steps.find((s) => s.system === target.system && s.kind !== 'jump');
    if (first) marks.push([first.from.pos, `Partenza: ${first.from.name}`, CYAN, 'circle']);
    marks.push([target.pos, 'P', GREEN, 'star', 'top center']);
    systemPlot($('p-plot'), {
      points: [...navPoints(store, target.system).values()].filter((x) => x.qtValid),
      bodies: L.model?.bodies ?? [], mode: L.view, segments: segs, marks,
    });
  }

  function planPayload(p, inputs) {
    const meta = store.locationMeta(inputs.target.system);
    const simple = (v) => (v ? toArray(v) : null);
    return {
      type: 'plan', navcomVersion: app.VERSION,
      inputs: {
        target: { system: inputs.target.system, name: inputs.target.name, xyz_m: toArray(inputs.target.pos), unit: inputs.target.unit },
        start: inputs.start ? { system: inputs.start.system, name: inputs.start.name, key: inputs.start.key, xyz_m: toArray(inputs.start.pos) } : null,
        opts: inputs.opts,
      },
      data: { gameVersion: meta?.gameVersion ?? null, origin: meta?.origin ?? null, fetchedAt: meta?.fetchedAt ?? meta?.importedAt ?? null, obstructionMargin: settings.margin },
      result: {
        strategy: p.strategy, departure: p.departure?.name ?? null, status: p.status, evidence: p.evidence,
        residual_m: p.residual, residualWorst_m: p.residualWorst, residualRefined_m: p.residualRefined, time_s: p.time.total, qtDistance_m: p.qtDistance,
        arrival_m: simple(p.arrival),
        steps: p.steps.map((s) => ({
          kind: s.kind, system: s.system, from: s.from?.name ?? null, to: s.to?.name ?? null, length_m: s.length ?? null, status: s.status ?? null,
          ...(s.kind === 'qt-drop' ? { hudIdeal_m: s.h0, hudFrom: s.hud.fromText, hudTo: s.hud.toText, dropPoint_m: simple(s.dropPoint), roundingInterval_m: s.hud.roundingInterval } : {}),
        })),
      },
    };
  }

  function compareBox(saved, now) {
    const r = saved.payload.result;
    const row = (label, a, b) => `<tr><td>${esc(label)}</td><td>${a}</td><td>${b}</td></tr>`;
    const nowSteps = now ? now.steps.filter((s) => s.kind !== 'conv').map((s) => s.to?.name).join(' → ') : '—';
    return `<div class="navbox"><h3>CONFRONTO CON IL PIANO SALVATO "${esc(saved.name)}"</h3>
      <div class="tablewrap"><table><thead><tr><th></th><th>Originale (${esc(saved.payload.data.gameVersion ?? 'dati n.d.')})</th><th>Ricalcolato (${esc(store.locationMeta(saved.payload.inputs.target.system)?.gameVersion ?? 'dati n.d.')})</th></tr></thead><tbody>
      ${row('Partenza', esc(r.departure ?? '—'), esc(now?.departure?.name ?? '—'))}
      ${row('Salti', esc(r.steps.filter((s) => s.kind !== 'conv').map((s) => s.to).join(' → ')), esc(nowSteps))}
      ${row('Residuo teorico', fmtKm(r.residual_m), now ? fmtKm(now.residual) : '—')}
      ${row('Residuo massimo', fmtKm(r.residualWorst_m), now ? fmtKm(now.residualWorst) : '—')}
      ${row('Tempo', r.time_s === null ? 'n.d.' : fmtTime(r.time_s), now?.time.total == null ? 'n.d.' : fmtTime(now.time.total))}
      ${row('Stato', esc(r.status), esc(now?.status ?? '—'))}
      </tbody></table></div><p class="hint">Il risultato originale resta salvato invariato.</p></div>`;
  }

  /** Ricalcolo di un piano salvato con i dati attuali (il salvataggio originale non cambia). */
  async function recompute(saved) {
    const i = saved.payload.inputs;
    const inputs = {
      target: { system: i.target.system, name: i.target.name, pos: vec(...i.target.xyz_m), unit: i.target.unit ?? 1000 },
      start: i.start ? { system: i.start.system, name: i.start.name, key: i.start.key, pos: vec(...i.start.xyz_m) } : null,
      opts: i.opts,
    };
    if (app.system() !== inputs.target.system) await app.switchSystem(inputs.target.system);
    app.showTab('plan');
    await compute(inputs, { compareWith: saved });
  }

  // ------------------------------------------------------------ correzione in volo
  $('p-corr').onclick = () => {
    const out = $('p-corr-out');
    const a = parseShowLocation($('p-c1').value), b = parseShowLocation($('p-c2').value);
    let target;
    try { target = readInputs().target; } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (!a || !b) { out.innerHTML = '<p class="err">Incolla due letture nel formato "Coordinates: x:… y:… z:…".</p>'; return; }
    const c = inFlightCorrection(vec(a.x, a.y, a.z), vec(b.x, b.y, b.z), target.pos);
    if (c.angle === null) { out.innerHTML = '<p class="warn">Le due letture coincidono: vola dritto qualche secondo fra una e l\'altra.</p>'; return; }
    out.innerHTML = `<div class="navbox">Distanza da P: <b>${fmtKm(c.distance)}</b><br>
      Deviazione fra la direzione di volo e P: <span class="big">${c.angle.toFixed(1).replace('.', ',')}°</span><br>
      ${c.along > 0 ? `Proseguendo dritto passerai a <b>${fmtKm(c.closest)}</b> da P dopo altri ${fmtKm(c.along)}.` : 'Ti stai allontanando da P: inverti la rotta.'}
      <br><span class="hint">Spostamento fra le letture: ${fmtKm(c.traveled)}. Il verso della correzione (su/giù/destra/sinistra) dipende dall'orientamento della nave, che NAVCOM non conosce: correggi, rileggi, ripeti finché l'angolo scende.</span></div>`;
  };

  /**
   * CALCOLA ROTTA dal DATABASE PUNTI: sistema e XYZ letti dalla scheda, trasferiti nel modulo
   * del pianificatore e calcolati con il motore esistente (nessuna copia manuale).
   */
  async function planToPoint(pt) {
    if (app.system() !== pt.system) await app.switchSystem(pt.system);
    document.querySelector('input[name="p-src"][value="xyz"]').checked = true;
    document.querySelectorAll('[data-psrc]').forEach((d) => { d.hidden = d.dataset.psrc !== 'xyz'; });
    document.querySelector(`input[name="p-unit"][value="${pt.unit === 'm' ? 1 : 1000}"]`).checked = true;
    $('p-x').value = String(pt.x); $('p-y').value = String(pt.y); $('p-z').value = String(pt.z);
    $('p-paste').value = '';
    $('p-x').dataset.name = pt.name;
    app.showTab('plan');
    let inputs;
    try { inputs = readInputs(); } catch (e) { $('p-out').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    await compute(inputs);
  }

  return { refresh, recompute, planToPoint };
}
