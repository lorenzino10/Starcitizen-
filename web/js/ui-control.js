// MISSION CONTROL 3.0: mobiGlas potenziato. Ordine dell'esperienza:
// DOVE SONO? -> CHE TIPO DI MISSIONE? -> QUALI POSSO CERCARE? -> QUALI MI INTERESSANO? -> POSSO RAGGRUPPARLE? -> PERCORSO.
// Stesso motore della 2.1 (control.js, stack, pianificatore): cambia solo quanto si vede e quando.
// Modalita' SEMPLICE (predefinita, ricordata) e AVANZATA (tutti i filtri e i dati tecnici).
// Nessuna connessione al gioco: le offerte reali le registri tu; "ACCETTATA" aggiorna solo NAVCOM.
import {
  MC_CATS, GEO, AVAIL, TABS, GROUPS, MODES, SCOPES, BIG_CATS, TRIPS, STATE_SHORT, regionOf, controlList, geoClass, mcCategory, availability, accessCheck, ladders,
  groupSelection, planSelection, planReport, routeSteps, offerText, shipFit, missionKind, relatedTo, catsFor, bigCounts, opSummary, roleSummary, expedition,
} from './missions/control.js';
import { McStore, newRecord, byCatalog } from './missions/records.js';
import { shipCaps, jumpLinks } from './missions/finder.js';
import { provenance } from './missions/load.js';
import { draftMovements, observedInput } from './missions/observe.js';
import { normalizeContract } from './logistics/model.js';
import { DEFAULT_SHIP } from './home/model.js';
import { newId, nowIso } from './core/points.js';

const SYS = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
const PAGE = 60;
const fmtA = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n.d.' : `${Math.round(n).toLocaleString('it-IT')} aUEC`);
const fmtD = (m) => (m === null || m === undefined || !Number.isFinite(m) ? '—' : Math.abs(m) < 1e4 ? `${Math.round(m).toLocaleString('it-IT')} m` : Math.abs(m) < 1e8 ? `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km` : `${(m / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} Gm`);
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(+v) ? null : +v);
const TITLE_NOTE = {
  dinamico: 'Titolo dinamico: le parti fra [ ] le riempie il gioco',
  risolto: 'Titolo mobiGlas non verificato: parametro sostituito con l\'unico valore dei file',
  assente: 'Titolo mobiGlas non verificato: nessun titolo nelle fonti',
};
const SORTS = [['ricompensa', 'Ricompensa'], ['posizione', 'Compatibilità con la posizione'], ['distanza', 'Distanza (quando calcolabile)'], ['nave', 'Capacità cargo'], ['titolo', 'Titolo']];
// filtri della modalita' avanzata con i loro valori neutri: in SEMPLICE restano attivi solo se li hai cambiati tu
const ADV_DEFAULT = { scope: 'corpo', relation: 'da', legal: 'tutte', from: '', to: '', fitOnly: false, hideBlocked: false, showAll: false, collapse: true, fine: [] };

