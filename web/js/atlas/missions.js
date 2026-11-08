// LOCATION MISSION INTELLIGENCE: missioni di trasporto associate ai luoghi canonici dell'atlante.
//
// Tre concetti separati per ogni missione:
//   OFFERTA  (offer)   dove il contratto puo' essere visto o accettato, quando noto;
//   RITIRO   (pickup)  dove si ritira fisicamente la merce;
//   CONSEGNA (dropoff) dove va consegnata.
// L'offerta non viene MAI copiata nel ritiro. Un pool di N luoghi resta un insieme di N alternative
// assegnate dal gioco: "Punto da confermare nel MobiGlas" finche' N > 1.
//
// Origini delle missioni (mai mescolate):
//   catalogo  modelli dai file di gioco (scunpacked)           -> non sono offerte
//   storica   missioni osservate da terzi (SCHaulingPlanner)  -> esistite in passato, patch ignota
//   utente    contratti tuoi (MISSION BOARD / LogisticsDB)    -> con il loro stato
import { normName, isCommitted } from '../logistics/model.js';
import { expandPlace, expandDestination, counterparts } from './expanded.js';

export const ORIGIN = {
  utente: { icon: '🟢', label: 'Contratto tuo' },
  storica: { icon: '🔵', label: 'Osservata in passato (fonte terza)' },
  catalogo: { icon: '🟠', label: 'Modello dai file di gioco: non è un\'offerta' },
};
export const TO_CONFIRM = 'Punto da confermare nel MobiGlas';

/** Esito della risoluzione di un nome: id canonico o coda di normalizzazione. */
function resolver(geo, queue) {
  return (name, system, from) => {
    if (!name) return null;
    const p = geo.resolveName(name, system);
    if (p) return p.id;
    const k = normName(name);
    const q = queue.get(k) ?? { name, count: 0, sources: new Set(), how: 'non trovato' };
    q.count++; q.sources.add(from); queue.set(k, q);
    return null;
  };
}

const op = (role, slot, { ids = [], size = ids.length, unresolved = [], ambiguous = [], anonymous = 0, cargo = null, scu = null, scuMin = null, containerMax = null, movementId = null }) => ({
  role, slot, ids, size, unresolved, ambiguous, anonymous, cargo, scu, scuMin, containerMax, movementId,
  fixed: size === 1 && ids.length === 1,
});

/** Modelli del catalogo scunpacked -> viste missione. */
export function catalogViews(cat) {
  if (!cat?.missions) return [];
  const P = cat.places, N = cat.names;
  return cat.missions.map((m) => {
    const ops = m.pools.map((p) => op(p.role, p.slot, {
      ids: p.ids.map((i) => P[i]), size: p.size, unresolved: p.unresolved.map((i) => N[i]), ambiguous: p.ambiguous.map((i) => N[i]), anonymous: p.anonymous,
    }));
    // quantita': solo se il modello ha UN ritiro e UNA consegna e UN ordine; altrimenti restano a livello di missione
    if (ops.length === 2 && m.orders.length === 1) for (const o of ops) Object.assign(o, { cargo: m.orders[0].cargo, scu: m.orders[0].scuMax, scuMin: m.orders[0].scuMin, containerMax: m.orders[0].containerMax ?? m.maxBox });
    return {
      id: m.id, origin: 'catalogo', status: 'catalogo', category: m.category, type: m.type, title: m.title, company: m.company,
      rank: m.rank, rankIndex: m.rankIndex, reward: m.reward, rewardNote: m.reward === null ? 'ricompensa calcolata dal gioco al momento: non nei file' : 'ricompensa fissa del modello',
      patch: m.patch ?? cat.meta?.patch ?? null, source: cat.meta?.source ?? 'scunpacked', system: m.system,
      offer: m.offer.map((i) => ({ id: P[i], kind: 'possibile' })), offerUnknown: m.offerUnknown,
      ops, orders: m.orders, maxBox: m.maxBox, timeLimit: m.timeLimit, illegal: m.illegal,
    };
  });
}

