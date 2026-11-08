// LOCATION INTELLIGENCE ESTESA (0.7.1): ricerca geografica delle missioni che possono interessare
// un luogo, con classificazione rigorosa delle evidenze.
//
//   CERTO       il luogo e' il punto fisso di ritiro o consegna (pool di 1)
//   POSSIBILE   il luogo e' una delle alternative di un pool: IL GIOCO ASSEGNA IL LUOGO EFFETTIVO
//   REGIONALE   la missione e' associata a un livello superiore (luna, pianeta, sistema): offerta o
//               pool che nomina il corpo celeste stesso. BASE SPECIFICA NON CONFERMATA
//   SCONOSCIUTO il dato non permette di stabilire il luogo (nome non risolto, punto anonimo)
//
// Regole che non si piegano alle prestazioni:
//  - una missione regionale non diventa mai certa o possibile per una base;
//  - un collegamento esiste solo dentro lo STESSO contratto (ritiro e consegna dello stesso modello);
//  - una missione di un'altra base della regione non viene contata come missione di questo luogo;
//  - l'assenza di collegamenti nei dati non significa assenza nel gioco.
import { keep } from './missions.js';

export const LEVELS = {
  certo: { label: 'CERTO', note: 'luogo indicato dai dati come punto fisso' },
  possibile: { label: 'POSSIBILE', note: 'POSSIBILE — IL GIOCO ASSEGNA IL LUOGO EFFETTIVO' },
  regionale: { label: 'REGIONALE', note: 'ASSOCIAZIONE REGIONALE — BASE SPECIFICA NON CONFERMATA' },
  sconosciuto: { label: 'SCONOSCIUTO', note: 'luogo non determinabile dai dati' },
};
export const SCOPES = {
  tutte: 'Tutte le distanze', base: 'Stessa base', luna: 'Stessa luna', pianeta: 'Stesso pianeta o sua regione',
  interplanetaria: 'Tra pianeti differenti', interstellare: 'Tra sistemi stellari differenti',
};
export const MODES = { verificate: 'VERIFICATE', possibili: 'MOSTRA ANCHE POSSIBILITÀ' };
export const NO_LINK = 'NESSUN COLLEGAMENTO DOCUMENTATO NEI DATI DISPONIBILI';
export const NO_LINK_NOTE = 'Non significa che nel gioco non esistano missioni di questo tipo: i dati disponibili non lo documentano.';
export const OMITTED = 'Missione individuata nel catalogo — collegamenti grafici omessi per numero elevato di alternative.';
const ROLE = { pickup: 'ritiro', dropoff: 'consegna' };
const RANK = { certo: 0, possibile: 1, regionale: 2, altra_base: 3 };

// ------------------------------------------------------------------ gerarchia geografica
/** Base, luna, pianeta, stella e sistema di un luogo (memorizzati sul geo, che non cambia). */
export function hierarchy(geo, id) {
  const memo = (geo._hier ??= new Map());
  if (memo.has(id)) return memo.get(id);
  const p = geo.get(id);
  let h = null;
  if (p) {
    const path = geo.path(id);
    h = {
      place: p, system: p.system,
      moon: [...path].reverse().find((x) => x.kind === 'moon') ?? null,
      planet: path.find((x) => x.kind === 'planet') ?? null,
      star: path.find((x) => x.kind === 'star') ?? geo.star(p.system),
    };
  }
  memo.set(id, h);
  return h;
}

/** Tutti i discendenti (id) di un luogo, lui escluso. */
export function descendants(geo, id) {
  const memo = (geo._desc ??= new Map());
  if (memo.has(id)) return memo.get(id);
  const out = [], stack = [id];
  while (stack.length) for (const c of geo.children(stack.pop())) { out.push(c.id); stack.push(c.id); }
  memo.set(id, out);
  return out;
}

/**
 * Relazione geografica reale fra due luoghi (gerarchia, non nomi):
 * base | luna | pianeta | interplanetaria | interstellare | ignota.
 */
