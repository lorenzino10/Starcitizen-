// SITUAZIONE (3.3.0): fazioni dei file di gioco, rapporto con il giocatore, riepilogo del luogo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFactions, findFaction, relation, rankAt, withStanding, withOverride } from '../js/dest/factions.js';
import { situation } from '../js/dest/situation.js';
import { cleanProfile } from '../js/missions/records.js';

const ladder = (names) => ({
  UUID: 'r', DisplayName: 'x',
  Context: { PrimaryScope: { ScopeName: 'FactionReputation', DisplayName: 'Standing', InitialReputation: 0, ReputationCeiling: 95251,
    Standings: names.map(([n, min, key], i) => ({ UUID: `s${i}`, Name: key ?? `FactionRep_Allied_Rank${i}`, DisplayName: n, MinReputation: min })) } },
  Hostility: { ScopeUUID: 'x', StandingUUID: 'hidden' },
});
const STD = [['Neutral', 0, 'FactionRep_Neutral_Rank0'], ['Jr. Contractor', 800], ['Contractor', 2200], ['Sr. Contractor', 5800]];
const FILES = [
  { file: 'faction_reputation_unlawful_headhunters.json', json: { UUID: 'hh', Name: 'Headhunters', FactionType: 'Unlawful', DefaultReaction: 'Neutral', Description: 'gang', Reputation: ladder(STD) } },
  { file: 'factionreputation_xenothreat.json', json: { UUID: 'xt', Name: 'XenoThreat', FactionType: 'Unlawful', DefaultReaction: 'Neutral', Reputation: ladder(STD) } },
  { file: 'faction_unlawful_xenothreat.json', json: { UUID: 'xt2', Name: 'XenoThreat', FactionType: 'Unlawful', DefaultReaction: 'Hostile' } },
  { file: 'faction_unlawful_roughandready.json', json: { UUID: 'rr', Name: 'Rough & Ready', FactionType: 'Unlawful', DefaultReaction: 'Neutral' } },
  { file: 'faction_unlawful_ninetails.json', json: { UUID: 'nt', Name: 'Nine Tails', FactionType: 'Unlawful', DefaultReaction: 'Hostile' } },
  { file: 'faction_lawful_hurstondynamics.json', json: { UUID: 'hd', Name: 'Hurston Dynamics', FactionType: 'Lawful', DefaultReaction: 'Neutral', PolicesCriminality: false, Reputation: ladder(STD) } },
  { file: 'faction_lawful_pa.json', json: { UUID: 'pa', FactionType: 'Lawful', DefaultReaction: 'Neutral' } },
  { file: 'factionreputation_klescher.json', json: { UUID: 'kl', Name: 'Klescher Rehabilitation Facilities', FactionType: 'Lawful', DefaultReaction: 'Neutral' } },
  { file: 'faction_creature_x.json', json: { UUID: 'cr', Name: '<= UNINITIALIZED =>', FactionType: 'Unlawful', DefaultReaction: 'Hostile' } },
];
const F = buildFactions(FILES, { patch: '4.10' });

test('SIT-1 build: nomi segnaposto scartati, scala ordinata, soglia di ostilita\' non inventata', () => {
  assert.equal(F.list.length, 9);
  assert.equal(F.meta.named, 7); // creatura e PA senza nome
  const hh = F.list.find((f) => f.id.endsWith('headhunters'));
  assert.deepEqual(hh.ladder.standings.map((s) => s.min), [0, 800, 2200, 5800]);
  assert.deepEqual(hh.ladder.hostility, { exported: false });
  assert.equal(rankAt(hh.ladder, 2500), 2); assert.equal(rankAt(hh.ladder, -1), -1);
});

test('SIT-2 abbinamento giurisdizione -> fazione: identico, abbreviato, alias espliciti, nessuna somiglianza', () => {
  assert.equal(findFaction(F, 'Headhunters').rep.id, 'faction_reputation_unlawful_headhunters');
  assert.equal(findFaction(F, 'rough and ready').rep.name, 'Rough & Ready');
  assert.match(findFaction(F, 'Klescher Rehabilitation').how, /abbreviato/);
  assert.equal(findFaction(F, "People's Alliance").rep.id, 'faction_lawful_pa');
  assert.equal(findFaction(F, 'UEE').alias.kind, 'uee');
  assert.equal(findFaction(F, 'Ungoverned').alias.kind, 'none');
  assert.equal(findFaction(F, 'Head').rep, null); // nessun abbinamento per pezzi di parola
  const xt = findFaction(F, 'XenoThreat'); // due record: reputazione (Neutral) e NPC (Hostile)
  assert.equal(xt.rep.id, 'factionreputation_xenothreat'); assert.equal(xt.npc[0].defaultReaction, 'Hostile');
});

test('SIT-3 rapporto: predefinito dei file finche\' la reputazione non e\' registrata', () => {
  const r = relation(findFaction(F, 'XenoThreat'), cleanProfile({}));
  assert.equal(r.state, 'neutrale'); assert.equal(r.status, 'documentata');
  assert.ok(r.why.some((w) => /Hostile/.test(w))); // il record NPC ostile viene detto, non usato
  assert.equal(relation(findFaction(F, 'Nine Tails'), {}).state, 'ostile');
  assert.equal(relation(findFaction(F, 'Ungoverned'), {}, { jurisdiction: 'Ungoverned' }).state, 'ignoto');
  assert.equal(relation(findFaction(F, 'Sconosciuti'), {}, { jurisdiction: 'Sconosciuti' }).state, 'ignoto');
});

