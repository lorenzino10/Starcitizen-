// COMMAND BRIDGE: logica pura della plancia 2.0 (scena della mappa, salto successivo, prossima
// tratta). Nessun dato inventato: le linee "reali" uniscono solo posizioni XYZ dei dati; tutto cio'
// che e' indicativo (salto fra sistemi, pool di luoghi, offerta) ha uno stile schematico distinto.
import { systemsPath } from '../missions/build.js';
import { missionSegments } from '../atlas/missions.js';

export const SYS_LABEL = { stanton: 'Stanton', pyro: 'Pyro', nyx: 'Nyx' };
export const MAP_KINDS = new Set(['planet', 'moon', 'station', 'gateway', 'city']);

/** Legenda della mappa: cosa e' geometria reale e cosa e' schematico. */
export const LEGEND = [
  ['navcom', 'rotta QT calcolata dal pianificatore (XYZ reali)'],
  ['possibile', 'linea retta posizione → destinazione (non è la rotta)'],
  ['confermata', 'missione tua: ritiro → consegna'],
  ['ipotetica', 'modello di catalogo con luoghi fissi'],
  ['nonverificata', 'modello con luoghi da pool (uno fra più)'],
  ['regionale', 'SCHEMATICO: verso il gateway di un altro sistema'],
];

const gwToward = (geo, sys, toward) => geo.inSystem(sys).find((p) => p.kind === 'gateway' && p.pos && p.name.toLowerCase() === `${SYS_LABEL[toward] ?? toward} gateway`.toLowerCase()) ?? null;

/**
 * Salto successivo verso un sistema diverso: sistemi da attraversare e gateway di uscita nel sistema
 * di partenza. Distanza solo se la posizione e' nota (linea retta fino al gateway).
 */
export function nextJump(fromSystem, toSystem, { geo, links, pos = null } = {}) {
  if (!fromSystem || !toSystem || fromSystem === toSystem) return null;
  const path = systemsPath(fromSystem, toSystem, links);
  if (!path) return { path: null, gateway: null, distance: null, note: `nessun collegamento noto fra ${SYS_LABEL[fromSystem] ?? fromSystem} e ${SYS_LABEL[toSystem] ?? toSystem} nei dati` };
  const gw = gwToward(geo, path[0], path[1]);
  const d = gw && pos ? Math.hypot(gw.pos.x - pos.x, gw.pos.y - pos.y, gw.pos.z - pos.z) : null;
  return {
    path, gateway: gw ? { id: gw.id, name: gw.name, system: gw.system, pos: gw.pos } : null, distance: d, jumps: path.length - 1,
    note: gw ? `${path.length - 1} salt${path.length > 2 ? 'i' : 'o'}: ${path.map((s) => SYS_LABEL[s] ?? s).join(' → ')}. Il tunnel parte vicino a ${gw.name}; la sua durata non è nei dati.` : `gateway verso ${SYS_LABEL[path[1]]} non trovato in ${SYS_LABEL[path[0]]}`,
  };
}

/** Prossima tratta dell'ultima rotta del pianificatore (solo se la rotta porta alla destinazione). */
export function nextLeg(lastPlan, dest) {
  const steps = lastPlan?.path ?? []; const target = lastPlan?.inputs?.target?.name ?? null;
  if (!steps.length) return null;
  const matches = !dest || target === dest.name;
  const first = steps.find((s) => s.kind !== 'conv') ?? steps[0];
  const drops = steps.filter((s) => s.kind === 'qt-drop');
  return { matches, target, kind: first.kind, from: first.from?.name ?? null, to: first.to?.name ?? null, drop: !!first.drop, drops: drops.length, jumps: steps.filter((s) => s.kind === 'jump').length, steps: steps.length };
}

const P = (a) => (Array.isArray(a) ? { x: a[0], y: a[1], z: a[2] } : a);

/**
 * Scena per AtlasView.
 * ctx = {geo, system, position, destination, lastPlan, missions:[view], focus:viewId|null, links, outposts:boolean}
 */
