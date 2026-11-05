// STAR CITIZEN NAVCOM - interfaccia web. Nessun calcolo qui: usa planner.js e core/.
import { BANDS, HALO_SOURCE } from './core/halo.js';
import { STATUS } from './core/qt.js';
import { fmtAuto, fmtKm } from './core/units.js';
import { hudText as hudFmt, hudUnit } from './core/hud.js';
import { pointAt } from './core/geometry.js';
import { distance, toArray, vec } from './core/vector.js';
import { ATTRIBUTION, fetchSystem, parsePositions } from './data/citizenhq.js';
import { bodySeed, obstructionModel } from './data/bodies.js';
import { Store } from './data/store.js';
import { haloOptions, navPoints, planToTarget, reverseFromStore } from './planner.js';
import { completePath } from './core/reverse.js';
import { CYAN, AMBER, GREEN, RED, systemPlot } from './plot.js';
import { ensurePlotly } from './plotly-loader.js';
import { initPlanner, navOptions } from './ui-plan.js';
import { initPointsDb } from './ui-points.js';

const VERSION = '0.5.6-web';
const CACHE_NAME = 'navcom-v0.5.6'; // deve coincidere con CACHE in sw.js
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { [STATUS.VERIFIED]: '🟢', [STATUS.DATA]: '🔵', [STATUS.THEORETICAL]: '🟠' };

const store = new Store();
const SETTINGS_KEY = 'navcom.settings';
const settings = (() => {
  const def = { margin: 1.2, hud: 1, speed: 0, conv: 0, system: 'stanton' };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return def; }
})();
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* opzionale */ } };

let system = settings.system;
let points = new Map();
let lastRoute = null;
let lastHalo = null;
let lastReverse = null;
let planner = null;
let pointsUi = null;

