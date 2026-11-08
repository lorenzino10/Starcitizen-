# STAR CITIZEN NAVCOM

Pianificatore di navigazione spaziale per Star Citizen, locale, da usare sul
secondo monitor. Calcola distanze 3D, tratte quantiche candidate, il punto in
cui interrompere manualmente un salto per avvicinarsi a un punto arbitrario e
le interruzioni per l'Aaron Halo.

Non legge la memoria del gioco, non tocca i file del client, non automatizza
comandi e non interagisce con l'anti-cheat. Le posizioni si inseriscono a mano.

## Versione web (GitHub Pages), consigliata

App: <https://lorenzino10.github.io/Starcitizen-/>

**🌌 ATLANTE** (0.7.0, prima scheda): mappa 3D di Stanton, Pyro e Nyx
(rotazione, zoom, pan, ricerca, vista 2D, globo dei corpi con raggio noto) con
1.822 luoghi e 1.520 modelli di missione di trasporto presi dai file di gioco
(scunpacked-data, patch 4.10.2). Per ogni luogo: missioni in uscita, in arrivo,
in transito e offerte, sempre distinte; combinazioni di missioni (stacking) con
capacità verificata dopo ogni operazione; BEST STACK FINDER con tre scenari;
piano cargo salvabile; Discovery dei luoghi da esplorare. I modelli non sono
offerte disponibili: il punto reale si conferma nel MobiGlas. Dettagli e limiti:
[docs/ATLAS.md](docs/ATLAS.md).

**🛰 PIANIFICATORE** (Fasi 4–5): inserisci X, Y, Z
arbitrarie nel sistema scelto (Stanton, Pyro o Nyx) e, se vuoi, la tua posizione,
anche in un altro sistema. NAVCOM cerca la strategia migliore:
- una interruzione;
- un salto diretto;
- un avvicinamento in due fasi.

Può aggiungere salti di posizionamento (Dijkstra) e passare per i jump point. Puoi
ordinare i risultati per residuo, per tempo o per raggiungibilità operativa. Per
ogni interruzione indica:
- il cambio di lettura HUD da attendere;
- l'incertezza dovuta all'arrotondamento;
- l'incertezza dovuta al tempo di reazione.

Produce anche una scheda operativa con le istruzioni per il pilota. In
modalità **operativa** usa solo tratte verificate o supportate; in modalità
**geometrica** esplora tutto. Modello, fonti e limiti:
[docs/NAVIGAZIONE_OPERATIVA.md](docs/NAVIGAZIONE_OPERATIVA.md). Prove da fare
in gioco: [docs/COLLAUDO_IN_GIOCO.md](docs/COLLAUDO_IN_GIOCO.md). Novità:
[CHANGELOG.md](CHANGELOG.md).

**📦 LOGISTICS** (0.6.0): pianificazione del trasporto merci per pilota
solitario. Le viste sono quattro:
- FREIGHT RADAR: dove cercare carichi lungo il percorso, con tre alternative;
- MISSION BOARD: i tuoi contratti, più il catalogo dei modelli di missione (Star Citizen Wiki API e SCHaulingPlanner);
- CARGO MANIFEST: stiva dopo ogni operazione, con grafico;
- FLIGHT DISPATCH: ottimizzazione pickup-and-delivery con capacità e precedenze, e ricalcolo durante il viaggio.

Lo storico delle tue osservazioni alimenta "Dove conviene cercare?". Un modello di
catalogo non viene mai presentato come un'offerta disponibile.
Dettagli: [docs/LOGISTICS.md](docs/LOGISTICS.md).

**🗂 DATABASE PUNTI** (0.5.0): archivio personale delle tue destinazioni
(nome, sistema, XYZ in km o m, categoria, risorsa, stato, note, date). I punti
li inserisci tu, li importi da Excel (.xlsx, con anteprima, associazione delle
colonne e controllo dei duplicati) o li salvi dal pianificatore: NAVCOM non
genera coordinate. Ricerca, filtri, modifica, eliminazione singola o multipla,
export Excel/JSON, backup e ripristino. **🛰 CALCOLA ROTTA** accanto a ogni
punto lo passa al pianificatore e calcola subito salti, interruzioni e
istruzioni. I dati restano in IndexedDB **solo in quel browser su quel
dispositivo**: esporta il JSON come backup. Dettagli:
[docs/DATABASE_PUNTI.md](docs/DATABASE_PUNTI.md).

