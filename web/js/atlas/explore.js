// ESPLORA: "devo andare a X, cosa ci trovo?". Solo mappa 3D + ricerca + una scheda del luogo.
// Logica pura: compone dati che NAVCOM ha gia' (ATLANTE, DESTINATION INTELLIGENCE, SITUAZIONE,
// rotazione dei corpi). Non aggiunge valori: quello che nessuna fonte pubblica resta N.D. e lo dice.
// Niente missioni, contratti o stacking in questa vista.

/**
 * Meteo e visibilita': nessuna fonte collegata li pubblica (verifica delle fonti 2026-11-09, campi dello snapshot 2026-11-24).
 * scunpacked-data (file di gioco) non esporta meteo; starmap.space v4 da' solo temperature min/max,
 * respirabilita', composizione e biomi; UEX non ha condizioni ambientali; la Wiki API copia scunpacked.
 * Nel gioco tempeste e nebbia sono locali e dinamiche: NAVCOM non legge il client, quindi non le vede.
 */
export const WEATHER = {
  available: false,
  value: null,
  sub: 'il gioco genera tempeste, nebbia e vento sul momento: nessuna fonte pubblica previsioni o condizioni per luogo',
  note: 'file di gioco (scunpacked), starmap.space, UEX e Wiki API non hanno dati meteo; la Wiki starcitizen.tools vieta la lettura automatica (robots.txt). NAVCOM non legge il client, quindi non vede il meteo in corso',
};

const ARTICLE = { planet: 'un pianeta', moon: 'una luna', star: 'la stella', station: 'una stazione', gateway: 'una stazione di salto (gateway)', city: 'una città', outpost: 'una base', poi: 'un punto di interesse', asteroid: 'un punto fra gli asteroidi', navpoint: 'un punto di navigazione', jumppoint: 'un punto di salto', personal: 'un tuo punto personale' };

/**
 * Descrizione dei file di gioco (testo ufficiale CIG, in inglese): separa il racconto dagli elenchi
 * "Potential ... Mineables / Harvestables / Creatures:" che alcune schede si portano dietro.
 */
const LIST_LABEL = [[/mineable/i, 'Minerali'], [/harvestable/i, 'Da raccogliere'], [/creature/i, 'Creature']];
export function splitLore(text) {
  if (!has(text)) return { lore: null, lists: [] };
  const lore = []; const lists = []; let cur = null;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const l = raw.trim();
    const head = l.match(/^potential (.+?):?$/i);
    if (head && l.length < 60) {
      const label = (LIST_LABEL.find(([re]) => re.test(head[1])) ?? [null, head[1]])[1];
      const veh = /vehicle/i.test(head[1]) ? ' (veicolo di terra)' : /ship/i.test(head[1]) ? ' (nave)' : '';
      cur = { label: `${label}${veh}`, items: [] }; lists.push(cur); continue;
    }
    if (!l) { if (!cur) lore.push(''); continue; }
    if (cur && l.length < 60 && !/[.!?]$/.test(l)) { if (!cur.items.includes(l)) cur.items.push(l); continue; }
    cur = null; lore.push(l);
  }
  const out = lore.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { lore: out || null, lists: lists.filter((x) => x.items.length) };
}

