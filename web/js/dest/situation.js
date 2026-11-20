// SITUAZIONE: "sono qui, cosa devo sapere?" in una schermata.
// Riassume, senza aggiungere dati: scheda della DESTINATION INTELLIGENCE (ambiente, sicurezza,
// giurisdizione), ora locale calcolata dall'ATLANTE e rapporto con la fazione (factions.js + tuo profilo).
// Ogni riquadro porta lo stato del dato: documentata / ipotetica / tua / non disponibile.
import { findFaction, relation, REL } from './factions.js';

const get = (rows, key) => (rows ?? []).find((r) => r.key === key) ?? null;
const val = (f) => (f?.value ?? null);
const T = (value, sub = '', status = 'documentata', extra = {}) => ({ value, sub, status: value === null || value === undefined ? 'sconosciuta' : status, ...extra });

/**
 * @param card  DestIndex.card(id)
 * @param sun   risultato di sunOf dell'ATLANTE ({hour, day, elevation, next, body}) o null
 * @param fmtHour formattatore dell'ora (scene3d.js)
 */
export function situation({ card, factions = null, profile = null, sun = null, fmtHour = (h) => String(h) }) {
  if (!card) return null;
  const env = card.env ?? {}; const ext = env.exterior ?? []; const surv = env.survival ?? []; const sec = card.security ?? [];
  const mode = env.context?.mode ?? 'ignoto';
  const inSpace = ['spazio', 'orbita', 'orbita?'].includes(mode);
  const structure = card.place && ['station', 'gateway', 'city', 'outpost'].includes(card.place.kind);

  // ---- ora locale
  let time;
  if (sun) {
    const nx = sun.next?.minutes != null ? `${sun.next.event} fra ${sun.next.minutes} min reali` : sun.next?.event ? `${sun.next.event}: non calcolabile` : '';
    time = T(`${sun.day ? '☀' : '☾'} ${fmtHour(sun.hour)}`, [sun.day ? 'giorno' : 'notte', nx].filter(Boolean).join(' · '), 'ipotetica', { note: `rotazione di ${sun.body?.name ?? 'corpo'} da dati della community, da verificare in gioco` });
  } else time = T(null, inSpace ? 'nello spazio non c\'è un giorno locale' : 'rotazione del corpo non nota nei dati');

  // ---- temperatura esterna
  const tmin = val(get(ext, 'tmin')), tmax = val(get(ext, 'tmax'));
  const temp = inSpace ? T('vuoto', 'fuori dalla stazione: spazio', 'ipotetica')
    : tmin || tmax ? T(`${tmin ?? '?'} … ${tmax ?? '?'}`.replace(/ °C/g, '') + ' °C', 'min … max della superficie del corpo: niente meteo né valore del punto', 'documentata', { note: get(ext, 'tmin')?.note ?? null })
      : T(null, 'nessuna fonte collegata pubblica la temperatura qui');

  // ---- aria
  const br = get(ext, 'breath'); const helmet = get(surv, 'helmet');
  const air = inSpace ? T('NO', 'vuoto: casco fuori dagli ambienti pressurizzati', 'ipotetica', { tone: 'bad' })
    : br?.value === 'sì' ? T('SÌ', 'respirabile secondo la fonte: verifica comunque sul posto', 'documentata', { tone: 'good' })
      : br?.value === 'no' ? T('NO', `casco necessario all'esterno${val(get(ext, 'comp')) ? ` · ${val(get(ext, 'comp'))}` : ''}`, 'documentata', { tone: 'bad' })
        : T(null, 'respirabilità non documentata: tieni il casco finché non verifichi', 'sconosciuta', { tone: 'warn' });
  if (structure && !inSpace) air.sub += ' · dentro la struttura: pressurizzazione non documentata';

  // ---- giurisdizione e fazione
  const jurF = get(sec, 'jur'); const jurName = val(jurF);
  const found = jurName ? findFaction(factions, jurName) : null;
  const ctrl = val(get(sec, 'ctrl'));
  const f = found?.rep ?? null;
  const TYPE = { Lawful: 'legale', Unlawful: 'fuorilegge', LawEnforcement: 'forze dell\'ordine', PrivateSecurity: 'sicurezza privata' };
  const faction = jurName
    ? T(f?.name ?? jurName, [found?.alias?.kind === 'uee' ? 'legge UEE' : f?.type ? TYPE[f.type] ?? f.type : null, jurF?.note, ctrl && ctrl !== jurName ? `controllo: ${ctrl}` : null, found?.how && found.how !== 'nome identico' ? found.how : null].filter(Boolean).join(' · '), 'documentata', { faction: f?.name ?? jurName, description: f?.description ?? null, ladder: f?.ladder ?? null, id: f?.id ?? null })
    : T(null, factions ? 'nessuna giurisdizione nei file di gioco per questo luogo' : 'dati delle fazioni non ancora pubblicati: arrivano con il prossimo aggiornamento del sito');
  const rel = jurName ? relation(found, profile, { jurisdiction: jurName }) : { state: 'ignoto', label: REL.ignoto.label, why: [faction.sub], status: 'sconosciuta', rank: null, next: null, rep: null };

  // ---- sicurezza
  const arm = sec.filter((r) => r.key === 'arm' || r.key === 'armU').find((r) => r.value !== null) ?? null;
  const armistice = T(arm?.value === 'sì' ? 'SÌ' : arm?.value === 'no' ? 'NO' : arm?.value ?? null, arm ? `${arm.sourceLabel ?? ''}${arm.note ? ` · ${arm.note}` : ''}` : 'nessuna fonte lo indica', arm?.status ?? 'sconosciuta', { tone: arm?.value === 'sì' ? 'good' : arm?.value === 'no' ? 'warn' : null });
  const fine = val(get(sec, 'fine'));
  const extra = [
    fine ? { label: 'Multa base', value: fine } : null,
    val(get(sec, 'stolen')) ? { label: 'Merce rubata tollerata', value: val(get(sec, 'stolen')) } : null,
    val(get(sec, 'respawn')) ? { label: 'Respawn', value: val(get(sec, 'respawn')) } : null,
    val(get(ext, 'grav')) ? { label: 'Gravità', value: val(get(ext, 'grav')) } : null,
    helmet?.value ? { label: 'Casco', value: helmet.value } : null,
  ].filter(Boolean);
  return { title: card.title, path: card.desc?.path ?? null, mode, time, temp, air, faction, relation: rel, armistice, extra, hasFactions: !!factions };
}
