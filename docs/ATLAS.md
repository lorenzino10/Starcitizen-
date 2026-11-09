# 🌌 ATLANTE 3D e CARGO INTELLIGENCE (0.7.0)

Scheda **🌌 ATLANTE**, la prima dell'app. Mappa 3D di Stanton, Pyro e Nyx con le
missioni di trasporto collegate ai luoghi, la loro combinazione (stacking), il
piano cargo e il livello Discovery. Tutto statico: nessun backend, nessuna IA,
nessuna chiave, nessuna missione inventata.

## Cosa c'è davvero (e cosa no)

| Parte | Stato | Note |
|---|---|---|
| Mappa 3D (rotazione, zoom, pan, clic, ricerca, centra, reset) | ✅ | Canvas 2D proprio, nessuna libreria e nessun WebGL. Prospettiva con camera yaw/pitch/distanza. |
| Vista 2D | ✅ | Proiezione ortogonale dall'alto, scala uniforme (metri per pixel). |
| Raggruppamento ed etichette | ✅ | Cluster in spazio schermo (14 px); i corpi celesti hanno priorità nel gruppo; etichette senza sovrapposizioni. |
| Scala visiva compressa | ✅ (attivabile) | `s·ln(1+r/s)` solo grafica; distanze mostrate sempre reali. |
| Globo di pianeti e lune | ✅ dove il raggio è noto | Stanton 16/17 corpi, Pyro 12/13, **Nyx 0/4**: Nyx resta in vista schematica. |
| Posizione dei luoghi sul globo | ✅ con limiti | Lat/lon nel frame **fisso** del corpo, dai dati statici. Non sono le coordinate del gioco (che ruotano). Se un luogo dista più del 10 % del raggio dalla superficie è "in orbita" e non va sul globo. |
| LOCATION INTELLIGENCE (scheda) | ✅ | Gerarchia, tipo, coordinate e frame, marker QT, servizi del terminale, fonte e patch, tue visite. Freight elevator e accesso nave: **non indicati dai dati**. |
| Missioni IN USCITA / IN ARRIVO / TRANSITO / OFFERTE | ✅ | OFFERTA, RITIRO e CONSEGNA sempre distinti. Ritiro ignoto = "Punto da confermare nel MobiGlas". |
| Location Intelligence estesa (0.7.1) | ✅ | CERTO / POSSIBILE / REGIONALE / SCONOSCIUTO, altre basi della regione, filtri di distanza, VOGLIO ARRIVARE A, diagnostica. Sezione dedicata sotto. |
| EXECUTIVE / EXPLORATORY STACK (0.7.1) | ✅ | Executive solo con dati verificati; exploratory = combinazione teorica senza manifesto, conversione in contratto dopo il MobiGlas. |
| Linee delle missioni | ✅ | Confermata (verde), ipotetica (ambra tratteggiata), percorso NAVCOM (ciano), geometria non verificata (rossa puntinata), offerta→ritiro. Mai linee fra sistemi. |
| TUTTI I COLLEGAMENTI | ✅ | Aggregati per coppia, filtri; per default solo pool con ≤ 10 alternative. Clic su una linea = contratti di quella coppia. |
| Mission Stacking | ✅ | SAME PICKUP, SAME DROPOFF, MULTI PICKUP, MULTI DROPOFF, ROUTE OVERLAP, RETURN TRIP, SEQUENTIAL. Capacità verificata dopo ogni operazione. |
| BEST STACK FINDER | ✅ | MASSIMO GUADAGNO, MASSIMA EFFICIENZA, MINIMO VIAGGIO. Esatto fino a 10 operazioni, poi euristico deterministico; limite di tempo 4 s. |
| Cargo Manifest e piano di volo | ✅ | Scali, casse, carico prima/dopo, residuo, ricompense, grafico della stiva; riordino con validazione; salvato in IndexedDB. |
| Modalità compatta (secondo monitor) | ✅ | |
| Experience Engine (osservazioni) | ✅ | Visita alla bacheca da registrare a mano; "nessuna offerta" solo se confermi di aver consultato il pannello. Frequenze, mai probabilità; patch attuale / precedenti / ignota separate; campione piccolo segnalato. |
| Discovery | ✅ | Punteggio deterministico e spiegato (pesi sotto). |
| Inserimento manuale | ✅ | Più ritiri e consegne, screenshot facoltativo (salvato solo nel browser), controllo dei duplicati. |
| OCR degli screenshot | ❌ | Non realizzato. |
| Missioni CitizenHQ | ❌ | Endpoint missioni non verificato: non usato. |
| UEX (prezzi commodity) | ❌ | API pubblica in GET, ma termini solo per uso personale non commerciale; non integrata. |
| Livelli multi-attività (mining, bounty…) | ❌ | Solo predisposizione (filtro categoria). Nessun modulo salvage, per scelta. |