test('SIT-4 la tua reputazione cambia il rapporto (grado, numero, sotto zero)', () => {
  const hh = findFaction(F, 'Headhunters');
  let p = withStanding(cleanProfile({}), 'Headhunters', { rep: 2500 });
  let r = relation(hh, p);
  assert.equal(r.state, 'alleato'); assert.equal(r.rank.name, 'Contractor'); assert.deepEqual(r.next, { name: 'Sr. Contractor', min: 5800, missing: 3300 });
  p = withStanding(p, 'Headhunters', { standing: 'Jr. Contractor' }); // sostituisce, non duplica
  assert.equal(p.standings.length, 1); assert.equal(relation(hh, p).rank.name, 'Jr. Contractor');
  p = withStanding(p, 'headhunters', { rep: 100 }); assert.equal(relation(hh, p).state, 'neutrale');
  p = withStanding(p, 'Headhunters', { rep: -300 });
  r = relation(hh, p); assert.equal(r.state, 'rischio'); assert.equal(r.status, 'ipotetica'); // soglia ostile non nei file
  assert.ok(r.why.some((w) => /senza soglia/.test(w)));
  p = withStanding(p, 'Headhunters', {}); assert.equal(p.standings.length, 0);
});

test('SIT-5 "visto in gioco" vince sul calcolo, CrimeStat conta solo per le fazioni legali', () => {
  const hh = findFaction(F, 'Headhunters');
  let p = withStanding(cleanProfile({}), 'Headhunters', { rep: 6000 });
  p = withOverride(p, 'Headhunters', 'ostile', 'torrette a Rustville', '2026-11-20T10:00:00Z');
  const r = relation(hh, p); assert.equal(r.state, 'ostile'); assert.equal(r.status, 'tua'); assert.match(r.why[0], /torrette/);
  assert.equal(relation(hh, withOverride(p, 'Headhunters', null)).state, 'alleato');
  const crim = { ...cleanProfile({}), crime: 2 };
  assert.equal(relation(findFaction(F, 'Hurston Dynamics'), crim).state, 'rischio');
  assert.equal(relation(findFaction(F, 'UEE'), crim, { jurisdiction: 'UEE' }).state, 'ostile');
  assert.equal(relation(findFaction(F, 'UEE'), { crime: 0 }, { jurisdiction: 'UEE' }).state, 'neutrale');
  assert.equal(relation(hh, crim).state, 'neutrale'); // una gang non guarda il CrimeStat
});

test('SIT-6 il profilo pulito conserva i rapporti e scarta gli stati non validi', () => {
  const p = cleanProfile({ relations: [{ faction: 'XenoThreat', state: 'ostile', note: 'x'.repeat(300) }, { faction: 'A', state: 'amico' }, { state: 'ostile' }] });
  assert.equal(p.relations.length, 1); assert.equal(p.relations[0].note.length, 200);
});

test('SIT-7 riepilogo: ambiente e fazione dalla scheda, nessun valore riempito', () => {
  const field = (key, value, o = {}) => ({ key, value, status: value == null ? 'sconosciuta' : 'documentata', sourceLabel: 'fonte', note: null, ...o });
  const card = (ext, sec, kind = 'outpost', mode = 'superficie') => ({ title: 'Shadowfall', place: { kind }, desc: {}, env: { context: { mode }, exterior: ext, survival: [field('helmet', 'necessario all\'esterno')] }, security: sec });
  const s = situation({ card: card([field('tmin', '-40 °C'), field('tmax', '12 °C'), field('breath', 'no'), field('comp', 'CO2')], [field('jur', 'XenoThreat'), field('arm', 'sì')]), factions: F, profile: cleanProfile({}), sun: { day: false, hour: 22.5, next: { minutes: 31, event: 'alba' }, body: { name: 'Bloom' } }, fmtHour: (h) => `${Math.floor(h)}:30` });
  assert.equal(s.temp.value, '-40 … 12 °C'); assert.equal(s.air.value, 'NO'); assert.equal(s.air.tone, 'bad');
  assert.match(s.time.value, /☾ 22:30/); assert.match(s.time.sub, /alba fra 31 min/); assert.equal(s.time.status, 'ipotetica');
  assert.equal(s.faction.value, 'XenoThreat'); assert.equal(s.relation.state, 'neutrale'); assert.equal(s.armistice.value, 'SÌ');
  assert.match(s.air.sub, /pressurizzazione non documentata/);
  const n = situation({ card: card([field('tmin', null), field('breath', null)], []), factions: null });
  assert.equal(n.temp.value, null); assert.equal(n.air.value, null); assert.equal(n.air.status, 'sconosciuta');
  assert.equal(n.faction.value, null); assert.match(n.faction.sub, /prossimo aggiornamento/); assert.equal(n.relation.state, 'ignoto');
  assert.equal(n.time.value, null);
  const sp = situation({ card: card([], [field('jur', 'UEE')], 'station', 'orbita'), factions: F, profile: { crime: 1 } });
  assert.equal(sp.air.value, 'NO'); assert.equal(sp.temp.value, 'vuoto'); assert.equal(sp.relation.state, 'ostile');
});
