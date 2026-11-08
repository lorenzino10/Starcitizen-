// EXPERIENCE ENGINE e DISCOVERY MODE: statistica semplice sulle tue osservazioni (frequenze, medie,
// conteggi) e un punteggio DETERMINISTICO e spiegabile delle basi da verificare. Nessuna IA, nessuna
// probabilita' inventata: con campioni piccoli si dice "campione insufficiente".
// Una missione non registrata NON e' considerata assente: "assente" vale solo per le visite in cui
// hai dichiarato di aver consultato il pannello pertinente (esito "nessuna" o "assente").
import { patchAge } from '../logistics/model.js';
import { sampleLabel } from '../logistics/intel.js';

export const LEVELS = {
  mai: { icon: '○', color: '#5b7a99', label: 'Mai verificata' },
  parziale: { icon: '◐', color: '#ffb347', label: 'Verificata poche volte' },
  numerosa: { icon: '●', color: '#5dff9d', label: 'Molte osservazioni' },
  obsoleta: { icon: '◌', color: '#a98fd1', label: 'Solo dati di patch precedenti' },
  storica: { icon: '★', color: '#3fd0ff', label: 'Opportunità osservate in passato' },
  conflitto: { icon: '⚠', color: '#ff5f6d', label: 'Fonti in conflitto' },
};
export const WEIGHTS = { novita: 3, eta: 1.5, potenziale: 3, destinazione: 2, deviazione: 2, fonti: 1.5, costo: 1 };

/** Osservazioni per luogo canonico (il nome registrato viene risolto sul database geografico). */
export function observationsByPlace(observations, geo) {
  const m = new Map();
  for (const o of observations) {
    const p = geo.resolveName(o.place, o.system);
    if (!p) continue;
    if (!m.has(p.id)) m.set(p.id, []);
    m.get(p.id).push(o);
  }
  return m;
}

/** Statistiche di un luogo, separate per patch attuale / precedente / ignota. */
export function placeStats(obs, { currentPatch = null } = {}) {
  const buckets = { attuale: [], obsoleto: [], sconosciuta: [] };
  for (const o of obs) buckets[patchAge(o.patch, currentPatch)].push(o);
  const visitKey = (o) => o.visit ?? o.at.slice(0, 16);
  const sum = (list) => {
    const visits = new Map();
    for (const o of list) { const k = visitKey(o); if (!visits.has(k)) visits.set(k, []); visits.get(k).push(o); }
    const v = [...visits.values()];
    const offers = list.filter((o) => o.outcome === 'presente' || o.outcome === 'accettata' || o.outcome === 'completata');
    const empty = v.filter((x) => x.every((o) => o.outcome === 'nessuna')).length;
    const rewards = offers.map((o) => o.reward).filter((x) => Number.isFinite(x));
    const pairs = new Map();
    for (const o of offers) if (o.from || o.to) { const k = `${o.from ?? '?'} → ${o.to ?? '?'}`; pairs.set(k, (pairs.get(k) ?? 0) + 1); }
    return {
      visits: v.length, offers: offers.length, emptyVisits: empty, accepted: list.filter((o) => o.outcome === 'accettata').length, completed: list.filter((o) => o.outcome === 'completata').length,
      meanReward: rewards.length ? rewards.reduce((s, x) => s + x, 0) / rewards.length : null, rewardSample: rewards.length,
      topPairs: [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), sample: sampleLabel(v.length),
      last: list.map((o) => o.at).sort().at(-1) ?? null,
    };
  };
  return { current: sum(buckets.attuale), previous: sum(buckets.obsoleto), unknown: sum(buckets.sconosciuta) };
}

/** Livello Discovery di un luogo. */
export function levelOf(stats, entries) {
  const cur = stats.current.visits, any = cur + stats.previous.visits + stats.unknown.visits;
  const catalogOnly = entries.length && entries.every((e) => e.v.origin === 'catalogo');
  if (stats.current.emptyVisits >= 3 && entries.some((e) => e.strength === 'fisso') && stats.current.offers === 0) return 'conflitto';
  if (!any) return entries.some((e) => e.v.origin === 'storica') && !catalogOnly ? 'storica' : 'mai';
  if (!cur && (stats.previous.visits || stats.unknown.visits)) return 'obsoleta';
  return cur >= 3 ? 'numerosa' : 'parziale';
}

