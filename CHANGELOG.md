# Registro delle modifiche

## Dati (2026-11-05): Excel dei punti interessanti
- Nuovo file `data/punti_interesse.xlsx`: 2.503 punti di Stanton, Pyro e Nyx, classificati in 16 gruppi (campi asteroidi ai Lagrange, basi minerarie su asteroide, cluster, anello Glaciem, grotte, relitti, derelict, bunker, avamposti, stazioni...). 700 con XYZ di sistema in metri, il resto di superficie (lat/lon e coordinate locali, schede incomplete).
- Fonti: Star Citizen Wiki API 4.10.1 e starmap.space (via sc-nav, solo dati); frame verificato a campione contro CitizenHQ (scarto ≤ 0,1 m su 9 punti). Pyro riportato al frame CitizenHQ (+85,2299335°).
- Colonne compatibili con l'import del DATABASE PUNTI (collaudato con il lettore di NAVCOM: 0 errori), tutti i punti "Da verificare".
- Generatore: `tools/build_punti_interesse.py`.

## 0.5.0-web (2026-11-05): DATABASE PUNTI personale
- Nuova scheda **🗂 DATABASE PUNTI**: destinazioni inserite o importate dall'utente (NAVCOM non genera coordinate). Campi: ID, nome, sistema, X/Y/Z, unità km/m, categoria, materiale/risorsa, stato, note, data di inserimento, data dell'ultima verifica.
- **Inserimento**: manuale (anche incollando `/showlocation`), da Excel `.xlsx`, dal pianificatore ("Salva queste coordinate"), da backup JSON.
- **Import Excel guidato**: scelta del foglio e della riga di intestazione, anteprima, associazione delle colonne, unità e sistema di default, numeri in formato italiano o inglese, duplicati (ignora / aggiorna), schede incomplete conservate ma non inviabili al pianificatore, riepilogo con errori e avvisi per riga.
- **Gestione**: ricerca per nome, filtri per sistema, categoria, risorsa, stato e completezza; modifica di ogni campo; eliminazione singola e multipla; ricerca dei duplicati (stesso nome o coordinate entro 1 m nello stesso sistema).
- **Export** Excel e JSON, ripristino (unione o sostituzione).
- **🛰 CALCOLA ROTTA** su ogni punto: sistema e XYZ passano al pianificatore, che calcola subito con il motore 0.4.0 (algoritmi invariati); la scheda operativa mostra il nome del punto.
- **Persistenza** in IndexedDB con richiesta di archiviazione persistente, messaggi d'errore spiegati e ripiego in memoria dichiarato. Migrazione una tantum dei vecchi punti personali da localStorage.
- Lettore/scrittore `.xlsx` interno (nessuna libreria esterna, nessun CDN).
- Test: 14 nuovi (importazione, modifica, cancellazione, persistenza con IndexedDB simulato, export Excel/JSON); `fake-indexeddb` solo come dipendenza di sviluppo.

## 0.4.0-web (2026-11-05): Fasi 4 e 5, navigazione operativa e multi-tratta
- Nuova scheda **🛰 PIANIFICATORE**: inserisci XYZ arbitrarie (m o km, oppure incolla `/showlocation`) e la partenza, che è facoltativa. NAVCOM risponde a cinque domande: da dove partire, quali salti fare, quando interrompere, quanto resterai distante da P, quanto tempo serve.
- **Strategie**:
  - una interruzione, con salti completi di posizionamento calcolati con Dijkstra;
  - salto diretto dalla posizione attuale;
  - **avvicinamento in due fasi**: nuovo salto dopo la prima interruzione, con C1 in forma chiusa.
- **Modalità operativa e geometrica**, con livelli di evidenza:
  - gioco / dati / fonti / geometria;
  - tratte segnabili "provata" o "non disponibile", in modo direzionale;
  - nessuna promozione automatica.
- **Precisione HUD**:
  - uscita al cambio di lettura;
  - intervallo dovuto all'arrotondamento, separato dall'errore del tempo di reazione;
  - "non determinabile" se mancano i dati.
- **Tempi**: modello del QT a due stadi (starcitizen.tools 4.10), preparazione, volo convenzionale trapezoidale, transito nei jump point.
- **Tre criteri documentati**: minima distanza residua, minimo tempo, migliore raggiungibilità operativa.
- **Pyro e Nyx**:
  - ostacoli con posizioni CitizenHQ e raggi starmap.space;
  - stella con raggio prudenziale incerto;
  - **jump point** come archi logici fra le stazioni Gateway, senza mai mescolare le coordinate di sistemi diversi.
- **Controlli sulle coordinate**: punto dentro un corpo, fuori dai dati, unità sospette, punto lontano dai marker.
- **Grafico 3D**:
  - colori per stato (verificata, supportata, teorica, bloccata);
  - volo convenzionale tratteggiato;
  - tappe e alternative;
  - legenda cliccabile.
- **Correzione in volo** con due letture `/showlocation`.
- **Salvataggio dei piani**: input, parametri, versione e fonte dei dati, risultato originale. Puoi **ricalcolarli** con i dati aggiornati e vedere il confronto; export e import sono in JSON.
- **Web Worker**: l'interfaccia resta reattiva; gli ostacoli per coppia restano in cache.
- **Test**: 22 nuovi test matematici e funzionali, più 10 controlli "da collaudare in gioco" separati.
- **Documentazione**: `docs/NAVIGAZIONE_OPERATIVA.md`, `docs/COLLAUDO_IN_GIOCO.md`.

## 0.3.1-web
- Plotly inclusa nel repository, caricamento controllato, funzionamento offline.

## 0.3.0-web
- Ricerca inversa QT.

## 0.2.0-web
- Versione web statica su GitHub Pages.

## 0.1.0
- Fase 1, versione desktop Python/Streamlit.
