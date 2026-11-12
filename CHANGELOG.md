# Registro delle modifiche

## 2.0.0-web (2026-11-12): COMMAND BRIDGE e MISSION DATABASE 2.0
Dettagli, fonti valutate, confronto dei conteggi e limiti in [docs/MISSIONS.md](docs/MISSIONS.md).
- **Command Bridge** (nuova home al posto della PLANCIA):
  - Striscia in alto con nave, sistema, posizione, destinazione, stato della rotta e versione dei dati; scheda nave espandibile.
  - Mappa centrale col motore dell'ATLANTE: corpi, stazioni, posizione, destinazione, tratta QT del pianificatore, missioni selezionate. La geometria reale è distinta da quella schematica, con legenda.
  - Pannello contestuale: prossimo salto, distanza, interruzione QT, avvisi; pulsanti CALCOLA ROTTA, APRI DESTINAZIONE, PREPARA SPEDIZIONE. Senza destinazione mostra ricerca e suggerimenti.
  - Barre MISSIONI / CARGO / ATTIVITÀ.
  - Navigazione raggruppata in OPERAZIONI / NAVIGAZIONE / ARCHIVI: tutte le 12 schede restano.
- **Mission Database 2.0**:
  - Fonti: Star Citizen Wiki API come primaria (versione LIVE, gruppi di varianti), scunpacked come secondaria.
  - Copertura: 4.197 modelli rilasciati di tutte le categorie, contro i 1.520 di solo trasporto di prima.
  - Pipeline giornaliera in GitHub Actions con catalogo versionato, validazione, diff, storico e fallback allo snapshot precedente, sempre dichiarato.
  - Nel browser: copia locale in IndexedDB e riga di provenienza sempre visibile (versione, build, fonte, data, numero di modelli).
  - Classi CATALOGATA / POTENZIALMENTE DISPONIBILE / OSSERVATA NEL MOBIGLAS / OSSERVAZIONE STORICA / ACCETTATA / COMPLETATA / FALLITA. Nessun "disponibile ora".
  - Ricerca missioni con DA / VERSO / TIPO / RICOMPENSA MINIMA / NAVE / CARICO / RISCHIO; tratte certe separate da quelle variabili; missioni interstellari attraverso la rete dei salti.
  - Stacking dal Command Bridge: le tratte fra sistemi passano dai gateway, con distanze reali e tempo nel tunnel lasciato vuoto.
  - Registrazione di un contratto visto nel MobiGlas partendo dal modello, con screenshot facoltativo e avvisi sulle incongruenze.
  - ATLANTE: nuova sezione "Compatibili con le missioni selezionate" nella scheda della stazione.
- **Correzioni**: le missioni interstellari assegnate a un solo sistema scendono da 32 a 2 (i due rimasti hanno pool davvero vuoti).
- **Dati personali**: nessuna migrazione dello schema. Punti, rotte, piani cargo, missioni personali, annotazioni e preferenze restano intatti.
- Test: 13 nuovi (MD-1..MD-12), 213 in totale (203 superati, 10 todo già presenti, 0 falliti).

## 1.0.0-web (2026-11-12): PLANCIA, mappe a livelli e ricerca universale
Nuova home **⌂ PLANCIA** (Command Dashboard). Dettagli, fonti valutate e lacune in [docs/DASHBOARD.md](docs/DASHBOARD.md).
- **Barra di stato**:
  - Mostra versione, sistema, nave, posizione, destinazione, ora locale e la data di ciascuna fonte dati.
  - Nessun indicatore di connessione o telemetria.
- **Posizione attuale**:
  - Si imposta con INCOLLA /SHOWLOCATION, rispettando il permesso degli appunti, oppure a mano.
  - Mostra corpo e marker QT più vicini, ora della lettura e origine; senza dati, POSIZIONE NON IMPOSTATA.
  - Pulsante per salvarla nel DATABASE PUNTI.
