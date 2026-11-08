// INTELLIGENCE DATABASE: storico delle osservazioni fatte in gioco.
// Si mostrano conteggi e numerosita' del campione, mai probabilita': poche osservazioni personali
// non diventano una statistica.
import { newId, nowIso } from '../core/points.js';
import { normName, patchAge } from './model.js';

export const OUTCOMES = {
  presente: 'Offerta presente',
  assente: 'Offerta non più presente',
  nessuna: 'Bacheca controllata: nessuna offerta di trasporto',
  accettata: 'Accettata',
  completata: 'Completata',
};

/**
 * Normalizza un'osservazione. Una "visita" (controllo della bacheca in un luogo e momento) puo'
 * registrare zero o piu' offerte: outcome "nessuna" = visita senza offerte.
 */
export function normalizeObservation(o, { now = nowIso() } = {}) {
  const errors = [];
  if (!o.place) errors.push('luogo dell\'osservazione mancante');
  if (!OUTCOMES[o.outcome ?? 'presente']) errors.push(`esito "${o.outcome}" non valido`);
  if (errors.length) return { observation: null, errors };
  const n = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : +v);
  return {
    observation: {
      id: o.id || newId(), at: o.at || now, patch: o.patch || null,
      place: String(o.place).trim(), system: o.system ? String(o.system).toLowerCase() : null,
      visit: o.visit || null, // stesso identificativo per le offerte viste nella stessa visita
      offerId: o.offerId || null, title: o.title || null, company: o.company || null,
      pilotRank: o.pilotRank || null, rank: o.rank || null,
      from: o.from || null, to: o.to || null, scu: n(o.scu), reward: n(o.reward),
      outcome: o.outcome ?? 'presente', contractId: o.contractId || null, notes: o.notes || '',
      changes: Array.isArray(o.changes) ? o.changes : [],
    },
    errors,
  };
}

/** Stessa offerta osservata in precedenza (per ID di gioco, altrimenti per contenuto). */
const sameOffer = (a, b) => (a.offerId && b.offerId ? a.offerId === b.offerId
  : !!a.title && normName(a.title) === normName(b.title) && normName(a.company) === normName(b.company)
    && normName(a.from) === normName(b.from) && normName(a.to) === normName(b.to));

/** Variazioni rispetto all'ultima osservazione della stessa offerta (ricompensa, SCU, luoghi). */
export function diffWithPrevious(obs, history) {
  const prev = history.filter((h) => h.id !== obs.id && h.outcome !== 'nessuna' && sameOffer(h, obs) && h.at <= obs.at).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  if (!prev) return [];
  const out = [];
  for (const k of ['reward', 'scu', 'from', 'to', 'patch']) if ((prev[k] ?? null) !== (obs[k] ?? null)) out.push({ field: k, before: prev[k] ?? null, after: obs[k] ?? null, since: prev.at });
  return out;
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function sampleLabel(n) {
  if (n < 3) return 'campione insufficiente';
  if (n < 10) return 'campione piccolo';
  return 'campione discreto';
}

/**
 * "Dove conviene cercare?": classifica dei luoghi per frequenza OSSERVATA nella patch attuale,
 * con numerosita' del campione. I dati di patch precedenti restano visibili ma separati.
 */
export function whereToSearch(observations, { currentPatch = null, system = null } = {}) {
  const rows = new Map();
  for (const o of observations) {
    if (system && o.system && o.system !== system) continue;
    const k = `${o.system ?? ''}|${normName(o.place)}`;
    if (!rows.has(k)) rows.set(k, { place: o.place, system: o.system, cur: { visits: new Map() }, old: { visits: new Map() }, unknown: { visits: new Map() } });
    const age = patchAge(o.patch, currentPatch);
    const bucket = rows.get(k)[age === 'attuale' ? 'cur' : age === 'obsoleto' ? 'old' : 'unknown'];
    const vk = o.visit ?? o.at.slice(0, 16); // visita = stesso luogo, stesso minuto (o stesso ID visita)
    if (!bucket.visits.has(vk)) bucket.visits.set(vk, []);
    bucket.visits.get(vk).push(o);
  }
  const summarize = (b) => {
    const visits = [...b.visits.values()];
    const offers = visits.flatMap((v) => v.filter((o) => o.outcome !== 'nessuna'));
    const withOffers = visits.filter((v) => v.some((o) => o.outcome !== 'nessuna')).length;
    const rps = offers.filter((o) => o.reward && o.scu).map((o) => o.reward / o.scu);
    return {
      visits: visits.length, withOffers, offers: offers.length,
      companies: [...new Set(offers.map((o) => o.company).filter(Boolean))],
      medianRewardPerScu: median(rps), rewardSample: rps.length,
      last: visits.flat().map((o) => o.at).sort().at(-1) ?? null,
      sample: sampleLabel(visits.length),
    };
  };
  const out = [...rows.values()].map((r) => ({ place: r.place, system: r.system, current: summarize(r.cur), previous: summarize(r.old), unknownPatch: summarize(r.unknown) }));
  // ordinamento: visite con offerte nella patch attuale, poi offerte, poi numero di visite; a parita' il nome
  out.sort((a, b) => (b.current.withOffers - a.current.withOffers) || (b.current.offers - a.current.offers)
    || (b.current.visits - a.current.visits) || (b.previous.withOffers - a.previous.withOffers) || a.place.localeCompare(b.place));
  return out;
}

/** Analisi aggregate per compagnia, rotta o patch (conteggi, mai percentuali). */
export function breakdown(observations, by) {
  const key = {
    compagnia: (o) => o.company ?? 'n.d.',
    rotta: (o) => (o.from || o.to ? `${o.from ?? '?'} → ${o.to ?? '?'}` : 'n.d.'),
    patch: (o) => o.patch ?? 'non indicata',
    luogo: (o) => o.place,
  }[by];
  const m = new Map();
  for (const o of observations.filter((x) => x.outcome !== 'nessuna')) {
    const k = key(o);
    if (!m.has(k)) m.set(k, { key: k, n: 0, rewards: [], scu: 0, outcomes: {} });
    const r = m.get(k);
    r.n++; if (o.reward) r.rewards.push(o.reward); r.scu += o.scu ?? 0; r.outcomes[o.outcome] = (r.outcomes[o.outcome] ?? 0) + 1;
  }
  return [...m.values()].map((r) => ({ ...r, medianReward: median(r.rewards), sample: sampleLabel(r.n) })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}
