// Caricamento controllato della libreria grafica Plotly, inclusa nel repository
// (web/vendor/), senza CDN esterne. Distingue tre casi di errore:
//   'missing'  -> il file non esiste sul sito (HTTP 404): errore di pubblicazione
//   'network'  -> il file non si scarica per un problema di connessione
//   'invalid'  -> il file si carica ma Plotly non si inizializza (file corrotto o bloccato)
export const PLOTLY_VERSION = '2.35.2';
export const PLOTLY_URL = `vendor/plotly-${PLOTLY_VERSION}.min.js`;

let pending = null;

export const MESSAGES = {
  missing: `Libreria grafica mancante: il file ${PLOTLY_URL} non è presente sul sito (errore di pubblicazione). Il calcolo delle rotte non è influenzato.`,
  network: 'Libreria grafica non scaricata per un problema di connessione. Il file è ospitato sul sito stesso: ricarica la pagina quando la rete è disponibile. Dopo il primo caricamento resta in cache e funziona anche offline.',
  invalid: 'Il file della libreria grafica è stato scaricato ma Plotly non si è avviato (file corrotto o bloccato da un\'estensione del browser).',
};

/** Indaga perche' lo script non e' stato caricato: 404 oppure rete. */
async function diagnose(url, fetchImpl) {
  try {
    const r = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
    if (r.status === 404) return 'missing';
    if (!r.ok) return 'network';
    return 'invalid'; // il file esiste ma lo script non si e' caricato
  } catch {
    return 'network';
  }
}

/**
 * Restituisce {ok:true, Plotly} oppure {ok:false, reason, message}.
 * Carica lo script una sola volta; chiamate successive riusano la stessa promessa.
 */
export function ensurePlotly({ doc = globalThis.document, win = globalThis, fetchImpl = globalThis.fetch, url = PLOTLY_URL } = {}) {
  if (win.Plotly && typeof win.Plotly.react === 'function') return Promise.resolve({ ok: true, Plotly: win.Plotly });
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const fail = async (reason) => {
      const r = reason ?? await diagnose(url, fetchImpl);
      pending = null; // consente un nuovo tentativo (es. quando torna la rete)
      resolve({ ok: false, reason: r, message: MESSAGES[r] });
    };
    const s = doc.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => (win.Plotly && typeof win.Plotly.react === 'function'
      ? resolve({ ok: true, Plotly: win.Plotly })
      : fail('invalid'));
    s.onerror = () => fail();
    doc.head.appendChild(s);
  });
  return pending;
}

/** Solo per i test. */
export function _reset() { pending = null; }