**⌖ RICERCA INVERSA QT**: inserisci un punto P qualsiasi
(XYZ in m o km, nel frame del sistema selezionato). NAVCOM esamina tutte le
coppie di marker QT del sistema, in entrambi i versi A→B e B→A, e le ordina per
distanza minima fra il segmento e P. Per ogni rotta indica:
- A e B;
- la lunghezza della tratta;
- la distanza da A al punto di interruzione;
- la distanza da leggere sull'HUD verso B;
- le XYZ del punto di interruzione;
- il volo convenzionale residuo;
- lo stato della rotta.

La posizione attuale è facoltativa. Se la indichi, ottieni anche il
percorso completo (posizione → A → interruzione → P), ordinato per distanza QT
oppure per tempo, se inserisci le velocità. Ricevi un avviso se P è dentro un
pianeta o fuori dalla regione coperta dai dati. Le tratte con un estremo al
centro di un pianeta o sulla sua superficie (che ruota) restano "Teoriche".

La cartella `web/` contiene NAVCOM come **app web statica**: lo stesso motore
riscritto in JavaScript (stessi test, stessi risultati), nessun server e
nessuna installazione. Si apre da qualunque browser, anche dal telefono.

- **Dati**: a ogni pubblicazione e una volta al giorno il workflow
  `pages.yml` scarica da CitizenHQ le posizioni di Stanton, Pyro e Nyx e le
  pubblica insieme al sito. Dalla scheda DATI puoi anche aggiornarle in
  diretta dal browser (CitizenHQ dichiara CORS attivo) oppure importare un
  file JSON.
- **Archivio personale**: il DATABASE PUNTI è in IndexedDB (con backup JSON
  ed export Excel propri); letture Starmap, rotte e tratte verificate restano
  in localStorage. Usa **Esporta/Importa backup** per spostarli su un altro
  PC o browser.
- **Attivazione, una volta sola**: *Settings → Pages → Build and deployment →
  Source: GitHub Actions*. Su un repository **privato** GitHub Pages richiede
  un piano a pagamento (Pro); in alternativa il repository va reso pubblico.
- **In locale, senza pubblicare**: `cd web` e poi `python -m http.server 8000`, quindi
  apri <http://127.0.0.1:8000>. Da file:// non funziona, perché i moduli ES
  richiedono un server.
- **Grafici offline**: la libreria Plotly 2.35.2 è inclusa nel repository
  (`web/vendor/`, licenza MIT) e non si scarica da CDN esterne. Dopo la prima
  apertura, un service worker (`web/sw.js`) tiene in cache sito e libreria, quindi
  NAVCOM e i grafici 2D/3D funzionano anche senza rete. Se il grafico non si
  carica, il messaggio distingue tre casi: file mancante sul sito (errore di
  pubblicazione), problema di connessione, file corrotto o bloccato.
- **Test**: `npm ci --prefix web` (solo la prima volta: installa `fake-indexeddb`, usata solo dai test) e poi `npm test --prefix web`.

## Avvio su Windows 11 (versione desktop Python)

1. Installa **Python 3.12** da <https://www.python.org/downloads/> e, nella
   prima schermata dell'installer, spunta **"Add python.exe to PATH"**.
2. Scarica il repository (pulsante *Code → Download ZIP*, oppure `git clone`)
   ed estrailo, per esempio in `C:\NAVCOM`.
3. Fai doppio clic su **`avvia_navcom.bat`**. La prima volta crea l'ambiente
   `.venv` e installa le dipendenze (1–2 minuti), poi apre il browser su
   <http://127.0.0.1:8601>. Trascina la finestra sul secondo monitor.
4. Nella barra laterale premi **⟳ Importa / aggiorna dati**: scarica le
   posizioni di Stanton da CitizenHQ e le salva in `dati\navcom.sqlite3`. Da
   quel momento il programma funziona anche offline. Ripeti l'import per Pyro
   e Nyx selezionandoli.
5. Per chiudere NAVCOM chiudi la finestra nera del terminale.

`esegui_test.bat` esegue tutti i test e stampa il confronto Aaron Halo.

## Uso rapido

**🧭 ROTTA**: scegli la partenza e la destinazione (punto ufficiale, punto
personale o coordinate XYZ in m o km), poi premi **CALCOLA ROTTA**. Ottieni:
- le tratte QT candidate, ordinate per volo convenzionale residuo;
- per ognuna, la distanza da attendere sull'HUD (distanza verso la
  destinazione QT) e il volo convenzionale che resta dopo l'interruzione;
- lo stato della tratta: 🟢 verificata in gioco (la segni tu), 🔵 supportata
  dai dati, 🟠 teorica;
- la mappa 2D/3D, il salvataggio della rotta e il pulsante "l'ho provata in
  gioco".

