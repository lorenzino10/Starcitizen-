// STAR CITIZEN NAVCOM - interfaccia web. Nessun calcolo qui: usa planner.js e core/.
import { BANDS, HALO_SOURCE } from './core/halo.js';
import { STATUS } from './core/qt.js';
import { fmtAuto, fmtKm, hudReading, hudResolution } from './core/units.js';
import { pointAt } from './core/geometry.js';
import { distance, toArray, vec } from './core/vector.js';
import { ATTRIBUTION, fetchSystem, parsePositions } from './data/citizenhq.js';
import { bodySeed, obstructionModel } from './data/bodies.js';
import { Store } from './data/store.js';
import { haloOptions, navPoints, planToTarget } from './planner.js';
import { CYAN, AMBER, GREEN, RED, systemPlot } from './plot.js';

const VERSION = '0.2.0-web';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { [STATUS.VERIFIED]: '🟢', [STATUS.DATA]: '🔵', [STATUS.THEORETICAL]: '🟠' };

const store = new Store();
const SETTINGS_KEY = 'navcom.settings';
const settings = (() => {
  const def = { margin: 1.2, hud: 1, speed: 0, system: 'stanton' };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return def; }
})();
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* opzionale */ } };

let system = settings.system;
let points = new Map();
let lastRoute = null;
let lastHalo = null;

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
const hudText = (m) => `${hudReading(m, settings.hud)} (un passo dell'ultima cifra = ${fmtAuto(hudResolution(m, settings.hud))})`;
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

async function ensureData() {
  if (store.locations(system).length) return;
  try {
    const n = await loadSnapshot(system);
    if (!n) throw new Error('snapshot vuoto');
  } catch (e) {
    store.logImport({ system, origin: 'snapshot del sito', ok: false, stored: 0, errors: [e.message] });
  }
}

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
  $('r-custom-empty').hidden = cps.length > 0;
  const qt = all.filter((p) => p.qtValid);
  fillSelect($('h-start'), qt, $('h-start-filter').value);
  fillSelect($('h-dest'), qt);
  renderPoints(); renderSaved(); renderData();
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
    points: [...points.values()].filter((p) => p.qtValid), bodies: obstructionModel('stanton', settings.margin).bodies,
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
  const cps = store.customPoints(system);
  $('cp-list').innerHTML = cps.length ? '' : '<p class="hint">Nessun punto.</p>';
  for (const p of cps) {
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<b>★ ${esc(p.name)}</b><pre>X ${p.x.toFixed(3)} m\nY ${p.y.toFixed(3)} m\nZ ${p.z.toFixed(3)} m${p.notes ? `\n${esc(p.notes)}` : ''}</pre>`;
    const del = Object.assign(document.createElement('button'), { className: 'small danger', textContent: 'Elimina' });
    del.onclick = () => { store.deleteCustomPoint(p.id); refreshPoints(); };
    d.append(del); $('cp-list').append(d);
  }
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
    if (p.type === 'qt') text = `Salta verso <b>${esc(p.qtDest.name)}</b>, interrompi a <b>${fmtKm(p.hudRemaining_m)}</b>, poi volo convenzionale per ${fmtKm(p.residual_m)}. Stato: ${esc(p.status)}`;
    else if (p.type === 'aaron_halo') text = `Fascia ${p.band}: salta verso <b>${esc(p.qtDest)}</b> e interrompi fra ${fmtKm(p.enterHud_m)} e ${fmtKm(p.exitHud_m)}${p.peakHud_m ? ` (picco ${fmtKm(p.peakHud_m)})` : ''}`;
    const d = document.createElement('div');
    d.className = 'card';
    d.innerHTML = `<b>${esc(r.name)}</b> <span class="hint">${esc(r.createdAt)}</span><br>${text}<details><summary class="hint">dati completi</summary><pre>${esc(JSON.stringify(p, null, 1))}</pre></details>`;
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
  $('d-sources').innerHTML = `<p>Posizioni: ${esc(ATTRIBUTION)}${meta ? `. Versione dei dati: ${esc(meta.gameVersion ?? 'n.d.')}, scaricati il ${esc(meta.fetchedAt ?? '')}, origine: ${esc(meta.origin)}.` : '.'}</p>
    <p>Corpi celesti per gli ostacoli: ${seed ? `${esc(seed._meta.source)}. Conflitti noti: ${esc(seed._meta.known_conflicts.join('; '))}` : '<b>nessun dato per questo sistema: tutte le tratte risultano "Teoriche".</b>'}</p>
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
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    window.dispatchEvent(new Event('resize'));
  }));
  $('system').value = system;
  $('system').onchange = async () => {
    system = settings.system = $('system').value; saveSettings();
    lastRoute = lastHalo = null; $('r-out').innerHTML = '<p class="hint">Scegli partenza e destinazione, poi premi CALCOLA ROTTA.</p>'; $('h-out').innerHTML = '';
    await ensureData(); refreshPoints();
  };
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
  $('h-band').oninput = bandInfo;
  document.querySelectorAll('input[name="h-which"]').forEach((el) => el.addEventListener('change', () => { $('h-dest').hidden = radioVal('h-which') !== 'pick'; }));
  $('h-go').onclick = calcHalo;
  $('cp-save').onclick = () => {
    try {
      const name = $('cp-name').value.trim();
      if (!name) throw new Error('Inserisci un nome.');
      const k = +radioVal('cp-unit');
      store.addCustomPoint({ name, system, x: parseNum($('cp-x').value) * k, y: parseNum($('cp-y').value) * k, z: parseNum($('cp-z').value) * k, notes: $('cp-notes').value });
      refreshPoints();
    } catch (e) { alert(e.message); }
  };
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
  $('s-hud').value = settings.hud; $('s-hud').onchange = () => { settings.hud = Math.max(0, Math.min(3, +$('s-hud').value || 0)); saveSettings(); };
  $('s-speed').value = settings.speed; $('s-speed').onchange = () => { settings.speed = Math.max(0, +$('s-speed').value || 0); saveSettings(); };
}

async function main() {
  $('version').textContent = `v${VERSION}`;
  $('footer').innerHTML = `${esc(ATTRIBUTION)} · Fasce Aaron Halo: ${esc(HALO_SOURCE)} · Corpi celesti: starmap.space.<br>
    Progetto personale non ufficiale, non affiliato a Cloud Imperium Games. Nessuna interazione con il client di gioco.`;
  bind(); bandInfo();
  await ensureData();
  refreshPoints();
}
main();