export function relation(geo, a, b) {
  if (!a || !b) return 'ignota';
  if (a === b) return 'base';
  const A = hierarchy(geo, a), B = hierarchy(geo, b);
  if (!A || !B || !A.system || !B.system) return 'ignota';
  if (A.system !== B.system) return 'interstellare';
  if (A.moon && B.moon && A.moon.id === B.moon.id) return 'luna';
  if (A.planet && B.planet && A.planet.id === B.planet.id) return 'pianeta';
  return 'interplanetaria';
}

/** Operazioni dell'altro capo nello stesso contratto (stessa regola di abbinamento della mappa). */
export function counterparts(v, o) {
  const other = v.ops.filter((x) => x.role !== o.role);
  const same = v.ops.filter((x) => x.role === o.role);
  return same.length > 1 && other.length > 1 ? other.filter((x) => x.slot === o.slot) : other;
}

/** Riepilogo dell'altro capo rispetto a un luogo di riferimento: relazioni, dimensione, ignoti. */
function linkInfo(geo, v, o, ref, cache) {
  const k = `${v.id}|${o ? `${o.role}${o.slot}` : 'offer'}|${ref}`;
  if (cache.has(k)) return cache.get(k);
  const cps = o ? counterparts(v, o) : v.ops;
  const rel = {}; let unknown = 0, size = 0, ids = 0;
  for (const c of cps) {
    size = Math.max(size, c.size); ids += c.ids.length;
    unknown += Math.max(0, c.size - c.ids.length);
    for (const id of c.ids) { const r = relation(geo, ref, id); rel[r] = (rel[r] ?? 0) + 1; }
  }
  const sure = !!o?.fixed && cps.length > 0 && cps.every((c) => c.fixed);
  const r = { rel, unknown, size, ids, sure, none: cps.length === 0 };
  cache.set(k, r);
  return r;
}

const scopeOk = (link, scope) => !scope || scope === 'tutte' || (link.rel[scope] ?? 0) > 0;
const uniq = (rows) => new Set(rows.map((r) => r.v.id));

// ------------------------------------------------------------------ ricerca estesa
/**
 * Interrogazione geografica estesa di un luogo.
 * @param index MissionIndex
 * @param filters filtri di MissionIndex.forPlace (origine, compagnia, grado, patch...)
 * @param options {mode:'verificate'|'possibili', scope, maxDraw, currentPatch, queueSize}
 */
