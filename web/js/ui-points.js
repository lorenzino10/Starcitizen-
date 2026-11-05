// Interfaccia del DATABASE PUNTI. I punti li crea solo l'utente: inserimento manuale,
// import Excel/JSON, coordinate gia' scritte nel pianificatore. NAVCOM non genera destinazioni.
import {
  CATEGORIES, FIELDS, STATUSES, SYSTEMS, backupJson, exportRows, findDuplicates, filterPoints, fmtDate,
  guessMapping, isComplete, normalizePoint, nowIso, parseBackup, planImport, plausibility, rowsToCandidates, toMeters,
} from './core/points.js';
import { parseShowLocation } from './core/instructions.js';
import { PointsDB, requestPersistence } from './data/pointsdb.js';
import { readXlsx, writeXlsx } from './data/xlsx.js';
import { setPersonalPoints } from './planner.js';

const fmtCoord = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('it-IT', { maximumFractionDigits: 3 }));

function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function initPointsDb(app) {
  const { $, esc, store } = app;
  // Pagina e script di versioni diverse (cache del browser dopo un aggiornamento): meglio dirlo
  // subito che fallire in silenzio a meta' di un import.
  const REQUIRED = ['db-table', 'db-wizard', 'db-xlsx', 'db-group', 'db-priority', 'db-sourceref', 'db-f-group', 'db-f-priority', 'db-count', 'db-form-msg'];
  const missing = REQUIRED.filter((id) => !$(id));
  if (missing.length) {
    const banner = $('db-banner') ?? $('db-table');
    if (banner) banner.innerHTML = '<div class="err"><b>Pagina non aggiornata del tutto</b>: il browser sta usando file di versioni diverse. Ricarica con <b>Ctrl+F5</b> (o chiudi e riapri la scheda) e riprova. Nessun punto è stato modificato.</div>';
    throw new Error(`DATABASE PUNTI: elementi mancanti nella pagina (${missing.join(', ')}): ricarica con Ctrl+F5`);
  }
  const db = await PointsDB.open();
  let points = [];
  let byId = new Map();
  const MAX_ROWS = 400; // righe mostrate insieme: oltre, si restringe con ricerca e filtri
  let selected = new Set();
  let wizard = null;

  // ------------------------------------------------------------ archivio e banner
  const persisted = db.persistent ? await requestPersistence() : null;
  $('db-storage-note').innerHTML = `I punti restano <b>solo in questo browser su questo dispositivo</b> (IndexedDB), anche dopo la chiusura o il riavvio.
    Si perdono se cancelli i dati del sito o usi la navigazione privata: esporta regolarmente il JSON come backup.
    ${persisted === true ? 'Il browser ha concesso l\'archiviazione persistente (non verrà svuotata automaticamente).' : persisted === false ? 'Il browser non ha concesso l\'archiviazione persistente: in caso di spazio scarso potrebbe svuotarla. Il backup è ancora più importante.' : ''}`;
  if (db.warning) $('db-banner').innerHTML = `<div class="warn">${esc(db.warning)}</div>`;

  // migrazione dei punti personali della versione precedente (localStorage, metri)
  try {
    const n = await db.migrateLegacy(store.data.customPoints ?? []);
    if (n) $('db-banner').insertAdjacentHTML('beforeend', `<div class="ok">${n} punti personali della versione precedente sono stati trasferiti nel DATABASE PUNTI (categoria "Punto personale", stato "Da verificare").</div>`);
  } catch (e) { $('db-banner').insertAdjacentHTML('beforeend', `<div class="err">Migrazione dei punti precedenti non riuscita: ${esc(e.message)}</div>`); }

  async function reload() {
    points = await db.all();
    const ids = new Set(points.map((p) => p.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    setPersonalPoints(points.map((p) => ({ id: p.id, name: p.name, system: p.system, pos: toMeters(p) })));
    renderTable();
    byId = new Map(points.map((p) => [p.id, p]));
    $('db-resources').innerHTML = [...new Set(points.map((p) => p.resource).filter(Boolean))].sort().map((r) => `<option value="${esc(r)}">`).join('');
    const groups = [...new Set(points.map((p) => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
    $('db-groups').innerHTML = groups.map((g) => `<option value="${esc(g)}">`).join('');
    const gSel = $('db-f-group'), gCur = gSel.value;
    gSel.innerHTML = `<option value="">tutte le classificazioni</option>${groups.map((g) => `<option ${g === gCur ? 'selected' : ''}>${esc(g)}</option>`).join('')}`;
  }
  db.onChange(async () => { await reload(); app.onChange?.(); });

  // ------------------------------------------------------------ modulo
  const opt = (list, empty) => (empty ? `<option value="">${esc(empty)}</option>` : '') + list.map((c) => `<option>${esc(c)}</option>`).join('');
  $('db-category').innerHTML = opt(CATEGORIES); $('db-category').value = 'Punto personale';
  $('db-status').innerHTML = opt(STATUSES);
  $('db-f-category').innerHTML = opt(CATEGORIES, 'tutte le categorie');
  $('db-f-status').innerHTML = opt(STATUSES, 'tutti gli stati');
  const unitVal = () => document.querySelector('input[name="db-unit"]:checked').value;
  const setUnit = (u) => { document.querySelector(`input[name="db-unit"][value="${u}"]`).checked = true; };
  let draftSource = 'manuale';

  function fillForm(p) {
    $('db-id').value = p?.id ?? '';
    $('db-name').value = p?.name ?? '';
    $('db-system').value = p?.system ?? app.system();
    setUnit(p?.unit ?? 'km');
    for (const k of ['x', 'y', 'z']) $(`db-${k}`).value = p?.[k] ?? '';
    $('db-category').value = p?.category ?? 'Punto personale';
    $('db-resource').value = p?.resource ?? '';
    $('db-status').value = p?.status ?? 'Da verificare';
    $('db-verified').value = p?.verifiedAt ? p.verifiedAt.slice(0, 10) : '';
    $('db-notes').value = p?.notes ?? '';
    $('db-group').value = p?.group ?? '';
    $('db-priority').value = p?.priority ?? '';
    $('db-sourceref').value = p?.sourceRef ?? '';
    $('db-paste').value = '';
    $('db-form-title').textContent = p?.id ? `Modifica: ${p.name}` : 'Nuovo punto';
    $('db-cancel').hidden = !p?.id;
    draftSource = p?.source ?? 'manuale';
  }

  $('db-paste').addEventListener('input', () => {
    const c = parseShowLocation($('db-paste').value);
    if (!c) return;
    setUnit('m'); $('db-x').value = c.x; $('db-y').value = c.y; $('db-z').value = c.z;
  });
  $('db-cancel').onclick = () => { fillForm(null); $('db-form-msg').innerHTML = ''; };

  $('db-save').onclick = async () => {
    const msg = $('db-form-msg');
    const id = $('db-id').value;
    const old = id ? points.find((p) => p.id === id) : null;
    const r = normalizePoint({
      id: id || undefined, name: $('db-name').value, system: $('db-system').value, unit: unitVal(),
      x: $('db-x').value, y: $('db-y').value, z: $('db-z').value, category: $('db-category').value, resource: $('db-resource').value,
      status: $('db-status').value, notes: $('db-notes').value, verifiedAt: $('db-verified').value || null,
      group: $('db-group').value, priority: $('db-priority').value, sourceRef: $('db-sourceref').value,
      createdAt: old?.createdAt, source: old?.source ?? draftSource,
    });
    if (!r.point) { msg.innerHTML = `<span class="err">${esc(r.errors.join('; '))}</span>`; return; }
    const p = r.point;
    if (p.status === 'Verificato' && !p.verifiedAt) p.verifiedAt = nowIso(); // verifica appena dichiarata
    const dup = points.find((e) => e.id !== p.id && e.system === p.system && (e.name.trim().toLowerCase() === p.name.toLowerCase()));
    if (old) { // campi non presenti nel modulo restano invariati
      for (const k of ['legacyId']) if (old[k] !== undefined) p[k] = old[k];
    }
    const warn = [...r.warnings, ...plausibility(p, rMax(p.system)), ...(dup ? [`esiste già un punto chiamato "${dup.name}" in ${SYSTEMS[p.system]}`] : [])];
    try { await db.put(p); } catch (e) { msg.innerHTML = `<span class="err">${esc(e.message)}</span>`; return; }
    msg.innerHTML = `<span class="ok">Punto "${esc(p.name)}" ${old ? 'aggiornato' : 'salvato'}.</span>${warn.map((w) => `<br><span class="warn">⚠ ${esc(w)}</span>`).join('')}`;
    fillForm(null);
  };

  function rMax(sys) {
    let r = 0;
    for (const l of store.locations(sys)) r = Math.max(r, Math.hypot(l.x, l.y, l.z));
    return r || null;
  }

  // ------------------------------------------------------------ tabella
  const criteria = () => ({ q: $('db-q').value, system: $('db-f-system').value, category: $('db-f-category').value, resource: $('db-f-resource').value, status: $('db-f-status').value, group: $('db-f-group').value, priority: $('db-f-priority').value, completeOnly: $('db-f-complete').checked });
  for (const id of ['db-q', 'db-f-resource']) $(id).addEventListener('input', renderTable);
  for (const id of ['db-f-system', 'db-f-category', 'db-f-status', 'db-f-group', 'db-f-priority', 'db-f-complete']) $(id).addEventListener('change', renderTable);

  function renderTable() {
    const list = filterPoints(points, criteria());
    $('db-count').textContent = `${list.length} di ${points.length} punti${selected.size ? ` · ${selected.size} selezionati` : ''}`;
    if (!points.length) {
      $('db-table').innerHTML = '<p class="hint">Database vuoto. Inserisci un punto a sinistra, importa un file Excel o salva le coordinate dal PIANIFICATORE.</p>';
      return;
    }
    const allSel = list.length && list.every((p) => selected.has(p.id));
    const shown = list.slice(0, MAX_ROWS);
    const rows = shown.map((p) => {
      const ok = isComplete(p);
      return `<tr data-id="${esc(p.id)}" class="${selected.has(p.id) ? 'sel' : ''}">
        <td><input type="checkbox" class="db-sel" ${selected.has(p.id) ? 'checked' : ''} aria-label="seleziona"></td>
        <td><b>${esc(p.name)}</b>${p.notes ? `<br><span class="hint">${esc(p.notes.slice(0, 80))}${p.notes.length > 80 ? '…' : ''}</span>` : ''}</td>
        <td>${esc(SYSTEMS[p.system] ?? p.system)}</td>
        <td class="num">${fmtCoord(p.x)}</td><td class="num">${fmtCoord(p.y)}</td><td class="num">${fmtCoord(p.z)}</td><td>${esc(p.unit)}</td>
        <td>${esc(p.category)}</td><td>${esc(p.group ?? '')}</td><td>${esc(p.priority ?? '')}</td><td>${esc(p.resource)}</td><td>${esc(p.status)}</td>
        <td>${esc(fmtDate(p.createdAt).slice(0, 10))}</td><td>${esc(fmtDate(p.verifiedAt).slice(0, 10))}</td>
        <td class="actions"><button class="small primary db-route" ${ok ? '' : 'disabled title="Scheda incompleta: servono X, Y e Z"'}>🛰 CALCOLA ROTTA</button>
          <button class="small db-edit">Modifica</button><button class="small danger db-del">Elimina</button></td></tr>`;
    }).join('');
    $('db-table').innerHTML = `<div class="tablewrap tall"><table><thead><tr><th><input type="checkbox" id="db-sel-all" ${allSel ? 'checked' : ''} aria-label="seleziona tutti"></th>
      <th>Nome</th><th>Sistema</th><th class="num">X</th><th class="num">Y</th><th class="num">Z</th><th>Unità</th><th>Categoria</th><th>Classificazione</th><th>Priorità</th><th>Risorsa</th><th>Stato</th><th>Inserito</th><th>Verificato</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="15" class="hint">Nessun punto con questi filtri.</td></tr>'}</tbody></table></div>
      ${list.length > shown.length ? `<p class="hint">Mostrati i primi ${shown.length} di ${list.length}: usa ricerca e filtri per restringere. "Seleziona tutti" vale per tutti i ${list.length} punti filtrati.</p>` : ''}`;
    $('db-sel-all').onchange = (e) => { for (const p of list) e.target.checked ? selected.add(p.id) : selected.delete(p.id); renderTable(); };
    $('db-table').querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      const p = byId.get(tr.dataset.id);
      tr.querySelector('.db-sel').onchange = (e) => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); renderTable(); };
      tr.querySelector('.db-route').onclick = () => app.planTo(p);
      tr.querySelector('.db-edit').onclick = () => { fillForm(p); $('db-form-msg').innerHTML = ''; $('db-name').focus(); $('db-name').scrollIntoView({ block: 'center' }); };
      tr.querySelector('.db-del').onclick = async () => { if (confirm(`Eliminare definitivamente "${p.name}"?`)) { await db.delete(p.id); selected.delete(p.id); } };
    });
  }

  $('db-del-sel').onclick = async () => {
    const ids = [...selected];
    if (!ids.length) { alert('Nessun punto selezionato.'); return; }
    if (!confirm(`Eliminare definitivamente ${ids.length} punti selezionati?`)) return;
    await db.deleteMany(ids);
    selected.clear();
    renderTable();
  };

  $('db-dups').onclick = () => {
    const groups = findDuplicates(points);
    const out = $('db-dups-out');
    if (!groups.length) { out.innerHTML = '<p class="ok">Nessun duplicato: nomi e coordinate sono tutti distinti per sistema.</p>'; return; }
    out.innerHTML = `<div class="navbox warn"><b>${groups.length} gruppi di possibili duplicati</b> (stesso sistema con coordinate entro 1 m, oppure stesso nome).
      Seleziona quelli da eliminare con le caselle nella tabella.<ul>${groups.map((g) => `<li>${g.reason === 'coordinate' ? 'stesse coordinate' : 'stesso nome'}: ${g.ids.map((id) => esc(byId.get(id)?.name)).join(' · ')}
      <button class="small" data-ids="${esc(g.ids.slice(1).join(','))}">seleziona i doppioni</button></li>`).join('')}</ul></div>`;
    out.querySelectorAll('button[data-ids]').forEach((b) => { b.onclick = () => { for (const id of b.dataset.ids.split(',')) selected.add(id); renderTable(); }; });
  };

  // ------------------------------------------------------------ export, backup, ripristino
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('db-export-xlsx').onclick = () => download(`navcom-punti-${stamp()}.xlsx`, writeXlsx(exportRows(points), 'Punti NAVCOM'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  $('db-export-json').onclick = () => download(`navcom-punti-${stamp()}.json`, backupJson(points), 'application/json');
  $('db-restore').onchange = async () => {
    const f = $('db-restore').files?.[0];
    $('db-restore').value = '';
    if (!f) return;
    const msg = $('db-form-msg');
    try {
      const list = parseBackup(await f.text());
      const ok = [], bad = [];
      list.forEach((raw, i) => {
        const r = normalizePoint({ ...raw, verifiedAt: raw.verifiedAt, createdAt: raw.createdAt });
        if (r.point) { r.point.updatedAt = raw.updatedAt ?? r.point.updatedAt; ok.push(r.point); } else bad.push(`#${i + 1}: ${r.errors.join(', ')}`);
      });
      const mode = document.querySelector('input[name="db-restore-mode"]:checked').value;
      if (mode === 'replace' && !confirm(`Sostituire tutti i ${points.length} punti attuali con i ${ok.length} del backup?`)) return;
      if (mode === 'replace') await db.replaceAll(ok); else await db.putMany(ok);
      msg.innerHTML = `<span class="ok">Ripristino completato: ${ok.length} punti ${mode === 'replace' ? '(database sostituito)' : '(uniti per ID)'}.</span>${bad.length ? `<br><span class="err">${bad.length} schede scartate: ${esc(bad.slice(0, 5).join('; '))}${bad.length > 5 ? '…' : ''}</span>` : ''}`;
    } catch (e) { msg.innerHTML = `<span class="err">Ripristino non riuscito: ${esc(e.message)}</span>`; }
  };

  // ------------------------------------------------------------ import Excel
  $('db-xlsx').onchange = async () => {
    const f = $('db-xlsx').files?.[0];
    $('db-xlsx').value = '';
    if (!f) return;
    try {
      const wb = await readXlsx(await f.arrayBuffer());
      wizard = { file: f.name, wb, sheet: 0, header: 0, mapping: null, defaultUnit: '', defaultSystem: '', onDuplicate: 'ignore', keepIncomplete: true, plan: null, result: null };
      initSheet();
      renderWizard();
      app.showTab('db');
      $('db-wizard').scrollIntoView({ block: 'start' });
    } catch (e) { $('db-wizard').innerHTML = `<p class="err">Impossibile leggere "${esc(f.name)}": ${esc(e.message)}</p>`; }
  };

  function initSheet() {
    const rows = wizard.wb.sheets[wizard.sheet].rows;
    wizard.header = Math.max(0, rows.findIndex((r) => r && r.some((v) => v !== null && v !== '')));
    wizard.mapping = guessMapping((rows[wizard.header] ?? []).map((v) => String(v ?? '')));
    wizard.plan = null; wizard.result = null;
  }

  function candidates() {
    const rows = wizard.wb.sheets[wizard.sheet].rows;
    const rMaxBySystem = Object.fromEntries(Object.keys(SYSTEMS).map((s) => [s, rMax(s)]));
    return rowsToCandidates(rows.slice(wizard.header + 1), wizard.mapping, {
      firstRowNo: wizard.header + 2, defaultUnit: wizard.defaultUnit || null, defaultSystem: wizard.defaultSystem || null,
      source: `excel: ${wizard.file}`, rMaxBySystem,
    });
  }

  function renderWizard() {
    const W = wizard, el = $('db-wizard');
    if (!W) { el.innerHTML = ''; return; }
    const sheet = W.wb.sheets[W.sheet];
    const headers = sheet.rows[W.header] ?? [];
    const ncol = Math.max(headers.length, ...sheet.rows.slice(W.header, W.header + 50).map((r) => r?.length ?? 0));
    const colLabel = (i) => `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}: ${headers[i] ?? ''}`;
    const preview = sheet.rows.slice(W.header + 1, W.header + 11);
    const cell = (v) => esc(v === null || v === undefined ? '' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDate(v) : v);
    el.innerHTML = `<div class="navbox"><h3>IMPORTAZIONE EXCEL · ${esc(W.file)}</h3>
      <div class="row">
        <label>Foglio<select id="wz-sheet">${W.wb.sheets.map((s, i) => `<option value="${i}" ${i === W.sheet ? 'selected' : ''}>${esc(s.name)} (${s.rows.length} righe)</option>`).join('')}</select></label>
        <label>Riga di intestazione<input type="number" id="wz-header" min="1" value="${W.header + 1}"></label>
      </div>
      <h3>Anteprima (prime ${preview.length} righe)</h3>
      <div class="tablewrap"><table><thead><tr>${Array.from({ length: ncol }, (_, i) => `<th>${esc(colLabel(i))}</th>`).join('')}</tr></thead>
        <tbody>${preview.map((r) => `<tr>${Array.from({ length: ncol }, (_, i) => `<td>${cell(r?.[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <h3>Associazione delle colonne</h3>
      <div class="mapgrid">${FIELDS.map((f) => `<label>${esc(f.label)}<select data-field="${f.key}"><option value="">— non importare —</option>
        ${Array.from({ length: ncol }, (_, i) => `<option value="${i}" ${W.mapping[f.key] === i ? 'selected' : ''}>${esc(colLabel(i))}</option>`).join('')}</select></label>`).join('')}</div>
      <div class="row">
        <label>Unità se la cella è vuota<select id="wz-unit"><option value="">nessuna (errore)</option><option value="km" ${W.defaultUnit === 'km' ? 'selected' : ''}>km</option><option value="m" ${W.defaultUnit === 'm' ? 'selected' : ''}>m</option></select></label>
        <label>Sistema se la cella è vuota<select id="wz-system"><option value="">nessuno (errore)</option>${Object.entries(SYSTEMS).map(([k, v]) => `<option value="${k}" ${W.defaultSystem === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Duplicati<select id="wz-dup"><option value="ignore" ${W.onDuplicate === 'ignore' ? 'selected' : ''}>ignora (mantieni i punti esistenti)</option><option value="update" ${W.onDuplicate === 'update' ? 'selected' : ''}>aggiorna i punti esistenti</option></select></label>
      </div>
      <label class="check"><input type="checkbox" id="wz-incomplete" ${W.keepIncomplete ? 'checked' : ''}> Conserva le righe con coordinate incomplete come schede incomplete</label>
      <div class="row"><button id="wz-check">🔍 Controlla</button><button id="wz-import" class="primary">📥 Importa</button><button id="wz-close">Chiudi</button></div>
      <div id="wz-out">${W.result ?? (W.plan ? planHtml(W.plan) : '<p class="hint">Controlla le associazioni e premi "Controlla": niente viene salvato finché non premi "Importa".</p>')}</div></div>`;
    $('wz-sheet').onchange = () => { W.sheet = +$('wz-sheet').value; initSheet(); renderWizard(); };
    $('wz-header').onchange = () => { W.header = Math.max(0, (+$('wz-header').value || 1) - 1); W.mapping = guessMapping((sheet.rows[W.header] ?? []).map((v) => String(v ?? ''))); W.plan = null; W.result = null; renderWizard(); };
    el.querySelectorAll('select[data-field]').forEach((s) => { s.onchange = () => { s.value === '' ? delete W.mapping[s.dataset.field] : (W.mapping[s.dataset.field] = +s.value); W.plan = null; W.result = null; renderWizard(); }; });
    $('wz-unit').onchange = () => { W.defaultUnit = $('wz-unit').value; W.plan = null; W.result = null; renderWizard(); };
    $('wz-system').onchange = () => { W.defaultSystem = $('wz-system').value; W.plan = null; W.result = null; renderWizard(); };
    $('wz-dup').onchange = () => { W.onDuplicate = $('wz-dup').value; W.plan = null; W.result = null; renderWizard(); };
    $('wz-incomplete').onchange = () => { W.keepIncomplete = $('wz-incomplete').checked; W.plan = null; W.result = null; renderWizard(); };
    $('wz-close').onclick = () => { wizard = null; renderWizard(); };
    const check = () => {
      const missing = ['name', 'x', 'y', 'z'].filter((k) => W.mapping[k] === undefined);
      const cands = candidates();
      W.cands = cands;
      W.plan = planImport(cands, points, { onDuplicate: W.onDuplicate, keepIncomplete: W.keepIncomplete });
      W.plan.missingCols = missing;
      W.result = null;
    };
    $('wz-check').onclick = () => { check(); renderWizard(); };
    $('wz-import').onclick = async () => {
      if (!W.plan) check(); // "Importa" senza "Controlla": stesso controllo, poi salvataggio
      const P = W.plan;
      if (!P.insert.length && !P.update.length) {
        W.result = `<p class="warn"><b>Nessun punto da salvare.</b> ${P.skipped.length ? `${P.skipped.length} righe sono duplicati di punti già presenti (scegli "aggiorna i punti esistenti" per sovrascriverli) o escluse.` : ''} ${P.errors.length ? `${P.errors.length} righe hanno errori.` : ''} ${P.missingCols?.length ? 'Controlla l\'associazione delle colonne.' : ''}</p>${planHtml(P, true)}`;
        W.plan = null; renderWizard(); return;
      }
      try {
        await db.putMany([...P.insert, ...P.update.map((u) => u.after)]);
        W.result = `<p class="ok"><b>Importazione completata.</b> Nuovi: ${P.insert.length} (di cui incompleti: ${P.incomplete.length}) · aggiornati: ${P.update.length} · duplicati ignorati: ${P.skipped.filter((s) => s.reason.startsWith('duplicato')).length} · altre righe escluse: ${P.skipped.filter((s) => !s.reason.startsWith('duplicato')).length} · righe con errori: ${P.errors.length}.</p>${planHtml(P, true)}`;
        W.plan = null;
        // filtri azzerati, così i punti appena importati si vedono subito nella tabella
        for (const id of ['db-q', 'db-f-resource']) $(id).value = '';
        for (const id of ['db-f-system', 'db-f-category', 'db-f-status', 'db-f-group', 'db-f-priority']) $(id).value = '';
        $('db-f-complete').checked = false;
        renderTable();
      } catch (e) { W.result = `<p class="err">Importazione non riuscita, nessun punto salvato: ${esc(e.message)}</p>`; }
      renderWizard();
      $('wz-out')?.scrollIntoView({ block: 'center' });
    };
  }

  function planHtml(P, final = false) {
    const warnRows = (W) => (W.cands ?? []).filter((c) => c.point && c.warnings.length);
    const lines = [];
    if (P.missingCols?.length) lines.push(`<p class="warn">Colonne non associate: ${esc(P.missingCols.map((k) => FIELDS.find((f) => f.key === k).label).join(', '))}. Le schede risulteranno incomplete o in errore.</p>`);
    if (!final) lines.push(`<p><b>Da importare:</b> ${P.insert.length} nuovi${P.incomplete.length ? ` (${P.incomplete.length} incompleti)` : ''} · ${P.update.length} aggiornamenti · ${P.skipped.length} esclusi · <span class="${P.errors.length ? 'err' : ''}">${P.errors.length} righe con errori</span></p>`);
    if (P.errors.length) lines.push(`<details open><summary class="err">Errori (righe non importate)</summary><ul>${P.errors.slice(0, 100).map((e) => `<li>Riga ${e.rowNo}: ${esc(e.errors.join('; '))}</li>`).join('')}</ul></details>`);
    if (P.skipped.length) lines.push(`<details><summary>Righe escluse (${P.skipped.length})</summary><ul>${P.skipped.slice(0, 100).map((s) => `<li>Riga ${s.rowNo}: ${esc(s.reason)}</li>`).join('')}</ul></details>`);
    if (P.update.length) lines.push(`<details><summary>Aggiornamenti (${P.update.length})</summary><ul>${P.update.slice(0, 100).map((u) => `<li>Riga ${u.rowNo}: "${esc(u.before.name)}" (${esc(u.reason)})</li>`).join('')}</ul></details>`);
    const wr = warnRows(wizard ?? {});
    if (wr.length) lines.push(`<details><summary class="warn">Avvisi (${wr.length})</summary><ul>${wr.slice(0, 100).map((c) => `<li>Riga ${c.rowNo} "${esc(c.point.name)}": ${esc(c.warnings.join('; '))}</li>`).join('')}</ul></details>`);
    return lines.join('');
  }

  // ------------------------------------------------------------ dal pianificatore
  function openDraft(d) {
    fillForm(null);
    $('db-system').value = d.system;
    setUnit(d.unit);
    $('db-x').value = d.x; $('db-y').value = d.y; $('db-z').value = d.z;
    draftSource = d.source ?? 'manuale';
    $('db-form-title').textContent = 'Nuovo punto dalle coordinate del pianificatore';
    $('db-form-msg').innerHTML = '<span class="hint">Dai un nome al punto, completa i campi e premi Salva.</span>';
    app.showTab('db');
    $('db-name').focus();
  }

  fillForm(null);
  await reload();
  return { reload, openDraft, db };
}
