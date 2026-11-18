// HERCULES · PIANO DI CARICO — interfaccia.
import { planLoad, SHIPS, SIZES, SOURCE, BOXES, CELL_M } from './engine.js';
import { isoSvg, layersSvg, colorOf } from './render.js';

const VERSION = '1.0.0';
const KEY = 'hercules-piano-v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => String(v).replace('.', ',');
const emptyBoxes = () => Object.fromEntries(SIZES.map((s) => [s, 0]));

const EXAMPLE = {
  ship: 'c2', order: 'grande-rampa', lift: true,
  stops: [
    { name: 'Everus Harbor', boxes: { ...emptyBoxes(), 32: 3, 16: 2, 8: 2, 2: 4 } },
    { name: 'Lorville CBD', boxes: { ...emptyBoxes(), 32: 5, 24: 2, 4: 6 } },
    { name: 'HDMS-Edmond', boxes: { ...emptyBoxes(), 32: 5, 16: 3, 8: 4, 1: 8 } },
  ],
};

let S = load();
let plan = null, labels = new Map(), highlight = null, afterStop = -1, timer = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); if (Array.isArray(s.stops)) return { ship: 'c2', order: 'grande-rampa', lift: true, ...s }; }
  } catch { /* archivio del browser non disponibile: si parte vuoti */ }
  return { ship: 'c2', order: 'grande-rampa', lift: true, stops: [{ name: '', boxes: emptyBoxes() }] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* niente salvataggio, il piano funziona lo stesso */ } }

const stopScu = (st) => SIZES.reduce((s, k) => s + k * (Number(st.boxes[k]) || 0), 0);
const stopName = (st, i) => st.name?.trim() || `Tappa ${i + 1}`;

function renderStops() {
  $('stops').innerHTML = S.stops.map((st, i) => `
    <div class="stop" style="--c:${colorOf(i)}" data-i="${i}">
      <div class="stop-head">
        <span class="n">${i + 1}.</span>
        <input data-k="name" value="${esc(st.name)}" placeholder="Destinazione ${i + 1}" aria-label="Destinazione della tappa ${i + 1}">
        <button type="button" class="icon" data-a="up" aria-label="Sposta su" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon" data-a="down" aria-label="Sposta giù" ${i === S.stops.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon" data-a="del" aria-label="Elimina tappa">✕</button>
      </div>
      <div class="sizes">${SIZES.map((k) => `<label>${k} SCU<input type="number" min="0" step="1" inputmode="numeric" data-k="${k}" value="${Number(st.boxes[k]) || ''}" placeholder="0"></label>`).join('')}</div>
      <div class="stop-foot" data-foot="${i}"></div>
    </div>`).join('');
  updateFoot();
}

function updateFoot() {
  S.stops.forEach((st, i) => {
    const n = SIZES.reduce((s, k) => s + (Number(st.boxes[k]) || 0), 0);
    const el = document.querySelector(`[data-foot="${i}"]`);
    if (el) el.textContent = n ? `${n} casse · ${stopScu(st)} SCU` : 'nessuna cassa';
  });
  const cap = SHIPS[S.ship].scu, tot = S.stops.reduce((s, st) => s + stopScu(st), 0);
  $('fill').innerHTML = `<div>Totale <b>${tot}</b> SCU su ${cap}${tot > cap ? ` · <span style="color:var(--red)">${tot - cap} SCU di troppo</span>` : ` · liberi ${cap - tot}`}</div>
    <div class="bar${tot > cap ? ' over' : ''}"><i style="width:${Math.min(100, (tot / cap) * 100)}%"></i></div>`;
}

function shipInfo() {
  const sh = SHIPS[S.ship];
  $('ship-info').innerHTML = sh.grids.map((g) => `${g.name}: ${num(g.m[0])} × ${num(g.m[1])} × ${num(g.m[2])} m, ${g.scu} SCU, cassa max ${num(g.max[0])} × ${num(g.max[1])} m`).join('<br>')
    + `<br>Dati di gioco ${esc(SOURCE.patch)}.`;
}