export async function initControl(app) {
  const { $, esc, state } = app;
  const A = () => app.atlas() ?? null;
  const geo = () => A()?.geo?.() ?? null;
  const L = () => app.logistics?.() ?? null;
  const pref = state.bridge.mc ?? {};
  const legacyTab = { offerte: 'possibili' };
  const S = {
    ui: pref.ui === 'avanzata' ? 'avanzata' : 'semplice',
    tab: legacyTab[pref.tab] ?? (TABS[pref.tab] && !TABS[pref.tab].legacy ? pref.tab : 'possibili'),
    big: pref.big ?? null, trip: pref.trip ?? 'tutti',
    scope: pref.scope ?? ADV_DEFAULT.scope, relation: pref.relation ?? ADV_DEFAULT.relation, legal: pref.legal ?? ADV_DEFAULT.legal, sort: pref.sort ?? 'ricompensa',
    fine: new Set(pref.fine ?? pref.cats ?? []), text: '', showAll: !!pref.showAll, collapse: pref.collapse ?? true, fitOnly: !!pref.fitOnly, hideBlocked: !!pref.hideBlocked,
    minReward: pref.minReward ?? '', from: '', to: '', sel: pref.sel ?? [], open: null, shown: PAGE, mode: pref.mode ?? 'guadagno',
    advOpen: false, expand: new Set(), poolOpen: new Set(), detailW: pref.detailW ?? 460, expList: false,
  };
  const D = { views: [], res: null, ships: [], L: new Map(), byId: new Map() };
  const store = new McStore(L()?.db?.() ?? null);
  await store.load();
  const save = () => state.setBridge({ mc: { ui: S.ui, tab: S.tab, big: S.big, trip: S.trip, scope: S.scope, relation: S.relation, legal: S.legal, sort: S.sort, fine: [...S.fine], showAll: S.showAll, collapse: S.collapse, fitOnly: S.fitOnly, hideBlocked: S.hideBlocked, minReward: S.minReward, sel: S.sel, mode: S.mode, detailW: S.detailW } });
  const links = () => (geo() ? jumpLinks(geo()) : []);
  const ship = () => shipCaps(state.ship ?? DEFAULT_SHIP, D.ships);
  const userViews = () => (A()?.views?.() ?? []).filter((v) => v.origin === 'utente');
  const viewOf = (id) => D.byId.get(id) ?? userViews().find((v) => v.id === id) ?? null;
  const recordById = (id) => store.records.find((r) => r.id === id) ?? null;
  const adv = () => S.ui === 'avanzata';
  /** vista da pianificare per un elemento selezionato: il contratto registrato (luoghi reali) prevale sul modello */
  const planView = (key) => {
    if (key.startsWith('rec:')) { const r = recordById(key.slice(4)); if (!r) return null; const u = r.contractId ? userViews().find((v) => v.contractId === r.contractId) : null; return u ?? viewOf(r.ref.id); }
    return viewOf(key);
  };
  /** filtri avanzati diversi dal valore neutro (per l'avviso in modalita' semplice) */
  const advActive = () => [
    S.scope !== ADV_DEFAULT.scope && `raggio: ${SCOPES[S.scope].label}`, S.relation !== ADV_DEFAULT.relation && `relazione: ${S.relation}`,
    S.legal !== ADV_DEFAULT.legal && `legalità: ${S.legal}`, S.from && `ritiro in ${S.from}`, S.to && `consegna in ${S.to}`, S.fitOnly && 'solo casse compatibili',
    S.hideBlocked && 'senza NON ACCESSIBILI', S.showAll && 'tutto il catalogo', !S.collapse && 'varianti separate', S.fine.size && `${S.fine.size} categorie fini`,
  ].filter(Boolean);
  function resetAdv() { Object.assign(S, { scope: ADV_DEFAULT.scope, relation: ADV_DEFAULT.relation, legal: ADV_DEFAULT.legal, from: '', to: '', fromArea: null, toArea: null, fitOnly: false, hideBlocked: false, showAll: false, collapse: true }); S.fine.clear(); save(); renderAll(); }

  // ---------------------------------------------------------------- dati
  async function load() {
    const db = await app.missionDb?.();
    D.res = db?.res ?? null; D.views = db?.views ?? []; D.ships = db?.ships ?? [];
    D.byId = new Map(D.views.map((v) => [v.id, v])); D.L = ladders(D.views);
    renderAll();
  }

  // ---------------------------------------------------------------- 1. DOVE SONO? (posizione della PLANCIA, mai il sistema dell'ATLANTE)
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
    S.anchor = null;
    await state.setPosition({ system: p.system, x: p.pos?.x ?? null, y: p.pos?.y ?? null, z: p.pos?.z ?? null, source: 'luogo', place: { id: p.id, name: p.name } });
  }
  function renderTop(res) {
    const g = geo(); const pos = state.position; const R = region(); const k = ship();
    const near = !R && pos ? nearestPlace(pos) : null;
    const atlasSys = A()?.currentSystem?.();
    const active = advActive();
    const where = !g ? '<span class="mc3-dim">Atlante in caricamento…</span>'
      : R ? `<span class="mc3-place">📍 ${esc(R.place.name)}</span><span class="mc3-region">${esc((R.body ?? R.place).name)} · ${esc(SYS[R.system] ?? R.system)}</span>${S.anchor ? ' <span class="mc3-warn">(località di analisi, non la tua posizione)</span> <button class="link" id="mc-unanchor">torna alla tua posizione</button>' : ''}`
        : pos ? `<span class="mc3-warn">Posizione XYZ senza luogo (${esc(SYS[pos.system] ?? pos.system)})</span>${near ? ` <button class="link" id="mc-use-near">usa ${esc(near.place.name)} (a ${fmtD(near.d)})</button>` : ''}`
          : '<span class="mc3-warn">📍 POSIZIONE NON IMPOSTATA</span>';
    $('mc-top').innerHTML = `<div class="mc3-where">${where}
        <input id="mc-pos-q" list="mc-places" placeholder="${R ? 'cambia località…' : 'dove sei? città, stazione, avamposto…'}" autocomplete="off" aria-label="Cambia posizione"><datalist id="mc-places"></datalist></div>
      <div class="mc3-ship" title="Nave attiva (dalla PLANCIA)">🚀 ${esc(k.name)}${k.scu ? ` · ${k.scu} SCU` : ''}</div>
      <div class="mc3-count">${res ? `<b>${res.rows.length.toLocaleString('it-IT')}</b> missioni${res.total !== res.rows.length ? ` <span class="mc3-dim">(${res.total.toLocaleString('it-IT')} varianti)</span>` : ''}` : ''}</div>
      <div class="mc3-tools">
        <button id="mc-adv-btn" class="${S.advOpen || adv() ? 'on' : ''}">FILTRI AVANZATI${active.length ? ` (${active.length})` : ''}</button>
        <button id="mc-prof-edit" title="Gradi, certificazioni, CrimeStat: servono per POSSIBILI QUI">PROFILO${store.profile.standings.length ? ` · ${store.profile.standings.length}` : ''}</button>
        <span class="mc3-mode" role="group" aria-label="Modalità"><button data-ui="semplice" class="${adv() ? '' : 'on'}">SEMPLICE</button><button data-ui="avanzata" class="${adv() ? 'on' : ''}">AVANZATA</button></span>
      </div>
      ${atlasSys && R && atlasSys !== R.system ? `<p class="mc3-note">L'ATLANTE mostra ${esc(SYS[atlasSys] ?? atlasSys)}: la ricerca missioni usa la tua posizione (${esc(SYS[R.system] ?? R.system)}).</p>` : ''}
      ${!adv() && active.length ? `<p class="mc3-note">Filtri avanzati attivi: ${esc(active.join(' · '))} <button class="link" id="mc-adv-reset">azzera</button></p>` : ''}`;
    const q = $('mc-pos-q');
    q.oninput = () => { const list = g ? g.search(q.value, { limit: 25 }) : []; $('mc-places').innerHTML = list.map((p) => `<option value="${esc(p.name)}">${esc(g.pathLabel(p.id))}</option>`).join(''); };
    q.onchange = async () => { const p = g?.resolveName(q.value.trim()) ?? g?.search(q.value, { limit: 1 })[0]; if (p) { S.shown = PAGE; if (S.tab === 'catalogo' && !region()) S.tab = 'possibili'; await setPlace(p.id); } };
    $('mc-use-near') && ($('mc-use-near').onclick = () => setPlace(near.place.id));
    $('mc-unanchor') && ($('mc-unanchor').onclick = () => { S.anchor = null; renderAll(); });
    $('mc-adv-btn').onclick = () => { S.advOpen = !S.advOpen; renderAdv(); renderTop(last); };
    $('mc-adv-reset') && ($('mc-adv-reset').onclick = resetAdv);
    $('mc-prof-edit').onclick = profileDialog;
    $('mc-top').querySelectorAll('[data-ui]').forEach((b) => { b.onclick = () => { S.ui = b.dataset.ui; S.advOpen = false; save(); $('tab-control').dataset.ui = S.ui; renderAll(); }; });
  }

  // ---------------------------------------------------------------- PLAYER PROFILE
  function profileDialog() {
    const dlg = $('mc-dlg'); const p = structuredClone(store.profile);
    const factions = [...new Set([...D.L.keys()].map((k) => k.split('|')[0]))].sort((a, b) => a.localeCompare(b));
    const scopesOf = (f) => [...new Set([...D.L.keys()].filter((k) => k.startsWith(`${f}|`)).map((k) => k.split('|')[1]).filter((s) => s !== '*'))];
    const namesOf = (f, s) => (D.L.get(`${f}|${s || '*'}`) ?? D.L.get(`${f}|*`) ?? []).map((x) => x.name);
    const certs = D.views.filter((v) => /Certification/i.test(v.debug ?? '') && v.titleStatus === 'verificato');
    const draw = () => {
      dlg.innerHTML = `<form method="dialog" class="mc-prof"><h3>PLAYER PROFILE</h3>
        <p class="mc3-sub">Dati inseriti da te, salvati in questo browser. Servono a capire quali missioni sono POSSIBILI QUI. Nessun grado è presunto: quello che manca resta "da verificare".</p>
        <h4>Fazioni e gradi (anche hauling e bounty)</h4>
        ${p.standings.map((s, i) => `<div class="row wrap mc-st"><select data-f="${i}"><option value="">fazione…</option>${factions.map((f) => `<option ${f === s.faction ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
          <select data-s="${i}"><option value="">tutte le scale</option>${scopesOf(s.faction).map((x) => `<option ${x === s.scope ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select data-n="${i}"><option value="">grado…</option>${namesOf(s.faction, s.scope).map((x) => `<option ${x === s.standing ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <input data-r="${i}" inputmode="numeric" placeholder="reputazione (facoltativa)" value="${s.rep ?? ''}" style="width:150px"><button type="button" class="small" data-x="${i}">✕</button></div>`).join('')}
        <button type="button" class="small" id="pf-add">＋ grado</button>
        <h4>Certificazioni e missioni prerequisito completate</h4>
        <div class="mc-certs">${certs.map((v) => `<label class="check"><input type="checkbox" data-c="${esc(v.uuid)}" data-t="${esc(v.title)}" ${p.completed.some((c) => c.uuid === v.uuid) ? 'checked' : ''}>${esc(v.title)}</label>`).join('') || '<span class="mc3-dim">nessuna certificazione nel catalogo</span>'}</div>
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
        dlg.close?.(); renderAll();
      };
    };
    draw();
    if (dlg.showModal) dlg.showModal(); else dlg.open = true;
  }

  // ---------------------------------------------------------------- FILTRI AVANZATI (tutto quello che c'era nella 2.1)
  function renderAdv() {
    const box = $('mc-adv'); const open = adv() || S.advOpen;
    box.hidden = !open; if (!open) { box.innerHTML = ''; return; }
    const p = store.profile;
    box.innerHTML = `<div class="mc3-advgrid">
      <label>Raggio di ricerca <select id="mc-scope">${Object.entries(SCOPES).map(([k, s]) => `<option value="${k}" ${S.scope === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <label>Relazione <select id="mc-rel"><option value="da" ${S.relation === 'da' ? 'selected' : ''}>DA qui (offerta, ritiro, obiettivo)</option><option value="verso" ${S.relation === 'verso' ? 'selected' : ''}>VERSO qui (consegna, obiettivo)</option><option value="tutte" ${S.relation === 'tutte' ? 'selected' : ''}>da o verso qui</option></select></label>
      <label>Legalità <select id="mc-legal"><option value="tutte">tutte</option><option value="verificate" ${S.legal === 'verificate' ? 'selected' : ''}>solo legali</option><option value="non_verificate" ${S.legal === 'non_verificate' ? 'selected' : ''}>solo illegali</option></select></label>
      <label>Ritiro in <input id="mc-from" list="mc-places" value="${esc(S.from)}" placeholder="luogo o regione"></label>
      <label>Consegna / obiettivo in <input id="mc-to" list="mc-places" value="${esc(S.to)}" placeholder="luogo o regione"></label>
      <div class="mc3-checks">
        <label class="check"><input type="checkbox" id="mc-coll" ${S.collapse ? 'checked' : ''}>varianti raggruppate sotto un titolo</label>
        <label class="check"><input type="checkbox" id="mc-fit" ${S.fitOnly ? 'checked' : ''}>nascondi casse troppo grandi per la nave</label>
        <label class="check"><input type="checkbox" id="mc-blk" ${S.hideBlocked ? 'checked' : ''}>nascondi NON ACCESSIBILI</label>
        <label class="check"><input type="checkbox" id="mc-all" ${S.showAll ? 'checked' : ''}>ignora la regione (tutto il catalogo anche in MODELLI DELLA REGIONE)</label>
      </div></div>
      <details ${S.fine.size ? 'open' : ''}><summary>Categorie fini (${S.fine.size ? `${S.fine.size} scelte: sostituiscono le grandi categorie` : 'nessuna'})</summary>
        <div class="mc3-fine">${Object.entries(MC_CATS).map(([k, c]) => `<label class="check" title="${esc(c.note)}"><input type="checkbox" data-fine="${k}" ${S.fine.has(k) ? 'checked' : ''}>${esc(c.label)} <span class="mc3-dim">${last?.counts.cats[k] ?? 0}</span></label>`).join('')}</div></details>
      <p class="mc3-sub">Profilo: ${p.standings.length} gradi · ${p.completed.length} prerequisiti · CrimeStat ${p.crime ?? 'non registrato'}. Categorie calcolate da NAVCOM (tipo nei file + geografia dei luoghi noti), non quelle native del mobiGlas. ${adv() ? '<button class="link" id="mc-legacy">vista 2.1: MODELLI DELLA REGIONE</button>' : ''}</p>`;
    const area = (t) => { const g = geo(); if (!t.trim() || !g) return null; const pl = g.resolveName(t.trim()) ?? g.search(t, { limit: 1 })[0]; return pl ? (pl.kind === 'star' ? { system: pl.system } : { id: pl.id, system: pl.system }) : { id: '__nessuno__' }; };
    const ch = (id, f) => { $(id).onchange = () => { f($(id)); S.shown = PAGE; save(); renderList(); renderTop(last); }; };
    ch('mc-scope', (e) => { S.scope = e.value; }); ch('mc-rel', (e) => { S.relation = e.value; }); ch('mc-legal', (e) => { S.legal = e.value; });
    ch('mc-from', (e) => { S.from = e.value; S.fromArea = area(S.from); }); ch('mc-to', (e) => { S.to = e.value; S.toArea = area(S.to); });
    ch('mc-coll', (e) => { S.collapse = e.checked; }); ch('mc-fit', (e) => { S.fitOnly = e.checked; }); ch('mc-blk', (e) => { S.hideBlocked = e.checked; }); ch('mc-all', (e) => { S.showAll = e.checked; });
    box.querySelectorAll('[data-fine]').forEach((c) => { c.onchange = () => { if (c.checked) S.fine.add(c.dataset.fine); else S.fine.delete(c.dataset.fine); S.shown = PAGE; save(); renderList(); renderTop(last); }; });
    $('mc-legacy') && ($('mc-legacy').onclick = () => { S.tab = 'offerte'; S.shown = PAGE; save(); renderList(); });
  }

  // ---------------------------------------------------------------- 2. CHE TIPO DI MISSIONE? (sei categorie + viaggio)
  function renderCats(counts) {
    const bc = bigCounts(counts ?? {});
    $('mc-cats').innerHTML = `${Object.entries(BIG_CATS).map(([k, b]) => `<button class="mc3-cat ${S.big === k ? 'on' : ''}" data-big="${k}" aria-pressed="${S.big === k}"><span class="mc3-ico">${b.icon}</span><span class="mc3-cl">${esc(b.label)}</span><span class="mc3-cn">${bc.big[k].toLocaleString('it-IT')}</span></button>`).join('')}
      <button class="mc3-cat mc3-all ${S.big ? '' : 'on'}" data-big="">TUTTE</button>`;
    $('mc-cats').querySelectorAll('[data-big]').forEach((b) => { b.onclick = () => { S.big = b.dataset.big || null; if (S.big !== 'trasporti') S.trip = 'tutti'; S.shown = PAGE; S.fine.clear(); save(); renderList(); }; });
    const trips = S.big === 'trasporti' ? `<div class="mc3-trips" role="group" aria-label="Tipo di viaggio">${Object.entries(TRIPS).map(([k, t]) => `<button data-trip="${k}" class="${S.trip === k ? 'on' : ''}" title="${k === 'tr_open' ? 'il pool ammette più classi o i luoghi non sono nei dati: nessuna classe certa' : ''}">${esc(t.label)} <span>${bc.trips[k]}</span></button>`).join('')}</div>` : '';
    $('mc-trip').innerHTML = trips;
    $('mc-trip').querySelectorAll('[data-trip]').forEach((b) => { b.onclick = () => { S.trip = b.dataset.trip; S.shown = PAGE; save(); renderList(); }; });
  }
  function renderQuick() {
    $('mc-quick').innerHTML = `<input id="mc-text" type="search" placeholder="Cerca per titolo…" value="${esc(S.text)}" aria-label="Cerca per titolo">
      <label>Ricompensa minima <input id="mc-minr" inputmode="numeric" value="${esc(S.minReward)}" placeholder="aUEC"></label>
      <label>Ordina per <select id="mc-sort">${SORTS.map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    let tm = null;
    $('mc-text').oninput = () => { clearTimeout(tm); tm = setTimeout(() => { S.text = $('mc-text').value; S.shown = PAGE; renderList(); }, 180); };
    $('mc-minr').onchange = () => { S.minReward = $('mc-minr').value; save(); renderList(); };
    $('mc-sort').onchange = () => { S.sort = $('mc-sort').value; save(); renderList(); };
  }
  function renderTabs(counts) {
    const show = Object.entries(TABS).filter(([k, t]) => !t.legacy || S.tab === k);
    $('mc-tabs').innerHTML = show.map(([k, t]) => `<button data-mct="${k}" class="${S.tab === k ? 'active' : ''}" title="${esc(t.note)}">${esc(t.label)} <span class="mc3-tc">${counts ? counts[k].toLocaleString('it-IT') : ''}</span></button>`).join('');
    $('mc-tabs').querySelectorAll('[data-mct]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.mct; S.shown = PAGE; save(); renderList(); }; });
  }

  // ---------------------------------------------------------------- 3-4. QUALI POSSO CERCARE? QUALI MI INTERESSANO?
  let last = null;
  function query() {
    return {
      tab: S.tab, text: S.text, cats: S.fine.size ? S.fine : catsFor(S.big, S.trip), legal: S.legal, relation: S.relation, region: region(), scope: S.scope, showAll: S.showAll,
      from: S.fromArea ?? null, to: S.toArea ?? null, minReward: num(S.minReward), fitOnly: S.fitOnly, hideBlocked: S.hideBlocked, sort: S.sort, collapse: S.collapse || !adv(),
    };
  }
  const rewardHtml = (v, rec) => {
    if (rec?.reward !== null && rec?.reward !== undefined) return `${fmtA(rec.reward)} <span class="mc3-dim">(letta da te)</span>`;
    const ri = v.rewardInfo ?? { kind: v.reward ? 'fissa' : 'nd', min: v.reward };
    if (ri.kind === 'fissa') return fmtA(ri.min ?? v.reward);
    if (ri.kind === 'intervallo') return `${fmtA(ri.min)} – ${fmtA(ri.max)}`;
    if (ri.kind === 'dinamica') return '<span class="mc3-dim" title="calcolata dal gioco quando genera l\'offerta: non è nei file">dinamica</span>';
    return '<span class="mc3-dim">n.d.</span>';
  };
  /** Titolo per lo schermo: esatto quando c'e'; mai il nome interno nella vista semplice. */
  const titleHtml = (v) => {
    if (v.titleStatus === 'assente') return `<span class="mc3-unv" title="${esc(TITLE_NOTE.assente)}">${esc(v.title)}</span> <span class="mc3-badge warn">titolo non verificato</span>`;
    if (v.titleStatus === 'dinamico' || v.titleStatus === 'risolto') return `<span title="${esc(TITLE_NOTE[v.titleStatus])}">${esc(v.title)}</span>`;
    return esc(v.title);
  };
  const plainTitle = (v) => v.title;
  const roleText = (r, what) => (r.kind === 'fisso' ? esc(r.text) : r.kind === 'variabile' ? `<span class="mc3-var">${what} variabile (${r.n})</span>` : r.kind === 'ignoto' ? `<span class="mc3-var">${what}: da confermare</span>` : null);
  function routeLine(v) {
    const g = geo(); const o = opSummary(v, g);
    const scu = o.cargo.scu ? ` · <b>${o.cargo.scuMin && o.cargo.scuMin !== o.cargo.scu ? `${o.cargo.scuMin}–` : ''}${o.cargo.scu} SCU</b>` : '';
    if (o.pickup.kind !== 'nessuno' || o.dropoff.kind !== 'nessuno') {
      const a = roleText(o.pickup, 'ritiro') ?? '<span class="mc3-var">ritiro non nei dati</span>';
      const b = o.dropoff.kind === 'nessuno' ? '<span class="mc3-var">consegna non nei dati</span>' : o.dropoff.kind === 'fisso' ? esc(o.dropoff.text) : '<span class="mc3-var">DA CONFERMARE NEL MOBIGLAS</span>';
      return `${a} → ${b}${scu}`;
    }
    if (o.objective.kind !== 'nessuno') return `Obiettivo: ${roleText(o.objective, 'luogo') ?? ''}`;
    return '<span class="mc3-var">Luogo da confermare nel mobiGlas</span>';
  }
  const kindLabel = (r) => {
    const big = Object.entries(BIG_CATS).find(([, b]) => b.cats.includes(r.cat));
    const trip = r.cat.startsWith('tr_') ? (TRIPS[r.cat]?.label ?? '') : '';
    return big ? `${big[1].label.charAt(0)}${big[1].label.slice(1).toLowerCase()}${trip ? ` · ${trip.toLowerCase()}` : ''}` : (MC_CATS[r.cat]?.label ?? r.cat);
  };
  const keyOf = (r) => (r.rec ? `rec:${r.rec.id}` : r.v.id);
  const stateBadge = (r) => { const st = STATE_SHORT[r.av.state]; return st ? `<span class="mc3-state ${st.cls}" title="${esc(AVAIL[r.av.state]?.note ?? '')}">${esc(st.label)}</span>` : ''; };
  function rowHtml(r, sel, sub = false) {
    const v = r.v; const k = keyOf(r); const g = geo();
    const advBits = adv() ? `<div class="mc3-advrow">${esc(v.company ?? v.faction ?? 'datore n.d.')} · ${esc(GEO[r.gc.cls]?.label ?? r.gc.cls)}${r.gc.multi ? ' · MULTI' : ''}${v.illegal ? ' · <span class="err">illegale</span>' : ''}${v.titleStatus === 'assente' ? ` · <span class="mono">${esc(v.debug ?? '')}</span>` : ''}${r.rel?.offer && region() ? ` · ${esc(offerText(r.rel.offer, region()))}` : ''}</div>` : '';
    const fit = r.fit.fit === 'cassa' ? '<span class="mc3-state err">casse troppo grandi</span>' : r.fit.fit === 'viaggi' ? `<span class="mc3-dim">${r.fit.trips} viaggi</span>` : '';
    return `<li class="mc3-row ${sel.has(k) ? 'picked' : ''} ${S.open === k ? 'open' : ''} ${sub ? 'sub' : ''}" data-open="${esc(k)}">
      <label class="mc3-pick" title="aggiungi a LA MIA SPEDIZIONE"><input type="checkbox" data-sel="${esc(k)}" ${sel.has(k) ? 'checked' : ''}></label>
      <div class="mc3-main"><div class="mc3-title">${sub ? `<span class="mc3-dim">variante · </span>` : ''}${titleHtml(v)}</div>
        <div class="mc3-line"><span class="mc3-kind">${esc(kindLabel(r))}</span> <span class="mc3-route">${g ? routeLine(v) : ''}</span></div>${advBits}
        ${!sub && r.found > 1 ? `<button class="mc3-varbtn" data-exp="${esc(k)}">${S.expand.has(k) ? '▾' : '▸'} ${r.found} varianti</button>` : ''}</div>
      <div class="mc3-side"><span class="mc3-rew">${rewardHtml(v, r.rec)}</span>${stateBadge(r)}${fit}${r.dist ? `<span class="mc3-dim">${fmtD(r.dist.d)}${r.dist.fixed ? '' : ' (min.)'}</span>` : ''}</div></li>`;
  }
  function renderList() {
    if (!geo() || !D.views.length) { $('mc-list').innerHTML = `<p class="mc3-empty">${D.res ? esc(D.res.warnings?.[0] ?? 'Catalogo missioni non disponibile.') : 'Catalogo missioni in caricamento…'}</p>`; renderTabs(null); renderTop(null); return; }
    const t0 = performance.now();
    const R = region();
    if (!R && S.tab === 'possibili') S.tab = 'catalogo';
    last = controlList(D.views, query(), { geo: geo(), links: links(), profile: store.profile, L: D.L, ship: ship(), records: byCatalog(store.records) });
    // con le varianti raggruppate i numeri contano i titoli, come l'elenco
    const byTitle = query().collapse;
    renderTabs(byTitle ? { ...Object.fromEntries(Object.keys(last.counts.tabs).map((k) => [k, 0])), ...last.counts.titles.tabs } : last.counts.tabs);
    renderCats(byTitle ? last.counts.titles.cats : last.counts.cats); renderTop(last);
    const rows = last.rows.slice(0, S.shown); const sel = new Set(S.sel);
    const intro = {
      possibili: R ? `Missioni che i dati offrono nella regione <b>${esc((S.scope === 'luogo' ? R.place : S.scope === 'sistema' ? { name: SYS[R.system] } : (R.body ?? R.place)).name)}</b>, senza requisiti registrati in contrasto. Non sono offerte confermate: cercale nel mobiGlas.` : '',
      catalogo: 'Tutti i modelli presenti nei file di gioco, anche quelli offerti altrove.',
      visibili: 'Offerte che hai visto nel mobiGlas e registrato.', accettate: 'Contratti che hai segnato come accettati (solo in NAVCOM).',
      storico: 'Completate e fallite.', eventi: 'Missioni Priority ed eventi speciali presenti nel catalogo.', offerte: 'Vista 2.1: modelli legati alla regione per offerta, ritiro o obiettivo.',
    }[S.tab];
    $('mc-list').innerHTML = `${intro ? `<p class="mc3-intro">${intro}${adv() ? ` <span class="mc3-dim">${Math.round(performance.now() - t0)} ms${Object.keys(last.excluded).length ? ` · esclusi: ${Object.entries(last.excluded).map(([k, n]) => `${esc(k)} ${n}`).join(', ')}` : ''}</span>` : ''}</p>` : ''}
      <ul class="mc3-rows">${rows.map((r) => rowHtml(r, sel) + (r.found > 1 && S.expand.has(keyOf(r)) ? `<li class="mc3-vars"><ul>${r.members.slice(1).map((m) => rowHtml(m, sel, true)).join('')}</ul></li>` : '')).join('')}</ul>
      ${last.rows.length > rows.length ? `<button id="mc-more" class="mc3-more">mostra altre ${Math.min(PAGE, last.rows.length - rows.length)} (ne restano ${last.rows.length - rows.length})</button>` : ''}
      ${!last.rows.length ? `<p class="mc3-empty">${emptyText()}</p>` : ''}`;
    $('mc-list').querySelectorAll('[data-open]').forEach((li) => { li.onclick = (e) => { if (e.target.closest('input,label,button')) return; openDetail(li.dataset.open); }; });
    $('mc-list').querySelectorAll('[data-sel]').forEach((c) => { c.onchange = () => toggleSel(c.dataset.sel, c.checked); });
    $('mc-list').querySelectorAll('[data-exp]').forEach((b) => { b.onclick = () => { const k = b.dataset.exp; if (S.expand.has(k)) S.expand.delete(k); else S.expand.add(k); renderList(); }; });
    $('mc-more') && ($('mc-more').onclick = () => { S.shown += PAGE; renderList(); });
    renderAdvCounts();
  }
  function renderAdvCounts() { if (!$('mc-adv').hidden) $('mc-adv').querySelectorAll('[data-fine]').forEach((c) => { const s = c.parentElement.querySelector('.mc3-dim'); if (s) s.textContent = last?.counts.cats[c.dataset.fine] ?? 0; }); }
  function emptyText() {
    if (['visibili', 'accettate', 'storico'].includes(S.tab)) return 'Nessuna registrazione. Apri una missione e usa "L\'HO VISTA NEL MOBIGLAS".';
    if (S.tab === 'possibili' && !region()) return 'Imposta dove sei (in alto) per vedere le missioni possibili nella tua regione.';
    if (S.tab === 'possibili') return 'Nessuna missione di questo tipo offerta nella regione secondo i dati. Prova CATALOGO o un\'altra categoria.';
    return 'Nessuna missione con questi filtri.';
  }

  // ---------------------------------------------------------------- dettaglio su richiesta (pannello laterale)
  function openDetail(key) {
    S.open = key; renderDetail();
    $('mc-list').querySelectorAll('.mc3-row').forEach((x) => x.classList.toggle('open', x.dataset.open === key));
  }
  function closeDetail() { S.open = null; renderDetail(); $('mc-list').querySelectorAll('.mc3-row.open').forEach((x) => x.classList.remove('open')); }
  function layoutDetail(show) {
    const body = $('mc-body'); body.classList.toggle('with-detail', show);
    $('mc-detail').hidden = !show; $('mc-split').hidden = !show;
    body.style.setProperty('--mc-dw', `${Math.max(340, Math.min(900, S.detailW))}px`);
  }
  function roleBlock(label, ops, key, { dropoff = false } = {}) {
    const g = geo(); if (!ops.length) return '';
    const r = roleSummary(ops, g);
    const names = r.names.map((n) => { const p = g.resolveName(n); return { n, sys: p ? SYS[p.system] ?? p.system : '' }; }).sort((a, b) => a.sys.localeCompare(b.sys) || a.n.localeCompare(b.n));
    const unres = ops.flatMap((o) => o.unresolved ?? []);
    let body;
    if (r.kind === 'fisso') body = `<b>${esc(r.text)}</b>${r.slots > 1 ? ` <span class="mc3-dim">(${r.slots} punti)</span>` : ''}`;
    else if (r.kind === 'variabile') body = `<b class="mc3-var">${label} variabile — ${r.n} località possibili</b>${dropoff ? ' · <span class="mc3-warn">DA CONFERMARE NEL MOBIGLAS</span>' : ''}
      <button class="link" data-pool="${key}">${S.poolOpen.has(key) ? 'nascondi' : 'VISUALIZZA POSSIBILITÀ'}</button>
      ${S.poolOpen.has(key) ? `<ul class="mc3-pool">${names.map((x) => `<li>${esc(x.n)} <span class="mc3-dim">${esc(x.sys)}</span></li>`).join('')}</ul>` : ''}`;
    else body = '<span class="mc3-warn">DA CONFERMARE NEL MOBIGLAS</span> <span class="mc3-dim">(luoghi non riconosciuti nei dati)</span>';
    return `<div class="mc3-field"><span class="mc3-k">${label.toUpperCase()}</span><div>${body}${unres.length && adv() ? `<div class="mc3-dim">Nomi non riconosciuti: ${esc(unres.slice(0, 5).join(', '))}${unres.length > 5 ? '…' : ''}</div>` : ''}</div></div>`;
  }
  function renderDetail() {
    const box = $('mc-detail'); const g = geo();
    const key = S.open;
    if (key === '__plan__') { layoutDetail(true); renderReport(); return; }
    if (!key || !g) { layoutDetail(false); box.innerHTML = ''; return; }
    layoutDetail(true);
    const rec = key.startsWith('rec:') ? recordById(key.slice(4)) : null;
    const v = rec ? viewOf(rec.ref.id) : viewOf(key);
    if (!v) { box.innerHTML = `<button class="mc3-close" id="mcd-close" aria-label="Chiudi">✕</button><p class="mc3-warn">${rec ? `Il modello "${esc(rec.ref.title)}" non è nel catalogo attuale (patch diversa?). La tua registrazione resta salvata.` : 'Missione non trovata.'}</p>${rec ? recordActions(rec) : ''}`; $('mcd-close').onclick = closeDetail; bindRecord(rec); return; }
    const R = region(); const gc = geoClass(v, g); const cat = mcCategory(v, g, gc);
    const av = availability(v, { region: R, scope: S.scope, geo: g, profile: store.profile, L: D.L, record: rec });
    const acc = av.access ?? accessCheck(v, store.profile, D.L);
    const fit = shipFit(v, ship()); const k = ship();
    const ops = v.ops ?? []; const picks = ops.filter((o) => o.role === 'pickup'), drops = ops.filter((o) => o.role === 'dropoff');
    const offerNames = (v.offer ?? []).map((o) => (o.id ? g.get(o.id)?.name : o.name)).filter(Boolean);
    const st = STATE_SHORT[av.state];
    const target = firstTarget(v, rec);
    const inAtlas = !!A()?.index?.()?.byId.has(v.id); const atlasSel = new Set(A()?.selection?.() ?? []);
    const recs = store.records.filter((r) => r.ref.id === v.id);
    const stateLine = av.state === 'accessibile' ? (R ? offerText(av.rel?.offer, R) : '') : av.state === 'regione' ? `${R ? `${offerText(av.rel?.offer, R)}. ` : ''}Alcuni requisiti non sono registrati nel PROFILO.`
      : av.state === 'catalogata' ? (R ? 'Nei dati non è offerta nella tua regione.' : 'Imposta la posizione per sapere se è offerta nella tua regione.') : av.state === 'non_accessibile' ? 'Un requisito registrato nel PROFILO non è soddisfatto.' : AVAIL[av.state]?.note ?? '';
    const big = Object.entries(BIG_CATS).find(([, b]) => b.cats.includes(cat));
    box.innerHTML = `<button class="mc3-close" id="mcd-close" aria-label="Chiudi il dettaglio">✕</button>
      <div class="mc3-dhead"><span class="mc3-kind">${esc(big ? big[1].label : MC_CATS[cat]?.label ?? cat)}${cat.startsWith('tr_') ? ` · ${esc(TRIPS[cat]?.label ?? '')}` : ''}</span>
        <h3>${titleHtml(v)}</h3>
        ${v.titleStatus && v.titleStatus !== 'verificato' ? `<p class="mc3-sub">${esc(TITLE_NOTE[v.titleStatus] ?? '')}</p>` : ''}
        <div class="mc3-dsum"><span class="mc3-rew mc3-big">${rewardHtml(v, rec)}</span><span>${esc(v.company ?? v.faction ?? 'fazione non indicata')}</span></div>
        <p>${st ? `<span class="mc3-state ${st.cls}">${esc(st.label)}</span> ` : ''}<span class="mc3-sub">${esc(stateLine)}</span></p></div>
      ${v.description ? `<p class="mc3-desc">${esc(v.description)}</p>` : ''}
      <div class="mc3-field"><span class="mc3-k">REQUISITI</span><div>${acc.checks.length ? `<ul class="mc3-checks">${acc.checks.map((c) => `<li class="${c.ok === false ? 'err' : c.ok ? 'ok' : 'warn'}">${c.ok === false ? '✖' : c.ok ? '✓' : '?'} ${esc(c.note)}</li>`).join('')}</ul>` : 'nessuno nei dati'}</div></div>
      ${roleBlock('Ritiro', picks, 'p')}${roleBlock('Consegna', drops, 'd', { dropoff: true })}${roleBlock('Obiettivo', v.objectives ?? [], 'o')}
      ${!picks.length && !drops.length && !(v.objectives ?? []).length ? '<div class="mc3-field"><span class="mc3-k">LUOGHI</span><div><span class="mc3-warn">DA CONFERMARE NEL MOBIGLAS</span></div></div>' : ''}
      <div class="mc3-field"><span class="mc3-k">CARICO</span><div>${(v.orders ?? []).map((o) => `${esc(o.cargo ?? 'merce n.d.')} ${o.scuMax ? `<b>${o.scuMin && o.scuMin !== o.scuMax ? `${o.scuMin}–` : ''}${o.scuMax} SCU</b>` : '<span class="mc3-dim">quantità non nei dati</span>'}${o.containerMax ? ` · casse fino a ${o.containerMax} SCU` : ''}`).join('<br>') || '<span class="mc3-dim">nessun carico nei dati</span>'}</div></div>
      <div class="mc3-field"><span class="mc3-k">RISCHI</span><div>${[v.risk?.combat ? `combattimento${v.risk.enemies ? ` (fino a ${v.risk.enemies} nemici)` : ''}` : null, v.illegal ? '<span class="err">illegale</span>' : null, v.timeLimit ? `limite ${Math.round(v.timeLimit)} min` : null, v.failCriminal ? 'fallisce se diventi criminale' : null].filter(Boolean).join(' · ') || 'nessun combattimento o illegalità nei dati'}</div></div>
      <div class="mc3-field"><span class="mc3-k">${esc(k.name.replace(/^RSI Constellation Mk V /, '').toUpperCase())}</span><div class="${fit.fit === 'cassa' ? 'err' : fit.fit === 'ok' ? 'ok' : ''}">${esc(fit.note)}${fit.fit !== 'cassa' && fit.cargo.scu ? ' <span class="mc3-dim">(disposizione delle casse nella griglia non verificata)</span>' : ''}</div></div>
      ${recs.length && !rec ? `<div class="mc3-field"><span class="mc3-k">TUE REGISTRAZIONI</span><div>${recs.map((r) => `${esc(STATE_SHORT[r.status].label)} · ${fmtA(r.reward)} <button class="link" data-goto="rec:${esc(r.id)}">apri</button>`).join('<br>')}</div></div>` : ''}
      ${rec ? recordActions(rec) : ''}
      <div class="mc3-actions">
        <button class="primary" id="mcd-sel">${S.sel.includes(key) ? '✓ NELLA SPEDIZIONE' : '＋ AGGIUNGI ALLA SPEDIZIONE'}</button>
        <button id="mcd-route" ${target ? '' : 'disabled title="nessun luogo fisso con posizione: rotta non calcolabile"'}>🛰 CALCOLA ROTTA</button>
        <button id="mcd-map">🗺 MOSTRA SULLA MAPPA</button>
        ${rec ? '' : '<button id="mcd-obs">📝 L\'HO VISTA NEL MOBIGLAS</button>'}
      </div>
      <div id="mcd-out"></div>
      <details class="mc3-more-d" ${adv() ? 'open' : ''}><summary>ALTRE AZIONI</summary><div class="mc3-actions">
        <button id="mcd-plan" ${inAtlas || rec?.contractId ? '' : 'disabled title="nel piano cargo entrano solo trasporti e consegne con ritiro e consegna"'}>${atlasSel.has(v.id) ? '✓ NEL PIANO CARGO (ATLANTE)' : '＋ PIANO CARGO (ATLANTE)'}</button>
        <button id="mcd-rel">⧉ CON QUALI SI RAGGRUPPA?</button></div></details>
      <details class="mc3-tech" ${adv() ? 'open' : ''}><summary>DATI TECNICI</summary><div class="hm-kv">
        <span>Titolo</span><b>${esc(v.titleStatus ?? 'verificato')} · da ${esc(v.titleFrom ?? 'fonte')}${v.titleRaw && v.titleRaw !== v.title ? ` · nelle fonti <span class="mono">${esc(v.titleRaw)}</span>` : ''}</b>
        <span>Nome interno</span><b class="mono">${esc(v.debug ?? 'n.d.')}</b>
        <span>Chiave titolo</span><b class="mono">${esc(v.titleKey ?? 'n.d.')}</b>
        <span>Mission ID</span><b class="mono">${esc(v.uuid ?? v.id)}</b>
        <span>Offer ID</span><b>non nelle fonti (esiste solo nel gioco)</b>
        <span>Tipo nei file</span><b>${esc(v.type ?? 'n.d.')}${v.scope ? ` · ${esc(v.scope)}` : ''}</b>
        <span>Varianti</span><b>${v.variants > 1 ? `${v.variants} (${v.groupHow === 'wiki' ? 'gruppi della Wiki' : 'raggruppamento euristico'})` : 'nessuna'}</b>
        <span>Offerta</span><b>${offerNames.length ? esc(offerNames.slice(0, 12).join(', ')) + (offerNames.length > 12 ? '…' : '') : 'non indicata nei dati'}<br><span class="mc3-dim">dove il contratto può comparire: non è il punto di ritiro</span></b>
        <span>Geografia</span><b>${esc(GEO[gc.cls]?.label ?? gc.cls)}${gc.multi ? ' · MULTI' : ''} · ${esc(gc.note ?? '')}</b>
        <span>Requisiti nei file</span><b>${v.rank ? `grado ${esc(v.rank)}${v.rankMax ? ` (fino a ${esc(v.rankMax)})` : ''} con ${esc(v.company ?? '?')}` : 'nessun grado'}${v.repReq?.faction ? ` · reputazione ${esc(v.repReq.faction)} ${esc(v.repReq.min ?? '')}` : ''}${(v.prereqs ?? []).length ? `<br>${v.prereqs.map((p) => `${p.need > 1 ? `${p.need} fra ` : ''}${esc([...p.missions.map((m) => m.title ?? m.debug ?? '?'), ...p.tags.map((t) => `[tag ${t}]`)].join(', '))}`).join('<br>')}` : ''}</b>
        <span>Condizioni</span><b>${v.shareable ? 'condivisibile' : 'non condivisibile'}${v.onceOnly ? ' · una volta sola' : ''}${v.cooldown ? ` · attesa personale ${Math.round(v.cooldown / 60)} min` : ''}${v.inPrison ? ' · anche in prigione' : ''}</b>
        <span>Fonte</span><b>${esc(v.source ?? 'catalogo')} · ${esc(v.patch ?? '')}</b>
      </div></details>`;
    box.querySelectorAll('[data-pool]').forEach((b) => { b.onclick = () => { const p = b.dataset.pool; if (S.poolOpen.has(p)) S.poolOpen.delete(p); else S.poolOpen.add(p); renderDetail(); }; });
    box.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => { const r = recordById(b.dataset.goto.slice(4)); S.tab = r.status === 'visibile' ? 'visibili' : r.status === 'accettata' ? 'accettate' : 'storico'; S.open = b.dataset.goto; renderList(); renderDetail(); }; });
    $('mcd-close').onclick = closeDetail;
    $('mcd-sel').onclick = () => toggleSel(key, !S.sel.includes(key));
    $('mcd-map').onclick = () => { app.showTab('home'); app.home()?.openMission?.(planView(key)?.id ?? v.id); };
    $('mcd-route').onclick = () => routeTo(target);
    $('mcd-plan').onclick = () => { const pv = planView(key); if (!pv) return; A()?.toggle(pv.id, !atlasSel.has(pv.id)); renderDetail(); app.home()?.show?.(); };
    $('mcd-rel').onclick = () => showRelated(v, key);
    $('mcd-obs') && ($('mcd-obs').onclick = () => registerDialog(v));
    bindRecord(rec);
    box.scrollTop = 0;
  }
  function recordActions(rec) {
    return `<div class="mc-recbox"><p><b>La tua registrazione</b> · ${esc(STATE_SHORT[rec.status].label)}${rec.offerAt ? ` · vista a ${esc(rec.offerAt)}` : ''}${rec.contractId ? ' · con movimenti di carico' : ''}</p>
      ${rec.notes ? `<p class="mc3-sub">${esc(rec.notes)}</p>` : ''}
      <div class="row wrap">${['visibile', 'accettata', 'completata', 'fallita'].filter((s) => s !== rec.status).map((s) => `<button class="small" data-rs="${s}">${esc(STATE_SHORT[s].label)}</button>`).join('')}<button class="small" data-rdel="1">rimuovi</button></div>
      <p class="mc3-sub">ACCETTATA aggiorna solo l'archivio di NAVCOM: il contratto lo accetti nel mobiGlas.</p>
      ${adv() ? `<p class="mc3-dim">Storico: ${rec.history.map((h) => `${esc(h.status)} ${esc(String(h.at).slice(0, 16).replace('T', ' '))}`).join(' → ')}</p>` : ''}</div>`;
  }
  function bindRecord(rec) {
    if (!rec) return;
    $('mc-detail').querySelectorAll('[data-rs]').forEach((b) => { b.onclick = async () => {
      const r = await store.setStatus(rec.id, b.dataset.rs);
      // contratto collegato nella LOGISTICS: stesso stato (accettata / completata / fallita / osservata)
      const db = L()?.db?.();
      if (r.contractId && db) { const c = (await db.contracts()).find((x) => x.id === r.contractId); if (c) { const st = { visibile: 'osservata', accettata: 'accettata', completata: 'completata', fallita: 'fallita' }[r.status]; await db.putContracts([{ ...c, status: st, updatedAt: nowIso(), history: [...(c.history ?? []), { at: nowIso(), status: st, note: 'da MISSION CONTROL' }] }]); await A()?.reloadUser?.(); } }
      S.tab = r.status === 'visibile' ? 'visibili' : r.status === 'accettata' ? 'accettate' : 'storico'; save(); renderList(); renderDetail(); renderPlan();
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
  function planToPlace(t) {
    const pos = state.position;
    app.planTo({ name: t.name, system: t.system, x: t.pos.x, y: t.pos.y, z: t.pos.z, unit: 'm', start: pos && pos.system === t.system && Number.isFinite(pos.x) ? pos : null });
  }
  function routeTo(p) {
    const g = geo(); if (!p || !g) return;
    const r = routeSteps(posFrom(), p, g, links());
    const out = $('mcd-out');
    if (!r.ok) { out.innerHTML = `<p class="mc3-warn">${esc(r.note)}</p>`; return; }
    const first = r.steps[0];
    out.innerHTML = `<h4>Rotta verso ${esc(p.name)}</h4><ol class="mc3-steps">${r.steps.map((s) => `<li>${s.kind === 'salto' ? `SALTO ${esc(s.from.name)} → ${esc(s.to.name)} <span class="mc3-dim">tunnel: durata non nei dati</span>` : `QT ${s.from ? `${esc(s.from.name)} → ` : ''}${esc(s.to.name)}${s.distance ? ` · ${fmtD(s.distance)}` : ''}`}</li>`).join('')}</ol>
      ${r.note ? `<p class="mc3-sub">${esc(r.note)}</p>` : ''}<button id="mcd-go" class="primary">APRI NEL PIANIFICATORE (${esc(first.to.name)})</button>`;
    $('mcd-go').onclick = () => planToPlace(first.to);
  }
  function showRelated(v, key) {
    const out = $('mcd-out'); const g = geo();
    const pool = (last?.rows ?? []).map((r) => r.v).filter((x) => x.id !== v.id);
    const rel = relatedTo(v, pool, g).slice(0, 10);
    out.innerHTML = `<h4>Si raggruppano con questa (elenco attuale)</h4>${rel.length ? `<ul class="mc3-rel">${rel.map((x) => `<li><button class="small" data-add="${esc(x.v.id)}">＋</button> ${titleHtml(x.v)} <span class="mc3-dim">${x.why.map((w) => `${w.sure ? '' : 'forse '}${esc(w.label.toLowerCase())}`).join(' · ')}</span></li>`).join('')}</ul>` : '<p class="mc3-sub">Nessuna missione dell\'elenco condivide luoghi, destinazioni vicine o direzione con questa.</p>'}`;
    out.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => { if (!S.sel.includes(key)) toggleSel(key, true); toggleSel(b.dataset.add, true); b.disabled = true; }; });
  }

  // ---------------------------------------------------------------- registrazione offerta vista nel mobiGlas
  function registerDialog(v) {
    const g = geo(); const dlg = $('mc-dlg');
    const kind = missionKind(v); const cargo = (v.ops ?? []).some((o) => o.role === 'pickup');
    const rows = cargo ? draftMovements(v, g) : [];
    const here = region()?.place?.name ?? '';
    dlg.innerHTML = `<form method="dialog" class="cb-obs"><h3>L'ho vista nel mobiGlas</h3>
      <p class="mc3-sub"><b>${esc(v.title)}</b> · ${esc(v.company ?? '')}. Scrivi i valori che leggi nel gioco: i luoghi variabili restano vuoti finché non li inserisci. Nessuna lettura automatica del gioco.</p>
      <div class="cb-form"><label>Stato <select id="rg-status"><option value="visibile">VISTA NEL MOBIGLAS</option><option value="accettata">ACCETTATA (solo in NAVCOM)</option></select></label>
        <label>Dove l'hai vista <input id="rg-at" list="mc-places" value="${esc(here)}"></label>
        <label>Ricompensa letta (aUEC) <input id="rg-rew" inputmode="numeric" placeholder="${v.rewardInfo?.kind === 'fissa' ? v.rewardInfo.min : 'dal mobiGlas'}"></label></div>
      ${cargo ? `<p class="mc3-sub">Carico: compila SCU, casse e luoghi reali per usarla nel piano. Le righe senza SCU non vengono salvate.</p>${rows.map((r, i) => `<fieldset><legend>Movimento ${i + 1}</legend><div class="cb-form">
        <label>Merce <input id="rg-c${i}" value="${esc(r.cargo)}"></label>
        <label>SCU <input id="rg-s${i}" inputmode="numeric" placeholder="${r.scuRange ? `${r.scuRange[0] ?? '?'}–${r.scuRange[1] ?? '?'}` : ''}"></label>
        <label>Cassa max (SCU) <input id="rg-b${i}" inputmode="numeric" value="${esc(r.containerMax)}"></label>
        <label>Ritiro <input id="rg-f${i}" list="rg-fl${i}" value="${esc(r.from)}" placeholder="${r.fromPool.length > 1 ? `uno fra ${r.fromPool.length}` : ''}"></label>
        <label>Consegna <input id="rg-t${i}" list="rg-tl${i}" value="${esc(r.to)}" placeholder="${r.toPool.length > 1 ? `uno fra ${r.toPool.length}` : ''}"></label></div>
        <datalist id="rg-fl${i}">${r.fromPool.slice(0, 400).map((n) => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="rg-tl${i}">${r.toPool.slice(0, 400).map((n) => `<option value="${esc(n)}">`).join('')}</datalist></fieldset>`).join('')}
        <label class="check"><input type="checkbox" id="rg-plan">aggiungi al piano cargo</label>`
      : `<label>Luogo dell'obiettivo letto nel mobiGlas (facoltativo) <input id="rg-obj" list="mc-places"></label><p class="mc3-sub">${esc(MC_CATS[kind]?.label ?? '')}: nessun movimento di carico.</p>`}
      <label>Screenshot (facoltativo, resta nel browser) <input type="file" id="rg-shot" accept="image/*" multiple></label>
      <p class="mc3-dim">Lettura automatica del testo dagli screenshot (OCR): non disponibile.</p>
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
        $('mc-detail').insertAdjacentHTML('afterbegin', `<p class="ok">Registrata nell'archivio di NAVCOM${status === 'accettata' ? ' come ACCETTATA (il gioco non viene toccato)' : ''}.</p>${warn.length ? `<p class="mc3-warn">Avvisi: ${esc(warn.join(' · '))}</p>` : ''}`);
      } catch (e) { $('rg-msg').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };
  }

  // ---------------------------------------------------------------- 5-6. LA MIA SPEDIZIONE: raggruppa e pianifica (solo su richiesta)
  let lastPlan = null, lastGroups = null;
  function toggleSel(key, on) {
    S.sel = on ? [...new Set([...S.sel, key])] : S.sel.filter((k) => k !== key);
    lastPlan = null; save(); renderPlan();
    $('mc-list').querySelectorAll(`[data-sel="${CSS.escape(key)}"]`).forEach((c) => { c.checked = on; c.closest('.mc3-row')?.classList.toggle('picked', on); });
    if (S.open === key) renderDetail();
    if (S.open === '__plan__') renderDetail();
  }
  function selected() { return S.sel.map((k) => ({ key: k, v: planView(k) })).filter((x) => x.v); }
  function planCtx() {
    const base = A()?.stackCtx?.() ?? {}; const k = ship(); const here = posFrom();
    return { ...base, geo: geo(), links: links(), capacity: k.scu ?? base.capacity, ship: { ...(base.ship ?? {}), name: k.name, scu: k.scu, maxBox: k.maxBox }, start: here?.id ?? base.start ?? null, hideIllegal: false };
  }
  function renderPlan() {
    const box = $('mc-plan'); const list = selected(); const k = ship();
    const missing = S.sel.length - list.length;
    const e = expedition(list.map((x) => x.v), k);
    box.classList.toggle('empty', !list.length);
    box.innerHTML = `<div class="mc3-exp">
      <div class="mc3-exp-t"><b>LA MIA SPEDIZIONE</b> <button class="link" id="mc-exp-list" ${list.length ? '' : 'disabled'}>${S.expList ? '▾' : '▸'} ${list.length} ${list.length === 1 ? 'missione' : 'missioni'}</button></div>
      ${list.length ? `<div class="mc3-exp-n"><span>${e.reward ? `<b>${fmtA(e.reward)}</b>${e.dynamic ? ` <span class="mc3-dim">+ ${e.dynamic} con ricompensa dinamica</span>` : ''}` : `<b>ricompensa dinamica</b> <span class="mc3-dim">(${e.dynamic}: la calcola il gioco)</span>`}</span>
        <span><b>${e.scu} SCU</b> noti${e.scuUnknown ? ` <span class="mc3-dim">(+${e.scuUnknown} senza quantità)</span>` : ''} / ${e.capacity ?? '?'} SCU nave${e.trips > 1 ? ` <span class="mc3-warn">· almeno ${e.trips} viaggi</span>` : ''}</span>
        <span>ritiri noti ${e.pickups.known}/${e.pickups.total} · consegne note ${e.dropoffs.known}/${e.dropoffs.total}</span>
        ${e.incompat.length ? `<span class="mc3-state err" title="${esc(e.incompat.map((x) => `${x.v ? `${x.v.title}: ` : ''}${x.why}`).join('\n'))}">⚠ ${e.incompat.length} ${e.incompat.length === 1 ? 'incompatibilità' : 'incompatibilità'}</span>` : ''}</div>` : '<span class="mc3-dim">Spunta le missioni che ti interessano: qui vedi totale, carico e compatibilità con la nave.</span>'}
      <div class="mc3-exp-a">${adv() ? `<select id="mc-mode" aria-label="Criterio">${Object.entries(MODES).map(([m, x]) => `<option value="${m}" ${S.mode === m ? 'selected' : ''}>${x.label}</option>`).join('')}</select>` : ''}
        <button id="mc-opt" class="primary mc3-big" ${list.length ? '' : 'disabled'}>RAGGRUPPA E PIANIFICA</button>
        <button class="small" id="mc-clear" ${list.length ? '' : 'disabled'}>svuota</button></div></div>
      ${S.expList && list.length ? `<ul class="mc3-chips">${list.map(({ key, v }) => `<li><button class="link" data-o="${esc(key)}">${esc(plainTitle(v))}</button>${key.startsWith('rec:') ? ' <span class="mc3-dim">(tua)</span>' : ''} <button class="small" data-x="${esc(key)}" aria-label="togli">✕</button></li>`).join('')}</ul>` : ''}
      ${missing ? `<p class="mc3-warn">${missing} selezioni non sono più nel catalogo attuale.</p>` : ''}`;
    box.querySelectorAll('[data-o]').forEach((b) => { b.onclick = () => openDetail(b.dataset.o); });
    box.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => toggleSel(b.dataset.x, false); });
    $('mc-exp-list').onclick = () => { S.expList = !S.expList; renderPlan(); };
    $('mc-clear').onclick = () => { S.sel = []; lastPlan = null; save(); renderList(); renderPlan(); if (S.open === '__plan__') closeDetail(); };
    $('mc-mode') && ($('mc-mode').onchange = () => { S.mode = $('mc-mode').value; save(); if (lastPlan) runPlan(); });
    $('mc-opt').onclick = runPlan;
  }
  function runPlan() {
    const list = selected().map((x) => x.v); if (!list.length) return;
    S.open = '__plan__'; layoutDetail(true);
    $('mc-detail').innerHTML = '<p class="mc3-sub">Calcolo in corso…</p>';
    setTimeout(() => { lastGroups = groupSelection(list, geo(), { links: links() }); lastPlan = planSelection(list, planCtx(), S.mode); renderDetail(); }, 20);
  }
  function renderReport() {
    const box = $('mc-detail');
    if (!lastPlan) { box.innerHTML = '<button class="mc3-close" id="mcd-close">✕</button><p class="mc3-sub">La selezione è cambiata: premi di nuovo RAGGRUPPA E PIANIFICA.</p>'; $('mcd-close').onclick = closeDetail; return; }
    const r = planReport(lastPlan, lastGroups, geo()); const s = lastPlan.summary;
    const items = (list) => list.map((x) => `<li><b>${esc(x.place)}</b> <span class="mc3-dim">${esc(SYS[x.system] ?? x.system ?? '')}</span><ul>${x.items.map((i) => `<li>${i.qty} SCU ${esc(i.cargo)}${i.mission ? ` <span class="mc3-dim">· ${esc(i.mission)}</span>` : ''}</li>`).join('')}</ul></li>`).join('');
    box.innerHTML = `<button class="mc3-close" id="mcd-close" aria-label="Chiudi">✕</button>
      <div class="mc3-dhead"><span class="mc3-kind">PIANO DELLA SPEDIZIONE · ${esc(MODES[lastPlan.mode].label)}</span><h3>${r.ok ? 'Itinerario' : 'Nessun itinerario cargo calcolabile'}</h3></div>
      ${r.ok ? `<ol class="mc3-report">
        <li><span class="mc3-k">1 · PRIMA TAPPA</span><div><b>${esc(r.first.place)}</b> <span class="mc3-dim">${esc(SYS[r.first.system] ?? '')}</span> <button class="link" id="mc-firstleg">calcola rotta</button></div></li>
        <li><span class="mc3-k">2 · DA RITIRARE</span><div><ul class="mc3-stops">${items(r.pickups)}</ul></div></li>
        <li><span class="mc3-k">3 · VIAGGIO CONDIVISO</span><div>${r.shared.length ? `<ul>${r.shared.map((g) => `<li>${esc(g.label.toLowerCase())}: <b>${esc(g.where)}</b> ${g.sure ? '' : '<span class="mc3-dim">(possibile, luoghi variabili)</span>'}<br><span class="mc3-dim">${esc(g.missions.join(' · '))}</span></li>`).join('')}</ul>` : 'nessun luogo in comune fra le missioni scelte'}</div></li>
        <li><span class="mc3-k">4 · DA CONSEGNARE</span><div><ul class="mc3-stops">${items(r.deliveries)}</ul></div></li>
        <li><span class="mc3-k">5 · VIAGGI</span><div><b>${r.trips.value ?? 'n.d.'}</b> <span class="mc3-dim">${esc(r.trips.note ?? '')}</span></div></li>
        <li><span class="mc3-k">6 · GUADAGNO</span><div>${r.reward.value ? `<b>${fmtA(r.reward.value)}</b> <span class="mc3-dim">${esc(r.reward.note ?? '')}</span>` : '<b>non calcolabile</b> <span class="mc3-dim">ricompense dinamiche: le calcola il gioco quando genera l\'offerta</span>'}${s.distance.value !== null ? `<br>distanza ${fmtD(s.distance.value)}` : `<br><span class="mc3-dim">${esc(s.distance.note ?? '')}</span>`}${s.time.value !== null ? ` · circa ${Math.round(s.time.value * 60)} min` : ''}</div></li>
      </ol>` : `<p class="mc3-warn">Servono ritiro e consegna fissi e le quantità. Le missioni con luoghi variabili si pianificano solo dopo averle viste nel mobiGlas: aprile e usa "L'HO VISTA NEL MOBIGLAS" per inserire i luoghi reali.</p>`}
      ${r.notCombinable.length ? `<div class="mc3-field"><span class="mc3-k">${r.ok ? '7 · ' : ''}NON COMBINATE</span><div><ul>${r.notCombinable.map((x) => `<li><b>${esc(x.title)}</b><br><span class="mc3-dim">${esc(x.why)}</span>${x.cargo && D.byId.has(x.id) ? ` <button class="link" data-reg="${esc(x.id)}">inserisci i dati letti nel mobiGlas</button>` : ''}</li>`).join('')}</ul></div></div>` : ''}
      ${r.partial.length ? `<p class="mc3-warn">Pianificabili solo in parte (luoghi variabili): ${esc(r.partial.join(' · '))}.</p>` : ''}
      ${r.notes.map((n) => `<p class="mc3-dim">${esc(n)}</p>`).join('')}
      ${r.ok ? `<div class="mc3-actions"><button id="mc-showplan">🗺 PERCORSO SULL'ATLANTE</button><button id="mc-tocargo">＋ TUTTE NEL PIANO CARGO</button></div>` : ''}
      ${!adv() ? `<p class="mc3-dim">Criterio: ${esc(MODES[lastPlan.mode].label)} (gli altri in modalità AVANZATA). Bounty e mercenari restano attività separate.</p>` : ''}
      <details class="mc3-tech" ${adv() ? 'open' : ''}><summary>DETTAGLI DEL CALCOLO</summary>
        ${r.ok ? `<p>Ritiri/consegne ${s.pickups.value}/${s.dropoffs.value} · carico ${s.cargo.value} SCU (${esc(s.cargo.note ?? '')}) · tempo: ${esc(s.time.note ?? '')}</p>${(lastPlan.best.result.warnings ?? []).map((w) => `<p class="mc3-warn">${esc(w)}</p>`).join('')}${(lastPlan.best.result.assumed ?? []).map((w) => `<p class="mc3-dim">Ipotesi: ${esc(w)}</p>`).join('')}` : ''}
        ${lastGroups.pairs.length ? `<p>Coppie cargo: ${lastGroups.pairs.map((p) => `${esc(viewOf(p.a)?.title ?? planView(p.a)?.title ?? p.a)} + ${esc(viewOf(p.b)?.title ?? p.b)} (${p.types.map((t) => `${t.label}${t.sure ? '' : ' possibile'}`).join(', ')})`).join('; ')}</p>` : ''}
        ${lastGroups.isolated.length ? `<p>Richiedono una deviazione: ${esc(lastGroups.isolated.map((x) => x.title).join(', '))}</p>` : ''}
        ${lastGroups.unknown.length ? `<p>Senza luoghi nei dati: ${esc(lastGroups.unknown.map((x) => x.title).join(', '))}</p>` : ''}
      </details>`;
    $('mcd-close').onclick = closeDetail;
    box.querySelectorAll('[data-reg]').forEach((b) => { b.onclick = () => { const v = viewOf(b.dataset.reg); if (v) registerDialog(v); }; });
    $('mc-firstleg') && ($('mc-firstleg').onclick = () => { const p = geo()?.resolveName(r.first.place); const st = lastPlan.summary.itinerary.value[0]; const t = (st && geo()?.get(st.id)) ?? p; if (!t) return; const rs = routeSteps(posFrom(), t, geo(), links()); planToPlace(rs.ok ? rs.steps[0].to : t); });
    $('mc-showplan') && ($('mc-showplan').onclick = () => { A()?.showPlan?.(lastPlan.best.result); app.showTab('atlas'); });
    $('mc-tocargo') && ($('mc-tocargo').onclick = () => { const a = A(); if (!a) return; let n = 0; for (const { v } of selected()) if (a.index?.()?.byId.has(v.id) && a.toggle(v.id, true)) n++; $('mc-tocargo').textContent = `✓ ${n} nel PIANO CARGO`; $('mc-tocargo').disabled = true; app.home()?.show?.(); });
  }

  // ---------------------------------------------------------------- pannelli ridimensionabili
  function bindSplit() {
    const sp = $('mc-split'); let x0 = 0, w0 = 0;
    const move = (e) => { S.detailW = Math.max(340, Math.min(900, w0 + (x0 - e.clientX))); $('mc-body').style.setProperty('--mc-dw', `${S.detailW}px`); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(); };
    sp.onpointerdown = (e) => { x0 = e.clientX; w0 = S.detailW; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); e.preventDefault(); };
    sp.onkeydown = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { S.detailW += e.key === 'ArrowLeft' ? 40 : -40; layoutDetail(true); save(); } };
  }

  // ---------------------------------------------------------------- provenienza (una riga, in fondo)
  function renderProv() {
    const p = provenance(D.res);
    $('mc-prov').innerHTML = p.ok ? `Catalogo: ${esc(p.text)}${p.liveDefault && p.liveDefault !== p.patch ? ` <span class="mc3-warn">· LIVE secondo la Wiki: ${esc(p.liveDefault)}</span>` : ''} · NAVCOM non è collegato al mobiGlas: le offerte reali le registri tu.`
      : `<span class="mc3-warn">${esc(D.res?.warnings?.[0] ?? 'Catalogo missioni in caricamento…')}</span>`;
  }
  function renderAll() { $('tab-control').dataset.ui = S.ui; renderProv(); renderAdv(); renderQuick(); renderList(); renderDetail(); renderPlan(); }

  state.onChange((what) => { if (what === 'position') { S.shown = PAGE; renderList(); if (S.open && S.open !== '__plan__') renderDetail(); } if (what === 'ship') { renderList(); renderDetail(); renderPlan(); } });
  bindSplit();
  renderAll();
  load();

  return {
    show() { if (!D.views.length) load(); else { renderList(); renderPlan(); } },
    /** "MISSIONI DA QUESTA LOCALITA'" / "VERSO": apre il Mission Control sul luogo (o sulla posizione della PLANCIA) */
    async open({ placeId = null, relation = 'da', scope = null } = {}) {
      S.anchor = placeId && placeId !== state.position?.place?.id ? placeId : null;
      S.relation = relation; if (scope) S.scope = scope; S.tab = relation === 'verso' ? 'offerte' : 'possibili'; S.showAll = false; S.shown = PAGE;
      // "verso qui": modelli con consegna/obiettivo nella regione (vista MODELLI DELLA REGIONE); l'avviso in alto lo dichiara
      save(); app.showTab('control'); renderAll();
    },
    nearestPlace: (pos) => nearestPlace(pos),
    /** dopo un ripristino del backup: rilegge registro e profilo dall'archivio */
    async reload() { await store.load(); renderAll(); },
  };
}
