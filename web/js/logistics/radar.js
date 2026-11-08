// FREIGHT RADAR: dove potrebbero esserci carichi compatibili lungo un percorso conveniente.
// Risponde con stazioni DA VERIFICARE, mai con offerte disponibili. Nessuna probabilita':
// per ogni stazione si mostrano fonti, patch, livello di evidenza e cosa resta da verificare.
import { distance } from '../core/vector.js';
import { normName, patchAge, rankIndex } from './model.js';
import { whereToSearch } from './intel.js';

export const ALTERNATIVES = {
  conservativa: 'Conservativa: solo luoghi in cui hai osservato offerte nella patch attuale, deviazione minima',
  equilibrata: 'Equilibrata: osservazioni attuali e catalogo della patch attuale, posizioni note',
  esplorativa: 'Esplorativa: anche catalogo storico e luoghi senza posizione nota (da esplorare)',
};

/** Livello di evidenza di un'opportunita' (dal piu' forte al piu' debole). */
export const EVIDENCE_LEVELS = {
  osservata_attuale: { rank: 0, label: 'osservata da te nella patch attuale', icon: '🟢' },
  osservata_storica: { rank: 1, label: 'osservata da te in una patch precedente', icon: '🔵' },
  catalogo_attuale: { rank: 2, label: 'modello di missione della patch attuale (Wiki API)', icon: '🟠' },
  catalogo_storico: { rank: 3, label: 'catalogo storico, patch non dichiarata', icon: '⚪' },
};

/**
 * @param input {start:{name,system}, dest:{name,system}|null, capacity, ship, ranks, maxStops,
 *               systems:{include?:string[], exclude?:string[]}, priority, currentPatch, open:boolean}
 * @param data  {catalog:entry[], observations:obs[], places:PlaceIndex}
 */
export function freightRadar(input, { catalog = [], observations = [], places }) {
  const issues = [];
  const P = (n, s) => (n ? places.resolve(n, s) : null);
  const start = P(input.start?.name, input.start?.system);
  const dest = input.open ? null : P(input.dest?.name, input.dest?.system);
  if (input.start?.name && !start) issues.push(`Posizione di partenza "${input.start.name}" non nota: deviazioni non calcolabili.`);
  if (!input.open && input.dest?.name && !dest) issues.push(`Destinazione "${input.dest.name}" non nota: deviazioni non calcolabili.`);
  if (!input.open && !input.dest?.name) issues.push('Destinazione finale non indicata: itinerario trattato come aperto.');
  const sysOk = (s) => (!input.systems?.include?.length || input.systems.include.includes(s)) && !(input.systems?.exclude ?? []).includes(s);
  const base = start && dest && start.system === dest.system ? distance(start.pos, dest.pos) : null;

  const stations = new Map();
  const station = (name, system) => {
    const k = normName(name);
    if (!stations.has(k)) {
      const loc = P(name, system);
      stations.set(k, { name, system: loc?.system ?? system ?? null, loc, opportunities: [], observed: null });
    }
    return stations.get(k);
  };
  // 1) catalogo
  for (const e of catalog) {
    if (e.systems.length && !e.systems.some(sysOk)) continue;
    const ev = e.source === 'wiki' && patchAge(e.patch, input.currentPatch) === 'attuale' ? 'catalogo_attuale' : 'catalogo_storico';
    const myRank = e.company ? rankIndex(input.ranks?.[e.company]) : null;
    const rankState = e.rankIndex === null ? 'non indicato' : myRank === null ? 'da verificare' : myRank >= e.rankIndex ? 'ok' : 'insufficiente';
    const totalScu = e.movements.reduce((s, m) => s + (m.scu ?? 0), 0);
    const maxBox = Math.max(0, ...e.movements.map((m) => m.containerMax ?? 0)) || null;
    for (const m of e.movements) for (const from of m.from.names) {
      const st = station(from, e.systems[0]);
      if (st.system && !sysOk(st.system)) continue;
      st.opportunities.push({
        kind: 'catalogo', entry: e, evidence: ev, cargo: m.cargo, scu: m.scu, totalScu, to: m.to.names, fixedPickup: m.from.fixed,
        reward: e.reward, rewardMax: e.rewardMax, rankState, combat: e.combat, maxBox,
        fits: totalScu ? totalScu <= input.capacity : null,
        boxOk: maxBox && input.ship?.maxBox ? maxBox <= input.ship.maxBox : null,
        patch: e.patch, source: e.source, observedAt: e.observedAt,
      });
    }
  }
  // 2) osservazioni personali
  const ws = whereToSearch(observations, { currentPatch: input.currentPatch });
  for (const w of ws) {
    const st = station(w.place, w.system);
    st.observed = w;
    for (const o of observations.filter((x) => normName(x.place) === normName(w.place) && x.outcome !== 'nessuna')) {
      const age = patchAge(o.patch, input.currentPatch);
      st.opportunities.push({
        kind: 'osservazione', obs: o, evidence: age === 'attuale' ? 'osservata_attuale' : 'osservata_storica', cargo: null, scu: o.scu, totalScu: o.scu,
        to: o.to ? [o.to] : [], reward: o.reward, rankState: 'osservata', fits: o.scu ? o.scu <= input.capacity : null, patch: o.patch, source: 'osservazione', observedAt: o.at,
      });
    }
  }
  // 3) metriche per stazione
  const list = [];
  for (const st of stations.values()) {
    const opp = st.opportunities.filter((o) => o.rankState !== 'insufficiente' && o.fits !== false && o.boxOk !== false && !(input.priority === 'rischio' && o.combat));
    const excluded = st.opportunities.length - opp.length;
    if (!opp.length && !st.observed?.current.visits) continue;
    let detour = null, approach = null, dropOk = 0;
    if (start && st.loc && st.loc.system === start.system) {
      approach = distance(start.pos, st.loc.pos);
      if (dest && dest.system === st.loc.system) detour = approach + distance(st.loc.pos, dest.pos) - base;
      else if (!dest) detour = approach;
    }
    if (dest) dropOk = opp.filter((o) => o.to.some((t) => normName(t) === normName(input.dest.name) || nearDest(P(t, st.system), dest, base))).length;
    const best = opp.reduce((b, o) => Math.min(b, EVIDENCE_LEVELS[o.evidence].rank), 9);
    const rewards = opp.map((o) => o.reward).filter((x) => x);
    list.push({
      name: st.name, system: st.system, known: !!st.loc, detour, approach, opportunities: opp, excluded, towardDest: dropOk,
      bestEvidence: Object.keys(EVIDENCE_LEVELS).find((k) => EVIDENCE_LEVELS[k].rank === best) ?? null,
      maxReward: rewards.length ? Math.max(...rewards) : null,
      observed: st.observed,
      sources: [...new Set(opp.map((o) => o.source))],
      patches: [...new Set(opp.map((o) => o.patch ?? 'non dichiarata'))],
      toVerify: toVerify(opp),
    });
  }
  const cmp = comparator(input.priority);
  list.sort(cmp);
  const pick = (filter, k) => orderAlongRoute(list.filter(filter).slice(0, k), start);
  const maxStops = Math.max(1, input.maxStops ?? 3);
  const alternatives = {
    conservativa: pick((s) => s.known && s.bestEvidence === 'osservata_attuale' && (s.detour === null || s.detour >= 0), 1),
    equilibrata: pick((s) => s.known && ['osservata_attuale', 'catalogo_attuale', 'osservata_storica'].includes(s.bestEvidence), maxStops),
    esplorativa: pick(() => true, maxStops + 1),
  };
  const notes = [];
  if (!alternatives.conservativa.length) notes.push('Conservativa vuota: nessuna osservazione personale nella patch attuale. Registra le bacheche che controlli in gioco: è il dato più affidabile.');
  if (!catalog.length) notes.push('Catalogo non caricato: il radar usa solo le tue osservazioni.');
  return { stations: list, alternatives, issues, notes, start, dest, base };
}