## Fonti e albero delle dipendenze

```
scunpacked-data (StarCitizenWiki/scunpacked-data, file di gioco estratti)
├─ starmap_positions.json ──► geo.json   luoghi, gerarchia, XYZ nel frame del sistema
├─ trade_locations.json  ──► servizi dei terminali (per nome)
├─ contracts/*.json      ──► missions.json  modelli di missione di trasporto
└─ ships.json            ──► ships.json   stiva e griglie
bodies seed (starmap.space via sc-nav) ──► raggi dei corpi (globo)
SCHaulingPlanner (già in 0.6.0) ──► missioni osservate da terzi (storico)
LogisticsDB (tuo browser)       ──► contratti, osservazioni, piani, screenshot
```

- Patch dei dati: **4.10.2-LIVE.12881860** (commit scunpacked del 2026-10-28).
- Licenza scunpacked-data: **nessun file LICENSE** nel repository; i dati sono di
  Cloud Imperium. Uso non commerciale con attribuzione.
- Generazione: `node web/tools/fetch_atlas.mjs [cartella scunpacked]` (senza
  argomento fa un clone sparse). Gira nel workflow Pages ("Atlante…",
  `continue-on-error`). Se fallisce, riprende l'ultimo snapshot pubblicato e lo
  marca `fallback` con la data: l'app mostra la data dello snapshot usato.
