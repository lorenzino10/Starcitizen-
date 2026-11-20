// SITUAZIONE: fazioni dei file di gioco e rapporto con il giocatore.
// Funzioni pure (nessuna rete, nessun DOM): le usa il build (web/tools/fetch_destinations.mjs) e la
// schermata SITUAZIONE dell'ATLANTE. Regole:
//  - dai file di gioco (scunpacked factions/*.json) vengono SOLO: nome, tipo (Lawful/Unlawful/...),
//    reazione predefinita, scala dei gradi con la reputazione minima, flag di polizia;
//  - il grado "ostile" esiste nei file (Reputation.Hostility) ma la sua soglia NON e' esportata:
//    nessun numero viene inventato, si dice "sotto il primo grado elencato";
//  - i rapporti fra fazioni (chi e' nemico di chi) NON sono nei file: non si mostrano come dati;
//  - la tua reputazione la inserisci tu (profilo condiviso con MISSION CONTROL) e vince sempre sul
//    predefinito; un tuo "visto in gioco" vince su tutto.
import { normName } from '../logistics/model.js';

const PLACEHOLDER = /^<=.*=>$|^\[PH\]/;
const clean = (s) => (s == null || PLACEHOLDER.test(String(s).trim()) || !String(s).trim() ? null : String(s).trim());
const fkey = (s) => normName(String(s ?? '').replace(/&/g, ' and ').replace(/['’]/g, ''));

/** Stati del rapporto, dal peggiore al migliore. */
export const REL = {
  ostile: { label: 'OSTILE', icon: '✖', cls: 'bad' },
  rischio: { label: 'A RISCHIO', icon: '⚠', cls: 'warn' },
  neutrale: { label: 'NEUTRALE', icon: '●', cls: 'mid' },
  alleato: { label: 'ALLEATO', icon: '✔', cls: 'good' },
  ignoto: { label: 'NON NOTO', icon: '?', cls: 'unk' },
};
export const REL_ORDER = ['ostile', 'rischio', 'neutrale', 'alleato'];

/**
 * Giurisdizioni della starmap che non sono il nome di una fazione: regole esplicite, mai per somiglianza.
 * 'peoples alliance': il file faction_lawful_pa.json non ha nome; l'abbinamento usa il nome del file.
 */
export const JUR_ALIAS = {
  uee: { kind: 'uee', note: 'legge dell\'Impero (UEE): forze dell\'ordine dell\'Advocacy e della Navy, nessuna scala di reputazione' },
  ungoverned: { kind: 'none', note: 'nessun governo: territorio senza legge' },
  'peoples alliance': { kind: 'file', file: 'faction_lawful_pa', note: 'abbinata per nome del file (faction_lawful_pa): il file non riporta il nome' },
  green: { kind: 'none', note: 'nome di giurisdizione senza fazione corrispondente nei file' },
};

function ladderOf(rep) {
  const ps = rep?.Context?.PrimaryScope; if (!ps) return null;
  const st = (ps.Standings ?? []).map((s) => ({ name: clean(s.DisplayName), key: s.Name ?? null, min: Number.isFinite(+s.MinReputation) ? +s.MinReputation : null }))
    .filter((s) => s.min !== null).sort((a, b) => a.min - b.min);
  if (!st.length) return null;
  const h = rep.Hostility;
  const listed = h?.StandingUUID ? (ps.Standings ?? []).some((s) => s.UUID === h.StandingUUID) : null;
  return {
    scope: clean(ps.ScopeName), scopeLabel: clean(ps.DisplayName), initial: Number.isFinite(+ps.InitialReputation) ? +ps.InitialReputation : null,
    ceiling: Number.isFinite(+ps.ReputationCeiling) ? +ps.ReputationCeiling : null,
    standings: st.map((s, i) => ({ name: s.name ?? `grado ${i}`, key: s.key, min: s.min })),
    hostility: h?.StandingUUID ? { exported: !!listed } : null,
  };
}

/**
 * File factions/*.json -> elenco compatto. Un nome puo' comparire due volte (es. XenoThreat: record di
 * reputazione Neutral e record NPC Hostile per i nemici delle missioni): restano separati.
 * @param files [{file:'faction_x.json', json:{...}}]
 */
export function buildFactions(files, { patch = null } = {}) {
  const list = [];
  for (const { file, json: d } of files ?? []) {
    if (!d?.UUID) continue;
    const rep = d.Reputation ?? null;
    const name = clean(d.Name) ?? clean(rep?.DisplayName);
    list.push({
      id: String(file).replace(/\.json$/, ''), uuid: d.UUID, name,
      type: d.FactionType ?? null, defaultReaction: d.DefaultReaction ?? null,
      arrest: !!d.AbleToArrest, policesCrime: !!d.PolicesCriminality, policesTrespass: !!d.PolicesLawfulTrespass,
      description: clean(d.Description),
      ladder: rep ? ladderOf(rep) : null,
      creature: /creature/i.test(file),
    });
  }
  list.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
  return { meta: { source: 'scu', patch, count: list.length, named: list.filter((f) => f.name).length, withLadder: list.filter((f) => f.ladder).length }, list };
}

/**
 * Fazione per nome (giurisdizione della starmap, compagnia di una missione o nome del profilo).
 * @returns {{rep:object|null, npc:object[], how:string|null, alias:object|null}}
 */
export function findFaction(factions, name) {
  const list = factions?.list ?? [];
  const k = fkey(name); if (!k) return { rep: null, npc: [], how: null, alias: null };
  const alias = JUR_ALIAS[k] ?? null;
  let hits = [], how = null;
  if (alias?.kind === 'file') { hits = list.filter((f) => f.id === alias.file); how = alias.note; }
  else if (alias) return { rep: null, npc: [], how: null, alias };
  if (!hits.length) { hits = list.filter((f) => f.name && fkey(f.name) === k); how = hits.length ? 'nome identico' : null; }
  if (!hits.length) {
    // prefisso univoco per parola intera ("Klescher Rehabilitation" -> "... Facilities")
    const pre = list.filter((f) => f.name && !f.creature && (fkey(f.name).startsWith(`${k} `) || k.startsWith(`${fkey(f.name)} `)));
    const names = new Set(pre.map((f) => fkey(f.name)));
    if (names.size === 1) { hits = pre; how = `nome abbreviato (${pre[0].name})`; }
  }
  const rep = hits.find((f) => f.ladder) ?? null;
  return { rep: rep ?? hits[0] ?? null, npc: hits.filter((f) => f !== (rep ?? hits[0])), how, alias };
}

/** Indice del grado per una reputazione (-1 = sotto il primo grado elencato). */
export function rankAt(ladder, rep) {
  if (!ladder || !Number.isFinite(rep)) return null;
  let i = -1; for (let k = 0; k < ladder.standings.length; k++) if (ladder.standings[k].min <= rep) i = k;
  return i;
}
const isAllied = (s, i) => /allied/i.test(s?.key ?? '') || (i > 0 && !/not eligible|neutral/i.test(s?.name ?? ''));

/** Voce del profilo per una fazione (nome normalizzato; scala principale o senza scala). */
export function profileEntry(profile, faction) {
  const k = fkey(faction); if (!k) return null;
  const list = (profile?.standings ?? []).filter((s) => fkey(s.faction) === k);
  return list.find((s) => !s.scope) ?? list[0] ?? null;
}
export const overrideOf = (profile, faction) => (profile?.relations ?? []).find((r) => fkey(r.faction) === fkey(faction)) ?? null;

/**
 * Rapporto fra te e la fazione che controlla il luogo.
 * Precedenza: tuo "visto in gioco" > CrimeStat in giurisdizione legale > tua reputazione > predefinito dei file.
 * @returns {{state, label, why:string[], status:'tua'|'documentata'|'ipotetica'|'sconosciuta', rank, next, rep}}
 */
export function relation(found, profile, { jurisdiction = null } = {}) {
  const why = []; const f = found?.rep ?? null; const name = f?.name ?? jurisdiction;
  const out = (state, status, extra = {}) => ({ state, label: REL[state].label, why, status, rank: null, next: null, rep: null, ...extra });
  if (found?.alias?.kind === 'none') { why.push(found.alias.note); return out('ignoto', 'documentata'); }
  const ov = name ? overrideOf(profile, name) : null;
  const crime = Number.isInteger(profile?.crime) ? profile.crime : null;
  const lawful = found?.alias?.kind === 'uee' || ['Lawful', 'LawEnforcement', 'PrivateSecurity'].includes(f?.type);
  const crimeRisk = lawful && crime !== null && crime > 0;
  // 1. tua osservazione in gioco
  if (ov && REL[ov.state]) {
    why.push(`impostato da te${ov.at ? ` il ${String(ov.at).slice(0, 10)}` : ''}: ${ov.note || 'visto in gioco'}`);
    if (crimeRisk) why.push(`CrimeStat ${crime} registrato nel profilo in una giurisdizione legale`);
    return out(ov.state, 'tua', { override: ov });
  }
  // 2. legge dell'Impero (nessuna scala di reputazione)
  if (found?.alias?.kind === 'uee') {
    why.push(found.alias.note);
    if (crime === null) { why.push('CrimeStat non registrato nel profilo: la legge UEE guarda solo quello'); return out('neutrale', 'ipotetica'); }
    if (crime > 0) { why.push(`CrimeStat ${crime}: sicurezza e polizia possono arrestarti o attaccarti (regola del gioco, soglie non nei file)`); return out('ostile', 'ipotetica'); }
    why.push('CrimeStat 0 nel profilo: nessun motivo di ostilità per la legge'); return out('neutrale', 'ipotetica');
  }
  if (!f) { why.push(jurisdiction ? `nessuna fazione "${jurisdiction}" nei file di gioco` : 'nessuna giurisdizione nei dati per questo luogo'); return out('ignoto', 'sconosciuta'); }
  const L = f.ladder;
  const pe = profileEntry(profile, f.name ?? jurisdiction);
  let rep = null, repHow = null;
  if (pe && Number.isFinite(pe.rep)) { rep = pe.rep; repHow = `reputazione ${pe.rep.toLocaleString('it-IT')} dal tuo profilo`; }
  else if (pe?.standing && L) { const s = L.standings.find((x) => fkey(x.name) === fkey(pe.standing)); if (s) { rep = s.min; repHow = `grado ${s.name} dal tuo profilo (minimo ${s.min.toLocaleString('it-IT')})`; } }
  const npcHostile = (found.npc ?? []).filter((n) => n.defaultReaction === 'Hostile');
  if (npcHostile.length) why.push(`nei file c'è anche un record "${npcHostile[0].name}" con reazione Hostile (${npcHostile[0].id}): probabilmente i nemici delle missioni contro questa fazione, non la fazione che ti accoglie`);
  // 3. CrimeStat in giurisdizione legale
  if (crimeRisk) {
    why.push(`CrimeStat ${crime} nel profilo e ${f.name} è una fazione legale (${f.type})${f.policesCrime ? ' che controlla i reati' : ''}: la sicurezza può esserti ostile (soglie non nei file)`);
    return out('rischio', 'ipotetica', { rep });
  }
  // 4. tua reputazione
  if (rep !== null && L) {
    const i = rankAt(L, rep); const s = i >= 0 ? L.standings[i] : null; const nx = L.standings[i + 1] ?? null;
    why.push(repHow);
    const next = nx ? { name: nx.name, min: nx.min, missing: nx.min - rep } : null;
    if (i < 0) {
      why.push(`sotto il primo grado elencato (${L.standings[0].name}, ${L.standings[0].min}): i file hanno un grado di ostilità (lo stesso per tutte le fazioni) ma senza soglia, quindi può esserti già ostile oppure no. Se in gioco ti sparano, segnalo come OSTILE`);
      return out('rischio', 'ipotetica', { rank: null, next, rep });
    }
    if (rep < 0) { why.push('reputazione negativa: un peggioramento può portarti al grado ostile'); return out('rischio', 'ipotetica', { rank: s, next, rep }); }
    if (isAllied(s, i)) { why.push(`grado ${s.name}: grado alleato nella scala dei file (${s.key ?? 'scala'})`); return out('alleato', 'tua', { rank: s, next, rep }); }
    why.push(`grado ${s.name}: grado di partenza, nessuna ostilità`); return out('neutrale', 'tua', { rank: s, next, rep });
  }
  if (rep !== null && !L) { why.push(`${repHow}; nei file questa fazione non ha una scala di gradi`); }
  // 5. predefinito dei file
  const dr = f.defaultReaction;
  if (!L && !pe) why.push('nessuna scala di reputazione nei file per questa fazione');
  else if (!pe) why.push('tua reputazione non registrata: vale la reazione predefinita dei file finché non la inserisci');
  if (dr === 'Hostile') { why.push('reazione predefinita nei file: Hostile'); return out('ostile', 'documentata'); }
  if (dr === 'Friendly') { why.push('reazione predefinita nei file: Friendly'); return out('alleato', 'documentata'); }
  if (dr === 'Neutral') { why.push('reazione predefinita nei file: Neutral'); return out('neutrale', 'documentata', { next: L ? { name: L.standings.find((s, i) => isAllied(s, i))?.name ?? null, min: L.standings.find((s, i) => isAllied(s, i))?.min ?? null, missing: null } : null }); }
  why.push('reazione predefinita assente nei file'); return out('ignoto', 'sconosciuta');
}

/** Profilo aggiornato con la reputazione o il grado inseriti per una fazione (immutabile). */
export function withStanding(profile, faction, { rep = null, standing = null } = {}) {
  const k = fkey(faction);
  const rest = (profile?.standings ?? []).filter((s) => !(fkey(s.faction) === k && !s.scope));
  const r = rep === '' || rep === null || rep === undefined || !Number.isFinite(+rep) ? null : Math.round(+rep);
  const st = r === null && standing ? standing : null;
  return { ...profile, standings: r === null && !st ? rest : [...rest, { faction, scope: null, standing: st, rep: r }] };
}
/** Profilo con il tuo "visto in gioco" (state null = rimosso). */
export function withOverride(profile, faction, state, note = '', at = new Date().toISOString()) {
  const k = fkey(faction);
  const rest = (profile?.relations ?? []).filter((r) => fkey(r.faction) !== k);
  return { ...profile, relations: state && REL[state] ? [...rest, { faction, state, note: String(note ?? '').slice(0, 200), at }] : rest };
}