// ---------------------------------------------------------------- utilita'
function parseNum(s) {
  // accetta "1.234,5" (italiano), "1234.5", "1 234,5", "-1,2e9"
  let t = String(s).trim().replace(/[\s']/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const v = Number(t);
  if (t === '' || !Number.isFinite(v)) throw new Error(`valore non numerico: "${s}"`);
  return v;
}
const radioVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
const hudText = (m) => { const h = navOptions(settings).hud; return `${hudFmt(m, h)} (un passo dell'ultima cifra = ${fmtAuto(hudUnit(m, h).step)}; formato da collaudare, vedi PIANIFICATORE)`; };
function banner(html, cls = 'warn') { $('banner').innerHTML = html ? `<div class="${cls}">${html}</div>` : ''; }

function fillSelect(sel, items, filter = '', keep = true) {
  const prev = sel.value;
  const f = filter.trim().toLowerCase();
  sel.innerHTML = items.filter((p) => !f || p.name.toLowerCase().includes(f))
    .map((p) => `<option value="${esc(p.key)}">${esc(p.name)}${p.qtValid ? '' : '  (non QT)'}</option>`).join('');
  if (keep && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function table(cols, rows, { onClick, selected } = {}) {
  const head = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => `<tr data-i="${i}" class="${i === selected ? 'sel' : ''}">${
    cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.get(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('');
  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  if (onClick) wrap.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => onClick(+tr.dataset.i)));
  return wrap;
}

// ---------------------------------------------------------------- dati
async function loadSnapshot(sys) {
  const r = await fetch(`data/positions-${sys}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`snapshot non disponibile (HTTP ${r.status})`);
  const snap = await r.json();
  return store.replaceLocations(sys, snap.locations, snap.meta, 'snapshot del sito');
}

const snapshotTried = new Set(); // un solo tentativo automatico per sistema e sessione
async function ensureSystemData(sys) {
  if (store.locations(sys).length || snapshotTried.has(sys)) return;
  snapshotTried.add(sys);
  try {
    const n = await loadSnapshot(sys);
    if (!n) throw new Error('snapshot vuoto');
  } catch (e) {
    store.logImport({ system: sys, origin: 'snapshot del sito', ok: false, stored: 0, errors: [e.message] });
  }
}
const ensureData = () => ensureSystemData(system);

function refreshPoints() {
  points = navPoints(store, system);
  const all = [...points.values()].sort((a, b) => (b.qtValid - a.qtValid) || a.name.localeCompare(b.name));
  const meta = store.locationMeta(system);
  $('datastatus').textContent = meta
    ? `${store.locations(system).length} posizioni · dati ${meta.gameVersion ?? 'versione n.d.'} · ${meta.origin} ${(meta.fetchedAt ?? meta.importedAt ?? '').slice(0, 10)}`
    : 'nessun dato';
  if (!store.locations(system).length) {
    banner(`Nessuna posizione in archivio per ${esc(system)}. Vai in <b>DATI E IMPOSTAZIONI</b> e premi "Aggiorna live da CitizenHQ" oppure importa un file.`);
  } else if (!store.persistent) {
    banner('Il browser non consente di salvare dati (navigazione privata?): punti e rotte andranno persi alla chiusura.');
  } else banner('');
  fillSelect($('r-start'), all, $('r-start-filter').value);
  fillSelect($('r-dest'), all.filter((p) => !p.key.startsWith('cp:')), $('r-dest-filter').value);
  const cps = all.filter((p) => p.key.startsWith('cp:'));
  fillSelect($('r-custom'), cps);
  fillSelect($('v-custom'), cps);
  fillSelect($('v-start'), all, $('v-start-filter').value);
  $('r-custom-empty').hidden = cps.length > 0;
  const qt = all.filter((p) => p.qtValid);
  fillSelect($('h-start'), qt, $('h-start-filter').value);
  fillSelect($('h-dest'), qt);
  renderPoints(); renderSaved(); renderData();
  planner?.refresh();
}


// ---------------------------------------------------------------- RICERCA INVERSA QT
const km = (m) => (m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 });
const xyzKm = (v) => `${km(v.x)} / ${km(v.y)} / ${km(v.z)}`;

function reverseTarget() {
  if (radioVal('v-src') === 'custom') {
    const p = points.get($('v-custom').value);
    if (!p) throw new Error('Nessun punto personale selezionato.');
    return { pos: p.pos, name: p.name };
  }
  const k = +radioVal('v-unit');
  return { pos: vec(parseNum($('v-x').value) * k, parseNum($('v-y').value) * k, parseNum($('v-z').value) * k), name: 'Punto P' };
}

function reverseStart() {
  if (!$('v-use-start').checked) return null;
  if (radioVal('v-start-src') === 'point') {
    const p = points.get($('v-start').value);
    if (!p) throw new Error('Seleziona la tua posizione.');
    return { key: p.qtValid ? p.key : null, name: p.name, pos: p.pos };
  }
  const k = +radioVal('v-sunit');
  return { key: null, name: 'La mia posizione', pos: vec(parseNum($('v-sx').value) * k, parseNum($('v-sy').value) * k, parseNum($('v-sz').value) * k) };
}

function calcReverse() {
  const out = $('v-out');
  let target, start;
  try { target = reverseTarget(); start = reverseStart(); } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const t0 = performance.now();
  const res = reverseFromStore(store, system, target.pos, settings.margin, { includeBlocked: $('v-blocked').checked, limit: 300 });
  let path = null;
  if (start) {
    const mr = $('v-maxres').value.trim();
    path = completePath(start, res.routes, res.model, {
      qtSpeed: settings.speed * 1e6, convSpeed: settings.conv, maxResidual: mr ? parseNum(mr) * 1000 : Infinity,
    });
  }
  lastReverse = { target, start, res, path, sel: 0, ms: performance.now() - t0, view: '3D' };
  renderReverse();
}

function renderReverse() {
  const L = lastReverse, out = $('v-out');
  if (!L) return;
  const { res, target } = L;
  const n = +$('v-limit').value;
  const rows = res.routes.slice(0, n);
  out.innerHTML = res.warnings.map((w) => `<p class="${w.level === 'err' ? 'err' : 'warn'}">${esc(w.text)}</p>`).join('');
  out.insertAdjacentHTML('beforeend', `<div class="metrics">
    <div class="metric"><span>MARKER QT DEL SISTEMA</span><b>${res.qtCount}</b></div>
    <div class="metric"><span>TRATTE ESAMINATE (A→B e B→A)</span><b>${res.examined.toLocaleString('it-IT')}</b></div>
    <div class="metric"><span>CON INTERRUZIONE UTILE</span><b>${res.total.toLocaleString('it-IT')}</b></div>
    ${rows.length ? `<div class="metric"><span>MIGLIOR RESIDUO</span><b>${fmtAuto(rows[0].residual)}</b></div>` : ''}</div>
    <p class="hint">P = ${esc(xyzKm(target.pos))} km · marker QT più vicino: ${res.nearestMarker ? `${esc(res.nearestMarker.point.name)} a ${fmtAuto(res.nearestMarker.distance)}` : '—'}
    · ${res.blocked.toLocaleString('it-IT')} tratte scartate perché bloccate da corpi celesti · calcolo ${L.ms.toFixed(0)} ms</p>`);
  if (!res.qtCount) { out.insertAdjacentHTML('beforeend', '<p class="warn">Nessun marker QT in archivio per questo sistema: importa i dati in DATI E IMPOSTAZIONI.</p>'); return; }
  if (!rows.length) { out.insertAdjacentHTML('beforeend', '<p class="warn">Nessuna tratta passa vicino al punto con un\'interruzione intermedia. L\'opzione migliore è andare al marker più vicino indicato sopra e proseguire in volo convenzionale.</p>'); return; }

  out.insertAdjacentHTML('beforeend', '<h2>Rotte che passano più vicine a P</h2>');
  out.append(table([
    { label: '#', get: (r) => rows.indexOf(r) + 1, num: true },
    { label: 'Partenza QT (A)', get: (r) => r.from.name },
    { label: 'Destinazione QT (B)', get: (r) => r.to.name },
    { label: 'Tratta totale', get: (r) => fmtKm(r.legLength), num: true },
    { label: 'A → interruzione', get: (r) => fmtKm(r.fromStart), num: true },
    { label: 'HUD verso B', get: (r) => fmtKm(r.hudRemaining), num: true },
    { label: 'Interruzione X / Y / Z (km)', get: (r) => xyzKm(r.dropPoint) },
    { label: 'Residuo verso P', get: (r) => fmtKm(r.residual), num: true },
    { label: 'Stato', get: (r) => `${ICON[r.status]} ${r.status}${r.blocked ? ' · BLOCCATA' : ''}` },
  ], rows, { selected: L.sel < rows.length ? L.sel : -1, onClick: (i) => { L.sel = i; L.selPath = null; renderReverse(); } }));

  let x = rows[L.sel] ?? rows[0];
  if (L.path) {
    out.insertAdjacentHTML('beforeend', `<h2>Percorso completo da ${esc(L.start.name)}</h2>
      <p class="hint">${L.path.length && L.path[0].time !== null ? 'Ordinato per tempo stimato (velocità costanti, nessuna accelerazione).' : 'Ordinato per distanza QT totale (posizione → A → interruzione). Inserisci le velocità per ordinare per tempo.'}</p>`);
    const prow = L.path.slice(0, n);
    if (!prow.length) out.insertAdjacentHTML('beforeend', '<p class="warn">Nessuna rotta rispetta il residuo massimo indicato, oppure il salto verso A risulta bloccato.</p>');
    else {
      out.append(table([
        { label: '#', get: (r) => prow.indexOf(r) + 1, num: true },
        { label: 'Salta a A', get: (r) => (r.toA ? `${r.from.name} (${fmtAuto(r.toA)})` : `${r.from.name} (sei già lì)`) },
        { label: 'poi verso B', get: (r) => r.to.name },
        { label: 'HUD verso B', get: (r) => fmtKm(r.hudRemaining), num: true },
        { label: 'QT totale', get: (r) => fmtAuto(r.qtTotal), num: true },
        { label: 'Residuo verso P', get: (r) => fmtKm(r.residual), num: true },
        { label: 'Tempo stimato', get: (r) => (r.time === null ? '—' : `${Math.floor(r.time / 60)}m ${Math.round(r.time % 60)}s`), num: true },
        { label: 'Stato', get: (r) => `${ICON[r.pathStatus]} ${r.pathStatus}` },
      ], prow, { selected: L.selPath ?? -1, onClick: (i) => { L.selPath = i; renderReverse(); } }));
      if (L.selPath !== null && L.selPath !== undefined) x = prow[L.selPath];
    }
  }

  const cls = x.blocked ? 'bad' : x.status === STATUS.THEORETICAL ? 'warn' : '';
  const steps = [];
  if (L.start && x.toA !== undefined && x.toA > 0) steps.push(`Da <b>${esc(L.start.name)}</b> salta in QT verso <b>${esc(x.from.name)}</b> (${fmtKm(x.toA)})`);
  steps.push(`Da <b>${esc(x.from.name)}</b> (A) imposta la destinazione QT <b>${esc(x.to.name)}</b> (B) e salta: tratta di ${fmtKm(x.legLength)}`);
  steps.push(`Interrompi quando la distanza verso ${esc(x.to.name)} è <span class="big">${fmtKm(x.hudRemaining)}</span><br>lettura HUD attesa: ${hudText(x.hudRemaining)}<br>(avrai percorso ${fmtKm(x.fromStart)} da A)`);
  steps.push(`Punto di interruzione teorico: X ${km(x.dropPoint.x)} · Y ${km(x.dropPoint.y)} · Z ${km(x.dropPoint.z)} km`);
  steps.push(`Volo convenzionale fino a P: <b>${fmtKm(x.residual)}</b>`);
  const st = x.pathStatus ?? x.status;
  out.insertAdjacentHTML('beforeend', `<div class="navbox ${cls}">${ICON[st]} <b>${esc(st)}</b>
    <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>${[...x.notes, ...(x.pathNotes ?? [])].map((t) => `⚠ ${esc(t)}<br>`).join('')}</div>
    <p class="hint">Rotta geometrica: "Supportata" significa marker QT da fonte dati e nessun ostacolo noto, non che il salto sia garantito in gioco. Le distanze non includono il tempo di reazione né la decelerazione del QT.</p>
    <div class="radios"><label><input type="radio" name="v-view" value="3D" ${L.view === '3D' ? 'checked' : ''}> 3D</label><label><input type="radio" name="v-view" value="2D" ${L.view === '2D' ? 'checked' : ''}> 2D</label></div>
    <div id="v-plot" class="plot"></div>
    <div class="row"><label>Nome rotta<input id="v-name" value="${esc(`${x.from.name} → ${x.to.name} verso ${target.name}`)}"></label>
      <button id="v-save">💾 Salva rotta</button>${x.status !== STATUS.VERIFIED ? '<button id="v-verify">✔ Ho provato A → B in gioco</button>' : ''}</div><p id="v-msg" class="ok"></p>`);
  const draw = () => {
    const top = rows.slice(0, 10);
    const seen = new Set();
    const segs = [];
    for (const r of top) {
      const k = [r.from.key, r.to.key].sort().join('|');
      if (seen.has(k) || r === x) continue;
      seen.add(k);
      segs.push([r.from.pos, r.to.pos, `${r.from.name} – ${r.to.name}`, '#2f6f95', { legend: false, opacity: 0.6, width: L.view === '3D' ? 3 : 1 }]);
    }
    segs.push([x.from.pos, x.to.pos, 'Tratta scelta A→B', CYAN]);
    segs.push([x.dropPoint, target.pos, 'Volo convenzionale', GREEN]);
    const marks = [[x.from.pos, 'A', CYAN, 'circle'], [x.to.pos, 'B', CYAN, 'square'], [x.dropPoint, 'Interruzione', AMBER, 'x'], [target.pos, 'P', GREEN, 'star', 'top center']];
    if (L.start && x.toA) { segs.push([L.start.pos, x.from.pos, 'Salto verso A', '#b48cff']); marks.push([L.start.pos, 'Io', '#b48cff', 'diamond']); }
    systemPlot($('v-plot'), { points: [...points.values()].filter((p) => p.qtValid), bodies: res.model.bodies, mode: L.view, segments: segs, marks });
  };
  draw();
  out.querySelectorAll('input[name="v-view"]').forEach((el) => el.addEventListener('change', () => { L.view = radioVal('v-view'); draw(); }));
  $('v-save').onclick = () => {
    store.saveRoute($('v-name').value || 'Ricerca inversa', system, {
      type: 'reverse', target: { name: target.name, xyz_m: toArray(target.pos) },
      a: { key: x.from.key, name: x.from.name, xyz_m: toArray(x.from.pos) }, b: { key: x.to.key, name: x.to.name, xyz_m: toArray(x.to.pos) },
      legLength_m: x.legLength, fromA_m: x.fromStart, hudRemaining_m: x.hudRemaining, dropPoint_m: toArray(x.dropPoint),
      residual_m: x.residual, status: x.status, notes: x.notes,
      start: L.start ? { name: L.start.name, xyz_m: toArray(L.start.pos), toA_m: x.toA ?? null } : null,
      obstructionMargin: settings.margin, dataVersion: store.locationMeta(system)?.gameVersion ?? null,
    });
    $('v-msg').textContent = 'Rotta salvata.'; renderSaved();
  };
  if ($('v-verify')) $('v-verify').onclick = () => { store.markVerified(x.from.key, x.to.key, system); calcReverse(); };
}

// ---------------------------------------------------------------- ROTTA
function currentTarget() {
  const mode = radioVal('r-mode');
  if (mode === 'official') { const p = points.get($('r-dest').value); return p && { pos: p.pos, name: p.name }; }
  if (mode === 'custom') { const p = points.get($('r-custom').value); return p && { pos: p.pos, name: p.name }; }
  if (mode === 'xyz') {
    const k = +radioVal('r-unit');
    return { pos: vec(parseNum($('r-x').value) * k, parseNum($('r-y').value) * k, parseNum($('r-z').value) * k), name: 'Coordinate personalizzate' };
  }
  return null;
}

function calcRoute() {
  const start = points.get($('r-start').value);
  let target;
  try { target = currentTarget(); } catch (e) { $('r-out').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  if (!start || !target) { $('r-out').innerHTML = '<p class="warn">Seleziona una partenza e una destinazione valide.</p>'; return; }
  const { results, model } = planToTarget(store, system, start, target.pos, settings.margin, $('r-blocked').checked);
  lastRoute = { start, target, results, model, sel: 0 };
  renderRoute();
}

function renderRoute() {
  const out = $('r-out');
  const R = lastRoute;
  if (!R) return;
  const direct = distance(R.start.pos, R.target.pos);
  out.innerHTML = `<div class="metrics">
    <div class="metric"><span>VOLO CONVENZIONALE DIRETTO</span><b>${fmtAuto(direct)}</b></div>
    <div class="metric"><span>TRATTE QT UTILI</span><b>${R.results.length}</b></div>
    ${R.results.length ? `<div class="metric"><span>MIGLIOR RESIDUO</span><b>${fmtAuto(R.results[0].residual)}</b></div>` : ''}</div>`;
  if (!R.results.length) {
    out.insertAdjacentHTML('beforeend', '<p class="warn">Nessuna tratta QT dai marker noti avvicina il bersaglio. Unica opzione: volo convenzionale.</p>');
    return;
  }
  const rows = R.results.slice(0, 60);
  out.append(table([
    { label: '#', get: (r) => rows.indexOf(r) + 1, num: true },
    { label: 'Stato', get: (r) => `${ICON[r.status]} ${r.status}` },
    { label: 'Destinazione QT', get: (r) => r.dest.name },
    { label: 'Interrompi a (HUD)', get: (r) => (r.needsDrop ? fmtKm(r.hudRemaining) : '— arrivo'), num: true },
    { label: 'Distanza QT', get: (r) => fmtAuto(r.qtTravel), num: true },
    { label: 'Residuo', get: (r) => fmtAuto(r.residual), num: true },
    { label: 'Risparmio', get: (r) => fmtAuto(r.gain), num: true },
    { label: 'Ostacoli', get: (r) => r.obstructions.map((o) => o.body).join(', ') || '—' },
  ], rows, { selected: R.sel, onClick: (i) => { R.sel = i; renderRoute(); } }));
  const x = rows[R.sel];
  const cls = x.blocked ? 'bad' : x.status === STATUS.THEORETICAL ? 'warn' : '';
  const steps = [
    `Partenza: <b>${esc(x.start.name)}</b>`,
    `Imposta destinazione QT <b>${esc(x.dest.name)}</b> e salta (tratta ${fmtKm(x.legLength)})`,
    x.needsDrop
      ? `Interrompi il salto quando la distanza verso ${esc(x.dest.name)} è <span class="big">${fmtKm(x.hudRemaining)}</span><br>lettura HUD attesa: ${hudText(x.hudRemaining)}`
      : 'Nessuna interruzione: completa il salto',
    `Volo convenzionale verso <b>${esc(R.target.name)}</b>: ${fmtKm(x.residual)}`,
  ];
  const speedNote = settings.speed > 0 && x.needsDrop
    ? `<p class="hint">Stima a velocità costante di ${settings.speed} Mm/s: 1 s di ritardo all'interruzione sposta il punto di ~${fmtAuto(settings.speed * 1e6)}.</p>` : '';
  out.insertAdjacentHTML('beforeend', `<div class="navbox ${cls}">${ICON[x.status]} <b>${esc(x.status)}</b>
    <ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>${x.notes.map((n) => `⚠ ${esc(n)}<br>`).join('')}</div>
    <p class="hint">Distanze geometriche calcolate dai dati. Non includono il tempo di reazione, la decelerazione del QT né la distanza di arrivo del marker.</p>${speedNote}
    <div class="radios"><label><input type="radio" name="r-view" value="2D" checked> 2D</label><label><input type="radio" name="r-view" value="3D"> 3D</label></div>
    <div id="r-plot" class="plot"></div>
    <div class="row"><label>Nome rotta<input id="r-name" value="${esc(`${x.start.name} → ${R.target.name}`)}"></label>
      <button id="r-save">💾 Salva rotta</button>${x.status !== STATUS.VERIFIED ? '<button id="r-verify">✔ Ho provato questa tratta in gioco</button>' : ''}</div>
    <p id="r-msg" class="ok"></p>`);
  const draw = () => systemPlot($('r-plot'), {
    points: [...points.values()], bodies: R.model.bodies, mode: radioVal('r-view'),
    segments: [[x.start.pos, x.dest.pos, 'Tratta QT', CYAN], [x.dropPoint, R.target.pos, 'Volo convenzionale', GREEN]],
    marks: [[x.start.pos, 'Partenza', CYAN, 'circle'], [x.dropPoint, 'Interruzione', AMBER, 'x'], [R.target.pos, 'Bersaglio', GREEN, 'star', 'top center']],
  });
  draw();
  out.querySelectorAll('input[name="r-view"]').forEach((el) => el.addEventListener('change', draw));
  $('r-save').onclick = () => {
    store.saveRoute($('r-name').value || 'Rotta', system, {
      type: 'qt', start: { key: x.start.key, name: x.start.name, xyz_m: toArray(x.start.pos) },
      qtDest: { key: x.dest.key, name: x.dest.name, xyz_m: toArray(x.dest.pos) },
      target: { name: R.target.name, xyz_m: toArray(R.target.pos) }, dropPoint_m: toArray(x.dropPoint),
      hudRemaining_m: x.hudRemaining, qtTravel_m: x.qtTravel, residual_m: x.residual, legLength_m: x.legLength,
      status: x.status, notes: x.notes, obstructionMargin: settings.margin, dataVersion: store.locationMeta(system)?.gameVersion ?? null,
    });
    $('r-msg').textContent = 'Rotta salvata.'; renderSaved();
  };
  if ($('r-verify')) $('r-verify').onclick = () => { store.markVerified(x.start.key, x.dest.key, system); calcRoute(); };
}

// ---------------------------------------------------------------- AARON HALO
function bandInfo() {
  const b = BANDS[+$('h-band').value];
  $('h-band-val').textContent = b.number;
  $('h-band-info').textContent = `Fascia ${b.number}: ${fmtKm(b.inner)} – ${fmtKm(b.outer)} dal centro di Stanton, picco ${fmtKm(b.peak)}, semi-altezza ±${fmtKm(b.halfHeight)}.`;
  $('h-credit').innerHTML = `Fasce: ${esc(HALO_SOURCE)}. Metodo alternativo sempre valido: nella Starmap guarda la distanza dal marker di Stanton ed esci a ${fmtKm(b.peak)}.`;
}

function calcHalo() {
  if (system !== 'stanton') { $('h-out').innerHTML = "<p class=\"warn\">L'Aaron Halo è in Stanton: seleziona Stanton in alto.</p>"; return; }
  const start = points.get($('h-start').value);
  if (!start) return;
  const band = +$('h-band').value;
  const destKey = radioVal('h-which') === 'pick' ? $('h-dest').value : null;
  lastHalo = { start, band, opts: haloOptions(store, start, band, settings.margin, destKey), sel: 0 };
  renderHalo();
}

function renderHalo() {
  const H = lastHalo, out = $('h-out');
  if (!H) return;
  if (!H.opts.length) { out.innerHTML = '<p class="warn">Nessuna tratta da questa partenza attraversa la fascia scelta entro la sua altezza.</p>'; return; }
  out.innerHTML = '';
  const rows = H.opts.slice(0, 50);
  const cols = [
    { label: 'Stato', get: (o) => `${ICON[o.status]} ${o.status}` },
    { label: 'Destinazione QT', get: (o) => o.dest.name },
    { label: 'HUD ingresso', get: (o) => fmtKm(o.crossing.enterHud), num: true },
    { label: 'HUD picco', get: (o) => (o.crossing.peakHud === null ? '—' : fmtKm(o.crossing.peakHud)), num: true },
    { label: 'HUD uscita', get: (o) => fmtKm(o.crossing.exitHud), num: true },
    { label: 'Finestra', get: (o) => fmtAuto(o.crossing.window), num: true },
    { label: 'z (km)', get: (o) => Math.round(o.crossing.zEnter / 1000).toLocaleString('it-IT'), num: true },
  ];
  if (settings.speed > 0) cols.push({ label: 'Finestra s (stima)', get: (o) => (o.crossing.window / (settings.speed * 1e6)).toFixed(1), num: true });
  out.append(table(cols, rows, { selected: H.sel, onClick: (i) => { H.sel = i; renderHalo(); } }));
  const o = rows[H.sel], c = o.crossing;
  const aim = c.peakHud ?? (c.enterHud + c.exitHud) / 2;
  out.insertAdjacentHTML('beforeend', `<div class="navbox ${o.status === STATUS.THEORETICAL ? 'warn' : ''}">
    Imposta destinazione <b>${esc(o.dest.name)}</b> e salta.<br>
    Entri nella fascia ${H.band} a <b>${fmtKm(c.enterHud)}</b> e ne esci a <b>${fmtKm(c.exitHud)}</b>.<br>
    ${c.peakHud === null ? 'Centro della finestra' : 'Bersaglio (picco di densità)'}: <span class="big">${fmtKm(aim)}</span><br>
    Lettura HUD attesa: ${hudText(aim)}<br>${o.notes.map((n) => `⚠ ${esc(n)}`).join('<br>')}</div>
    <div class="radios"><label><input type="radio" name="h-view" value="2D" checked> 2D</label><label><input type="radio" name="h-view" value="3D"> 3D</label></div>
    <div id="h-plot" class="plot"></div>
    <button id="h-save">💾 Salva questa interruzione</button><span id="h-msg" class="ok"></span>`);
  const b = BANDS[H.band];
  const draw = () => systemPlot($('h-plot'), {
    points: [...points.values()].filter((p) => p.qtValid), bodies: obstructionModel('stanton', settings.margin, store.locations('stanton')).bodies,
    mode: radioVal('h-view'),
    segments: [[o.start.pos, o.dest.pos, 'Tratta QT', CYAN]],
    marks: [[o.start.pos, 'Partenza', CYAN, 'circle'], [pointAt(o.start.pos, o.dest.pos, c.tEnter), 'Ingresso', GREEN, 'triangle-up'],
      [pointAt(o.start.pos, o.dest.pos, c.tExit), 'Uscita', RED, 'triangle-down']],
    rings: [[b.inner, `Fascia ${b.number} interno`], [b.outer, `Fascia ${b.number} esterno`]],
  });
  draw();
  out.querySelectorAll('input[name="h-view"]').forEach((el) => el.addEventListener('change', draw));
  $('h-save').onclick = () => {
    store.saveRoute(`Halo F${H.band}: ${o.start.name} → ${o.dest.name}`, 'stanton', {
      type: 'aaron_halo', band: H.band, start: o.start.name, qtDest: o.dest.name,
      enterHud_m: c.enterHud, peakHud_m: c.peakHud, exitHud_m: c.exitHud, window_m: c.window, status: o.status, bandSource: HALO_SOURCE,
    });
    $('h-msg').textContent = ' Salvata.'; renderSaved();
  };
}

// ---------------------------------------------------------------- PUNTI / ROTTE
function renderPoints() {
  const sms = store.starmapReadings(system);
  $('sm-list').innerHTML = sms.length ? '' : '<p class="hint">Nessuna lettura.</p>';
  for (const s of sms) {
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<b>${esc(s.name)}</b> <span class="hint">${esc(s.createdAt)}</span><pre>${esc(Object.values(s.raw).join('\n'))}${s.notes ? `\n— ${esc(s.notes)}` : ''}</pre>`;
    const del = Object.assign(document.createElement('button'), { className: 'small danger', textContent: 'Elimina' });
    del.onclick = () => { store.deleteStarmapReading(s.id); renderPoints(); };
    d.append(del); $('sm-list').append(d);
  }
}

function renderSaved() {
  const list = store.savedRoutes(system);
  const el = $('saved-list');
  el.innerHTML = list.length ? '' : '<p class="hint">Nessuna rotta salvata per questo sistema.</p>';
  for (const r of list) {
    const p = r.payload;
    let text = '';
    if (p.type === 'reverse') text = `Da <b>${esc(p.a.name)}</b> salta verso <b>${esc(p.b.name)}</b>, interrompi a <b>${fmtKm(p.hudRemaining_m)}</b> dall'arrivo, poi volo convenzionale per ${fmtKm(p.residual_m)} fino a ${esc(p.target.name)}. Stato: ${esc(p.status)}`;
    else if (p.type === 'qt') text = `Salta verso <b>${esc(p.qtDest.name)}</b>, interrompi a <b>${fmtKm(p.hudRemaining_m)}</b>, poi volo convenzionale per ${fmtKm(p.residual_m)}. Stato: ${esc(p.status)}`;
    else if (p.type === 'plan') {
      const r0 = p.result;
      text = `${esc(r0.strategy)} da <b>${esc(r0.departure ?? '—')}</b>: ${r0.steps.filter((x) => x.kind !== 'conv').map((x) => esc(x.to)).join(' → ')}; residuo teorico ${fmtKm(r0.residual_m)}, massimo ${fmtKm(r0.residualWorst_m)}. Stato: ${esc(r0.status)}. Dati ${esc(p.data.gameVersion ?? 'n.d.')}, NAVCOM ${esc(p.navcomVersion)}.`;
    }
    else if (p.type === 'aaron_halo') text = `Fascia ${p.band}: salta verso <b>${esc(p.qtDest)}</b> e interrompi fra ${fmtKm(p.enterHud_m)} e ${fmtKm(p.exitHud_m)}${p.peakHud_m ? ` (picco ${fmtKm(p.peakHud_m)})` : ''}`;
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<b>${esc(r.name)}</b> <span class="hint">${esc(r.createdAt)}</span><br>${text}<details><summary class="hint">dati completi</summary><pre>${esc(JSON.stringify(p, null, 1))}</pre></details>`;
    if (p.type === 'plan') {
      const re = Object.assign(document.createElement('button'), { className: 'small', textContent: '↻ Ricalcola con i dati attuali' });
      re.onclick = () => planner.recompute(r);
      d.append(re);
    }
    const del = Object.assign(document.createElement('button'), { className: 'small danger', textContent: 'Elimina' });
    del.onclick = () => { store.deleteRoute(r.id); renderSaved(); };
    d.append(del); el.append(d);
  }
}

// ---------------------------------------------------------------- DATI
function renderData() {
  const f = $('d-filter').value.trim().toLowerCase();
  const rows = store.locations(system).filter((r) => !f || r.name.toLowerCase().includes(f));
  const meta = store.locationMeta(system);
  const t = table([
    { label: 'Nome', get: (r) => r.name }, { label: 'Tipo', get: (r) => r.type }, { label: 'QT', get: (r) => (r.qtValid ? 'sì' : 'no') },
    { label: 'X (km)', get: (r) => (r.x / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 }), num: true },
    { label: 'Y (km)', get: (r) => (r.y / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 }), num: true },
    { label: 'Z (km)', get: (r) => (r.z / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 }), num: true },
  ], rows);
  t.classList.add('tall');
  $('d-table').replaceWith(t); t.id = 'd-table';
  const log = table([
    { label: 'Quando', get: (l) => l.at }, { label: 'Sistema', get: (l) => l.system }, { label: 'Origine', get: (l) => l.origin },
    { label: 'Esito', get: (l) => (l.ok ? 'ok' : 'ERRORE') }, { label: 'Salvate', get: (l) => l.stored, num: true },
    { label: 'Versione', get: (l) => l.gameVersion ?? '' }, { label: 'Dettagli', get: (l) => [...(l.errors ?? []), ...(l.warnings ?? [])].join('; ') },
  ], store.data.importLog);
  $('d-log').replaceWith(log); log.id = 'd-log';
  const seed = bodySeed(system);
  const disc = seed ? obstructionModel(system, settings.margin, store.locations(system)).discrepancies ?? [] : [];
  $('d-sources').innerHTML = `<p>Posizioni: ${esc(ATTRIBUTION)}${meta ? `. Versione dei dati: ${esc(meta.gameVersion ?? 'n.d.')}, scaricati il ${esc(meta.fetchedAt ?? '')}, origine: ${esc(meta.origin)}.` : '.'}</p>
    <p>Corpi celesti per gli ostacoli: ${seed ? `${esc(seed._meta.source)}. Conflitti noti: ${esc(seed._meta.known_conflicts.join('; '))}${disc.length ? `. Posizioni non concordi con i dati importati (si usa quella importata, la vecchia resta come ostacolo incerto): ${esc(disc.map((d) => `${d.name} ${Math.round(d.offset / 1e3).toLocaleString('it-IT')} km`).join(', '))}` : ''}` : '<b>nessun dato per questo sistema: tutte le tratte risultano "Teoriche".</b>'}</p>
    <p>Fasce dell'Aaron Halo: ${esc(HALO_SOURCE)}.</p>
    <p>Legenda: 🟢 verificata nel gioco (la segni tu) · 🔵 supportata dai dati (marker QT da fonte, nessun ostacolo noto) · 🟠 teorica, da verificare.</p>`;
}

async function liveUpdate() {
  $('d-msg').textContent = `Scarico ${system} da CitizenHQ…`;
  const r = await fetchSystem(system, { retries: 2 });
  if (r.ok && r.locations.length) {
    store.replaceLocations(system, r.locations, r.meta, 'CitizenHQ live');
    $('d-msg').innerHTML = `<span class="ok">${r.locations.length} posizioni aggiornate (versione ${esc(r.meta.gameVersion ?? 'n.d.')}). Scartate: ${r.meta.skippedNoCoords} senza coordinate, ${r.meta.skippedInvalid} non valide.</span>`;
  } else {
    store.logImport({ system, origin: 'CitizenHQ live', ok: false, stored: 0, errors: r.errors, warnings: r.warnings });
    $('d-msg').innerHTML = `<span class="err">Aggiornamento fallito, i dati precedenti restano: ${esc(r.errors.join('; '))}</span>`;
  }
  refreshPoints();
}

function readFile(input, cb) {
  const f = input.files?.[0];
  if (!f) return;
  f.text().then(cb).catch((e) => { $('d-msg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }).finally(() => { input.value = ''; });
}

// ---------------------------------------------------------------- avvio
function bind() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('system').value = system;
  $('system').onchange = () => switchSystem($('system').value);
  document.querySelectorAll('input[name="r-mode"]').forEach((el) => el.addEventListener('change', () => {
    const m = radioVal('r-mode');
    document.querySelectorAll('[data-mode]').forEach((d) => { d.hidden = d.dataset.mode !== m; });
    $('r-go').disabled = m === 'starmap';
  }));
  for (const [inp, sel, pick] of [['r-start-filter', 'r-start', () => [...points.values()]],
    ['r-dest-filter', 'r-dest', () => [...points.values()].filter((p) => !p.key.startsWith('cp:'))],
    ['h-start-filter', 'h-start', () => [...points.values()].filter((p) => p.qtValid)]]) {
    $(inp).addEventListener('input', () => fillSelect($(sel), pick().sort((a, b) => (b.qtValid - a.qtValid) || a.name.localeCompare(b.name)), $(inp).value));
  }
  $('r-go').onclick = calcRoute;
  $('v-go').onclick = calcReverse;
  $('v-limit').onchange = () => renderReverse();
  document.querySelectorAll('input[name="v-src"]').forEach((el) => el.addEventListener('change', () => {
    document.querySelectorAll('[data-vsrc]').forEach((d) => { d.hidden = d.dataset.vsrc !== radioVal('v-src'); });
  }));
  document.querySelectorAll('input[name="v-start-src"]').forEach((el) => el.addEventListener('change', () => {
    document.querySelectorAll('[data-vstart]').forEach((d) => { d.hidden = d.dataset.vstart !== radioVal('v-start-src'); });
  }));
  $('v-use-start').onchange = () => { $('v-start-box').hidden = !$('v-use-start').checked; };
  $('v-start-filter').addEventListener('input', () => fillSelect($('v-start'), [...points.values()].sort((a, b) => (b.qtValid - a.qtValid) || a.name.localeCompare(b.name)), $('v-start-filter').value));
  $('v-conv').value = settings.conv || '';
  $('v-conv').onchange = () => { settings.conv = Math.max(0, +$('v-conv').value || 0); saveSettings(); };
  $('h-band').oninput = bandInfo;
  document.querySelectorAll('input[name="h-which"]').forEach((el) => el.addEventListener('change', () => { $('h-dest').hidden = radioVal('h-which') !== 'pick'; }));
  $('h-go').onclick = calcHalo;
  $('cp-go-db').onclick = () => showTab('db');
  $('sm-save').onclick = () => {
    const name = $('sm-name').value.trim();
    if (!name) return alert('Inserisci un nome per la lettura.');
    const raw = Object.fromEntries($('sm-raw').value.split('\n').filter((l) => l.trim()).map((l, i) => [`riga_${i + 1}`, l]));
    store.addStarmapReading({ name, system, raw, notes: $('sm-notes').value });
    $('sm-name').value = $('sm-raw').value = $('sm-notes').value = '';
    renderPoints();
  };
  $('d-filter').oninput = renderData;
  $('d-live').onclick = liveUpdate;
  $('d-snapshot').onclick = async () => {
    try { const n = await loadSnapshot(system); $('d-msg').innerHTML = `<span class="ok">${n} posizioni dallo snapshot.</span>`; }
    catch (e) { store.logImport({ system, origin: 'snapshot del sito', ok: false, stored: 0, errors: [e.message] }); $('d-msg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    refreshPoints();
  };
  $('d-file').onchange = () => readFile($('d-file'), (text) => {
    const json = JSON.parse(text);
    const payload = json.locations ? json.locations : json; // accetta anche uno snapshot NAVCOM
    const { locations, report } = parsePositions(payload, system);
    store.replaceLocations(system, locations, { gameVersion: json.meta?.gameVersion ?? null, fetchedAt: json.meta?.fetchedAt ?? null, ...report }, 'file importato');
    $('d-msg').innerHTML = `<span class="ok">${locations.length} posizioni importate da file.</span>`;
    refreshPoints();
  });
  $('d-export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    a.download = `navcom-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('d-import').onchange = () => readFile($('d-import'), (text) => { store.importJson(text); $('d-msg').innerHTML = '<span class="ok">Backup importato.</span>'; refreshPoints(); });
  $('s-margin').value = settings.margin; $('s-margin-val').textContent = settings.margin;
  $('s-margin').oninput = () => { settings.margin = +$('s-margin').value; $('s-margin-val').textContent = settings.margin; saveSettings(); };
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  window.dispatchEvent(new Event('resize'));
}

async function switchSystem(sys) {
  system = settings.system = sys; saveSettings();
  $('system').value = sys;
  lastRoute = lastHalo = lastReverse = null; $('v-out').innerHTML = ''; $('r-out').innerHTML = '<p class="hint">Scegli partenza e destinazione, poi premi CALCOLA ROTTA.</p>'; $('h-out').innerHTML = '';
  $('p-out').innerHTML = '<p class="hint">Inserisci P e premi CALCOLA PIANO.</p>';
  await ensureData(); refreshPoints();
}

/**
 * Alla prima visita i moduli e Plotly si caricano prima che il service worker sia attivo, quindi
 * non passano dalla sua cache: li copiamo noi, cosi' il sito funziona offline gia' dalla seconda apertura.
 */
async function cacheLoadedFiles() {
  try {
    if (!('serviceWorker' in navigator) || !globalThis.caches) return;
    await navigator.serviceWorker.ready;
    const snapshots = new URL('data/', location.href).href; // le posizioni restano nel localStorage
    const urls = performance.getEntriesByType('resource').map((e) => e.name)
      .filter((u) => u.startsWith(location.origin) && !u.startsWith(snapshots));
    const cache = await caches.open(CACHE_NAME);
    const have = new Set((await cache.keys()).map((r) => r.url));
    await Promise.all(urls.filter((u) => !have.has(u)).map((u) => cache.add(u).catch(() => {})));
  } catch { /* la cache offline e' un di piu': mai bloccare l'app */ }
}

async function main() {
  $('version').textContent = `v${VERSION}`;
  $('footer').innerHTML = `${esc(ATTRIBUTION)} · Fasce Aaron Halo: ${esc(HALO_SOURCE)} · Corpi celesti: starmap.space.<br>
    Progetto personale non ufficiale, non affiliato a Cloud Imperium Games. Nessuna interazione con il client di gioco.`;
  bind(); bandInfo();
  planner = initPlanner({
    $, esc, parseNum, radioVal, table, store, settings, saveSettings, fillSelect, renderSaved, showTab, switchSystem, VERSION,
    ensureSystemData, system: () => system, points: () => points,
    openInDatabase: (draft) => pointsUi?.openDraft(draft),
  });
  try {
    pointsUi = await initPointsDb({
      $, esc, store, showTab, switchSystem, VERSION, system: () => system,
      planTo: (pt) => planner.planToPoint(pt),
      onChange: () => refreshPoints(),
    });
  } catch (e) { console.error(e); } // il resto di NAVCOM (e l'aggiornamento della cache) continua a funzionare
  // cache offline (service worker) e precaricamento della libreria grafica locale
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  ensurePlotly().then(cacheLoadedFiles);
  await ensureData();
  refreshPoints();
}
main();