/** Missioni osservate di SCHaulingPlanner (catalog-schp.json) -> viste missione. */
export function schpViews(cat, geo, queue = new Map()) {
  if (!cat?.entries) return [];
  const res = resolver(geo, queue);
  return cat.entries.map((e) => {
    const sys = e.systems[0] ?? null;
    const ops = [];
    e.movements.forEach((mv, i) => {
      // ogni ritiro elencato e' un punto da visitare (non alternative); la ripartizione SCU fra piu' ritiri non e' nota
      mv.from.names.forEach((n, k) => {
        const id = res(n, sys, 'SCHaulingPlanner');
        ops.push(op('pickup', i + 1, { ids: id ? [id] : [], size: 1, unresolved: id ? [] : [n], cargo: mv.cargo, scu: mv.from.names.length === 1 ? mv.scu : null, movementId: `m${i + 1}${mv.from.names.length > 1 ? String.fromCharCode(97 + k) : ''}` }));
      });
      mv.to.names.forEach((n) => {
        const id = res(n, sys, 'SCHaulingPlanner');
        ops.push(op('dropoff', i + 1, { ids: id ? [id] : [], size: 1, unresolved: id ? [] : [n], cargo: mv.cargo, scu: mv.scu, movementId: `m${i + 1}` }));
      });
    });
    const offer = e.offerZones.map((z) => { const id = res(z, sys, 'SCHaulingPlanner (offerta)'); return id ? { id, kind: 'osservata' } : { id: null, name: z, kind: 'osservata' }; });
    return {
      id: e.id, origin: 'storica', status: 'storica', category: 'hauling', type: e.missionType, title: e.title, company: e.company,
      rank: e.rank, rankIndex: e.rankIndex, reward: e.reward, rewardNote: 'ricompensa osservata dalla fonte', patch: null, observedAt: e.observedAt,
      source: 'SCHaulingPlanner', system: sys, offer, offerUnknown: 0, ops, orders: [], notes: e.notes,
      splitUnknown: e.movements.some((m) => m.from.names.length > 1),
    };
  });
}

/** Contratti dell'utente (LogisticsDB) -> viste missione. */
export function userViews(contracts, geo, queue = new Map()) {
  const res = resolver(geo, queue);
  return contracts.map((c) => {
    const ops = [];
    c.movements.forEach((m, i) => {
      const a = res(m.from?.name, m.from?.system ?? c.system, 'contratti'), b = res(m.to?.name, m.to?.system ?? c.system, 'contratti');
      const base = { cargo: m.cargo, scu: m.scu, containerMax: m.containerMax, movementId: m.id };
      ops.push(op('pickup', i + 1, { ...base, ids: a ? [a] : [], size: m.from?.name ? 1 : 0, unresolved: m.from?.name && !a ? [m.from.name] : [] }));
      ops.push(op('dropoff', i + 1, { ...base, ids: b ? [b] : [], size: m.to?.name ? 1 : 0, unresolved: m.to?.name && !b ? [m.to.name] : [] }));
    });
    const offId = c.offerZone ? res(c.offerZone, c.system, 'contratti (offerta)') : null;
    return {
      id: `user:${c.id}`, contractId: c.id, origin: 'utente', status: c.status, category: 'hauling', type: null, title: c.title, company: c.company,
      rank: c.rank, rankIndex: null, reward: c.reward, rewardNote: c.reward === null ? 'ricompensa non indicata' : 'ricompensa del contratto',
      patch: c.patch, observedAt: c.observedAt, source: c.source, system: c.system,
      offer: c.offerZone ? [{ id: offId, name: c.offerZone, kind: 'vista' }] : [], offerUnknown: 0,
      ops, orders: [], committed: isCommitted(c), contract: c,
    };
  });
}