/** Riassunto in italiano costruito solo dai valori presenti nella scheda: nessuna frase senza un dato dietro. */
export function summaryOf({ place, parentName = null, systemName = '', hero, sections, isBody }) {
  const h = Object.fromEntries(hero.map((t) => [t.key, t]));
  const rowOf = (sec, label) => sections.find((x) => x.key === sec)?.rows?.find((r) => r.label.startsWith(label)) ?? null;
  const out = [];
  const where = place.kind === 'star' ? `al centro del sistema ${systemName}` : `${parentName && parentName !== systemName ? `${['planet', 'moon'].includes(place.kind) ? 'di' : ['city', 'outpost'].includes(place.kind) ? 'su' : 'presso'} ${parentName}, ` : ''}nel sistema ${systemName}`;
  out.push(`${place.name} è ${ARTICLE[place.kind] ?? 'un luogo'} ${where}.`);
  if (h.time.value) out.push(isBody ? `Un giorno dura ${h.time.value.replace(/^giorno di /, '')} reali.` : `Adesso lì è ${/☾/.test(h.time.value) ? 'notte' : 'giorno'}: ora locale ${h.time.value.replace(/^[☀☾]\s*/, '')}${h.time.sub && /fra \d+ min/.test(h.time.sub) ? ` (${h.time.sub.split(' · ').slice(1).join(', ')})` : ''}.`);
  const env = [];
  if (h.temp.value) env.push(h.temp.value === 'vuoto' ? 'fuori c\'è il vuoto' : `temperatura da ${h.temp.value.replace(' … ', ' a ')}`);
  if (h.air.value === 'NO') env.push('aria NON respirabile: serve il casco');
  else if (h.air.value === 'SÌ') env.push('aria respirabile secondo la fonte');
  else if (place.kind !== 'star') env.push('respirabilità non documentata, tieni il casco');
  if (h.grav.value && h.grav.status === 'documentata') env.push(`gravità ${h.grav.value}`);
  if (env.length) out.push(`${env[0][0].toUpperCase()}${env[0].slice(1)}${env.length > 1 ? `, ${env.slice(1).join(', ')}` : ''}.`);
  const bio = rowOf('env', 'Biomi'); if (bio?.value) out.push(`Paesaggi: ${bio.value.replace(/,(?=\S)/g, ', ')}.`);
  const jur = rowOf('sec', 'Giurisdizione'); const arm = rowOf('sec', 'Zona di armistizio');
  if (jur?.value) out.push(`Giurisdizione: ${jur.value}${arm?.value ? `, armistizio ${arm.value.toLowerCase()}` : ''}.`);
  else if (arm?.value) out.push(`Armistizio: ${arm.value.toLowerCase()}.`);
  const svc = sections.find((x) => x.key === 'svc'); const known = (svc?.rows ?? []).filter((r) => r.value && r.label !== 'Servizi');
  if (known.length) out.push(`Servizi indicati dalle fonti: ${known.slice(0, 6).map((r) => r.label.replace(/\s*\([^)]*\)/g, '').toLowerCase()).join(', ')}${known.length === 7 ? ' e un altro' : known.length > 7 ? ` e altri ${known.length - 6}` : ''}.`);
  out.push('Meteo e visibilità: nessun dato pubblico, li scopri sul posto.');
  return out.join(' ');
}

const BODY = new Set(['star', 'planet', 'moon']);
const has = (v) => v !== null && v !== undefined && v !== '';
const pick = (rows, key) => (rows ?? []).find((r) => r.key === key) ?? null;
/** Riga della scheda da un campo della DESTINATION INTELLIGENCE (mantiene stato e nota della fonte). */
const fromField = (f, label = null) => (f ? { label: label ?? f.label, value: has(f.value) ? String(f.value) : null, display: f.display ?? null, status: f.status ?? (has(f.value) ? 'documentata' : 'sconosciuta'), note: f.note ?? null, source: f.sourceLabel ?? null } : null);
const row = (label, value, status = 'documentata', note = null) => ({ label, value: has(value) ? String(value) : null, status: has(value) ? status : 'sconosciuta', note });
const tile = (key, icon, label, t) => ({ key, icon, label, value: t?.value ?? null, sub: t?.sub ?? '', status: t?.value == null ? 'sconosciuta' : t?.status ?? 'documentata', tone: t?.tone ?? null, note: t?.note ?? null });

/** "4 h 7 min" da ore decimali. */
export function fmtDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const m = Math.round(hours * 60); const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

/**
 * @param place     luogo dell'ATLANTE (geo.get)
 * @param pathLabel gerarchia leggibile ("Stanton › microTech › New Babbage")
 * @param kindLabel etichetta del tipo
 * @param surface   geo.surface(id)
 * @param sit       risultato di situation() o null
 * @param card      DestIndex.card(id) o null
 * @param rotation  rotationOf(sistema, corpo) del corpo del luogo (o del corpo stesso) o null
 * @param bodyName  nome del corpo di riferimento (luna o pianeta) o null
 * @param fmtKm     formattatore delle distanze in km
 */
