// Interfaccia dell'ATLANTE 3D e della CARGO INTELLIGENCE (0.7.0).
// Mappa al centro, ricerca e filtri a sinistra, LOCATION INTELLIGENCE a destra, piano in basso.
// Dati: cataloghi statici data/atlas/ (scunpacked, via GitHub Actions) + catalogo SCHaulingPlanner +
// contratti e osservazioni dell'utente (IndexedDB "navcom-logistics", condiviso con LOGISTICS).
import { SYSTEMS, SYSTEM_LABEL, KIND_LABEL, BODY_KINDS, geoFromSnapshot, geoFromCitizenHQ } from './atlas/geo.js';
import { ORIGIN, TO_CONFIRM, catalogViews, schpViews, userViews, MissionIndex, normalizationQueue, findDuplicates, missionSegments } from './atlas/missions.js';
import { CLASSES, SCENARIOS, evaluateStack, suggestStack, bestStack, geoLegOf } from './atlas/stack.js';
import { LEVELS, observationsByPlace, placeStats, discoveryScore, rankDiscovery } from './atlas/discovery.js';
import { stopsOf, moveStop, measure, planFromStack, manifestOf } from './atlas/plan.js';
import { AtlasView, fmtLen } from './atlas/render.js';
import { compressor } from './atlas/view.js';
import { holdChartSvg } from './logistics/manifest.js';
import { RANKS, STATUS, normalizeContract, rankIndex, patchAge } from './logistics/model.js';
import { normalizeObservation } from './logistics/intel.js';
import { UNITS, newId, nowIso } from './core/points.js';

const fmtA = (n) => (n == null ? 'n.d.' : `${Math.round(n).toLocaleString('it-IT')} aUEC`);
const fmtKm = (m) => `${Math.round(m / 1000).toLocaleString('it-IT')} km`;
const num = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
const MAX_LIST = 25;