- **Mini mappa** con posizioni reali, in due viste: dintorni o intero sistema. Mostra posizione, destinazione e ultima rotta; la quota Z non è rappresentata ed è dichiarato. Un clic apre l'ATLANTE.
- **Nave**:
  - Predefinita: RSI Constellation Mk V Centaurus; si può scegliere tra tutte quelle dei file di gioco.
  - Mostra produttore, ruolo, cargo, serbatoi, autonomia e velocità QT, componenti di serie e dimensioni, più le tue note.
  - Nessuno stato di carburante, scudi o danni.
- **Rotta attiva e destinazione**:
  - Il riepilogo arriva dal PIANIFICATORE senza ricalcoli: percorso QT, salti, uscite, residuo, stato di verifica.
  - La distanza è in linea retta solo nello stesso sistema.
  - APRI PIANIFICATORE usa la posizione come partenza se il sistema è lo stesso.
- **Ricerca universale**: luoghi, punti personali, servizi, negozi, articoli, merci e minerali, ciascuno con il tipo indicato.
- **Accesso rapido**:
  - Città, stazioni, avamposti, negozi, ospedali, raffinerie, mining: solo luoghi documentati, con il motivo.
  - Collegamenti a pianificatore, ricerca inversa, database, mappe, rotte salvate e preferiti.
- **Attività recente**: destinazioni consultate, rotte salvate, punti modificati, preferiti e visite (solo quelle confermate da te).
- **DESTINATION INTELLIGENCE**:
  - Nuova sezione "Struttura e negozi" in vista **schematica** dichiarata: luoghi figli dalla starmap e negozi raggruppati per l'area scritta nel nome del terminale UEX.
  - Scheda negozio con POSIZIONE INTERNA NON DOCUMENTATA e MOSTRA SULLA MAPPA, che porta al luogo che contiene il negozio.
  - Nuovi pulsanti nella scheda: 🎯 Imposta destinazione, ☆ preferito, ✓ Segna come visitata.
- **Navi**: aggiunti produttore, dimensioni, velocità QT e componenti di serie dai file di gioco.
- **Dati personali**: lo stato della plancia sta in chiavi separate dello stesso archivio. Schema invariato, nessun punto toccato. Backup con "Esporta stato plancia (JSON)".
- La PLANCIA è la scheda iniziale; l'ATLANTE resta a un clic.
- Test: 16 nuovi test sintetici, 190 in totale.

## 0.9.2-web (2026-11-12): luoghi sovrapposti nell'ATLANTE
- Clic su un gruppo di luoghi praticamente nello stesso punto (es. Megumi Refueling e un tuo punto personale P6 L5, a pochi metri): prima la mappa zoomava all'infinito senza aprire nulla, ora compare l'elenco per scegliere quale aprire.

## 0.9.1-web (2026-11-12): ATLANTE e selettore SISTEMA allineati
- Il selettore SISTEMA in alto ora cambia anche l'ATLANTE, e viceversa (link Stanton · Pyro · Nyx o ricerca di un luogo in un altro sistema). All'avvio l'atlante si apre sul sistema del selettore.
- Colore della stella per sistema nella grafica 3D (solo resa: Pyro rossastra, Nyx violacea).

## 0.9.0-web (2026-11-09): ATLANTE in WebGL
- **Grafica 3D** nell'ATLANTE con WebGL scritto da zero (nessuna libreria, nessun CDN): cielo stellato, stella con corona, pianeti e lune come sfere illuminate dalla stella (lato notte, atmosfera, luci di ArcCorp), giganti gassosi a bande, orbite di pianeti e lune.
- Le superfici sono **illustrative** (procedurali): non sono texture del gioco né dati. Posizioni e raggi sono quelli reali; con la scala compressa le sfere non vengono disegnate.
- Marker ed etichette restano sopra, nel canvas 2D, e diventano discreti quando la sfera è abbastanza grande: selezione, gruppi, linee delle missioni e distanze invariati.
- Interruttore **Grafica 3D** nella barra (ricordato); se il browser non ha WebGL resta la mappa 2D completa.

