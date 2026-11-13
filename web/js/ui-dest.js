// Interfaccia di DESTINATION INTELLIGENCE. Legge lo snapshot del sito (data/destinations/), lo copia
// nell'archivio del browser per l'uso offline, e collega la scheda al pianificatore QT, all'atlante e al
// DATABASE PUNTI. Le tue annotazioni e i collegamenti confermati stanno in chiavi separate: un
// aggiornamento dei dati non li tocca, e i punti del DATABASE PUNTI non vengono mai modificati da qui.
import { Geo } from './atlas/geo.js';
import { DestIndex, ITEM_CATS, ST, ND } from './dest/model.js';
import { SRC } from './dest/build.js';

const FILES = ['index.json', 'dest.json', 'ships.json', 'market.json'];
const SYS = { '': 'tutti i sistemi', stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const fmtA = (v) => (v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('it-IT')} aUEC`);
const fmtD = (m) => (m === null || m === undefined ? '—' : m < 1e6 ? `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km` : `${(m / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 2 })} Gm`);
const ageDays = (d) => (d ? Math.floor((Date.now() - Date.parse(d)) / 86400000) : null);
const STCLASS = { verificata: 'ok', documentata: 'doc', segnalata: 'rep', ipotetica: 'hyp', sconosciuta: 'unk' };

export async function initDestinations(app) {
  const { $, esc } = app;
  const S = { sys: '', open: null, ship: null, activity: 'trasporto', from: null, shopQ: '', shopCat: '', shopSort: 'nome', page: 0 };
  let ix = null, snap = null, notes = {}, links = {};
  const pdb = () => app.pointsDb?.() ?? null;

  // ---------------------------------------------------------------- dati
  async function fetchSnap(noCache = false) {
    const out = {};
    for (const f of FILES) {
      const r = await fetch(`data/destinations/${f}`, { cache: noCache ? 'no-cache' : 'default' });
      if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
      out[f.replace('.json', '')] = await r.json();
    }
    return out;
  }
  async function geoNow() {
    const g = app.atlasGeo?.();
    if (g?.places?.length) return new Geo(g.places.filter((p) => p.kind !== 'personal'), { meta: g.meta });
    const r = await fetch('data/atlas/geo.json'); if (!r.ok) throw new Error(`geo.json: HTTP ${r.status}`);
    const j = await r.json(); return new Geo(j.places, { meta: j.meta });
  }
  async function personal() { return (await pdb()?.all().catch(() => [])) ?? []; }

  async function load({ refresh = false, imported = null } = {}) {
    const banner = [];
    const db = pdb();
    notes = (await db?.getMeta('destNotes')) ?? {}; links = (await db?.getMeta('destLinks')) ?? {};
    try {
      snap = imported ?? await fetchSnap(refresh);
      if (db) await db.setMeta('destSnapshot', { ...snap, savedAt: new Date().toISOString(), origin: imported ? 'file importato' : 'sito' }).catch((e) => banner.push(`<p class="warn">Copia offline non salvata: ${esc(e.message)}</p>`));
    } catch (e) {
      const cached = await db?.getMeta('destSnapshot');
      if (!cached) { $('di-banner').innerHTML = `<p class="err">Dati delle destinazioni non disponibili (${esc(e.message)}) e nessuna copia offline. Il modulo si attiva dopo la prossima pubblicazione del sito o importando uno snapshot JSON.</p>`; return false; }
      snap = cached; banner.push(`<p class="warn">Sito non raggiungibile (${esc(e.message)}): uso la copia salvata il ${fmtDate(cached.savedAt)} (${esc(cached.origin ?? 'sito')}).</p>`);
    }
    try {
      ix = new DestIndex({ geo: await geoNow(), dest: snap.dest, market: snap.market ?? null, ships: snap.ships?.ships ?? [], personal: await personal(), links });
    } catch (e) { $('di-banner').innerHTML = `<p class="err">Database geografico non disponibile: ${esc(e.message)}</p>`; return false; }
    const src = snap.index?.sources ?? snap.dest?.meta?.sources ?? {};
    const bad = Object.entries(src).filter(([, v]) => !v.ok);
    if (bad.length) banner.push(`<p class="warn">Fonti non aggiornate nell'ultimo snapshot: ${bad.map(([k, v]) => `${esc(k)} (${esc(v.error)}${v.reused ? `, riuso dati del ${fmtDate(v.reused)}` : ', nessun dato'})`).join(' · ')}.</p>`);
    $('di-banner').innerHTML = banner.join('');
    renderSources(); fillShips();
    return true;
  }

  // ---------------------------------------------------------------- ricerca
  function renderResults() {
    const q = $('di-q').value;
    const res = ix ? ix.search(q, { system: S.sys || null, limit: 25 }) : [];
    $('di-results').innerHTML = !q.trim() ? '<p class="hint">Scrivi un nome: sistema, pianeta, luna, stazione, città, avamposto, POI o un tuo punto. Anche abbreviazioni (NB, A18) e numeri romani (Pyro 1 = Pyro I).</p>'
      : res.length ? res.map((r) => `<button class="di-res" data-id="${esc(r.id)}"><b>${esc(r.name)}</b>${r.homonyms ? ' <span class="di-pill warn">omonimo</span>' : ''}${r.hidden ? ' <span class="di-pill unk">nascosto sulla starmap</span>' : ''}<br><span class="hint">${esc(r.systemLabel)}${r.body ? ` › ${esc(r.body)}` : ''} · ${esc(r.kindLabel)}${r.hasXyz ? '' : ' · senza XYZ'}</span></button>`).join('')
        : '<p class="hint">Nessuna destinazione con questo nome nei dati.</p>';
    $('di-results').querySelectorAll('.di-res').forEach((b) => { b.onclick = () => open(b.dataset.id); });
  }

  // ---------------------------------------------------------------- scheda
  const stPill = (f) => `<span class="di-pill ${STCLASS[f.status] ?? 'unk'}" title="${esc(ST[f.status] ?? f.status)}">${esc(f.status === 'sconosciuta' ? (f.display === 'DA VERIFICARE' ? 'da verificare' : 'n.d.') : f.status)}</span>`;
  const val = (f) => (f.value !== null ? esc(f.value) : `<span class="di-nd">${esc(f.display ?? ND)}</span>`);
  const srcCell = (f) => (f.sourceLabel ? `${esc(f.sourceLabel)}${f.version ? ` · ${esc(f.version)}` : ''}${f.date ? ` · ${fmtDate(f.date)}` : ''}${f.dynamic ? ' · dinamico' : ''}` : '—');
  const ftable = (rows) => `<div class="tablewrap di-tw"><table class="di-t"><thead><tr><th>Campo</th><th>Valore</th><th>Stato</th><th>Fonte · versione · data</th></tr></thead><tbody>${rows.map((f) => `<tr><td>${esc(f.label)}</td><td>${val(f)}${f.note ? `<div class="hint">${esc(f.note)}</div>` : ''}</td><td>${stPill(f)}</td><td class="hint">${srcCell(f)}</td></tr>`).join('')}</tbody></table></div>`;

  function tiles(c) {
    const get = (arr, k) => (arr ?? []).find((f) => f.key === k);
    const br = get(c.env.exterior, 'breath'); const helmet = get(c.env.survival, 'helmet');
    const tmin = get(c.env.exterior, 'tmin'), tmax = get(c.env.exterior, 'tmax');
    const arm = c.security.find((f) => (f.key === 'arm' || f.key === 'armU') && f.value !== null);
    const svc = Object.fromEntries((c.services ?? []).map((r) => [r.key, r]));
    const has = (k) => (svc[k]?.values ?? []).some((v) => v.value && !/assente|non segnalato/.test(v.value));
    const known = (k) => (svc[k]?.values ?? []).some((v) => v.value !== null);
    const yn = (k) => (has(k) ? ['sì', 'good'] : known(k) ? ['non risulta', 'dim'] : ['n.d.', 'dim']);
    const shops = ix.market ? ix.shopsOf(c)?.length ?? 0 : null; const trade = ix.market ? ix.tradeOf(c)?.length ?? 0 : null;
    const T = [
      ['Aria esterna', br?.value === 'sì' ? ['respirabile', 'good'] : br?.value === 'no' ? ['NON respirabile', 'bad'] : c.env.space ? ['spazio', 'dim'] : ['n.d.', 'dim']],
      ['Casco', helmet?.value ? [helmet.value.split(' ')[0] === 'necessario' ? 'necessario' : helmet.value.slice(0, 18), helmet.status === 'documentata' ? 'bad' : 'warn'] : ['da verificare', 'dim']],
      ['Temperature', tmin?.value || tmax?.value ? [`${tmin?.value ?? '?'} / ${tmax?.value ?? '?'}`, 'neutral'] : ['n.d.', 'dim']],
      ['Armistizio', arm ? [arm.value, arm.value === 'sì' ? 'good' : 'warn'] : ['sconosciuto', 'dim']],
      ['Hangar / pad', has('hangar') || has('pad') ? ['sì', 'good'] : ['n.d.', 'dim']],
      ['Carburante', has('h2') || has('qt') ? ['segnalato', 'good'] : ['n.d.', 'dim']],
      ['Medico', yn('medical')],
      ['Negozi', shops === null ? ['…', 'dim'] : [`${shops} articoli`, shops ? 'good' : 'dim']],
      ['Merci', trade === null ? ['…', 'dim'] : [`${trade} prezzi`, trade ? 'good' : 'dim']],
    ];
    return `<div class="di-tiles">${T.map(([l, [v, cl]]) => `<div class="di-tile ${cl}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
  }

  function open(id, { scroll = true } = {}) {
    if (!ix) return;
    const c = ix.card(id);
    if (!c) { $('di-card').innerHTML = `<p class="err">Destinazione non trovata nei dati attuali (${esc(id)}).</p>`; return; }
    S.open = id; S.page = 0;
    const d = c.desc;
    const canRoute = !!c.xyz;
    const note = notes[id];
    $('di-card').innerHTML = `
      <div class="di-head">
        <div><h2 class="di-title">${esc(c.title)}</h2>
          <div class="hint">${esc(d.systemLabel)}${d.body ? ` › ${esc(d.body)}` : ''} · ${esc(d.kindLabel)}${d.path ? ` · ${esc(d.path)}` : ''}</div>
          ${d.homonyms ? `<p class="warn">Esistono ${d.homonyms} destinazioni con lo stesso nome: controlla sistema e corpo celeste.</p>` : ''}
          <div class="hint">${esc(c.ctx.note)}</div></div>
        <div class="di-actions">
          <button id="di-route" ${canRoute ? '' : 'disabled'} title="${canRoute ? 'Apre il pianificatore con queste coordinate' : 'Nessuna coordinata XYZ di sistema: NAVCOM non la genera'}">🧭 CALCOLA ROTTA</button>
          ${c.place ? '<button id="di-atlas" class="small">🌌 Apri nell\'atlante</button>' : ''}
          ${c.personal && c.personal.id !== '__xyz' ? '<button id="di-db" class="small">🗂 Apri nel DATABASE PUNTI</button>' : ''}
          ${app.home && c.id !== 'pt:__xyz' ? `<button id="di-setdest" class="small" title="Imposta come destinazione della PLANCIA">🎯 Imposta destinazione</button>
          <button id="di-fav" class="small" title="Preferiti della PLANCIA">${app.home.isFav(c.id) ? '★ preferito' : '☆ preferito'}</button>
          <button id="di-visit" class="small" title="Registra una visita solo se ci sei stato davvero">✓ Segna come visitata</button>` : ''}
        </div>
      </div>
      ${!canRoute ? `<p class="hint">CALCOLA ROTTA non disponibile: ${c.personal ? 'il punto non ha XYZ di sistema (le coordinate planetarie non vengono convertite)' : 'la destinazione non ha coordinate XYZ di sistema nei dati'}.</p>` : ''}
      ${c.candidates?.length ? `<div class="warn">Questo luogo UEX non è abbinato con certezza alla starmap del gioco (${esc(ix.uexLocs[c.linkKey]?.candidatesWhy ?? 'nessuna corrispondenza')}). Se lo riconosci, conferma: ${c.candidates.map((x) => `<button class="small di-link" data-to="${esc(x.id)}">è ${esc(x.name)} (${esc(x.systemLabel)}${x.body ? ` › ${esc(x.body)}` : ''})</button>`).join(' ')}</div>` : ''}
      ${tiles(c)}
      ${app.home?.lastVisit(c.id) ? `<p class="hint">Ultima visita segnata da te: ${fmtDate(app.home.lastVisit(c.id).at)}</p>` : ''}
      ${c.description ? `<details class="di-sec"><summary>Descrizione del gioco</summary><p class="hint">${esc(c.description)}</p><p class="hint">Testo dei file di gioco: non è stato usato per ricavare servizi o condizioni.</p></details>` : ''}
      ${c.own ? `<details class="di-sec" open><summary>Il tuo punto</summary>${ftable(c.own)}</details>` : ''}
      <details class="di-sec" open><summary>2 · Ambiente e sopravvivenza</summary>
        ${c.env.exterior.length ? `<h3>Ambiente esterno del corpo${c.env.context.body ? ` · ${esc(c.env.context.body.name)}` : ''}</h3>${ftable(c.env.exterior)}` : `<p class="hint">${esc(c.env.exteriorNote ?? 'Nessun corpo celeste di riferimento: ambiente esterno non applicabile.')}</p>`}
        ${c.env.interior ? `<h3>Ambiente interno (struttura pressurizzata)</h3>${ftable(c.env.interior)}` : ''}
        ${c.env.space ? `<h3>Posizione nello spazio</h3>${ftable(c.env.space)}` : ''}
        <h3>Sopravvivenza</h3>${ftable(c.env.survival)}
      </details>
      <details class="di-sec" open><summary>2 · Sicurezza e rischi</summary>${ftable(c.security)}
        <p class="warn">Nessun pericolo documentato non significa località sicura. Armistizio e livello di sicurezza sono campi indipendenti.</p></details>
      <details class="di-sec"><summary>3 · Hangar, atterraggi e servizi</summary>${servicesHtml(c)}</details>
      ${structHtml(c)}
      <details class="di-sec" id="di-shops-sec"><summary>4 · Negozi e articoli (${ix.market ? ix.shopsOf(c).length : '…'})</summary><div id="di-shops"></div></details>
      <details class="di-sec" id="di-trade-sec"><summary>5 · Commercio: cosa compro e vendo qui (${ix.market ? ix.tradeOf(c).length : '…'})</summary><div id="di-trade"></div></details>
      <details class="di-sec"><summary>6 · Mining, esplorazione e risorse</summary>${miningHtml(c)}</details>
      <details class="di-sec" id="di-exp-sec"><summary>7 · Prepara spedizione</summary>${expeditionForm()}<div id="di-exp-out"></div></details>
      <details class="di-sec"><summary>8 · Collegamento al pianificatore QT e dintorni</summary>${qtHtml(c)}</details>
      <details class="di-sec"><summary>Dati mancanti (${c.missing.length})</summary><p class="hint">${c.missing.map((x) => `${esc(x.label)}: ${esc(x.display)}`).join(' · ') || 'nessuno'}</p></details>
      <details class="di-sec"><summary>Le tue annotazioni</summary>
        <textarea id="di-note" rows="3" placeholder="note personali su questa destinazione (restano nel browser, gli aggiornamenti non le toccano)">${esc(note?.text ?? '')}</textarea>
        <button id="di-note-save" class="small">Salva nota</button> <span class="hint" id="di-note-msg">${note ? `salvata il ${fmtDate(note.at)}` : ''}</span></details>`;
    bindCard(c);
    app.onOpen?.(destOf(c));
    if (scroll) $('di-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const destOf = (c) => ({ id: c.id, name: c.title, system: c.place?.system ?? c.desc.system ?? null, pos: c.xyz ? { x: c.xyz.x, y: c.xyz.y, z: c.xyz.z } : null, kind: c.desc.kindLabel });

  /** Struttura della localita': SCHEMATICA, mai una planimetria. Aree = nomi dei terminali UEX. */
  function structHtml(c) {
    if (!c.place) return '';
    const st = ix.structure(c.place.id); if (!st) return '';
    const nTerm = st.areas.reduce((n, a) => n + a.terms.length, 0);
    if (!st.children.length && !nTerm) return '';
    const kids = st.children.filter((k) => !k.hidden);
    return `<details class="di-sec" id="di-struct-sec"><summary>3b · Struttura e negozi <span class="di-schem">vista schematica</span> (${kids.length} luoghi interni · ${nTerm} terminali)</summary>
      <p class="warn">${esc(st.mapNote)}</p>
      ${kids.length ? `<h3>Luoghi collegati nella starmap del gioco</h3><div class="di-struct">${kids.map((k) => `<div style="padding-left:${(k.depth - 1) * 18}px"><button class="small di-go" data-id="${esc(k.id)}">${esc(k.name)}</button> <span class="hint">${esc(k.kindLabel)}${k.services.length ? ` · ${esc(k.services.slice(0, 6).join(', '))}` : ''}</span></div>`).join('')}</div>` : ''}
      ${nTerm ? `<h3>Aree e negozi dichiarati nei nomi dei terminali (UEX)</h3>${st.areas.map((a) => `<div class="di-struct"><h4>${esc(a.area)}</h4>${a.terms.map((t) => `<span class="di-term"><button class="small di-shop" data-term="${esc(t.id)}">${esc(t.shop)}</button><span class="hint">${esc(t.typeLabel)}${t.items ? ` · ${t.items} articoli` : ''}${t.commodities ? ` · ${t.commodities} merci` : ''}</span></span>`).join('')}</div>`).join('')}
        <p class="hint">L'ordine non rappresenta la disposizione reale. Piani, fermate della metropolitana e percorsi interni: NON DOCUMENTATI. Il pianificatore QT non si usa all'interno delle località.</p>` : ''}
    </details>`;
  }

  /** Scheda negozio/terminale. Posizione interna mai inventata. */
  function openShop(termId) {
    const sh = ix?.shop(termId);
    if (!sh) { $('di-card').innerHTML = `<p class="err">Negozio non trovato nei dati attuali (${esc(termId)}).</p>`; return; }
    S.open = `shop:${termId}`;
    const f = Object.entries(sh.flags ?? {}).filter(([, v]) => v).map(([k]) => k.replace(/^(has|is)_/, '').replace(/_/g, ' '));
    $('di-card').innerHTML = `
      <div class="di-head"><div><h2 class="di-title">${esc(sh.name)}</h2>
        <div class="hint">${esc(sh.typeLabel ?? '')} · ${sh.place ? `${esc(sh.place.name)} · ${esc(sh.place.systemLabel)}` : 'luogo non abbinato alla starmap'}${sh.company ? ` · ${esc(sh.company)}` : ''}</div>
        <div class="hint">Nome completo UEX: ${esc(sh.fullName)}</div></div>
        <div class="di-actions">${sh.place ? `<button id="di-shop-place" class="small">📚 Scheda di ${esc(sh.place.name)}</button><button id="di-shop-map" class="small" title="L'atlante mostra il luogo che contiene il negozio, non il negozio">🌌 MOSTRA SULLA MAPPA</button>` : ''}</div></div>
      <div class="hm-kv"><span>Area dichiarata</span><b>${sh.area ? `${esc(sh.area)} <span class="hint">(dal nome del terminale)</span>` : '<span class="di-nd">non indicata</span>'}</b>
        <span>Posizione interna</span><b><span class="di-nd">POSIZIONE INTERNA NON DOCUMENTATA</span></b>
        <span>Piano</span><b><span class="di-nd">NON DOCUMENTATO</span></b>
        <span>Caratteristiche segnalate</span><b>${f.length ? esc(f.join(', ')) : '—'}${sh.maxContainer ? ` · casse fino a ${sh.maxContainer} SCU` : ''}</b>
        <span>Fonte</span><b>UEX Corp (community)${sh.version ? ` · ${esc(sh.version)}` : ''}${sh.modified ? ` · ${fmtDate(sh.modified)}` : ''}</b></div>
      <p class="hint">MOSTRA SULLA MAPPA porta al luogo (${esc(sh.place?.name ?? '—')}): nessuna fonte con licenza di riuso dà la posizione del negozio all'interno.</p>
      ${sh.items.length ? `<h3>Articoli segnalati (${sh.items.length})</h3><p class="warn">Catalogo segnalato dalla community: non è disponibilità in tempo reale.</p>
        <div class="tablewrap di-tw tall"><table class="di-t"><thead><tr><th>Articolo</th><th>Categoria</th><th>Compra</th><th>Vende</th><th>Data</th></tr></thead><tbody>${sh.items.map((r) => `<tr><td>${esc(r.item)}</td><td class="hint">${esc(r.cat)}</td><td>${fmtA(r.buy)}</td><td>${fmtA(r.sell)}</td><td class="hint">${fmtDate(r.date)}${ageDays(r.date) > 60 ? ' <span class="di-pill warn">vecchia</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${sh.commodities.length ? `<h3>Merci (${sh.commodities.length})</h3><div class="tablewrap di-tw tall"><table class="di-t"><thead><tr><th>Merce</th><th>Compri a</th><th>Vendi a</th><th>Data</th></tr></thead><tbody>${sh.commodities.map((r) => `<tr><td>${esc(r.commodity)}</td><td>${fmtA(r.buy)}</td><td>${fmtA(r.sell)}</td><td class="hint">${fmtDate(r.date)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${!sh.items.length && !sh.commodities.length ? '<p class="hint">Nessun prezzo segnalato per questo terminale.</p>' : ''}`;
    $('di-shop-place') && ($('di-shop-place').onclick = () => open(sh.place.id));
    $('di-shop-map') && ($('di-shop-map').onclick = () => app.openAtlas?.(sh.place.id));
    $('di-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function servicesHtml(c) {
    if (!c.services.length) return '<p class="hint">Nessun servizio associabile: un punto personale o arbitrario non eredita i servizi delle strutture vicine (vedi sezione 8 per le distanze).</p>';
    return `<p class="hint">Hangar, landing pad, docking port e cargo elevator sono servizi diversi. Un pad non garantisce che la tua nave ci stia. Un terminale commerciale non implica gli altri servizi.</p>
      <div class="tablewrap di-tw"><table class="di-t"><thead><tr><th>Servizio</th><th>Valori per fonte</th></tr></thead><tbody>${c.services.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<div class="hint">${esc(r.note)}</div>` : ''}</td><td>${r.values.map((v) => `<div>${v.label !== '—' ? `<span class="hint">${esc(v.label)}:</span> ` : ''}${val(v)} ${v.value !== null ? stPill(v) : ''}${v.date ? ` <span class="hint">${fmtDate(v.date)}</span>` : ''}${v.note ? `<div class="hint">${esc(v.note)}</div>` : ''}</div>`).join('')}</td></tr>`).join('')}</tbody></table></div>
      ${c.terminals.length ? `<h3>Terminali segnalati (${c.terminals.length})</h3><p class="hint">${c.terminals.map((t) => `${esc(t.name)} <span class="di-pill rep">${esc(t.type ?? '?')}</span>`).join(' · ')}</p>` : ''}`;
  }

  function renderShops(c) {
    const box = $('di-shops'); if (!box) return;
    if (!ix.market) { box.innerHTML = '<p class="hint">Prezzi non caricati.</p>'; return; }
    // i filtri si costruiscono una volta sola: ridisegnarli a ogni tasto riportava il cursore all'inizio
    if (!$('di-shop-list')) {
      box.innerHTML = `<p class="warn">Catalogo segnalato dalla community (UEX): un articolo in elenco NON è garantito disponibile adesso. Ogni prezzo ha la data della segnalazione.</p>
      <div class="row wrap di-filters"><input id="di-shop-q" placeholder="filtra articolo" value="${esc(S.shopQ)}">
      <select id="di-shop-cat"><option value="">tutte le categorie</option>${ITEM_CATS.map(([k, l]) => `<option value="${k}" ${S.shopCat === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select id="di-shop-sort">${['nome', 'prezzo', 'categoria', 'data'].map((k) => `<option ${S.shopSort === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
      <div id="di-shop-list"></div>`;
      $('di-shop-q').oninput = () => { S.shopQ = $('di-shop-q').value; S.page = 0; renderShops(c); };
      $('di-shop-cat').onchange = () => { S.shopCat = $('di-shop-cat').value; S.page = 0; renderShops(c); };
      $('di-shop-sort').onchange = () => { S.shopSort = $('di-shop-sort').value; renderShops(c); };
    }
    const rows = ix.shopsOf(c, { q: S.shopQ, cat: S.shopCat, sort: S.shopSort });
    const per = 150; const shown = rows.slice(0, (S.page + 1) * per);
    $('di-shop-list').innerHTML = rows.length ? `<div class="tablewrap di-tw tall"><table class="di-t"><thead><tr><th>Articolo</th><th>Categoria</th><th>Compra</th><th>Vende</th><th>Negozio</th><th>Data · versione</th></tr></thead><tbody>${shown.map((r) => `<tr><td>${esc(r.item)}</td><td class="hint">${esc(r.cat)}${r.uexCat ? `<br>${esc(r.uexCat)}` : ''}</td><td>${fmtA(r.buy)}</td><td>${fmtA(r.sell)}</td><td>${esc(r.terminal)}</td><td class="hint">${fmtDate(r.date)}${ageDays(r.date) > 60 ? ' <span class="di-pill warn">vecchia</span>' : ''}${r.version ? ` · ${esc(r.version)}` : ''}</td></tr>`).join('')}</tbody></table></div>
        ${rows.length > shown.length ? `<button id="di-shop-more" class="small">Mostra altri (${rows.length - shown.length})</button>` : ''}` : '<p class="hint">Nessun articolo segnalato ai terminali di questa destinazione con questi filtri.</p>';
    $('di-shop-more') && ($('di-shop-more').onclick = () => { S.page++; renderShops(c); });
  }

  function renderTrade(c) {
    const box = $('di-trade'); if (!box) return;
    const rows = ix.tradeOf(c);
    if (!rows) { box.innerHTML = '<p class="hint">Prezzi non caricati.</p>'; return; }
    box.innerHTML = rows.length ? `<p class="warn">Prezzi crowdsourced (UEX), non garantiti: controlla la data.</p>
      <div class="tablewrap di-tw tall"><table class="di-t"><thead><tr><th>Merce</th><th>Qui la compri a</th><th>Qui la vendi a</th><th>Stock / domanda (SCU)</th><th>Casse</th><th>Terminale</th><th>Data</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.commodity)}${r.illegal ? ' <span class="di-pill bad">illegale</span>' : ''}</td><td>${fmtA(r.buy)}</td><td>${fmtA(r.sell)}</td><td>${r.stock ?? '—'} / ${r.demand ?? '—'}</td><td class="hint">${esc(r.containers ?? (r.maxContainer ? `max ${r.maxContainer}` : '—'))}${r.freightElevator ? ' · elevator' : ''}${r.autoLoad ? ' · autoload' : ''}</td><td class="hint">${esc(r.terminal)}</td><td class="hint">${fmtDate(r.date)}${ageDays(r.date) > 30 ? ' <span class="di-pill warn">vecchia</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">Nessun prezzo di merci segnalato ai terminali di questa destinazione.</p>';
  }

  function miningHtml(c) {
    const m = c.mining; const parts = [];
    const groups = (list, title) => (list?.length ? `<h3>${esc(title)}</h3>${list.flatMap((e) => e.groups).map((g) => `<p><b>${esc(g.label)}</b>: ${g.materials.map((x) => `${esc(x.name)}${x.tiers.length ? ` <span class="hint">(${esc(x.tiers.join('/'))})</span>` : ''}`).join(', ')}</p>`).join('')}` : '');
    if (m) {
      parts.push(`<p class="warn">${esc(m.note)}.</p>`);
      parts.push(groups(m.own, 'In questa zona (file di gioco)'));
      if (m.regional) parts.push(groups(m.regional, `Sul corpo ${m.regionalBody?.name ?? ''} (zona più ampia, non questo punto preciso)`));
      if (m.refineries?.length) parts.push(`<h3>Raffinerie documentate nel sistema</h3><p>${m.refineries.slice(0, 6).map((r) => `<button class="small di-go" data-id="${esc(r.id)}">${esc(r.name)}</button> <span class="hint">${fmtD(r.d)} in linea retta · ${esc(r.source)}</span>`).join('<br>')}</p>`);
    } else parts.push('<p class="hint">Nessuna tabella di generazione delle risorse associata a questa destinazione.</p>');
    if (c.personalNear?.length) parts.push(`<h3>Tue segnalazioni vicine (DATABASE PUNTI)</h3><p>${c.personalNear.map((p) => `<button class="small di-go" data-id="${esc(p.id)}">${esc(p.name)}</button> <span class="hint">${p.d !== null ? fmtD(p.d) : 'stesso corpo'} · ${esc(p.status)}${p.resource ? ` · ${esc(p.resource)}` : ''}${p.sperimentale ? ' · sperimentale finché non lo verifichi' : ''}</span>`).join('<br>')}</p>`);
    return parts.join('');
  }

  function qtHtml(c) {
    const parts = [];
    if (c.xyz) parts.push(`<p>XYZ di sistema: ${['x', 'y', 'z'].map((k) => `${k.toUpperCase()} ${(c.xyz[k] / 1000).toLocaleString('it-IT', { maximumFractionDigits: 3 })} km`).join(' · ')}${c.xyz.frame ? ` <span class="hint">(${esc(c.xyz.frame)})</span>` : ''}</p><p class="hint">${c.qtValid ? 'Marker QT nei dati: bersaglio quantum diretto.' : 'Nessun marker QT nei dati: il pianificatore calcola un punto di uscita da un marker vicino.'}</p>`);
    else parts.push('<p class="hint">Nessuna XYZ di sistema: niente calcolo di rotta. NAVCOM non genera coordinate.</p>');
    const near = c.nearby ?? (c.xyz && c.place ? ix.nearby(c.xyz, c.place.system, { excludeId: c.id }) : []);
    if (near.length) parts.push(`<h3>Strutture documentate più vicine</h3><p class="hint">Distanze reali in linea retta. I loro servizi NON valgono per questa destinazione.</p><p>${near.map((n) => `<button class="small di-go" data-id="${esc(n.id)}">${esc(n.name)}</button> <span class="hint">${esc(n.kindLabel)} · ${fmtD(n.d)}${n.services.length ? ` · servizi propri: ${esc(n.services.slice(0, 6).join(', '))}` : ''}</span>`).join('<br>')}</p>`);
    return parts.join('');
  }

  function expeditionForm() {
    return `<div class="row wrap di-filters">
      <label>Nave<input id="di-ship" list="di-ships" placeholder="es. Constellation Mk V Centaurus" value="${esc(S.ship ?? '')}"></label>
      <label>Attività<select id="di-act">${[['trasporto', 'Trasporto merci'], ['mining_nave', 'Mining con nave'], ['mining_veicolo', 'Mining con veicolo'], ['mining_fps', 'Mining a piedi'], ['esplorazione', 'Esplorazione']].map(([k, l]) => `<option value="${k}" ${S.activity === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Partenza (facoltativa)<input id="di-from" list="di-places" placeholder="es. Port Tressler" value="${esc(S.from ? ix.geo.get(S.from)?.name ?? '' : '')}"></label>
      <button id="di-exp-go">PREPARA SPEDIZIONE</button></div>`;
  }

  function runExpedition(c) {
    const ship = ix.ships.find((s) => s.name === $('di-ship').value) ?? ix.ships.find((s) => s.name.toLowerCase().includes($('di-ship').value.trim().toLowerCase()) && $('di-ship').value.trim()) ?? null;
    S.ship = ship?.name ?? $('di-ship').value; S.activity = $('di-act').value;
    const fq = $('di-from').value.trim(); const from = fq ? ix.search(fq, { limit: 1 }).find((r) => r.origin === 'geo') : null; S.from = from?.id ?? null;
    const r = ix.prepare(c, ship, { activity: S.activity, fromId: S.from });
    const MAXM = 10;
    const more = r.missing.length > MAXM ? r.missing.length - MAXM : 0; r.missing = r.missing.slice(0, MAXM);
    if (more) r.missing.push({ text: `… e altri ${more} campi: vedi "Dati mancanti" nella scheda`, source: null });
    const list = (arr) => (arr.length ? `<ul>${arr.map((x) => `<li>${esc(x.text)}${x.source ? ` <span class="hint">· ${esc(x.source)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="hint">—</p>');
    $('di-exp-out').innerHTML = `${ship ? '' : `<p class="warn">Nave "${esc($('di-ship').value)}" non trovata nei file di gioco: checklist senza dati della nave.</p>`}${fq && !from ? `<p class="warn">Partenza "${esc(fq)}" non riconosciuta.</p>` : ''}
      <div class="di-exp"><div><h3>Requisiti e dati documentati</h3>${list(r.documented)}</div><div><h3>Consigli operativi</h3>${list(r.advice)}</div><div><h3>Dati mancanti da verificare</h3>${list(r.missing)}</div></div>
      <p class="hint">Nessuna attrezzatura è dichiarata obbligatoria senza una fonte. I consigli derivano dall'assenza di servizi documentati, non da una verifica sul posto.</p>`;
  }

  function bindCard(c) {
    $('di-route') && ($('di-route').onclick = () => app.planTo?.({ name: c.title, system: c.place?.system ?? c.desc.system, x: c.xyz.x, y: c.xyz.y, z: c.xyz.z, unit: 'm' }));
    $('di-atlas') && ($('di-atlas').onclick = () => app.openAtlas?.(c.place.id));
    $('di-db') && ($('di-db').onclick = () => app.showTab('db'));
    $('di-setdest') && ($('di-setdest').onclick = async () => { await app.home.setDestination({ ...destOf(c), via: 'destinazioni' }); $('di-setdest').textContent = '🎯 destinazione impostata'; });
    $('di-fav') && ($('di-fav').onclick = async () => { await app.home.toggleFav(destOf(c)); $('di-fav').textContent = app.home.isFav(c.id) ? '★ preferito' : '☆ preferito'; });
    $('di-visit') && ($('di-visit').onclick = async () => { if (!confirm(`Registrare che hai visitato "${c.title}" adesso?`)) return; await app.home.markVisited(destOf(c)); $('di-visit').textContent = '✓ visita registrata'; });
    $('di-card').querySelectorAll('.di-shop').forEach((b) => { b.onclick = () => openShop(b.dataset.term); });
    $('di-card').querySelectorAll('.di-go').forEach((b) => { b.onclick = () => open(b.dataset.id); });
    $('di-card').querySelectorAll('.di-link').forEach((b) => { b.onclick = async () => {
      const to = ix.geo.get(b.dataset.to);
      if (!confirm(`Collegare "${c.title}" (UEX) a "${to?.name}" della starmap? Servizi e prezzi UEX verranno mostrati nella scheda di ${to?.name}. Puoi annullare dalla sezione Dati.`)) return;
      links[c.linkKey] = b.dataset.to; await pdb()?.setMeta('destLinks', links); await load(); open(b.dataset.to);
    }; });
    $('di-note-save').onclick = async () => {
      const text = $('di-note').value.trim();
      if (text) notes[c.id] = { text, at: new Date().toISOString(), title: c.title }; else delete notes[c.id];
      try { await pdb()?.setMeta('destNotes', notes); $('di-note-msg').textContent = text ? 'salvata' : 'nota cancellata'; } catch (e) { $('di-note-msg').textContent = `non salvata: ${e.message}`; }
    };
    const ss = $('di-shops-sec'); ss.ontoggle = () => { if (ss.open) renderShops(c); };
    const ts = $('di-trade-sec'); ts.ontoggle = () => { if (ts.open) renderTrade(c); };
    $('di-exp-go').onclick = () => runExpedition(c);
  }

  // ---------------------------------------------------------------- articoli e vendita
  function runItem() {
    const q = $('di-item').value.trim(); if (!ix?.market) return;
    const rows = ix.findItem(q, { system: S.sys || null }) ?? [];
    $('di-tool-out').innerHTML = `<h2>Cerca articolo: ${esc(q)}</h2><p class="warn">Vendita segnalata dalla community (UEX) alla data indicata: non è disponibilità in tempo reale.</p>
      ${rows.length ? `<div class="tablewrap di-tw tall"><table class="di-t"><thead><tr><th>Articolo</th><th>Prezzo</th><th>Negozio</th><th>Destinazione</th><th>Data</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.item)}<div class="hint">${esc(r.cat)}</div></td><td>${fmtA(r.buy)}</td><td>${esc(r.terminal)}</td><td>${r.place ? `<button class="small di-go" data-id="${esc(r.place)}">${esc(r.placeName)}</button>` : '<span class="hint">non abbinato</span>'} <span class="hint">${esc(SYS[r.system] ?? r.system)}</span></td><td class="hint">${fmtDate(r.date)}${ageDays(r.date) > 60 ? ' <span class="di-pill warn">vecchia</span>' : ''}</td><td>${r.place && ix.geo.get(r.place)?.pos ? `<button class="small di-reach" data-id="${esc(r.place)}">RAGGIUNGI DESTINAZIONE</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="hint">Nessuna vendita segnalata per "${esc(q)}"${S.sys ? ` in ${SYS[S.sys]}` : ''}.</p>`}`;
    bindTool();
  }
  function runSell() {
    const q = $('di-sell').value.trim(); const scu = +$('di-sell-scu').value || null;
    const fq = $('di-sell-from').value.trim(); const from = fq ? ix.search(fq, { limit: 1 }).find((r) => r.origin === 'geo') : null;
    const res = ix.whereToSell(q, { scu, from: from?.id ?? null, system: S.sys || null });
    if (!res) return;
    $('di-tool-out').innerHTML = `<h2>Dove posso vendere: ${esc(q)}${scu ? ` · ${scu} SCU` : ''}</h2>
      ${fq && !from ? `<p class="warn">Posizione "${esc(fq)}" non riconosciuta: nessun confronto di distanza.</p>` : ''}
      <p class="warn">${esc(res.note)}. Merci trovate: ${res.commodities.map((c) => esc(c.name)).join(', ') || 'nessuna'}.</p>
      ${res.rows.length ? `<div class="tablewrap di-tw tall"><table class="di-t"><thead><tr><th>Terminale</th><th>Prezzo</th>${scu ? '<th>Totale</th>' : ''}<th>Domanda</th><th>Casse</th>${from ? '<th>Distanza</th>' : ''}<th>Data</th><th></th></tr></thead><tbody>${res.rows.map((r) => `<tr><td>${esc(r.terminal)}<div class="hint">${r.place ? esc(r.placeName) : 'non abbinato'} · ${esc(SYS[r.system] ?? r.system)}${r.illegal ? ' · <b>illegale</b>' : ''}</div></td><td>${fmtA(r.sell)}</td>${scu ? `<td>${fmtA(r.total)}</td>` : ''}<td class="hint">${esc(r.demandNote)}</td><td class="hint">${esc(r.boxNote)}${r.freightElevator ? ' · elevator' : ''}${r.autoLoad ? ' · autoload' : ''}</td>${from ? `<td>${r.distance !== null ? fmtD(r.distance) : `<span class="hint">${esc(r.distNote ?? '—')}</span>`}</td>` : ''}<td class="hint">${fmtDate(r.date)}</td><td>${r.place ? `<button class="small di-go" data-id="${esc(r.place)}">scheda</button>` : ''}${r.place && ix.geo.get(r.place)?.pos ? ` <button class="small di-reach" data-id="${esc(r.place)}">RAGGIUNGI</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Nessun terminale segnalato che la acquisti.</p>'}`;
    bindTool();
  }
  function bindTool() {
    $('di-tool-out').querySelectorAll('.di-go').forEach((b) => { b.onclick = () => open(b.dataset.id); });
    $('di-tool-out').querySelectorAll('.di-reach').forEach((b) => { b.onclick = () => { const p = ix.geo.get(b.dataset.id); app.planTo?.({ name: p.name, system: p.system, x: p.pos.x, y: p.pos.y, z: p.pos.z, unit: 'm' }); }; });
  }

  // ---------------------------------------------------------------- fonti e aggiornamenti
  function renderSources() {
    const src = snap?.index?.sources ?? snap?.dest?.meta?.sources ?? {};
    const lab = { scu: SRC.scu.label, sm: 'starmap.space: ambiente dei corpi', smPois: 'starmap.space: POI (armistizio, no-fly…)', uex: SRC.uex.label };
    $('di-sources').innerHTML = `<p class="hint">Snapshot del ${fmtDate(snap?.index?.generatedAt ?? snap?.dest?.meta?.generatedAt)}${snap?.savedAt ? ` · copia locale del ${fmtDate(snap.savedAt)}` : ''} · patch ${esc(snap?.dest?.meta?.patch ?? 'n.d.')}</p>
      <ul class="di-src">${Object.entries(src).map(([k, v]) => `<li><b>${esc(lab[k] ?? k)}</b>: ${v.ok ? `<span class="ok">aggiornata ${fmtDate(v.at)}</span>` : `<span class="err">non aggiornata</span> <span class="hint">(${esc(v.error)}${v.reused ? `; dati del ${fmtDate(v.reused)}` : '; nessun dato'})</span>`}</li>`).join('')}</ul>
      <p class="hint">Annotazioni: ${Object.keys(notes).length} · collegamenti confermati: ${Object.keys(links).length}${Object.keys(links).length ? ' <button id="di-unlink" class="small">annulla tutti i collegamenti</button>' : ''}</p>`;
    $('di-unlink') && ($('di-unlink').onclick = async () => { if (!confirm('Annullare tutti i collegamenti UEX confermati da te?')) return; links = {}; await pdb()?.setMeta('destLinks', links); await load(); });
    const dl = $('di-places'); if (dl && ix) dl.innerHTML = ix.geo.places.filter((p) => !p.hidden && p.pos && ['station', 'city', 'outpost', 'gateway', 'planet', 'moon'].includes(p.kind)).map((p) => `<option value="${esc(p.name)}">`).join('');
  }
  function fillShips() { const dl = $('di-ships'); if (dl && ix) dl.innerHTML = ix.ships.map((s) => `<option value="${esc(s.name)}">`).join(''); }

  // ---------------------------------------------------------------- avvio
  $('di-q').oninput = renderResults;
  $('di-q').onkeydown = (e) => { if (e.key === 'Enter') { const b = $('di-results').querySelector('.di-res'); if (b) b.click(); } };
  $('di-sys').onchange = () => { S.sys = $('di-sys').value; renderResults(); };
  $('di-item-go').onclick = runItem; $('di-item').onkeydown = (e) => { if (e.key === 'Enter') runItem(); };
  $('di-sell-go').onclick = runSell;
  $('di-refresh').onclick = async () => { $('di-refresh').disabled = true; await load({ refresh: true }); $('di-refresh').disabled = false; if (S.open) open(S.open, { scroll: false }); };
  $('di-import').onchange = async () => {
    const f = $('di-import').files?.[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const imported = j.dest && j.index ? j : j.uex && j.game ? { ...snap, dest: j, index: j.meta } : j.itemPrices ? { ...snap, market: j } : null;
      if (!imported) throw new Error('il file non è uno snapshot di DESTINATION INTELLIGENCE (dest.json, market.json o export completo)');
      await load({ imported }); $('di-banner').insertAdjacentHTML('afterbegin', '<p class="ok">Snapshot importato. Annotazioni, collegamenti e DATABASE PUNTI invariati.</p>');
    } catch (e) { $('di-banner').innerHTML = `<p class="err">Import non riuscito: ${esc(e.message)}. Nessun dato è stato modificato.</p>`; }
    $('di-import').value = '';
  };
  $('di-export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ index: snap?.index, dest: snap?.dest, ships: snap?.ships, market: snap?.market })], { type: 'application/json' }));
    a.download = `navcom-destinazioni-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  pdb()?.onChange?.(async () => { if (ix) { ix.setPersonal(await personal()); if (S.open?.startsWith('pt:')) open(S.open, { scroll: false }); } });

  let ready = null; let follow = null; // ultimo luogo scelto nell'ATLANTE, aperto quando si entra nella scheda
  const ensure = () => (ready ??= load());
  return {
    ensure,
    index: () => ix,
    async openShop(termId) { follow = null; await ensure(); if (!ix) return; app.showTab('dest'); openShop(termId); },
    async runItem(q) { await ensure(); if (!ix) return; app.showTab('dest'); $('di-item').value = q; runItem(); $('di-tool-out').scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    async runSell(q) { await ensure(); if (!ix) return; app.showTab('dest'); $('di-sell').value = q; runSell(); $('di-tool-out').scrollIntoView({ block: 'start', behavior: 'smooth' }); },
    follow(id) { follow = String(id).startsWith('personal:') ? `pt:${String(id).slice(9)}` : id; },
    async show() { await ensure(); if (!ix || !follow) return; const id = follow; follow = null; if (id !== S.open) open(id); },
    async open(id) { follow = null; await ensure(); if (!ix) return; app.showTab('dest'); if (id.startsWith('personal:')) id = `pt:${id.slice(9)}`; open(id); },
    /** Dal pianificatore: nome noto -> scheda; altrimenti scheda del punto XYZ arbitrario. */
    async openPoint({ name, system, x, y, z, unit }) {
      follow = null; await ensure(); if (!ix) return; app.showTab('dest');
      const k = unit === 'm' ? 1 : 1000; const pos = { x: +x * k, y: +y * k, z: +z * k };
      const hit = name ? ix.search(name, { system, limit: 3 }).find((r) => r.name.toLowerCase() === String(name).toLowerCase()) : null;
      if (hit) return open(hit.id);
      ix.personal.set('pt:__xyz', { rec: { id: '__xyz', name: name || 'Punto XYZ dal pianificatore', system, status: 'Da verificare', category: 'Altro', notes: 'punto temporaneo: non salvato nel DATABASE PUNTI' }, system, pos });
      open('pt:__xyz');
    },
  };
}