- Nel browser: data/atlas/*.json → copia in IndexedDB (meta `atlasSnapshot`) →
  in mancanza di entrambi, posizioni CitizenHQ già in cache (senza missioni).

### Numeri del catalogo (snapshot 2026-11-08)

- Luoghi: **1.822** (Stanton 848, Pyro 287, Nyx 687). I 739 non nascosti coincidono con CitizenHQ.
- Modelli di missione di trasporto: **1.520** su 5.153 contratti letti (Stanton 1.122, Pyro 298, Nyx 57, sistema non determinabile 43). **1.049** con ricompensa fissa.
- Pool di luoghi: **4.555**, di cui solo **242** con un luogo unico (133 prima dei nomi qualificati della 0.7.1). Il resto sono pool di alternative: il gioco sceglie il punto quando genera la missione.
- Nomi non riconosciuti in coda di normalizzazione: **235** (245 nella 0.7.0).
- Navi con stiva: **127**.

**Attenzione:** sono *modelli* dai file di gioco, non offerte. Nessun modello è
mai presentato come disponibile adesso.

## Identificativi e risoluzione dei nomi

Luogo canonico: `{id (uuid starmap), name, aliases, type, kind, system, parentId,
pos{x,y,z} m, frame, hidden, qtValid, radius, radiusSource, services, source,
patch, updatedAt, ext}`.

Ordine di risoluzione di un nome: esatto → senza spazi → suffisso unico → nome qualificato dal gioco (0.7.1: "Checkmate at the L4 Lagrange of Pyro II", "Orbituary above Pyro III": accettato solo se la parte iniziale è un luogo unico e coerente con il corpo nominato)
("Wide Forest Station" → "ARC-L1 Wide Forest Station") → alias curati (spazioporti:
Teasa → Lorville, August Dunlow → Orison, Riker Memorial → Area18, NB Int. /
New Babbage Interstellar → New Babbage). Se il nome è presente in più sistemi e
il sistema della missione è noto, si risolve in quel sistema. Se resta ambiguo
**non viene associato** e va in coda di normalizzazione.

I punti personali (DATABASE PUNTI) compaiono come tipo "personale", agganciati al
corpo più vicino entro 1,5 raggi. Le coordinate non vengono mai convertite.

## Algoritmi

- **Vista missioni** (catalogo / storica / utente): `ops[{role, slot, ids, size,
  unresolved, ambiguous, anonymous, scu, containerMax, fixed}]`, `offer[]`. Un
  ritiro senza luogo non eredita mai il luogo dell'offerta.
- **Pianificabilità**: un modello di catalogo è pianificabile solo con un ritiro e
  una consegna fissi; la quantità assunta è il massimo del modello (dichiarato).
- **Classificazione di uno stack**: INCOMPATIBILE (cassa > cassa massima della
  nave, grado insufficiente, contratto completato o fallito, nessuna sequenza valida con la stiva indicata; i movimenti più grandi della stiva vengono divisi in più viaggi con avviso);
  DA VERIFICARE (luoghi o quantità mancanti); ESEGUIBILE solo se tutti i contratti
  sono tuoi e accettati; altrimenti POTENZIALMENTE ACCUMULABILE.
- **Route overlap**: direzioni con coseno > 0,8 e deviazione entro il 10 %.
- **MINIMO VIAGGIO**: parte dalla combinazione più corta e accetta aggiunte con
  al massimo +15 % di distanza e +1 scalo.
- **Ottimizzazione percorso**: `routeContracts` di LOGISTICS (esatto ≤ 10
  operazioni, euristico oltre), `validateSequence`, `buildManifest`. Distanze
  solo dentro un sistema; le tratte interstellari sono "non note" ed escluse dai
  totali.
- **Discovery**: punteggio = Σ peso × fattore, con pesi novità 3, età
  dell'informazione 1,5, potenziale 3, destinazione 2, deviazione 2, fonti 1,5,
  costo 1. Livelli: mai verificato, parziale, numeroso, obsoleto, storico,
  conflitto. Ogni riga dice perché.

## Location Intelligence estesa (0.7.1)

Quando selezioni un luogo, NAVCOM interroga la gerarchia geografica reale (base → luna → pianeta →
sistema) e classifica ogni missione con un solo livello di evidenza:

| Livello | Quando | Etichetta mostrata |
|---|---|---|
| CERTO | il luogo è il punto fisso di ritiro o consegna (pool di 1) | luogo certo |
| POSSIBILE | il luogo è una delle alternative di un pool | POSSIBILE — IL GIOCO ASSEGNA IL LUOGO EFFETTIVO |
| REGIONALE | il pool o l'offerta nomina la luna, il pianeta (o il corpo stesso), non una base | ASSOCIAZIONE REGIONALE — BASE SPECIFICA NON CONFERMATA |
| SCONOSCIUTO | nome non risolto o punto anonimo | resta sconosciuto, mai associato |

- Un pool di un solo elemento che è un corpo celeste ("Vala") **non** è un punto fisso: diventa regionale e non è pianificabile.
- Sezioni con conteggi indipendenti: certe in uscita, certe in entrata, possibili in uscita, possibili in entrata, regionali da verificare, offerte nell'area, collegamenti interplanetari, collegamenti interstellari. Il riepilogo conta ogni missione una volta sola (precedenza certo > possibile > regionale).
- **ALTRE BASI NELLA REGIONE**: missioni di altre basi della stessa luna o dello stesso pianeta, raggruppate per base, mai contate come missioni del luogo selezionato.
- **Sistema intero**: i modelli associati solo alla stella del sistema sono contati a parte e mai estesi alle basi.
- **Modalità** "Solo certe" (VERIFICATE: certezze e contratti tuoi) e "Tutte, con etichetta" (MOSTRA ANCHE POSSIBILITÀ, predefinita dalla 0.7.2), salvata con lo stato dell'atlante solo se scelta esplicitamente. Dalla 0.7.2 la scheda apre con quattro riquadri di riepilogo (CERTE · POSSIBILI · REGIONALI · ALTRE BASI) e righe compatte con dettagli a richiesta.
- **Filtro di distanza** sulla gerarchia: stessa base, stessa luna, stesso pianeta o sua regione, tra pianeti, tra sistemi, tutte. Il collegamento esiste solo dentro lo stesso contratto.
- **VOGLIO ARRIVARE A** (località, luna, pianeta o sistema, discendenti inclusi e distinti): contratti certi, con alternative compatibili, regionali, tuoi; tratte intermedie documentate (due contratti distinti, dichiarati come sequenza). Se nulla collega: "NESSUN COLLEGAMENTO DOCUMENTATO NEI DATI DISPONIBILI", che non significa assenza nel gioco. Fra sistemi: gateway e jump point dai dati del motore NAVCOM, nessuna distanza sommata.
- **Mappa**: linee certe, possibili, regionali (viola tratteggiato, dal corpo celeste) e percorso NAVCOM. Le missioni con pool oltre 10 luoghi restano in elenco con "Missione individuata nel catalogo — collegamenti grafici omessi per numero elevato di alternative." e il pulsante "Disegna comunque".
- **Diagnostica** dalla scheda: modelli caricati, esatte, in pool, regionali, altre basi, scartate dai filtri, nascoste dalla modalità, non disegnate, nomi non risolti, patch diverse o ignote, collegamenti interplanetari e interstellari, motivi di uno zero.
- **Indici**: per luogo (ritiri, consegne, offerte, appartenenza ai pool), per sistema, gerarchia e discendenti memorizzati; il risultato di ogni luogo è memorizzato per filtri e modalità. Nessuna scansione dei modelli al passaggio del mouse; elenchi a pagine di 25.

### Collaudo con i dati reali (snapshot 4.10.2-LIVE.12881860, 8 novembre 2026)

Conteggi di missioni uniche; "UI" = filtri predefiniti della scheda (missioni illegali escluse).

| ArcCorp Mining Area 061 (Stanton → ArcCorp → Wala) | senza filtri | UI |
|---|---|---|
| Associazioni esatte (punto fisso) | 3 | 3 |
| Associazioni in pool di alternative | 118 | 118 |
| Pool che nominano Wala o ArcCorp | 0 | 0 |
| Offerte su Area 061, Wala o ArcCorp (regionali) | 228 | 228 |
| Associate solo a Stanton (non attribuite) | 235 | 235 |
| Altre basi della regione (non contate) | 292 | 292 |
| Collegamenti interplanetari | 110 (certe 0) | 73 (certe 0) |
| Collegamenti interstellari | 108 (certe 0) | 77 (certe 0) |
| Verso microTech | certe 0 · possibili 109 · regionali 54 · tratte intermedie 1 | certe 0 · possibili 72 · regionali 37 · tratte intermedie 1 |
| Escluse dai filtri | 0 | 63 |
| Nomi di luogo non risolti in queste missioni | 235 | 235 |
| Missioni in VERIFICATE | 3 | 3 |

Le 3 missioni certe di Area 061 sono storiche (SCHaulingPlanner): **nessun modello di catalogo ha Area 061 come punto fisso**, e nessun modello collega con certezza Area 061 a microTech. Gli zeri sono giustificati dai dati.

Località di controllo con missioni certe: **Ruin Station** (Pyro → Terminus), la più citata come punto fisso nel catalogo: 84 missioni esatte, 153 in pool, collegamenti interplanetari 196 (certe 9), interstellari 139 (certe 12). Area18: 10 esatte, 309 in pool.

## Schema del database (browser)

IndexedDB `navcom-logistics` **v2** (aggiornamento automatico da v1, nessun dato
cancellato):

| Store | Contenuto |
|---|---|
| `contracts` | contratti dell'utente (invariato da 0.6.0) |
| `observations` | visite e osservazioni (invariato) |
| `meta` | impostazioni; `atlasSnapshot` (copia offline dell'atlante), `atlasUi` (stato della vista) |
| `plans` (nuovo) | `{id, name, createdAt, updatedAt, capacity, ship, start, cls, held, contracts[], seq[], method, assumed, warnings, opsDone}` |
| `attachments` (nuovo) | `{id, contractId, name, type, dataUrl (solo data:image/…), at}` |

Il backup completo (versione 2) comprende piani e screenshot; il ripristino unisce
senza cancellare. Il DATABASE PUNTI (`navcom`) non viene toccato.

File pubblicati: `data/atlas/index.json` (riepilogo, patch, date),
`geo.json` (`{meta, places, connections}`), `missions.json` (`{meta, places[uuid],
names[], missions[], queue[]}`, con gli indici di luoghi e nomi), `ships.json`.

## Limiti noti

- I pool del catalogo sono quasi sempre grandi: per la maggior parte dei modelli
  il ritiro o la consegna reali li vedi solo nel MobiGlas.
- Le posizioni sono statiche nel frame del sistema: i pianeti nel gioco ruotano,
  quindi la lat/lon mostrata non è quella del gioco.
- Nyx senza raggi dei corpi: niente globo.
- Freight elevator, hangar e accesso nave: nessuna fonte pubblica verificata.
- I tempi di volo richiedono i parametri del quantum drive (collaudo in gioco).
- Lo screenshot resta solo nel browser; nessuna lettura automatica.

## Test

`web/tests/atlas.test.mjs`: 25 test su un mondo **sintetico** (stella SYN,
Pianeta e Luna Sintetici, basi fittizie, un sistema pyro fittizio), separato dai
dati reali. Coprono proiezione e zoom, selezione, basi, scheda, associazione ai
canonici, OFFERTA/RITIRO/CONSEGNA, coda di normalizzazione, stili delle rotte,
collegamenti non inventati, i sette tipi di stack, capacità, casse, gradi, best
stack, piano e riordino, manifest, osservazioni, duplicati, migrazione IndexedDB
v1→v2, backup, fallback 2D, prestazioni (5.000 luoghi, 3.000 missioni), cambio di
patch, Discovery, regressione dei moduli esistenti.

Dalla 0.7.1, 18 test in più (LI-1 … LI-18) su un secondo mondo sintetico (pianeta "Arco"
con luna "Vala", pianeta "Micro", sistema pyro): ritiro esatto, base fra 20 alternative,
missione della luna, altra base della stessa luna, tratta interplanetaria e interstellare,
destinazione dinamica, nessuna promozione da regionale a certa, nessun collegamento fra
contratti diversi, nessun duplicato nei riepiloghi, elenco anche senza linee, filtri,
stack executive ed exploratory, contratti dell'utente, regressione, offline, IndexedDB.

## Grafica WebGL (0.9.0)

`web/js/atlas/gl.js` disegna sotto il canvas 2D: cielo, stella, sfere dei corpi con raggio noto (illuminate dalla direzione della stella) e orbite circolari nel piano XY del sistema alla quota del corpo. Tutte le proiezioni sono calcolate in JS in doppia precisione e passate alla GPU in pixel, quindi le distanze di sistema non perdono precisione. Le superfici sono procedurali e illustrative (colori scelti a mano per i corpi di Stanton, variazioni dal nome per gli altri): **non** rappresentano il terreno reale. Nyx non ha raggi: i suoi corpi restano bagliori. Marker, etichette, selezione e linee restano nel canvas 2D (`render.js`). Interruttore "Grafica 3D", preferenza in `localStorage` (`navcom.atlas.gl`).