## 0.8.1-web (2026-11-09): correzioni DESTINATION INTELLIGENCE
- Filtro dei negozi: il testo non si scrive più al contrario (il campo veniva ridisegnato a ogni tasto e il cursore tornava all'inizio).
- Ricerca articoli anche in italiano: "fucile" trova i Rifle, "casco" gli Helmet, "caricatore" i Magazine e così via (i nomi UEX sono in inglese).
- Il luogo scelto nell'ATLANTE è già aperto quando passi a DESTINATION INTELLIGENCE (se nel frattempo non ne hai aperto un altro lì).

## 0.8.0-web (2026-11-09): DESTINATION INTELLIGENCE
Nuova scheda **📚 DESTINATION INTELLIGENCE**, enciclopedia operativa delle destinazioni. Fonti, matrice campo → fonte, collaudo e lacune in [docs/DESTINATIONS.md](docs/DESTINATIONS.md).
- **Ricerca universale** su sistemi, corpi, stazioni, città, avamposti, POI, luoghi UEX e punti del DATABASE PUNTI (anche senza XYZ), con abbreviazioni (NB, A18, LV…), numeri romani, omonimi segnalati e sistema · corpo · tipo sempre visibili.
- **Scheda**: riepilogo a riquadri, poi ambiente e sopravvivenza (esterno solo in superficie, interno solo per strutture, punto XYZ classificato rispetto al corpo più vicino), sicurezza (armistizio mai dedotto dal livello di sicurezza, giurisdizione ereditata e dichiarata), hangar e servizi distinti per fonte e mai ereditati, negozi con filtri, merci, mining (aree di spawn, non giacimenti), preparazione spedizione per nave (documentato / consigli / dati mancanti), collegamento al pianificatore.
- **Strumenti**: CERCA ARTICOLO e DOVE POSSO VENDERE con distanze reali nello stesso sistema e RAGGIUNGI DESTINAZIONE; prezzi sempre come segnalazioni datate, mai in tempo reale.
- **Integrazione**: ATLANTE → Scheda destinazione; PIANIFICATORE → INFORMAZIONI DESTINAZIONE; scheda → CALCOLA ROTTA. Algoritmi di navigazione e punti salvati invariati; annotazioni e collegamenti confermati salvati a parte.
- **Snapshot** generato in GitHub Actions da file di gioco (scunpacked), UEX Corp API 2.0 e starmap.space, senza chiavi; una fonte giù riusa l'ultimo snapshot e lo dichiara. Ogni dato con fonte, data/versione e stato.
- 16 nuovi test sintetici (172 in totale).

## 0.7.2-web (2026-11-08): scheda della base più semplice
Solo interfaccia della scheda ATLANTE: nessun cambiamento a dati, motore delle evidenze o navigazione.
- **Riepilogo in alto**: quattro riquadri CERTE · POSSIBILI · REGIONALI · ALTRE BASI; un clic apre la sezione e ci scorre sopra.
- **Predefinita "Tutte, con etichetta"** (prima VERIFICATE, che a una base mostrava spesso solo 2-3 missioni). Ogni riga resta etichettata CERTO / POSSIBILE / REGIONALE. Una scelta esplicita viene ricordata.
- **Righe compatte**: titolo, ricompensa, ⬆ ritiro → ⬇ consegna; tappe identiche raggruppate (×N), "qui" / "(anche qui)" per il luogo scelto; motivo e dettagli completi in "dettagli e motivo".
- Avviso con pulsante **Mostrale** quando il filtro illegali nasconde missioni del luogo.
- VOGLIO ARRIVARE A spostato in alto; azioni rinominate (Combina dati certi / anche possibili, Perché questi numeri?); dati del luogo e azioni secondarie in un riquadro chiudibile.
- Pannello destro più largo (520 px, 440 sotto i 1400 px) e mappa più alta.

## 0.7.1-web (2026-11-08): LOCATION INTELLIGENCE estesa
Correzione della scheda ATLANTE: una base non mostrava le missioni che la riguardano se non erano legate al suo identificativo esatto. Dettagli in [docs/ATLAS.md](docs/ATLAS.md#location-intelligence-estesa-071).
- **Ricerca geografica estesa** (`MissionIndex.forPlaceExpanded`, `forPlace` invariato): CERTO, POSSIBILE (il gioco assegna il luogo), REGIONALE (luna, pianeta, sistema: base non confermata), SCONOSCIUTO, più ALTRE BASI NELLA REGIONE non contate come missioni del luogo. Otto sezioni con conteggi indipendenti e missioni uniche senza duplicati.
- **Modalità** VERIFICATE / MOSTRA ANCHE POSSIBILITÀ, salvata; **filtro di distanza** sulla gerarchia (stessa base, luna, pianeta, tra pianeti, tra sistemi).
- **VOGLIO ARRIVARE A**: luogo, luna, pianeta o sistema; solo collegamenti dentro lo stesso contratto, tratte intermedie dichiarate come due contratti; "NESSUN COLLEGAMENTO DOCUMENTATO NEI DATI DISPONIBILI" quando i dati non lo mostrano.
- **Mappa**: missioni trovate separate dalle linee disegnate; pool troppo grandi restano in elenco con nota e "Disegna comunque"; linee regionali distinte; mai linee fra sistemi.
- **EXECUTIVE STACK** (solo dati verificati, quantità assunte escluse) ed **EXPLORATORY STACK** (combinazione teorica, nessun manifesto, elenco di cosa verificare) con conversione in contratto dopo la conferma nel MobiGlas.
- **Diagnostica del catalogo** dalla scheda del luogo, con i motivi di uno zero.
- **Normalizzazione**: nomi qualificati dal gioco ("Checkmate at the L4 Lagrange of Pyro II") risolti solo se univoci: pool con luogo unico da 133 a 242, coda da 245 a 235. Un pool che nomina solo un corpo celeste non è più un punto fisso. Datori "<= UNINITIALIZED =>" ora "non indicato".
- Collaudo reale su ArcCorp Mining Area 061: 3 esatte (tutte storiche), 118 in pool, 228 offerte regionali, 0 certe verso microTech.
- 18 nuovi test sintetici. Service worker 0.7.1: ogni file rivalidato, cache vecchie cancellate (verificato con una pubblicazione simulata).

## 0.7.0-web (2026-11-08): 3D MISSION ATLAS & CARGO INTELLIGENCE
Nuova scheda **🌌 ATLANTE**, ora la prima. Documentazione in [docs/ATLAS.md](docs/ATLAS.md).
- **Mappa 3D** su canvas 2D (nessuna libreria, nessun WebGL): rotazione, zoom, pan, clic, ricerca, centra, reset, vista 2D dall'alto, scala visiva compressa opzionale (le distanze restano reali), raggruppamento dei punti vicini ed etichette senza sovrapposizioni. Mai distanze euclidee fra sistemi.
- **Globo** di pianeti e lune con raggio noto (Stanton e Pyro; Nyx resta schematico). I luoghi in superficie hanno lat/lon nel frame fisso del corpo, dichiarate come non coordinate di gioco.
- **Database geografico unificato** da scunpacked-data: 1.822 luoghi con id canonico, alias, tipo, genitore, frame, fonte, patch, servizi dei terminali. Risoluzione dei nomi esatta, compatta, per suffisso unico e con alias curati; i nomi ambigui o sconosciuti vanno in **coda di normalizzazione** (245).
- **Catalogo missioni** dai file di gioco: 1.520 modelli di trasporto (1.049 con ricompensa fissa), con offerta, ritiro e consegna separati e pool di alternative dichiarati. Unito allo storico SCHaulingPlanner e ai tuoi contratti, ognuno con la propria origine.
- **LOCATION INTELLIGENCE**: scheda del luogo con missioni in uscita, in arrivo, in transito e offerte; "Punto da confermare nel MobiGlas" dove il luogo non è certo.
- **Linee delle missioni** con stili distinti (confermata, ipotetica, percorso NAVCOM, geometria non verificata, offerta) e TUTTI I COLLEGAMENTI aggregati con filtri; clic su una linea = i suoi contratti.
- **Mission Stacking** (sette tipi) e **BEST STACK FINDER** (massimo guadagno, massima efficienza, minimo viaggio), riusando l'ottimizzatore di LOGISTICS: capacità e precedenze sempre verificate, classi ESEGUIBILE / POTENZIALMENTE ACCUMULABILE / DA VERIFICARE / INCOMPATIBILE.
- **Piani cargo** salvati in IndexedDB con manifest, grafico della stiva e riordino validato; modalità compatta per il secondo monitor.
- **Discovery**: punteggio deterministico e spiegato; visite alla bacheca registrate a mano, frequenze per patch, mai probabilità.
- **Inserimento manuale** con più ritiri e consegne, screenshot facoltativo (solo nel browser) e controllo dei duplicati.
- **Dati**: `web/tools/fetch_atlas.mjs` nel workflow Pages; se fallisce, si riusa l'ultimo snapshot pubblicato con la sua data. Copia offline in IndexedDB.
- **IndexedDB `navcom-logistics` v2**: nuovi store `plans` e `attachments`, migrazione automatica senza perdita di dati; backup completo v2.
- 25 nuovi test con dati sintetici. Pianificatore, Aaron Halo, DATABASE PUNTI e LOGISTICS invariati.

## 0.6.0-web (2026-11-08): NAVCOM LOGISTICS INTELLIGENCE
Nuova scheda **📦 LOGISTICS**, documentata in [docs/LOGISTICS.md](docs/LOGISTICS.md).
- **Modello dei contratti**: un contratto è fatto di movimenti (merce, SCU, cassa massima, un ritiro, una consegna, quantità caricate e consegnate). Gli stati sono Osservata, Confermata, Accettata, In esecuzione, Completata, Fallita e Non disponibile. Il catalogo non è uno stato: non diventa mai un'offerta senza un'azione tua con luogo e momento.
- **MISSION BOARD**: inserimento manuale ("Missione trovata"), import ed export JSON e CSV (una riga per movimento), cambi di stato espliciti, catalogo dei modelli con fonte, patch e copertura.
- **Ottimizzatore pickup-and-delivery**: capacità e precedenze sempre verificate. Metodo esatto fino a 10 operazioni, oltre euristico deterministico. Movimenti più grandi della stiva divisi in più viaggi. Confermati proposti "da accettare"; quelli con grado insufficiente, casse troppo grandi o luoghi ignoti vengono esclusi con il motivo. Priorità: profitto, profitto per ora (solo con tempi noti), pochi scali, rischio, utilizzo della stiva.
- **CARGO MANIFEST**: per scalo, operazioni, stiva dopo ogni operazione, capacità residua, ricompense maturate e da ottenere, avvisi sulle casse. Grafico SVG della stiva. La compatibilità fisica dichiarata come non verificata.
- **FLIGHT DISPATCH**: le azioni durante il viaggio ricalcolano senza perdere contratti accettati, merce a bordo e consegne dovute. "Salta questa stazione" non elimina le operazioni obbligatorie. Le stazioni alternative sono previsioni basate sul tuo storico.
- **Intelligence**: osservazioni (anche visite alla bacheca senza offerte) e variazioni rispetto all'osservazione precedente. "Dove conviene cercare?" mostra conteggi e numerosità del campione, mai probabilità. I dati di patch precedenti restano come storico obsoleto. Analisi per luogo, compagnia, rotta e patch.
- **FREIGHT RADAR**: luoghi lungo il percorso con deviazione, opportunità compatibili (grado, stiva, casse), livello di evidenza, fonti, patch e cose da verificare. Tre alternative: conservativa, equilibrata, esplorativa.
- **Fonti**: `web/tools/fetch_logistics.mjs` scrive cataloghi JSON statici in GitHub Actions, prendendo i modelli di missione dalla Star Citizen Wiki API e le 266 missioni osservate di SCHaulingPlanner. Nessuna chiave API.
- **Nave predefinita**: Constellation Mk V Centaurus, verificata sulla Wiki API (4.10.2): 240 SCU, griglia 7,5 × 5 × 12,5 m, cassa massima 32 SCU. La capienza operativa è impostabile.
- **Persistenza**: IndexedDB separato, `navcom-logistics`. Il backup completo comprende punti e logistica, e il ripristino unisce senza cancellare.
- Pianificatore QT, Aaron Halo, DATABASE PUNTI e import/export invariati.

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
