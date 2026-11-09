# DESTINATION INTELLIGENCE (0.8.0)

Enciclopedia operativa delle destinazioni: scheda **📚 DESTINATION INTELLIGENCE**.
Ogni dato mostrato porta **fonte, data o versione, stato** (verificata / documentata /
segnalata / ipotetica / sconosciuta) e, se cambia spesso, l'etichetta **dinamico**.
Dove nessuna fonte collegata copre un campo la scheda scrive **NON DISPONIBILE** o
**DA VERIFICARE**: non c'è nessun valore di riempimento.

## Fonti

| Fonte | Cosa fornisce | Accesso | Licenza / condizioni | Limiti |
|---|---|---|---|---|
| **scunpacked-data** (estrazione dei file di gioco) | `starmap.json`: servizi elencati (hangar S–XL, landing pad XS–XL, docking, cargo elevator / loading dock, raffineria, clinica, ospedale, negozi), giurisdizione (nome, multa base, SCU rubate tollerate, prigione), tipo di respawn, descrizione. `resources/`: gruppi minerari per luogo. `ships.json`: carburante, quantum, stiva. | `git clone` sparso, nessuna chiave | Il repository non ha un file LICENSE: dati del gioco © CIG, uso personale | Statico, legato alla patch (4.10.2-LIVE). L'elenco dei servizi può essere incompleto: "non elencato" non è una prova di assenza. Nessun negozio né prezzo. |
| **UEX Corp API 2.0** | Luoghi (stazioni, città, avamposti, POI) con flag di servizi, armistizio, tipi di pad; terminali; prezzi di oggetti, merci e carburante | GET pubblici, nessun token, **solo da GitHub Actions** | Uso personale non commerciale, dati crowdsourced; limite 120 chiamate/min | Prezzi e scorte segnalati dagli utenti, con la loro data: possono essere vecchi o sbagliati. |
| **starmap.space API v4** | Ambiente dei corpi: temperature min/max, respirabilità, composizione, altezza atmosfera, biomi, oceani, abitabilità | GET pubblici, CORS aperto | "Be gentle", vietato scaricare le immagini in massa | Gravità = 1 g per tutti i corpi (valore predefinito: scartato). Nessuna pressione. L'endpoint dei POI (armistizio, no-fly, trespassing) risponde HTTP 500 a ogni richiesta: la pipeline riprova a ogni pubblicazione. |
| **CitizenHQ** | — | — | — | Aggrega UEX, scunpacked e Wiki (lo dichiara l'intestazione `X-Data-Source`): **non usato**, sarebbe un doppione. |
| **Star Citizen Wiki API** | — | — | — | Copia dei file di gioco già presi da scunpacked: **non usata**. |
| **DATABASE PUNTI personale** | I tuoi punti, note, stato, risorsa | Locale (IndexedDB) | Tuoi | Mai modificato dalla scheda: le annotazioni stanno a parte (`destNotes`). |

### Pipeline

`web/tools/fetch_destinations.mjs` gira nel workflow di pubblicazione (passo "Destination
Intelligence", `continue-on-error`) e scrive `web/data/destinations/{index,dest,market,ships}.json`.
- Nessuna chiave: il sito non chiama né UEX né starmap.space, legge solo lo snapshot.
- Ogni fonte che non risponde (429, 5xx, timeout) viene **sostituita dall'ultimo snapshot
  pubblicato**, e `meta.sources.<fonte>` lo dichiara (`ok: false`, errore, data riusata).
- Nel browser: AGGIORNA rilegge lo snapshot, con copia locale (`destSnapshot`) se la rete manca;
  IMPORTA/ESPORTA per file JSON.

## Matrice campo → fonte → disponibilità → affidabilità

Legenda disponibilità: ● per la maggior parte dei luoghi · ◐ parziale · ○ non alimentato.

### Ambiente

| Campo | Fonte | Disp. | Affidabilità / regola |
|---|---|---|---|
| Atmosfera presente | starmap.space (`AtmosphereHeight`, composizione) | ◐ 34 corpi | documentata |
| Respirabilità | starmap.space `AtmosphereBreathable` | ◐ | **mai dedotta dalla presenza di atmosfera**: se il campo manca resta vuoto |
| Temperatura min / max | starmap.space | ◐ | documentata; tipica: ○ |
| Composizione, biomi, oceani, abitabile | starmap.space | ◐ | documentata (inserita da utenti, con data) |
| Gravità | starmap.space | ○ | scartata: 1 g su tutti i corpi è un valore predefinito |
| Pressione, meteo, vento, tempeste | — | ○ | nessuna fonte pubblica |
| Casco / tuta / protezione termica | derivati **solo** da respirabilità e temperature documentate | ◐ | "documentata" se la fonte dice non respirabile; altrimenti DA VERIFICARE |
| Interno di stazioni e città | — | ○ | sempre DA VERIFICARE (si presume pressurizzato in gioco, ma nessuna fonte lo pubblica) |

Contesto: un luogo **in superficie** eredita l'ambiente del corpo; una **stazione in orbita** no
(le temperature del pianeta non valgono lì); un **punto XYZ** viene classificato rispetto al
corpo più vicino (superficie / orbita / spazio, con "?" se il raggio non è noto).

### Sicurezza

| Campo | Fonte | Disp. | Regola |
|---|---|---|---|
| Armistizio | UEX `is_armistice` (starmap.space POI quando torna) | ◐ | segnalata; **mai dedotto dal livello di sicurezza** |
| Armi FPS / armi della nave | solo se armistizio = sì | ◐ | ipotetica (regola di gioco generale, non dato del luogo) |
| Giurisdizione, multa base, merci rubate tollerate, prigione | scunpacked | ● | documentata; ereditata lungo la catena (luogo → luna → pianeta → sistema) e marcata "ereditata da X" |
| Affiliazione | scunpacked | ◐ | documentata |
| Merci illegali | UEX `commodities.is_illegal` | ● | segnalata, valida per il sistema |
| Livello di sicurezza, restrizioni di volo, difese, trespassing, fazioni ostili | — | ○ | NON DISPONIBILE. Nessun pericolo documentato ≠ luogo sicuro. |

### Hangar e servizi (mai ereditati da un luogo vicino o dal genitore)

| Campo | Fonte | Disp. |
|---|---|---|
| Hangar (taglia) | scunpacked | ● |
| Landing pad (taglie) | scunpacked + UEX `pad_types` | ● |
| Docking port | scunpacked | ◐ |
| Cargo elevator / loading dock, cargo center | scunpacked + UEX terminali merci | ◐ |
| Autoloading, casse max | UEX terminali (`is_auto_load`, `max_container_size`) | ◐ |
| Rifornimento H2 / QT con prezzo | UEX `fuel_prices_all` | ◐ dinamico |
| Riparazione | UEX `has_repair` | ◐ |
| Raffineria, clinica, ospedale, respawn | scunpacked + UEX | ◐ |
| Abitazioni | UEX `has_habitation` | ◐ |
| Vehicle pad, ASOP, ATC, riarmo, deposito | — | ○ DA VERIFICARE |

### Negozi, commercio, mining, spedizione

| Campo | Fonte | Disp. | Note |
|---|---|---|---|
| Negozi, articoli, prezzo acquisto/vendita | UEX `items_prices_all` (24.141 righe) | ◐ | segnalata, con data di ogni prezzo; mai presentato come "in tempo reale" |
| Scorte degli articoli | — | ○ | UEX non le pubblica per gli oggetti |
| Merci: prezzi, domanda/offerta in SCU, stato | UEX `commodities_prices_all` | ◐ | domanda 0 = "domanda non segnalata", non "nessuna domanda" |
| Materiali per luogo e tipo (nave / veicolo / FPS / raccolta) | scunpacked `resources/` | ◐ 222 luoghi | è un'**area di spawn**, non un giacimento confermato |
| Raffinerie vicine | scunpacked + UEX | ◐ | distanze reali solo dentro lo stesso sistema |
| Requisiti nave (stiva, carburante, quantum) | scunpacked `ships.json` (280 navi) | ● | documentata |

## Architettura

- **Un solo database dei punti**: la scheda legge il DATABASE PUNTI (id `pt:<id>`) e il
  database geografico dell'ATLANTE (id canonici del gioco). Non copia né riscrive i punti.
- **Entità separate e relazioni**: luogo di gioco (id UUID), luogo UEX (`kind:id`), terminale UEX,
  corpo starmap.space, punto personale. I collegamenti UEX → luogo di gioco avvengono per nome
  esatto nello stesso sistema; i nomi parziali o ambigui diventano **candidati** da confermare
  (pulsante "Conferma collegamento", salvato in `destLinks`, annullabile dal pannello FONTI).
- **Punto XYZ personale**: mostra le strutture vicine con la distanza reale e non attribuisce
  loro alcun servizio.
- **Integrazione**: DATABASE PUNTI / ATLANTE → scheda → CALCOLA ROTTA; PIANIFICATORE →
  INFORMAZIONI DESTINAZIONE; negozio / vendita → RAGGIUNGI DESTINAZIONE. Gli algoritmi di
  navigazione non sono stati toccati.

## Collaudo

**Correttezza del software** (test automatici sintetici, `web/tests/dest.test.mjs`, DI-1…DI-16):
pianeta, stazione orbitale, avamposto commerciale, località di Pyro, XYZ casuale, punto
personale senza XYZ, omonimi, collegamenti ambigui, ricerca con abbreviazioni, articoli, vendita,
mining, preparazione, dati mancanti, nessun segreto nel codice, nessuna scrittura nel DB punti.

**Accuratezza dei dati** (snapshot reale del 2026-11-09, patch 4.10.2): va verificata in gioco.

| Caso | Cosa mostra la scheda |
|---|---|
| Daymar (pianeta/luna) | non respirabile (documentata), 3 / 151 °C, gravità DA VERIFICARE, giurisdizione ereditata |
| Port Tressler (stazione) | armistizio sì (UEX), hangar L, pad, prezzi carburante, ~535 articoli in vendita, ~44 righe merci; ambiente esterno non applicato |
| Shubin Mining Facility SCD-1 (avamposto) | solo i servizi propri dell'avamposto; materiali della zona come area di spawn |
| Ruin Station (Pyro) | giurisdizione Rough & Ready, multa base 0, merci illegali del sistema |
| XYZ casuale nello spazio | contesto "spazio", nessun ambiente di superficie, luoghi vicini con distanza reale |
| Punto personale senza XYZ | eredita il corpo indicato (descrizione), nessuna distanza, CALCOLA ROTTA disabilitato |

## Lacune note

- Pressione, meteo, gravità, livello di sicurezza, ATC, ASOP, riarmo, vehicle pad, deposito,
  ambiente interno: nessuna fonte pubblica affidabile.
- Armistizio, no-fly e trespassing dipendono da UEX finché l'endpoint POI di starmap.space è giù.
- Delamar non ha corrispondenza tra starmap.space e i file di gioco.
- UEX: 407 luoghi, 353 collegati a un luogo di gioco, 8 con candidato da confermare (nome
  parziale, es. "Deakins Research", "Yela Ring"); 767 terminali, 6 non collegati. I gateway
  ("Pyro Gateway (Stanton)") si collegano dopo aver tolto il sistema tra parentesi.