function nearDest(p, dest, base) {
  if (!p || !dest || p.system !== dest.system) return false;
  return distance(p.pos, dest.pos) <= Math.max(5e7, (base ?? 0) * 0.1); // entro 50.000 km o 10% del percorso
}

function toVerify(opp) {
  const v = new Set(['presenza dell\'offerta nel MobiGlas']);
  if (opp.some((o) => o.kind === 'catalogo')) v.add('ricompensa e quantità reali (il catalogo non è un\'offerta)');
  if (opp.some((o) => o.kind === 'catalogo' && !o.fixedPickup)) v.add('punto di ritiro effettivo (assegnato dinamicamente)');
  if (opp.some((o) => o.maxBox == null)) v.add('dimensione delle casse');
  if (opp.some((o) => o.rankState === 'da verificare')) v.add('grado richiesto rispetto al tuo');
  if (opp.some((o) => o.combat)) v.add('presenza di nemici nella missione');
  return [...v];
}

function comparator(priority) {
  const ev = (s) => EVIDENCE_LEVELS[s.bestEvidence]?.rank ?? 9;
  const det = (s) => (s.detour === null ? Infinity : s.detour);
  return (a, b) => {
    const k = {
      profitto: [ev(a) - ev(b), (b.maxReward ?? -1) - (a.maxReward ?? -1), det(a) - det(b)],
      profitto_ora: [ev(a) - ev(b), ratio(b) - ratio(a), det(a) - det(b)],
      pochi_scali: [det(a) - det(b), ev(a) - ev(b)],
      rischio: [ev(a) - ev(b), det(a) - det(b)],
      stiva: [ev(a) - ev(b), fill(b) - fill(a), det(a) - det(b)],
    }[priority] ?? [ev(a) - ev(b), det(a) - det(b)];
    for (const x of k) if (x && Number.isFinite(x)) return x;
    if (b.towardDest !== a.towardDest) return b.towardDest - a.towardDest;
    return a.name.localeCompare(b.name);
  };
}
/** Ricompensa per Gm di deviazione: rapporto calcolato, non un profitto orario. */
const ratio = (s) => (s.maxReward && s.detour !== null ? s.maxReward / Math.max(1, s.detour / 1e9) : -1);
const fill = (s) => Math.max(0, ...s.opportunities.map((o) => (o.fits ? o.totalScu : 0)));

function orderAlongRoute(stations, start) {
  if (!start) return stations;
  return [...stations].sort((a, b) => (a.approach ?? Infinity) - (b.approach ?? Infinity) || a.name.localeCompare(b.name));
}