export function bridgeScene(ctx) {
  const { geo, system } = ctx; const items = []; const lines = []; const seen = new Set();
  const tags = new Map();
  const add = (p, extra = {}) => {
    if (!p?.pos || p.system !== system || seen.has(p.id)) return;
    seen.add(p.id);
    items.push({ id: p.id, pos: p.pos, kind: p.kind, label: p.name, radius: p.radius ?? null, system: p.system, parentPos: p.kind === 'moon' ? geo.get(p.parentId)?.pos ?? null : null, ...(p.hidden ? { color: '#3b5266' } : {}), ...extra });
  };
  for (const p of geo.inSystem(system)) if (MAP_KINDS.has(p.kind) || (ctx.outposts && p.kind === 'outpost')) add(p);
  // missioni selezionate o evidenziate: luoghi e segmenti (stili distinti per certezza)
  for (const v of ctx.missions ?? []) {
    for (const o of v.ops) for (const id of o.fixed ? o.ids : []) if (!tags.has(id)) tags.set(id, { text: o.role === 'pickup' ? 'R' : 'C', color: o.role === 'pickup' ? '#5dff9d' : '#ffb347' });
    for (const s of missionSegments(v, geo, system, { maxPool: v.id === ctx.focus ? 12 : 6 })) {
      add(geo.get(s.from)); add(geo.get(s.to));
      lines.push({ a: geo.get(s.from).pos, b: geo.get(s.to).pos, style: s.style, arrow: s.style !== 'offerta', label: s.scu ? `${s.scu} SCU` : '', id: `ms:${v.id}`, pickable: true, width: v.id === ctx.focus ? 3 : undefined, alpha: ctx.focus && v.id !== ctx.focus ? 0.45 : 1 });
    }
    // missione interstellare: indicazione schematica verso il gateway, mai una linea fra sistemi
    const sysOf = (role) => [...new Set(v.ops.filter((o) => o.role === role).flatMap((o) => [...o.ids, ...(o.alt ?? [])]).map((id) => geo.get(id)?.system).filter(Boolean))];
    const ps = sysOf('pickup'), ds = sysOf('dropoff');
    if (ps.length === 1 && ds.length === 1 && ps[0] !== ds[0] && (ps[0] === system || ds[0] === system)) {
      const other = ps[0] === system ? ds[0] : ps[0];
      const path = systemsPath(system, other, ctx.links);
      const gw = path ? gwToward(geo, system, path[1]) : null;
      const end = v.ops.find((o) => o.fixed && geo.get(o.ids[0])?.system === system);
      if (gw && end) { add(gw); add(geo.get(end.ids[0])); lines.push({ a: geo.get(end.ids[0]).pos, b: gw.pos, style: 'regionale', arrow: true, label: `→ ${SYS_LABEL[other]}`, id: `ms:${v.id}`, pickable: true }); }
    }
  }
  // rotta del pianificatore (XYZ reali, solo tratte in questo sistema)
  const plan = (ctx.lastPlan?.path ?? []).filter((s) => s.system === system);
  plan.forEach((s, i) => { const a = s.from?.pos, b = s.drop ?? s.to?.pos; if (a && b) lines.push({ a: P(a), b: P(b), style: 'navcom', arrow: true, label: s.drop ? 'uscita QT' : '', id: `leg:${i}` }); });
  // posizione e destinazione
  const pos = ctx.position?.system === system ? ctx.position : null;
  const dst = ctx.destination?.system === system && ctx.destination.pos ? ctx.destination : null;
  if (pos) items.push({ id: '__pos', pos: { x: pos.x, y: pos.y, z: pos.z }, kind: 'personal', label: 'TU (posizione inserita)', color: '#4dff9a', priority: 2000, tag: { text: 'T', color: '#4dff9a' }, system });
  if (dst) {
    const it = items.find((x) => x.id === dst.id);
    if (it) Object.assign(it, { selected: true, priority: 1900 }); else items.push({ id: dst.id ?? '__dst', pos: dst.pos, kind: 'personal', label: dst.name, color: '#ff6b6b', selected: true, priority: 1900, system });
  }
  if (pos && dst && !plan.length) lines.push({ a: { x: pos.x, y: pos.y, z: pos.z }, b: dst.pos, style: 'possibile', arrow: true, label: 'linea retta', id: 'straight' });
  // destinazione in un altro sistema: indicazione schematica verso il gateway di uscita
  if (pos && ctx.destination && ctx.destination.system !== system) {
    const j = nextJump(system, ctx.destination.system, { geo, links: ctx.links, pos });
    if (j?.gateway) { add(geo.get(j.gateway.id)); lines.push({ a: { x: pos.x, y: pos.y, z: pos.z }, b: j.gateway.pos, style: 'regionale', arrow: true, label: `salto → ${SYS_LABEL[j.path[1]]}`, id: 'jump' }); }
  }
  for (const it of items) if (tags.has(it.id) && !it.tag) it.tag = tags.get(it.id);
  if (ctx.destination?.id && tags.has(ctx.destination.id)) { /* il tag missione resta visibile anche sulla destinazione */ }
  const frameOn = [pos, dst?.pos, ...lines.flatMap((l) => [l.a, l.b])].filter(Boolean).map((p) => ({ x: p.x, y: p.y, z: p.z }));
  return { items, lines, frameOn };
}