export function explorerCard({ place, pathLabel = '', kindLabel = '', parentName = null, systemName = '', surface = null, sit = null, card = null, rotation = null, bodyName = null, fmtKm = (m) => `${Math.round(m / 1000)} km` }) {
  if (!place) return null;
  const isBody = BODY.has(place.kind);
  const env = card?.env ?? {}; const ext = env.exterior ?? []; const sec = card?.security ?? [];
  const mode = env.context?.mode ?? null;
  const inSpace = ['spazio', 'orbita', 'orbita?'].includes(mode);

  // ---- riquadri principali
  let time;
  if (place.kind === 'star') time = { value: null, sub: 'una stella non ha un giorno locale' };
  else if (isBody) {
    const d = rotation ? fmtDuration(rotation.hours) : null;
    time = d ? { value: `giorno di ${d}`, sub: 'durata reale di una rotazione: l\'ora cambia da punto a punto, scegli una base per l\'ora locale', status: 'ipotetica', note: 'rotazione da dati della community, da verificare in gioco' }
      : { value: null, sub: `rotazione di ${place.name} non nota nei dati` };
  } else if (sit?.time) time = sit.time;
  else time = { value: null, sub: inSpace ? 'nello spazio non c\'è un giorno locale' : bodyName ? `rotazione di ${bodyName} non nota nei dati` : 'nessun corpo celeste di riferimento' };

  const grav = pick(ext, 'grav');
  // 1 g esatto: starmap.space lo usa come valore predefinito (Pyro: 13 corpi su 13), quindi resta da verificare
  const g1 = grav && /^1(\.0+)? g$/.test(String(grav.value ?? ''));
  const gravity = grav && has(grav.value) ? { value: String(grav.value), sub: g1 ? '1 g è il valore predefinito della fonte per molti corpi: da verificare in gioco' : grav.note ?? 'valore del corpo', status: g1 ? 'ipotetica' : grav.status }
    : { value: null, sub: inSpace ? 'nello spazio: dipende dalla struttura (non documentato)' : 'nessuna fonte collegata pubblica la gravità affidabile' };
  const atmF = pick(ext, 'atm'); const comp = pick(ext, 'comp');
  const atmosphere = inSpace ? { value: 'vuoto', sub: 'fuori dall\'atmosfera dei corpi', status: 'ipotetica' }
    : atmF && has(atmF.value) ? { value: String(atmF.value), sub: has(comp?.value) ? String(comp.value) : 'composizione non pubblicata', status: atmF.status }
      : { value: null, sub: card ? atmF?.note ?? 'atmosfera non documentata' : 'scheda ambiente non disponibile' };
  const hero = [
    tile('time', '◷', isBody ? 'DURATA DEL GIORNO' : 'ORA LOCALE', time),
    tile('temp', '🌡', 'TEMPERATURA', sit?.temp ?? { value: null, sub: card ? 'non documentata' : 'scheda ambiente non disponibile' }),
    tile('air', '🫁', 'ARIA RESPIRABILE', sit?.air ?? { value: null, sub: 'respirabilità non documentata: tieni il casco', tone: 'warn' }),
    tile('grav', '⤓', 'GRAVITÀ', gravity),
    tile('atm', '☁', 'ATMOSFERA', atmosphere),
    tile('wx', '🌪', 'METEO E VISIBILITÀ', { value: null, sub: WEATHER.sub, note: WEATHER.note }),
  ];

  // ---- sezioni
  const sections = [];
  const envRows = ['breath', 'comp', 'press', 'tmin', 'tmax', 'bio', 'ocean', 'hab'].map((k) => fromField(pick(ext, k))).filter(Boolean);
  for (const r of env.space ?? []) envRows.push(fromField(r));
  if (env.exteriorNote) envRows.push(row('Superficie', null, 'sconosciuta', env.exteriorNote));
  if (env.interior) for (const r of env.interior) envRows.push(fromField(r));
  if (envRows.length) sections.push({ key: 'env', title: 'AMBIENTE', rows: envRows });

  const hazards = [
    ...['hostile', 'helmet', 'suit', 'thermal'].map((k) => fromField(pick(env.survival, k))).filter(Boolean),
    ...['weather', 'wind', 'haz'].map((k) => fromField(pick(ext, k))).filter(Boolean),
  ];
  if (!hazards.some((r) => /meteo/i.test(r.label))) hazards.push(row('Condizioni meteo e visibilità', null, 'sconosciuta', WEATHER.note));
  hazards.push(row('Nota', 'nessun pericolo documentato non vuol dire luogo sicuro', 'ipotetica'));
  sections.push({ key: 'haz', title: 'PERICOLI E SOPRAVVIVENZA', rows: hazards });

  const secRows = [
    sit?.armistice ? row('Zona di armistizio', sit.armistice.value, sit.armistice.status, sit.armistice.sub || null) : null,
    ...['nofly', 'def', 'tres', 'jur', 'fine', 'stolen', 'respawn'].map((k) => fromField(pick(sec, k))),
    sit?.faction?.value ? row('Rapporto con te', sit.relation?.label ?? null, sit.relation?.status ?? 'sconosciuta', (sit.relation?.why ?? []).slice(-1)[0] ?? null) : null,
  ].filter(Boolean);
  if (secRows.length) sections.push({ key: 'sec', title: 'SICUREZZA E GIURISDIZIONE', rows: secRows });

  // servizi: solo quelli che almeno una fonte indica; gli altri contati
  const svcKnown = []; let svcUnknown = 0;
  for (const s of card?.services ?? []) {
    const v = (s.values ?? []).find((x) => has(x.value));
    if (v) svcKnown.push({ label: s.label, value: String(v.value), status: v.status, note: [v.label && v.label !== '—' ? v.label : null, s.note].filter(Boolean).join(' · ') || null });
    else svcUnknown++;
  }
  if (!card) sections.push({ key: 'svc', title: 'SERVIZI', rows: [row('Servizi', (place.services ?? []).map((s) => s.label).join(', ') || null, 'documentata', 'solo dall\'ATLANTE: scheda della destinazione non disponibile')] });
  else sections.push({ key: 'svc', title: 'SERVIZI', rows: svcKnown.length ? svcKnown : [row('Servizi', null, 'sconosciuta', 'nessun servizio indicato dalle fonti per questo luogo')], hidden: svcUnknown, hiddenNote: svcUnknown ? `${svcUnknown} servizi senza dati in nessuna fonte (non vuol dire assenti)` : null });

  const pos = [
    row('Tipo', kindLabel || place.kind),
    row('Gerarchia', pathLabel),
    place.pos ? row('Coordinate (file di gioco)', `${fmtKm(place.pos.x)} / ${fmtKm(place.pos.y)} / ${fmtKm(place.pos.z)}`, 'documentata', `frame ${place.frame ?? 'sistema'}`) : row('Coordinate', null),
    surface?.ok ? row('Sul globo', `lat ${(surface.lat * 180 / Math.PI).toFixed(2)}° · lon ${(surface.lon * 180 / Math.PI).toFixed(2)}°`, 'ipotetica', surface.note) : surface?.note && !isBody ? row('Sul globo', null, 'sconosciuta', surface.note) : null,
    surface?.ok && Number.isFinite(surface.alt) ? row('Quota sul raggio medio', fmtKm(surface.alt), 'ipotetica') : null,
    place.radius ? row('Raggio', fmtKm(place.radius), 'documentata', place.radiusSource ?? null) : null,
    isBody && rotation ? row('Rotazione', `${fmtDuration(rotation.hours)} reali per giro`, 'ipotetica', 'dato della community, da verificare in gioco') : null,
    row('Marker quantum', place.qtValid ? 'sì' : 'no o non indicato', place.qtValid ? 'documentata' : 'sconosciuta'),
    place.hidden ? row('Starmap di gioco', 'nascosto', 'documentata') : null,
    row('Fonte', [place.source, place.patch].filter(Boolean).join(' · ') || null),
  ].filter(Boolean);
  sections.push({ key: 'pos', title: 'POSIZIONE', rows: pos });
  // IL POSTO: riassunto in italiano dai dati + storia ufficiale dai file di gioco
  const { lore, lists } = splitLore(card?.description ?? null);
  const story = { summary: summaryOf({ place, parentName, systemName, hero, sections, isBody }), lore, lists, loreSource: lore ? 'descrizione ufficiale nei file di gioco (CIG, via scunpacked), in inglese' : null };

  return {
    id: place.id, title: place.name, path: pathLabel, kind: kindLabel, isBody, mode, hero, sections, story,
    missingCard: !card,
    sources: ['posizioni e gerarchia: file di gioco (scunpacked)', card ? 'ambiente, servizi e sicurezza: DESTINATION INTELLIGENCE (starmap.space, file di gioco, UEX)' : null, rotation || sit?.time?.value ? 'rotazione: Murphy Exploration Group via VerseTime (community)' : null].filter(Boolean),
  };
}
