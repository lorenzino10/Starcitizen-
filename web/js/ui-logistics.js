// Interfaccia NAVCOM LOGISTICS INTELLIGENCE: FREIGHT RADAR, MISSION BOARD, CARGO MANIFEST,
// FLIGHT DISPATCH. Dati in IndexedDB "navcom-logistics"; cataloghi statici in data/logistics/.
import { vec } from './core/vector.js';
import { fmtAuto } from './core/units.js';
import { SYSTEM_NAMES } from './core/systems.js';
import { nowIso } from './core/points.js';
import { LogisticsDB } from './logistics/lgdb.js';
import { EVIDENCE, SHIPS, STATUS, isCommitted, normalizeContract, transition, patchAge } from './logistics/model.js';
import { PlaceIndex, legCache } from './logistics/places.js';
import { PRIORITIES } from './logistics/optimizer.js';
import { buildManifest, holdChartSvg } from './logistics/manifest.js';
import { ACTIONS, alternativeStations, applyAction, newDispatch, recompute } from './logistics/dispatch.js';
import { OUTCOMES, breakdown, normalizeObservation, whereToSearch } from './logistics/intel.js';
import { observeFromCatalog } from './logistics/catalog.js';
import { ALTERNATIVES, EVIDENCE_LEVELS, freightRadar } from './logistics/radar.js';
import { contractsToCsv, csvToContracts, exportFull, exportLogistics, jsonToContracts, mergeById, parseBackup } from './logistics/io.js';

const DEFAULTS = { ship: 'rsi-constellation-mk5-centaurus', scu: 240, cap: 240, maxBox: 32, patch: '', prio: 'profitto', maxStops: '', ranks: '', hScu: '', hStop: '', cGm: '', cStop: '', cRisk: '', pos: '' };
const fmtA = (n) => (n == null ? 'n.d.' : `${Math.round(n).toLocaleString('it-IT')} aUEC`);
const numOr = (v, d = null) => (v === '' || v == null || !Number.isFinite(+v) ? d : +v);

