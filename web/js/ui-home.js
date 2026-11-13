// COMMAND BRIDGE (PLANCIA 2.0): home operativa di NAVCOM.
// Striscia di stato compatta, mappa grande (motore dell'ATLANTE), pannello contestuale a destra,
// in basso MISSIONI (Mission Finder sul Mission Database 2.0) / CARGO (stacking) / ATTIVITA'.
// Solo stato reale: posizione e destinazione inserite da te, ultima rotta del PIANIFICATORE, dati
// pubblicati con versione e data. Nessuna telemetria, nessuna missione dichiarata disponibile ora.
import { NOT_SET, DEFAULT_SHIP, nearestBody, nearestMarker, parsePosition, planSummary, shipSheet, straightDistance } from './home/model.js';
import { bridgeScene, nextJump, nextLeg, LEGEND, SYS_LABEL } from './home/bridge.js';
import { SERVICE_FILTERS } from './dest/model.js';
import { AtlasView, LINE_STYLE, fmtLen } from './atlas/render.js';
import { ORIGIN } from './atlas/missions.js';
import { CLASSES, evaluateStack, suggestStack } from './atlas/stack.js';
import { stopsOf } from './atlas/plan.js';
import { dbViews, findMissions, collapseVariants, parseArea, shipCaps, jumpLinks, CLASS, ROUTE, CATEGORY_LABEL, cargoOf } from './missions/finder.js';
import { loadMissionDb, provenance } from './missions/load.js';
import { draftMovements, observedInput } from './missions/observe.js';
import { normalizeContract, rankIndex } from './logistics/model.js';
import { newId, nowIso } from './core/points.js';

const SYS = SYS_LABEL;
const fmtDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtD = (m) => (m === null || m === undefined || !Number.isFinite(m) ? '—' : Math.abs(m) < 1e4 ? `${Math.round(m).toLocaleString('it-IT')} m` : Math.abs(m) < 1e8 ? `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km` : `${(m / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} Gm`);
const fmtKm = (m) => `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 })} km`;
const fmtT = (s) => (s === null || s === undefined ? '—' : s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const fmtA = (n) => (n === null || n === undefined ? 'n.d.' : `${Math.round(n).toLocaleString('it-IT')} aUEC`);
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);
const SRC_LABEL = { manuale: 'inserita a mano', '/showlocation': 'da /showlocation', salvata: 'da un punto salvato', luogo: 'luogo scelto da te' };
const QUICK = [['city', '🏙 Città'], ['station', '🛰 Stazioni'], ['outpost', '🏕 Avamposti'], ['shops', '🛒 Negozi'], ['hospital', '✚ Ospedali'], ['refinery', '⚗ Raffinerie'], ['mining', '⛏ Mining'], ['fav', '☆ Preferiti']];
const RISK = [['any', 'qualsiasi'], ['nocombat', 'senza combattimento'], ['1', 'rischio fino a 1'], ['2', 'rischio fino a 2'], ['3', 'rischio fino a 3']];
const ROLE_LABEL = { offer: 'OFFERTA', pickup: 'RITIRO', dropoff: 'CONSEGNA', transit: 'TRANSITO' };
const PAGE = 60;