/**
 * Punteggio di verifica per un luogo (0-100) con la spiegazione di ogni componente.
 * @param ctx {geo, index, obsByPlace, currentPatch, now, from:placeId, destination:placeId, maxDeviation:m, drive}
 */
export function discoveryScore(placeId, ctx) {
  const p = ctx.geo.get(placeId);
  const obs = ctx.obsByPlace.get(placeId) ?? [];
  const st = placeStats(obs, { currentPatch: ctx.currentPatch });
  const s = ctx.index.at.get(placeId) ?? { out: [], in: [] };
  const entries = [...s.out, ...s.in];
  const fixed = new Set(entries.filter((e) => e.strength === 'fisso').map((e) => e.v.id)).size;
  const possible = new Set(entries.filter((e) => e.strength !== 'fisso').map((e) => e.v.id)).size;
  const parts = [], why = [];
  const add = (k, v, text) => { parts.push({ k, v: Math.max(0, Math.min(1, v)), w: WEIGHTS[k], text }); };
  const visits = st.current.visits;
  add('novita', visits === 0 ? 1 : 1 / (1 + visits), visits === 0 ? 'mai verificata nella patch attuale' : `${visits} visite registrate nella patch attuale`);
  const days = st.current.last ? (Date.parse(ctx.now ?? new Date().toISOString()) - Date.parse(st.current.last)) / 864e5 : null;
  add('eta', days === null ? 1 : days / 14, days === null ? 'nessuna visita recente' : `ultima visita ${Math.round(days)} giorni fa`);
  add('potenziale', Math.log1p(fixed * 3 + possible * 0.05) / Math.log1p(30), `${fixed} missioni con luogo certo, ${possible} in cui è uno dei luoghi possibili`);
  if (ctx.destination) {
    ctx.destIn ??= new Map((ctx.index.at.get(ctx.destination)?.in ?? []).map((e) => [e.v.id, e.strength]));
    const toDest = s.out.filter((e) => ctx.destIn.has(e.v.id));
    const sure = toDest.some((e) => e.strength === 'fisso' && ctx.destIn.get(e.v.id) === 'fisso');
    add('destinazione', sure ? 1 : toDest.length ? 0.4 : 0, toDest.length ? `${new Set(toDest.map((e) => e.v.id)).size} missioni note con ritiro qui e consegna alla destinazione${sure ? '' : ' (almeno un capo è uno fra più luoghi)'}` : 'nessuna missione nota verso la destinazione');
  }
  if (ctx.from) {
    const d = ctx.geo.distance(ctx.from, placeId);
    const max = ctx.maxDeviation ?? 50e9;
    add('deviazione', d === null ? 0 : 1 - d / max, d === null ? 'distanza non calcolabile (altro sistema o posizione ignota)' : `a ${(d / 1e9).toFixed(1)} Gm dalla posizione`);
    if (ctx.drive && d !== null) { const h = (d / ctx.drive.vmax) / 3600; add('costo', 1 - h, `verifica: circa ${Math.round(h * 60)} min di quantum (stima dal drive impostato)`); }
  }
  const q = entries.some((e) => e.v.origin === 'utente') ? 1 : entries.some((e) => e.v.origin === 'storica') ? 0.8 : fixed ? 0.6 : possible ? 0.3 : 0;
  add('fonti', q, q >= 0.8 ? 'opportunità osservate (tue o di fonti terze)' : q ? 'solo modelli di catalogo' : 'nessuna fonte di missioni');
  const wsum = parts.reduce((a, x) => a + x.w, 0);
  const score = Math.round((parts.reduce((a, x) => a + x.v * x.w, 0) / wsum) * 100);
  const level = levelOf(st, entries);
  if (level === 'conflitto') why.push('il catalogo indica missioni con ritiro o consegna certi qui, ma le tue ultime visite non hanno trovato offerte');
  return { place: p, score, parts, level, stats: st, why };
}

/** "Quali basi dovrei verificare?": classifica deterministica (punteggio, poi nome). */
export function rankDiscovery(ctx, { system = null, kinds = new Set(['station', 'outpost', 'city', 'gateway']), limit = 25 } = {}) {
  return ctx.geo.places.filter((p) => (!system || p.system === system) && kinds.has(p.kind) && !p.hidden)
    .map((p) => discoveryScore(p.id, ctx))
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name)).slice(0, limit);
}