function schedule() { clearTimeout(timer); timer = setTimeout(compute, 200); }

function compute() {
  save();
  const any = S.stops.some((st) => stopScu(st) > 0);
  if (!any) { plan = null; $('summary').innerHTML = '<div class="empty">Aggiungi le casse delle tue consegne: il piano si calcola da solo.</div>'; $('views').hidden = true; return; }
  plan = planLoad(S.ship, S.stops, { order: S.order, lift: S.lift });
  // etichette "tappa.numero" nell'ordine in cui le scarichi
  labels = new Map();
  plan.perStop.forEach((p, i) => p.unload.forEach((id, k) => labels.set(id, `${i + 1}.${String(k + 1).padStart(2, '0')}`)));
  if (afterStop >= S.stops.length - 1) afterStop = -1;
  renderSummary(); renderAfter(); renderViews(); renderUnload(); renderLoad(); renderLimits();
  $('views').hidden = false;
}

function renderSummary() {
  const t = plan.totals;
  const tiles = [
    [`${t.placedScu}<small style="font-size:.9rem;color:var(--dim)"> / ${t.capacity}</small>`, 'SCU a bordo', t.unplaced ? 'warn' : 'good'],
    [t.boxes, 'casse sistemate', ''],
    [t.extraMoves, 'spostamenti extra allo scarico', t.extraMoves ? 'warn' : 'good'],
    [t.unplaced, 'casse che non entrano', t.unplaced ? 'bad' : 'good'],
  ];
  const msgs = [];
  if (t.unplaced) {
    const per = plan.perStop.map((p, i) => p.unplaced ? `${esc(p.name)}: ${p.unplaced} casse (${p.unplacedScu} SCU)` : null).filter(Boolean).join(' · ');
    const why = t.requestedScu > t.capacity ? `Hai ${t.requestedScu} SCU per una stiva da ${t.capacity}.` : 'La somma degli SCU entrerebbe, ma l\'incastro delle casse no.';
    msgs.push(`<div class="msg bad"><b>Restano fuori ${t.unplaced} casse.</b> ${why} Fuori: ${per}. Le casse delle prime consegne si sistemano per ultime, quindi sono quelle che restano a terra: valuta un secondo viaggio.</div>`);
  }
  if (t.extraMoves) {
    const where = plan.perStop.map((p) => p.moves.length ? `${esc(p.name)} (${p.moves.length})` : null).filter(Boolean).join(', ');
    msgs.push(`<div class="msg">Con questo carico ${t.relaxed} casse non trovano un posto libero davanti a quelle delle tappe successive. Allo scarico dovrai spostare temporaneamente ${t.extraMoves} casse: ${where}. Il dettaglio è nello scarico tappa per tappa.</div>`);
  } else if (!t.unplaced) {
    msgs.push(`<div class="msg" style="border-color:var(--green);background:rgba(93,255,157,.06)">A ogni tappa le casse da consegnare sono davanti o sopra: nessuna cassa da spostare.</div>`);
  }
  $('summary').innerHTML = `<div class="tiles">${tiles.map(([v, l, c]) => `<div class="tile ${c}"><b>${v}</b><span>${l}</span></div>`).join('')}</div>${msgs.join('')}`;
}

function renderAfter() {
  const opts = [`<option value="-1">alla partenza</option>`].concat(plan.perStop.slice(0, -1).map((p, i) => `<option value="${i}">dopo la tappa ${i + 1} (${esc(p.name)})</option>`));
  $('after').innerHTML = opts.join('');
  $('after').value = String(afterStop);
  $('legend').innerHTML = plan.perStop.map((p, i) => `<span><i style="background:${colorOf(i)}"></i>${i + 1}. ${esc(p.name)} · ${p.boxes} casse</span>`).join('');
}

function renderViews() {
  $('iso').innerHTML = isoSvg(plan, { afterStop, labels, highlight });
  $('layers').innerHTML = layersSvg(plan, { afterStop, labels, highlight });
}

