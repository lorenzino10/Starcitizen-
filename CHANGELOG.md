# Registro delle modifiche

## 0.5.6-web (2026-11-05): pianificatore, partenza planetaria e cause di scarto
Segnalazione di Lorenzo: Aaron Halo B5 (settore 043°), partenza microTech, modalità Operativa. Risultato: 435 marker e centinaia di candidati, ma nessun percorso.
- **Causa**: il marker "microTech" di CitizenHQ è il **centro del pianeta**, non una partenza reale. Ogni tratta che parte da lì è teorica, quindi in modalità operativa nessun marker era raggiungibile. Una partenza diversa (nessuna, oppure una stazione orbitale) dà piani operativi. Nessun criterio di sicurezza è stato abbassato.
- **Diagnosi della partenza**: se la partenza non permette tratte operative, NAVCOM spiega perché (centro o superficie di un corpo, ostacoli, dati) e propone fino a 5 marker vicini da cui partono tratte operative. Per ciascuno mostra distanza e numero di tratte, con l'avvertenza "non provati in gioco". La partenza cambia **solo** se premi "Usa come partenza e ricalcola".
- **Cause di scarto** quando non c'è alcuna rotta operativa: partenza non raggiungibile, tratta teorica (centro, superficie, ostacolo incerto), dati incompleti, ostacolo, collegamento non disponibile, altro (impostazioni). NAVCOM distingue "informazioni insufficienti" da "non raggiungibile con i dati attuali".
- **Nessuna "alternativa sicura"**: il marker più vicino viene indicato come tale, con raggiungibilità non verificata.
- **MOSTRA ALTERNATIVE GEOMETRICHE**: calcolo separato in modalità geometrica, in una sezione rossa "NON OPERATIVE" con i dettagli su richiesta. Non sostituisce il risultato operativo.
- **"Includi tratte bloccate"** è disattivata e spenta in modalità operativa.
- **CALCOLA ROTTA dal DATABASE PUNTI** riparte da "Nessuna: trova da dove partire", salvo che tu abbia spuntato "Mantieni questa partenza quando calcoli dal DATABASE PUNTI".
- **Prefiltro esatto**: in modalità operativa le combinazioni che sarebbero comunque scartate (tratte teoriche, bloccate, non disponibili, partenza non raggiungibile) si eliminano prima dei limiti di valutazione. Così combinazioni geometricamente migliori ma non operative non riempiono più i posti a scapito di quelle valide.
- **Correzione ostacoli**: una tratta da un marker al centro di un corpo risultava "bloccata" dal corpo stesso in circa metà delle direzioni, a causa di un artefatto numerico. Ora resta semplicemente teorica ("centro"). Una posizione XYZ libera dentro un pianeta è classificata come centro o superficie e non è mai operativa.
- **Modello ostacoli di Stanton**: per Calliope, Euterpe e Clio il seed di starmap.space riporta posizioni lontane da 130.000 a 215.000 km da quelle di CitizenHQ, il frame dei marker. Gli avamposti su quelle lune risultavano in spazio libero, quindi tratte "supportate". Ora il corpo si controlla nella posizione importata, e quella del seed resta come ostacolo incerto. Effetto: in modalità operativa i marker di Stanton utilizzabili passano da 93 a 47 su 435. È più restrittivo, non meno.

## 0.5.5-web (2026-11-05)
- Import Excel: il menu a tendina "Duplicati" è sostituito da due pulsanti espliciti. "📥 Importa solo i nuovi" lascia invariati i punti già presenti; "♻ Importa e aggiorna i già presenti" ne aggiorna solo i campi presenti nel file. "Controlla" indica quanti punti del file sono già nel database.

## 0.5.4-web (2026-11-05): correzione dei pulsanti dell'elenco e coordinate planetarie
- **Correzione** (segnalata da Lorenzo): `reload()` ricostruiva la mappa `byId` dopo aver disegnato la tabella. Così CALCOLA ROTTA, Modifica ed Elimina restavano inerti subito dopo un import e alla riapertura del database, finché non si toccava un filtro. Ora la mappa si ricostruisce prima della tabella, e ogni pulsante cerca il punto al momento del clic.
- **Coordinate planetarie**: si conservano corpo celeste, latitudine, longitudine, altitudine, X/Y/Z locali (km) e sistema di riferimento. Restano visibili in tabella, nel modulo, nell'export e nel backup. **Non vengono mai convertite** in XYZ di sistema: un punto che ha solo coordinate planetarie non ha CALCOLA ROTTA.
- **Metadati**: si conservano anche "Metodo di origine" e "Fonte risorse".
- **Import in modalità "aggiorna"**: cambia solo i campi presenti nel file e lascia invariati gli altri (classificazione, priorità, coordinate planetarie, note). Prima un file con meno colonne poteva cancellarli.
- Motore di navigazione invariato.

## 0.5.3-web (2026-11-05)
- DATABASE PUNTI vuoto: nell'area dell'elenco compaiono i pulsanti "Importa da Excel" e "Ripristina backup JSON", senza doverli cercare nella colonna di sinistra.

## 0.5.2-web (2026-11-05): import affidabile dopo gli aggiornamenti
- **Correzione**: subito dopo un aggiornamento il browser poteva tenere in cache per circa 10 minuti la pagina della versione precedente e caricare gli script nuovi. Il DATABASE PUNTI si fermava senza messaggi e l'import "non faceva nulla". Ora il service worker rivalida ogni file con il sito. Se le versioni sono comunque mescolate, compare un avviso che chiede Ctrl+F5, e il resto di NAVCOM continua a funzionare.
- **"Importa" funziona anche senza "Controlla"**: il controllo viene eseguito comunque. Se non c'è nulla da salvare, perché i punti sono tutti duplicati o le righe hanno errori, lo dice esplicitamente.
- Dopo l'import i filtri della tabella vengono azzerati, così si vedono subito i punti appena importati.

## 0.5.1-web (2026-11-05): classificazione e grandi archivi
- **Correzione**: l'import non leggeva i file .xlsx creati da programmi .NET/OpenXML SDK (elementi con prefisso `x:`), che finivano con "Nessun foglio leggibile".
- Nuovi campi facoltativi: **Classificazione**, **Priorità** (Alta/Media/Bassa), **Fonte dei dati**. Sono presenti nel modulo, nella tabella, nei filtri, nell'import, nell'export e nel backup.
- Import: "Risorsa cercata", "Gruppo" e "Fonte geometria" sono riconosciute in automatico; lo stato "Da georeferenziare" diventa "Da verificare" senza avviso.
- Prestazioni: duplicati e import passano da circa 5 s bloccanti a circa 40 ms su 3.355 punti grazie a un indice. La tabella mostra al massimo 400 righe alla volta.

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