/** Una missione e' pianificabile se ogni operazione ha un unico luogo noto e la quantita'. */
export function plannable(v) {
  const missing = [];
  if (!v.ops.length) missing.push('nessun punto di ritiro o consegna nei dati');
  for (const o of v.ops) {
    if (o.regionalBody) missing.push(`${o.role === 'pickup' ? 'ritiro' : 'consegna'} ${o.slot}: il dato indica solo un corpo celeste, non una base (${TO_CONFIRM})`);
    else if (!o.fixed) missing.push(o.size > 1 ? `${o.role === 'pickup' ? 'ritiro' : 'consegna'} ${o.slot}: uno fra ${o.size} luoghi (${TO_CONFIRM})` : `${o.role === 'pickup' ? 'ritiro' : 'consegna'} ${o.slot}: luogo non riconosciuto${o.unresolved.length ? ` (${o.unresolved[0]})` : ''}`);
    else if (!(o.scu > 0) && o.role === 'dropoff') missing.push(`${o.cargo ?? 'merce'}: quantità SCU non nota`);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Indice luoghi -> missioni. Per ogni luogo: in uscita (ritiro qui), in entrata (consegna qui),
 * in transito (il luogo e' uno di piu' scali di una missione con ritiri o consegne multipli),
 * offerte (il contratto puo' comparire qui).
 */
export class MissionIndex {
  constructor(views, geo) {
    this.geo = geo; this.views = views; this.byId = new Map(views.map((v) => [v.id, v]));
    // un "luogo unico" che e' un corpo celeste (pool = "Vala") NON e' un punto fisso: indica solo la
    // regione, la base la sceglie il gioco. Diventa regionale, mai certo ne' pianificabile.
    for (const v of views) for (const o of v.ops) {
      if (o.fixed && geo?.get(o.ids[0]) && ['star', 'planet', 'moon'].includes(geo.get(o.ids[0]).kind)) { o.fixed = false; o.regionalBody = true; }
    }
    this.at = new Map(); // placeId -> {out:[], in:[], transit:[], offer:[]}
    const slot = (id) => { if (!this.at.has(id)) this.at.set(id, { out: [], in: [], transit: [], offer: [] }); return this.at.get(id); };
    for (const v of views) {
      const pick = v.ops.filter((o) => o.role === 'pickup'), drop = v.ops.filter((o) => o.role === 'dropoff');
      const multi = new Set([...pick, ...drop].flatMap((o) => o.ids)).size > 2;
      for (const o of v.ops) for (const id of o.ids) {
        const e = { v, op: o, strength: o.fixed ? 'fisso' : 'possibile', alternatives: o.size };
        slot(id)[o.role === 'pickup' ? 'out' : 'in'].push(e);
        if (multi && (pick.length > 1 || drop.length > 1)) slot(id).transit.push(e);
      }
      for (const of of v.offer) if (of.id) slot(of.id).offer.push({ v, kind: of.kind });
    }
    // ordinamento: tuoi, storici, catalogo; poi luogo fisso prima di "uno fra N"; poi pool piu' piccoli
    const rank = { utente: 0, storica: 1, catalogo: 2 };
    const cmp = (a, b) => rank[a.v.origin] - rank[b.v.origin] || (a.strength === b.strength ? 0 : a.strength === 'fisso' ? -1 : 1) || a.alternatives - b.alternatives || (b.v.reward ?? -1) - (a.v.reward ?? -1) || a.v.id.localeCompare(b.v.id);
    for (const s of this.at.values()) for (const k of ['out', 'in', 'transit']) s[k] = dedupe(s[k]).sort(cmp);
    // indici geografici costruiti una volta al caricamento (l'indice si ricrea solo quando cambiano i dati)
    this.bySystem = new Map();
    for (const v of views) { const k = v.system ?? 'n.d.'; if (!this.bySystem.has(k)) this.bySystem.set(k, []); this.bySystem.get(k).push(v); }
  }

  /**
   * Ricerca geografica estesa (CERTO / POSSIBILE / REGIONALE / ALTRE BASI), vedi expanded.js.
   * forPlace() resta invariato per chi lo usa gia'.
   */
  forPlaceExpanded(placeId, filters = {}, options = {}) { return expandPlace(this, placeId, filters, options); }

  /** VOGLIO ARRIVARE A: dest = {id} (luogo, pianeta, luna) oppure {system}. */
  forDestination(originId, dest, filters = {}, options = {}) { return expandDestination(this, originId, dest, filters, options); }

  /** Diagnostica di un luogo (conteggi e motivi di uno zero). */
  diagnostics(placeId, filters = {}, options = {}) { return this.forPlaceExpanded(placeId, filters, options).diagnostics; }

  /**
   * Collegamenti separati in: linee disegnabili (pool <= maxDraw) e missioni trovate ma non
   * disegnate. Il numero di missioni pertinenti non dipende dal limite grafico.
   */
  connectionsSplit(placeId, filters = {}, maxDraw = 10) {
    const lines = this.connections(placeId, { ...filters, maxAlternatives: maxDraw });
    const drawn = new Set(lines.flatMap((c) => c.missions));
    const found = new Set(), omitted = [];
    for (const role of ['out', 'in']) for (const e of this.at.get(placeId)?.[role] ?? []) {
      if (!keep({ v: e.v, alternatives: 1 }, { ...filters, maxAlternatives: null })) continue;
      if (!counterparts(e.v, e.op).length) continue;
      found.add(e.v.id);
      if (!drawn.has(e.v.id) && !omitted.some((x) => x.v.id === e.v.id)) omitted.push({ v: e.v, alternatives: Math.max(e.op.size, ...counterparts(e.v, e.op).map((o) => o.size)) });
    }
    return { lines, found: found.size, drawn: drawn.size, omitted };
  }

  /** @param filters {origin:Set, company, maxRank, category, minScu, patch, maxAlternatives} */
  forPlace(id, filters = {}) {
    const s = this.at.get(id) ?? { out: [], in: [], transit: [], offer: [] };
    const ok = (e) => keep(e, filters);
    return { out: s.out.filter(ok), in: s.in.filter(ok), transit: s.transit.filter(ok), offer: s.offer.filter((e) => keep({ v: e.v, alternatives: 1 }, filters)) };
  }

  /** Numero di missioni (uniche) per luogo, per il livello della mappa. */
  counts(filters = {}) {
    const out = new Map();
    for (const [id, s] of this.at) {
      const set = new Set([...s.out, ...s.in].filter((e) => keep(e, filters)).map((e) => e.v.id));
      if (set.size) out.set(id, set.size);
    }
    return out;
  }

  /**
   * SHOW ALL CONNECTIONS: collegamenti origine/destinazione noti per un luogo, aggregati per coppia.
   * Un collegamento esiste solo dove la stessa missione ha un ritiro in A e una consegna in B.
   * strength: 'fisso' (entrambi i capi certi), 'possibile' (almeno un capo e' una di N alternative).
   */
  connections(placeId, filters = {}) {
    const pairs = new Map();
    for (const v of this.views) {
      if (!keep({ v, alternatives: 1 }, filters)) continue;
      const pick = v.ops.filter((o) => o.role === 'pickup'), drop = v.ops.filter((o) => o.role === 'dropoff');
      for (const a of pick) for (const b of drop) {
        const max = filters.maxAlternatives ?? Infinity;
        if (a.size > max || b.size > max) continue;
        const aHere = a.ids.includes(placeId), bHere = b.ids.includes(placeId);
        if (!aHere && !bHere) continue;
        const ends = aHere ? b.ids.map((x) => [placeId, x]) : a.ids.map((x) => [x, placeId]);
        for (const [f, t] of ends) {
          if (f === t) continue;
          const k = `${f}>${t}`;
          const e = pairs.get(k) ?? { from: f, to: t, missions: new Set(), fixed: 0, possible: 0, origins: new Set() };
          if (!e.missions.has(v.id)) { e.missions.add(v.id); (a.fixed && b.fixed ? e.fixed++ : e.possible++); e.origins.add(v.origin); }
          pairs.set(k, e);
        }
      }
    }
    return [...pairs.values()].map((e) => ({ ...e, missions: [...e.missions], origins: [...e.origins], strength: e.fixed ? 'fisso' : 'possibile' }))
      .sort((a, b) => b.fixed - a.fixed || b.missions.length - a.missions.length || a.to.localeCompare(b.to));
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((e) => { const k = `${e.v.id}|${e.op.role}|${e.op.slot}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function keep(e, f) {
  const v = e.v;
  if (f.origin && !f.origin.has(v.origin)) return false;
  if (f.company && v.company !== f.company) return false;
  if (f.category && v.category !== f.category) return false;
  if (Number.isInteger(f.maxRank) && Number.isInteger(v.rankIndex) && v.rankIndex > f.maxRank) return false;
  if (f.maxAlternatives && e.alternatives > f.maxAlternatives) return false;
  if (f.minScu) { const scu = v.ops.reduce((s, o) => s + (o.role === 'dropoff' ? o.scu ?? 0 : 0), 0) || Math.max(0, ...v.orders.map((o) => o.scuMax ?? 0)); if (scu < f.minScu) return false; }
  if (f.patch && v.patch && !String(v.patch).startsWith(f.patch)) return false;
  if (f.hideIllegal && v.illegal) return false;
  return true;
}

/**
 * Segmenti da disegnare per una missione (MISSION ROUTE VISUALIZER), solo dentro `system`.
 *  confermata    ritiro e consegna certi di un contratto tuo accettato
 *  ipotetica     ritiro e consegna certi, contratto non (ancora) accettato
 *  nonverificata almeno un capo e' una di poche alternative (pool <= maxPool): collegamento possibile
 *  offerta       dal luogo dell'offerta al primo ritiro certo
 * Nessun segmento fra sistemi diversi (si passa da un jump point) ne' verso luoghi senza posizione.
 */
export function missionSegments(v, geo, system, { maxPool = 8 } = {}) {
  const out = [];
  const ok = (id) => { const p = geo.get(id); return p?.pos && p.system === system ? p : null; };
  const sure = v.origin === 'utente' && v.committed;
  const picks = v.ops.filter((o) => o.role === 'pickup'), drops = v.ops.filter((o) => o.role === 'dropoff');
  for (const a of picks) for (const b of drops) {
    if (a.slot !== b.slot && picks.length > 1 && drops.length > 1) continue;
    if (a.fixed && b.fixed) {
      const A = ok(a.ids[0]), B = ok(b.ids[0]);
      if (A && B && A.id !== B.id) out.push({ from: A.id, to: B.id, style: sure ? 'confermata' : 'ipotetica', scu: b.scu ?? null });
    } else if (a.size <= maxPool && b.size <= maxPool) {
      for (const x of a.ids) for (const y of b.ids) { const A = ok(x), B = ok(y); if (A && B && x !== y) out.push({ from: x, to: y, style: 'nonverificata', scu: null }); }
    }
  }
  const first = picks.find((o) => o.fixed && ok(o.ids[0]));
  for (const of of v.offer) { const P = of.id ? ok(of.id) : null; if (P && first && P.id !== first.ids[0]) out.push({ from: P.id, to: first.ids[0], style: 'offerta', scu: null }); }
  return out;
}

/** Coda di normalizzazione unificata (catalogo + nomi non riconosciuti di storico e contratti). */
export function normalizationQueue(cat, extra) {
  const out = (cat?.queue ?? []).map((q) => ({ name: q.name, count: q.count, how: q.how, sources: ['scunpacked'] }));
  for (const q of extra.values()) out.push({ name: q.name, count: q.count, how: q.how, sources: [...q.sources] });
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Possibili duplicati fra contratti dell'utente (stesso datore, ricompensa e percorso). */
export function findDuplicates(contracts) {
  const key = (c) => [normName(c.company), c.reward ?? '', ...c.movements.map((m) => `${normName(m.from?.name)}>${normName(m.to?.name)}:${m.scu}`).sort()].join('|');
  const groups = new Map();
  for (const c of contracts) { const k = key(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  return [...groups.values()].filter((g) => g.length > 1);
}
