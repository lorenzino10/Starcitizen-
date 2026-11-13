// MISSION CONTROL: Contract Manager di NAVCOM (logica del mobiGlas, identita' NAVCOM).
// Sinistra: posizione, profilo, filtri, categorie. Centro: contratti. Destra: dettaglio. Sotto: selezione,
// RAGGRUPPA MISSIONI, ottimizzazione e itinerario.
// Nessuna connessione al gioco: le offerte reali le registri tu; "ACCETTATA" aggiorna solo NAVCOM.
import {
  MC_CATS, GEO, AVAIL, TABS, GROUPS, MODES, SCOPES, regionOf, controlList, geoClass, mcCategory, availability, accessCheck, ladders,
  groupSelection, planSelection, routeSteps, offerText, shipFit, distanceFrom, missionKind, relatedTo,
} from './missions/control.js';
import { McStore, newRecord, byCatalog } from './missions/records.js';
import { shipCaps, jumpLinks, CATEGORY_LABEL } from './missions/finder.js';
import { provenance } from './missions/load.js';
import { draftMovements, observedInput } from './missions/observe.js';
import { normalizeContract } from './logistics/model.js';
import { DEFAULT_SHIP } from './home/model.js';
import { newId, nowIso } from './core/points.js';

const SYS = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
const PAGE = 80;
const fmtA = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n.d.' : `${Math.round(n).toLocaleString('it-IT')} aUEC`);
const fmtD = (m) => (m === null || m === undefined || !Number.isFinite(m) ? '—' : Math.abs(m) < 1e4 ? `${Math.round(m).toLocaleString('it-IT')} m` : Math.abs(m) < 1e8 ? `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km` : `${(m / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} Gm`);
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);
const TITLE_BADGE = {
  verificato: ['', 'titolo dalle fonti'],
  dinamico: ['mc-dyn', 'TITOLO DINAMICO: le parti fra [ ] le riempie il gioco'],
  risolto: ['mc-dyn', 'Titolo mobiGlas non verificato: parametro sostituito con l\'unico valore dei file'],
  assente: ['mc-unv', 'Titolo mobiGlas non verificato: nessun titolo nelle fonti'],
};

