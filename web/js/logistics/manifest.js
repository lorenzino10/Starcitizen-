// MANIFESTO DI CARICO DINAMICO: scali in sequenza, operazioni, stiva dopo ogni operazione.
// La compatibilita' FISICA delle casse non si deduce dalla somma degli SCU: senza le dimensioni
// delle casse di ogni contratto e la geometria della griglia, il manifesto lo dichiara.
import { placeKey } from './places.js';

/**
 * @param plan risultato di planDispatch (seq, initialLoad, contracts)
 * @param ship {name, scu, maxBox, grids}
 * @param capacity capacita' operativa scelta (<= nominale)
 */
export function buildManifest(plan, { ship = null, capacity, start = null } = {}) {
  const byId = new Map(plan.contracts.map((c) => [c.id, c]));
  const remaining = new Map(plan.contracts.map((c) => [c.id, c.movements.reduce((s, m) => s + (m.scu - m.delivered), 0)]));
  const stops = [];
  let load = plan.initialLoad ?? 0, cur = null;
  const earned = new Set();
  for (const t of plan.seq) {
    if (!cur || placeKey(cur.place) !== placeKey(t.place)) {
      cur = { n: stops.length + 1, place: t.place, ops: [], loadBefore: load, loadAfter: load, rewardEarned: 0, warnings: [] };
      stops.push(cur);
    }
    load += t.type === 'carico' ? t.qty : -t.qty;
    const c = byId.get(t.contractId);
    const op = { type: t.type, contractId: t.contractId, title: c?.title ?? t.contractId, movementId: t.movementId, cargo: t.cargo, qty: t.qty, containerMax: t.containerMax, loadAfter: load, residual: capacity - load, proposed: c ? !(c.status === 'accettata' || c.status === 'in_esecuzione') : false };
    cur.ops.push(op);
    cur.loadAfter = load;
    if (t.type === 'scarico') {
      remaining.set(t.contractId, remaining.get(t.contractId) - t.qty);
      if (remaining.get(t.contractId) <= 1e-9 && !earned.has(t.contractId)) { earned.add(t.contractId); cur.rewardEarned += c?.reward ?? 0; if (c && c.reward == null) cur.warnings.push(`${c.title}: ricompensa non nota`); }
    }
    if (t.type === 'carico') {
      if (t.containerMax == null) cur.warnings.push(`${op.title} / ${t.cargo ?? 'merce'}: dimensione delle casse non nota`);
      else if (ship?.maxBox && t.containerMax > ship.maxBox) cur.warnings.push(`${op.title}: casse da ${t.containerMax} SCU oltre la cassa massima della nave (${ship.maxBox} SCU)`);
    }
  }
  const totalReward = plan.contracts.reduce((s, c) => s + (c.reward ?? 0), 0);
  let acc = 0;
  for (const s of stops) { acc += s.rewardEarned; s.rewardCumulative = acc; s.rewardPending = totalReward - acc; s.residual = capacity - s.loadAfter; }
  const points = [{ label: start?.name ?? 'Partenza', load: plan.initialLoad ?? 0 }];
  for (const s of stops) for (const o of s.ops) points.push({ label: `${s.n}. ${s.place.name}`, load: o.loadAfter, op: o });
  const peak = Math.max(...points.map((p) => p.load));
  const limits = [
    'Compatibilità fisica non verificata: la somma degli SCU entra nella capacità, ma l\'incastro delle casse nella griglia dipende dalle loro dimensioni e dall\'ordine di carico.',
  ];
  if (!ship?.grids) limits.push('Geometria della griglia di carico non disponibile per questa nave.');
  if (ship?.scu && capacity < ship.scu) limits.push(`Capacità operativa impostata a ${capacity} SCU su ${ship.scu} nominali.`);
  return { stops, points, peak, capacity, totalReward, unknownRewards: plan.contracts.filter((c) => c.reward == null).length, limits };
}

/** Grafico di occupazione della stiva (SVG in linea, nessuna libreria). */
export function holdChartSvg(manifest, { width = 720, height = 180 } = {}) {
  const pts = manifest.points;
  const cap = manifest.capacity || Math.max(1, manifest.peak);
  const padL = 44, padB = 22, padT = 10, w = width - padL - 8, h = height - padB - padT;
  const x = (i) => padL + (pts.length <= 1 ? 0 : (i / (pts.length - 1)) * w);
  const y = (v) => padT + h - (Math.min(v, cap * 1.1) / (cap * 1.1)) * h;
  let d = `M${x(0)},${y(pts[0].load)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(i)} V${y(pts[i].load)}`;
  const capY = y(cap);
  const ticks = [0, cap / 2, cap].map((v) => `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${Math.round(v)}</text><line x1="${padL}" x2="${padL + w}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.load)}" r="3" class="dot"><title>${esc(p.label)}: ${p.load} SCU</title></circle>`).join('');
  return `<svg class="hold-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Occupazione della stiva lungo il viaggio (picco ${manifest.peak} SCU su ${cap})">
    ${ticks}<line x1="${padL}" x2="${padL + w}" y1="${capY}" y2="${capY}" class="cap"/><text x="${padL + w}" y="${capY - 4}" text-anchor="end" class="ax">capacità ${cap} SCU</text>
    <path d="${d}" class="line"/>${dots}<text x="${padL}" y="${height - 6}" class="ax">operazioni in ordine →</text></svg>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