export async function initAtlas(app) {
  const { $, esc, store } = app;
  const lg = app.logistics; // API di LOGISTICS (db condiviso, nave, gradi, patch)
  const db = lg.db();
  const S = { system: 'stanton', level: null, selected: null, sel: new Set(), conn: null, plan: null, planResult: null, ...(await db.getMeta('atlasUi')) ?? {} };
  S.sel = new Set(S.sel ?? []);
  let geo = null, cat = null, schp = null, index = null, views = [], meta = {}, queueExtra = new Map(), obsByPlace = new Map();
  let contracts = [], observations = [], plans = [], attachments = [];
  const saveUi = () => db.setMeta('atlasUi', { system: S.system, level: S.level, selected: S.selected, sel: [...S.sel] });

  // ------------------------------------------------------------------ dati
  async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); }
  async function loadData() {
    const banner = [];
    try {
      const [idx, g, m] = await Promise.all([getJson('data/atlas/index.json'), getJson('data/atlas/geo.json'), getJson('data/atlas/missions.json')]);
      meta = { index: idx, geo: g.meta, missions: m.meta, from: 'sito' };
      geo = geoFromSnapshot(g, await personalPoints()); cat = m;
      db.setMeta('atlasSnapshot', { at: nowIso(), index: idx, geo: g, missions: m }).catch(() => {});
      if (idx.fallback) banner.push(`<p class="warn">Catalogo dell'atlante non aggiornato all'ultima pubblicazione: ${esc(idx.fallback.note)} (dati del ${esc(idx.generatedAt?.slice(0, 10))}).</p>`);
    } catch (e) {
      const snap = await db.getMeta('atlasSnapshot').catch(() => null);
      if (snap) {
        meta = { index: snap.index, geo: snap.geo.meta, missions: snap.missions.meta, from: 'copia locale' };
        geo = geoFromSnapshot(snap.geo, await personalPoints()); cat = snap.missions;
        banner.push(`<p class="warn">Catalogo dell'atlante non raggiungibile (${esc(e.message)}): uso l'ultima copia valida salvata in questo browser, del ${esc(snap.at.slice(0, 10))}.</p>`);
      } else {
        for (const sys of SYSTEMS) await app.ensureSystemData(sys).catch(() => {});
        const rows = Object.fromEntries(SYSTEMS.map((s) => [s, store.locations(s)]));
        geo = geoFromCitizenHQ(rows, await personalPoints()); cat = null;
        meta = { geo: geo.meta, from: 'CitizenHQ' };
        banner.push(`<p class="warn">Catalogo dell'atlante non disponibile (${esc(e.message)}): luoghi dalle posizioni CitizenHQ già importate, nessun modello di missione dai file di gioco.</p>`);
      }
    }
    try { schp = await getJson('data/logistics/catalog-schp.json'); } catch (e) { schp = null; banner.push(`<p class="hint">Catalogo SCHaulingPlanner non disponibile (${esc(e.message)}).</p>`); }
    $('at-banner').innerHTML = banner.join('');
  }
  async function personalPoints() {
    const pdb = app.pointsDb?.(); if (!pdb) return [];
    const list = await pdb.all().catch(() => []);
    return list.filter((p) => [p.x, p.y, p.z].every((v) => Number.isFinite(+v) && v !== '' && v != null)).map((p) => {
      const k = UNITS[p.unit] ?? 1000;
      return { id: p.id, name: p.name, system: String(p.system ?? '').toLowerCase(), pos: { x: +p.x * k, y: +p.y * k, z: +p.z * k }, notes: p.notes, updatedAt: p.updatedAt, category: p.category, resource: p.resource };
    });
  }
  async function reloadUser() {
    contracts = await db.contracts(); observations = await db.observations(); plans = await db.plans(); attachments = await db.attachments();
    rebuild();
  }
  function rebuild() {
    queueExtra = new Map();
    views = [...userViews(contracts, geo, queueExtra), ...schpViews(schp, geo, queueExtra), ...catalogViews(cat)];
    index = new MissionIndex(views, geo);
    obsByPlace = observationsByPlace(observations, geo);
    for (const id of [...S.sel]) if (!index.byId.has(id)) S.sel.delete(id);
  }

  // ------------------------------------------------------------------ contesto e filtri
  const L = () => lg.context();
  const myRanks = () => Object.fromEntries(Object.entries(L().ranks).map(([c, r]) => [c, rankIndex(r) ?? num(r)]).filter(([, r]) => Number.isInteger(r)));
  const currentPatch = () => L().patch || meta.index?.patch?.match(/\d+\.\d+(\.\d+)?/)?.[0] || '';
  const filters = () => ({
    origin: new Set(['utente', 'storica', 'catalogo'].filter((o) => $(`at-o-${o}`).checked)),
    company: $('at-f-company').value || null, maxRank: $('at-f-rank').value === '' ? null : +$('at-f-rank').value,
    category: $('at-f-cat').value || null, minScu: num($('at-f-scu').value), patch: $('at-f-patch').value.trim() || null,
    maxAlternatives: +$('at-f-alt').value >= 60 ? null : +$('at-f-alt').value, hideIllegal: $('at-b-illegal')?.checked ?? false,
  });
  const stackCtx = () => {
    const l = L();
    const start = $('at-s-start')?.value ? geo.resolveName($('at-s-start').value)?.id ?? null : (l.pos ? geo.resolveName(l.pos)?.id ?? null : null);
    const dest = $('at-s-dest')?.value ? geo.resolveName($('at-s-dest').value)?.id ?? null : null;
    const nav = app.navOptions();
    return { geo, capacity: num($('at-s-cap')?.value) ?? l.capacity, ship: l.ship, ranks: myRanks(), start, end: null, destination: dest, maxStops: num($('at-s-stops')?.value), drive: nav.drive, prep: nav.prep, hideIllegal: $('at-b-illegal')?.checked ?? true };
  };

  // ------------------------------------------------------------------ mappa
  const view = new AtlasView($('at-canvas'), { onPick, onHover });
  if (!view.ok) $('at-banner').insertAdjacentHTML('beforeend', '<p class="err">Il browser non permette di disegnare la mappa: usa la gerarchia e la ricerca a sinistra (stesse funzioni).</p>');

  const layerOk = (p) => {
    if (p.hidden && !$('at-l-hidden').checked) return false;
    if (p.kind === 'outpost' || p.kind === 'city') { if (!$('at-l-outpost').checked && p.id !== S.selected) return false; }
    if (p.kind === 'station' || p.kind === 'gateway') { if (!$('at-l-station').checked && p.id !== S.selected) return false; }
    if (p.kind === 'poi' && !$('at-l-poi').checked) return false;
    if ((p.kind === 'asteroid' || p.kind === 'navpoint' || p.kind === 'other') && !$('at-l-asteroid').checked) return false;
    if (p.kind === 'personal' && !$('at-l-personal').checked) return false;
    return true;
  };
  function levelPlaces() {
    const lvl = S.level ? geo.get(S.level) : null;
    if (!lvl) return geo.inSystem(S.system);
    const out = [lvl], stack = [lvl.id];
    while (stack.length) for (const c of geo.children(stack.pop())) { out.push(c); stack.push(c.id); }
    return out;
  }
  function badgeFor(id, f) {
    const s = index.at.get(id); if (!s) return null;
    const es = [...s.out, ...s.in].filter((e) => f.origin.has(e.v.origin) && (!f.maxAlternatives || e.alternatives <= f.maxAlternatives));
    if (!es.length) return null;
    const best = es.some((e) => e.v.origin === 'utente') ? 'utente' : es.some((e) => e.v.origin === 'storica') ? 'storica' : es.some((e) => e.strength === 'fisso') ? 'catalogo' : null;
    return best ? { color: { utente: '#5dff9d', storica: '#3fd0ff', catalogo: '#ffb347' }[best] } : null;
  }
  function draw({ refit = false } = {}) {
    if (!geo) return;
    const f = filters();
    const cargoOnly = $('at-l-cargo').checked, termOnly = $('at-l-terminal').checked, disc = $('at-disc').checked;
    const places = levelPlaces().filter((p) => p.pos && layerOk(p)
      && (!cargoOnly || BODY_KINDS.has(p.kind) || p.id === S.selected || badgeFor(p.id, f))
      && (!termOnly || BODY_KINDS.has(p.kind) || p.services.length || p.id === S.selected));
    const discCtx = disc ? { geo, index, obsByPlace, currentPatch: currentPatch(), now: nowIso() } : null;
    const tags = routeTags();
    const items = places.map((p) => {
      const it = { id: p.id, pos: p.pos, kind: p.kind, label: p.name, selected: p.id === S.selected, badge: badgeFor(p.id, f) };
      if (discCtx && !BODY_KINDS.has(p.kind)) { const lv = discoveryScore(p.id, discCtx).level; it.ring = LEVELS[lv].color; }
      if (tags.has(p.id)) it.tag = tags.get(p.id);
      if (p.hidden) it.color = '#3b5266';
      return it;
    });
    const lvl = S.level ? geo.get(S.level) : null;
    let sphere = null;
    if (lvl && (lvl.kind === 'moon' || lvl.kind === 'planet') && lvl.radius) sphere = { center: lvl.pos, radius: lvl.radius };
    if (sphere) for (const it of items) { const sp = geo.surface(it.id); it.onSurface = sp.ok; }
    const compress = $('at-compress').checked ? compressor(lvl?.pos ?? geo.star(S.system)?.pos ?? { x: 0, y: 0, z: 0 }, lvl?.radius ? lvl.radius * 4 : 2e9) : null;
    view.setScene({ items, lines: buildLines(f), sphere: compress ? null : sphere, compress, clusterRadius: 14 });
    if (refit) view.frame(places.map((p) => p.pos), lvl?.pos ?? null);
    crumbs();
  }

  // tag P/D/O dei luoghi delle missioni selezionate (o del piano)
  function routeTags() {
    const m = new Map();
    if (S.plan) { stopsOf(S.plan.seq).forEach((s, i) => m.set(s.place.id, { text: String(i + 1), color: '#3fd0ff' })); return m; }
    for (const id of S.sel) {
      const v = index.byId.get(id); if (!v) continue;
      for (const o of v.ops) if (o.fixed) m.set(o.ids[0], { text: `${o.role === 'pickup' ? 'P' : 'D'}`, color: o.role === 'pickup' ? '#5dff9d' : '#ffb347' });
      for (const of of v.offer) if (of.id && !m.has(of.id)) m.set(of.id, { text: 'O', color: '#a98fd1' });
    }
    return m;
  }
  function buildLines(f) {
    const lines = [];
    const inSys = (id) => geo.get(id)?.system === S.system && geo.get(id)?.pos;
    if (S.plan) {
      const pts = stopsOf(S.plan.seq).map((s) => s.place);
      const start = S.plan.start ? geo.get(S.plan.start.id) : null;
      const chain = start ? [start, ...pts] : pts;
      for (let i = 1; i < chain.length; i++) {
        const a = geo.get(chain[i - 1].id), b = geo.get(chain[i].id);
        if (!a?.pos || !b?.pos) continue;
        if (a.system !== b.system) continue; // fra sistemi: nessuna linea (jump point)
        if (a.system !== S.system) continue;
        lines.push({ a: a.pos, b: b.pos, style: 'navcom', arrow: true, label: `${i}`, id: `leg:${i}` });
      }
    } else {
      for (const id of S.sel) {
        const v = index.byId.get(id); if (!v) continue;
        for (const s of missionSegments(v, geo, S.system)) {
          lines.push({ a: geo.get(s.from).pos, b: geo.get(s.to).pos, style: s.style, arrow: s.style !== 'offerta', label: s.scu ? `${s.scu} SCU` : '', id: `ms:${v.id}`, pickable: s.style !== 'offerta' });
        }
      }
    }
    if ($('at-conn').checked && S.selected) {
      // senza un limite scelto dal cursore, i collegamenti "possibili" arrivano da pool di al massimo 10 luoghi
      for (const c of index.connections(S.selected, { ...f, maxAlternatives: f.maxAlternatives ?? 10 })) {
        if (!inSys(c.from) || !inSys(c.to)) continue;
        lines.push({ a: geo.get(c.from).pos, b: geo.get(c.to).pos, style: c.strength, width: Math.min(6, 1 + Math.log2(c.missions.length)), arrow: true, id: `conn:${c.from}>${c.to}`, pickable: true, conn: c, alpha: 0.8 });
      }
    }
    return lines;
  }

  function onHover(h) {
    const el = $('at-hover');
    if (!h) { el.style.display = 'none'; return; }
    let t = '';
    if (h.kind === 'place') { const p = geo.get(h.id); t = `${esc(p.name)} · ${esc(KIND_LABEL[p.kind] ?? p.kind)}${index.at.has(p.id) ? ` · ${new Set([...index.at.get(p.id).out, ...index.at.get(p.id).in].map((e) => e.v.id)).size} missioni nei dati` : ''}`; }
    else if (h.kind === 'cluster') t = `${h.cluster.members.length} luoghi vicini: clic per avvicinarti`;
    else if (h.kind === 'line' && h.line.conn) t = `${esc(geo.get(h.line.conn.from)?.name)} → ${esc(geo.get(h.line.conn.to)?.name)} · ${h.line.conn.missions.length} missioni (${h.line.conn.fixed} con luoghi certi): clic per i dettagli`;
    else if (h.kind === 'line') t = 'collegamento di una missione selezionata';
    el.innerHTML = t; el.style.display = t ? 'block' : 'none';
  }
  function onPick(h) {
    if (!h) return;
    if (h.kind === 'place') select(h.id, { fly: false });
    else if (h.kind === 'line' && h.line.conn) showConnection(h.line.conn);
    else if (h.kind === 'line' && h.id?.startsWith('ms:')) showMission(h.id.slice(3));
  }

  /** Selezione di un luogo: pianeti e lune aprono la loro vista; le basi aprono la scheda. */
  function select(id, { fly = true } = {}) {
    const p = geo.get(id); if (!p) return;
    if (p.system !== S.system) S.system = p.system;
    S.selected = id; S.conn = null;
    let refit = false;
    if (p.kind === 'planet' || p.kind === 'moon') { if (S.level !== id) { S.level = id; refit = true; } }
    else if (p.kind === 'star') { S.level = null; refit = true; }
    else {
      const inLevel = S.level && geo.path(id).some((x) => x.id === S.level);
      if (!inLevel) { const b = geo.bodyOf(id); S.level = b ? b.id : null; refit = true; }
    }
    saveUi();
    draw({ refit });
    if (fly && !refit && p.pos) view.flyTo(view.vis(p.pos), Math.min(view.cam.dist, frameHint(p)));
    if (refit && !BODY_KINDS.has(p.kind) && p.pos) setTimeout(() => view.flyTo(view.vis(p.pos), Math.min(view.cam.dist, frameHint(p))), 470);
    renderCard();
  }
  const frameHint = (p) => { const b = geo.bodyOf(p.id); if (b?.radius && b.id !== p.id) return b.radius * 3.2; return p.kind === 'outpost' || p.kind === 'city' ? 1.5e5 : p.kind === 'station' ? 2e6 : 5e8; };
  function goSystem(sys) { S.system = sys; S.level = null; S.selected = null; saveUi(); draw({ refit: true }); renderTree(); $('at-right').innerHTML = '<p class="hint">Seleziona un luogo sulla mappa, nella ricerca o nella gerarchia.</p>'; }

  function crumbs() {
    const sysLinks = SYSTEMS.map((s) => `<a data-sys="${s}" ${s === S.system ? 'style="font-weight:700"' : ''}>${SYSTEM_LABEL[s]}</a>`).join(' · ');
    const chain = S.selected ? geo.path(S.selected).filter((x) => x.kind !== 'star') : S.level ? geo.path(S.level).filter((x) => x.kind !== 'star') : [];
    $('at-crumbs').innerHTML = `${sysLinks} ${chain.length ? '›' : ''} ${chain.map((x) => `<a data-id="${esc(x.id)}">${esc(x.name)}</a>`).join(' › ')}`;
    $('at-crumbs').querySelectorAll('[data-sys]').forEach((a) => { a.onclick = () => goSystem(a.dataset.sys); });
    $('at-crumbs').querySelectorAll('[data-id]').forEach((a) => { a.onclick = () => select(a.dataset.id); });
  }

  // ------------------------------------------------------------------ pannello sinistro
  function renderTree() {
    const star = geo.star(S.system);
    const rows = [];
    const rec = (p, lvl) => {
      if (!layerOk(p) && !BODY_KINDS.has(p.kind)) return;
      const n = index.at.get(p.id) ? new Set([...index.at.get(p.id).out, ...index.at.get(p.id).in].map((e) => e.v.id)).size : 0;
      rows.push(`<div class="lvl${Math.min(3, lvl)}" data-id="${esc(p.id)}">${BODY_KINDS.has(p.kind) ? '▸' : '·'} ${esc(p.name)}${n ? ` <span class="hint">(${n})</span>` : ''}</div>`);
      if (lvl < 3) for (const c of [...geo.children(p.id)].sort(order)) rec(c, lvl + 1);
    };
    const order = (a, b) => (BODY_KINDS.has(b.kind) - BODY_KINDS.has(a.kind)) || a.name.localeCompare(b.name);
    if (star) for (const c of [...geo.children(star.id)].sort(order)) rec(c, 0);
    else for (const p of geo.inSystem(S.system).filter((x) => x.kind === 'planet')) rec(p, 0);
    $('at-tree').innerHTML = rows.join('') || '<p class="hint">Nessun luogo per questo sistema.</p>';
    $('at-tree').querySelectorAll('[data-id]').forEach((d) => { d.onclick = () => select(d.dataset.id); });
  }
  function renderResults() {
    const q = $('at-q').value;
    const list = q.trim().length < 2 ? [] : geo.search(q, { limit: 30 });
    $('at-results').innerHTML = list.map((p) => `<div data-id="${esc(p.id)}">${esc(p.name)} <span class="hint">${esc(KIND_LABEL[p.kind] ?? '')} · ${esc(SYSTEM_LABEL[p.system])}${p.hidden ? ' · nascosto' : ''}</span></div>`).join('') || (q.trim().length >= 2 ? '<p class="hint">Nessun luogo trovato.</p>' : '');
    $('at-results').querySelectorAll('[data-id]').forEach((d) => { d.onclick = () => select(d.dataset.id); });
  }
  function fillFilters() {
    const companies = [...new Set(views.map((v) => v.company).filter(Boolean))].sort();
    const cur = $('at-f-company').value;
    $('at-f-company').innerHTML = '<option value="">tutte</option>' + companies.map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('at-f-rank').innerHTML = '<option value="">qualsiasi</option>' + RANKS.map((r, i) => `<option value="${i}">${i} · ${r}</option>`).join('');
    $('at-places').innerHTML = geo.places.filter((p) => !BODY_KINDS.has(p.kind) || p.kind !== 'star').map((p) => `<option value="${esc(p.name)}">`).join('');
  }

  // ------------------------------------------------------------------ LOCATION INTELLIGENCE
  const placeLink = (id, fallback = '?') => { const p = id ? geo.get(id) : null; return p ? `<a class="at-go" data-id="${esc(id)}">${esc(p.name)}</a>` : esc(fallback); };
  function opText(o) {
    if (o.fixed) return placeLink(o.ids[0]);
    if (o.size === 0 || (!o.ids.length && !o.unresolved.length)) return `<span class="warn">${TO_CONFIRM}</span>`;
    if (o.size === 1 && o.unresolved.length) return `${esc(o.unresolved[0])} <span class="at-pill maybe">nome non riconosciuto</span>`;
    const shown = o.ids.slice(0, 4).map((id) => placeLink(id)).join(', ');
    return `uno fra ${o.size} luoghi (${o.ids.length} riconosciuti${o.anonymous ? `, ${o.anonymous} sottoaree senza nome` : ''})${shown ? `: ${shown}${o.ids.length > 4 ? '…' : ''}` : ''} · <span class="warn">${TO_CONFIRM}</span>`;
  }
  function missionRow(e, here) {
    const v = e.v;
    const picks = v.ops.filter((o) => o.role === 'pickup'), drops = v.ops.filter((o) => o.role === 'dropoff');
    const qty = v.ops.filter((o) => o.role === 'dropoff' && o.scu).map((o) => `${o.scu} SCU ${esc(o.cargo ?? '')}`).join(', ') || (v.orders?.length ? v.orders.map((o) => `${esc(o.cargo ?? 'merce')} ${o.scuMin ?? '?'}–${o.scuMax ?? '?'} SCU`).join(', ') : 'quantità non nota');
    const boxes = [...new Set(v.ops.map((o) => o.containerMax).filter(Boolean).concat(v.maxBox ? [v.maxBox] : []))];
    const offer = v.offer.length ? v.offer.slice(0, 3).map((o) => (o.id ? placeLink(o.id) : esc(o.name ?? '?'))).join(', ') + (v.offer.length > 3 ? ` +${v.offer.length - 3}` : '') + (v.origin === 'catalogo' ? ' (può comparire)' : '') : 'non nota';
    return `<div class="at-ms"><label class="check"><input type="checkbox" data-sel="${esc(v.id)}" ${S.sel.has(v.id) ? 'checked' : ''}><span class="t">${ORIGIN[v.origin].icon} ${esc(v.title)}</span></label>
      <div class="s">${esc(v.company ?? 'datore non indicato')} · grado ${esc(v.rank ?? 'n.d.')} · ${fmtA(v.reward)}${v.status && v.origin === 'utente' ? ` · ${esc(STATUS[v.status] ?? v.status)}` : ''}</div>
      <div class="s">Offerta: ${offer}</div>
      <div class="s">Ritiro: ${picks.map(opText).join(' · ') || '<span class="warn">non nei dati</span>'}</div>
      <div class="s">Consegna: ${drops.map(opText).join(' · ') || '<span class="warn">non nei dati</span>'}</div>
      <div class="s">Merce: ${qty}${boxes.length ? ` · casse ≤ ${boxes.join('/')} SCU` : ' · dimensioni casse non note'}</div>
      <div class="s">${esc(ORIGIN[v.origin].label)} · patch ${esc(v.patch ?? 'non nota')}${v.observedAt ? ` · osservata ${esc(String(v.observedAt).slice(0, 10))}` : ''} · ${esc(v.source)}${e.strength === 'possibile' ? ` · <span class="at-pill maybe">qui è uno fra ${e.alternatives} luoghi</span>` : ' · <span class="at-pill sure">luogo certo</span>'}</div>
      <button data-show="${esc(v.id)}" class="mini">Mostra sulla mappa</button></div>`;
  }
  function section(title, list, here, key) {
    const sure = list.filter((e) => e.strength === 'fisso' || e.v.origin !== 'catalogo');
    const maybe = list.filter((e) => !(e.strength === 'fisso' || e.v.origin !== 'catalogo'));
    const lim = (a) => a.slice(0, S[`more-${key}`] ? 500 : MAX_LIST);
    return `<details class="at-sec" ${sure.length ? 'open' : ''}><summary>${title} (${sure.length} con luogo certo${maybe.length ? `, ${maybe.length} possibili` : ''})</summary>
      ${sure.length ? lim(sure).map((e) => missionRow(e, here)).join('') : '<p class="hint">Nessuna missione con luogo certo nei dati disponibili.</p>'}
      ${maybe.length ? `<details><summary class="hint">Modelli in cui questo luogo è una delle alternative (${maybe.length})</summary>${lim(maybe).map((e) => missionRow(e, here)).join('')}</details>` : ''}
      ${list.length > MAX_LIST && !S[`more-${key}`] ? `<button data-more="${key}" class="mini">Mostra tutte</button>` : ''}</details>`;
  }
  function renderCard() {
    const id = S.selected; const p = id ? geo.get(id) : null;
    if (!p) { $('at-right').innerHTML = '<p class="hint">Seleziona un luogo.</p>'; return; }
    const f = filters();
    const r = index.forPlace(id, f);
    const sp = geo.surface(id);
    const stats = placeStats(obsByPlace.get(id) ?? [], { currentPatch: currentPatch() });
    const anySure = [...r.out, ...r.in].some((e) => e.strength === 'fisso' || e.v.origin !== 'catalogo');
    const term = p.services.find((s) => s.id === 'terminale');
    const personalHere = p.kind === 'moon' || p.kind === 'planet' ? geo.children(id).filter((c) => c.kind === 'personal') : [];
    $('at-right').innerHTML = `<div class="at-card">
      <h3>${esc(p.name)}</h3><div class="path">${esc(geo.pathLabel(id))}</div>
      <dl>
        <dt>Tipo</dt><dd>${esc(KIND_LABEL[p.kind] ?? p.kind)}${p.type ? ` (${esc(p.type)})` : ''}${p.hidden ? ' · nascosto sulla starmap di gioco' : ''}</dd>
        <dt>Sistema</dt><dd>${esc(SYSTEM_LABEL[p.system])}</dd>
        <dt>Corpo</dt><dd>${esc(geo.bodyOf(id)?.name ?? (BODY_KINDS.has(p.kind) ? '—' : 'nessuno (spazio aperto)'))}</dd>
        <dt>Coordinate</dt><dd>${p.pos ? `${fmtKm(p.pos.x)} / ${fmtKm(p.pos.y)} / ${fmtKm(p.pos.z)} · frame ${esc(p.frame)}` : 'non disponibili'}</dd>
        <dt>Sul globo</dt><dd>${esc(sp.ok ? `${(sp.lat * 180 / Math.PI).toFixed(2)}° / ${(sp.lon * 180 / Math.PI).toFixed(2)}° · ${sp.note}` : sp.note)}</dd>
        ${p.radius ? `<dt>Raggio</dt><dd>${fmtKm(p.radius)} (${esc(p.radiusSource)})</dd>` : ''}
        <dt>Marker QT</dt><dd>${p.qtValid ? 'sì (bersaglio quantum nei dati)' : 'no o non indicato'}</dd>
        <dt>Servizi</dt><dd>${term ? `${esc(term.label)}: ${esc(term.tags.slice(0, 12).join(', '))}${term.tags.length > 12 ? '…' : ''}` : 'nessun servizio nei dati'}</dd>
        <dt>Freight elevator</dt><dd>non verificato: i dati pubblici non lo indicano</dd>
        <dt>Accesso nave</dt><dd>non indicato dai dati</dd>
        <dt>Fonte</dt><dd>${esc(p.source)}${p.patch ? ` · ${esc(p.patch)}` : ''}${p.ext?.starmap ? ` · uuid ${esc(p.ext.starmap.slice(0, 8))}…` : ''}</dd>
        <dt>Tue verifiche</dt><dd>${stats.current.visits} visite nella patch attuale (${esc(stats.current.sample)})${stats.previous.visits ? ` · ${stats.previous.visits} in patch precedenti (obsolete)` : ''}${stats.current.emptyVisits ? ` · ${stats.current.emptyVisits} senza offerte` : ''}</dd>
      </dl>
      ${p.personal ? `<p class="hint">Punto personale del DATABASE PUNTI${p.personal.resource ? ` · ${esc(p.personal.resource)}` : ''}${p.parentHow ? ` · associato a ${esc(geo.get(p.parentId)?.name)} (${esc(p.parentHow)})` : ''}. ${esc(p.personal.notes ?? '')}</p>` : ''}
      ${personalHere.length ? `<p class="hint">Punti personali qui: ${personalHere.map((x) => placeLink(x.id)).join(', ')}</p>` : ''}
      <div class="row wrap">
        ${p.pos ? '<button id="at-c-qt">Rotta QT qui</button>' : ''}
        <button id="at-c-best" class="primary" style="width:auto">TROVA LA MIGLIORE COMBINAZIONE</button>
        <button id="at-c-visit">Registra verifica</button>
        <button id="at-c-add">Aggiungi contratto visto qui</button>
        <button id="at-c-conn">${$('at-conn').checked ? 'Nascondi' : 'Mostra'} collegamenti</button>
      </div>
      <div id="at-c-best-out"></div>
      ${!anySure ? '<p class="warn">Nessuna missione confermata nei dati disponibili per questo luogo. Non significa che nel gioco non esistano missioni: registra ciò che trovi al pannello.</p>' : ''}
      ${section('MISSIONI IN USCITA (ritiro qui)', r.out, id, 'out')}
      ${section('MISSIONI IN ENTRATA (consegna qui)', r.in, id, 'in')}
      ${section('MISSIONI IN TRANSITO (uno di più scali)', r.transit, id, 'transit')}
      <details class="at-sec"><summary>OFFERTE CHE POSSONO COMPARIRE QUI (${r.offer.length})</summary>${r.offer.slice(0, MAX_LIST).map((e) => missionRow({ v: e.v, strength: 'fisso', alternatives: 1 }, id)).join('') || '<p class="hint">Nessuna offerta associata a questo luogo nei dati.</p>'}</details>
      <p class="hint">Le missioni dei modelli vengono offerte in un luogo e il gioco assegna il punto di ritiro e di consegna al momento: il luogo dell'offerta non è mai copiato nel ritiro.</p>
    </div>`;
    bindCard(id);
  }
  function bindCard(id) {
    const R = $('at-right');
    R.querySelectorAll('.at-go').forEach((a) => { a.onclick = () => select(a.dataset.id); });
    R.querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => { toggleSel(c.dataset.sel, c.checked); }; });
    R.querySelectorAll('[data-show]').forEach((b) => { b.onclick = () => { toggleSel(b.dataset.show, true); showMission(b.dataset.show); }; });
    R.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => { S[`more-${b.dataset.more}`] = true; renderCard(); }; });
    const p = geo.get(id);
    $('at-c-qt') && ($('at-c-qt').onclick = () => app.planTo?.({ name: p.name, system: p.system, x: p.pos.x, y: p.pos.y, z: p.pos.z, unit: 'm' }));
    $('at-c-best').onclick = () => runBest(id);
    $('at-c-visit').onclick = () => visitDialog(id);
    $('at-c-add').onclick = () => contractDialog({ offer: id });
    $('at-c-conn').onclick = () => { $('at-conn').checked = !$('at-conn').checked; draw(); renderCard(); };
  }
  function toggleSel(id, on) { if (on) S.sel.add(id); else S.sel.delete(id); S.plan = null; saveUi(); renderSel(); draw(); }

  function showMission(id) {
    const v = index.byId.get(id); if (!v) return;
    const ps = v.ops.filter((o) => o.fixed).map((o) => geo.get(o.ids[0])).filter((p) => p?.pos && p.system === S.system);
    if (ps.length) view.frame(ps.map((p) => p.pos));
    activateBottom('sel');
  }
  function showConnection(c) {
    S.conn = c;
    const list = c.missions.map((id) => index.byId.get(id)).filter(Boolean);
    $('at-right').innerHTML = `<div class="at-card"><h3>${placeLink(c.from)} → ${placeLink(c.to)}</h3>
      <p class="hint">${c.missions.length} missioni generano questo collegamento: ${c.fixed} con entrambi i luoghi certi, ${c.possible} in cui almeno un capo è una di più alternative. Distanza reale: ${geo.distance(c.from, c.to) != null ? fmtLen(geo.distance(c.from, c.to)) : 'non calcolabile'}.</p>
      ${list.slice(0, 60).map((v) => missionRow({ v, strength: v.ops.every((o) => o.fixed) ? 'fisso' : 'possibile', alternatives: Math.max(...v.ops.map((o) => o.size)) }, c.from)).join('')}
      <button id="at-back" class="mini">Torna alla scheda del luogo</button></div>`;
    bindCard(S.selected ?? c.from);
    $('at-back').onclick = () => renderCard();
  }

  // ------------------------------------------------------------------ pannello inferiore
  function activateBottom(k) {
    document.querySelectorAll('[data-atb]').forEach((b) => b.classList.toggle('active', b.dataset.atb === k));
    document.querySelectorAll('.atb').forEach((d) => d.classList.toggle('active', d.id === `at-b-${k}`));
    ({ sel: renderSel, plan: renderPlan, plans: renderPlans, disc: renderDisc, queue: renderQueue, sources: renderSources })[k]?.();
  }
  function ctxForm() {
    const l = L();
    return `<div class="row wrap form">
      <label>Partenza<input id="at-s-start" list="at-places" value="${esc($('at-s-start')?.value ?? l.pos ?? '')}" placeholder="posizione attuale"></label>
      <label>Destinazione finale (facoltativa)<input id="at-s-dest" list="at-places" value="${esc($('at-s-dest')?.value ?? '')}"></label>
      <label>Capacità cargo (SCU)<input id="at-s-cap" inputmode="numeric" value="${esc($('at-s-cap')?.value ?? l.capacity ?? '')}"></label>
      <label>Scali massimi<input id="at-s-stops" inputmode="numeric" value="${esc($('at-s-stops')?.value ?? '')}" placeholder="nessun limite"></label>
      <label class="check"><input type="checkbox" id="at-b-illegal" ${($('at-b-illegal')?.checked ?? true) ? 'checked' : ''}>Escludi missioni illegali (rischio)</label>
    </div><p class="hint">Nave: ${esc(l.ship?.name ?? 'n.d.')} · cassa massima ${l.ship?.maxBox ?? 'n.d.'} SCU · gradi e tempi di movimentazione si impostano in LOGISTICS. Tempo di viaggio solo con i parametri del drive in DATI E IMPOSTAZIONI.</p>`;
  }
  function renderSel() {
    const list = [...S.sel].map((id) => index.byId.get(id)).filter(Boolean);
    $('at-b-sel').innerHTML = `${ctxForm()}
      ${list.length ? `<div class="tablewrap"><table><thead><tr><th></th><th>Missione</th><th>Ritiro</th><th>Consegna</th><th class="num">Ricompensa</th><th>Origine</th></tr></thead><tbody>${list.map((v) => `<tr>
        <td><button class="mini" data-unsel="${esc(v.id)}">✕</button></td><td>${esc(v.title)}<br><span class="hint">${esc(v.company ?? '')}</span></td>
        <td class="wrapcell">${v.ops.filter((o) => o.role === 'pickup').map(opText).join('<br>')}</td><td class="wrapcell">${v.ops.filter((o) => o.role === 'dropoff').map(opText).join('<br>')}</td>
        <td class="num">${fmtA(v.reward)}</td><td>${ORIGIN[v.origin].icon} ${esc(v.origin === 'utente' ? STATUS[v.status] ?? v.status : ORIGIN[v.origin].label)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nessuna missione selezionata: spuntale nella scheda di un luogo.</p>'}
      <div class="row wrap"><button id="at-s-eval" ${list.length ? '' : 'disabled'}>POSSO ACCUMULARLE?</button><button id="at-s-sugg" ${list.length ? '' : 'disabled'}>Quali altre posso accumulare con queste?</button><button id="at-s-clear" ${list.length ? '' : 'disabled'}>Svuota selezione</button></div>
      <div id="at-s-out"></div>`;
    $('at-b-sel').querySelectorAll('[data-unsel]').forEach((b) => { b.onclick = () => toggleSel(b.dataset.unsel, false); });
    $('at-s-clear').onclick = () => { S.sel.clear(); S.plan = null; saveUi(); renderSel(); draw(); };
    $('at-s-eval').onclick = () => { const r = evaluateStack(list, stackCtx()); $('at-s-out').innerHTML = resultHtml(r, true); bindResult(r); };
    $('at-s-sugg').onclick = () => {
      $('at-s-out').innerHTML = '<p class="hint">Calcolo in corso…</p>';
      setTimeout(() => {
        const rows = suggestStack(list, index, stackCtx());
        $('at-s-out').innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr><th>Esito con la selezione</th><th>Missione</th><th>Tipologia</th><th class="num">Ricompensa</th><th>Motivo / dati</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr>
          <td class="at-cls">${CLASSES[x.result.cls].icon} ${CLASSES[x.result.cls].label}</td><td>${ORIGIN[x.v.origin].icon} ${esc(x.v.title)}<br><span class="hint">${esc(x.v.company ?? '')}</span></td>
          <td>${x.types.map((t) => `<span class="at-pill ${t.sure ? 'sure' : 'maybe'}">${t.label}${t.sure ? '' : ' (possibile)'}</span>`).join('')}</td><td class="num">${fmtA(x.v.reward)}</td>
          <td class="wrapcell hint">${esc([...x.result.reasons, ...x.result.missing].slice(0, 2).join(' · ') || (x.result.metrics ? `picco ${x.result.metrics.peak} SCU · ${x.result.metrics.stops} scali · ${fmtLen(x.result.metrics.distance)}` : ''))}</td>
          <td><button class="mini" data-add="${esc(x.v.id)}">Aggiungi</button></td></tr>`).join('')}</tbody></table></div>
          <p class="hint">La sovrapposizione dei luoghi non rende eseguibili due contratti: l'esito considera capacità, precedenze, casse, gradi e dati mancanti. "(possibile)" = coincidenza su un luogo che il gioco sceglie fra più alternative.</p>` : '<p class="hint">Nessuna missione nei dati condivide luoghi con la selezione.</p>';
        $('at-s-out').querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { toggleSel(b.dataset.add, true); }; });
      }, 20);
    };
  }
  function resultHtml(r, withPlan) {
    const c = CLASSES[r.cls], m = r.metrics;
    return `<p class="at-cls">${c.icon} ${c.label} <span class="hint">${esc(c.note)}</span></p>
      ${r.reasons.map((x) => `<p class="err">${esc(x)}</p>`).join('')}${r.missing.map((x) => `<p class="warn">${esc(x)}</p>`).join('')}
      ${m ? `<div class="at-scen"><div>Ricompense contratti accettati<br><b>${fmtA(m.rewardAccepted)}</b></div><div>Opportunità non confermate<br><b>${fmtA(m.rewardUnconfirmed)}</b>${m.rewardUnknown ? `<br><span class="hint">${m.rewardUnknown} ricompense non note</span>` : ''}</div>
        <div>SCU massime contemporanee<br><b>${m.peak} / ${stackCtx().capacity}</b></div><div>Ritiri ${m.pickups} · consegne ${m.dropoffs} · scali ${m.stops}</div>
        <div>Percorso<br><b>${m.unknownLegs ? 'incompleto' : fmtLen(m.distance)}</b>${m.unknownLegs ? `<br><span class="hint">${m.unknownLegs} tratte non note (escluse)</span>` : ''}</div>
        <div>Tempo<br><b>${m.hours != null ? `${(m.hours * 60).toFixed(0)} min` : 'non calcolabile'}</b><br><span class="hint">${m.perHour != null ? `${fmtA(m.perHour)}/h` : m.perGm != null ? `efficienza ${fmtA(m.perGm)} per Gm` : 'efficienza non calcolabile'}</span></div>
        <div>Metodo<br>${esc(m.method)}</div></div>` : ''}
      ${(r.warnings ?? []).map((x) => `<p class="warn">${esc(x)}</p>`).join('')}${(r.assumed ?? []).map((x) => `<p class="hint">Ipotesi: ${esc(x)}</p>`).join('')}
      ${withPlan && r.route ? '<button id="at-s-mkplan">Crea piano cargo e mostra il percorso</button>' : ''}`;
  }
  function bindResult(r) {
    $('at-s-mkplan') && ($('at-s-mkplan').onclick = () => {
      const c = stackCtx();
      S.plan = planFromStack(r, { capacity: c.capacity, ship: c.ship, start: c.start ? { id: c.start, name: geo.get(c.start).name, system: geo.get(c.start).system } : null });
      draw(); activateBottom('plan');
    });
  }
  async function runBest(id) {
    $('at-c-best-out').innerHTML = '<p class="hint">Calcolo in corso…</p>';
    activateBottom('sel');
    setTimeout(() => {
      const b = bestStack(id, index, stackCtx());
      const card = (k) => {
        const s = b.scenarios[k]; const r = s.result;
        if (!r?.route) return `<div><b>${SCENARIOS[k].label}</b><p class="hint">Nessuna combinazione calcolabile.</p></div>`;
        return `<div><b>${SCENARIOS[k].label}</b><br><span class="hint">${esc(SCENARIOS[k].note)}</span><br>${CLASSES[r.cls].icon} ${CLASSES[r.cls].label}<br>
          ${r.views.map((v) => `${ORIGIN[v.origin].icon} ${esc(v.title)}`).join('<br>')}<br>
          accettate ${fmtA(r.metrics.rewardAccepted)} · non confermate ${fmtA(r.metrics.rewardUnconfirmed)}<br>picco ${r.metrics.peak} SCU · ritiri ${r.metrics.pickups} · consegne ${r.metrics.dropoffs} · ${r.metrics.unknownLegs ? 'percorso incompleto' : fmtLen(r.metrics.distance)}
          <br>qualità: ${r.views.every((v) => v.origin === 'utente') ? 'contratti tuoi' : r.views.some((v) => v.origin === 'catalogo') ? 'include modelli di catalogo' : 'include osservazioni storiche di terzi'}
          <br><button class="mini" data-scen="${k}">Usa questa combinazione</button></div>`;
      };
      $('at-c-best-out').innerHTML = `<div class="at-scen">${Object.keys(SCENARIOS).map(card).join('')}</div>
        ${b.notes.map((n) => `<p class="warn">${esc(n)}</p>`).join('')}
        <p class="hint">${b.mandatory.length} contratti accettati sempre inclusi · ${b.candidates.length} missioni pianificabili per questo luogo · ${b.excluded.length} escluse (luoghi non certi, quantità non note, gradi o casse incompatibili).</p>`;
      $('at-c-best-out').querySelectorAll('[data-scen]').forEach((x) => { x.onclick = () => {
        const r = b.scenarios[x.dataset.scen].result;
        S.sel = new Set(r.views.map((v) => v.id)); saveUi();
        const c = stackCtx();
        S.plan = planFromStack(r, { capacity: c.capacity, ship: c.ship, start: c.start ? { id: c.start, name: geo.get(c.start).name, system: geo.get(c.start).system } : null });
        draw(); activateBottom('plan'); renderCard();
      }; });
    }, 20);
  }

  function renderPlan() {
    const p = S.plan;
    if (!p) { $('at-b-plan').innerHTML = '<p class="hint">Nessun piano: valuta una selezione con POSSO ACCUMULARLE? e crea il piano, oppure apri un piano salvato.</p>'; return; }
    const legOf = geoLegOf(geo, { drive: app.navOptions().drive, prep: app.navOptions().prep });
    const mes = measure(p.seq, legOf, p.start);
    const man = manifestOf(p);
    const stops = stopsOf(p.seq);
    const ok = (k) => p.opsDone?.[k];
    $('at-b-plan').innerHTML = `<p><b>${esc(p.name)}</b> · ${CLASSES[p.cls]?.icon ?? ''} ${CLASSES[p.cls]?.label ?? ''} · picco ${man.peak} / ${p.capacity} SCU · ${mes.unknownLegs ? 'percorso incompleto' : fmtLen(mes.distance)} · ${mes.travelTime != null ? `${Math.round(mes.travelTime / 60)} min di viaggio` : 'tempo non calcolabile'} · ricompense ${fmtA(man.totalReward)}${man.unknownRewards ? ` (${man.unknownRewards} non note)` : ''}</p>
      ${holdChartSvg(man)}
      <div class="tablewrap"><table class="at-stops"><thead><tr><th>#</th><th>Ordine</th><th>Scalo</th><th>Operazioni</th><th class="num">A bordo prima</th><th class="num">Dopo</th><th class="num">Residua</th><th class="num">Maturate</th><th>Problemi</th></tr></thead><tbody>${man.stops.map((s, i) => `<tr>
        <td>${s.n}</td><td><button class="mini" data-up="${i}" ${i ? '' : 'disabled'}>▲</button><button class="mini" data-dn="${i}" ${i < man.stops.length - 1 ? '' : 'disabled'}>▼</button></td>
        <td><a class="at-go" data-id="${esc(stops[i].place.id)}">${esc(s.place.name)}</a></td>
        <td class="wrapcell">${s.ops.map((o, j) => { const k = `${i}:${j}:${o.contractId}:${o.movementId}:${o.type}`; return `<label class="check"><input type="checkbox" data-done="${esc(k)}" ${ok(k) ? 'checked' : ''}>${o.type === 'carico' ? '⬆ ritira' : '⬇ scarica'} ${o.qty} SCU ${esc(o.cargo ?? '')} · ${esc(o.title)}${o.containerMax ? ` (casse ≤${o.containerMax})` : ''}${o.proposed ? ' · da trovare e accettare' : ''}</label>`; }).join('<br>')}</td>
        <td class="num">${s.loadBefore}</td><td class="num">${s.loadAfter}</td><td class="num">${s.residual}</td><td class="num">${fmtA(s.rewardCumulative)}</td>
        <td class="wrapcell">${s.warnings.map((w) => `⚪ ${esc(w)}`).join('<br>')}${mes.legs[i]?.note ? `<br>⚪ ${esc(mes.legs[i].note)}` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div id="at-p-msg"></div>
      ${man.limits.map((l) => `<p class="warn">${esc(l)}</p>`).join('')}${(p.assumed ?? []).map((x) => `<p class="hint">Ipotesi: ${esc(x)}</p>`).join('')}
      <div class="row wrap"><label>Nome del piano<input id="at-p-name" value="${esc(p.name)}"></label><button id="at-p-save">Salva piano</button><button id="at-p-close">Chiudi piano</button></div>`;
    $('at-b-plan').querySelectorAll('.at-go').forEach((a) => { a.onclick = () => select(a.dataset.id); });
    const mv = (i, j) => { const r = moveStop(p, i, j); if (!r.ok) { $('at-p-msg').innerHTML = `<p class="err">Ordine non ammesso: ${esc(r.errors[0])}</p>`; return; } p.seq = r.seq; p.updatedAt = nowIso(); draw(); renderPlan(); };
    $('at-b-plan').querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => mv(+b.dataset.up, +b.dataset.up - 1); });
    $('at-b-plan').querySelectorAll('[data-dn]').forEach((b) => { b.onclick = () => mv(+b.dataset.dn, +b.dataset.dn + 1); });
    $('at-b-plan').querySelectorAll('[data-done]').forEach((c) => { c.onchange = () => { p.opsDone = { ...p.opsDone, [c.dataset.done]: c.checked }; if (plans.some((x) => x.id === p.id)) db.putPlans([p]); }; });
    $('at-p-save').onclick = async () => { p.name = $('at-p-name').value.trim() || p.name; p.updatedAt = nowIso(); await db.putPlans([p]); plans = await db.plans(); $('at-p-msg').innerHTML = '<p class="ok">Piano salvato in questo browser (IndexedDB).</p>'; };
    $('at-p-close').onclick = () => { S.plan = null; draw(); renderPlan(); };
  }
  function renderPlans() {
    $('at-b-plans').innerHTML = plans.length ? `<div class="tablewrap"><table><thead><tr><th>Piano</th><th>Creato</th><th>Contratti</th><th>Esito</th><th></th></tr></thead><tbody>${[...plans].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((p) => `<tr>
      <td>${esc(p.name)}</td><td>${esc(p.createdAt.slice(0, 16).replace('T', ' '))}</td><td>${p.contracts.length}</td><td>${CLASSES[p.cls]?.icon ?? ''} ${CLASSES[p.cls]?.label ?? ''}</td>
      <td><button class="mini" data-open="${esc(p.id)}">Apri</button><button class="mini danger" data-del="${esc(p.id)}">Elimina</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nessun piano salvato.</p>';
    $('at-b-plans').querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { S.plan = structuredClone(plans.find((p) => p.id === b.dataset.open)); draw(); activateBottom('plan'); }; });
    $('at-b-plans').querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (!confirm('Eliminare il piano? I contratti non vengono toccati.')) return; await db.deletePlans([b.dataset.del]); plans = await db.plans(); renderPlans(); }; });
  }
  function renderDisc() {
    $('at-b-disc').innerHTML = `<div class="row wrap form"><label>Da dove parti<input id="at-d-from" list="at-places" value="${esc($('at-d-from')?.value ?? L().pos ?? '')}"></label><label>Destinazione desiderata (facoltativa)<input id="at-d-dest" list="at-places" value="${esc($('at-d-dest')?.value ?? '')}"></label><button id="at-d-go">Quali basi dovrei verificare?</button></div><div id="at-d-out"></div>
      <p class="hint">Punteggio deterministico 0-100 con pesi fissi: novità ${3}, tempo dall'ultima visita 1,5, missioni associate 3, destinazione 2, deviazione 2, qualità delle fonti 1,5, costo di verifica 1. Legenda sulla mappa (livello Discovery): ${Object.values(LEVELS).map((l) => `<span style="color:${l.color}">${l.icon} ${l.label}</span>`).join(' · ')}.</p>`;
    $('at-d-go').onclick = () => {
      const from = geo.resolveName($('at-d-from').value)?.id ?? null, dest = geo.resolveName($('at-d-dest').value)?.id ?? null;
      const rows = rankDiscovery({ geo, index, obsByPlace, currentPatch: currentPatch(), now: nowIso(), from, destination: dest, drive: app.navOptions().drive }, { system: S.system });
      $('at-d-out').innerHTML = `<div class="tablewrap"><table><thead><tr><th class="num">Punti</th><th>Luogo</th><th>Livello</th><th>Perché</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="num">${r.score}</td><td><a class="at-go" data-id="${esc(r.place.id)}">${esc(r.place.name)}</a></td><td style="color:${LEVELS[r.level].color}">${LEVELS[r.level].icon} ${LEVELS[r.level].label}</td><td class="wrapcell hint">${esc(r.parts.map((x) => `${x.text}`).join(' · '))}${r.why.length ? ` · ${esc(r.why.join(' · '))}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      $('at-d-out').querySelectorAll('.at-go').forEach((a) => { a.onclick = () => select(a.dataset.id); });
      $('at-disc').checked = true; draw();
    };
  }
  function renderQueue() {
    const q = normalizationQueue(cat, queueExtra);
    $('at-b-queue').innerHTML = `<p class="hint">Nomi di luoghi presenti nelle missioni ma non associati a un luogo canonico (nessuna associazione arbitraria). Molti sono sottoaree generiche (Lobby, Storehouse…) che il gioco risolve dentro una base: restano non collocabili. Totale ${q.length}.</p>
      <div class="tablewrap"><table><thead><tr><th>Nome</th><th class="num">Occorrenze</th><th>Esito</th><th>Fonti</th></tr></thead><tbody>${q.slice(0, 300).map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.count}</td><td>${esc(x.how)}</td><td>${esc(x.sources.join(', '))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function renderSources() {
    const i = meta.index, mm = meta.missions;
    const geoCount = Object.fromEntries(SYSTEMS.map((s) => [s, geo.inSystem(s).filter((p) => p.kind !== 'personal').length]));
    $('at-b-sources').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Dato</th><th>Fonte</th><th>Patch</th><th>Aggiornato</th><th>Copertura</th><th>Note</th></tr></thead><tbody>
      <tr><td>Luoghi (gerarchia e coordinate)</td><td>${esc(meta.geo?.source ?? meta.from)}</td><td>${esc(meta.geo?.patch ?? 'n.d.')}</td><td>${esc((meta.geo?.fetchedAt ?? '').slice(0, 10) || 'n.d.')}</td><td>${SYSTEMS.map((s) => `${SYSTEM_LABEL[s]} ${geoCount[s]}`).join(' · ')}</td><td>frame del sistema, valori statici; i 739 luoghi non nascosti coincidono con CitizenHQ · copia ${esc(meta.from)}</td></tr>
      <tr><td>Modelli di missione</td><td>${esc(mm?.source ?? 'non disponibile')}</td><td>${esc(mm?.patch ?? 'n.d.')}</td><td>${esc((mm?.fetchedAt ?? '').slice(0, 10) || 'n.d.')}</td><td>${mm ? `${mm.missions} modelli · ${Object.entries(mm.coverage).map(([k, v]) => `${k} ${v}`).join(' · ')} · ${mm.withReward} con ricompensa fissa` : '—'}</td><td>${esc(mm?.license ?? '')}. La Star Citizen Wiki API espone gli stessi modelli (stessa estrazione): non conta come conferma indipendente.</td></tr>
      <tr><td>Missioni osservate</td><td>SCHaulingPlanner</td><td>non indicata</td><td>${esc(schp?.meta?.observedFrom ?? 'n.d.')} → ${esc(schp?.meta?.observedTo ?? '')}</td><td>${schp ? `${schp.entries.length} missioni, solo Stanton` : 'non disponibile'}</td><td>${esc(schp?.meta?.license ?? '')}</td></tr>
      <tr><td>Contratti e verifiche tuoi</td><td>IndexedDB "navcom-logistics"</td><td>quella che indichi</td><td>—</td><td>${contracts.length} contratti · ${observations.length} osservazioni · ${plans.length} piani</td><td>mai sovrascritti dagli aggiornamenti dei cataloghi</td></tr>
      </tbody></table></div>
      <p class="hint">Collegamenti esterni (consultazione, nessun dato importato): <a href="https://sc-toolbox.com/" target="_blank" rel="noopener">SC-Toolbox</a> (missioni, nessuna API pubblica) · <a href="https://www.citizenhq.space/" target="_blank" rel="noopener">CitizenHQ</a> · <a href="https://github.com/StarCitizenWiki/scunpacked-data" target="_blank" rel="noopener">scunpacked-data</a>.</p>
      ${i ? `<p class="hint">Catalogo generato ${esc(i.generatedAt)} · ${i.contractsRead} contratti letti · ${i.queue} nomi in coda di normalizzazione.</p>` : ''}`;
  }

  // ------------------------------------------------------------------ inserimento rapido
  function dlg(html) { $('at-dlg-body').innerHTML = html; $('at-dlg').showModal(); }
  const close = () => $('at-dlg').close();
  function visitDialog(id) {
    const p = geo.get(id);
    dlg(`<h2>Verifica al pannello: ${esc(p.name)}</h2><div class="form">
      <label>Pannello consultato<select id="v-panel"><option>Hauling (cargo)</option><option>Delivery (pacchi)</option><option>Tutte le missioni di trasporto</option></select></label>
      <label>Patch<input id="v-patch" value="${esc(currentPatch())}"></label>
      <label>Il tuo grado (facoltativo)<input id="v-rank"></label>
      <label class="check"><input type="checkbox" id="v-none">Ho consultato il pannello e non c'era nessuna offerta di trasporto</label>
      <p class="hint">Offerte viste (una per riga: titolo ; compagnia ; ritiro ; consegna ; SCU ; ricompensa). Una missione non registrata non viene considerata assente.</p>
      <textarea id="v-offers" rows="5" placeholder="Covalex Planetary ; Covalex Independent Contractors ; ArcCorp Mining Area 061 ; Baijini Point ; 24 ; 52000"></textarea>
      <div class="row wrap"><button id="v-save" class="primary" style="width:auto">Registra</button><button id="v-cancel">Annulla</button></div><div id="v-msg"></div></div>`);
    $('v-cancel').onclick = close;
    $('v-save').onclick = async () => {
      const visit = newId(), at = nowIso(), base = { place: p.name, system: p.system, at, visit, patch: $('v-patch').value.trim() || null, pilotRank: $('v-rank').value.trim() || null, notes: `pannello: ${$('v-panel').value}` };
      const lines = $('v-offers').value.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length && !$('v-none').checked) { $('v-msg').innerHTML = '<p class="err">Inserisci le offerte viste, oppure conferma di aver consultato il pannello senza trovarne.</p>'; return; }
      const list = lines.length ? lines.map((l) => { const [title, company, from, to, scu, reward] = l.split(';').map((x) => x?.trim()); return { ...base, title, company, from, to, scu, reward, outcome: 'presente' }; }) : [{ ...base, outcome: 'nessuna' }];
      const ok = [], errs = [];
      for (const o of list) { const r = normalizeObservation(o); if (r.observation) ok.push(r.observation); else errs.push(r.errors.join('; ')); }
      await db.putObservations(ok); close(); await reloadUser(); renderCard(); draw();
      if (errs.length) alert(errs.join('\n'));
    };
  }
  function contractDialog({ offer = null, draft = null } = {}) {
    const o = offer ? geo.get(offer) : null;
    const row = (m = {}) => `<div class="row wrap mrow"><input name="cargo" placeholder="merce" value="${esc(m.cargo ?? '')}"><input name="scu" placeholder="SCU" inputmode="numeric" value="${esc(m.scu ?? '')}"><input name="box" placeholder="cassa max SCU" inputmode="numeric" value="${esc(m.containerMax ?? '')}"><input name="from" list="at-places" placeholder="luogo di ritiro" value="${esc(m.from ?? '')}"><input name="to" list="at-places" placeholder="luogo di consegna" value="${esc(m.to ?? '')}"></div>`;
    dlg(`<h2>Contratto reale</h2><div class="form">
      <label>Nome<input id="k-title" value="${esc(draft?.title ?? '')}"></label><label>Compagnia<input id="k-company" value="${esc(draft?.company ?? '')}"></label>
      <label>Grado richiesto<input id="k-rank"></label><label>Ricompensa (aUEC)<input id="k-reward" inputmode="numeric"></label>
      <label>Luogo dell'offerta<input id="k-offer" list="at-places" value="${esc(o?.name ?? '')}"></label>
      <label>Stato<select id="k-status"><option value="osservata">Osservata</option><option value="confermata">Confermata nel MobiGlas</option><option value="accettata">Accettata</option></select></label>
      <label>Patch<input id="k-patch" value="${esc(currentPatch())}"></label>
      <p class="hint">Un movimento per ogni ritiro → consegna. Il luogo dell'offerta NON viene copiato nel ritiro: lascialo vuoto se il MobiGlas non lo mostra ancora.</p>
      <div id="k-rows">${row()}</div><button id="k-addrow" class="mini">+ movimento</button>
      <label>Screenshot del MobiGlas (facoltativo, resta in questo browser)<input type="file" id="k-shot" accept="image/*" multiple></label>
      <div class="row wrap"><button id="k-save" class="primary" style="width:auto">Salva</button><button id="k-cancel">Annulla</button></div><div id="k-msg"></div></div>`);
    $('k-cancel').onclick = close;
    $('k-addrow').onclick = () => $('k-rows').insertAdjacentHTML('beforeend', row());
    $('k-save').onclick = async () => {
      const sysOf = (n) => geo.resolveName(n)?.system ?? o?.system ?? null;
      const movements = [...document.querySelectorAll('#k-rows .mrow')].map((r, i) => {
        const g = (n) => r.querySelector(`[name=${n}]`).value.trim();
        const fromP = geo.resolveName(g('from')), toP = geo.resolveName(g('to'));
        return { id: `m${i + 1}`, cargo: g('cargo'), scu: g('scu'), containerMax: g('box'), from: g('from') ? { name: fromP?.name ?? g('from'), system: fromP?.system ?? sysOf(g('from')) } : null, to: g('to') ? { name: toP?.name ?? g('to'), system: toP?.system ?? sysOf(g('to')) } : null };
      }).filter((m) => m.scu || m.from || m.to || m.cargo);
      const offerP = geo.resolveName($('k-offer').value);
      const r = normalizeContract({ title: $('k-title').value, company: $('k-company').value, rank: $('k-rank').value, reward: $('k-reward').value, status: $('k-status').value, patch: $('k-patch').value, offerZone: offerP?.name ?? $('k-offer').value, system: offerP?.system ?? o?.system ?? 'stanton', source: 'manuale (atlante)', movements });
      if (!r.contract) { $('k-msg').innerHTML = `<p class="err">${esc(r.errors.join(' · '))}</p>`; return; }
      const dup = findDuplicates([...contracts, r.contract]).find((g) => g.includes(r.contract));
      if (dup && !confirm(`Possibile duplicato di "${dup.find((x) => x !== r.contract).title}" (stessa compagnia, ricompensa e percorso). Salvare comunque?`)) return;
      await db.putContracts([r.contract]);
      const files = [...($('k-shot').files ?? [])];
      const shots = await Promise.all(files.map((f) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ id: newId(), contractId: r.contract.id, name: f.name, type: f.type, dataUrl: fr.result, at: nowIso() }); fr.readAsDataURL(f); })));
      await db.putAttachments(shots.filter((s) => String(s.dataUrl).startsWith('data:image/')));
      close(); await reloadUser(); lg.refreshAll?.(); renderCard(); draw();
      if (r.warnings.length) alert(`Salvato. Avvisi:\n${r.warnings.join('\n')}`);
    };
  }

  // ------------------------------------------------------------------ avvio
  function bindUi() {
    $('at-home').onclick = () => goSystem(S.system);
    $('at-2d').onchange = () => { view.setOrtho($('at-2d').checked); draw(); };
    for (const idb of ['at-compress', 'at-conn', 'at-disc', 'at-l-outpost', 'at-l-station', 'at-l-poi', 'at-l-asteroid', 'at-l-personal', 'at-l-hidden', 'at-l-cargo', 'at-l-terminal']) $(idb).onchange = () => { draw({ refit: idb === 'at-compress' }); if (idb.startsWith('at-l-')) renderTree(); };
    for (const idf of ['at-o-utente', 'at-o-storica', 'at-o-catalogo', 'at-f-company', 'at-f-rank', 'at-f-cat', 'at-f-scu', 'at-f-patch']) $(idf).onchange = () => { draw(); renderCard(); };
    $('at-f-alt').oninput = () => { $('at-f-alt-v').textContent = +$('at-f-alt').value >= 60 ? 'tutti' : $('at-f-alt').value; draw(); };
    $('at-f-alt').onchange = () => renderCard();
    $('at-f-alt-v').textContent = 'tutti';
    $('at-q').oninput = renderResults;
    $('at-q').onkeydown = (e) => { if (e.key === 'Enter') { const p = geo.search($('at-q').value, { limit: 1 })[0]; if (p) select(p.id); } };
    const tog = (b, cls) => { $(b).onclick = () => { $('at-grid').classList.toggle(cls); globalThis.dispatchEvent(new Event('resize')); }; };
    tog('at-hide-l', 'no-l'); tog('at-hide-r', 'no-r'); tog('at-hide-b', 'no-b');
    $('at-compact').onclick = () => { document.body.classList.toggle('at-compact'); if (document.body.classList.contains('at-compact')) activateBottom('plan'); };
    document.querySelectorAll('[data-atb]').forEach((b) => { b.onclick = () => activateBottom(b.dataset.atb); });
    if (!document.getElementById('at-places')) document.body.insertAdjacentHTML('beforeend', '<datalist id="at-places"></datalist>');
    db.onChange(() => { /* modifiche da LOGISTICS: ricarico al prossimo accesso */ stale = true; });
  }
  let stale = false;
  bindUi();
  await loadData();
  await reloadUser();
  fillFilters(); renderTree();
  draw({ refit: true });
  if (S.selected && geo.get(S.selected)) { renderCard(); }
  renderSel();
  return {
    async refresh() { if (stale) { stale = false; await reloadUser(); fillFilters(); renderTree(); draw(); if (S.selected) renderCard(); renderSel(); } else draw(); },
    select, geo: () => geo, index: () => index,
  };
}