export function expandPlace(index, placeId, filters = {}, options = {}) {
  const { mode = 'possibili', scope = 'tutte', maxDraw = 10, currentPatch = '', queueSize = null } = options;
  const geo = index.geo;
  const ck = cacheKey(placeId, filters, { mode, scope, maxDraw, currentPatch });
  const memo = (index._exp ??= new Map());
  if (memo.has(ck)) return memo.get(ck);
  const lcache = (index._link ??= new Map());
  const H = hierarchy(geo, placeId);
  const empty = { out: [], in: [], transit: [], offer: [] };
  const raw = index.at.get(placeId) ?? empty;
  const best = new Map(); // viewId -> livello migliore (per evitare duplicati fra categorie)
  const all = []; // tutte le righe, anche filtrate (per la diagnostica)
  const mark = (v, lvl) => { const b = best.get(v.id); if (b === undefined || RANK[lvl] < RANK[b]) best.set(v.id, lvl); };

  const mk = (level, section, e, extra = {}) => {
    const o = e.op ?? null;
    const ref = extra.ref ?? placeId;
    const link = linkInfo(geo, e.v, o, ref, lcache);
    const passFilters = keep({ v: e.v, alternatives: o?.size ?? 1 }, filters);
    const row = {
      v: e.v, level, section, role: o?.role ?? null, op: o, alternatives: o?.size ?? null, link,
      via: extra.via ?? 'op', anchor: extra.anchor ?? null, bucket: extra.bucket ?? null, ref,
      drawable: (o ? o.size <= maxDraw : true) && link.size <= maxDraw,
      passFilters, passScope: scopeOk(link, scope), reason: extra.reason,
    };
    row.pass = row.passFilters && row.passScope && (mode === 'possibili' || level === 'certo' || e.v.origin === 'utente');
    all.push(row);
    return row;
  };

  // A/B: il luogo stesso, ritiro e consegna distinti
  for (const role of ['out', 'in']) for (const e of raw[role]) if (!e.op.regionalBody) mark(e.v, e.strength === 'fisso' ? 'certo' : 'possibile');
  const A = { out: [], in: [] }, B = { out: [], in: [] }, regionalSelf = {};
  for (const role of ['out', 'in']) for (const e of raw[role]) {
    const lvl = e.strength === 'fisso' ? 'certo' : e.op.regionalBody ? 'regionale' : 'possibile';
    const where = `${ROLE[e.op.role]} ${e.op.slot}`;
    if (lvl === 'regionale') { // il pool nomina proprio questo corpo celeste: area certa, base no
      mark(e.v, 'regionale');
      (regionalSelf[role] ??= []).push(mk('regionale', 'regionali', e, { anchor: H.place, bucket: H.place.kind === 'moon' ? 'luna' : 'pianeta', reason: `${where}: il dato nomina ${H.place.name} e non una base. ${LEVELS.regionale.note}` }));
      continue;
    }
    const reason = lvl === 'certo'
      ? `${where}: ${H.place.name} è il punto fisso indicato da ${e.v.source ?? e.v.origin}`
      : `${where}: ${H.place.name} è uno di ${e.op.size} luoghi del pool. ${LEVELS.possibile.note}`;
    (lvl === 'certo' ? A : B)[role].push(mk(lvl, `${lvl}_${role}`, e, { reason }));
  }

  // C: livelli superiori (luna, pianeta) e sistema
  const regional = { luna: [], pianeta: [], sistema: [] };
  for (const rows of Object.values(regionalSelf)) for (const r of rows) regional[r.bucket].push(r);
  const offersArea = [];
  const bodies = [];
  if (H?.moon && H.moon.id !== placeId) bodies.push(['luna', H.moon]);
  if (H?.planet && H.planet.id !== placeId) bodies.push(['pianeta', H.planet]);
  // offerte nel luogo stesso: il contratto puo' comparire qui, ritiro e consegna restano del pool
  for (const e of raw.offer) {
    if (best.has(e.v.id)) continue;
    mark(e.v, 'regionale');
    offersArea.push(mk('regionale', 'offerte', { v: e.v, op: null }, { via: 'offerta', anchor: H.place, bucket: 'luogo', reason: `offerta associata a ${H.place.name} nei dati; il punto di ritiro e di consegna lo assegna il gioco` }));
  }
  for (const [bucket, body] of bodies) {
    const s = index.at.get(body.id) ?? empty;
    for (const role of ['out', 'in']) for (const e of s[role]) {
      if (best.has(e.v.id) && best.get(e.v.id) !== 'regionale') continue;
      if (regional[bucket].some((r) => r.v.id === e.v.id && r.role === e.op.role)) continue;
      mark(e.v, 'regionale');
      regional[bucket].push(mk('regionale', 'regionali', e, { ref: body.id, anchor: body, bucket, reason: `${ROLE[e.op.role]} ${e.op.slot}: il pool nomina ${body.name} (${bucket}) e non una base. ${LEVELS.regionale.note}` }));
    }
    for (const e of s.offer) {
      if (best.has(e.v.id)) continue;
      mark(e.v, 'regionale');
      offersArea.push(mk('regionale', 'offerte', { v: e.v, op: null }, { ref: body.id, via: 'offerta', anchor: body, bucket, reason: `offerta associata a ${body.name} (${bucket}): il gioco sceglie dove. ${LEVELS.regionale.note}` }));
    }
  }
  // sistema: solo conteggio e righe a richiesta, mai estese a tutte le basi
  const sysRows = [];
  if (H?.star && H.star.id !== placeId) {
    const s = index.at.get(H.star.id) ?? empty;
    const seen = new Set();
    for (const e of [...s.out, ...s.in, ...s.offer.map((x) => ({ v: x.v, op: null }))]) {
      if (best.has(e.v.id) || seen.has(e.v.id)) continue;
      seen.add(e.v.id);
      sysRows.push(mk('regionale', 'sistema', e, { ref: H.star.id, via: e.op ? 'op' : 'offerta', anchor: H.star, bucket: 'sistema', reason: `associata all'intero sistema ${H.star.name}: nessuna indicazione di luna, pianeta o base` }));
    }
  }

  // D: altre basi della stessa luna / dello stesso pianeta (non contate come missioni di qui)
  const otherBases = { luna: [], pianeta: [] };
  const taken = new Set(best.keys());
  const scan = (bucket, ids) => {
    for (const id of ids) {
      if (id === placeId) continue;
      const pl = geo.get(id); if (!pl || pl.kind === 'moon' || pl.kind === 'planet') continue;
      const s = index.at.get(id); if (!s) continue;
      const rows = [];
      for (const role of ['out', 'in']) for (const e of s[role]) {
        if (taken.has(e.v.id)) continue;
        rows.push(mk('altra_base', 'altre_basi', e, { ref: id, anchor: pl, bucket, reason: `${ROLE[e.op.role]} ${e.op.slot}: ${pl.name}${e.op.size > 1 ? ` (uno di ${e.op.size})` : ''}, non ${H.place.name}` }));
      }
      if (rows.length) otherBases[bucket].push({ place: pl, rows });
    }
  };
  if (H?.moon && H.moon.id !== placeId) scan('luna', descendants(geo, H.moon.id));
  if (H?.planet && H.planet.id !== placeId) {
    const onMoon = new Set(H.moon ? descendants(geo, H.moon.id) : []);
    scan('pianeta', descendants(geo, H.planet.id).filter((id) => !onMoon.has(id)));
  }
  for (const k of ['luna', 'pianeta']) otherBases[k].sort((a, b) => uniq(b.rows.filter((r) => r.pass)).size - uniq(a.rows.filter((r) => r.pass)).size || a.place.name.localeCompare(b.place.name));

  // collegamenti interplanetari e interstellari (dai livelli A e B, dentro lo stesso contratto)
  const ab = [...A.out, ...A.in, ...B.out, ...B.in];
  const P = (rows) => rows.filter((r) => r.pass);
  const inter = P(ab).filter((r) => r.link.rel.interplanetaria);
  const stellar = P(ab).filter((r) => r.link.rel.interstellare);

  const sections = {
    certainOut: P(A.out), certainIn: P(A.in), possibleOut: P(B.out), possibleIn: P(B.in),
    regional: { luna: P(regional.luna), pianeta: P(regional.pianeta) }, system: P(sysRows),
    offersArea: P(offersArea), interplanetary: inter, interstellar: stellar,
    otherBases: { luna: otherBases.luna.map((g) => ({ place: g.place, rows: P(g.rows) })).filter((g) => g.rows.length), pianeta: otherBases.pianeta.map((g) => ({ place: g.place, rows: P(g.rows) })).filter((g) => g.rows.length) },
  };
  const visible = [...sections.certainOut, ...sections.certainIn, ...sections.possibleOut, ...sections.possibleIn, ...sections.regional.luna, ...sections.regional.pianeta, ...sections.offersArea];
  const unique = {
    certain: uniq([...sections.certainOut, ...sections.certainIn]).size,
    possible: [...uniq([...sections.possibleOut, ...sections.possibleIn])].filter((id) => !uniq([...sections.certainOut, ...sections.certainIn]).has(id)).length,
    regional: uniq([...sections.regional.luna, ...sections.regional.pianeta, ...sections.offersArea]).size,
    system: uniq(sections.system).size,
    otherBases: uniq([...sections.otherBases.luna, ...sections.otherBases.pianeta].flatMap((g) => g.rows)).size,
    total: uniq(visible).size,
  };
  const res = { placeId, hierarchy: H, mode, scope, maxDraw, sections, unique, rows: all };
  res.diagnostics = diagnose(index, res, { currentPatch, queueSize });
  memo.set(ck, res);
  return res;
}

