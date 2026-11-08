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
- Pool di luoghi: **4.555**, di cui solo **133** con un luogo unico. Il resto sono pool di alternative: il gioco sceglie il punto quando genera la missione.
- Nomi non riconosciuti in coda di normalizzazione: **245**.
- Navi con stiva: **127**.

**Attenzione:** sono *modelli* dai file di gioco, non offerte. Nessun modello è
mai presentato come disponibile adesso.

## Identificativi e risoluzione dei nomi

Luogo canonico: `{id (uuid starmap), name, aliases, type, kind, system, parentId,
pos{x,y,z} m, frame, hidden, qtValid, radius, radiusSource, services, source,
patch, updatedAt, ext}`.

Ordine di risoluzione di un nome: esatto → senza spazi → suffisso unico
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