export async function initLogistics(app) {
  const { $, esc, store, VERSION } = app;
  const db = await LogisticsDB.open();
  let S = { ...DEFAULTS, ...((await db.getMeta('settings')) ?? {}) };
  let dispatch = (await db.getMeta('dispatch')) ?? newDispatch(null);
  let contracts = [], observations = [], catalog = [], catalogMeta = {}, places = new PlaceIndex({}), lastPlan = null;

  // ------------------------------------------------------------------ dati
  const saveSettings = () => db.setMeta('settings', S);
  const saveDispatch = () => db.setMeta('dispatch', dispatch);
  async function reload() { contracts = await db.contracts(); observations = await db.observations(); }
  let placesSig = '';
  const sig = () => Object.keys(SYSTEM_NAMES).map((s) => store.locations(s).length).join('/') + `#${catalog.length}`;
  /** Ricostruisce l'indice dei luoghi se le posizioni caricate sono cambiate (caricamento asincrono). */
  function ensurePlaces() { if (sig() !== placesSig) buildPlaces(); }
  async function loadPlaces() {
    for (const sys of Object.keys(SYSTEM_NAMES)) await app.ensureSystemData(sys).catch(() => {});
    buildPlaces();
  }
  function buildPlaces() {
    placesSig = sig();
    const bySystem = {};
    for (const sys of Object.keys(SYSTEM_NAMES)) {
      const rows = store.locations(sys);
      if (rows.length) bySystem[sys] = rows.map((r) => ({ name: r.name, pos: vec(r.x, r.y, r.z), type: r.type }));
    }
    places = new PlaceIndex(bySystem);
    const names = new Set([...places.list.map((p) => p.name), ...catalog.flatMap((e) => e.movements.flatMap((m) => [...m.from.names, ...m.to.names]))]);
    $('lg-places').innerHTML = [...names].sort().map((n) => `<option value="${esc(n)}">`).join('');
  }
  async function loadCatalog() {
    catalog = []; catalogMeta = {};
    for (const src of ['wiki', 'schp']) {
      try {
        const r = await fetch(`data/logistics/catalog-${src}.json`, { cache: 'no-cache' });
        if (!r.ok) { catalogMeta[src] = { error: `HTTP ${r.status}` }; continue; }
        const j = await r.json();
        catalog.push(...j.entries); catalogMeta[src] = j.meta;
      } catch (e) { catalogMeta[src] = { error: e.message }; }
    }
  }
  const currentPatch = () => S.patch || catalogMeta.wiki?.patch?.match(/\d+\.\d+(\.\d+)?/)?.[0] || store.locationMeta('stanton')?.gameVersion?.match(/\d+\.\d+(\.\d+)?/)?.[0] || '';
  const ship = () => ({ ...(SHIPS[S.ship] ?? SHIPS.custom), scu: numOr(S.scu), maxBox: numOr(S.maxBox) });
  const ranks = () => Object.fromEntries(String(S.ranks).split('\n').map((l) => l.split('=').map((x) => x.trim())).filter((x) => x[0] && x[1]));
  const posPlace = () => (S.pos ? { name: S.pos, system: places.resolve(S.pos)?.system ?? null } : null);
  const ctx = () => {
    const nav = app.navOptions();
    return {
      capacity: numOr(S.cap, numOr(S.scu, 0)), ship: ship(), ranks: ranks(), priority: S.prio,
      maxStops: numOr(S.maxStops), legOf: legCache(places, { drive: nav.drive, prep: nav.prep }),
      handling: numOr(S.hScu) !== null ? { perScu: numOr(S.hScu), perStop: numOr(S.hStop, 0) } : null,
      costs: { perGm: numOr(S.cGm, 0), perStop: numOr(S.cStop, 0), riskWeight: numOr(S.cRisk, 0) },
    };
  };

  // ------------------------------------------------------------------ impostazioni
  $('lg-ship').innerHTML = Object.entries(SHIPS).map(([k, v]) => `<option value="${k}">${esc(v.name)}${v.scu ? ` (${v.scu} SCU)` : ''}</option>`).join('');
  $('lg-prio').innerHTML = Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  const bind = (id, key) => { const el = $(id); el.value = S[key] ?? ''; el.addEventListener('change', () => { S[key] = el.value; saveSettings(); refreshAll(); }); };
  bind('lg-ship', 'ship'); bind('lg-scu', 'scu'); bind('lg-cap', 'cap'); bind('lg-maxbox', 'maxBox'); bind('lg-pos', 'pos'); bind('lg-patch', 'patch');
  bind('lg-prio', 'prio'); bind('lg-maxstops', 'maxStops'); bind('lg-ranks', 'ranks'); bind('lg-hscu', 'hScu'); bind('lg-hstop', 'hStop');
  bind('lg-cgm', 'cGm'); bind('lg-cstop', 'cStop'); bind('lg-crisk', 'cRisk');
  $('lg-ship').addEventListener('change', () => {
    const s = SHIPS[S.ship];
    if (s?.scu) { S.scu = s.scu; S.cap = Math.min(numOr(S.cap, s.scu), s.scu); S.maxBox = s.maxBox; for (const [id, k] of [['lg-scu', 'scu'], ['lg-cap', 'cap'], ['lg-maxbox', 'maxBox']]) $(id).value = S[k]; saveSettings(); }
    shipSource();
  });
  $('lg-cap').addEventListener('change', () => { if (numOr(S.scu) && numOr(S.cap) > numOr(S.scu)) { S.cap = S.scu; $('lg-cap').value = S.cap; saveSettings(); } });
  const shipSource = () => { const s = SHIPS[S.ship]; $('lg-ship-src').textContent = s?.scu ? `Fonte: ${s.source}. Griglia ${s.grids.map((g) => `${g.width}×${g.height}×${g.length} m`).join(', ')}. Ricontrolla a ogni patch.` : 'Valori inseriti da te.'; };
  shipSource();

  // sotto-viste
  document.querySelectorAll('[data-lg]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.lg)));
  function showView(v) {
    document.querySelectorAll('[data-lg]').forEach((b) => b.classList.toggle('active', b.dataset.lg === v));
    document.querySelectorAll('[data-lgview]').forEach((d) => { d.hidden = d.dataset.lgview !== v; });
  }

  // ------------------------------------------------------------------ MISSION BOARD
  const evIcon = (c) => (c.status === 'confermata' || isCommitted(c) ? EVIDENCE.verificata.icon : c.status === 'osservata' ? EVIDENCE.storica.icon : c.status === 'non_disponibile' || c.status === 'fallita' ? EVIDENCE.incompatibile.icon : '');
  function renderBoard() {
    const f = $('cb-filter').value;
    const list = contracts.filter((c) => (f === 'tutti' ? true : f === 'chiusi' ? ['completata', 'fallita', 'non_disponibile'].includes(c.status) : !['completata', 'fallita', 'non_disponibile'].includes(c.status)))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    if (!list.length) { $('cb-list').innerHTML = '<p class="hint">Nessun contratto. Usa "Missione trovata" quando vedi un\'offerta nel MobiGlas, oppure importa un file.</p>'; return; }
    const cp = currentPatch();
    $('cb-list').innerHTML = `<div class="tablewrap"><table><thead><tr><th></th><th>Contratto</th><th>Stato</th><th>Movimenti (SCU, ritiro → consegna)</th><th class="num">Ricompensa</th><th>Patch / data</th><th>Azioni</th></tr></thead><tbody>${
      list.map((c) => `<tr data-id="${esc(c.id)}"><td>${evIcon(c)}</td><td><b>${esc(c.title)}</b><br><span class="hint">${esc(c.company ?? 'compagnia n.d.')}${c.rank ? ` · ${esc(c.rank)}` : ''}${c.offerZone ? ` · vista a ${esc(c.offerZone)}` : ''}</span></td>
        <td>${esc(STATUS[c.status])}</td>
        <td class="wrapcell">${c.movements.map((m) => `${m.scu} SCU ${esc(m.cargo ?? '')} · ${esc(m.from?.name ?? '⚪ ritiro non noto')} → ${esc(m.to?.name ?? '⚪ consegna non nota')}${m.containerMax ? ` · casse ≤${m.containerMax}` : ''}${m.loaded ? ` · a bordo ${m.loaded - m.delivered}` : ''}${m.delivered ? ` · consegnati ${m.delivered}` : ''}`).join('<br>')}</td>
        <td class="num">${fmtA(c.reward)}</td>
        <td>${esc(c.patch ?? 'n.d.')}${patchAge(c.patch, cp) === 'obsoleto' ? ' <span class="badge old">obsoleto</span>' : ''}<br><span class="hint">${esc((c.observedAt ?? '').slice(0, 16).replace('T', ' '))}</span></td>
        <td class="actions">${actionButtons(c)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function actionButtons(c) {
    const b = (act, label, cls = '') => `<button class="small ${cls}" data-act="${act}" data-id="${esc(c.id)}">${label}</button>`;
    const out = [];
    if (c.status === 'osservata' || c.status === 'non_disponibile') out.push(b('confermata', 'Confermata ora'));
    if (c.status === 'osservata' || c.status === 'confermata') out.push(b('accettata', 'Accettata'), b('non_disponibile', 'Non disponibile'));
    if (isCommitted(c)) out.push(b('fallita', 'Fallita', 'danger'));
    out.push(b('modifica', 'Modifica'), b('elimina', 'Elimina', 'danger'));
    return out.join('');
  }
  $('cb-filter').onchange = renderBoard;
  $('cb-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const c = contracts.find((x) => x.id === btn.dataset.id); if (!c) return;
    const act = btn.dataset.act;
    try {
      if (act === 'elimina') { if (!confirm(`Eliminare "${c.title}"? Le osservazioni restano nello storico.`)) return; await db.deleteContracts([c.id]); }
      else if (act === 'modifica') { openForm(c); return; }
      else if (act === 'confermata') await db.putContracts([transition(c, 'confermata', { note: 'verificata nel MobiGlas' })]);
      else await doAction({ type: act, contractId: c.id });
      await refreshAll();
    } catch (err) { $('cb-msg').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  });

  function openForm(c = null, draft = null) {
    const d = c ?? draft ?? { system: places.resolve(S.pos)?.system ?? 'stanton', status: 'osservata', patch: currentPatch(), offerZone: S.pos, movements: [{ id: 'm1' }] };
    const box = $('cb-form');
    box.hidden = false;
    const mrow = (m, i) => `<div class="mrow" data-i="${i}"><input name="cargo" placeholder="merce" value="${esc(m.cargo ?? '')}"><input name="scu" placeholder="SCU" inputmode="numeric" value="${esc(m.scu ?? '')}">
      <input name="containerMax" placeholder="cassa max" inputmode="numeric" value="${esc(m.containerMax ?? '')}"><input name="from" list="lg-places" placeholder="ritiro (vuoto = non noto)" value="${esc(m.from?.name ?? '')}">
      <input name="to" list="lg-places" placeholder="consegna (vuoto = non nota)" value="${esc(m.to?.name ?? '')}"><button class="small danger" data-del="${i}">✕</button></div>`;
    box.innerHTML = `<div class="navbox"><b>${c ? 'Modifica contratto' : 'Missione trovata'}</b>
      <div class="grid3">
        <label>Titolo<input id="f-title" value="${esc(d.title ?? '')}"></label><label>Compagnia<input id="f-company" value="${esc(d.company ?? '')}"></label>
        <label>Grado richiesto<input id="f-rank" value="${esc(d.rank ?? '')}" placeholder="Rookie, Junior, Member…"></label>
        <label>Ricompensa (aUEC)<input id="f-reward" inputmode="numeric" value="${esc(d.reward ?? '')}"></label>
        <label>Sistema<select id="f-system">${Object.entries(SYSTEM_NAMES).map(([k, v]) => `<option value="${k}" ${d.system === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Dove hai visto l'offerta<input id="f-zone" list="lg-places" value="${esc(d.offerZone ?? '')}"></label>
        <label>Stato<select id="f-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Scadenza<input id="f-deadline" type="datetime-local" value="${esc((d.deadline ?? '').slice(0, 16))}"></label>
        <label>Patch<input id="f-patch" value="${esc(d.patch ?? '')}"></label>
        <label>ID offerta (se visibile)<input id="f-offer" value="${esc(d.offerId ?? '')}"></label>
        <label>Rischio (0 = nessuno)<input id="f-risk" inputmode="numeric" value="${esc(d.risk ?? 0)}"></label>
        <label>Note<input id="f-notes" value="${esc(d.notes ?? '')}"></label>
      </div>
      <p class="hint">Movimenti: una riga per ogni quantità da UN ritiro a UNA consegna. Più ritiri o consegne = più righe.</p>
      <div id="f-moves">${(d.movements ?? []).map(mrow).join('')}</div>
      <div class="row wrap"><button class="small" id="f-add">➕ Movimento</button><button class="small" id="f-save">💾 Salva</button><button class="small" id="f-cancel">Annulla</button></div><p id="f-msg"></p></div>`;
    const moves = () => [...box.querySelectorAll('.mrow')].map((r, i) => {
      const v = (n) => r.querySelector(`[name="${n}"]`).value.trim();
      const old = (c?.movements ?? [])[i];
      return { id: old?.id ?? `m${i + 1}`, cargo: v('cargo'), scu: v('scu'), containerMax: v('containerMax'), from: v('from') ? { name: v('from') } : null, to: v('to') ? { name: v('to') } : null, loaded: old?.loaded ?? 0, delivered: old?.delivered ?? 0 };
    });
    box.querySelector('#f-add').onclick = () => { box.querySelector('#f-moves').insertAdjacentHTML('beforeend', mrow({}, box.querySelectorAll('.mrow').length)); };
    box.querySelector('#f-moves').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) b.closest('.mrow').remove(); });
    box.querySelector('#f-cancel').onclick = () => { box.hidden = true; box.innerHTML = ''; };
    box.querySelector('#f-save').onclick = async () => {
      const input = {
        ...(c ?? {}), title: $('f-title').value, company: $('f-company').value, rank: $('f-rank').value, reward: $('f-reward').value, system: $('f-system').value,
        offerZone: $('f-zone').value, status: $('f-status').value, deadline: $('f-deadline').value ? new Date($('f-deadline').value).toISOString() : '', patch: $('f-patch').value,
        offerId: $('f-offer').value, risk: $('f-risk').value, notes: $('f-notes').value, movements: moves(), catalogRef: d.catalogRef ?? null, source: c?.source ?? d.source ?? 'manuale',
      };
      if (c && c.status !== input.status) input.history = [...(c.history ?? []), { at: nowIso(), from: c.status, to: input.status, note: 'modifica manuale' }];
      const r = normalizeContract(input);
      if (!r.contract) { $('f-msg').innerHTML = `<span class="err">${esc(r.errors.join('; '))}</span>`; return; }
      await db.putContracts([r.contract]);
      if (!c) {
        const o = normalizeObservation({ place: r.contract.offerZone || S.pos || 'non indicato', system: r.contract.system, at: r.contract.observedAt, patch: r.contract.patch, offerId: r.contract.offerId, title: r.contract.title, company: r.contract.company, rank: r.contract.rank, from: r.contract.movements[0]?.from?.name, to: r.contract.movements[0]?.to?.name, scu: r.contract.movements.reduce((s, m) => s + m.scu, 0), reward: r.contract.reward, outcome: 'presente', contractId: r.contract.id });
        if (o.observation) await db.putObservations([o.observation]);
      }
      box.hidden = true; box.innerHTML = '';
      $('cb-msg').innerHTML = `<span class="ok">Contratto salvato.</span>${r.warnings.length ? `<br><span class="warn">${esc(r.warnings.join(' · '))}</span>` : ''}`;
      await refreshAll();
    };
  }
  $('cb-new').onclick = () => openForm();
  $('cb-import').onchange = async () => {
    const f = $('cb-import').files?.[0]; $('cb-import').value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const r = /\.csv$/i.test(f.name) || !/^\s*[[{]/.test(text) ? csvToContracts(text) : jsonToContracts(text);
      const m = mergeById(contracts, r.contracts);
      await db.putContracts(m.list.filter((x) => r.contracts.some((y) => y.id === x.id)));
      $('cb-msg').innerHTML = `<span class="ok">${m.added} nuovi, ${m.updated} aggiornati, ${m.kept} invariati.</span>${r.errors.length ? `<br><span class="err">${esc(r.errors.join(' · '))}</span>` : ''}${r.warnings.length ? `<br><span class="warn">${esc(r.warnings.slice(0, 8).join(' · '))}${r.warnings.length > 8 ? ' …' : ''}</span>` : ''}`;
      await refreshAll();
    } catch (e) { $('cb-msg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const day = () => new Date().toISOString().slice(0, 10);
  $('cb-csv').onclick = () => download(`navcom-contratti-${day()}.csv`, contractsToCsv(contracts), 'text/csv');
  $('cb-json').onclick = () => download(`navcom-logistica-${day()}.json`, JSON.stringify(exportLogistics({ contracts, observations, settings: S, version: VERSION }), null, 1), 'application/json');
  $('lg-backup').onclick = async () => {
    const points = app.pointsDb ? await app.pointsDb().all().catch(() => []) : [];
    download(`navcom-backup-completo-${day()}.json`, JSON.stringify(exportFull({ points, contracts, observations, settings: S, version: VERSION })), 'application/json');
  };
  $('lg-restore').onchange = async () => {
    const f = $('lg-restore').files?.[0]; $('lg-restore').value = '';
    if (!f) return;
    try {
      const r = parseBackup(await f.text());
      const mc = mergeById(contracts, r.contracts), mo = mergeById(observations, r.observations, (x) => x.at);
      await db.putContracts(mc.list); await db.putObservations(mo.list);
      let pts = '';
      if (r.points && app.pointsDb) {
        const pdb = app.pointsDb(); const have = new Set((await pdb.all()).map((p) => p.id));
        const add = r.points.filter((p) => p.id && !have.has(p.id));
        await pdb.putMany(add); pts = ` · DATABASE PUNTI: ${add.length} punti aggiunti, esistenti invariati`;
      }
      $('lg-arch-msg').innerHTML = `<span class="ok">Ripristino per unione: contratti +${mc.added} / aggiornati ${mc.updated}; osservazioni +${mo.added}${pts}. Nulla è stato cancellato.</span>${r.errors.length ? `<br><span class="err">${esc(r.errors.join(' · '))}</span>` : ''}`;
      await refreshAll();
    } catch (e) { $('lg-arch-msg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };

  // catalogo
  function renderCatalog() {
    const src = $('ct-src').value, q = $('ct-q').value.trim().toLowerCase();
    const metaLine = (k, label) => {
      const m = catalogMeta[k];
      if (!m) return '';
      if (m.error) return `<li>${label}: <span class="err">non disponibile (${esc(m.error)})</span></li>`;
      return `<li>${label}: ${m.entries} modelli · patch ${esc(m.patch ?? 'non dichiarata')}${m.observedFrom ? ` · osservati ${m.observedFrom} → ${m.observedTo}` : ''} · copertura ${esc(Object.entries(m.coverage ?? {}).map(([s, n]) => `${SYSTEM_NAMES[s] ?? s} ${n}`).join(', '))}${m.withReward != null ? ` · con ricompensa ${m.withReward}` : ''} · aggiornato ${esc((m.fetchedAt ?? '').slice(0, 10))} · ${esc(m.license ?? '')}</li>`;
    };
    $('ct-meta').innerHTML = `<ul class="hint">${metaLine('wiki', 'Star Citizen Wiki API')}${metaLine('schp', 'SCHaulingPlanner')}</ul><p class="warn">Il catalogo contiene MODELLI di missione: non dice che un'offerta è disponibile ora. Ritiri e consegne indicati come "candidati" sono assegnati dal gioco.</p>`;
    const list = catalog.filter((e) => (!src || e.source === src) && (!q || JSON.stringify([e.title, e.company, e.movements]).toLowerCase().includes(q))).slice(0, 200);
    $('ct-list').innerHTML = `<div class="tablewrap"><table><thead><tr><th></th><th>Modello</th><th>Grado</th><th>Merce (SCU, casse)</th><th>Ritiro</th><th>Consegna</th><th class="num">Ricompensa</th><th>Patch</th><th></th></tr></thead><tbody>${
      list.map((e) => `<tr><td>${EVIDENCE.catalogo.icon}</td><td>${esc(e.title)}<br><span class="hint">${esc(e.company ?? '')} · ${esc(e.source === 'wiki' ? 'Wiki API' : 'SCHaulingPlanner')}${e.combat ? ' · combattimento' : ''}</span></td><td>${esc(e.rank ?? 'n.d.')}</td>
        <td class="wrapcell">${e.movements.map((m) => `${esc(m.cargo ?? '?')} ${m.scuMin && m.scuMin !== m.scu ? `${m.scuMin}–` : ''}${m.scu ?? '?'}${m.containerMax ? ` (≤${m.containerMax})` : ''}`).join('<br>')}</td>
        <td class="wrapcell">${placesCell(e.movements.map((m) => m.from))}</td><td class="wrapcell">${placesCell(e.movements.map((m) => m.to))}</td>
        <td class="num">${e.reward ? fmtA(e.reward) : 'n.d.'}</td><td>${esc(e.patch ?? (e.observedAt ? `n.d. (${e.observedAt})` : 'n.d.'))}</td>
        <td><button class="small" data-seen="${esc(e.id)}">Ho visto questa offerta</button></td></tr>`).join('')}</tbody></table></div>${catalog.length > list.length ? `<p class="hint">${list.length} di ${catalog.filter((e) => !src || e.source === src).length}: affina la ricerca.</p>` : ''}`;
  }
  const placesCell = (ps) => {
    const names = [...new Set(ps.flatMap((p) => p.names))];
    const fixed = ps.every((p) => p.fixed);
    return `${names.slice(0, 4).map(esc).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}${fixed ? '' : ' <span class="hint">(candidati)</span>'}`;
  };
  $('ct-src').onchange = renderCatalog; $('ct-q').addEventListener('input', renderCatalog);
  $('ct-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seen]'); if (!b) return;
    const entry = catalog.find((x) => x.id === b.dataset.seen);
    if (!S.pos) { alert('Indica prima la posizione attuale (dove stai guardando la bacheca), a sinistra in "Contesto".'); return; }
    openForm(null, observeFromCatalog(entry, { place: S.pos, at: nowIso(), patch: currentPatch(), system: places.resolve(S.pos)?.system }));
    $('cb-form').scrollIntoView({ behavior: 'smooth' });
  });

  // ------------------------------------------------------------------ FREIGHT RADAR + intelligence
  $('rd-systems').innerHTML = Object.entries(SYSTEM_NAMES).map(([k, v]) => `<label><input type="checkbox" name="rd-sys" value="${k}" checked> ${v}</label>`).join('');
  $('rd-go').onclick = () => {
    ensurePlaces();
    const inc = [...document.querySelectorAll('input[name="rd-sys"]:checked')].map((x) => x.value);
    const res = freightRadar({
      start: { name: $('rd-start').value || S.pos }, dest: { name: $('rd-dest').value }, open: $('rd-open').checked,
      capacity: ctx().capacity, ship: ship(), ranks: ranks(), maxStops: numOr(S.maxStops, 3), systems: { include: inc },
      priority: S.prio, currentPatch: currentPatch(),
    }, { catalog, observations, places });
    renderRadar(res);
  };
  function renderRadar(r) {
    const card = (k) => {
      const st = r.alternatives[k];
      return `<div class="altcard"><h3>${esc(k.toUpperCase())}</h3><p class="hint">${esc(ALTERNATIVES[k])}</p>${st.length ? `<ol>${st.map((s) => `<li>${stationLine(s)}</li>`).join('')}</ol>` : '<p class="hint">Dato insufficiente per questa alternativa.</p>'}</div>`;
    };
    $('rd-out').innerHTML = `${r.issues.map((i) => `<p class="warn">${esc(i)}</p>`).join('')}${r.notes.map((i) => `<p class="hint">${esc(i)}</p>`).join('')}
      <div class="alts">${['conservativa', 'equilibrata', 'esplorativa'].map(card).join('')}</div>
      <h3>Classifica completa (${r.stations.length} luoghi)</h3>
      <div class="tablewrap tall"><table><thead><tr><th>Evidenza</th><th>Luogo</th><th class="num">Deviazione</th><th class="num">Opportunità</th><th class="num">Verso la destinazione</th><th class="num">Ricompensa max nota</th><th>Fonti · patch</th><th>Da verificare in gioco</th></tr></thead><tbody>${
        r.stations.slice(0, 80).map((s) => `<tr><td>${EVIDENCE_LEVELS[s.bestEvidence]?.icon ?? ''} ${esc(EVIDENCE_LEVELS[s.bestEvidence]?.label ?? '')}</td><td>${esc(s.name)}${s.known ? '' : ' <span class="hint">(posizione non nota)</span>'}</td>
          <td class="num">${s.detour === null ? 'n.d.' : fmtAuto(Math.max(0, s.detour))}</td><td class="num">${s.opportunities.length}${s.excluded ? ` <span class="hint">(${s.excluded} escluse)</span>` : ''}</td><td class="num">${r.dest ? s.towardDest : '—'}</td>
          <td class="num">${s.maxReward ? fmtA(s.maxReward) : 'n.d.'}</td><td>${esc(s.sources.join(', '))} · ${esc(s.patches.join(', '))}</td><td class="hint" title="${esc(s.toVerify.join('; '))}">${s.toVerify.length} punti (passa il mouse)</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Deviazione = distanza in più rispetto al volo diretto, in linea retta fra i marker (minimo teorico). Nessuna probabilità: i conteggi sono modelli di catalogo e tue osservazioni.</p>`;
  }
  const stationLine = (s) => `${EVIDENCE_LEVELS[s.bestEvidence]?.icon ?? ''} <b>${esc(s.name)}</b> · deviazione ${s.detour === null ? 'n.d.' : fmtAuto(Math.max(0, s.detour))} · ${s.opportunities.length} opportunità${s.observed?.current.visits ? ` · bacheca vista ${s.observed.current.visits} volte (${esc(s.observed.current.sample)})` : ''}<br><span class="hint">Da verificare: ${esc(s.toVerify.join('; '))}</span>`;

  $('ob-save').onclick = async () => {
    const place = $('ob-place').value.trim() || S.pos;
    if (!place) { alert('Indica il luogo della bacheca.'); return; }
    const n = numOr($('ob-n').value, 0);
    const visit = `v-${Date.now().toString(36)}`;
    const at = nowIso();
    const recs = (n > 0 ? Array.from({ length: n }, () => ({ outcome: 'presente' })) : [{ outcome: 'nessuna' }])
      .map((x) => normalizeObservation({ ...x, place, system: places.resolve(place)?.system, at, patch: currentPatch(), visit }).observation);
    await db.putObservations(recs);
    $('ob-n').value = '';
    await refreshAll();
  };
  $('ob-by').onchange = renderIntel;
  function renderIntel() {
    const cp = currentPatch();
    const ws = whereToSearch(observations, { currentPatch: cp });
    const by = $('ob-by').value;
    const head = `<p class="hint">Patch attuale: ${esc(cp || 'non indicata')} · ${observations.length} osservazioni registrate. Conteggi, non probabilità.</p>`;
    if (!observations.length) { $('ob-out').innerHTML = `${head}<p class="hint">Nessuna osservazione: registra le bacheche che controlli in gioco.</p>`; return; }
    if (by === 'luogo') {
      $('ob-out').innerHTML = `${head}<div class="tablewrap"><table><thead><tr><th>Luogo</th><th class="num">Visite (patch attuale)</th><th class="num">con offerte</th><th class="num">Offerte</th><th class="num">aUEC/SCU mediana</th><th>Campione</th><th class="num">Visite patch precedenti</th><th>Ultima</th></tr></thead><tbody>${
        ws.map((w) => `<tr><td>${esc(w.place)}</td><td class="num">${w.current.visits}</td><td class="num">${w.current.withOffers}</td><td class="num">${w.current.offers}</td><td class="num">${w.current.medianRewardPerScu ? `${Math.round(w.current.medianRewardPerScu).toLocaleString('it-IT')} (n=${w.current.rewardSample})` : 'n.d.'}</td><td>${esc(w.current.sample)}</td><td class="num">${w.previous.visits + w.unknownPatch.visits}${w.previous.visits ? ' <span class="badge old">obsoleto</span>' : ''}</td><td>${esc((w.current.last ?? w.previous.last ?? w.unknownPatch.last ?? '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      const rows = breakdown(observations, by);
      $('ob-out').innerHTML = `${head}<div class="tablewrap"><table><thead><tr><th>${esc(by)}</th><th class="num">Offerte osservate</th><th class="num">SCU</th><th class="num">Ricompensa mediana</th><th>Esiti</th><th>Campione</th></tr></thead><tbody>${
        rows.map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.n}</td><td class="num">${r.scu}</td><td class="num">${fmtA(r.medianReward)}</td><td>${esc(Object.entries(r.outcomes).map(([k, v]) => `${OUTCOMES[k] ?? k}: ${v}`).join(', '))}</td><td>${esc(r.sample)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  }

  // ------------------------------------------------------------------ FLIGHT DISPATCH + MANIFEST
  async function doAction(a) {
    const r = applyAction(dispatch, contracts, a, { patch: currentPatch() });
    dispatch = r.state; await saveDispatch();
    await db.putContracts(r.changed); await db.putObservations(r.observations);
    await reload();
    if (r.messages.length) $('fd-msg') ? ($('fd-msg').innerHTML = r.messages.map((m) => `<p class="warn">${esc(m)}</p>`).join('')) : null;
    if (a.type === 'non_disponibile') {
      const alt = alternativeStations(observations, { currentPatch: currentPatch(), exclude: posPlace() });
      lastAlt = alt;
    }
    return r;
  }
  let lastAlt = null;
  $('fd-go').onclick = () => { dispatch = { ...dispatch, position: posPlace() }; saveDispatch(); compute(); };
  function compute() {
    ensurePlaces();
    if (!ctx().capacity) { $('fd-out').innerHTML = '<p class="err">Indica la capienza operativa.</p>'; return; }
    lastPlan = recompute({ ...dispatch, position: dispatch.position ?? posPlace() }, contracts, ctx());
    renderDispatch(); renderManifest();
  }
  function renderDispatch() {
    const p = lastPlan;
    if (!p) { $('fd-out').innerHTML = '<p class="hint">Premi CALCOLA. Entrano nel piano i contratti ACCETTATI (obbligatori) e i CONFERMATI (proposti, da accettare).</p>'; return; }
    if (!p.ok) { $('fd-out').innerHTML = `<p class="err">${esc(p.reason)}</p>${(p.issues ?? []).map((i) => `<p class="warn">${esc(i.reason)} (${esc(i.contractId)})</p>`).join('')}`; return; }
    const s = p.score;
    const blocks = [];
    blocks.push(`<div class="metrics"><div class="metric"><span>SCALI</span><b>${s.stops}</b></div><div class="metric"><span>DISTANZA NOTA</span><b>${fmtAuto(s.distance)}${s.unknownLegs ? '+' : ''}</b></div>
      <div class="metric"><span>RICOMPENSE</span><b>${fmtA(s.reward)}${s.unknownReward ? '*' : ''}</b></div><div class="metric"><span>PROFITTO/ORA</span><b>${s.perHour === null ? 'n.d.' : fmtA(s.perHour)}</b></div><div class="metric"><span>PICCO STIVA</span><b>${p.peak ?? 0} / ${ctx().capacity}</b></div></div>
      <p class="hint">Metodo: ${esc(p.method)} · priorità: ${esc(PRIORITIES[S.prio])}${s.unknownReward ? ' · * ricompense non note escluse dal totale' : ''}${s.perHour === null ? ' · profitto orario non determinabile (servono tempi di volo e di movimentazione)' : ''}</p>`);
    blocks.push(...p.warnings.map((w) => `<p class="warn">${esc(w)}</p>`));
    if (p.proposed.length) blocks.push(`<div class="navbox warn"><b>Proposti, DA ACCETTARE nel MobiGlas</b> (non ancora tuoi):<ul>${p.proposed.map((c) => `<li>${esc(c.title)} · ${fmtA(c.reward)} <button class="small" data-fd="accettata" data-id="${esc(c.id)}">Missione accettata</button> <button class="small danger" data-fd="non_disponibile" data-id="${esc(c.id)}">Non disponibile</button></li>`).join('')}</ul></div>`);
    if (p.blocked.length) blocks.push(`<details><summary class="hint">${p.blocked.length} confermati non proponibili</summary><ul>${p.blocked.map((b) => `<li>${EVIDENCE.incompatibile.icon} ${esc(b.contract.title)}: ${esc(b.reason)}</li>`).join('')}</ul></details>`);
    if (lastAlt?.length) blocks.push(`<div class="navbox"><b>Stazioni alternative (previsione dal tuo storico, non contratti)</b><ul>${lastAlt.map((w) => `<li>${esc(w.place)}: offerte viste in ${w.current.withOffers} visite su ${w.current.visits} (${esc(w.current.sample)})</li>`).join('')}</ul></div>`);
    const man = buildManifest(p, { ship: ship(), capacity: ctx().capacity, start: dispatch.position ?? posPlace() });
    let li = 0;
    const legFor = (st) => { const l = p.eval.legs[li]; if (l && l.to && l.to.name === st.place.name) { li++; return l; } return null; };
    blocks.push(`<p id="fd-msg"></p><ol class="stops">${man.stops.map((st) => {
      const legInfo = legFor(st);
      return `<li><b>${esc(st.place.name)}</b> <span class="hint">${legInfo ? (legInfo.distance === null ? `tratta ${esc(legInfo.note ?? 'non nota')}` : `${fmtAuto(legInfo.distance)} da ${esc(legInfo.from?.name ?? '')} (linea retta)${legInfo.time ? `, ${Math.round(legInfo.time / 60)} min di QT` : ''}`) : 'sei già qui'}</span>
        <div class="row wrap"><button class="small" data-fd="arrivo" data-place="${esc(st.place.name)}">Sono arrivato qui</button><button class="small" data-fd="salta" data-place="${esc(st.place.name)}">Salta questa stazione</button></div>
        <ul>${st.ops.map((o) => `<li>${o.type === 'carico' ? '⬆ CARICA' : '⬇ SCARICA'} ${o.qty} SCU ${esc(o.cargo ?? '')} · ${esc(o.title)}${o.proposed ? ' <span class="badge">da accettare</span>' : ''} → stiva ${o.loadAfter}/${ctx().capacity}
          ${o.proposed ? '' : o.type === 'carico' ? `<button class="small" data-fd="ritirato" data-id="${esc(o.contractId)}" data-mv="${esc(o.movementId)}" data-q="${o.qty}">Carico ritirato</button>` : `<button class="small" data-fd="consegnata" data-id="${esc(o.contractId)}" data-mv="${esc(o.movementId)}" data-q="${o.qty}">Consegna completata</button><button class="small" data-fd="consegna_parziale" data-id="${esc(o.contractId)}" data-mv="${esc(o.movementId)}">Consegna parziale</button>`}</li>`).join('')}</ul></li>`;
    }).join('')}</ol>`);
    const committed = contracts.filter(isCommitted);
    if (committed.length) blocks.push(`<p class="hint">Contratti in corso: ${committed.map((c) => `${esc(c.title)} <button class="small danger" data-fd="fallita" data-id="${esc(c.id)}">Missione fallita</button>`).join(' · ')}</p>`);
    blocks.push('<p class="hint">"Missione trovata": inseriscila nel MISSION BOARD, poi ricalcola.</p>');
    $('fd-out').innerHTML = blocks.join('');
    $('fd-log').innerHTML = dispatch.log.length ? `<ul class="hint">${dispatch.log.slice(-20).reverse().map((l) => `<li>${esc(l.at.slice(0, 16).replace('T', ' '))} · ${esc(ACTIONS[l.type] ?? l.type)}${l.place ? ` · ${esc(l.place)}` : ''}</li>`).join('')}</ul>` : '<p class="hint">Nessuna azione registrata.</p>';
  }
  $('fd-out').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fd]'); if (!b) return;
    const type = b.dataset.fd;
    try {
      const a = { type, contractId: b.dataset.id, movementId: b.dataset.mv };
      if (type === 'arrivo' || type === 'salta') a.place = { name: b.dataset.place, system: places.resolve(b.dataset.place)?.system ?? null };
      if (type === 'ritirato') a.qty = +b.dataset.q;
      if (type === 'consegna_parziale') { const q = prompt('SCU consegnati in questa operazione?'); if (!q) return; a.qty = +q; }
      if (type === 'fallita' && !confirm('Segnare la missione come fallita?')) return;
      if (type === 'arrivo') { S.pos = b.dataset.place; $('lg-pos').value = S.pos; await saveSettings(); }
      const r = await doAction(a);
      compute();
      if (r.messages.length) $('fd-msg').innerHTML = r.messages.map((m) => `<p class="warn">${esc(m)}</p>`).join('');
      renderBoard(); renderIntel();
    } catch (err) { $('fd-msg').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });
  function renderManifest() {
    const p = lastPlan;
    if (!p?.ok) { $('mf-out').innerHTML = '<p class="hint">Nessun itinerario valido: calcolalo in FLIGHT DISPATCH.</p>'; return; }
    const man = buildManifest(p, { ship: ship(), capacity: ctx().capacity, start: dispatch.position ?? posPlace() });
    $('mf-out').innerHTML = `${holdChartSvg(man)}
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Scalo</th><th>Operazioni</th><th class="num">Stiva dopo</th><th class="num">Residua</th><th class="num">Ricompense maturate</th><th class="num">Da ottenere</th><th>Avvisi</th></tr></thead><tbody>${
        man.stops.map((s) => `<tr><td>${s.n}</td><td>${esc(s.place.name)}</td><td class="wrapcell">${s.ops.map((o) => `${o.type === 'carico' ? '⬆' : '⬇'} ${o.qty} SCU ${esc(o.cargo ?? '')} · ${esc(o.title)}${o.containerMax ? ` (casse ≤${o.containerMax})` : ''}${o.proposed ? ' · da accettare' : ''}`).join('<br>')}</td>
          <td class="num">${s.loadAfter}</td><td class="num">${s.residual}</td><td class="num">${fmtA(s.rewardCumulative)}</td><td class="num">${fmtA(s.rewardPending)}</td><td class="wrapcell">${s.warnings.map((w) => `${EVIDENCE.incerta.icon} ${esc(w)}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">In stiva alla partenza: ${p.initialLoad} SCU · picco ${man.peak} SCU su ${man.capacity} · ricompense totali ${fmtA(man.totalReward)}${man.unknownRewards ? ` (${man.unknownRewards} non note)` : ''}</p>
      ${man.limits.map((l) => `<p class="warn">${esc(l)}</p>`).join('')}`;
  }

  // ------------------------------------------------------------------ avvio
  async function refreshAll() { await reload(); renderBoard(); renderIntel(); renderCatalog(); if (lastPlan) compute(); }
  const storage = () => { $('lg-storage').innerHTML = db.persistent ? 'Contratti e osservazioni in questo browser (IndexedDB "navcom-logistics"). Esporta il backup completo regolarmente.' : `<span class="warn">${esc(db.warning)}</span>`; };
  storage();
  await reload(); renderBoard(); renderIntel(); renderDispatch();
  loadCatalog().then(async () => { renderCatalog(); await loadPlaces(); if (!S.patch) $('lg-patch').placeholder = `es. ${currentPatch() || '4.10.2'} (rilevata dai dati)`; });
  return { refreshAll, showView, db: () => db };
}