function cacheKey(id, f, o) {
  const fo = { ...f, origin: f.origin ? [...f.origin].sort() : null };
  return `${id}|${JSON.stringify(fo)}|${JSON.stringify(o)}`;
}

// ------------------------------------------------------------------ diagnostica
/** Perche' una ricerca mostra (o non mostra) missioni: conteggi espliciti, nessuna stima. */
export function diagnose(index, res, { currentPatch = '', queueSize = null } = {}) {
  const rows = res.rows;
  const by = (pred) => uniq(rows.filter(pred)).size;
  const origins = {};
  for (const v of index.views) origins[v.origin] = (origins[v.origin] ?? 0) + 1;
  const mine = rows.filter((r) => r.level !== 'altra_base' && r.section !== 'sistema');
  const unresolved = new Map(); let anonymous = 0;
  const seenV = new Set();
  for (const r of mine) {
    if (seenV.has(r.v.id)) continue;
    seenV.add(r.v.id);
    const names = new Set(r.v.ops.flatMap((o) => [...o.unresolved, ...o.ambiguous]));
    for (const n of names) unresolved.set(n, (unresolved.get(n) ?? 0) + 1); // missioni che lo contengono
    if (r.v.ops.some((o) => o.anonymous)) anonymous++;
  }
  const patchOf = (v) => v.patch ? String(v.patch) : null;
  const d = {
    models: index.views.length, origins,
    exact: by((r) => r.level === 'certo'),
    pools: by((r) => r.level === 'possibile'),
    regionalMoon: by((r) => r.section === 'regionali' && r.bucket === 'luna'),
    regionalPlanet: by((r) => r.section === 'regionali' && r.bucket === 'pianeta'),
    offersArea: by((r) => r.section === 'offerte'),
    system: by((r) => r.section === 'sistema'),
    otherBases: by((r) => r.level === 'altra_base'),
    filteredOut: by((r) => r.level !== 'altra_base' && r.section !== 'sistema' && !r.passFilters),
    scopeOut: by((r) => r.level !== 'altra_base' && r.section !== 'sistema' && r.passFilters && !r.passScope),
    hiddenByMode: by((r) => r.passFilters && r.passScope && !r.pass && r.section !== 'sistema' && r.level !== 'altra_base'),
    notDrawn: by((r) => r.pass && (r.level === 'certo' || r.level === 'possibile') && !r.drawable),
    unresolvedNames: [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    unresolvedTotal: unresolved.size, anonymous, queueSize,
    patchMismatch: currentPatch ? by((r) => r.level !== 'altra_base' && patchOf(r.v) && !patchOf(r.v).startsWith(currentPatch)) : 0,
    patchUnknown: by((r) => r.level !== 'altra_base' && !patchOf(r.v)),
    interplanetary: uniq(res.sections.interplanetary).size, interstellar: uniq(res.sections.interstellar).size,
    interplanetarySure: uniq(res.sections.interplanetary.filter((r) => r.link.sure)).size,
    interstellarSure: uniq(res.sections.interstellar.filter((r) => r.link.sure)).size,
  };
  const why = [];
  const shown = res.unique.certain + res.unique.possible + res.unique.regional;
  if (!index.at.has(res.placeId)) why.push('Nessun modello, storico o contratto nomina questo luogo per identificativo (né come ritiro, né come consegna, né come offerta).');
  if (!d.exact) why.push('Nessuna missione con questo luogo come punto fisso: i modelli di catalogo usano quasi sempre pool di alternative.');
  if (d.filteredOut) why.push(`${d.filteredOut} missioni pertinenti escluse dai filtri attivi (origine, compagnia, grado, categoria, SCU, patch, alternative).`);
  if (d.scopeOut) why.push(`${d.scopeOut} missioni escluse dal filtro di distanza "${SCOPES[res.scope]}".`);
  if (d.hiddenByMode) why.push(`${d.hiddenByMode} missioni possibili o regionali nascoste dalla modalità VERIFICATE.`);
  if (d.unresolvedTotal) why.push(`${d.unresolvedTotal} nomi di luogo non risolti in queste missioni: quei punti restano SCONOSCIUTI e non vengono associati.`);
  if (!shown && d.system) why.push(`${d.system} modelli sono associati solo all'intero sistema: non vengono attribuiti a questa base.`);
  if (!shown && d.otherBases) why.push(`${d.otherBases} missioni riguardano altre basi della stessa luna o dello stesso pianeta (sezione ALTRE BASI NELLA REGIONE).`);
  if (!shown) why.push(NO_LINK_NOTE);
  d.why = why;
  return d;
}

// ------------------------------------------------------------------ ricerca per destinazione
/** Insieme dei luoghi della destinazione: il luogo, i suoi discendenti, oppure un intero sistema. */
export function destinationSet(geo, dest) {
  if (!dest) return null;
  if (dest.system) return { label: dest.system, ids: new Set(geo.inSystem(dest.system).map((p) => p.id)), kind: 'sistema' };
  const p = geo.get(dest.id); if (!p) return null;
  return { label: p.name, ids: new Set([p.id, ...descendants(geo, p.id)]), kind: p.kind, place: p };
}

/**
 * VOGLIO ARRIVARE A: contratti che collegano davvero origine e destinazione (stesso contratto),
 * classificati per evidenza, piu' le tratte intermedie documentate (due contratti distinti).
 */
export function expandDestination(index, originId, dest, filters = {}, options = {}) {
  const geo = index.geo;
  const D = destinationSet(geo, dest);
  const exp = expandPlace(index, originId, filters, { ...options, scope: 'tutte' });
  if (!D) return { ok: false, note: 'destinazione non riconosciuta', results: [], chains: [] };
  const out = new Map();
  const consider = (r, evidence) => {
    const drops = r.op ? counterparts(r.v, r.op).filter((o) => o.role === 'dropoff') : r.v.ops.filter((o) => o.role === 'dropoff');
    if (r.op && r.op.role !== 'pickup') return;
    for (const o of drops) {
      const hits = o.ids.filter((id) => D.ids.has(id));
      if (!hits.length) continue;
      let ev = evidence;
      if (ev === 'certo' && !(o.fixed)) ev = 'possibile';
      const prev = out.get(r.v.id);
      if (prev && RANK[prev.evidence] <= RANK[ev]) continue;
      const picks = r.v.ops.filter((x) => x.role === 'pickup');
      out.set(r.v.id, {
        v: r.v, evidence: ev, row: r, origin: originId, hits, dropPool: o.size, drop: o, pickups: picks,
        scu: o.scu ?? (r.v.orders?.length === 1 ? r.v.orders[0].scuMax : null), observedByUser: r.v.origin === 'utente',
        reason: ev === 'certo' ? 'ritiro e consegna certi nello stesso contratto'
          : ev === 'possibile' ? `stesso contratto: ${r.op && !r.op.fixed ? `ritiro uno di ${r.op.size}` : 'ritiro certo'}, consegna ${o.fixed ? 'certa' : `una di ${o.size}`} (${hits.length} nella destinazione)`
            : `associazione regionale dell'origine (${r.anchor?.name ?? ''}); consegna ${o.fixed ? 'certa' : `una di ${o.size}`} nella destinazione`,
      });
    }
  };
  const S = exp.sections;
  for (const r of [...S.certainOut]) consider(r, 'certo');
  for (const r of [...S.possibleOut]) consider(r, 'possibile');
  for (const r of [...S.regional.luna, ...S.regional.pianeta, ...S.offersArea]) if (!r.op || r.op.role === 'pickup') consider(r, 'regionale');
  const results = [...out.values()].sort((a, b) => RANK[a.evidence] - RANK[b.evidence] || (a.v.origin === 'utente' ? -1 : 0) - (b.v.origin === 'utente' ? -1 : 0) || (b.v.reward ?? -1) - (a.v.reward ?? -1) || a.v.id.localeCompare(b.v.id));

  // tratte intermedie documentate: origine -> X (consegna certa) e X -> destinazione (ritiro certo in X)
  const chains = new Map();
  for (const r of [...S.certainOut, ...S.possibleOut]) {
    for (const o of counterparts(r.v, r.op)) {
      if (!o.fixed || D.ids.has(o.ids[0]) || o.ids[0] === originId) continue;
      const X = o.ids[0];
      for (const e of index.at.get(X)?.out ?? []) {
        if (e.strength !== 'fisso' || e.v.id === r.v.id || !keep({ v: e.v, alternatives: 1 }, filters)) continue;
        const d2 = counterparts(e.v, e.op).find((x) => x.ids.some((id) => D.ids.has(id)));
        if (!d2) continue;
        const c = chains.get(X) ?? { via: geo.get(X), first: new Map(), second: new Map() };
        c.first.set(r.v.id, { v: r.v, sure: r.level === 'certo' });
        c.second.set(e.v.id, { v: e.v, sure: d2.fixed });
        chains.set(X, c);
      }
    }
  }
  const chainList = [...chains.values()].map((c) => ({ via: c.via, first: [...c.first.values()], second: [...c.second.values()] }))
    .sort((a, b) => (b.first.filter((x) => x.sure).length + b.second.filter((x) => x.sure).length) - (a.first.filter((x) => x.sure).length + a.second.filter((x) => x.sure).length) || b.second.length - a.second.length || a.via.name.localeCompare(b.via.name))
    .slice(0, 10);
  const counts = { certo: 0, possibile: 0, regionale: 0, utente: 0 };
  for (const x of results) { counts[x.evidence]++; if (x.observedByUser) counts.utente++; }
  const H = hierarchy(geo, originId), sys = D.place?.system ?? dest.system;
  return {
    ok: true, dest: D, origin: geo.get(originId), results, chains: chainList, counts,
    interstellar: H && sys && H.system !== sys,
    none: results.length === 0 ? NO_LINK : null, noneNote: results.length === 0 ? NO_LINK_NOTE : null,
  };
}

// ------------------------------------------------------------------ linee sulla mappa
/**
 * Linee per la scheda estesa: solo collegamenti che toccano il luogo (o la sua regione), dentro il
 * sistema mostrato. Stili: confermata / ipotetica (capi certi), nonverificata (pool), regionale
 * (dal corpo celeste). Le righe non disegnabili restano in elenco con la nota OMITTED; `force` le
 * espande su richiesta. Massimo `cap` linee.
 */
export function expandedSegments(res, geo, system, { force = new Set(), cap = 600 } = {}) {
  const out = []; let omitted = 0, truncated = false;
  const ok = (id) => { const p = geo.get(id); return p?.pos && p.system === system ? p : null; };
  const push = (s) => { if (out.length >= cap) { truncated = true; return; } out.push(s); };
  const S = res.sections;
  const draw = (r, styleOf) => {
    if (!r.op) return;
    if (!r.drawable && !force.has(r.v.id)) { omitted++; return; }
    const here = ok(r.ref); if (!here) return;
    for (const c of counterparts(r.v, r.op)) for (const id of c.ids) {
      const P = ok(id); if (!P || P.id === here.id) continue;
      const [from, to] = r.op.role === 'pickup' ? [here.id, P.id] : [P.id, here.id];
      push({ from, to, style: styleOf(r, c), scu: c.scu ?? null, mission: r.v.id });
    }
  };
  const sure = (r, c) => (r.op.fixed && c.fixed ? (r.v.origin === 'utente' && r.v.committed ? 'confermata' : 'ipotetica') : 'nonverificata');
  for (const r of [...S.certainOut, ...S.certainIn, ...S.possibleOut, ...S.possibleIn]) draw(r, sure);
  for (const r of [...S.regional.luna, ...S.regional.pianeta]) draw(r, () => 'regionale');
  return { segments: out, omitted, truncated };
}