function posText(b) {
  const p = b.pos;
  return `${p.grid} · ${num(p.fromRampM)} m dalla rampa · ${num(p.fromLeftM)} m da sinistra · ${p.level}`;
}
const chip = (b) => `<span class="chip" style="background:${colorOf(b.stop)}">${esc(labels.get(b.id))}</span>`;
const sizeTxt = (b) => `${b.size} SCU${b.w !== b.l ? `, ${b.pos.along}` : ''}`;

function renderUnload() {
  $('unload').innerHTML = plan.perStop.map((p, i) => {
    const moves = p.moves.map((m) => { const b = plan.boxes[m.id], f = plan.boxes[m.forBox]; return `<li class="move">Sposta temporaneamente ${chip(b)} (tappa ${b.stop + 1}) per raggiungere ${chip(f)}, poi rimettila al suo posto.</li>`; }).join('');
    const list = p.unload.map((id) => { const b = plan.boxes[id]; return `<li data-id="${id}">${chip(b)} ${sizeTxt(b)} · ${posText(b)}</li>`; }).join('');
    const un = p.unplaced ? `<div class="meta" style="color:var(--red)">${p.unplaced} casse (${p.unplacedScu} SCU) non sono a bordo.</div>` : '';
    return `<div class="ustop" style="--c:${colorOf(i)}"><h3>${i + 1}. ${esc(p.name)}</h3>
      <div class="meta">${p.boxes} casse · ${p.scu} SCU${p.avgDistM != null ? ` · in media a ${num(p.avgDistM)} m dalla rampa` : ''}</div>${un}
      ${p.boxes ? `<ol>${moves}${list}</ol>` : ''}</div>`;
  }).join('');
}

