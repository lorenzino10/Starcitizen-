// RESET SCELTE: riporta NAVCOM alle impostazioni di partenza senza toccare i tuoi dati.
// Logica pura: riceve il localStorage e i due archivi meta (DATABASE PUNTI e LOGISTICS) come oggetti,
// cosi' i test la provano con archivi finti. Prima di cancellare salva una copia (ANNULLA RESET).
//
// Cosa e' una "scelta": layout, interruttori della mappa, filtri, schede aperte, selezioni.
// Cosa NON lo e' (mai toccato): punti, rotte, contratti, reputazione, flotta, note, preferiti, visite.

export const UNDO_KEY = 'navcom.resetUndo';

/** Bersagli: local = chiave del localStorage; meta = chiave intera; fields = solo alcuni campi di una chiave meta. */
export const RESET_GROUPS = {
  view: {
    label: 'Scelte di visualizzazione e filtri',
    def: true,
    what: [
      'layout (PC / HONOR V5) e modalità ESPLORA',
      'interruttori dell\'ATLANTE: grafica 3D, ◷ Adesso, animazioni',
      'sistema mostrato, vista e luogo selezionato nell\'ATLANTE, missioni spuntate per lo stacking',
      'filtri e schede della PLANCIA e di MISSION CONTROL (modalità semplice/avanzata, ordinamenti, categorie)',
      'impostazioni del PIANIFICATORE (margine di sicurezza, HUD, velocità, conversione)',
      'filtri di LOGISTICS (priorità, soste, limiti): nave, stiva e gradi restano',
    ],
    targets: [
      { local: 'navcom.layout' }, { local: 'navcom.atlas.gl' }, { local: 'navcom.atlas.now' }, { local: 'navcom.atlas.anim' },
      { local: 'navcom.explore' }, { local: 'navcom.settings' },
      { db: 'logistics', meta: 'atlasUi' },
      { db: 'logistics', meta: 'settings', fields: ['prio', 'maxStops', 'patch', 'hScu', 'hStop', 'cGm', 'cStop', 'cRisk'] },
      { db: 'points', meta: 'homeState', fields: ['bridge'] },
    ],
  },
  trip: {
    label: 'Viaggio in corso',
    def: false,
    what: [
      'DOVE SEI (posizione impostata) e DESTINAZIONE della PLANCIA',
      'ultima rotta calcolata e posizione di partenza di LOGISTICS',
      'elenco delle destinazioni aperte di recente',
    ],
    targets: [
      { db: 'points', meta: 'homeState', fields: ['position', 'destination', 'lastPlan'] },
      { db: 'logistics', meta: 'settings', fields: ['pos'] },
      { db: 'points', meta: 'destRecent' },
    ],
  },
};

/** Mai toccati dal reset, detti per esteso nella finestra di conferma. */
export const NEVER_TOUCHED = [
  'DATABASE PUNTI (tutti i punti importati o inseriti)',
  'punti personali, letture starmap e rotte salvate',
  'contratti, osservazioni, piani salvati e allegati di LOGISTICS',
  'reputazione, CrimeStat e rapporti con le fazioni',
  'registro di MISSION CONTROL',
  'flotta, nave attiva, stiva, gradi e note sulle navi',
  'preferiti, visite confermate, note e link delle destinazioni',
  'copie offline dei dati (atlante, destinazioni, posizioni)',
];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Elenco dei bersagli dei gruppi scelti, uniti per chiave (i campi si sommano). */
export function plan(groups) {
  const out = new Map();
  for (const g of groups) {
    for (const t of RESET_GROUPS[g]?.targets ?? []) {
      const k = t.local ? `local:${t.local}` : `${t.db}:${t.meta}`;
      const prev = out.get(k);
      if (!prev) { out.set(k, { ...t, fields: t.fields ? [...t.fields] : undefined }); continue; }
      if (!prev.fields || !t.fields) prev.fields = undefined; // uno dei due vuole la chiave intera
      else prev.fields = [...new Set([...prev.fields, ...t.fields])];
    }
  }
  return [...out.values()];
}

/**
 * Esegue il reset. ls: {getItem,setItem,removeItem}; dbs: {points, logistics} con getMeta/setMeta (o null).
 * Restituisce {changed, undo}: changed = descrizioni dei bersagli effettivamente modificati.
 */
export async function applyReset({ groups, ls, dbs, now = new Date() }) {
  const targets = plan(groups);
  const undo = { at: now.toISOString(), groups: [...groups], local: {}, meta: [] };
  const changed = [];
  for (const t of targets) {
    if (t.local) {
      let v = null; try { v = ls?.getItem(t.local) ?? null; } catch { /* */ }
      if (v === null) continue;
      undo.local[t.local] = v; changed.push(t.local);
      continue;
    }
    const db = dbs?.[t.db]; if (!db) continue;
    const cur = await db.getMeta(t.meta);
    if (cur === null || cur === undefined) continue;
    if (!t.fields) { undo.meta.push({ db: t.db, key: t.meta, value: clone(cur) }); changed.push(`${t.db}:${t.meta}`); continue; }
    if (typeof cur !== 'object') continue;
    const had = t.fields.filter((f) => cur[f] !== undefined && cur[f] !== null && cur[f] !== '');
    if (!had.length) continue;
    undo.meta.push({ db: t.db, key: t.meta, fields: Object.fromEntries(had.map((f) => [f, clone(cur[f])])) });
    changed.push(`${t.db}:${t.meta}.${had.join(',')}`);
  }
  // la copia va salvata PRIMA di cancellare: se il salvataggio fallisce il reset non parte
  if (changed.length) ls.setItem(UNDO_KEY, JSON.stringify(undo));
  for (const k of Object.keys(undo.local)) { try { ls.removeItem(k); } catch { /* */ } }
  for (const m of undo.meta) {
    const db = dbs[m.db];
    if (!m.fields) { await db.setMeta(m.key, null); continue; }
    const cur = { ...(await db.getMeta(m.key)) };
    for (const f of Object.keys(m.fields)) delete cur[f];
    await db.setMeta(m.key, cur);
  }
  return { changed, undo: changed.length ? undo : null };
}

/** Copia salvata dall'ultimo reset, o null. */
export function lastUndo(ls) {
  try { const v = JSON.parse(ls?.getItem(UNDO_KEY) ?? 'null'); return v && v.at ? v : null; } catch { return null; }
}

/** Rimette le scelte salvate prima dell'ultimo reset. I campi cambiati nel frattempo vengono sovrascritti. */
export async function undoReset({ ls, dbs }) {
  const u = lastUndo(ls); if (!u) return false;
  for (const [k, v] of Object.entries(u.local ?? {})) ls.setItem(k, v);
  for (const m of u.meta ?? []) {
    const db = dbs?.[m.db]; if (!db) continue;
    if (!m.fields) { await db.setMeta(m.key, m.value); continue; }
    await db.setMeta(m.key, { ...((await db.getMeta(m.key)) ?? {}), ...m.fields });
  }
  ls.removeItem(UNDO_KEY);
  return true;
}