**☄ AARON HALO**: scegli la partenza e la fascia. Il programma trova le
destinazioni QT la cui tratta attraversa la fascia entro la sua altezza e
indica la distanza HUD all'ingresso, al picco di densità e all'uscita.

**🗂 DATABASE PUNTI**: le tue destinazioni XYZ (vedi sopra).

**📍 PUNTI PERSONALI**: archivia le letture della Starmap (in forma grezza,
vedi sotto). I vecchi punti XYZ sono stati trasferiti nel DATABASE PUNTI.

**🗄 DATI E FONTI**: posizioni in archivio, storico delle importazioni,
provenienza e conflitti dei dati.

## Architettura

```
navcom_app.py            interfaccia Streamlit (nessun calcolo qui)
navcom/
  core/                  MOTORE MATEMATICO, senza dipendenze esterne
    vector.py            Vec3, distanza
    geometry.py          proiezione punto-segmento con t ∈ [0,1], radici segmento-sfera
    qt.py                tratte QT, punto di interruzione, ostacoli, classificazione, ranking
    halo.py              fasce dell'Aaron Halo, attraversamenti, localizzazione
    units.py             formattazione km/Mm/Gm e lettura HUD
  data/                  ACQUISIZIONE DATI
    citizenhq.py         client HTTP (timeout, 429, 5xx, JSON non valido)
    bodies.py            corpi celesti per gli ostacoli (seed locale)
    models.py
  db/database.py         SQLite: posizioni, punti personali, letture Starmap,
                         tratte verificate, rotte salvate, log degli import
  services/planner.py    unisce DB, dati e motore per l'interfaccia
  ui/plots.py            grafici Plotly
  seed/                  dati locali con attribuzione
tests/                   pytest: casi sintetici esatti e caso reale Aaron Halo
tools/aaron_halo_report.py
docs/FONTI.md            verifica delle fonti e delle API
docs/AARON_HALO.md       confronto con SCMiner e Cornerstone
```

### Modello matematico
- Unità interna: il **metro**. Coordinate cartesiane nel frame della griglia di
  sistema, con lo stesso frame per tutte le fonti importate.
- Una tratta QT S→D è il segmento `P(t) = S + t·(D−S)`.
- Punto di interruzione verso un bersaglio P: `t* = clamp(((P−S)·(D−S)) / |D−S|², 0, 1)`,
  `C = P(t*)`.
- Valore da attendere sull'HUD: `|D − C|`. Volo convenzionale residuo: `|P − C|`.
- Ostacoli: il segmento non deve entrare nella sfera con raggio pari al raggio
  del corpo × margine. Se un estremo della tratta è dentro quella sfera (avamposto in
  superficie), il raggio si riduce alla distanza dell'estremo dal centro.
- Aaron Halo: radici dell'equazione `|S + t·d|² = r²` per i raggi interno,
  esterno e di picco di ogni fascia, con controllo della quota |z|.

## Cosa NAVCOM non fa (di proposito)
- **Modalità Starmap**: i valori letti nella Starmap vengono archiviati
  grezzi. Formato, unità e origine non sono ancora verificati, quindi la
  conversione in XYZ **non esiste**: verrà attivata solo dopo la verifica.
- **Rotazione dei pianeti**: i punti sulla superficie dei pianeti ruotano. Le
  coordinate XYZ personali hanno senso per punti nello spazio (deep space).
  Per la superficie servirà la Fase 3.
- Tempi di reazione, accelerazione e decelerazione del QT e distanza di arrivo
  dei marker non sono modellati: ogni numero è una distanza geometrica.
- Una tratta "Supportata dai dati" non è garantita in gioco: il raggio di
  ostruzione reale è stimato.

## Fasi successive
- **Fase 2**: itinerari multi-tratta (tratte di posizionamento per migliorare
  l'allineamento), ostacoli più precisi e gestione delle tratte verificate.
- **Fase 3**: Pyro e Nyx con i corpi celesti, attraversamento dei jump point,
  archivio personale esteso, 3D avanzato, POI di superficie con rotazione.

## Fonti e attribuzioni
Posizioni: CitizenHQ (UEX Corp, SC Trade Tools, scunpacked, Star Citizen Wiki).
Fasce Aaron Halo: CaptSheppard / Cornerstone (cstone.space). Raggi dei corpi
celesti: starmap.space (tramite ByteCollectiveIO/sc-nav). Missioni di trasporto:
Star Citizen Wiki API, SCHaulingPlanner (FSCSOFT-Official) e scunpacked-data
(StarCitizenWiki, file di gioco: luoghi, modelli di missione, navi). Dettagli in
[docs/FONTI.md](docs/FONTI.md). Progetto non ufficiale, non affiliato a Cloud
Imperium Games.
