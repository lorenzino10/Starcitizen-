# STAR CITIZEN NAVCOM

Pianificatore di navigazione spaziale per Star Citizen, locale, da usare sul
secondo monitor. Calcola distanze 3D, tratte quantiche candidate, il punto in
cui interrompere manualmente un salto per avvicinarsi a un punto arbitrario e
le interruzioni per l'Aaron Halo.

Non legge la memoria del gioco, non tocca i file del client, non automatizza
comandi e non interagisce con l'anti-cheat. Le posizioni si inseriscono a mano.

## Avvio su Windows 11

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

**📍 PUNTI PERSONALI**: salva punti XYZ e archivia le letture della Starmap
(in forma grezza, vedi sotto).

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
celesti: starmap.space (tramite ByteCollectiveIO/sc-nav). Dettagli in
[docs/FONTI.md](docs/FONTI.md). Progetto non ufficiale, non affiliato a Cloud
Imperium Games.
