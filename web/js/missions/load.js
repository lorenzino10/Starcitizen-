// Caricamento del Mission Database 2.0 nel browser: indice + catalogo versionato pubblicati da
// GitHub Actions in data/missions/. Se il sito non risponde, usa l'ultima copia valida salvata in
// questo browser e lo dice. Nessun dato inventato: senza sito e senza copia, il catalogo e' assente.
// Le funzioni di accesso (fetch e meta IndexedDB) sono iniettate, cosi' i test girano senza browser.

export const SNAP_KEY = 'missionsSnapshot';
export const SNAP_INFO_KEY = 'missionsSnapshotInfo';

/**
 * @param io {fetchJson(url), getMeta(key), setMeta(key, value), now()}
 * @returns {{index, cat, from:'sito'|'copia locale'|null, error, warnings:string[]}}
 */
export async function loadMissionDb(io, { base = 'data/missions/' } = {}) {
  const now = io.now ?? (() => new Date().toISOString());
  const warnings = [];
  try {
    const index = await io.fetchJson(`${base}index.json`);
    if (!index?.file) throw new Error('indice senza file del catalogo');
    const cat = await io.fetchJson(`${base}${index.file}`);
    if (!Array.isArray(cat?.missions) || !cat.missions.length) throw new Error('catalogo vuoto o non valido');
    if (index.sources?.wiki && index.sources.wiki.ok === false) warnings.push(`Star Citizen Wiki API non raggiungibile all'ultimo aggiornamento (${index.sources.wiki.error ?? 'errore'}): versione LIVE non verificata, varianti raggruppate con un criterio euristico, descrizioni assenti.`);
    const pg = index.sources?.wiki?.pages?.list;
    if (pg?.duplicates) warnings.push(`L'elenco della Wiki ripete ${pg.duplicates} righe su ${pg.received} (${pg.unique} missioni distinte): i modelli che non vi compaiono sono raggruppati con il criterio euristico, dichiarato sulla scheda.`);
    if (index.fallback) warnings.push(`Ultimo aggiornamento non riuscito (${index.fallback.reason ?? 'motivo non indicato'}): il sito pubblica ancora il catalogo precedente. ${index.fallback.note ?? ''}`.trim());
    // copia offline: si riscrive solo quando cambia il file (il catalogo pesa alcuni MB)
    try {
      const info = await io.getMeta(SNAP_INFO_KEY);
      if (info?.file !== index.file) { await io.setMeta(SNAP_KEY, { at: now(), index, cat }); await io.setMeta(SNAP_INFO_KEY, { file: index.file, at: now() }); }
    } catch { /* la copia offline e' un di piu' */ }
    return { index, cat, from: 'sito', error: null, warnings };
  } catch (e) {
    const snap = await io.getMeta(SNAP_KEY).catch(() => null);
    if (snap?.cat?.missions?.length) {
      warnings.push(`Catalogo missioni non raggiungibile (${e.message}): uso la copia salvata in questo browser il ${String(snap.at).slice(0, 10)}. Può essere più vecchia dell'ultima versione del gioco.`);
      return { index: snap.index, cat: snap.cat, from: 'copia locale', error: e.message, warnings };
    }
    return { index: null, cat: null, from: null, error: e.message, warnings: [`Catalogo missioni non disponibile (${e.message}) e nessuna copia salvata in questo browser.`] };
  }
}

/** Riga di provenienza da mostrare sempre: versione, build, fonte, data, numero di record. */
export function provenance(res) {
  if (!res?.cat) return { ok: false, text: 'Catalogo missioni non caricato', stale: true };
  const m = res.cat.meta ?? {}; const ix = res.index ?? {};
  const stale = res.from !== 'sito' || !!ix.fallback || (ix.liveDefault && m.patch && ix.liveDefault !== m.patch);
  return {
    ok: true, stale,
    version: m.version ?? null, channel: m.channel ?? null, build: m.build ?? null, patch: m.patch ?? null,
    liveDefault: ix.liveDefault ?? null, source: m.source ?? 'n.d.', date: m.fetchedAt ?? ix.generatedAt ?? null,
    missions: m.missions ?? res.cat.missions.length, templates: m.templates ?? null, from: res.from,
    text: `${m.version ?? '?'} ${m.channel ?? ''} build ${m.build ?? '?'} · ${m.missions ?? res.cat.missions.length} modelli${m.templates ? ` (${m.templates} senza varianti)` : ''} · ${m.source ?? 'fonte n.d.'} · dati del ${String(m.fetchedAt ?? ix.generatedAt ?? '?').slice(0, 10)}${res.from === 'copia locale' ? ' · COPIA LOCALE' : ''}${ix.fallback ? ' · SNAPSHOT PRECEDENTE' : ''}`,
  };
}
