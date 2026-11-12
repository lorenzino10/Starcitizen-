# MISSION DATABASE 2.0 e COMMAND BRIDGE (2.0.0)

Questo documento descrive il catalogo delle missioni, da dove vengono i dati, come si aggiorna e cosa non sa. Copre anche la nuova home **COMMAND BRIDGE**.
Numeri verificati il 2026-11-12 su LIVE 4.10.2-LIVE.12881860.

## B1. Analisi del sistema precedente (fino a 1.0.0)

| Aspetto | Prima (atlante 0.7–1.0) | Ora (2.0) |
|---|---|---|
| Copertura | 1.520 modelli, solo trasporto | 4.197 modelli rilasciati, tutte le categorie (l'atlante usa ancora il sottoinsieme di trasporto, 1.520) |
| Versione LIVE | patch dedotta dal commit di scunpacked | `/game-versions/default` della Wiki, confrontata con scunpacked |
| Varianti | nessun raggruppamento | gruppi della Wiki (1.505 modelli base); senza Wiki un criterio euristico dichiarato (1.489 gruppi, 1.333 identici a quelli della Wiki) |
| Missioni interstellari | 51, di cui 32 con un solo sistema (sbagliato) | 79 nel sottoinsieme dell'atlante (103 in tutto il catalogo), solo 2 con un solo sistema (pool davvero vuoti) |
| Ricompensa | numero o nulla | `fissa` 1.845 · `dinamica` 2.067 · `intervallo` 13 · `n.d.` 272 |
| Aggiornamento | sovrascrittura | file versionato, validazione, diff, storico, fallback dichiarato |
| Fonte mostrata | data dello snapshot | versione, build, fonte, data e numero di record, sempre visibili |

**Lacune che restano**:
- 295 modelli dell'atlante non hanno un luogo di ritiro e 222 non hanno un luogo di consegna. Sono pool planetari o stellari vuoti nei file e privi di token.
- Altri 172 hanno pool che non si risolvono su luoghi noti.

Queste lacune non sono state riempite: la scheda della missione le mostra come tali.

Categorie del catalogo completo:

| Categoria | Modelli |
|---|---|
| combat | 1.630 |
| hauling | 1.076 |
| delivery | 444 |
| investigation | 233 |
| priority | 207 |
| mining | 158 |
| service | 138 |
| salvage | 129 |
| wikelo | 69 |
| other | 66 |
| collection | 25 |
| racing | 22 |

## B2. Fonti valutate

| Fonte | Esito | Uso |
|---|---|---|
| **Star Citizen Wiki API** (`api.star-citizen.wiki/api`) | Verificata con richieste reali da GitHub Actions: `/game-versions/default`, `/game-versions`, `/missions?filter[grouped]=true\|false&page[size]=100&page[number]=N`. Codice MIT. | **Primaria**: versione LIVE, gruppi di varianti, flag NFR/WIP, descrizioni |
| **scunpacked-data** (GitHub) | `contracts/*.json`, `starmap_positions.json`, `ships.json`. Nessun file LICENSE. | **Secondaria**: pool di luoghi, ruoli, casse, requisiti, ricompense |
| versefiles | Solo pagine HTML. `/api` risponde 404 e non c'è una licenza. | Solo un link: niente scraping |
| verse-base | 403, protetto da Cloudflare | Non usata |
| sc-toolbox | `robots.txt` vieta `/api`, che comunque risponde 404 | Solo un link |

Non uso nessuna API privata e nessuna chiave. Tutto viene scaricato in GitHub Actions; il browser legge solo JSON statici.

## Confronto dei conteggi con le fonti

| Dato | scunpacked | Wiki | Spiegazione |
|---|---|---|---|
| Record totali | 5.153 | 5.153 righe | L'elenco paginato della Wiki **ripete 231 righe**: gli UUID distinti sono 4.922. Le righe ripetute si tengono una volta sola e vengono contate. La pipeline non fallisce, perché il totale dichiarato coincide con le righe ricevute. |
| UUID scunpacked assenti dall'elenco piatto | — | 231 | Di questi, 181 sono rilasciati (Hauling - Planetary 69, Hauling 41, Delivery 15, …), gli altri NFR. Ricevono comunque il gruppo dall'elenco raggruppato; se mancassero anche lì, avrebbero la chiave euristica, dichiarata sulla scheda. |
| Not For Release | 955 | 966 | La Wiki marca 11 modelli in più: per l'esclusione vale il flag dei file. |
| Work In Progress | 21 (1 dopo NFR) | 25 | Come sopra. |
| Rilasciati | **4.197** | 4.185 | Differenza dovuta ai flag diversi e ai 231 UUID assenti. |
| Gruppi | — | 1.819 (1.505 con almeno un modello rilasciato) | I gruppi fatti solo di modelli NFR non contano. |
| Con carico | withCargo 1.778 | has_hauling 1.776 | 122 dei nostri modelli con carico non compaiono nell'elenco piatto della Wiki. |
| Sottoinsieme dell'atlante | 1.520 | — | Solo trasporto, con pool di ritiro o consegna. |

## B3. Pipeline (GitHub Actions)

`.github/workflows/pages.yml` gira ogni giorno alle 05:17 UTC e anche a mano. Esegue `web/tools/fetch_atlas.mjs`:

1. **Versione LIVE** da `/game-versions/default`. Se il codice non è riconoscibile, la Wiki è considerata non disponibile: nessuna versione inventata.
2. **Catalogo**: l'elenco piatto e l'elenco raggruppato della Wiki, pagina per pagina, verificando il totale dichiarato. Poi i contratti scunpacked.
3. **Normalizzazione**:
   - UUID come identificativo;
   - gruppo di varianti;
   - luoghi sugli ID canonici dell'atlante;
   - nomi non riconosciuti in una coda di normalizzazione.
4. **Confronto** con il catalogo pubblicato: aggiunti, rimossi, cambiati, e controllo che la versione non torni indietro.
5. **JSON versionato**: `data/missions/catalog-<versione>.json` più `index.json` con diff e storico.
6. **Validazione** (`validateCatalog`): minimo di record, campi obbligatori, versione non più vecchia, calo brusco.
7. **Pubblicazione** solo se valido. Altrimenti si ripubblica lo snapshot precedente con `validation.ok=false` e `fallback {at, reason, note}`. Senza snapshot precedente non si pubblica niente.

Se la Wiki non risponde, il catalogo si costruisce lo stesso da scunpacked. In quel caso:
- `sources.wiki.ok=false`;
- la versione LIVE non è verificata;
- le varianti sono raggruppate in modo euristico;
- l'interfaccia lo dice.

Se non risponde nemmeno scunpacked, si riusa lo snapshot pubblicato, segnato come SNAPSHOT PRECEDENTE.

Nel browser (`js/missions/load.js`), se il sito non risponde si usa l'ultima copia salvata in IndexedDB, segnata come COPIA LOCALE. La riga di provenienza è sempre visibile: versione, build, fonte, data e numero di modelli.

## B4. Classi di disponibilità

| Classe | Significato |
|---|---|
| CATALOGATA | Il modello esiste nei file del gioco |
| POTENZIALMENTE DISPONIBILE | Compatibile con il filtro (luogo, nave, requisiti noti); non è un'offerta |
| OSSERVATA NEL MOBIGLAS | L'hai registrata tu dal MobiGlas |
| OSSERVAZIONE STORICA | Una tua registrazione di una patch precedente |
| ACCETTATA / COMPLETATA / FALLITA | Stato che imposti tu |

**DISPONIBILE ORA non esiste**: nessuna fonte pubblica dice cosa offre il MobiGlas in questo momento.

## B5. Modello dei dati

Ogni modello ha questi campi:
- identità: `id`, `uuid`, `group`, `groupHow` (wiki / euristica), `variants`;
- descrizione: `title`, `type`, `category`, `company`, `description`;
- requisiti: `rank`, `prereq`;
- ricompensa: `reward` e `rewardInfo{kind, …}`, `scope`;
- geografia: `systems`, `interstellar`, `transit`, `route`;
- luoghi: `offer` (dove compare l'offerta), `pools` (ritiro e consegna con `ids`, `alt`, `unresolved`, `size`);
- carico: `orders`, `maxBox`;
- condizioni: `timeLimit`, `duration`, `risk`, `illegal`, `shareable`, `onceOnly`, `patch`.

I ruoli **OFFERTA, RITIRO, CONSEGNA e TRANSITO** restano distinti: il luogo dell'offerta non è il luogo di ritiro. Un pool resta un pool: il punto reale si conferma nel MobiGlas.

## B6–B9. Ricerca, stacking, registrazione, azioni

- **Ricerca missioni** (barra MISSIONI del Command Bridge):
  - Filtri: DA, VERSO, TIPO, RICOMPENSA MINIMA, NAVE, CARICO MASSIMO, RISCHIO.
  - Le tratte certe (luoghi fissi) sono separate da quelle variabili (pool).
  - Le missioni interstellari sono incluse: la distanza passa dai gateway della rete dei salti (`jumpLinks`, `jumpLeg`). Il tempo nel tunnel non è nei dati, quindi resta null.
- **Stacking** (barra CARGO):
  - Mette insieme ritiri e consegne condivisi, verifica capienza e casse, gestisce più viaggi e somma la ricompensa.
  - I contratti accettati sono separati da quelli ipotetici.
  - Itinerario proposto.
  - NON ESEGUIBILE se manca un dato.
- **Registrazione dal MobiGlas**:
  - Dalla scheda di un modello si apre un modulo precompilato, con screenshot facoltativo, salvato nell'archivio logistico esistente.
  - Avvisa se il luogo è fuori dal pool, se la cassa supera quella del modello o se la ricompensa è diversa da quella fissa.
  - Niente OCR per ora; in futuro, solo con conferma.
- **Azioni sulla missione**: origine e destinazione, evidenza sulla mappa, aggiunta al piano cargo, CALCOLA ROTTA, confronto, guadagno potenziale.
- **Atlante**: la scheda della stazione mostra in più le missioni compatibili con quelle selezionate.

## Command Bridge

- **Striscia in alto**: nave (dettagli in una scheda espandibile), sistema, posizione, destinazione, stato della rotta, versione dei dati.
- **Mappa centrale**: usa il motore dell'ATLANTE. Mostra corpi, stazioni, posizione, destinazione, tratta QT del pianificatore e missioni selezionate.
- **Stili delle linee**:
  - rotta NAVCOM: geometria reale;
  - linea retta possibile;
  - collegamento regionale o interstellare: schematico;
  - missione: confermata, ipotetica o non verificata.
- **Pannello di destra**:
  - destinazione, prossimo salto, distanza, interruzione QT, condizioni note, avvisi;
  - pulsanti CALCOLA ROTTA, APRI DESTINAZIONE, PREPARA SPEDIZIONE;
  - senza destinazione: ricerca e suggerimenti basati solo sui dati.
- **Barre in basso**: MISSIONI, CARGO, ATTIVITÀ.
- **Navigazione**: le 12 schede restano tutte, raggruppate in OPERAZIONI, NAVIGAZIONE e ARCHIVI.
- **Senza posizione** funziona lo stesso. Nessuna telemetria.

## Limiti noti

- Nessuna fonte pubblica dice quali missioni sono offerte adesso: il catalogo dice solo cosa *può* comparire.
- Le ricompense dinamiche (2.067) non hanno un importo nei file: vengono mostrate come «dinamica», senza stime.
- I pool planetari o stellari vuoti (295 senza ritiro e 222 senza consegna nell'atlante) restano senza luogo.
- Il tempo nel tunnel di salto non è nei dati.
- La Wiki e i file differiscono di poche decine di flag NFR/WIP: per l'esclusione valgono i file.
- La pagina pesa di più: il catalogo completo è 7,5 MB, scaricato una volta e poi tenuto in copia locale.