export async function initControl(app) {
  const { $, esc, state } = app;
  const A = () => app.atlas() ?? null;
  const geo = () => A()?.geo?.() ?? null;
  const L = () => app.logistics?.() ?? null;
  const pref = state.bridge.mc ?? {};
  const S = {
    tab: pref.tab ?? 'offerte', scope: pref.scope ?? 'corpo', relation: pref.relation ?? 'da', legal: pref.legal ?? 'tutte', sort: pref.sort ?? 'ricompensa',
    cats: new Set(pref.cats ?? []), text: '', showAll: !!pref.showAll, collapse: pref.collapse ?? true, fitOnly: !!pref.fitOnly, hideBlocked: !!pref.hideBlocked,
    minReward: pref.minReward ?? '', from: '', to: '', sel: pref.sel ?? [], open: null, shown: PAGE, mode: pref.mode ?? 'guadagno', out: null, poolOpen: null,
  };
  const D = { views: [], res: null, ships: [], L: new Map(), byId: new Map() };
  const store = new McStore(L()?.db?.() ?? null);
  await store.load();
  const save = () => state.setBridge({ mc: { tab: S.tab, scope: S.scope, relation: S.relation, legal: S.legal, sort: S.sort, cats: [...S.cats], showAll: S.showAll, collapse: S.collapse, fitOnly: S.fitOnly, hideBlocked: S.hideBlocked, minReward: S.minReward, sel: S.sel, mode: S.mode } });
  const links = () => (geo() ? jumpLinks(geo()) : []);
  const ship = () => shipCaps(state.ship ?? DEFAULT_SHIP, D.ships);
  const userViews = () => (A()?.views?.() ?? []).filter((v) => v.origin === 'utente');
  const viewOf = (id) => D.byId.get(id) ?? userViews().find((v) => v.id === id) ?? null;
  const recordById = (id) => store.records.find((r) => r.id === id) ?? null;
  /** vista da pianificare per un elemento selezionato: il contratto registrato (luoghi reali) prevale sul modello */
  const planView = (key) => {
    if (key.startsWith('rec:')) { const r = recordById(key.slice(4)); if (!r) return null; const u = r.contractId ? userViews().find((v) => v.contractId === r.contractId) : null; return u ?? viewOf(r.ref.id); }
    return viewOf(key);
  };

  // ---------------------------------------------------------------- dati
  async function load() {
    const db = await app.missionDb?.();
    D.res = db?.res ?? null; D.views = db?.views ?? []; D.ships = db?.ships ?? [];
    D.byId = new Map(D.views.map((v) => [v.id, v])); D.L = ladders(D.views);
    renderAll();
  }

  // ---------------------------------------------------------------- posizione (quella della PLANCIA)
  function nearestPlace(pos) {
    const g = geo(); if (!g || !pos || !Number.isFinite(pos.x)) return null;
    let best = null;
    for (const p of g.inSystem(pos.system)) {
      if (!p.pos || !['city', 'station', 'outpost', 'poi', 'planet', 'moon', 'gateway'].includes(p.kind)) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z);
      if (!best || d < best.d) best = { place: p, d };
    }
    return best;
  }
  /** Luogo di analisi: quello scelto da "missioni da/verso questa località" (atlante) o la posizione della PLANCIA. */
  function region() {
    const g = geo(); if (!g) return null;
    if (S.anchor && g.get(S.anchor)) return regionOf(g, S.anchor);
    const id = state.position?.place?.id; return id && g.get(id) ? regionOf(g, id) : null;
  }
  /** Partenza per le rotte: sempre la posizione reale della PLANCIA (luogo o XYZ), mai il luogo di analisi. */
  function posFrom() {
    const g = geo(); const pos = state.position; if (!g || !pos) return null;
    if (pos.place?.id && g.get(pos.place.id)) return g.get(pos.place.id);
    return Number.isFinite(pos.x) ? { system: pos.system, pos: { x: pos.x, y: pos.y, z: pos.z }, name: 'posizione attuale' } : null;
  }
  async function setPlace(id) {
    const g = geo(); const p = g?.get(id); if (!p) return;
    await state.setPosition({ system: p.system, x: p.pos?.x ?? null, y: p.pos?.y ?? null, z: p.pos?.z ?? null, source: 'luogo', place: { id: p.id, name: p.name } });
  }
  function renderPos() {
    const g = geo(); const pos = state.position; const R = region();
    const near = !R && pos ? nearestPlace(pos) : null;
    if (!g) { $('mc-pos').innerHTML = '<p class="hint">Atlante in caricamento…</p>'; return; }
    $('mc-pos').innerHTML = `${S.anchor && R ? `<p class="warn">Analisi su <b>${esc(R.place.name)}</b>: non è la tua posizione.</p><button class="small" id="mc-unanchor">torna alla posizione della PLANCIA</button>` : ''}
      ${R ? `<p class="mc-here"><b>${esc(R.place.name)}</b><br><span class="hint">${esc(g.pathLabel(R.place.id))}</span></p>
        <p class="hint">Regione: <b>${esc((R.body ?? R.place).name)}</b> · sistema <b>${esc(SYS[R.system] ?? R.system)}</b></p>`
      : pos ? `<p class="warn">Posizione XYZ senza luogo (${esc(SYS[pos.system] ?? pos.system)}).</p>${near ? `<p class="hint">Luogo più vicino nei dati: <b>${esc(near.place.name)}</b> a ${fmtD(near.d)}.</p><button class="small" id="mc-use-near">usa ${esc(near.place.name)} come località</button>` : ''}`
      : '<p class="hm-nd">POSIZIONE NON IMPOSTATA</p>'}
      <div class="row"><input id="mc-pos-q" list="mc-places" placeholder="Sistema, pianeta, luna, città, stazione, avamposto, punto personale…" autocomplete="off"></div>
      <datalist id="mc-places"></datalist>
      <label class="mc-lbl">Raggio di ricerca <select id="mc-scope">${Object.entries(SCOPES).map(([k, s]) => `<option value="${k}" ${S.scope === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <label class="mc-lbl">Relazione <select id="mc-rel"><option value="da" ${S.relation === 'da' ? 'selected' : ''}>missioni DA qui (offerta, ritiro, obiettivo)</option><option value="verso" ${S.relation === 'verso' ? 'selected' : ''}>missioni VERSO qui (consegna, obiettivo)</option><option value="tutte" ${S.relation === 'tutte' ? 'selected' : ''}>da o verso qui</option></select></label>
      <p class="hint">La posizione è quella della PLANCIA. Senza luogo l'elenco mostra tutto il catalogo.</p>`;
    const q = $('mc-pos-q');
    q.oninput = () => { const list = g ? g.search(q.value, { limit: 25 }) : []; $('mc-places').innerHTML = list.map((p) => `<option value="${esc(p.name)}">${esc(g.pathLabel(p.id))}</option>`).join(''); };
    q.onchange = async () => { const p = g?.resolveName(q.value.trim()) ?? g?.search(q.value, { limit: 1 })[0]; if (p) { S.anchor = null; await setPlace(p.id); } };
    $('mc-use-near') && ($('mc-use-near').onclick = () => setPlace(near.place.id));
    $('mc-unanchor') && ($('mc-unanchor').onclick = () => { S.anchor = null; renderPos(); renderList(); });
    $('mc-scope').onchange = () => { S.scope = $('mc-scope').value; S.shown = PAGE; save(); renderList(); };
    $('mc-rel').onchange = () => { S.relation = $('mc-rel').value; S.shown = PAGE; save(); renderList(); };
  }

  // ---------------------------------------------------------------- profilo
  function renderProfile() {
    const p = store.profile;
    const n = p.standings.length;
    $('mc-prof').innerHTML = `<p>${n ? `${n} gradi registrati` : '<span class="hm-nd">nessun grado registrato</span>'} · ${p.completed.length} prerequisiti · CrimeStat ${p.crime ?? '<span class="hm-nd">n.d.</span>'}</p>
      <div class="row wrap"><button class="small" id="mc-prof-edit">✎ PLAYER PROFILE</button>
      <label class="check"><input type="checkbox" id="mc-all" ${S.showAll ? 'checked' : ''}>mostra tutte le missioni catalogate</label></div>
      <p class="hint">Un requisito non registrato non viene presunto: la missione resta "da verificare".</p>`;
    $('mc-prof-edit').onclick = profileDialog;
    $('mc-all').onchange = () => { S.showAll = $('mc-all').checked; S.shown = PAGE; save(); renderList(); };
  }
  function profileDialog() {
    const dlg = $('mc-dlg'); const p = structuredClone(store.profile);
    const factions = [...new Set([...D.L.keys()].map((k) => k.split('|')[0]))].sort((a, b) => a.localeCompare(b));
    const scopesOf = (f) => [...new Set([...D.L.keys()].filter((k) => k.startsWith(`${f}|`)).map((k) => k.split('|')[1]).filter((s) => s !== '*'))];
    const namesOf = (f, s) => (D.L.get(`${f}|${s || '*'}`) ?? D.L.get(`${f}|*`) ?? []).map((x) => x.name);
    const certs = D.views.filter((v) => /Certification/i.test(v.debug ?? '') && v.titleStatus === 'verificato');
    const draw = () => {
      dlg.innerHTML = `<form method="dialog" class="mc-prof"><h3>PLAYER PROFILE</h3>
        <p class="hint">Dati inseriti da te, salvati in questo browser. Le scale dei gradi vengono dal catalogo (gradi minimi e massimi dei modelli). Nessun grado è presunto.</p>
        <h4>Fazioni e gradi (anche hauling e bounty)</h4>
        ${p.standings.map((s, i) => `<div class="row wrap mc-st"><select data-f="${i}"><option value="">fazione…</option>${factions.map((f) => `<option ${f === s.faction ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
          <select data-s="${i}"><option value="">tutte le scale</option>${scopesOf(s.faction).map((x) => `<option ${x === s.scope ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select data-n="${i}"><option value="">grado…</option>${namesOf(s.faction, s.scope).map((x) => `<option ${x === s.standing ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <input data-r="${i}" inputmode="numeric" placeholder="reputazione (facoltativa)" value="${s.rep ?? ''}" style="width:150px"><button type="button" class="small" data-x="${i}">✕</button></div>`).join('')}
        <button type="button" class="small" id="pf-add">＋ grado</button>
        <h4>Certificazioni e missioni prerequisito completate</h4>
        <div class="mc-certs">${certs.map((v) => `<label class="check"><input type="checkbox" data-c="${esc(v.uuid)}" data-t="${esc(v.title)}" ${p.completed.some((c) => c.uuid === v.uuid) ? 'checked' : ''}>${esc(v.title)}</label>`).join('') || '<span class="hint">nessuna certificazione nel catalogo</span>'}</div>
        <label>Altre missioni completate (titolo esatto, una per riga)<textarea id="pf-done" rows="3">${esc(p.completed.filter((c) => !certs.some((v) => v.uuid === c.uuid)).map((c) => c.title ?? c.uuid).join('\n'))}</textarea></label>
        <div class="row wrap"><label>CrimeStat attuale <select id="pf-crime"><option value="">non registrato</option>${[0, 1, 2, 3, 4, 5].map((n) => `<option ${p.crime === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <label>Note<textarea id="pf-notes" rows="2">${esc(p.notes)}</textarea></label>
        <div class="row wrap"><button type="button" id="pf-save" class="primary" style="width:auto">SALVA PROFILO</button><button type="button" id="pf-close">Annulla</button></div></form>`;
      const read = () => {
        dlg.querySelectorAll('[data-f]').forEach((el) => { p.standings[+el.dataset.f].faction = el.value; });
        dlg.querySelectorAll('[data-s]').forEach((el) => { p.standings[+el.dataset.s].scope = el.value || null; });
        dlg.querySelectorAll('[data-n]').forEach((el) => { p.standings[+el.dataset.n].standing = el.value || null; });
        dlg.querySelectorAll('[data-r]').forEach((el) => { p.standings[+el.dataset.r].rep = num(el.value); });
      };
      dlg.querySelectorAll('[data-f],[data-s]').forEach((el) => { el.onchange = () => { read(); draw(); }; });
      dlg.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { read(); p.standings.splice(+b.dataset.x, 1); draw(); }; });
      $('pf-add').onclick = () => { read(); p.standings.push({ faction: '', scope: null, standing: null, rep: null }); draw(); };
      $('pf-close').onclick = () => dlg.close?.();
      $('pf-save').onclick = async () => {
        read();
        const ticked = [...dlg.querySelectorAll('[data-c]')].filter((c) => c.checked).map((c) => ({ uuid: c.dataset.c, title: c.dataset.t }));
        const typed = $('pf-done').value.split('\n').map((x) => x.trim()).filter(Boolean).map((t) => { const v = D.views.find((x) => x.title === t); return { uuid: v?.uuid ?? null, title: t }; });
        await store.saveProfile({ ...p, completed: [...ticked, ...typed], crime: $('pf-crime').value, notes: $('pf-notes').value });
        dlg.close?.(); renderProfile(); renderList(); renderDetail();
      };
    };
    draw();
    if (dlg.showModal) dlg.showModal(); else dlg.open = true;
  }

  // ---------------------------------------------------------------- filtri e categorie
  function renderFilters() {
    $('mc-filters').innerHTML = `<input id="mc-text" type="search" placeholder="Nome esatto o parziale, datore, nome interno…" value="${esc(S.text)}">
      <label class="mc-lbl">Legalità <select id="mc-legal"><option value="tutte">tutte</option><option value="verificate" ${S.legal === 'verificate' ? 'selected' : ''}>VERIFICATE (legali)</option><option value="non_verificate" ${S.legal === 'non_verificate' ? 'selected' : ''}>NON VERIFICATE (illegali)</option></select></label>
      <label class="mc-lbl">Ritiro in <input id="mc-from" list="mc-places" value="${esc(S.from)}" placeholder="luogo o regione"></label>
      <label class="mc-lbl">Consegna / obiettivo in <input id="mc-to" list="mc-places" value="${esc(S.to)}" placeholder="luogo o regione"></label>
      <label class="mc-lbl">Ricompensa minima <input id="mc-minr" inputmode="numeric" value="${esc(S.minReward)}" placeholder="aUEC (le dinamiche escono)"></label>
      <label class="mc-lbl">Ordina per <select id="mc-sort">${[['ricompensa', 'ricompensa'], ['distanza', 'distanza dalla posizione'], ['nave', 'compatibilità con la nave'], ['titolo', 'titolo']].map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="mc-coll" ${S.collapse ? 'checked' : ''}>una riga per modello (varianti raggruppate)</label>
      <label class="check"><input type="checkbox" id="mc-fit" ${S.fitOnly ? 'checked' : ''}>nascondi casse troppo grandi per la nave</label>
      <label class="check"><input type="checkbox" id="mc-blk" ${S.hideBlocked ? 'checked' : ''}>nascondi NON ACCESSIBILI</label>
      <p class="hint" id="mc-legal-note">VERIFICATE / NON VERIFICATE: criterio NAVCOM sulla legalità dei file, non il criterio interno del gioco.</p>`;
    const area = (t) => { const g = geo(); if (!t.trim() || !g) return null; const p = g.resolveName(t.trim()) ?? g.search(t, { limit: 1 })[0]; return p ? (p.kind === 'star' ? { system: p.system } : { id: p.id, system: p.system }) : { id: '__nessuno__' }; };
    let tm = null;
    $('mc-text').oninput = () => { clearTimeout(tm); tm = setTimeout(() => { S.text = $('mc-text').value; S.shown = PAGE; renderList(); }, 180); };
    $('mc-legal').onchange = () => { S.legal = $('mc-legal').value; save(); renderList(); };
    $('mc-from').onchange = () => { S.from = $('mc-from').value; S.fromArea = area(S.from); renderList(); };
    $('mc-to').onchange = () => { S.to = $('mc-to').value; S.toArea = area(S.to); renderList(); };
    $('mc-minr').onchange = () => { S.minReward = $('mc-minr').value; save(); renderList(); };
    $('mc-sort').onchange = () => { S.sort = $('mc-sort').value; save(); renderList(); };
    $('mc-coll').onchange = () => { S.collapse = $('mc-coll').checked; save(); renderList(); };
    $('mc-fit').onchange = () => { S.fitOnly = $('mc-fit').checked; save(); renderList(); };
    $('mc-blk').onchange = () => { S.hideBlocked = $('mc-blk').checked; save(); renderList(); };
  }
  function renderCats(counts) {
    const keys = Object.keys(MC_CATS);
    $('mc-cats').innerHTML = `${keys.map((k) => `<label class="check mc-cat" title="${esc(MC_CATS[k].note)}"><input type="checkbox" data-cat="${k}" ${S.cats.has(k) ? 'checked' : ''}><span>${esc(MC_CATS[k].label)}</span><b>${counts?.[k] ?? 0}</b></label>`).join('')}
      <button class="small" id="mc-cat-clear" ${S.cats.size ? '' : 'disabled'}>tutte le categorie</button>
      <p class="hint">Categorie calcolate da NAVCOM (tipo nei file + geografia dei luoghi noti), non quelle native del mobiGlas.</p>`;
    $('mc-cats').querySelectorAll('[data-cat]').forEach((c) => { c.onchange = () => { if (c.checked) S.cats.add(c.dataset.cat); else S.cats.delete(c.dataset.cat); S.shown = PAGE; save(); renderList(); }; });
    $('mc-cat-clear').onclick = () => { S.cats.clear(); save(); renderList(); };
  }

  // ---------------------------------------------------------------- elenco
  let last = null;
  function query() {
    return { tab: S.tab, text: S.text, cats: S.cats, legal: S.legal, relation: S.relation, region: region(), scope: S.scope, showAll: S.showAll, from: S.fromArea ?? null, to: S.toArea ?? null, minReward: num(S.minReward), fitOnly: S.fitOnly, hideBlocked: S.hideBlocked, sort: S.sort, collapse: S.collapse };
  }
  const rewardHtml = (v, rec) => {
    if (rec?.reward !== null && rec?.reward !== undefined) return `${fmtA(rec.reward)} <span class="hint">(tuo)</span>`;
    const ri = v.rewardInfo ?? { kind: v.reward ? 'fissa' : 'nd', min: v.reward };
    if (ri.kind === 'fissa') return fmtA(ri.min ?? v.reward);
    if (ri.kind === 'intervallo') return `${fmtA(ri.min)} – ${fmtA(ri.max)}`;
    if (ri.kind === 'dinamica') return '<span class="hint" title="calcolata dal gioco quando genera l\'offerta: non è nei file">dinamica</span>';
    return '<span class="hint">n.d.</span>';
  };
  const titleHtml = (v) => {
    const [cls, note] = TITLE_BADGE[v.titleStatus] ?? TITLE_BADGE.verificato;
    if (v.titleStatus === 'assente') return `<span class="mono mc-unv" title="${esc(note)}">${esc(v.debug ?? v.title)}</span> <span class="mc-badge warn">Titolo mobiGlas non verificato</span>`;
    return `<span class="${cls}" title="${esc(note)}">${esc(v.title)}</span>`;
  };
  const geoPill = (gc) => `<span class="at-pill ${gc.sure ? 'sure' : 'maybe'}" title="${esc(GEO[gc.cls]?.note ?? '')} · ${esc(gc.note ?? '')}">${esc(GEO[gc.cls]?.label ?? gc.cls)}${gc.multi ? ' · MULTI' : ''}</span>`;
  const keyOf = (r) => (r.rec ? `rec:${r.rec.id}` : r.v.id);
  function renderList() {
    if (!geo() || !D.views.length) { $('mc-list').innerHTML = `<p class="hint">${D.res ? esc(D.res.warnings?.[0] ?? 'Catalogo missioni non disponibile.') : 'Catalogo missioni in caricamento…'}</p>`; renderTabs(null); return; }
    const t0 = performance.now();
    const recs = byCatalog(store.records);
    last = controlList(D.views, query(), { geo: geo(), links: links(), profile: store.profile, L: D.L, ship: ship(), records: recs });
    renderTabs(last.counts.tabs); renderCats(last.counts.cats);
    const rows = last.rows.slice(0, S.shown); const sel = new Set(S.sel);
    const R = region();
    $('mc-list').innerHTML = `<p class="hint">${last.rows.length} contratti${S.collapse ? ` (${last.total} varianti)` : ''} · ${Math.round(performance.now() - t0)} ms${R && !S.showAll ? ` · regione ${esc((S.scope === 'luogo' ? R.place : S.scope === 'sistema' ? { name: SYS[R.system] } : (R.body ?? R.place)).name)}` : ' · tutto il catalogo'}${Object.keys(last.excluded).length ? ` · esclusi: ${Object.entries(last.excluded).map(([k, n]) => `${esc(k)} ${n}`).join(', ')}` : ''}</p>
      <ul class="mc-rows">${rows.map((r) => {
        const v = r.v; const a = AVAIL[r.av.state]; const k = keyOf(r);
        const where = whereText(r);
        return `<li class="mc-row ${S.open === k ? 'sel' : ''}" data-open="${esc(k)}">
          <input type="checkbox" data-sel="${esc(k)}" ${sel.has(k) ? 'checked' : ''} title="seleziona">
          <div class="mc-main"><div class="mc-t">${titleHtml(v)}${r.found > 1 ? ` <span class="hint">×${r.found} varianti</span>` : ''}</div>
            <div class="mc-sub">${esc(MC_CATS[r.cat]?.label ?? r.cat)} · ${esc(v.company ?? v.faction ?? 'datore n.d.')}${v.illegal ? ' · <span class="err">illegale</span>' : ''} · ${geoPill(r.gc)}${where ? ` · ${where}` : ''}</div></div>
          <div class="mc-side"><b>${rewardHtml(v, r.rec)}</b><span class="mc-av" title="${esc(a.note)}">${a.icon} ${esc(a.label)}</span>${r.fit.fit === 'cassa' ? '<span class="err">casse > nave</span>' : r.fit.fit === 'viaggi' ? `<span class="warn">${r.fit.trips} viaggi</span>` : ''}${r.dist ? `<span class="hint">${fmtD(r.dist.d)}${r.dist.fixed ? '' : ' (min. del pool)'}</span>` : ''}</div></li>`;
      }).join('')}</ul>
      ${last.rows.length > rows.length ? `<button id="mc-more">mostra altri ${Math.min(PAGE, last.rows.length - rows.length)} di ${last.rows.length - rows.length}</button>` : ''}
      ${!last.rows.length ? `<p class="hint">${S.tab === 'offerte' ? 'Nessun modello con questi filtri.' : 'Nessuna registrazione: dal dettaglio di un modello usa 📝 REGISTRA OFFERTA VISTA.'}</p>` : ''}`;
    $('mc-list').querySelectorAll('[data-open]').forEach((li) => { li.onclick = (e) => { if (e.target.matches('input')) return; S.open = li.dataset.open; renderDetail(); $('mc-list').querySelectorAll('.mc-row').forEach((x) => x.classList.toggle('sel', x.dataset.open === S.open)); }; });
    $('mc-list').querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => toggleSel(c.dataset.sel, c.checked); });
    $('mc-more') && ($('mc-more').onclick = () => { S.shown += PAGE; renderList(); });
  }
  function whereText(r) {
    const R = region(); const rel = r.rel; if (!R || !rel) return '';
    const bits = [];
    if (rel.offer) bits.push(rel.offer.level === 'luogo' ? `offerta qui` : rel.offer.level === 'corpo' ? `offerta: regione ${esc(rel.offer.via.name)}` : rel.offer.level === 'area' ? `offerta a ${esc(rel.offer.via.name)}` : `offerta: tutto ${esc(rel.offer.via.name)}`);
    if (rel.pickup) bits.push(`ritiro ${rel.pickup === 'certo' ? 'qui' : 'forse qui'}`);
    if (rel.dropoff) bits.push(`consegna ${rel.dropoff === 'certo' ? 'qui' : 'forse qui'}`);
    if (rel.objective) bits.push(`obiettivo ${rel.objective === 'certo' ? 'qui' : 'forse qui'}`);
    return `<span class="hint">${bits.join(' · ')}</span>`;
  }
  function renderTabs(counts) {
    $('mc-tabs').innerHTML = Object.entries(TABS).map(([k, t]) => `<button data-mct="${k}" class="${S.tab === k ? 'active' : ''}" title="${esc(t.note)}">${esc(t.label)} <span class="hint">${counts ? counts[k] : ''}</span></button>`).join('');
    $('mc-tabs').querySelectorAll('[data-mct]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.mct; S.shown = PAGE; save(); renderList(); }; });
  }

  // ---------------------------------------------------------------- dettaglio
  function poolBlock(label, ops, key) {
    const g = geo();
    if (!ops.length) return '';
    return ops.map((o) => {
      const c = [...new Set([...(o.ids ?? []), ...(o.alt ?? [])])].map((id) => g.get(id)?.name).filter(Boolean);
      const fixed = o.fixed ?? (c.length === 1 && !(o.unresolved ?? []).length && (o.size ?? 1) <= 1);
      const k = `${key}:${o.slot}`; const list = S.poolOpen === k ? c : c.slice(0, 10);
      return `<div class="cb-role"><b>${label}${ops.length > 1 ? ` ${o.slot}` : ''}</b> ${fixed ? '<span class="at-pill sure">FISSO</span>' : c.length ? `<span class="at-pill maybe">DINAMICO · uno fra ${c.length}</span>` : '<span class="at-pill">NON NEI DATI</span>'}
        <div>${esc(list.join(', '))}${c.length > list.length ? ` <button class="link" data-pool="${k}">… tutti i ${c.length}</button>` : ''}</div>
        ${(o.unresolved ?? []).length ? `<div class="hint">Nomi non riconosciuti nella starmap: ${esc(o.unresolved.slice(0, 5).join(', '))}${o.unresolved.length > 5 ? '…' : ''}</div>` : ''}</div>`;
    }).join('');
  }
  function renderDetail() {
    const box = $('mc-detail'); const g = geo();
    const key = S.open; if (!key || !g) { box.innerHTML = '<p class="hint">Seleziona un contratto per il briefing: requisiti, luoghi, premi, rischi e compatibilità con la nave.</p>'; return; }
    const rec = key.startsWith('rec:') ? recordById(key.slice(4)) : null;
    const v = rec ? viewOf(rec.ref.id) : viewOf(key);
    if (!v) { box.innerHTML = `<p class="warn">${rec ? `Il modello "${esc(rec.ref.title)}" non è nel catalogo attuale (patch diversa?). La tua registrazione resta salvata.` : 'Contratto non trovato.'}</p>${rec ? recordActions(rec) : ''}`; bindRecord(rec); return; }
    const R = region(); const gc = geoClass(v, g); const cat = mcCategory(v, g, gc);
    const av = availability(v, { region: R, scope: S.scope, geo: g, profile: store.profile, L: D.L, record: rec });
    const acc = av.access ?? accessCheck(v, store.profile, D.L);
    const fit = shipFit(v, ship()); const k = ship();
    const ops = v.ops ?? []; const picks = ops.filter((o) => o.role === 'pickup'), drops = ops.filter((o) => o.role === 'dropoff');
    const offerNames = (v.offer ?? []).map((o) => (o.id ? g.get(o.id)?.name : o.name)).filter(Boolean);
    const [tcls, tnote] = TITLE_BADGE[v.titleStatus] ?? TITLE_BADGE.verificato;
    const a = AVAIL[av.state];
    const target = firstTarget(v, rec);
    const inAtlas = !!A()?.index?.()?.byId.has(v.id); const atlasSel = new Set(A()?.selection?.() ?? []);
    const recs = store.records.filter((r) => r.ref.id === v.id);
    box.innerHTML = `<div class="cb-head"><span class="hm-type">${esc(MC_CATS[cat]?.label ?? cat)} · ${esc(v.type ?? 'tipo n.d.')}</span>
        <h3 class="${tcls}">${v.titleStatus === 'assente' ? `<span class="mono">${esc(v.debug ?? v.title)}</span>` : esc(v.title)}</h3>
        ${v.titleStatus && v.titleStatus !== 'verificato' ? `<p class="${v.titleStatus === 'assente' ? 'warn' : 'hint'}">${esc(tnote)}${v.titleRaw && v.titleRaw !== v.title ? ` · nelle fonti: <span class="mono">${esc(v.titleRaw)}</span>` : ''}</p>` : `<p class="hint">Titolo da: ${esc(v.titleFrom ?? 'fonte')}, in lingua originale.</p>`}</div>
      <p>${a.icon} <b>${esc(a.label)}</b> <span class="hint">${esc(a.note)}</span></p>
      ${av.rel?.offer ? `<p class="hint">${esc(offerText(av.rel.offer, R))}</p>` : ''}${av.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('')}
      ${acc.checks.length ? `<ul class="mc-checks">${acc.checks.map((c) => `<li class="${c.ok === false ? 'err' : c.ok ? 'ok' : 'warn'}">${c.ok === false ? '✖' : c.ok ? '✓' : '?'} ${esc(c.note)}</li>`).join('')}</ul>` : '<p class="hint">Nessun requisito di grado, reputazione, prerequisito o CrimeStat nei dati.</p>'}
      ${v.description ? `<p class="cb-desc">${esc(v.description)}</p><p class="hint">Briefing dalla Wiki (estratto): le parti fra [ ] le riempie il gioco.</p>` : '<p class="hint">Briefing non disponibile nelle fonti.</p>'}
      <div class="cb-role"><b>OFFERTA</b> ${offerNames.length ? `<span class="at-pill reg">${offerNames.length > 1 ? `regioni: ${offerNames.length}` : 'indicata'}</span> ${esc(offerNames.slice(0, 8).join(', '))}${offerNames.length > 8 ? '…' : ''}` : '<span class="hint">non indicata nei dati</span>'}<div class="hint">Dove il contratto può comparire: non è il punto di ritiro.</div></div>
      ${poolBlock('RITIRO', picks, 'p')}${poolBlock('CONSEGNA', drops, 'd')}${poolBlock('OBIETTIVO', v.objectives ?? [], 'o')}
      ${!picks.length && !drops.length && !(v.objectives ?? []).length ? '<div class="cb-role"><b>LUOGHI OPERATIVI</b> <span class="hint">non nei dati: si conoscono al momento dell\'offerta</span></div>' : ''}
      <div class="cb-role"><b>GEOGRAFIA</b> ${geoPill(gc)} <span class="hint">${esc(gc.note ?? '')}</span></div>
      <div class="hm-kv">
        <span>Ricompensa</span><b>${rewardHtml(v, rec)}${v.rewardInfo?.kind === 'dinamica' ? ' <span class="hint">calcolata dal gioco: non nei file</span>' : ''}</b>
        <span>Carico</span><b>${(v.orders ?? []).map((o) => `${esc(o.cargo ?? 'merce n.d.')} ${o.scuMax ? `${o.scuMin && o.scuMin !== o.scuMax ? `${o.scuMin}–` : ''}${o.scuMax} SCU` : '<span class="hint">quantità non nei dati</span>'}${o.containerMax ? `, casse ≤${o.containerMax}` : ''}`).join('<br>') || '<span class="hint">nessun carico nei dati</span>'}</b>
        <span>Nave</span><b>${esc(k.name)}: <span class="${fit.fit === 'cassa' ? 'err' : fit.fit === 'ok' ? 'ok' : 'hint'}">${esc(fit.note)}</span>${fit.fit !== 'cassa' && fit.cargo.scu ? ' <span class="hint">(disposizione fisica nella griglia non verificata)</span>' : ''}</b>
        <span>Rischi</span><b>${v.risk?.combat ? `combattimento${v.risk.enemies ? ` (fino a ${v.risk.enemies} nemici)` : ''}` : 'nessun combattimento nei dati'}${v.risk?.level ? ` · rischio ${v.risk.level}` : ''}${v.timeLimit ? ` · limite ${Math.round(v.timeLimit)} min` : ''}${v.illegal ? ' · <span class="err">illegale</span>' : ''}${v.failCriminal ? ' · fallisce se diventi criminale' : ''}</b>
        <span>Requisiti</span><b>${v.rank ? `grado ${esc(v.rank)}${v.rankMax ? ` (fino a ${esc(v.rankMax)})` : ''} con ${esc(v.company ?? '?')}` : 'nessun grado'}${v.repReq?.faction ? ` · reputazione ${esc(v.repReq.faction)} ${esc(v.repReq.min ?? '')}` : ''}${(v.prereqs ?? []).length ? `<br>${v.prereqs.map((p) => `${p.need > 1 ? `${p.need} fra ` : ''}${esc([...p.missions.map((m) => m.title ?? m.debug ?? '?'), ...p.tags.map((t) => `[tag ${t}]`)].join(', '))}`).join('<br>')}` : ''}</b>
        <span>Condizioni</span><b>${v.shareable ? 'condivisibile' : 'non condivisibile'}${v.onceOnly ? ' · una volta sola' : ''}${v.cooldown ? ` · attesa personale ${Math.round(v.cooldown / 60)} min` : ''}${v.inPrison ? ' · anche in prigione' : ''}</b>
        <span>Identificativi</span><b class="hint">nome interno <span class="mono">${esc(v.debug ?? 'n.d.')}</span><br>chiave titolo <span class="mono">${esc(v.titleKey ?? 'n.d.')}</span><br>Mission ID <span class="mono">${esc(v.uuid ?? v.id)}</span><br>Offer ID: non nelle fonti (esiste solo nel gioco)<br>${v.variants > 1 ? `${v.variants} varianti (${v.groupHow === 'wiki' ? 'gruppi della Wiki' : 'raggruppamento euristico'})` : 'nessuna variante'} · ${esc(v.patch ?? '')}</b>
      </div>
      ${recs.length ? `<h4>Le tue registrazioni</h4><ul>${recs.map((r) => `<li>${AVAIL[r.status].icon} ${esc(AVAIL[r.status].label)} · ${fmtA(r.reward)} · <span class="hint">${esc(String(r.updatedAt).slice(0, 16).replace('T', ' '))}</span> <button class="link" data-goto="rec:${esc(r.id)}">apri</button></li>`).join('')}</ul>` : ''}
      ${rec ? recordActions(rec) : ''}
      <div class="cb-actions">
        <button class="primary" id="mcd-sel">${S.sel.includes(key) ? '✓ SELEZIONATA' : '☐ SELEZIONA'}</button>
        <button id="mcd-map">🗺 MOSTRA SULLA MAPPA</button>
        <button id="mcd-route" ${target ? '' : 'disabled title="nessun luogo fisso con posizione: rotta non calcolabile"'}>🛰 CALCOLA ROTTA</button>
        <button id="mcd-plan" ${inAtlas || rec?.contractId ? '' : 'disabled title="nel piano cargo entrano solo trasporti e consegne con ritiro e consegna"'}>${atlasSel.has(v.id) ? '✓ NEL PIANO CARGO' : '＋ AGGIUNGI AL PIANO'}</button>
        <button id="mcd-rel">⧉ RAGGRUPPA CON ALTRE</button>
        ${rec ? '' : '<button id="mcd-obs">📝 REGISTRA OFFERTA VISTA</button>'}</div>
      <div id="mcd-out"></div>`;
    box.querySelectorAll('[data-pool]').forEach((b) => { b.onclick = () => { S.poolOpen = b.dataset.pool; renderDetail(); }; });
    box.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => { S.open = b.dataset.goto; S.tab = recordById(b.dataset.goto.slice(4)).status === 'visibile' ? 'visibili' : recordById(b.dataset.goto.slice(4)).status === 'accettata' ? 'accettate' : 'storico'; renderList(); renderDetail(); }; });
    $('mcd-sel').onclick = () => toggleSel(key, !S.sel.includes(key));
    $('mcd-map').onclick = () => { app.showTab('home'); app.home()?.openMission?.(planView(key)?.id ?? v.id); };
    $('mcd-route').onclick = () => routeTo(target);
    $('mcd-plan').onclick = () => { const pv = planView(key); if (!pv) return; A()?.toggle(pv.id, !atlasSel.has(pv.id)); renderDetail(); app.home()?.show?.(); };
    $('mcd-rel').onclick = () => showRelated(v, key);
    $('mcd-obs') && ($('mcd-obs').onclick = () => registerDialog(v));
    bindRecord(rec);
    $('mc-detail').scrollTop = 0;
  }
  function recordActions(rec) {
    return `<div class="mc-recbox"><p><b>Registrazione tua</b> · ${AVAIL[rec.status].icon} ${esc(AVAIL[rec.status].label)}${rec.offerAt ? ` · offerta vista a ${esc(rec.offerAt)}` : ''}${rec.contractId ? ' · con movimenti di carico (piano cargo)' : ''}</p>
      ${rec.notes ? `<p class="hint">${esc(rec.notes)}</p>` : ''}
      <div class="row wrap">${['visibile', 'accettata', 'completata', 'fallita'].filter((s) => s !== rec.status).map((s) => `<button class="small" data-rs="${s}">${AVAIL[s].icon} ${AVAIL[s].label}</button>`).join('')}<button class="small" data-rdel="1">rimuovi</button></div>
      <p class="hint">ACCETTATA aggiorna solo l'archivio di NAVCOM: accetta il contratto nel mobiGlas.</p>
      <p class="hint">Storico: ${rec.history.map((h) => `${esc(h.status)} ${esc(String(h.at).slice(0, 16).replace('T', ' '))}`).join(' → ')}</p></div>`;
  }
  function bindRecord(rec) {
    if (!rec) return;
    $('mc-detail').querySelectorAll('[data-rs]').forEach((b) => { b.onclick = async () => {
      const r = await store.setStatus(rec.id, b.dataset.rs);
      // contratto collegato nella LOGISTICS: stesso stato (accettata / completata / fallita / osservata)
      const db = L()?.db?.();
      if (r.contractId && db) { const c = (await db.contracts()).find((x) => x.id === r.contractId); if (c) { const st = { visibile: 'osservata', accettata: 'accettata', completata: 'completata', fallita: 'fallita' }[r.status]; await db.putContracts([{ ...c, status: st, updatedAt: nowIso(), history: [...(c.history ?? []), { at: nowIso(), status: st, note: 'da MISSION CONTROL' }] }]); await A()?.reloadUser?.(); } }
      S.tab = r.status === 'visibile' ? 'visibili' : r.status === 'accettata' ? 'accettate' : 'storico'; renderList(); renderDetail(); renderPlan();
    }; });
    $('mc-detail').querySelector('[data-rdel]') && ($('mc-detail').querySelector('[data-rdel]').onclick = async () => { if (!confirm('Rimuovere questa registrazione? Il contratto collegato nella LOGISTICS (se c\'è) resta.')) return; await store.remove(rec.id); S.sel = S.sel.filter((k) => k !== `rec:${rec.id}`); S.open = rec.ref.id; save(); renderList(); renderDetail(); renderPlan(); });
  }
  /** Primo luogo fisso con posizione: ritiro, poi obiettivo, poi consegna. */
  function firstTarget(v, rec) {
    const pv = rec?.contractId ? userViews().find((x) => x.contractId === rec.contractId) ?? v : v;
    const g = geo();
    for (const o of [...(pv.ops ?? []).filter((x) => x.role === 'pickup'), ...(pv.objectives ?? []), ...(pv.ops ?? []).filter((x) => x.role === 'dropoff')]) {
      const c = [...new Set([...(o.ids ?? []), ...(o.alt ?? [])])];
      if (c.length === 1 && g.get(c[0])?.pos) return g.get(c[0]);
    }
    return null;
  }
  function routeTo(p) {
    const g = geo(); if (!p || !g) return;
    const pos = state.position;
    const r = routeSteps(posFrom(), p, g, links());
    const out = $('mcd-out');
    if (!r.ok) { out.innerHTML = `<p class="warn">${esc(r.note)}</p>`; return; }
    const first = r.steps[0];
    out.innerHTML = `<h4>Rotta verso ${esc(p.name)}</h4><ol>${r.steps.map((s) => `<li>${s.kind === 'salto' ? `⇢ SALTO ${esc(s.from.name)} → ${esc(s.to.name)} <span class="hint">${esc(s.note)}</span>` : `QT ${s.from ? `${esc(s.from.name)} → ` : ''}${esc(s.to.name)}${s.distance ? ` · ${fmtD(s.distance)} in linea retta` : ''}`}</li>`).join('')}</ol>
      ${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}<button id="mcd-go">Apri il PIANIFICATORE per la tratta ${esc(first.from?.name ?? '')} → ${esc(first.to.name)}</button>
      <p class="hint">Fra sistemi NAVCOM passa dai jump point noti: nessuna distanza euclidea fra sistemi diversi.</p>`;
    $('mcd-go').onclick = () => app.planTo({ name: first.to.name, system: first.to.system, x: first.to.pos.x, y: first.to.pos.y, z: first.to.pos.z, unit: 'm', start: pos && pos.system === first.to.system && Number.isFinite(pos.x) ? pos : null });
  }
  function showRelated(v, key) {
    const out = $('mcd-out'); const g = geo();
    const pool = (last?.rows ?? []).map((r) => r.v).filter((x) => x.id !== v.id);
    const rel = relatedTo(v, pool, g).slice(0, 12);
    out.innerHTML = `<h4>Raggruppabili con questa (elenco attuale)</h4>${rel.length ? `<ul class="mc-rel">${rel.map((x) => `<li><button class="small" data-add="${esc(x.v.id)}">＋</button> ${titleHtml(x.v)} <span class="hint">${x.why.map((w) => `${w.sure ? '' : 'forse '}${esc(w.label)}`).join(' · ')}</span></li>`).join('')}</ul>` : '<p class="hint">Nessun contratto dell\'elenco condivide luoghi, destinazioni vicine o direzione con questo.</p>'}`;
    out.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { if (!S.sel.includes(key)) S.sel.push(key); toggleSel(b.dataset.add, true); b.disabled = true; }; });
  }

  // ---------------------------------------------------------------- registrazione offerta vista nel mobiGlas
  function registerDialog(v) {
    const g = geo(); const dlg = $('mc-dlg');
    const kind = missionKind(v); const cargo = (v.ops ?? []).some((o) => o.role === 'pickup');
    const rows = cargo ? draftMovements(v, g) : [];
    const here = region()?.place?.name ?? '';
    dlg.innerHTML = `<form method="dialog" class="cb-obs"><h3>Offerta vista nel mobiGlas</h3>
      <p class="hint">Modello: <b>${esc(v.title)}</b> · ${esc(v.company ?? '')} · ${esc(v.uuid ?? '')}. Inserisci i valori che leggi nel gioco: luoghi da pool restano vuoti finché non li scrivi. Nessuna lettura automatica del gioco.</p>
      <div class="cb-form"><label>Stato <select id="rg-status"><option value="visibile">VISIBILE NEL MOBIGLAS</option><option value="accettata">ACCETTATA (solo in NAVCOM)</option></select></label>
        <label>Dove l'hai vista <input id="rg-at" list="mc-places" value="${esc(here)}"></label>
        <label>Ricompensa letta (aUEC) <input id="rg-rew" inputmode="numeric" placeholder="${v.rewardInfo?.kind === 'fissa' ? v.rewardInfo.min : 'dal mobiGlas'}"></label></div>
      ${cargo ? `<p class="hint">Movimenti di carico: compilali (SCU, casse, luoghi reali) per usare il contratto nel piano cargo. Righe senza SCU non vengono salvate.</p>${rows.map((r, i) => `<fieldset><legend>Movimento ${i + 1}</legend><div class="cb-form">
        <label>Merce <input id="rg-c${i}" value="${esc(r.cargo)}"></label>
        <label>SCU <input id="rg-s${i}" inputmode="numeric" placeholder="${r.scuRange ? `${r.scuRange[0] ?? '?'}–${r.scuRange[1] ?? '?'}` : ''}"></label>
        <label>Cassa max (SCU) <input id="rg-b${i}" inputmode="numeric" value="${esc(r.containerMax)}"></label>
        <label>Ritiro <input id="rg-f${i}" list="rg-fl${i}" value="${esc(r.from)}" placeholder="${r.fromPool.length > 1 ? `uno fra ${r.fromPool.length}` : ''}"></label>
        <label>Consegna <input id="rg-t${i}" list="rg-tl${i}" value="${esc(r.to)}" placeholder="${r.toPool.length > 1 ? `uno fra ${r.toPool.length}` : ''}"></label></div>
        <datalist id="rg-fl${i}">${r.fromPool.slice(0, 400).map((n) => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="rg-tl${i}">${r.toPool.slice(0, 400).map((n) => `<option value="${esc(n)}">`).join('')}</datalist></fieldset>`).join('')}
        <label class="check"><input type="checkbox" id="rg-plan">aggiungi al piano cargo</label>`
      : `<label>Luogo dell'obiettivo letto nel mobiGlas (facoltativo) <input id="rg-obj" list="mc-places"></label><p class="hint">${esc(MC_CATS[kind]?.label ?? '')}: nessun movimento di carico.</p>`}
      <label>Screenshot (facoltativo, resta nel browser) <input type="file" id="rg-shot" accept="image/*" multiple></label>
      <p class="hint">Lettura automatica del testo dagli screenshot (OCR): non disponibile in questa versione.</p>
      <label>Note <textarea id="rg-notes" rows="2"></textarea></label>
      <div id="rg-msg"></div>
      <div class="row wrap"><button type="button" id="rg-save" class="primary" style="width:auto">SALVA</button><button type="button" id="rg-close">Annulla</button></div></form>`;
    if (dlg.showModal) dlg.showModal(); else dlg.open = true;
    $('rg-close').onclick = () => dlg.close?.();
    $('rg-save').onclick = async () => {
      const lg = L(); const db = lg?.db?.();
      const status = $('rg-status').value; const warn = [];
      let contractId = null;
      try {
        if (cargo && rows.some((_, i) => $(`rg-s${i}`).value.trim())) {
          if (!db) throw new Error('archivio della logistica non disponibile: movimenti non salvati');
          const form = { status: status === 'accettata' ? 'accettata' : 'osservata', offer: $('rg-at').value.trim(), reward: $('rg-rew').value.trim(), deadline: '', notes: $('rg-notes').value,
            movements: rows.map((_, i) => ({ cargo: $(`rg-c${i}`).value.trim(), scu: $(`rg-s${i}`).value.trim(), containerMax: $(`rg-b${i}`).value.trim(), from: $(`rg-f${i}`).value.trim(), to: $(`rg-t${i}`).value.trim() })) };
          const o = observedInput(v, form, { geo: g, patch: v.patch ?? null });
          const r = normalizeContract(o.input);
          if (!r.contract) throw new Error(r.errors.join(' · '));
          await db.putContracts([r.contract]); contractId = r.contract.id; warn.push(...o.warnings, ...r.warnings);
          const files = [...($('rg-shot').files ?? [])];
          const shots = await Promise.all(files.map((f) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res({ id: newId(), contractId, name: f.name, type: f.type, dataUrl: fr.result, at: nowIso() }); fr.readAsDataURL(f); })));
          if (shots.length) await db.putAttachments(shots.filter((s) => String(s.dataUrl).startsWith('data:image/')));
          await A()?.reloadUser?.(); lg.refreshAll?.();
        }
        const loc = !cargo && $('rg-obj')?.value.trim() ? { objective: $('rg-obj').value.trim() } : null;
        const rec = newRecord(v, { status, reward: $('rg-rew').value.trim(), offerAt: $('rg-at').value.trim(), notes: $('rg-notes').value, contractId, patch: v.patch ?? null, locations: loc });
        await store.add(rec);
        if (contractId && $('rg-plan')?.checked) { const u = userViews().find((x) => x.contractId === contractId); if (u) A()?.toggle(u.id, true); }
        dlg.close?.();
        S.tab = status === 'accettata' ? 'accettate' : 'visibili'; S.open = `rec:${rec.id}`; save();
        renderList(); renderDetail(); renderPlan(); app.home()?.show?.();
        $('mc-detail').insertAdjacentHTML('afterbegin', `<p class="ok">Registrato nell'archivio di NAVCOM${status === 'accettata' ? ' come ACCETTATA (il gioco non viene toccato)' : ''}.</p>${warn.length ? `<p class="warn">Avvisi: ${esc(warn.join(' · '))}</p>` : ''}`);
      } catch (e) { $('rg-msg').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };
  }

  // ---------------------------------------------------------------- selezione, RAGGRUPPA, ottimizzazione
  function toggleSel(key, on) {
    S.sel = on ? [...new Set([...S.sel, key])] : S.sel.filter((k) => k !== key);
    S.out = null; save(); renderPlan();
    const c = $('mc-list').querySelector(`[data-sel="${CSS.escape(key)}"]`); if (c) c.checked = on;
    if (S.open === key) renderDetail();
  }
  function selected() { return S.sel.map((k) => ({ key: k, v: planView(k) })).filter((x) => x.v); }
  function planCtx() {
    const base = A()?.stackCtx?.() ?? {}; const k = ship(); const here = posFrom();
    return { ...base, geo: geo(), links: links(), capacity: k.scu ?? base.capacity, ship: { ...(base.ship ?? {}), name: k.name, scu: k.scu, maxBox: k.maxBox }, start: here?.id ?? base.start ?? null, hideIllegal: false };
  }
  function renderPlan() {
    const box = $('mc-plan'); const list = selected();
    const missing = S.sel.length - list.length;
    box.innerHTML = `<div class="mc-plan-head"><b>MISSIONI SELEZIONATE (${list.length})</b>
      <div class="row wrap"><button id="mc-group" class="primary" style="width:auto" ${list.length >= 2 ? '' : 'disabled'}>⧉ RAGGRUPPA MISSIONI</button>
        <select id="mc-mode">${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${S.mode === k ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
        <button id="mc-opt" ${list.length ? '' : 'disabled'}>CALCOLA ITINERARIO</button>
        <button id="mc-tocargo" ${list.length ? '' : 'disabled'}>＋ tutte nel PIANO CARGO</button>
        <button class="small" id="mc-clear" ${list.length ? '' : 'disabled'}>svuota</button></div></div>
      ${list.length ? `<ul class="mc-chips">${list.map(({ key, v }) => `<li><button class="link" data-o="${esc(key)}">${esc(v.titleStatus === 'assente' ? v.debug ?? v.title : v.title)}</button>${key.startsWith('rec:') ? ' <span class="hint">(tua)</span>' : ''} <button class="small" data-x="${esc(key)}">✕</button></li>`).join('')}</ul>` : '<p class="hint">Spunta ☐ i contratti nell\'elenco: qui li raggruppi per partenza, ritiro e destinazione e calcoli l\'itinerario con la tua nave.</p>'}
      ${missing ? `<p class="warn">${missing} selezioni non sono più nel catalogo attuale.</p>` : ''}
      <div id="mc-plan-out">${S.out ?? ''}</div>`;
    box.querySelectorAll('[data-o]').forEach((b) => { b.onclick = () => { S.open = b.dataset.o; renderDetail(); }; });
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => toggleSel(b.dataset.x, false); });
    $('mc-clear').onclick = () => { S.sel = []; S.out = null; save(); renderList(); renderPlan(); };
    $('mc-mode').onchange = () => { S.mode = $('mc-mode').value; save(); };
    $('mc-group').onclick = () => { S.out = groupsHtml(groupSelection(list.map((x) => x.v), geo(), { links: links() })); renderPlan(); };
    $('mc-opt').onclick = () => { $('mc-plan-out').innerHTML = '<p class="hint">Calcolo in corso…</p>'; setTimeout(() => { S.out = planHtml(planSelection(list.map((x) => x.v), planCtx(), S.mode)); renderPlan(); bindPlanOut(); }, 20); };
    $('mc-tocargo').onclick = () => { const a = A(); if (!a) return; let n = 0; for (const { v } of list) if (a.index?.()?.byId.has(v.id)) { a.toggle(v.id, true); n++; } S.out = `<p class="hint">${n} contratti aggiunti al PIANO CARGO (CARGO nella PLANCIA, piano nell'ATLANTE). Gli altri non hanno ritiro e consegna nei dati.</p>`; renderPlan(); app.home()?.show?.(); };
    bindPlanOut();
  }
  function groupsHtml(r) {
    const name = (m) => esc(m.title);
    return `<h4>RAGGRUPPAMENTO</h4>${r.groups.length ? r.groups.map((g) => `<div class="mc-group"><b>${esc(g.label)}</b> · ${esc(g.keyLabel)} <span class="hint">${esc(GROUPS[g.kind].note)}</span>
        <ul>${g.members.map((m) => `<li>${m.sure ? '<span class="at-pill sure">CERTO</span>' : '<span class="at-pill maybe">POSSIBILE (pool)</span>'} ${name(m)}</li>`).join('')}</ul></div>`).join('') : '<p class="hint">Nessun gruppo: le missioni selezionate non condividono luoghi, destinazioni vicine o direzione.</p>'}
      ${r.pairs.length ? `<h4>Percorso condivisibile (cargo)</h4><ul>${r.pairs.map((p) => `<li>${esc(viewOf(p.a)?.title ?? planView(p.a)?.title ?? p.a)} + ${esc(viewOf(p.b)?.title ?? p.b)}: ${p.types.map((t) => `<span class="at-pill ${t.sure ? 'sure' : 'maybe'}">${esc(t.label)}${t.sure ? '' : ' (possibile)'}</span>`).join(' ')}</li>`).join('')}</ul>` : ''}
      ${r.isolated.length ? `<h4>Richiedono una deviazione</h4><ul>${r.isolated.map((x) => `<li>${esc(x.title)} <span class="hint">${esc(x.why)}</span></li>`).join('')}</ul>` : ''}
      ${r.unknown.length ? `<h4>Senza luoghi nei dati</h4><ul>${r.unknown.map((x) => `<li>${esc(x.title)} <span class="hint">luoghi noti solo al momento dell'offerta: registrali con 📝</span></li>`).join('')}</ul>` : ''}
      <p class="hint">CERTO = luoghi fissi nei dati o registrati da te. POSSIBILE = i pool si sovrappongono: il gioco sceglie il luogo quando genera l'offerta.</p>`;
  }
  let lastPlan = null;
  function planHtml(p) {
    lastPlan = p; const s = p.summary; const m = MODES[p.mode];
    const tag = (x) => `<span class="mc-how mc-${x.how}">${esc(x.how)}</span>`;
    return `<h4>${esc(m.label)} <span class="hint">${esc(m.note)}</span></h4>${p.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join('')}
      ${s ? `<div class="mc-sum">
        <div>Missioni<br><b>${s.missions.value}</b> ${tag(s.missions)}</div>
        <div>Ricompensa<br><b>${fmtA(s.reward.value)}</b> ${tag(s.reward)}<br><span class="hint">${esc(s.reward.note ?? '')}</span></div>
        <div>Cargo<br><b>${s.cargo.value} SCU</b> ${tag(s.cargo)}</div>
        <div>Viaggi<br><b>${s.trips.value ?? 'n.d.'}</b> ${tag(s.trips)}<br><span class="hint">${esc(s.trips.note ?? '')}</span></div>
        <div>Ritiri / consegne<br><b>${s.pickups.value} / ${s.dropoffs.value}</b> ${tag(s.pickups)}</div>
        <div>Distanza<br><b>${s.distance.value === null ? 'non nota' : fmtD(s.distance.value)}</b> ${tag(s.distance)}<br><span class="hint">${esc(s.distance.note ?? '')}</span></div>
        <div>Tempo<br><b>${s.time.value === null ? 'non calcolabile' : `${Math.round(s.time.value * 60)} min`}</b> ${tag(s.time)}<br><span class="hint">${esc(s.time.note ?? '')}</span></div></div>
        <h4>Itinerario</h4><ol class="cb-itin">${s.itinerary.value.map((st) => `<li><b>${esc(st.name)}</b> <span class="hint">${esc(SYS[st.system] ?? st.system ?? '')}</span> — ${st.tasks.map((t) => `${t.type === 'carico' ? '⬆ carica' : '⬇ scarica'} ${t.qty} SCU ${esc(t.cargo ?? '')}`).join(', ')}</li>`).join('')}</ol>
        ${s.risks.value.length ? `<h4>Rischi e limiti</h4><ul>${s.risks.value.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="hint">${esc(s.risks.note ?? '')}</p>`}
        ${(p.best.result.warnings ?? []).map((w) => `<p class="warn">${esc(w)}</p>`).join('')}${(p.best.result.assumed ?? []).map((w) => `<p class="hint">Ipotesi: ${esc(w)}</p>`).join('')}
        <div class="row wrap"><button id="mc-showplan">🗺 MOSTRA IL PERCORSO SULLA MAPPA (ATLANTE)</button><button id="mc-firstleg">🛰 CALCOLA ROTTA alla prima tappa</button></div>`
      : '<p class="warn">Nessuna combinazione cargo eseguibile con i dati noti: servono ritiro e consegna fissi e le quantità (registra l\'offerta vista con 📝 per inserirli).</p>'}
      ${p.excluded.length ? `<h4>Non combinate</h4><ul>${p.excluded.map((x) => `<li>${esc(x.v.title)} <span class="hint">${esc(x.why)}</span></li>`).join('')}</ul>` : ''}
      ${p.others.length ? `<h4>Altre attività (non cargo)</h4><ul>${p.others.map((x) => `<li>${esc(x.v.title)} <span class="hint">${esc(x.note)}</span></li>`).join('')}</ul><p class="hint">Bounty, mercenari e indagini non vengono mescolati automaticamente con il cargo: rischi e ricompense restano separati.</p>` : ''}
      <p class="hint">Valori: <span class="mc-how mc-noto">noto</span> dai dati · <span class="mc-how mc-calcolato">calcolato</span> da NAVCOM · <span class="mc-how mc-parziale">parziale</span> · <span class="mc-how mc-mancante">mancante</span>.</p>`;
  }
  function bindPlanOut() {
    if (!lastPlan?.best) return;
    $('mc-showplan') && ($('mc-showplan').onclick = () => { A()?.showPlan?.(lastPlan.best.result); app.showTab('atlas'); });
    $('mc-firstleg') && ($('mc-firstleg').onclick = () => { const st = lastPlan.summary.itinerary.value[0]; const p = st && geo()?.get(st.id); if (!p) return; const r = routeSteps(posFrom(), p, geo(), links()); const leg = r.ok ? r.steps[0] : null; const t = leg?.to ?? p; const pos = state.position; app.planTo({ name: t.name, system: t.system, x: t.pos.x, y: t.pos.y, z: t.pos.z, unit: 'm', start: pos && pos.system === t.system && Number.isFinite(pos.x) ? pos : null }); });
  }

  // ---------------------------------------------------------------- provenienza
  function renderProv() {
    const p = provenance(D.res);
    $('mc-prov').innerHTML = p.ok ? `<span class="${p.stale ? 'warn' : 'hint'}">Catalogo: ${esc(p.text)}</span>${p.liveDefault && p.liveDefault !== p.patch ? ` <span class="warn">· LIVE secondo la Wiki: ${esc(p.liveDefault)}</span>` : ''} <span class="hint">· nessuna connessione al Contract Manager del gioco: le offerte reali le registri tu</span>`
      : `<span class="warn">${esc(D.res?.warnings?.[0] ?? 'Catalogo missioni in caricamento…')}</span>`;
  }
  function renderAll() { renderProv(); renderPos(); renderProfile(); renderFilters(); renderList(); renderDetail(); renderPlan(); }

  state.onChange((what) => { if (what === 'position') { renderPos(); renderList(); renderDetail(); } if (what === 'ship') { renderList(); renderDetail(); } });
  renderAll();
  load();

  return {
    show() { if (!D.views.length) load(); else { renderPos(); renderList(); renderPlan(); } },
    /** "MISSIONI DA QUESTA LOCALITA'" / "VERSO": apre il Mission Control sul luogo (o sulla posizione della PLANCIA) */
    async open({ placeId = null, relation = 'da', scope = null } = {}) {
      S.anchor = placeId && placeId !== state.position?.place?.id ? placeId : null;
      S.relation = relation; if (scope) S.scope = scope; S.tab = 'offerte'; S.showAll = false; S.shown = PAGE; save();
      app.showTab('control'); renderAll();
    },
    nearestPlace: (pos) => nearestPlace(pos),
    /** dopo un ripristino del backup: rilegge registro e profilo dall'archivio */
    async reload() { await store.load(); renderAll(); },
  };
}