export async function initHome(app) {
  const { $, esc, state } = app;
  const B = state.bridge;
  const S = {
    list: null, listSys: 'current', ctx: { type: 'auto' }, focus: null, refit: true, mapSys: 'auto', outposts: !!B.outposts,
    tab: B.tab ?? 'missions', form: { from: '', to: '', cats: ['hauling', 'delivery'], minReward: '', maxScu: '', risk: 'any', legalOnly: false, collapse: true, unknownReward: true, ...(B.form ?? {}) },
    result: null, shown: PAGE, compare: [], open: null,
  };
  const ix = () => app.dest()?.index?.() ?? null;
  const A = () => app.atlas() ?? null;
  const geo = () => A()?.geo?.() ?? null;
  const L = () => app.logistics?.() ?? null;
  const M = { res: null, views: null, loading: null, ships: [] };

  // ---------------------------------------------------------------- dati: Mission Database 2.0 e navi
  function loadMissions() {
    if (M.loading) return M.loading;
    const db = L()?.db?.();
    const io = {
      fetchJson: async (u) => { const r = await fetch(u, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); },
      getMeta: (k) => (db ? db.getMeta(k) : Promise.resolve(null)), setMeta: (k, v) => (db ? db.setMeta(k, v) : Promise.resolve()),
    };
    M.loading = loadMissionDb(io).then((res) => { M.res = res; M.views = res.cat ? dbViews(res.cat) : []; renderProv(); renderBar(); renderFinderForm(); if (S.tab === 'missions') runFinder(); renderCtx(); return res; });
    fetch('data/atlas/ships.json').then((r) => (r.ok ? r.json() : null)).then((j) => { M.ships = j?.ships ?? j ?? []; if (S.tab === 'cargo') renderCargo(); }).catch(() => {});
    return M.loading;
  }
  const links = () => (geo() ? jumpLinks(geo()) : []);
  const ranks = () => Object.fromEntries(Object.entries(L()?.context?.()?.ranks ?? {}).map(([c, r]) => [c, rankIndex(r) ?? num(r)]).filter(([, r]) => Number.isInteger(r)));
  /** viste del finder: contratti tuoi e osservazioni storiche (dall'atlante) + catalogo completo 2.0 */
  function finderViews() {
    const own = (A()?.views?.() ?? []).filter((v) => v.origin !== 'catalogo');
    return [...own, ...(M.views ?? [])];
  }
  const viewById = (id) => A()?.index?.()?.byId.get(id) ?? finderViews().find((v) => v.id === id) ?? null;
  const caps = () => {
    const sc = shipCaps(state.ship ?? DEFAULT_SHIP, M.ships);
    return { ...sc, scu: num(S.form.maxScu) ?? sc.scu };
  };
  const evalOne = (v) => findMissions([v], { ship: caps(), profile: { ranks: ranks() }, includeIncompatible: true }, { geo: geo(), links: links() }).rows[0] ?? null;

  // ---------------------------------------------------------------- striscia di stato
  // Due sole domande in evidenza: DOVE SEI e DOVE VAI. Il sistema non e' un dato a parte: e' quello
  // della posizione (il selettore in alto la segue). Se divergono lo diciamo e chiediamo quale vale.
  const VIA = { ricerca: 'dalla ricerca della plancia', mappa: 'dalla mappa della plancia', destinazioni: 'da DESTINAZIONI', missione: 'da una missione' };
  function renderBar() {
    const pos = state.position; const d = state.destination; const p = planSummary(state.lastPlan);
    const prov = provenance(M.res);
    const routeTxt = p ? `${d && p.target !== d.name ? '<span class="warn">porta a un\'altra meta</span> · ' : ''}${p.qtLegs} QT · ${p.jumps} salti` : '<span class="hm-nd">nessuna</span>';
    const posTxt = pos
      ? `${pos.place ? esc(pos.place.name) : 'punto XYZ'} <span class="cb-sys-tag">${esc(SYS[pos.system] ?? pos.system)}</span>`
      : `<span class="warn">non impostata</span>`;
    const destTxt = d
      ? `<button class="link" id="cb-dest-go" title="Mostra la destinazione su mappa e pannello${d.via ? ` · impostata ${esc(VIA[d.via] ?? d.via)}` : ''} · ${fmtDT(d.at)}">${esc(d.name)} <span class="cb-sys-tag">${esc(SYS[d.system] ?? d.system ?? '?')}</span></button> <button class="small cb-x" id="cb-dest-x" title="Togli la destinazione">✕</button>`
      : '<span class="hm-nd">nessuna · cercala a destra o clic su un luogo della mappa</span>';
    $('hm-bar').innerHTML = `
      <div class="cb-chip cb-where"><span>📍 Dove sei</span><b>${posTxt}</b>
        <input id="cb-pos-q" list="cb-places" placeholder="${pos ? 'cambia…' : 'città, stazione, avamposto…'}" autocomplete="off" aria-label="Dove sei"><datalist id="cb-places"></datalist>
        <button class="small" id="hm-paste" title="Incolla la riga di /showlocation">📋</button></div>
      <div class="cb-chip cb-where"><span>🎯 Destinazione</span><b>${destTxt}</b></div>
      <div class="cb-chip"><span>Nave</span><b><button class="link" id="cb-ship-tog" title="Scheda tecnica (file di gioco)">${esc(state.ship ?? DEFAULT_SHIP)} ▾</button></b></div>
      <div class="cb-chip"><span>Rotta</span><b>${routeTxt}</b></div>
      <div class="cb-chip cb-dim"><span>Dati</span><b>${prov.ok ? `${esc(prov.version)} · ${esc(String(prov.date).slice(0, 10))}${prov.stale ? ' <span class="warn">⚠</span>' : ''}` : `<span class="hm-nd">${M.res ? 'n.d.' : 'in caricamento'}</span>`}</b></div>`;
    $('cb-ship-tog').onclick = () => { $('cb-ship').hidden = !$('cb-ship').hidden; if (!$('cb-ship').hidden) renderShip(); };
    $('hm-paste').onclick = pastePosition;
    const q = $('cb-pos-q'); const g = geo();
    q.oninput = () => { const list = g ? g.search(q.value, { limit: 25 }) : []; $('cb-places').innerHTML = list.map((x) => `<option value="${esc(x.name)}">${esc(g.pathLabel(x.id))}</option>`).join(''); };
    q.onchange = async () => { const x = g?.resolveName(q.value.trim()) ?? g?.search(q.value, { limit: 1 })[0]; if (x) await setPlace(x.id); };
    if (d) {
      $('cb-dest-go').onclick = () => { S.ctx = { type: 'auto' }; S.focus = null; S.mapSys = d.system && d.system !== mapSystem() ? d.system : S.mapSys; S.refit = true; renderMap(); renderCtx(); $('cb-side').scrollTop = 0; };
      $('cb-dest-x').onclick = () => state.setDestination(null);
    }
    renderSync();
  }
  /** posizione = luogo scelto: XYZ del luogo nei dati, mai inventate */
  async function setPlace(id) {
    const p = geo()?.get(id); if (!p) return;
    S.mapSys = 'auto';
    await state.setPosition({ system: p.system, x: p.pos?.x ?? null, y: p.pos?.y ?? null, z: p.pos?.z ?? null, source: 'luogo', place: { id: p.id, name: p.name } });
  }
  /** Il selettore SISTEMA in alto (o l'ATLANTE) e' su un sistema diverso da dove sei: chiedi quale vale. */
  function renderSync() {
    const box = $('hm-sync'); const pos = state.position; const sys = app.system();
    if (!pos || !pos.system || pos.system === sys) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<b>⚠ In alto è selezionato ${esc(SYS[sys] ?? sys)}, ma la tua posizione è ${pos.place ? esc(pos.place.name) : 'un punto'} (${esc(SYS[pos.system] ?? pos.system)}).</b>
      <span>Dove sei davvero?</span>
      <button class="primary small" id="cb-sync-pick">Sono in ${esc(SYS[sys] ?? sys)}: scelgo dove</button>
      <button class="small" id="cb-sync-back">Sono ancora a ${pos.place ? esc(pos.place.name) : esc(SYS[pos.system] ?? pos.system)}</button>`;
    $('cb-sync-pick').onclick = () => { const q = $('cb-pos-q'); q.value = ''; q.placeholder = `luogo in ${SYS[sys] ?? sys}…`; q.focus(); S.mapSys = sys; S.refit = true; renderMap(); };
    $('cb-sync-back').onclick = () => app.switchSystem?.(pos.system);
  }

  // ---------------------------------------------------------------- posizione
  function posContext(pos) {
    if (!pos) return null;
    const markers = pos.system === app.system() ? [...(app.points()?.values() ?? [])] : [];
    const mk = nearestMarker(pos, markers);
    const g = geo(); const body = nearestBody(pos, g?.places ?? [], pos.system);
    return { mk, body, markersLoaded: markers.length > 0 };
  }
  function renderPosition() {
    const pos = state.position; const c = posContext(pos);
    $('hm-pos').innerHTML = pos ? `<div class="hm-kv">${pos.place ? `
        <span>Luogo</span><b>${esc(pos.place.name)} <span class="hint">scelto da te: XYZ = posizione del luogo nei dati</span></b>` : ''}
        <span>XYZ</span><b class="mono">${['x', 'y', 'z'].map((k) => fmtKm(pos[k])).join(' · ')}</b>
        <span>Corpo vicino</span><b>${c.body ? `${esc(c.body.name)} <span class="hint">${c.body.d < 0 ? `sotto la superficie secondo il raggio noto (${fmtD(-c.body.d)}): coordinate da ricontrollare` : `${fmtD(c.body.d)} ${c.body.fromSurface ? 'dalla superficie' : 'dal centro'}`}</span>` : '<span class="hm-nd">n.d.</span>'}</b>
        <span>Marker QT</span><b>${c.mk ? `${esc(c.mk.name)} <span class="hint">${fmtD(c.mk.d)}</span>` : `<span class="hm-nd">${c.markersLoaded ? 'nessuno' : 'posizioni QT non caricate'}</span>`}</b></div>`
      : '<p class="hint">Nel gioco: <code>/showlocation</code>, copia la riga delle coordinate e premi 📋 nella barra in alto. Senza posizione la plancia funziona lo stesso: distanze e partenza restano da indicare.</p>';
    $('hm-pos-clear').hidden = !pos;
    $('hm-pos-sum').textContent = pos ? `POSIZIONE · ${SYS[pos.system] ?? pos.system}` : `POSIZIONE · ${NOT_SET}`;
  }
  async function pastePosition() {
    let text = null;
    try { if (navigator.clipboard?.readText) text = await navigator.clipboard.readText(); } catch { text = null; }
    $('hm-pos-box').open = true;
    if (text === null) { $('hm-pos-manual').open = true; $('hm-pos-text').focus(); $('hm-pos-msg').innerHTML = '<span class="warn">Il browser non ha concesso la lettura degli appunti: incolla qui con Ctrl+V.</span>'; return; }
    $('hm-pos-text').value = text; setPositionFromText(text);
  }
  async function setPositionFromText(text) {
    const r = parsePosition(text, { unit: $('hm-pos-unit').value });
    if (r.error) { $('hm-pos-manual').open = true; $('hm-pos-msg').innerHTML = `<span class="err">${esc(r.error)}</span>`; return; }
    const sys = $('hm-pos-sys').value || app.system();
    await state.setPosition({ system: sys, x: r.x, y: r.y, z: r.z, source: r.source });
    $('hm-pos-msg').innerHTML = `<span class="ok">Posizione impostata (${esc(SYS[sys])}).</span> <span class="hint">Il sistema non è nel testo di /showlocation: controlla che sia giusto.</span>`;
  }

  // ---------------------------------------------------------------- nave (scheda espandibile)
  function findShip(name) {
    const list = ix()?.ships ?? []; const q = String(name ?? '').trim().toLowerCase();
    return list.find((s) => s.name.toLowerCase() === q) ?? (q ? list.find((s) => s.name.toLowerCase().includes(q)) : null) ?? null;
  }
  function renderShip() {
    const name = state.ship ?? DEFAULT_SHIP; const ship = findShip(name);
    $('hm-ship-in').value = name;
    const sh = shipSheet(ship, state.shipNote(name)); const c = caps();
    $('hm-ship').innerHTML = `<p><b>Per il cargo:</b> ${c.scu ? `${c.scu} SCU` : 'stiva n.d.'} · cassa massima ${c.maxBox ? `${c.maxBox} SCU` : 'n.d.'} <span class="hint">${esc(c.source ?? 'fonte n.d.')}</span></p>`
      + (sh ? `<div class="hm-kv cb-kv2">${sh.rows.map((r) => `<span>${esc(r.label)}</span><b>${r.value === null ? '<span class="hm-nd">non nei dati</span>' : esc(r.value)}</b>`).join('')}</div>
      <p class="hint">${esc(sh.source)} Carburante, scudi e danni non vengono mostrati: NAVCOM non legge la telemetria del gioco.</p>`
      : ix() ? `<p class="warn">"${esc(name)}" non trovata nei file di gioco caricati.</p>` : '<p class="hint">Dati delle navi in caricamento…</p>');
    $('hm-ship-note').value = state.shipNote(name);
  }

  // ---------------------------------------------------------------- mappa
  const view = new AtlasView($('cb-canvas'), { onPick, onHover });
  if (!view.ok) $('cb-legend').textContent = 'Il browser non permette di disegnare la mappa.';
  try { if (localStorage.getItem('navcom.atlas.gl') === '0') view.setGL(false); } catch { /* */ }
  const mapSystem = () => (S.mapSys !== 'auto' ? S.mapSys : state.position?.system ?? state.destination?.system ?? app.system());
  function mapMissions() {
    const ids = new Set([...(A()?.selection?.() ?? []), ...(S.focus ? [S.focus] : [])]);
    return [...ids].map(viewById).filter(Boolean);
  }
  function renderMap() {
    const g = geo(); if (!g || !view.ok) { $('cb-legend').textContent = g ? '' : 'Mappa in caricamento (atlante)…'; return; }
    const sys = mapSystem();
    const sc = bridgeScene({ geo: g, system: sys, position: state.position, destination: state.destination, lastPlan: state.lastPlan, missions: mapMissions(), focus: S.focus, links: links(), outposts: S.outposts });
    const star = g.star(sys);
    view.setScene({ items: sc.items, lines: sc.lines, clusterRadius: 14, star: star?.pos ? { pos: star.pos, radius: star.radius ?? null } : null });
    if (S.refit) {
      const near = sc.frameOn.length >= 2 ? sc.frameOn : null;
      view.frame(near ?? sc.items.filter((i) => i.kind === 'planet' || i.kind === 'gateway').map((i) => i.pos), near ? null : star?.pos ?? null);
      S.refit = false;
    }
    const used = new Set(sc.lines.map((l) => l.style));
    const focusNote = S.focus && !sc.lines.some((l) => l.id === `ms:${S.focus}`) ? '<br><span class="warn">Missione evidenziata: nessuna linea disegnabile in questo sistema (pool troppo ampio, luoghi senza XYZ o in un altro sistema). Vedi l\'elenco a destra.</span>' : '';
    const here = state.position?.system ?? null;
    $('cb-sys').options[0].textContent = here ? `dove sei (${SYS[here] ?? here})` : 'dove sei';
    $('cb-sys').value = S.mapSys;
    $('cb-home').hidden = !here || sys === here;
    $('cb-home').textContent = here ? `↺ torna a ${SYS[here] ?? here}` : '↺ torna dove sei';
    $('cb-legend').innerHTML = `<b>${esc(SYS[sys] ?? sys)}</b> · posizioni reali dai file di gioco${here && here !== sys ? ` · <span class="cb-alert">stai guardando ${esc(SYS[sys] ?? sys)}, ma sei in ${esc(SYS[here] ?? here)}</span>` : ''}${LEGEND.filter(([k]) => used.has(k)).map(([k, t]) => `<br><span style="color:${LINE_STYLE[k].c}">━</span> ${esc(t)}`).join('')}${focusNote}`;
  }
  function onHover(h) {
    const el = $('cb-hover');
    if (!h) { el.style.display = 'none'; return; }
    let t = '';
    if (h.kind === 'place') t = h.id === '__pos' ? 'La tua posizione (inserita da te)' : esc(geo()?.get(h.id)?.name ?? '');
    else if (h.kind === 'cluster') t = `${h.cluster.members.length} luoghi vicini: clic per avvicinarti`;
    else if (h.kind === 'line' && h.id?.startsWith('ms:')) t = `${esc(viewById(h.id.slice(3))?.title ?? 'missione')}: clic per i dettagli`;
    else if (h.kind === 'line' && h.id === 'jump') t = 'Indicazione schematica: verso il gateway del salto (non una rotta calcolata)';
    else if (h.kind === 'line' && h.id === 'straight') t = 'Linea retta: non è il percorso QT';
    el.innerHTML = t; el.style.display = t ? 'block' : 'none';
  }
  function onPick(h) {
    if (!h) return;
    if (h.kind === 'place' && h.id !== '__pos' && geo()?.get(h.id)) { S.ctx = { type: 'place', id: h.id }; renderCtx(); }
    else if (h.kind === 'line' && h.id?.startsWith('ms:')) openMission(h.id.slice(3));
  }

  // ---------------------------------------------------------------- pannello contestuale
  function destCard(d) {
    const x = ix(); if (!x || !d?.id) return null;
    try { const card = x.card(d.id); return card ? { card, prep: x.prepare(card, findShip(state.ship), { activity: 'trasporto' }) } : null; } catch { return null; }
  }
  function missionsAt(id) {
    const at = A()?.index?.()?.at.get(id);
    if (!at) return null;
    const n = (a) => new Set(a.map((e) => e.v.id)).size;
    return { out: n(at.out), in: n(at.in), offer: n(at.offer ?? []) };
  }
  function renderCtx() {
    const box = $('cb-ctx');
    if (S.ctx.type === 'mission') return renderMissionCtx(box, S.ctx.id);
    if (S.ctx.type === 'place') return renderPlaceCtx(box, S.ctx.id);
    const d = state.destination;
    if (!d) return renderSuggestions(box);
    const pos = state.position; const dist = straightDistance(pos, d);
    const fromSys = pos?.system ?? app.system();
    const jump = geo() ? nextJump(fromSys, d.system, { geo: geo(), links: links(), pos: pos?.system === fromSys ? pos : null }) : null;
    const leg = nextLeg(state.lastPlan, d); const p = planSummary(state.lastPlan);
    const dc = destCard(d); const mc = d.id ? missionsAt(d.id) : null;
    const warn = [];
    if (!d.pos) warn.push('La destinazione non ha XYZ di sistema: niente calcolo QT (NAVCOM non genera coordinate).');
    if (leg && !leg.matches) warn.push(`L'ultima rotta calcolata porta a "${leg.target}", non a questa destinazione.`);
    if (!pos) warn.push('Posizione non impostata: distanza e partenza non note.');
    box.innerHTML = `<div class="cb-head"><span class="hm-type">DESTINAZIONE</span><h3>${esc(d.name)}</h3><span class="hint">${esc(d.kind ?? '')} · ${esc(SYS[d.system] ?? d.system ?? '—')}${geo()?.get(d.id) ? ` · ${esc(geo().pathLabel(d.id))}` : ''}</span>
        <div class="hint">Impostata ${d.via ? esc(VIA[d.via] ?? d.via) + ' · ' : ''}${fmtDT(d.at)}${pos && d.system && pos.system !== d.system ? ` · <span class="cb-alert">⚠ in un altro sistema rispetto a dove sei (${esc(SYS[pos.system] ?? pos.system)})</span>` : ''}</div></div>
      <div class="hm-kv">
        <span>Distanza</span><b>${dist.d !== null ? `${fmtD(dist.d)} <span class="hint">${esc(dist.note)}</span>` : `<span class="hm-nd">${esc(dist.note)}</span>`}</b>
        <span>Salto</span><b>${jump ? (jump.gateway ? `${esc(jump.gateway.name)}${jump.distance !== null ? ` <span class="hint">${fmtD(jump.distance)} in linea retta</span>` : ''}<br><span class="hint">${esc(jump.note)}</span>` : `<span class="warn">${esc(jump.note)}</span>`) : '<span class="hint">stesso sistema: nessun salto</span>'}</b>
        <span>Prossima tratta</span><b>${leg?.matches ? `${esc(leg.to ?? '—')} <span class="hint">${leg.kind === 'qt-drop' || leg.drop ? 'con uscita dal QT (interruzione)' : leg.kind === 'jump' ? 'salto' : 'QT diretto'}</span>` : '<span class="hint">nessuna rotta calcolata verso questa meta</span>'}</b>
        ${p && leg?.matches ? `<span>Rotta QT</span><b>${p.qtLegs} tratte · ${p.drops} uscit${p.drops === 1 ? "a" : "e"} · ${p.jumps} salt${p.jumps === 1 ? "o" : "i"} · ${fmtT(p.time)}<br><span class="hint">residuo ${fmtD(p.residual)} · ${esc(p.status ?? '')} · calcolata ${fmtDT(p.at)}</span></b>` : ''}
        ${mc ? `<span>Missioni nei dati</span><b>${mc.out} in uscita · ${mc.in} in entrata · ${mc.offer} offerte qui <span class="hint">(modelli e contratti tuoi, non offerte attive)</span></b>` : ''}
      </div>
      ${warn.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
      <div class="cb-actions"><button class="primary" id="cb-plan" ${d.pos ? '' : 'disabled'}>🛰 CALCOLA ROTTA</button><button id="cb-info">📚 APRI DESTINAZIONE</button><button id="cb-exp">📦 PREPARA SPEDIZIONE</button></div>
      ${dc ? `<details class="cb-sec" ${state.bridge.condOpen ? 'open' : ''} id="cb-cond"><summary>Condizioni e avvisi</summary>
        ${dc.prep.documented.slice(0, 5).map((x) => `<p class="ok">• ${esc(x.text)}</p>`).join('')}
        ${dc.prep.advice.slice(0, 5).map((x) => `<p class="warn">• ${esc(x.text)}</p>`).join('')}
        ${dc.prep.missing.length ? `<p class="hint">Non documentato: ${esc(dc.prep.missing.slice(0, 6).map((x) => x.text.split(':')[0]).join(', '))}${dc.prep.missing.length > 6 ? '…' : ''}. Nessun pericolo documentato non significa località sicura.</p>` : ''}</details>` : '<p class="hint">Condizioni: apri la scheda della destinazione (archivio in caricamento o luogo non abbinato).</p>'}
      <div class="row wrap"><button class="small" id="cb-atlas" ${d.id && geo()?.get(d.id) ? '' : 'disabled'}>🌌 nell'atlante</button><button class="small" id="cb-dclear">togli destinazione</button></div>`;
    $('cb-plan').onclick = planToDest;
    $('cb-info').onclick = () => { if (d.id) app.dest()?.open(d.id); else app.dest()?.openPoint({ ...d.pos, name: d.name, system: d.system, unit: 'm' }); };
    $('cb-exp').onclick = prepareExpedition;
    $('cb-atlas').onclick = () => app.openAtlas(d.id);
    $('cb-dclear').onclick = () => state.setDestination(null);
    if ($('cb-cond')) $('cb-cond').ontoggle = () => state.setBridge({ condOpen: $('cb-cond').open });
  }
  function renderSuggestions(box) {
    const recent = state.recent.slice(0, 5); const fav = state.fav.slice(0, 5);
    box.innerHTML = `<div class="cb-head"><span class="hm-type">NESSUNA DESTINAZIONE</span><h3>Dove vuoi andare?</h3><span class="hint">Cerca qui sopra e premi 🎯, oppure clic su un luogo della mappa.</span></div>
      ${recent.length ? `<h4>Recenti</h4>${recent.map((r) => `<div class="hm-res"><button class="link" data-act="ctx" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${fmtDT(r.at)}</span></div>`).join('')}` : ''}
      ${fav.length ? `<h4>Preferiti</h4>${fav.map((f) => `<div class="hm-res"><button class="link" data-act="ctx" data-id="${esc(f.id)}">${esc(f.name)}</button> <span class="hint">${esc(SYS[f.system] ?? f.system ?? '')}</span></div>`).join('')}` : ''}
      <h4>Elenchi documentati</h4><div class="hm-quick">${QUICK.map(([k, l]) => `<button class="small hm-q ${S.list === k ? 'active' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <div id="hm-list-box"></div>
      <p class="hint">Solo luoghi con il dato documentato nelle fonti: se un elenco è vuoto, i dati non lo indicano.</p>`;
    box.querySelectorAll('.hm-q').forEach((b) => { b.onclick = () => { S.list = S.list === b.dataset.k ? null : b.dataset.k; renderCtx(); }; });
    bindActions(box); renderList();
  }
  function renderPlaceCtx(box, id) {
    const g = geo(); const p = g?.get(id); if (!p) { S.ctx = { type: 'auto' }; return renderCtx(); }
    const mc = missionsAt(id); const pos = state.position;
    const d = pos && pos.system === p.system && p.pos ? Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z) : null;
    box.innerHTML = `<div class="cb-head"><span class="hm-type">LUOGO SULLA MAPPA</span><h3>${esc(p.name)}</h3><span class="hint">${esc(g.pathLabel(id))}</span></div>
      <div class="hm-kv"><span>Distanza</span><b>${d !== null ? `${fmtD(d)} <span class="hint">in linea retta dalla tua posizione</span>` : '<span class="hint">posizione non impostata o altro sistema</span>'}</b>
      <span>Missioni nei dati</span><b>${mc ? `${mc.out} partono · ${mc.in} arrivano · ${mc.offer} offerte qui` : '<span class="hint">nessuna nel catalogo dell\'atlante</span>'}</b></div>
      <div class="cb-actions"><button class="primary" id="cb-p-dest">🎯 IMPOSTA DESTINAZIONE</button><button id="cb-p-from">Missioni DA qui</button><button id="cb-p-to">Missioni VERSO qui</button></div>
      <div class="row wrap"><button class="small" id="cb-p-di">📚 scheda</button><button class="small" id="cb-p-atlas">🌌 atlante (missioni compatibili)</button><button class="small" id="cb-back">← torna</button></div>`;
    $('cb-p-dest').onclick = async () => { const dd = destFromId(id); if (dd) { S.ctx = { type: 'auto' }; await state.setDestination({ ...dd, via: 'mappa' }); await state.addRecent(dd); } };
    $('cb-p-from').onclick = () => { setForm({ from: p.name }); showTab('missions'); runFinder(); };
    $('cb-p-to').onclick = () => { setForm({ to: p.name }); showTab('missions'); runFinder(); };
    $('cb-p-di').onclick = () => app.dest()?.open(id);
    $('cb-p-atlas').onclick = () => app.openAtlas(id);
    $('cb-back').onclick = () => { S.ctx = { type: 'auto' }; renderCtx(); };
  }
  function planToDest() {
    const d = state.destination; if (!d?.pos) return;
    const pos = state.position;
    app.planTo({ name: d.name, system: d.system, x: d.pos.x, y: d.pos.y, z: d.pos.z, unit: 'm', start: pos && pos.system === d.system ? { system: pos.system, x: pos.x, y: pos.y, z: pos.z } : null });
  }
  /** PREPARA SPEDIZIONE: missioni verso la destinazione dal sistema in cui sei; poi CARGO. */
  function prepareExpedition() {
    const d = state.destination; if (!d) return;
    const fromSys = state.position?.system ?? app.system();
    setForm({ from: SYS[fromSys] ?? '', to: d.name });
    showTab('missions'); runFinder();
    $('cb-bottom').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------------------------------------------------------- ricerca universale
  const kindBadge = (t) => `<span class="hm-type">${esc(t)}</span>`;
  function renderSearch() {
    const x = ix(); const q = $('hm-q').value.trim(); const box = $('hm-results');
    if (!q) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    if (!x) { box.innerHTML = '<p class="hint">Archivio delle destinazioni in caricamento…</p>'; return; }
    const t0 = performance.now();
    const sys = $('hm-q-sys').value || null;
    const r = x.universal(q, { system: sys, limit: 5 });
    const ms = Math.round(performance.now() - t0);
    const rowsHtml = (g) => g.rows.map((row) => {
      switch (g.type) {
        case 'place': case 'personal': return `<div class="hm-res">${kindBadge(g.type === 'personal' ? 'Punto personale' : row.kindLabel)}<button class="link" data-act="open" data-id="${esc(row.id)}">${esc(row.name)}</button> <span class="hint">${esc(row.systemLabel)}${row.body ? ` › ${esc(row.body)}` : ''}${row.hasXyz ? '' : ' · senza XYZ'}</span>
          <span class="hm-acts">${row.hasXyz ? `<button class="small" data-act="dest" data-id="${esc(row.id)}" title="Imposta come destinazione">🎯</button>` : ''}${row.origin !== 'uex' && !row.id.startsWith('pt:') ? `<button class="small" data-act="map" data-id="${esc(row.id)}" title="Mostra sulla mappa della plancia">🗺</button>` : ''}</span></div>`;
        case 'service': return `<div class="hm-res">${kindBadge('Servizio')}<button class="link" data-act="list" data-key="${esc(row.key)}">${esc(row.name)}</button> <span class="hint">${row.count} luoghi documentati</span></div>`;
        case 'shop': return `<div class="hm-res">${kindBadge(row.typeLabel)}<button class="link" data-act="shop" data-id="${esc(row.id)}">${esc(row.name)}</button> <span class="hint">${row.area ? `${esc(row.area)} · ` : ''}${row.place ? esc(row.place.name) : 'luogo non abbinato'}</span></div>`;
        case 'item': return `<div class="hm-res">${kindBadge(`Articolo · ${row.cat}`)}<button class="link" data-act="item" data-q="${esc(row.name)}">${esc(row.name)}</button> <span class="hint">${row.shops} negozi in ${row.places} luoghi</span></div>`;
        case 'commodity': return `<div class="hm-res">${kindBadge('Merce')}<button class="link" data-act="sell" data-q="${esc(row.name)}">${esc(row.name)}</button>${row.illegal ? ' <span class="di-pill bad">illegale</span>' : ''} <span class="hint">dove venderla</span></div>`;
        case 'mineral': return `<div class="hm-res">${kindBadge('Minerale')}<b>${esc(row.name)}</b> <span class="hint">${esc(row.kinds.join(', '))}</span></div>`;
        default: return '';
      }
    }).join('');
    box.innerHTML = r.groups.length ? `${r.groups.map((g) => `<div class="hm-group"><h4>${esc(g.label)}</h4>${rowsHtml(g)}</div>`).join('')}<p class="hint">${ms} ms</p>`
      : `<p class="hint">Nessun risultato per "${esc(q)}".</p>`;
    bindActions(box);
  }
  function destFromId(id) {
    const x = ix(); const g = geo();
    if (x) {
      const d = x.describe(id);
      if (d) {
        let pos = null;
        if (id.startsWith('pt:')) pos = x.personal.get(id)?.pos ?? null; else if (!id.startsWith('uex:')) pos = x.geo.get(id)?.pos ?? null;
        return { id, name: d.name, system: d.system, pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, kind: d.kindLabel };
      }
    }
    const p = g?.get(id);
    return p ? { id, name: p.name, system: p.system, pos: p.pos ? { x: p.pos.x, y: p.pos.y, z: p.pos.z } : null, kind: p.kind } : null;
  }
  function bindActions(box) { box.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset); }); }
  async function act({ act: a, id, key, q }) {
    const dest = app.dest();
    if (a === 'open') { await state.addRecent(destFromId(id) ?? { id, name: id }); return dest?.open(id); }
    if (a === 'dest') { const d = destFromId(id); if (d) { S.ctx = { type: 'auto' }; await state.setDestination({ ...d, via: 'ricerca' }); await state.addRecent(d); } return; }
    if (a === 'ctx') { if (geo()?.get(id)) { S.ctx = { type: 'place', id }; renderCtx(); return; } return dest?.open(id); }
    if (a === 'map') { const p = geo()?.get(id); if (p) { S.mapSys = p.system; $('cb-sys').value = p.system; S.ctx = { type: 'place', id }; renderMap(); renderCtx(); if (p.pos) view.frame([p.pos]); } return; }
    if (a === 'list') { S.list = key; S.ctx = { type: 'auto' }; if (state.destination) S.ctx = { type: 'auto' }; renderSuggestions($('cb-ctx')); return; }
    if (a === 'shop') return dest?.openShop(id);
    if (a === 'item') return dest?.runItem(q);
    if (a === 'sell') return dest?.runSell(q);
    if (a === 'route') app.showTab('saved');
  }
  function renderList() {
    const box = $('hm-list-box'); if (!box) return; const x = ix();
    if (!S.list) { box.innerHTML = ''; return; }
    if (S.list === 'fav') {
      box.innerHTML = state.fav.length ? `<div class="hm-list">${state.fav.map((f) => `<div class="hm-res">${kindBadge(f.kind ?? 'luogo')}<button class="link" data-act="open" data-id="${esc(f.id)}">${esc(f.name)}</button></div>`).join('')}</div>` : '<p class="hint">Nessun preferito: usa ☆ nella scheda di una destinazione.</p>';
      bindActions(box); return;
    }
    if (!x) { box.innerHTML = '<p class="hint">Archivio delle destinazioni in caricamento…</p>'; return; }
    const sys = S.listSys === 'current' ? app.system() : S.listSys || null;
    const rows = x.listBy(S.list, { system: sys });
    box.innerHTML = `<div class="row wrap"><b>${esc(SERVICE_FILTERS[S.list].label)} · ${rows.length}</b>
      <select id="hm-list-sys" style="flex:0 1 150px"><option value="current" ${S.listSys === 'current' ? 'selected' : ''}>sistema attuale</option><option value="" ${S.listSys === '' ? 'selected' : ''}>tutti</option>${Object.entries(SYS).map(([k, v]) => `<option value="${k}" ${S.listSys === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="hm-list">${rows.map((r) => `<div class="hm-res"><button class="link" data-act="open" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${esc(r.systemLabel)}${r.body ? ` › ${esc(r.body)}` : ''}</span>${r.hasXyz ? `<span class="hm-acts"><button class="small" data-act="dest" data-id="${esc(r.id)}" title="Imposta come destinazione">🎯</button></span>` : ''}</div>`).join('') || '<p class="hint">Nessun luogo documentato.</p>'}</div>`;
    $('hm-list-sys').onchange = () => { S.listSys = $('hm-list-sys').value; renderList(); };
    bindActions(box);
  }

  // ---------------------------------------------------------------- viste in basso
  function showTab(k) {
    S.tab = k; if (state.bridge.tab !== k) state.setBridge({ tab: k });
    document.querySelectorAll('[data-cbt]').forEach((b) => b.classList.toggle('active', b.dataset.cbt === k));
    document.querySelectorAll('.cbb').forEach((d) => d.classList.toggle('active', d.id === `cb-b-${k}`));
    if (k === 'cargo') renderCargo();
    if (k === 'activity') renderActivity();
    if (k === 'missions' && !S.result) runFinder();
  }
  function renderProv() {
    const p = provenance(M.res);
    $('ms-prov').innerHTML = p.ok ? `<span class="${p.stale ? 'warn' : 'hint'}">${esc(p.text)}</span>${p.liveDefault && p.liveDefault !== p.patch ? ` <span class="warn">· LIVE attuale secondo la Wiki: ${esc(p.liveDefault)}</span>` : ''}`
      : `<span class="warn">${esc(M.res?.warnings?.[0] ?? (M.res ? 'Mission Database non caricato' : 'Mission Database in caricamento…'))}</span>`;
    $('ms-warn').innerHTML = M.res?.cat ? (M.res.warnings ?? []).map((w) => `<p class="warn">${esc(w)}</p>`).join('') : '';
  }

  // ---------------------------------------------------------------- MISSION FINDER
  function formHtml() {
    const f = S.form; const cats = M.res?.cat?.meta?.byCategory ?? {};
    return `<div class="cb-form">
      <label>DA <input id="mf-from" list="at-places" value="${esc(f.from)}" placeholder="sistema, pianeta, stazione o base"></label>
      <label>VERSO <input id="mf-to" list="at-places" value="${esc(f.to)}" placeholder="facoltativo"></label>
      <label>RICOMPENSA MIN. <input id="mf-rew" inputmode="numeric" value="${esc(f.minReward)}" placeholder="aUEC"></label>
      <label>NAVE <input id="mf-ship" list="di-ships" value="${esc(state.ship ?? DEFAULT_SHIP)}"></label>
      <label>CARICO MAX <input id="mf-scu" inputmode="numeric" value="${esc(f.maxScu)}" placeholder="${shipCaps(state.ship ?? DEFAULT_SHIP, M.ships).scu ?? 'SCU'}"></label>
      <label>RISCHIO <select id="mf-risk">${RISK.map(([k, l]) => `<option value="${k}" ${String(f.risk) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="cb-cats"><b>TIPO</b> ${Object.entries(CATEGORY_LABEL).filter(([k]) => cats[k] || k === 'hauling' || k === 'delivery').map(([k, l]) => `<label class="check"><input type="checkbox" data-cat="${k}" ${f.cats.includes(k) ? 'checked' : ''}>${esc(l)}${cats[k] ? ` <span class="hint">${cats[k]}</span>` : ''}</label>`).join('')}</div>
      <div class="row wrap"><label class="check"><input type="checkbox" id="mf-legal" ${f.legalOnly ? 'checked' : ''}>solo legali</label>
        <label class="check"><input type="checkbox" id="mf-unk" ${f.unknownReward ? 'checked' : ''}>con ricompensa minima, includi le dinamiche</label>
        <label class="check"><input type="checkbox" id="mf-col" ${f.collapse ? 'checked' : ''}>una riga per modello (varianti raggruppate)</label>
        <button id="mf-go" class="primary" style="width:auto">CERCA</button><button id="mf-reset" class="small">azzera</button></div>`;
  }
  function readForm() {
    const f = S.form;
    f.from = $('mf-from').value.trim(); f.to = $('mf-to').value.trim(); f.minReward = $('mf-rew').value.trim(); f.maxScu = $('mf-scu').value.trim(); f.risk = $('mf-risk').value;
    f.legalOnly = $('mf-legal').checked; f.unknownReward = $('mf-unk').checked; f.collapse = $('mf-col').checked;
    f.cats = [...document.querySelectorAll('[data-cat]')].filter((x) => x.checked).map((x) => x.dataset.cat);
    const ship = $('mf-ship').value.trim();
    if (ship && ship !== state.ship) state.setShip(findShip(ship)?.name ?? ship);
    state.setBridge({ form: { ...f } });
  }
  function setForm(patch) { Object.assign(S.form, patch); S.shown = PAGE; renderFinderForm(); state.setBridge({ form: { ...S.form } }); }
  function renderFinderForm() {
    $('mf-form').innerHTML = formHtml();
    $('mf-go').onclick = () => { readForm(); S.shown = PAGE; runFinder(); };
    $('mf-reset').onclick = () => { setForm({ from: '', to: '', minReward: '', maxScu: '', risk: 'any', legalOnly: false, cats: ['hauling', 'delivery'] }); runFinder(); };
    for (const id of ['mf-from', 'mf-to', 'mf-rew', 'mf-scu']) $(id).onkeydown = (e) => { if (e.key === 'Enter') $('mf-go').click(); };
    for (const id of ['mf-risk', 'mf-legal', 'mf-unk', 'mf-col', 'mf-ship']) $(id).onchange = () => $('mf-go').click();
    document.querySelectorAll('[data-cat]').forEach((x) => { x.onchange = () => $('mf-go').click(); });
  }
  function runFinder() {
    const out = $('mf-out');
    if (!M.views) { out.innerHTML = '<p class="hint">Mission Database in caricamento…</p>'; return; }
    const g = geo(); if (!g) { out.innerHTML = '<p class="hint">Atlante in caricamento: serve per riconoscere i luoghi.</p>'; return; }
    const f = S.form; const errs = [];
    const from = f.from ? parseArea(f.from, g) : null; const to = f.to ? parseArea(f.to, g) : null;
    if (from?.error) errs.push(`DA: ${from.error}`);
    if (to?.error) errs.push(`VERSO: ${to.error}`);
    if (errs.length) { out.innerHTML = errs.map((e) => `<p class="err">${esc(e)} (usa un nome dell'elenco).</p>`).join(''); return; }
    const c = caps();
    const t0 = performance.now();
    const r = findMissions(finderViews(), {
      from, to, categories: f.cats.length ? new Set(f.cats) : null, minReward: num(f.minReward) ?? 0, ship: { scu: c.scu, maxBox: c.maxBox }, maxScu: num(f.maxScu),
      risk: f.risk === 'any' || f.risk === 'nocombat' ? f.risk : +f.risk, legalOnly: f.legalOnly, includeUnknownReward: f.unknownReward, profile: { ranks: ranks() },
    }, { geo: g, links: links(), limit: 5000 });
    S.result = { ...r, rows: f.collapse ? collapseVariants(r.rows) : r.rows, ms: Math.round(performance.now() - t0), from, to };
    renderResults();
  }
  const rewardHtml = (v) => {
    const ri = v.rewardInfo ?? { kind: v.reward ? 'fissa' : 'nd', min: v.reward };
    if (ri.kind === 'fissa') return fmtA(ri.min ?? v.reward);
    if (ri.kind === 'intervallo') return `${fmtA(ri.min)} – ${fmtA(ri.max)}`;
    if (ri.kind === 'dinamica') return '<span class="hint" title="calcolata dal gioco al momento dell\'offerta: non è nei file">dinamica</span>';
    return v.reward ? fmtA(v.reward) : '<span class="hint">n.d.</span>';
  };
  function roleCell(v, role, match) {
    const ops = v.ops.filter((o) => o.role === role);
    if (!ops.length) return '<span class="hint">non nei dati</span>';
    const g = geo();
    const parts = ops.map((o) => {
      const cand = [...new Set([...o.ids, ...(o.alt ?? [])])];
      if (o.fixed) return esc(g.get(o.ids[0])?.name ?? '?');
      if (cand.length) return `<span class="hint">uno fra ${cand.length}${o.unresolved?.length ? ` (+${o.unresolved.length} non riconosciuti)` : ''}</span>`;
      return `<span class="warn">${esc(o.unresolved?.[0] ?? 'sconosciuto')}</span>`;
    });
    const uniq = [...new Set(parts)];
    const tag = match === 'certo' ? ' <span class="at-pill sure">certo</span>' : match === 'possibile' ? ' <span class="at-pill maybe">possibile</span>' : '';
    return (uniq.length > 2 ? `${uniq.slice(0, 2).join(', ')} <span class="hint">+${uniq.length - 2}</span>` : uniq.join(', ')) + tag;
  }
  const FIT = { ok: () => '✔ un viaggio', viaggi: (r) => `${r.trips} viaggi`, cassa: () => '<span class="err">casse troppo grandi</span>', nd: () => '<span class="hint">capienza n.d.</span>' };
  function renderResults() {
    const r = S.result; const out = $('mf-out'); if (!r) return;
    const sel = new Set(A()?.selection?.() ?? []); const inAtlas = A()?.index?.()?.byId ?? new Map();
    const ex = Object.entries(r.excluded).map(([k, n]) => `${k} ${n}`).join(' · ');
    const rows = r.rows.slice(0, S.shown);
    const head = `<p class="hint">${r.total} missioni${S.form.collapse ? ` → ${r.rows.length} modelli` : ''} in ${r.ms} ms${ex ? ` · escluse: ${esc(ex)}` : ''}. 🟡 POTENZIALMENTE DISPONIBILE = compatibile con i requisiti noti, <b>non</b> un'offerta attiva: va trovata nel MobiGlas. 🟠 CATALOGATA = requisiti non soddisfatti o non noti (dichiara i gradi in LOGISTICS). 🟤 = osservazione storica di terzi. 🔵🟢 = contratti tuoi.</p>`;
    out.innerHTML = head + (rows.length ? `<div class="tablewrap cb-table"><table><thead><tr><th title="aggiungi al piano cargo">☐</th><th>Classe</th><th>Missione</th><th>Ritiro</th><th>Consegna</th><th>Rotta</th><th>Carico</th><th class="num">Ricompensa</th><th></th></tr></thead><tbody>${rows.map((x) => {
      const v = x.v; const c = CLASS[x.cls.cls];
      return `<tr class="${S.focus === v.id ? 'cb-focus' : ''}"><td><input type="checkbox" data-msel="${esc(v.id)}" ${sel.has(v.id) ? 'checked' : ''} ${inAtlas.has(v.id) ? '' : 'disabled title="nel piano cargo entrano solo trasporti e consegne"'}></td>
        <td title="${esc(c.note)}">${c.icon} <span class="cb-cls">${esc(c.label)}</span></td>
        <td><button class="link" data-mopen="${esc(v.id)}">${esc(v.title)}</button><br><span class="hint">${esc(v.company ?? 'datore n.d.')} · ${esc(CATEGORY_LABEL[v.category] ?? v.category ?? '')}${x.found > 1 ? ` · ${x.found} varianti` : ''}${v.illegal ? ' · <span class="err">illegale</span>' : ''}</span></td>
        <td class="wrapcell">${roleCell(v, 'pickup', x.from)}${!v.ops.some((o) => o.role === 'pickup') && x.offerHere ? ' <span class="hint">(offerta qui)</span>' : ''}</td>
        <td class="wrapcell">${roleCell(v, 'dropoff', x.to)}</td>
        <td><span class="cb-route ${x.route}">${esc(ROUTE[x.route].label)}</span>${x.interstellar ? `<br><span class="hint">${x.path ? esc(x.path.map((s) => SYS[s] ?? s).join(' → ')) : 'interstellare'}</span>` : ''}</td>
        <td>${x.cargo.scu ? `${x.cargo.scuMin && x.cargo.scuMin !== x.cargo.scu ? `${x.cargo.scuMin}–` : ''}${x.cargo.scu} SCU` : '<span class="hint">—</span>'}${x.cargo.box ? `<br><span class="hint">cassa ≤${x.cargo.box}</span>` : ''}${x.cargo.scu ? `<br>${FIT[x.fit](x)}` : ''}</td>
        <td class="num">${rewardHtml(v)}</td>
        <td class="cb-acts"><button class="small" data-mmap="${esc(v.id)}" title="evidenzia sulla mappa">🗺</button><button class="small" data-mcmp="${esc(v.id)}" title="confronta">⚖</button><button class="small" data-mobs="${esc(v.id)}" title="registra come vista nel MobiGlas">📝</button></td></tr>`;
    }).join('')}</tbody></table></div>${r.rows.length > S.shown ? `<button class="small" id="mf-more">Mostra altri ${Math.min(PAGE, r.rows.length - S.shown)} (${S.shown} di ${r.rows.length})</button>` : ''}`
      : '<p class="hint">Nessuna missione nei dati con questi filtri. Prova a togliere la destinazione o ad allargare DA a un sistema.</p>');
    out.querySelectorAll('[data-msel]').forEach((b) => { b.onchange = () => { A()?.toggle(b.dataset.msel, b.checked); renderMap(); renderCargoBadge(); }; });
    out.querySelectorAll('[data-mopen]').forEach((b) => { b.onclick = () => openMission(b.dataset.mopen); });
    out.querySelectorAll('[data-mmap]').forEach((b) => { b.onclick = () => focusMission(b.dataset.mmap); });
    out.querySelectorAll('[data-mcmp]').forEach((b) => { b.onclick = () => addCompare(b.dataset.mcmp); });
    out.querySelectorAll('[data-mobs]').forEach((b) => { b.onclick = () => observeDialog(b.dataset.mobs); });
    if ($('mf-more')) $('mf-more').onclick = () => { S.shown += PAGE; renderResults(); };
    renderCompare();
  }
  function focusMission(id) {
    S.focus = id; S.refit = true;
    const v = viewById(id); const g = geo();
    const sys = v && g ? [...new Set(v.ops.flatMap((o) => o.ids).map((x) => g.get(x)?.system).filter(Boolean))] : [];
    if (sys.length && !sys.includes(mapSystem())) { S.mapSys = sys[0]; $('cb-sys').value = sys[0]; }
    renderMap(); if (S.result) renderResults();
  }
  function openMission(id) { S.ctx = { type: 'mission', id }; S.open = null; focusMission(id); renderCtx(); $('cb-side').scrollTop = 0; }

  // ---------------------------------------------------------------- dettaglio missione (pannello destro)
  function roleBlock(v, role) {
    const g = geo();
    if (role === 'offer') {
      const names = (v.offer ?? []).map((o) => (o.id ? g.get(o.id)?.name : o.name)).filter(Boolean);
      const open = S.open === 'offer' || names.length <= 3;
      return `<div class="cb-role"><b>${ROLE_LABEL.offer}</b> ${!names.length ? '<span class="hint">non indicata nei file</span>'
        : names.length === 1 ? esc(names[0]) : `<span class="hint">in ${names.length} località possibili</span>${open ? '' : ' <button class="link" data-pool="offer">VISUALIZZA POSSIBILITÀ</button>'}`}
        ${open && names.length > 1 ? `<div class="cb-pool">${esc(names.join(', '))}</div>` : ''}
        <div class="hint">Dove il mobiGlas propone il contratto: non è il punto di ritiro.</div></div>`;
    }
    const ops = v.ops.filter((o) => o.role === role);
    if (!ops.length) return `<div class="cb-role"><b>${ROLE_LABEL[role]}</b> <span class="hint">nessuno nei dati</span></div>`;
    // operazioni identiche (stesso luogo o stesso pool) mostrate una volta, con il numero
    const groups = new Map();
    for (const o of ops) { const k = JSON.stringify([[...o.ids, ...(o.alt ?? [])].sort(), o.unresolved ?? []]); const e = groups.get(k); if (e) e.n++; else groups.set(k, { o, n: 1 }); }
    return [...groups.values()].map(({ o, n }) => {
      const cand = [...new Set([...o.ids, ...(o.alt ?? [])])].map((id) => g.get(id)?.name).filter(Boolean);
      const key = `${role}:${o.slot}`;
      const many = !o.fixed && cand.length > 1;
      const head = o.fixed || cand.length === 1 ? esc(cand.join(', ') || 'n.d.')
        : cand.length ? `<span class="warn">variabile</span> — ${cand.length} località possibili${S.open === key ? '' : ` <button class="link" data-pool="${key}">VISUALIZZA POSSIBILITÀ</button>`}`
          : '<span class="warn">DA CONFERMARE NEL MOBIGLAS</span> <span class="hint">luogo non nei file</span>';
      return `<div class="cb-role"><b>${ROLE_LABEL[role]}${groups.size > 1 ? ` ${o.slot}` : ''}</b>${n > 1 ? ` <span class="hint">×${n} partite</span>` : ''} ${head}${o.src === 'testo' ? ' <span class="hint">(dal testo della missione: pool vuoto nei file)</span>' : ''}
        ${many && S.open === key ? `<div class="cb-pool">${esc(cand.join(', '))}</div>` : ''}
        ${o.ambiguous?.length ? `<div class="hint">Nomi ambigui (più luoghi con lo stesso nome, tenuti tutti): ${esc(o.ambiguous.join(', '))}</div>` : ''}
        ${o.unresolved?.length ? `<div class="hint">Non riconosciuti nella starmap: ${esc(o.unresolved.slice(0, 6).join(', '))}${o.unresolved.length > 6 ? '…' : ''}</div>` : ''}</div>`;
    }).join('');
  }
  function renderMissionCtx(box, id) {
    const v = viewById(id); if (!v || !geo()) { S.ctx = { type: 'auto' }; return renderCtx(); }
    const fx = evalOne(v);
    const c = CLASS[fx?.cls.cls ?? 'catalogata'];
    const cargo = cargoOf(v); const k = caps(); const ri = v.rewardInfo ?? (v.reward ? { kind: 'fissa', min: v.reward } : { kind: 'nd' });
    const inAtlas = !!A()?.index?.()?.byId.has(v.id); const sel = new Set(A()?.selection?.() ?? []);
    const picks = v.ops.filter((o) => o.role === 'pickup'); const firstPick = picks.length === 1 && picks[0].fixed ? geo().get(picks[0].ids[0]) : null;
    const perScu = ri.kind === 'fissa' && cargo.scu ? (ri.min ?? v.reward) / cargo.scu : null;
    const transit = fx?.path && fx.path.length > 1 ? fx.path.map((s) => SYS[s] ?? s).join(' → ') : null;
    const sysOfRole = (role) => [...new Set(v.ops.filter((o) => o.role === role).flatMap((o) => [...o.ids, ...(o.alt ?? [])]).map((x) => SYS[geo().get(x)?.system]).filter(Boolean))];
    const spread = !transit && v.interstellar ? `ritiro in ${sysOfRole('pickup').join(', ') || 'n.d.'} · consegna in ${sysOfRole('dropoff').join(', ') || 'n.d.'} (il pool comprende più sistemi: il percorso dipende dal luogo che assegna il gioco)` : null;
    box.innerHTML = `<div class="cb-head"><span class="hm-type">MISSIONE · ${esc(ORIGIN[v.origin]?.label ?? v.origin)}</span><h3>${esc(v.title)}</h3>
        <span class="hint">${esc(v.company ?? 'datore n.d.')}${v.faction ? ` · ${esc(v.faction)}` : ''} · ${esc(CATEGORY_LABEL[v.category] ?? v.category ?? '')}${v.type ? ` (${esc(v.type)})` : ''}</span></div>
      <p>${c.icon} <b>${esc(c.label)}</b> <span class="hint">${esc(c.note)}</span></p>${(fx?.cls.notes ?? []).map((n) => `<p class="warn">${esc(n)}</p>`).join('')}
      ${v.description ? `<p class="hint cb-desc">${esc(v.description)}</p>` : ''}
      ${roleBlock(v, 'offer')}${roleBlock(v, 'pickup')}${roleBlock(v, 'dropoff')}
      <div class="cb-role"><b>${ROLE_LABEL.transit}</b> ${transit ? `${esc(transit)} <span class="hint">sulla rete dei salti di NAVCOM</span>` : spread ? `<span class="warn">${esc(spread)}</span>` : '<span class="hint">nessun salto: ritiro e consegna nello stesso sistema</span>'}</div>
      <div class="hm-kv">
        <span>Ricompensa</span><b>${rewardHtml(v)}${ri.kind === 'dinamica' ? ' <span class="hint">calcolata dal gioco: non nei file</span>' : ''}</b>
        <span>Potenziale</span><b>${perScu ? `${fmtA(perScu)} per SCU sul massimo · ` : ''}${fx?.trips ? `${fx.trips} viagg${fx.trips > 1 ? 'i' : 'io'} con ${k.scu} SCU` : 'viaggi n.d.'}</b>
        <span>Carico</span><b>${(v.orders ?? []).map((o) => `${esc(o.cargo ?? 'merce n.d.')} ${o.scuMax ? `${o.scuMin && o.scuMin !== o.scuMax ? `${o.scuMin}–` : ''}${o.scuMax} SCU` : '<span class="hint">quantità non nei dati</span>'}${o.containerMax ? `, casse ≤${o.containerMax}` : ''}`).join('<br>') || (cargo.scu ? `${cargo.scu} SCU` : '<span class="hint">non nei dati</span>')}${fx?.fit === 'cassa' ? `<br><span class="err">casse più grandi della nave (${k.maxBox} SCU)</span>` : ''}</b>
        <span>Termini</span><b>${v.timeLimit ? `limite ${Math.round(v.timeLimit)} min · ` : ''}${v.risk?.combat ? `combattimento${v.risk.enemies ? ` (${v.risk.enemies} nemici)` : ''} · ` : ''}${v.risk?.level !== null && v.risk?.level !== undefined ? `rischio ${v.risk.level} · ` : ''}${v.illegal ? '<span class="err">illegale</span>' : 'legale'}${v.shareable ? ' · condivisibile' : ''}${v.onceOnly ? ' · una volta sola' : ''}</b>
        <span>Requisiti</span><b>${v.rank ? `grado ${esc(v.rank)}` : 'nessun grado indicato'}${v.repReq?.faction ? ` · reputazione ${esc(v.repReq.faction)} ${esc(v.repReq.min ?? '')}` : ''}${v.prereq ? ` · ${v.prereq} prerequisiti` : ''}</b>
      </div>
      <details class="cb-sec"><summary>DATI TECNICI</summary><p class="hint">${esc(v.source ?? '')} · ${esc(v.patch ?? 'patch n.d.')}${v.variants > 1 ? ` · ${v.variants} varianti (${esc(v.groupHow === 'wiki' ? 'gruppi della Wiki' : 'raggruppamento euristico')})` : ''}${v.uuid ? ` · ${esc(v.uuid)}` : ''}</p></details>
      <div class="cb-actions">
        <button class="primary" id="md-sel" ${inAtlas ? '' : 'disabled title="nel piano cargo entrano solo trasporti e consegne"'}>${sel.has(v.id) ? '✓ NEL PIANO CARGO' : '＋ PIANO CARGO'}</button>
        <button id="md-route" ${firstPick?.pos ? '' : 'disabled title="ritiro non unico o senza XYZ: rotta non calcolabile"'}>🛰 ROTTA AL RITIRO</button>
        <button id="md-obs">📝 VISTA NEL MOBIGLAS</button></div>
      <div class="row wrap"><button class="small" id="md-cmp">⚖ confronta</button><button class="small" id="md-atlas">🌌 atlante</button><button class="small" id="md-back">← torna</button></div>`;
    box.querySelectorAll('[data-pool]').forEach((b) => { b.onclick = () => { S.open = b.dataset.pool; renderCtx(); }; });
    $('md-sel').onclick = () => { A()?.toggle(v.id, !sel.has(v.id)); renderCtx(); renderMap(); renderCargoBadge(); if (S.result) renderResults(); };
    $('md-route').onclick = () => { const pos = state.position; app.planTo({ name: firstPick.name, system: firstPick.system, x: firstPick.pos.x, y: firstPick.pos.y, z: firstPick.pos.z, unit: 'm', start: pos && pos.system === firstPick.system ? pos : null }); };
    $('md-obs').onclick = () => observeDialog(v.id);
    $('md-cmp').onclick = () => { addCompare(v.id); showTab('missions'); };
    $('md-atlas').onclick = () => { const t = firstPick?.id ?? v.offer?.find((o) => o.id)?.id; if (t) app.openAtlas(t); else app.showTab('atlas'); };
    $('md-back').onclick = () => { S.ctx = { type: 'auto' }; S.focus = null; renderCtx(); renderMap(); if (S.result) renderResults(); };
  }

  // ---------------------------------------------------------------- confronto
  function addCompare(id) { if (!S.compare.includes(id)) S.compare = [...S.compare, id].slice(-4); renderCompare(); }
  function renderCompare() {
    const box = $('mf-cmp'); const list = S.compare.map(viewById).filter(Boolean);
    if (!list.length || !geo()) { box.innerHTML = ''; return; }
    const rows = list.map((v) => ({ v, x: evalOne(v) }));
    const line = (label, f) => `<tr><th>${label}</th>${rows.map((r) => `<td>${f(r)}</td>`).join('')}</tr>`;
    box.innerHTML = `<h4>CONFRONTO</h4><div class="tablewrap"><table class="cb-cmp"><thead><tr><th></th>${rows.map((r) => `<th>${esc(r.v.title)} <button class="small" data-cmpx="${esc(r.v.id)}">✕</button></th>`).join('')}</tr></thead><tbody>
      ${line('Classe', (r) => `${CLASS[r.x?.cls.cls ?? 'catalogata'].icon} ${esc(CLASS[r.x?.cls.cls ?? 'catalogata'].label)}`)}
      ${line('Ricompensa', (r) => rewardHtml(r.v))}
      ${line('SCU / cassa', (r) => `${r.x?.cargo.scu ?? '—'} / ${r.x?.cargo.box ?? '—'}`)}
      ${line('Per SCU', (r) => { const ri = r.v.rewardInfo ?? {}; return ri.kind === 'fissa' && r.x?.cargo.scu ? fmtA((ri.min ?? r.v.reward) / r.x.cargo.scu) : '<span class="hint">n.d.</span>'; })}
      ${line('Viaggi', (r) => r.x?.trips ?? '<span class="hint">n.d.</span>')}
      ${line('Rotta', (r) => esc(ROUTE[r.x?.route ?? 'incompleta'].label))}
      ${line('Sistemi', (r) => esc((r.x?.path ?? r.v.systems ?? []).map((s) => SYS[s] ?? s).join(' → ') || '—'))}
      ${line('Limite', (r) => (r.v.timeLimit ? `${Math.round(r.v.timeLimit)} min` : '—'))}
      ${line('Rischio', (r) => `${r.v.risk?.combat ? 'combattimento' : 'nessun combattimento nei dati'}${r.v.illegal ? ' · illegale' : ''}`)}
      </tbody></table></div><p class="hint">Quantità = massimi dei modelli; le ricompense dinamiche non sono confrontabili finché non le leggi nel MobiGlas.</p>`;
    box.querySelectorAll('[data-cmpx]').forEach((b) => { b.onclick = () => { S.compare = S.compare.filter((x) => x !== b.dataset.cmpx); renderCompare(); }; });
  }

  // ---------------------------------------------------------------- CARGO (stacking)
  function renderCargoBadge() { const n = A()?.selection?.().length ?? 0; $('cb-cargo-n').textContent = n ? ` (${n})` : ''; if (S.tab === 'cargo') renderCargo(); }
  function cargoCtx() {
    const base = A()?.stackCtx?.() ?? {}; const k = caps();
    return { ...base, geo: geo(), links: links(), capacity: k.scu ?? base.capacity, ship: { ...(base.ship ?? {}), name: k.name, scu: k.scu, maxBox: k.maxBox }, ranks: ranks(), hideIllegal: false };
  }
  function renderCargo() {
    const box = $('cb-b-cargo'); if (!box) return;
    const a = A(); if (!a?.index?.()) { box.innerHTML = '<p class="hint">Atlante non disponibile: il piano cargo usa il suo motore di stacking.</p>'; return; }
    const list = a.selection().map((id) => a.index().byId.get(id)).filter(Boolean); const k = caps();
    box.innerHTML = `<p>Nave: <b>${esc(k.name)}</b> · ${k.scu ? `${k.scu} SCU` : '<span class="hm-nd">stiva n.d.</span>'} · cassa massima ${k.maxBox ? `${k.maxBox} SCU` : '<span class="hm-nd">n.d.</span>'} <span class="hint">${esc(k.source ?? '')}${S.form.maxScu ? ' · CARICO MAX dal Mission Finder' : ''}</span></p>
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th></th><th>Missione</th><th>Stato</th><th>Ritiro</th><th>Consegna</th><th class="num">Ricompensa</th></tr></thead><tbody>${list.map((v) => `<tr><td><button class="small" data-unsel="${esc(v.id)}">✕</button></td><td><button class="link" data-mopen="${esc(v.id)}">${esc(v.title)}</button><br><span class="hint">${esc(v.company ?? '')}</span></td>
        <td>${ORIGIN[v.origin].icon} ${v.origin === 'utente' ? (v.committed ? 'ACCETTATO' : 'osservato da te') : v.origin === 'storica' ? 'IPOTETICO (osservazione storica di terzi)' : 'IPOTETICO (modello)'}</td><td class="wrapcell">${roleCell(v, 'pickup')}</td><td class="wrapcell">${roleCell(v, 'dropoff')}</td><td class="num">${rewardHtml(v)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">Piano vuoto: spunta ☐ le missioni nel Mission Finder o nell\'atlante (selezione condivisa con l\'ATLANTE).</p>'}
      <div class="row wrap"><button id="cg-eval" class="primary" style="width:auto" ${list.length ? '' : 'disabled'}>POSSO ACCUMULARLE?</button><button id="cg-sugg" ${list.length ? '' : 'disabled'}>Cosa aggiungere</button><button id="cg-clear" class="small" ${list.length ? '' : 'disabled'}>svuota</button></div>
      <div id="cg-out"></div>`;
    box.querySelectorAll('[data-unsel]').forEach((b) => { b.onclick = () => { a.toggle(b.dataset.unsel, false); renderMap(); renderCargoBadge(); }; });
    box.querySelectorAll('[data-mopen]').forEach((b) => { b.onclick = () => openMission(b.dataset.mopen); });
    $('cg-clear').onclick = () => { a.clearSelection(); renderMap(); renderCargoBadge(); };
    $('cg-eval').onclick = () => { const r = evaluateStack(list, cargoCtx()); $('cg-out').innerHTML = stackHtml(r); if ($('cg-plan')) $('cg-plan').onclick = () => { a.showPlan(r); app.showTab('atlas'); }; };
    $('cg-sugg').onclick = () => {
      $('cg-out').innerHTML = '<p class="hint">Calcolo in corso…</p>';
      setTimeout(() => {
        const rows = suggestStack(list, a.index(), cargoCtx(), { limit: 15 });
        $('cg-out').innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>Esito</th><th>Missione</th><th>Tipologia</th><th class="num">Ricompensa</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td>${CLASSES[x.result.cls].icon} ${CLASSES[x.result.cls].label}</td><td>${ORIGIN[x.v.origin].icon} ${esc(x.v.title)}</td>
          <td>${x.types.map((t) => `<span class="at-pill ${t.sure ? 'sure' : 'maybe'}">${t.label}${t.sure ? '' : ' (possibile)'}</span>`).join('')}</td><td class="num">${rewardHtml(x.v)}</td><td><button class="small" data-add="${esc(x.v.id)}">＋</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="hint">Nessuna missione nei dati condivide luoghi con il piano.</p>';
        $('cg-out').querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { a.toggle(b.dataset.add, true); renderMap(); renderCargoBadge(); }; });
      }, 20);
    };
  }
  function stackHtml(r) {
    const c = CLASSES[r.cls]; const m = r.metrics;
    const stops = r.route?.seq?.length ? stopsOf(r.route.seq) : [];
    return `<p class="at-cls">${c.icon} <b>${c.label}</b> <span class="hint">${esc(c.note)}</span></p>
      ${r.reasons.map((x) => `<p class="err">${esc(x)}</p>`).join('')}${r.missing.map((x) => `<p class="warn">${esc(x)}</p>`).join('')}
      ${m ? `<div class="at-scen"><div>Contratti accettati<br><b>${fmtA(m.rewardAccepted)}</b></div><div>Modelli ipotetici (non confermati)<br><b>${fmtA(m.rewardUnconfirmed)}</b>${m.rewardUnknown ? `<br><span class="hint">${m.rewardUnknown} ricompense non note</span>` : ''}</div>
        <div>Picco a bordo<br><b>${m.peak} / ${cargoCtx().capacity} SCU</b></div><div>Ritiri ${m.pickups} · consegne ${m.dropoffs} · scali ${m.stops}</div>
        <div>Percorso<br><b>${m.unknownLegs ? 'incompleto' : fmtLen(m.distance)}</b></div><div>Tempo<br><b>${m.hours !== null && m.hours !== undefined ? `${(m.hours * 60).toFixed(0)} min` : 'non calcolabile'}</b></div></div>` : ''}
      ${stops.length ? `<h4>Itinerario proposto</h4><ol class="cb-itin">${stops.map((s) => `<li><b>${esc(s.place.name)}</b> <span class="hint">${esc(SYS[s.place.system] ?? s.place.system ?? '')}</span> — ${s.tasks.map((t) => `${t.type === 'carico' ? '⬆ carica' : '⬇ scarica'} ${t.qty} SCU ${esc(t.cargo ?? '')}`).join(', ')}</li>`).join('')}</ol>` : ''}
      ${(r.warnings ?? []).map((x) => `<p class="warn">${esc(x)}</p>`).join('')}${(r.assumed ?? []).map((x) => `<p class="hint">Ipotesi: ${esc(x)}</p>`).join('')}
      <p class="hint">Fra sistemi diversi il percorso usa la rete dei salti di NAVCOM: distanze reali fino e dai gateway, tunnel del salto escluso (tempo non calcolabile). Un insieme con luoghi, casse o quantità non noti resta DA VERIFICARE.</p>
      ${r.route ? '<button id="cg-plan">Apri il piano cargo nell\'ATLANTE</button>' : ''}`;
  }

  // ---------------------------------------------------------------- registra contratto visto nel MobiGlas (B8)
  function observeDialog(id) {
    const v = viewById(id); const g = geo(); if (!v || !g) return;
    const rows = draftMovements(v, g);
    const dlg = $('cb-dlg');
    const offer = v.offer?.length === 1 && v.offer[0].id ? g.get(v.offer[0].id)?.name ?? '' : '';
    dlg.innerHTML = `<form method="dialog" class="cb-obs"><h3>Contratto visto nel MobiGlas</h3>
      <p class="hint">Modello: <b>${esc(v.title)}</b> · ${esc(v.company ?? '')}. Precompilati solo i dati certi del catalogo; ritiro e consegna da pool restano vuoti: scrivi quelli che vedi (l'elenco propone il pool). Nessuna lettura automatica del gioco.</p>
      <div class="cb-form"><label>Stato <select id="ob-status"><option value="osservata">vista (non accettata)</option><option value="accettata">ACCETTATA</option></select></label>
        <label>Luogo dell'offerta <input id="ob-offer" list="at-places" value="${esc(offer)}"></label>
        <label>Ricompensa reale (aUEC) <input id="ob-rew" inputmode="numeric" placeholder="${v.rewardInfo?.kind === 'fissa' ? v.rewardInfo.min : 'dal MobiGlas'}"></label>
        <label>Scadenza <input id="ob-dl" placeholder="es. 2 h 30 min"></label></div>
      ${rows.map((r, i) => `<fieldset><legend>Movimento ${i + 1}</legend><div class="cb-form">
        <label>Merce <input id="ob-c${i}" value="${esc(r.cargo)}"></label>
        <label>SCU reali <input id="ob-s${i}" inputmode="numeric" placeholder="${r.scuRange ? `${r.scuRange[0] ?? '?'}–${r.scuRange[1] ?? '?'}` : ''}"></label>
        <label>Cassa max <input id="ob-b${i}" inputmode="numeric" value="${esc(r.containerMax)}"></label>
        <label>Ritiro <input id="ob-f${i}" list="ob-fl${i}" value="${esc(r.from)}" placeholder="${r.fromPool.length > 1 ? `uno fra ${r.fromPool.length}` : ''}"></label>
        <label>Consegna <input id="ob-t${i}" list="ob-tl${i}" value="${esc(r.to)}" placeholder="${r.toPool.length > 1 ? `uno fra ${r.toPool.length}` : ''}"></label></div>
        <datalist id="ob-fl${i}">${r.fromPool.slice(0, 400).map((n) => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="ob-tl${i}">${r.toPool.slice(0, 400).map((n) => `<option value="${esc(n)}">`).join('')}</datalist></fieldset>`).join('')}
      <label>Screenshot (facoltativo, resta nel browser) <input type="file" id="ob-shot" accept="image/*" multiple></label>
      <label>Note <textarea id="ob-notes" rows="2"></textarea></label>
      <div id="ob-msg"></div>
      <div class="row wrap"><button type="button" id="ob-save" class="primary" style="width:auto">SALVA CONTRATTO</button><button type="button" id="ob-close">Annulla</button></div></form>`;
    if (dlg.showModal) dlg.showModal(); else dlg.open = true;
    $('ob-close').onclick = () => dlg.close?.();
    $('ob-save').onclick = async () => {
      const lg = L(); const db = lg?.db?.();
      if (!db) { $('ob-msg').innerHTML = '<p class="err">Archivio della logistica non disponibile: contratto non salvato.</p>'; return; }
      const form = { status: $('ob-status').value, offer: $('ob-offer').value.trim(), reward: $('ob-rew').value.trim(), deadline: $('ob-dl').value.trim(), notes: $('ob-notes').value,
        movements: rows.map((_, i) => ({ cargo: $(`ob-c${i}`).value.trim(), scu: $(`ob-s${i}`).value.trim(), containerMax: $(`ob-b${i}`).value.trim(), from: $(`ob-f${i}`).value.trim(), to: $(`ob-t${i}`).value.trim() })) };
      const o = observedInput(v, form, { geo: g, patch: lg.context?.()?.patch || M.res?.cat?.meta?.version || null });
      const r = normalizeContract(o.input);
      if (!r.contract) { $('ob-msg').innerHTML = `<p class="err">${esc(r.errors.join(' · '))}</p>`; return; }
      await db.putContracts([r.contract]);
      const files = [...($('ob-shot').files ?? [])];
      const shots = await Promise.all(files.map((f) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ id: newId(), contractId: r.contract.id, name: f.name, type: f.type, dataUrl: fr.result, at: nowIso() }); fr.readAsDataURL(f); })));
      if (shots.length) await db.putAttachments(shots.filter((s) => String(s.dataUrl).startsWith('data:image/')));
      dlg.close?.();
      await A()?.reloadUser?.(); lg.refreshAll?.();
      const warn = [...o.warnings, ...r.warnings];
      if (warn.length) alert(`Contratto salvato. Avvisi:\n${warn.join('\n')}`);
      runFinder(); renderCargoBadge();
    };
  }

  // ---------------------------------------------------------------- attivita'
  async function renderActivity() {
    const db = app.pointsDb();
    const pts = db ? (await db.all().catch(() => [])) : [];
    const lastPts = pts.filter((p) => p.updatedAt || p.createdAt).sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))).slice(0, 5);
    const routes = (app.store.data.savedRoutes ?? []).slice(0, 5);
    const contracts = await (L()?.db?.()?.contracts?.() ?? Promise.resolve([])).catch(() => []);
    const open = contracts.filter((c) => ['osservata', 'confermata', 'accettata', 'in_esecuzione'].includes(c.status)).slice(0, 6);
    const li = (html) => `<li>${html}</li>`;
    const sec = (title, items, empty) => `<div><h4>${title}</h4>${items.length ? `<ul>${items.join('')}</ul>` : `<p class="hint">${empty}</p>`}</div>`;
    $('hm-activity').innerHTML = `<div class="hm-act-grid">
      ${sec('Contratti tuoi aperti', open.map((c) => li(`${esc(c.title)} <span class="hint">${esc(c.status)} · ${fmtA(c.reward)}</span>`)), 'nessuno: registra quelli che vedi nel MobiGlas con 📝')}
      ${sec('Destinazioni recenti', state.recent.slice(0, 6).map((r) => li(`<button class="link" data-act="open" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${fmtDT(r.at)}</span>`)), 'nessuna')}
      ${sec('Rotte salvate', routes.map((r) => li(`<button class="link" data-act="route" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${esc(SYS[r.system] ?? r.system)}</span>`)), 'nessuna')}
      ${sec('Punti modificati', lastPts.map((p) => li(`<button class="link" data-act="open" data-id="pt:${esc(p.id)}">${esc(p.name)}</button>`)), db ? 'nessuno' : 'DATABASE PUNTI non disponibile')}
      ${sec('Visite segnate da te', state.visits.slice(0, 6).map((v) => li(`<button class="link" data-act="open" data-id="${esc(v.id)}">${esc(v.name)}</button> <span class="hint">${fmtDT(v.at)}</span>`)), 'nessuna')}
    </div>`;
    bindActions($('hm-activity'));
  }
  function exportState() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'navcom-plancia', version: app.VERSION, exportedAt: new Date().toISOString(), ...state.exportJson() }, null, 1)], { type: 'application/json' }));
    a.download = `navcom-plancia-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------------------------------------------------------- avvio
  $('hm-pos-sys').innerHTML = Object.entries(SYS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('hm-pos-sys').value = state.position?.system ?? app.system();
  $('hm-pos-set').onclick = () => setPositionFromText($('hm-pos-text').value);
  $('hm-pos-clear').onclick = async () => { if (confirm('Cancellare la posizione impostata? (I punti salvati non vengono toccati.)')) await state.setPosition(null); };
  $('hm-pos-save').onclick = () => { const p = state.position; if (!p) return; app.openInDatabase?.({ name: `Posizione ${fmtDT(p.at)}`, system: p.system, x: p.x, y: p.y, z: p.z, unit: 'm', notes: `da ${SRC_LABEL[p.source] ?? p.source}` }); };
  $('hm-ship-in').onchange = async () => { await state.setShip(findShip($('hm-ship-in').value)?.name ?? $('hm-ship-in').value.trim()); };
  $('hm-ship-note-save').onclick = async () => { await state.setShipNote(state.ship, $('hm-ship-note').value.trim()); $('hm-ship-note-msg').textContent = 'salvata'; };
  $('hm-q').oninput = renderSearch; $('hm-q-sys').onchange = renderSearch;
  $('hm-q').onkeydown = (e) => { if (e.key === 'Escape') { $('hm-q').value = ''; renderSearch(); } if (e.key === 'Enter') $('hm-results').querySelector('[data-act]')?.click(); };
  $('hm-export').onclick = exportState;
  $('cb-sys').value = S.mapSys; $('cb-out').checked = S.outposts;
  $('cb-sys').onchange = () => { S.mapSys = $('cb-sys').value; S.refit = true; renderMap(); };
  $('cb-home').onclick = () => { S.mapSys = 'auto'; S.refit = true; renderMap(); };
  $('cb-out').onchange = () => { S.outposts = $('cb-out').checked; state.setBridge({ outposts: S.outposts }); renderMap(); };
  $('cb-fit').onclick = () => { S.refit = true; renderMap(); };
  $('cb-2d').onchange = () => { view.setOrtho($('cb-2d').checked); S.refit = true; renderMap(); };
  document.querySelectorAll('[data-cbt]').forEach((b) => { b.onclick = () => showTab(b.dataset.cbt); });
  $('cb-mc-here').onclick = () => app.control?.()?.open({ relation: 'da' });
  $('cb-mc-to').onclick = () => { const d = state.destination; if (d?.id && geo()?.get(d.id)) app.control?.()?.open({ placeId: d.id, relation: 'verso', scope: 'luogo' }); else alert('Imposta prima una destinazione che sia un luogo della mappa.'); };
  $('hm-persist').innerHTML = state.persistent ? 'Stato della plancia nell\'archivio del browser (chiavi separate dal DATABASE PUNTI).' : '<span class="warn">Archivio del browser non disponibile: posizione, nave e destinazione restano solo per questa sessione.</span>';
  state.onChange((what) => {
    if (what === 'bridge') return;
    renderBar();
    if (what === 'position') { renderPosition(); S.refit = true; renderMap(); renderCtx(); }
    if (what === 'ship') { if (!$('cb-ship').hidden) renderShip(); if (S.tab === 'cargo') renderCargo(); }
    if (what === 'destination' || what === 'plan') { S.refit = true; renderMap(); renderCtx(); }
    if (['recent', 'fav', 'visits'].includes(what) && S.tab === 'activity') renderActivity();
    if (['recent', 'fav'].includes(what) && !state.destination && S.ctx.type === 'auto') renderCtx();
  });
  renderBar(); renderPosition(); renderCtx(); renderMap(); renderProv(); renderFinderForm(); showTab(S.tab);
  loadMissions();

  return {
    /** chiamato quando cambiano i dati caricati (posizioni QT, mappe, destinazioni) o il sistema */
    refresh() { renderBar(); renderPosition(); renderCtx(); renderMap(); renderCargoBadge(); if (!$('cb-ship').hidden) renderShip(); if ($('hm-q').value.trim()) renderSearch(); },
    show() { renderBar(); renderMap(); renderCargoBadge(); if (S.result) renderResults(); },
    /** dal resto dell'app: cerca missioni da/verso un luogo */
    findMissions(patch) { setForm(patch); showTab('missions'); runFinder(); },
    /** Mission Database 2.0 caricato una sola volta, condiviso con MISSION CONTROL */
    missionDb: () => loadMissions().then(() => ({ res: M.res, views: M.views ?? [], ships: M.ships })),
    /** dal MISSION CONTROL: mostra la missione sulla mappa della plancia */
    openMission: (id) => { if (viewById(id)) openMission(id); },
  };
}
