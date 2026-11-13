# PLANCIA (Command Dashboard), mappe a livelli e ricerca universale (1.0.0-web)

La PLANCIA è la nuova home di NAVCOM. Riusa i moduli esistenti: non c'è un secondo database di punti, un pianificatore alternativo o un'altra copia dei dati.

> **Dalla 2.0.0 la PLANCIA è diventata il COMMAND BRIDGE**: striscia compatta in alto, mappa centrale col motore dell'ATLANTE (al posto della mini mappa piana), pannello contestuale a destra e barre MISSIONI / CARGO / ATTIVITÀ in basso. Posizione, nave, destinazione, rotta attiva e stato salvato restano quelli descritti qui sotto, con le stesse chiavi. Dettagli del nuovo layout e del Mission Database: [MISSIONS.md](MISSIONS.md). Dalla 2.1.0 il pulsante **📟 MISSIONI DA QUESTA LOCALITÀ** apre il [MISSION CONTROL](MISSION_CONTROL.md) sulla posizione salvata qui (chiave `homePosition`, che ora può contenere anche il luogo scelto).

## Cosa mostra e da dove viene

| Riquadro | Dato | Origine | Cosa NON fa |
|---|---|---|---|
| Barra principale | versione, sistema, nave, posizione, destinazione, ora locale | stato della plancia + orologio del PC | nessun indicatore "online" o di telemetria |
| Barra principale · Fonti dati | data e versione di posizioni QT, mappe, destinazioni | metadati degli archivi già caricati | non dice "aggiornato" se non lo è: mostra la data |
| Posizione attuale | sistema, XYZ, corpo più vicino, marker QT più vicino, ultima lettura, origine | testo di `/showlocation` incollato da te, tre numeri inseriti da te | non si aggiorna da sola; il sistema non è nel testo di `/showlocation` e va scelto |
| Mini mappa | pianeti, posizione, destinazione, ultima rotta | posizioni reali (scunpacked) proiettate sul piano XY | quota Z non rappresentata, dichiarata sotto la mappa |
| Nave | produttore, ruolo, cargo, serbatoi, autonomia e velocità QT, componenti di serie, dimensioni | `ships.json` dai file di gioco (scunpacked) | niente carburante attuale, scudi o danni |
| Rotta attiva | destinazione, distanza in linea retta, percorso QT, salti, uscite, residuo, tempo, stato di verifica | riepilogo inviato dal PIANIFICATORE dopo ogni calcolo | non ricalcola; tra sistemi diversi non mostra una distanza |
| Accesso rapido | città, stazioni, avamposti, negozi, ospedali, raffinerie, mining, preferiti | DESTINATION INTELLIGENCE (`listBy`) | elenca solo luoghi con il dato documentato |
| Attività recente | destinazioni consultate, rotte salvate, punti modificati, preferiti, visite | stato della plancia, rotte salvate, DATABASE PUNTI | le visite si registrano solo quando le confermi tu |

Pulsanti: **APRI PIANIFICATORE** porta la destinazione al pianificatore, con la posizione attuale come partenza se il sistema è lo stesso. **INFORMAZIONI DESTINAZIONE** apre la scheda DI. **VISUALIZZA MAPPA** seleziona il luogo nell'ATLANTE.

`INCOLLA /SHOWLOCATION` legge gli appunti solo dopo il clic e solo se il browser lo permette. Se il permesso manca, apre il campo di testo per incollare con Ctrl+V.

## Ricerca universale

Una casella cerca tutto: località (anche alias e abbreviazioni come NB, A18, ARC-L1), punti personali (anche senza XYZ), servizi ("ospedale", "raffineria", "negozi", "mining", "avamposti"…), negozi e terminali UEX, articoli, merci e minerali. Ogni risultato ha un'etichetta con il tipo.

Su dati reali (snapshot del 2026-11-12):
- "New Babbage" trova la città.
- "ARC-L1" trova ARC-L1 Wide Forest Station.
- "Helix" trova articoli e negozi.
- "ospedale" dà 59 luoghi con clinica od ospedale documentati.
- "Quantainium" trova la merce e le aree di spawn.

Una ricerca richiede 10–30 ms.

## Livelli delle mappe

