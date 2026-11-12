// PLANCIA (Command Dashboard): home di NAVCOM. Mostra solo stato reale: posizione inserita da te,
// nave scelta da te (dati di serie dai file di gioco), destinazione impostata da te, ultima rotta del
// PIANIFICATORE, stato delle fonti con le loro date. Nessuna telemetria, nessuna connessione simulata.
// Non calcola rotte: i pulsanti aprono i moduli esistenti (pianificatore, DI, atlante, database).
import { NOT_SET, DEFAULT_SHIP, miniProjector, nearestBody, nearestMarker, parsePosition, planSummary, shipSheet, straightDistance } from './home/model.js';
import { SERVICE_FILTERS } from './dest/model.js';
import { UNITS } from './core/points.js';

const SYS = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
const fmtDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtD = (m) => (m === null || m === undefined || !Number.isFinite(m) ? '—' : Math.abs(m) < 1e4 ? `${Math.round(m).toLocaleString('it-IT')} m` : Math.abs(m) < 1e8 ? `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km` : `${(m / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} Gm`);
const fmtKm = (m) => `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 })} km`;
const fmtT = (s) => (s === null || s === undefined ? '—' : s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const SRC_LABEL = { manuale: 'inserita a mano', '/showlocation': 'incollata da /showlocation', salvata: 'da un punto salvato' };
const QUICK = [
  ['plan', '🛰 Pianificatore', 'tab'], ['reverse', '⌖ Ricerca inversa QT', 'tab'], ['db', '🗂 Database punti', 'tab'], ['atlas', '🌌 Mappe (atlante)', 'tab'],
  ['city', '🏙 Città', 'list'], ['station', '🛰 Stazioni', 'list'], ['outpost', '🏕 Avamposti', 'list'], ['shops', '🛒 Negozi', 'list'],
  ['hospital', '✚ Ospedali', 'list'], ['refinery', '⚗ Raffinerie', 'list'], ['mining', '⛏ Mining', 'list'], ['saved', '💾 Rotte salvate', 'tab'],
  ['fav', '☆ Preferiti', 'fav'],
];

export async function initHome(app) {
  const { $, esc, state } = app;
  const S = { list: null, listSys: 'current', q: '', mapMode: 'local' };
  const ix = () => app.dest()?.index?.() ?? null;
  const geo = () => app.atlas()?.geo?.() ?? null;

  // ---------------------------------------------------------------- barra principale
  function renderBar() {
    const sys = app.system(); const pos = state.position; const d = state.destination;
    $('hm-bar').innerHTML = [
      ['NAVCOM', `v${esc(app.VERSION)}`],
      ['Sistema', esc(SYS[sys] ?? sys)],
      ['Nave', esc(state.ship ?? DEFAULT_SHIP)],
      ['Posizione', pos ? `${esc(SYS[pos.system] ?? pos.system)} · ${esc(SRC_LABEL[pos.source] ?? pos.source)} · ${fmtDT(pos.at)}` : `<span class="hm-nd">${NOT_SET}</span>`],
      ['Destinazione', d ? `${esc(d.name)} <span class="hint">(${esc(SYS[d.system] ?? d.system ?? '?')})</span>` : '<span class="hm-nd">nessuna</span>'],
      ['Ora locale', `<span id="hm-clock">${new Date().toLocaleTimeString('it-IT')}</span>`],
      ['Fonti dati', sourcesShort()],
    ].map(([l, v]) => `<div class="hm-cell"><span>${l}</span><b>${v}</b></div>`).join('');
  }
  function sourcesShort() {
    const m = app.store.locationMeta(app.system()); const x = ix(); const g = geo();
    const parts = [
      m ? `posizioni QT ${esc(m.gameVersion ?? '')} del ${fmtDT(m.fetchedAt ?? m.importedAt).slice(0, 10)}` : '<span class="hm-nd">posizioni QT non caricate</span>',
      g?.meta?.fetchedAt ? `mappe ${fmtDT(g.meta.fetchedAt).slice(0, 10)}` : '<span class="hm-nd">mappe n.d.</span>',
      x ? `destinazioni ${fmtDT(x.meta?.generatedAt).slice(0, 10)}${x.market ? '' : ' (senza prezzi)'}` : '<span class="hm-nd">destinazioni n.d.</span>',
    ];
    return parts.join(' · ');
  }
  setInterval(() => { const c = $('hm-clock'); if (c) c.textContent = new Date().toLocaleTimeString('it-IT'); }, 1000);

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
    $('hm-pos').innerHTML = pos ? `
      <div class="hm-kv"><span>Sistema</span><b>${esc(SYS[pos.system] ?? pos.system)}</b>
        <span>X · Y · Z</span><b class="mono">${['x', 'y', 'z'].map((k) => fmtKm(pos[k])).join(' · ')}</b>
        <span>Corpo più vicino</span><b>${c.body ? `${esc(c.body.name)} <span class="hint">${c.body.d < 0 ? `sotto la superficie secondo il raggio noto (${fmtD(-c.body.d)}): coordinate da ricontrollare` : `${fmtD(c.body.d)} ${c.body.fromSurface ? 'dalla superficie' : 'dal centro (raggio non noto)'}`}</span>` : '<span class="hm-nd">n.d.</span>'}</b>
        <span>Marker QT più vicino</span><b>${c.mk ? `${esc(c.mk.name)} <span class="hint">${fmtD(c.mk.d)}</span>` : `<span class="hm-nd">${c.markersLoaded ? 'nessuno' : `posizioni QT di ${esc(SYS[pos.system] ?? pos.system)} non caricate`}</span>`}</b>
        <span>Ultima lettura</span><b>${fmtDT(pos.at)}</b>
        <span>Origine</span><b>${esc(SRC_LABEL[pos.source] ?? pos.source)}${pos.label ? ` · ${esc(pos.label)}` : ''}</b></div>
      <p class="hint">La posizione è quella che hai inserito: NAVCOM non la aggiorna da solo. Distanze in linea retta.</p>`
      : `<p class="hm-big hm-nd">${NOT_SET}</p><p class="hint">Nel gioco digita <code>/showlocation</code> in chat, copia la riga "Coordinates: x:… y:… z:…" e premi INCOLLA. Oppure scrivi tre numeri X Y Z.</p>`;
    $('hm-pos-clear').hidden = !pos;
  }
  async function pastePosition() {
    let text = null;
    try { if (navigator.clipboard?.readText) text = await navigator.clipboard.readText(); } catch { text = null; }
    if (text === null) { $('hm-pos-manual').open = true; $('hm-pos-text').focus(); $('hm-pos-msg').innerHTML = '<span class="warn">Il browser non ha concesso la lettura degli appunti: incolla qui sotto con Ctrl+V.</span>'; return; }
    $('hm-pos-text').value = text; setPositionFromText(text);
  }
  async function setPositionFromText(text) {
    const r = parsePosition(text, { unit: $('hm-pos-unit').value });
    if (r.error) { $('hm-pos-msg').innerHTML = `<span class="err">${esc(r.error)}</span>`; return; }
    const sys = $('hm-pos-sys').value || app.system();
    await state.setPosition({ system: sys, x: r.x, y: r.y, z: r.z, source: r.source });
    $('hm-pos-msg').innerHTML = `<span class="ok">Posizione impostata (${esc(SYS[sys])}, ${esc(SRC_LABEL[r.source])}).</span> <span class="hint">Il sistema non è nel testo di /showlocation: controlla che sia quello giusto.</span>`;
  }

  // ---------------------------------------------------------------- mini mappa
  function renderMap() {
    const cv = $('hm-map'); const ctx = cv.getContext('2d'); if (!ctx) return;
    const w = cv.clientWidth || 360, h = cv.clientHeight || 260; const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04080d'; ctx.fillRect(0, 0, w, h);
    const sys = state.position?.system ?? state.destination?.system ?? app.system();
    const g = geo();
    const bodies = (g?.places ?? []).filter((p) => p.system === sys && p.kind === 'planet' && p.pos);
    const pos = state.position?.system === sys ? state.position : null;
    const dst = state.destination?.system === sys && state.destination.pos ? state.destination.pos : null;
    const plan = state.lastPlan?.path?.filter((s) => s.system === sys) ?? [];
    // DINTORNI: centrata sulla posizione (o destinazione), raggio = distanza fino alla destinazione
    const local = S.mapMode === 'local' && (pos || dst);
    const c0 = local ? (pos ?? dst) : { x: 0, y: 0, z: 0 };
    const rel = (p) => (Array.isArray(p) ? { x: p[0] - c0.x, y: p[1] - c0.y } : { x: p.x - c0.x, y: p.y - c0.y });
    let span = 0;
    if (local) { span = pos && dst ? Math.hypot(dst.x - pos.x, dst.y - pos.y) : 0; span = Math.max(span * 1.25, 2e6); }
    const near = local ? (g?.places ?? []).filter((p) => p.system === sys && p.pos && !p.hidden && ['planet', 'moon', 'station', 'city', 'gateway'].includes(p.kind) && Math.hypot(p.pos.x - c0.x, p.pos.y - c0.y) <= span).slice(0, 60) : bodies;
    const pts = local ? [{ x: span, y: 0 }, { x: -span, y: 0 }, { x: 0, y: span }, { x: 0, y: -span }] : [{ x: 0, y: 0 }, ...bodies.map((b) => b.pos), pos, dst].filter(Boolean);
    const P = miniProjector(pts, w, h);
    const at = (p) => P.at(rel(p));
    ctx.strokeStyle = 'rgba(80,140,170,.18)';
    if (!local) {
      for (const b of bodies) { const r = Math.hypot(b.pos.x, b.pos.y) * P.k; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      for (const b of near) if (b.radius && (b.kind === 'planet' || b.kind === 'moon')) { const q = at(b.pos); ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(2, b.radius * P.k), 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.font = '10px system-ui, sans-serif';
    for (const b of near.filter((x) => x.id !== state.destination?.id)) { const q = at(b.pos); ctx.fillStyle = '#6fb6d6'; ctx.beginPath(); ctx.arc(q.x, q.y, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(180,210,225,.75)'; ctx.fillText(b.name, q.x + 4, q.y - 4); }
    if (plan.length) {
      ctx.strokeStyle = '#ffb347'; ctx.setLineDash([4, 3]); ctx.beginPath(); let first = true;
      for (const s of plan) for (const p of [s.from?.pos, s.drop ?? s.to?.pos]) { if (!p) continue; const q = at(p); if (first) { ctx.moveTo(q.x, q.y); first = false; } else ctx.lineTo(q.x, q.y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const mark = (p, color, label) => { const q = at(p); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; ctx.fillStyle = color; ctx.fillText(label, q.x + 8, q.y + 12); };
    if (pos) mark(pos, '#4dff9a', 'TU');
    if (dst) mark(dst, '#ff6b6b', state.destination.name);
    $('hm-map-note').textContent = `${SYS[sys] ?? sys}: vista dall'alto (piano XY del sistema), scala lineare reale ${local ? `· dintorni, raggio ${fmtD(span)} ` : ''}${bodies.length ? '' : '· pianeti non caricati '}· quota Z non rappresentata · rotta = ultima calcolata dal pianificatore${plan.length ? '' : ' (nessuna in questo sistema)'}.`;
  }

  // ---------------------------------------------------------------- nave
  function findShip(name) {
    const list = ix()?.ships ?? []; const q = String(name ?? '').trim().toLowerCase();
    return list.find((s) => s.name.toLowerCase() === q) ?? (q ? list.find((s) => s.name.toLowerCase().includes(q)) : null) ?? null;
  }
  function renderShip() {
    const name = state.ship ?? DEFAULT_SHIP; const ship = findShip(name);
    $('hm-ship-in').value = name;
    const sh = shipSheet(ship, state.shipNote(name));
    $('hm-ship').innerHTML = sh ? `<div class="hm-kv">${sh.rows.map((r) => `<span>${esc(r.label)}</span><b>${r.value === null ? '<span class="hm-nd">non nei dati</span>' : esc(r.value)}</b>`).join('')}</div>
      <p class="hint">${esc(sh.source)}</p>
      <p class="hint">Stato carburante, scudi e danni non vengono mostrati: NAVCOM non legge la telemetria del gioco.</p>`
      : ix() ? `<p class="warn">"${esc(name)}" non trovata nei file di gioco caricati.</p>` : '<p class="hint">Dati delle navi in caricamento…</p>';
    $('hm-ship-note').value = state.shipNote(name);
  }

  // ---------------------------------------------------------------- rotta e destinazione
  function renderRoute() {
    const d = state.destination; const p = planSummary(state.lastPlan); const pos = state.position;
    const dist = d ? straightDistance(pos, d) : null;
    const planMatches = p && d && p.target === d.name;
    $('hm-route').innerHTML = `
      ${d ? `<div class="hm-kv"><span>Destinazione</span><b>${esc(d.name)}</b><span>Sistema</span><b>${esc(SYS[d.system] ?? d.system ?? '—')}</b>
        <span>Tipo</span><b>${esc(d.kind ?? '—')}</b>
        <span>Distanza</span><b>${dist.d !== null ? `${fmtD(dist.d)} <span class="hint">${esc(dist.note)}</span>` : `<span class="hm-nd">${esc(dist.note)}</span>`}</b>
        ${state.lastVisit(d.id) ? `<span>Ultima visita</span><b>${fmtDT(state.lastVisit(d.id).at)} <span class="hint">(segnata da te)</span></b>` : ''}</div>`
      : '<p class="hm-nd">Nessuna destinazione impostata.</p><p class="hint">Impostala dalla ricerca qui sopra o con 🎯 nella scheda di DESTINATION INTELLIGENCE.</p>'}
      <h3>Ultima rotta calcolata ${p ? `<span class="hint">${fmtDT(p.at)}${p.gameVersion ? ` · dati ${esc(p.gameVersion)}` : ''}</span>` : ''}</h3>
      ${p ? `${d && !planMatches ? `<p class="warn">Questa rotta porta a "${esc(p.target)}", non alla destinazione impostata.</p>` : ''}
        <div class="hm-kv"><span>Verso</span><b>${esc(p.target)} <span class="hint">${esc(SYS[p.system] ?? p.system ?? '')}</span></b>
        <span>Partenza</span><b>${esc(p.departure ?? '—')}</b>
        <span>Percorso QT</span><b>${p.path.length ? p.path.map(esc).join(' → ') : '—'}</b>
        <span>Tratte QT · salti · uscite</span><b>${p.qtLegs} · ${p.jumps} · ${p.drops}</b>
        <span>Residuo convenzionale</span><b>${fmtD(p.residual)}${p.residualWorst !== null && p.residualWorst !== p.residual ? ` <span class="hint">(peggiore ${fmtD(p.residualWorst)})</span>` : ''}</b>
        <span>Tempo stimato</span><b>${fmtT(p.time)}</b>
        <span>Stato di verifica</span><b>${esc(p.status ?? '—')}${p.evidence ? ` <span class="hint">${esc(p.evidence)}</span>` : ''}</b></div>`
      : '<p class="hint">Nessuna rotta calcolata in questa sessione o salvata dalla plancia. Il riepilogo arriva dal PIANIFICATORE: qui non si ricalcola nulla.</p>'}`;
    $('hm-go-plan').disabled = !(d?.pos);
    $('hm-go-plan').title = d?.pos ? (pos?.system === d.system ? 'Apre il pianificatore con la destinazione e la tua posizione come partenza' : 'Apre il pianificatore con la destinazione') : 'La destinazione non ha XYZ di sistema: nessun calcolo (NAVCOM non genera coordinate)';
    $('hm-go-info').disabled = !d; $('hm-go-map').disabled = !d || !(d.id && !d.id.startsWith('uex:'));
    $('hm-dest-clear').hidden = !d;
  }
  function planTo() {
    const d = state.destination; if (!d?.pos) return;
    const pos = state.position;
    app.planTo({ name: d.name, system: d.system, x: d.pos.x, y: d.pos.y, z: d.pos.z, unit: 'm', start: pos && pos.system === d.system ? { system: pos.system, x: pos.x, y: pos.y, z: pos.z } : null });
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
    const r = x.universal(q, { system: sys, limit: 6 });
    const ms = Math.round(performance.now() - t0);
    const rowsHtml = (g) => g.rows.map((row) => {
      switch (g.type) {
        case 'place': case 'personal': return `<div class="hm-res">${kindBadge(g.type === 'personal' ? 'Punto personale' : row.kindLabel)}<button class="link" data-act="open" data-id="${esc(row.id)}">${esc(row.name)}</button> <span class="hint">${esc(row.systemLabel)}${row.body ? ` › ${esc(row.body)}` : ''}${row.hasXyz ? '' : ' · senza XYZ'}${row.hidden ? ' · nascosto sulla starmap' : ''}</span>
          <span class="hm-acts">${row.hasXyz ? `<button class="small" data-act="dest" data-id="${esc(row.id)}" title="Imposta come destinazione">🎯</button><button class="small" data-act="plan" data-id="${esc(row.id)}" title="Apri nel pianificatore">🛰</button>` : ''}${row.origin !== 'uex' && !row.id.startsWith('pt:') ? `<button class="small" data-act="map" data-id="${esc(row.id)}" title="Mostra sulla mappa">🌌</button>` : ''}</span></div>`;
        case 'service': return `<div class="hm-res">${kindBadge('Servizio')}<button class="link" data-act="list" data-key="${esc(row.key)}">${esc(row.name)}</button> <span class="hint">${row.count} luoghi documentati${sys ? ` in ${esc(SYS[sys])}` : ''}</span></div>`;
        case 'shop': return `<div class="hm-res">${kindBadge(row.typeLabel)}<button class="link" data-act="shop" data-id="${esc(row.id)}">${esc(row.name)}</button> <span class="hint">${row.area ? `${esc(row.area)} · ` : ''}${row.place ? esc(row.place.name) : 'luogo non abbinato'} · ${esc(row.systemLabel)}</span></div>`;
        case 'item': return `<div class="hm-res">${kindBadge(`Articolo · ${row.cat}`)}<button class="link" data-act="item" data-q="${esc(row.name)}">${esc(row.name)}</button> <span class="hint">${row.shops} negozi segnalati in ${row.places} luoghi${row.minBuy ? ` · da ${Math.round(row.minBuy).toLocaleString('it-IT')} aUEC` : ''}</span></div>`;
        case 'commodity': return `<div class="hm-res">${kindBadge('Merce')}<button class="link" data-act="sell" data-q="${esc(row.name)}">${esc(row.name)}</button>${row.illegal ? ' <span class="di-pill bad">illegale</span>' : ''} <span class="hint">dove venderla</span></div>`;
        case 'mineral': return `<div class="hm-res">${kindBadge('Minerale / risorsa')}<b>${esc(row.name)}</b> <span class="hint">${esc(row.kinds.join(', '))}</span><div class="hm-sub">${row.places.slice(0, 8).map((id) => { const p = x.describe(id); return p ? `<button class="small" data-act="open" data-id="${esc(id)}">${esc(p.name)}</button>` : ''; }).join(' ')}${row.places.length > 8 ? ` <span class="hint">… altri ${row.places.length - 8}</span>` : ''}</div></div>`;
        default: return '';
      }
    }).join('');
    box.innerHTML = r.groups.length ? `${r.groups.map((g) => `<div class="hm-group"><h4>${esc(g.label)}</h4>${rowsHtml(g)}</div>`).join('')}<p class="hint">${ms} ms · i prezzi sono segnalazioni della community con data, non disponibilità in tempo reale.</p>`
      : `<p class="hint">Nessun risultato per "${esc(q)}". Cerca città, stazioni, pianeti, avamposti, negozi, servizi, articoli, minerali o tuoi punti.</p>`;
    bindActions(box);
  }
  function destFromId(id) {
    const x = ix(); if (!x) return null; const d = x.describe(id); if (!d) return null;
    let pos = null;
    if (id.startsWith('pt:')) pos = x.personal.get(id)?.pos ?? null;
    else if (!id.startsWith('uex:')) pos = x.geo.get(id)?.pos ?? null;
    return { id, name: d.name, system: d.system, pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null, kind: d.kindLabel };
  }
  function bindActions(box) {
    box.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset); });
  }
  async function act({ act: a, id, key, q }) {
    const dest = app.dest();
    if (a === 'open') { await state.addRecent(destFromId(id) ?? { id, name: id }); return dest?.open(id); }
    if (a === 'dest') { const d = destFromId(id); if (d) { await state.setDestination(d); await state.addRecent(d); } return; }
    if (a === 'plan') { const d = destFromId(id); if (d?.pos) { const pos = state.position; app.planTo({ name: d.name, system: d.system, x: d.pos.x, y: d.pos.y, z: d.pos.z, unit: 'm', start: pos && pos.system === d.system ? pos : null }); } return; }
    if (a === 'map') return app.openAtlas(id);
    if (a === 'list') { S.list = key; renderList(); $('hm-list-box').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (a === 'shop') return dest?.openShop(id);
    if (a === 'item') return dest?.runItem(q);
    if (a === 'sell') return dest?.runSell(q);
    if (a === 'route') { const r = app.store.data.savedRoutes.find((x) => x.id === id); if (r) { app.showTab('saved'); } return; }
  }

  // ---------------------------------------------------------------- link rapidi ed elenchi
  function renderQuick() {
    $('hm-quick').innerHTML = QUICK.map(([k, l, t]) => `<button class="hm-q ${S.list === k ? 'active' : ''}" data-k="${k}" data-t="${t}">${l}</button>`).join('');
    $('hm-quick').querySelectorAll('.hm-q').forEach((b) => { b.onclick = () => {
      if (b.dataset.t === 'tab') return app.showTab(b.dataset.k);
      S.list = S.list === b.dataset.k ? null : b.dataset.k; renderQuick(); renderList();
    }; });
  }
  function renderList() {
    const box = $('hm-list-box'); const x = ix();
    if (!S.list) { box.innerHTML = ''; return; }
    if (S.list === 'fav') {
      box.innerHTML = `<h3>☆ Preferiti (${state.fav.length})</h3>${state.fav.length ? `<div class="hm-list">${state.fav.map((f) => `<div class="hm-res">${kindBadge(f.kind ?? 'luogo')}<button class="link" data-act="open" data-id="${esc(f.id)}">${esc(f.name)}</button> <span class="hint">${esc(SYS[f.system] ?? f.system ?? '')}</span></div>`).join('')}</div>` : '<p class="hint">Nessun preferito: usa ☆ nella scheda di una destinazione o di un tuo punto.</p>'}`;
      return bindActions(box);
    }
    if (!x) { box.innerHTML = '<p class="hint">Archivio delle destinazioni in caricamento…</p>'; return; }
    const sys = S.listSys === 'current' ? app.system() : S.listSys || null;
    const rows = x.listBy(S.list, { system: sys });
    box.innerHTML = `<div class="row wrap"><h3>${esc(SERVICE_FILTERS[S.list].label)} · ${rows.length}</h3>
      <select id="hm-list-sys"><option value="current" ${S.listSys === 'current' ? 'selected' : ''}>sistema attuale</option><option value="" ${S.listSys === '' ? 'selected' : ''}>tutti i sistemi</option>${Object.entries(SYS).map(([k, v]) => `<option value="${k}" ${S.listSys === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <p class="hint">Solo luoghi con il dato documentato nelle fonti (file di gioco o segnalazioni UEX). Un luogo assente può avere il servizio ma non risultare nei dati.</p>
      <div class="hm-list">${rows.map((r) => `<div class="hm-res"><button class="link" data-act="open" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${esc(r.systemLabel)}${r.body ? ` › ${esc(r.body)}` : ''} · ${esc(r.kindLabel)}${r.why ? ` · ${esc(r.why)}` : ''}</span>${r.hasXyz ? `<span class="hm-acts"><button class="small" data-act="dest" data-id="${esc(r.id)}" title="Imposta come destinazione">🎯</button></span>` : ''}</div>`).join('') || '<p class="hint">Nessun luogo documentato.</p>'}</div>`;
    $('hm-list-sys').onchange = () => { S.listSys = $('hm-list-sys').value; renderList(); };
    bindActions(box);
  }

  // ---------------------------------------------------------------- attivita' recente
  async function renderActivity() {
    const db = app.pointsDb();
    const pts = db ? (await db.all().catch(() => [])) : [];
    const lastPts = pts.filter((p) => p.updatedAt || p.createdAt).sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))).slice(0, 5);
    const routes = (app.store.data.savedRoutes ?? []).slice(0, 5);
    const favPts = state.fav.filter((f) => f.id.startsWith('pt:'));
    const li = (html) => `<li>${html}</li>`;
    const sec = (title, items, empty) => `<div><h4>${title}</h4>${items.length ? `<ul>${items.join('')}</ul>` : `<p class="hint">${empty}</p>`}</div>`;
    $('hm-activity').innerHTML = `<div class="hm-act-grid">
      ${sec('Destinazioni recenti', state.recent.slice(0, 6).map((r) => li(`<button class="link" data-act="open" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${fmtDT(r.at)}</span>`)), 'nessuna')}
      ${sec('Rotte salvate', routes.map((r) => li(`<button class="link" data-act="route" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${esc(SYS[r.system] ?? r.system)} · ${fmtDT(r.createdAt)}</span>`)), 'nessuna')}
      ${sec('Punti personali modificati di recente', lastPts.map((p) => li(`<button class="link" data-act="open" data-id="pt:${esc(p.id)}">${esc(p.name)}</button> <span class="hint">${esc(SYS[p.system] ?? p.system ?? '')} · ${esc(p.status ?? '')}</span>`)), db ? 'nessuno' : 'DATABASE PUNTI non disponibile')}
      ${sec('Punti personali preferiti', favPts.map((f) => li(`<button class="link" data-act="open" data-id="${esc(f.id)}">${esc(f.name)}</button>`)), 'nessuno')}
      ${sec('Visite segnate da te', state.visits.slice(0, 6).map((v) => li(`<button class="link" data-act="open" data-id="${esc(v.id)}">${esc(v.name)}</button> <span class="hint">${fmtDT(v.at)}</span>`)), 'nessuna: le visite si registrano solo quando le confermi')}
    </div>`;
    bindActions($('hm-activity'));
  }

  // ---------------------------------------------------------------- backup dello stato della plancia
  function exportState() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'navcom-plancia', version: app.VERSION, exportedAt: new Date().toISOString(), ...state.exportJson() }, null, 1)], { type: 'application/json' }));
    a.download = `navcom-plancia-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------------------------------------------------------- avvio
  function renderAll() { renderBar(); renderPosition(); renderShip(); renderRoute(); renderMap(); renderQuick(); renderList(); renderActivity(); }
  $('hm-pos-sys').innerHTML = Object.entries(SYS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('hm-pos-sys').value = app.system();
  $('hm-paste').onclick = pastePosition;
  $('hm-pos-set').onclick = () => setPositionFromText($('hm-pos-text').value);
  $('hm-pos-clear').onclick = async () => { if (confirm('Cancellare la posizione impostata? (I tuoi punti salvati non vengono toccati.)')) await state.setPosition(null); };
  $('hm-pos-save').onclick = () => { const p = state.position; if (!p) return; app.openInDatabase?.({ name: `Posizione ${fmtDT(p.at)}`, system: p.system, x: p.x, y: p.y, z: p.z, unit: 'm', notes: `da ${SRC_LABEL[p.source] ?? p.source}` }); };
  $('hm-ship-in').onchange = async () => { await state.setShip(findShip($('hm-ship-in').value)?.name ?? $('hm-ship-in').value.trim()); };
  $('hm-ship-note-save').onclick = async () => { await state.setShipNote(state.ship, $('hm-ship-note').value.trim()); $('hm-ship-note-msg').textContent = 'salvata'; };
  $('hm-go-plan').onclick = planTo;
  $('hm-go-info').onclick = () => { const d = state.destination; if (!d) return; d.id ? app.dest()?.open(d.id) : app.dest()?.openPoint({ ...d.pos, name: d.name, system: d.system, unit: 'm' }); };
  $('hm-go-map').onclick = () => { const d = state.destination; if (d?.id) app.openAtlas(d.id); };
  $('hm-dest-clear').onclick = () => state.setDestination(null);
  $('hm-map-mode').onchange = () => { S.mapMode = $('hm-map-mode').value; renderMap(); };
  $('hm-map').onclick = () => { const d = state.destination; if (d?.id && !d.id.startsWith('uex:')) app.openAtlas(d.id); else app.showTab('atlas'); };
  $('hm-q').oninput = renderSearch; $('hm-q-sys').onchange = renderSearch;
  $('hm-q').onkeydown = (e) => { if (e.key === 'Escape') { $('hm-q').value = ''; renderSearch(); } if (e.key === 'Enter') $('hm-results').querySelector('[data-act]')?.click(); };
  $('hm-export').onclick = exportState;
  $('hm-persist').innerHTML = state.persistent ? 'Stato della plancia salvato nell\'archivio del browser (stesso archivio del DATABASE PUNTI, chiavi separate).' : '<span class="warn">Archivio del browser non disponibile: posizione, nave e destinazione restano solo per questa sessione.</span>';
  state.onChange((what) => { renderBar(); if (what === 'position') { renderPosition(); renderRoute(); renderMap(); } if (what === 'ship') renderShip(); if (what === 'destination' || what === 'plan' || what === 'visits') { renderRoute(); renderMap(); renderActivity(); } if (['recent', 'fav'].includes(what)) { renderActivity(); if (S.list === 'fav') renderList(); } });
  window.addEventListener('resize', () => { if ($('tab-home').classList.contains('active')) renderMap(); });
  renderAll();

  return {
    /** chiamato quando cambiano i dati caricati (posizioni QT, mappe, destinazioni) o il sistema */
    refresh() { renderAll(); if ($('hm-q').value.trim()) renderSearch(); },
    show() { renderBar(); renderMap(); },
  };
}