function renderLoad() {
  const rows = plan.load.map((id, k) => {
    const b = plan.boxes[id], p = b.pos;
    return `<tr data-id="${id}"><td>${k + 1}</td><td>${chip(b)}</td><td>${b.size} SCU</td><td>${esc(plan.perStop[b.stop].name)}</td><td>${esc(p.grid)}</td><td>${num(p.fromRampM)} m</td><td>${num(p.fromLeftM)} m</td><td>${esc(p.level)}</td><td>${b.w === b.l ? '—' : esc(p.along)}</td></tr>`;
  }).join('');
  $('load').innerHTML = `<thead><tr><th>#</th><th>Cassa</th><th>Taglia</th><th>Consegna</th><th>Griglia</th><th>Dalla rampa</th><th>Da sinistra</th><th>Piano</th><th>Verso</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderLimits() {
  const sh = plan.ship;
  $('limits').innerHTML = [
    `Griglie e casse dai file di gioco ${esc(SOURCE.patch)} (<a href="${SOURCE.url}" target="_blank" rel="noopener">scunpacked-data</a>): ${esc(sh.name)}, ${sh.grids.map((g) => `${esc(g.cls)} ${g.scu} SCU`).join(', ')}. Casse: ${SIZES.map((k) => `${k} SCU = ${BOXES[k].map((c) => num(c * CELL_M)).join('×')} m`).join(' · ')}.`,
    'Nei file c\'è la misura delle griglie ma non la loro posizione nella nave: che la griglia grande sia verso la rampa è un\'ipotesi da controllare in gioco. Se è il contrario, cambia "Posizione delle griglie".',
    'Le griglie sono messe una dietro l\'altra e centrate in larghezza. Lo spazio fuori dalle griglie è considerato libero per far passare le casse.',
    'Una cassa si scarica se può scorrere verso la rampa senza toccare altre casse, eventualmente dopo averla sollevata. Le casse non si ribaltano e devono appoggiare per intero.',
    'Il programma non sa quali casse ti darà il gioco: inserisci quelle che vedi nel contratto o nel terminale.',
  ].map((t) => `<li>${t}</li>`).join('');
}

function planText() {
  const lines = [`PIANO DI CARICO ${plan.ship.name} · ${plan.totals.placedScu}/${plan.totals.capacity} SCU · ${plan.totals.boxes} casse`, '', 'CARICO (in ordine):'];
  plan.load.forEach((id, k) => { const b = plan.boxes[id]; lines.push(`${String(k + 1).padStart(3)}. ${labels.get(id)}  ${b.size} SCU  ${plan.perStop[b.stop].name}  ${posText(b)}`); });
  plan.perStop.forEach((p, i) => {
    lines.push('', `SCARICO ${i + 1}. ${p.name} (${p.boxes} casse, ${p.scu} SCU):`);
    p.moves.forEach((m) => lines.push(`  ! sposta ${labels.get(m.id)} per raggiungere ${labels.get(m.forBox)}, poi rimettila`));
    p.unload.forEach((id) => lines.push(`  ${labels.get(id)}  ${plan.boxes[id].size} SCU  ${posText(plan.boxes[id])}`));
  });
  if (plan.totals.unplaced) lines.push('', `FUORI: ${plan.totals.unplaced} casse non entrano.`);
  return lines.join('\n');
}

function setHighlight(id) {
  highlight = id;
  renderViews();
  document.querySelectorAll('tr.hl, li.hl').forEach((e) => e.classList.remove('hl'));
  if (id != null) document.querySelectorAll(`[data-id="${id}"]`).forEach((e) => { if (e.tagName === 'TR' || e.tagName === 'LI') e.classList.add('hl'); });
}

// --- eventi
$('stops').addEventListener('input', (e) => {
  const card = e.target.closest('.stop'); if (!card) return;
  const i = Number(card.dataset.i), k = e.target.dataset.k;
  if (k === 'name') S.stops[i].name = e.target.value;
  else S.stops[i].boxes[k] = Math.max(0, Math.floor(Number(e.target.value) || 0));
  updateFoot(); schedule();
});
$('stops').addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.a; if (!a) return;
  const i = Number(e.target.closest('.stop').dataset.i);
  if (a === 'del') { S.stops.splice(i, 1); if (!S.stops.length) S.stops.push({ name: '', boxes: emptyBoxes() }); }
  if (a === 'up' && i > 0) [S.stops[i - 1], S.stops[i]] = [S.stops[i], S.stops[i - 1]];
  if (a === 'down' && i < S.stops.length - 1) [S.stops[i + 1], S.stops[i]] = [S.stops[i], S.stops[i + 1]];
  renderStops(); schedule();
});
$('add').addEventListener('click', () => { S.stops.push({ name: '', boxes: emptyBoxes() }); renderStops(); save(); document.querySelector(`.stop[data-i="${S.stops.length - 1}"] input`)?.focus(); });
$('example').addEventListener('click', () => { S = structuredClone(EXAMPLE); syncControls(); renderStops(); compute(); });
$('clear').addEventListener('click', () => { S.stops = [{ name: '', boxes: emptyBoxes() }]; renderStops(); compute(); });
$('ship').addEventListener('change', (e) => { S.ship = e.target.value; shipInfo(); updateFoot(); compute(); });
$('order').addEventListener('change', (e) => { S.order = e.target.value; compute(); });
$('lift').addEventListener('change', (e) => { S.lift = e.target.checked; compute(); });
$('after').addEventListener('change', (e) => { afterStop = Number(e.target.value); renderViews(); });
for (const id of ['iso', 'layers', 'load', 'unload']) {
  $(id).addEventListener('click', (e) => { const el = e.target.closest('[data-id]'); if (el) setHighlight(highlight === Number(el.dataset.id) ? null : Number(el.dataset.id)); });
}
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(planText()); $('copied').textContent = 'Copiato.'; }
  catch { $('copied').textContent = 'Copia non permessa dal browser.'; }
});

function syncControls() { $('ship').value = S.ship; $('order').value = S.order; $('lift').checked = !!S.lift; shipInfo(); }

$('version').textContent = `v${VERSION}`;
syncControls(); renderStops(); compute();