1. **Sistemi.** ATLANTE: Stanton, Pyro, Nyx con posizioni reali.
2. **Corpo celeste.** ATLANTE e scheda DI del corpo.
3. **Città, stazione o avamposto.** Scheda DI, più la nuova sezione **3b · Struttura e negozi (vista schematica)**:
   - luoghi figli dalla starmap del gioco;
   - terminali UEX raggruppati per area, presa dal nome del terminale (es. "Kel-To - Aspire Grand - New Babbage" → area *Aspire Grand*).
4. **Mappa interna: non disponibile.** Nessuna fonte pubblica con licenza di riuso fornisce planimetrie di città o stazioni. La vista è dichiarata **SCHEMATICA**: l'ordine non è la disposizione reale, e piani, fermate della metropolitana e percorsi non sono documentati. Il pianificatore QT non si usa all'interno delle località.
5. **Negozio.** Scheda con area dichiarata (dal nome), **POSIZIONE INTERNA NON DOCUMENTATA**, piano non documentato, articoli e merci con data e versione. **MOSTRA SULLA MAPPA** porta al luogo che contiene il negozio, non a un punto inventato.

Le coordinate XYZ non vengono mai convertite in latitudine e longitudine, né il contrario.

## Dati personali

Lo stato della plancia sta nelle chiavi `meta` dello stesso archivio IndexedDB del DATABASE PUNTI. Non c'è nessuna modifica di schema e nessuna migrazione.

| Chiave | Contenuto |
|---|---|
| `homeState` | posizione, nave, note nave, destinazione, ultima rotta |
| `destRecent` | destinazioni consultate |
| `destFavorites` | preferiti |
| `destVisits` | visite confermate |

I punti non vengono mai toccati; il test HM-10 lo verifica con 3.355 punti. Le chiavi esistenti (`destNotes`, `destLinks`, `destSnapshot`, `atlasUi`) restano invariate.

Backup: **Esporta stato plancia (JSON)** nella PLANCIA. I punti continuano a esportarsi dal DATABASE PUNTI. Non esiste un file pubblico con dati personali.

## Valutazione delle fonti

| Fonte | Uso | Licenza / condizioni | Accesso dal browser | Decisione |
|---|---|---|---|---|
| scunpacked-data (file di gioco) | posizioni, servizi, navi, mining | nessuna LICENSE nel repository; dati estratti dal gioco | file statici scaricati in GitHub Actions | usata, con fonte e patch |
| UEX Corp API 2.0 | terminali, prezzi, aree nei nomi | uso personale non commerciale, dati crowdsourced | GET senza token, scaricati in Actions (nessuna chiave nel sito) | usata come "segnalata", sempre con data |
| starmap.space | ambiente dei corpi | pubblica; la gravità vale 1 g ovunque (scartata); l'endpoint dei POI risponde HTTP 500 | Actions | usata in parte |
| CitizenHQ | — | aggrega UEX, scunpacked e Wiki | — | non usata: duplicherebbe le fonti originali |
| Star Citizen Wiki API | — | copia dei dati scunpacked | — | non usata per lo stesso motivo |
| Mappe della community (planimetrie di città e stazioni, immagini su siti di fan) | — | nessun permesso di riuso dichiarato | — | **non usate**: niente scraping, niente mappe interne inventate |

## Test

`web/tests/home.test.mjs` (HM-1…10) e `web/tests/dest.test.mjs` (DI-20…25), con dati sintetici:

| Test della specifica | Copertura |
|---|---|
| 1 · plancia senza posizione | HM-1 |
| 2 · `/showlocation` | HM-2 |
| 3 · ricerca universale | DI-21 |
| 4 · mappe | DI-23 (struttura schematica) e HM-9 (scala reale) |
| 5 · navigazione | HM-4 e HM-5 (distanza, riepilogo senza ricalcolo); verifica in browser con rotta reale |
| 6 · commercio | DI-24 (scheda negozio) e DI-22 (elenchi) |
| 7 · DB personale preservato | HM-10 |
| 8 · dati mancanti | DI-21 (senza prezzi nessun gruppo inventato), HM-8 (campi nave null), DI-24 (piano e posizione null) |
| 9 · prestazioni | DI-25: universale con 3.355 punti sotto 300 ms |
| 10 · regressione | intera suite (190 test) e giro in browser di ATLANTE, DI e PIANIFICATORE |

## Lacune note

- Planimetrie interne, piani, fermate e trasporti interni: nessuna fonte con licenza.
- Area del negozio presente solo quando UEX la mette nel nome del terminale.
- Posizione: solo manuale. Nel testo di `/showlocation` manca il sistema.
- Mini mappa: proiezione XY, senza quota.
