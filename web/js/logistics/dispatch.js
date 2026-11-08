// ADAPTIVE DISPATCH: azioni durante il viaggio e ricalcolo dallo stato reale.
// Il ricalcolo parte SEMPRE dai contratti salvati (accettati, merce in stiva, consegne dovute):
// nessuna azione puo' far sparire un contratto accettato o un carico a bordo.
import { nowIso } from '../core/points.js';
import { contractDone, isCommitted, normalizeContract, recordDelivery, recordLoad, transition } from './model.js';
import { normalizeObservation, whereToSearch } from './intel.js';
import { planDispatch } from './optimizer.js';
import { placeKey } from './places.js';

export const ACTIONS = {
  trovata: 'Missione trovata',
  non_disponibile: 'Missione non disponibile',
  accettata: 'Missione accettata',
  ritirato: 'Carico ritirato',
  consegna_parziale: 'Consegna parziale',
  consegnata: 'Consegna completata',
  fallita: 'Missione fallita',
  salta: 'Salta questa stazione',
  arrivo: 'Sono arrivato qui',
  ricalcola: 'Ricalcola il viaggio',
};

export const newDispatch = (position = null) => ({ position, skip: [], log: [] });

/**
 * Applica un'azione. Restituisce i contratti modificati/nuovi e le osservazioni da salvare.
 * @param state {position, skip:string[], log}
 * @param a {type, contractId?, movementId?, qty?, contract?, place?, patch?}
 */
export function applyAction(state, contracts, a, { now = nowIso(), patch = null } = {}) {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const c = a.contractId ? byId.get(a.contractId) : null;
  if (a.contractId && !c) throw new Error('Contratto non trovato.');
  const changed = [], observations = [], messages = [];
  let st = { ...state, log: [...state.log, { at: now, type: a.type, contractId: a.contractId ?? null, place: a.place?.name ?? state.position?.name ?? null }] };
  const obs = (o) => { const r = normalizeObservation({ at: now, patch, place: st.position?.name ?? a.place?.name, system: st.position?.system, ...o }, { now }); if (r.observation) observations.push(r.observation); };
  switch (a.type) {
    case 'trovata': {
      const r = normalizeContract({ status: 'osservata', offerZone: st.position?.name ?? null, observedAt: now, patch, ...a.contract });
      if (!r.contract) throw new Error(r.errors.join('; '));
      changed.push(r.contract);
      const m0 = r.contract.movements[0];
      obs({ offerId: r.contract.offerId, title: r.contract.title, company: r.contract.company, rank: r.contract.rank, from: m0?.from?.name, to: m0?.to?.name, scu: r.contract.movements.reduce((s, m) => s + m.scu, 0), reward: r.contract.reward, outcome: 'presente', contractId: r.contract.id });
      messages.push(...r.warnings);
      break;
    }
    case 'non_disponibile': {
      if (isCommitted(c)) throw new Error('Un contratto già accettato non può diventare "non disponibile": usa "Missione fallita" se l\'hai perso.');
      changed.push(transition(c, 'non_disponibile', { now, note: 'offerta non trovata' }));
      obs({ offerId: c.offerId, title: c.title, company: c.company, outcome: 'assente', contractId: c.id, place: c.offerZone ?? st.position?.name });
      break;
    }
    case 'accettata':
      changed.push(transition(c, 'accettata', { now, note: 'accettata nel MobiGlas' }));
      obs({ offerId: c.offerId, title: c.title, company: c.company, outcome: 'accettata', contractId: c.id, reward: c.reward, place: c.offerZone ?? st.position?.name });
      break;
    case 'ritirato':
      if (!isCommitted(c)) throw new Error('Accetta il contratto prima di registrare un ritiro.');
      changed.push(recordLoad(c, a.movementId, a.qty ?? null, { now }));
      break;
    case 'consegna_parziale':
    case 'consegnata': {
      if (!isCommitted(c)) throw new Error('Il contratto non è accettato.');
      const m = c.movements.find((x) => x.id === a.movementId);
      const out = recordDelivery(c, a.movementId, a.type === 'consegnata' ? null : a.qty, { now });
      changed.push(out);
      if (m && contractDone(out)) obs({ offerId: c.offerId, title: c.title, company: c.company, outcome: 'completata', contractId: c.id, reward: c.reward, place: c.offerZone ?? st.position?.name });
      break;
    }
    case 'fallita': {
      const held = c.movements.reduce((s, m) => s + m.loaded - m.delivered, 0);
      // la merce a bordo resta registrata: e' l'utente a dire se l'ha ancora (nessuna ipotesi)
      changed.push(transition(c, 'fallita', { now, note: held ? `missione fallita con ${held} SCU registrati a bordo: verifica la stiva` : 'missione fallita' }));
      if (held) messages.push(`Restano registrati ${held} SCU di "${c.title}": controlla in gioco se le casse sono ancora a bordo e liberale dal manifesto.`);
      break;
    }
    case 'salta': {
      const k = placeKey(a.place ?? st.position);
      if (!st.skip.includes(k)) st = { ...st, skip: [...st.skip, k] };
      const mandatory = contracts.filter(isCommitted).filter((x) => x.movements.some((m) => (m.loaded < m.scu && placeKey(m.from) === k) || (m.delivered < m.scu && placeKey(m.to) === k)));
      if (mandatory.length) messages.push(`Non si può saltare del tutto ${a.place?.name ?? 'questa stazione'}: contiene operazioni obbligatorie per ${mandatory.map((x) => x.title).join(', ')}.`);
      break;
    }
    case 'arrivo':
      st = { ...st, position: a.place };
      break;
    case 'ricalcola':
      break;
    default:
      throw new Error(`Azione sconosciuta: ${a.type}`);
  }
  return { state: st, changed, observations, messages };
}

/**
 * Ricalcolo dallo stato attuale. Le stazioni saltate escludono i contratti confermati (non
 * accettati) che vi hanno operazioni; quelli accettati restano obbligatori.
 */
export function recompute(state, contracts, ctx) {
  const skip = new Set(state.skip);
  const skipIds = new Set(contracts.filter((c) => !isCommitted(c)).filter((c) => c.movements.some((m) => skip.has(placeKey(m.from)) || skip.has(placeKey(m.to)))).map((c) => c.id));
  return planDispatch(contracts, { ...ctx, start: state.position, skip: skipIds });
}

/**
 * Stazioni alternative quando un'offerta non c'e': luoghi con offerte osservate nella patch
 * attuale. E' una PREVISIONE (storico), mai un contratto: va verificata in gioco.
 */
export function alternativeStations(observations, { currentPatch, exclude = null, limit = 5 } = {}) {
  return whereToSearch(observations, { currentPatch })
    .filter((w) => w.current.withOffers > 0 && (!exclude || placeKey({ name: w.place, system: w.system }) !== placeKey(exclude)))
    .slice(0, limit).map((w) => ({ ...w, kind: 'previsione' }));
}
