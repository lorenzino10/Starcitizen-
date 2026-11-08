# NAVCOM LOGISTICS INTELLIGENCE (web 0.6.0)

Pianificazione del trasporto merci per un pilota solitario. È un motore decisionale costruito sui
**tuoi** contratti e sulle **tue** osservazioni. I cataloghi esterni servono a sapere dove guardare,
non a sapere cosa c'è davvero in bacheca. Regola guida: meglio "dato insufficiente" che una missione,
una rotta o un guadagno inventati.

Scheda **📦 LOGISTICS**, quattro viste:

| Vista | A cosa serve |
|---|---|
| 📡 FREIGHT RADAR | dove cercare carichi compatibili lungo un percorso; tre alternative; "Dove conviene cercare?" dal tuo storico |
| 📋 MISSION BOARD | i tuoi contratti (inserimento, import JSON/CSV, stati) e il catalogo dei modelli di missione |
| 📦 CARGO MANIFEST | scali, casse da caricare e scaricare, stiva dopo ogni operazione, grafico di occupazione |
| 🛰 FLIGHT DISPATCH | itinerario ottimizzato e ricalcolo durante il viaggio |

## 1. Stati (mai promossi automaticamente)

| Livello | Dove sta | Come ci si arriva |
|---|---|---|
| CATALOGO 🟠 | catalogo (sola lettura) | importato dalle fonti; **non** è un'offerta disponibile |
| OSSERVATA 🔵 | contratto | "Missione trovata" o "Ho visto questa offerta", sempre con luogo e momento |
| CONFERMATA 🟢 | contratto | la verifichi ora nel MobiGlas |
| ACCETTATA 🟢 | contratto | l'hai accettata: diventa obbligatoria nel piano |
| IN ESECUZIONE | contratto | dopo il primo ritiro o la prima consegna |
| COMPLETATA / FALLITA / NON DISPONIBILE 🔴 | contratto | azione esplicita, oppure consegna di tutto il carico |

- Il piano usa come obbligatori solo i contratti ACCETTATI o IN ESECUZIONE. I CONFERMATI possono essere proposti con l'etichetta "DA ACCETTARE". OSSERVATI e catalogo non entrano mai nel piano.
- Da un modello di catalogo si crea una missione osservata solo indicando il luogo e il momento in cui l'hai vista. Ricompensa e quantità **non** vengono copiate dal catalogo, e i ritiri assegnati dinamicamente restano vuoti ("non noto").
- Un contratto accettato non può diventare "non disponibile". Se lo perdi, usa "Missione fallita".

## 2. Contratti e movimenti
Un contratto è formato da **movimenti**. Ogni movimento è una quantità di SCU, di una merce, da **un** punto di ritiro a **un** punto di consegna, con eventuale cassa massima e con le quantità già caricate e consegnate. Una missione con più ritiri o più consegne ha più movimenti; non viene mai ridotta a un singolo A→B.

Gli altri campi del contratto sono:
- ID dell'offerta, titolo, compagnia, grado, ricompensa;
- sistema e luogo dove hai visto l'offerta;
- scadenza, patch, data di osservazione, fonte, rischio (un numero scelto da te), note e cronologia degli stati.

**Import**: JSON (array di contratti, oppure `{contracts:[...]}`) e CSV. Nel CSV c'è una riga per movimento, e le righe con lo stesso `contract_id` formano un unico contratto. Le colonne sono quelle dell'esportazione CSV di NAVCOM: `contract_id, offer_id, title, company, rank, reward, system, offer_zone, status, deadline, patch, observed_at, source, movement_id, cargo, scu, container_max, pickup, pickup_system, delivery, delivery_system, loaded, delivered, notes`.

## 3. Motore di ottimizzazione (pickup-and-delivery)
- Le operazioni sono il ritiro e la consegna di ogni movimento. La merce già in stiva produce solo la consegna.
- **Vincoli**, controllati da una verifica indipendente (`validateSequence`) su ogni piano:
  - nessuna consegna prima del suo ritiro;
  - la capacità operativa non viene mai superata in nessun segmento;
  - le quantità si contano per contratto e per movimento;
  - si rispetta il numero massimo di scali.
- **Metodo esatto** (ricerca completa con potatura) fino a 10 operazioni. Oltre si usa un **euristico deterministico**: inserimento a costo minimo e reinserimento iterato. Con lo stesso input dà sempre lo stesso risultato.
- Un movimento più grande della capacità si divide in più viaggi (240 + 60 SCU). È un'ipotesi da verificare in gioco: non sappiamo se le casse si possano dividere così.
- **Contratti confermati**: fino a 6 si provano tutte le combinazioni; oltre, si aggiungono uno alla volta (selezione euristica, dichiarata nel piano). Vengono esclusi, con il motivo, quelli con:
  - grado insufficiente o non indicato;
  - casse più grandi della cassa massima della nave;
  - ritiro o consegna non noti.
- **Priorità**:
  - *profitto*: ricompense meno costi configurabili (aUEC per Gm, per scalo, per punto di rischio);
  - *profitto per ora*: solo se sono noti i tempi di volo (drive QT in DATI E IMPOSTAZIONI) e quelli di movimentazione (secondi per SCU e per scalo); altrimenti è "n.d." e si ordina per profitto;
  - *pochi scali*;
  - *rischio*: somma dei rischi più le tratte interstellari;
  - *utilizzo della stiva*: SCU·distanza su capacità·distanza.
- **Distanze**:
  - in linea retta fra le posizioni CitizenHQ dello stesso sistema. È un minimo teorico: un ostacolo può richiedere un salto in più;
  - un luogo senza posizione nota o una tratta interstellare lasciano la distanza **non nota**; il piano lo dichiara e la penalizza;
  - il tempo di volo è calcolato con il modello del drive QT di NAVCOM, solo se ne inserisci i parametri;
  - le scadenze senza tempi di viaggio non sono verificabili, e il piano lo dice.

## 4. Manifesto di carico
Per ogni scalo il manifesto riporta:
- le operazioni ⬆/⬇, con contratto, merce, SCU e casse;
- la stiva dopo ogni operazione e la capacità residua;
- le ricompense maturate e quelle ancora da ottenere;
- gli avvisi sulle casse.

Il grafico mostra la stiva lungo il viaggio, con la linea della capacità.

La compatibilità fisica **non** è dichiarata: la somma degli SCU entra nella capacità, ma l'incastro delle casse dipende dalle loro dimensioni e dall'ordine di carico. NAVCOM controlla solo la cassa massima accettata dalla griglia.

**Nave predefinita**: RSI Constellation Mk V Centaurus. Dati dalla Star Citizen Wiki API (4.10.2-LIVE.12881860, letti il 2026-11-08):
- 240 SCU;
- una griglia aperta di 7,5 × 5 × 12,5 m;
- casse da 1 a 32 SCU.

La capienza operativa si può impostare più bassa di quella nominale.

## 5. Dispatch durante il viaggio
Le azioni disponibili sono: Missione trovata, Missione non disponibile, Missione accettata, Carico ritirato, Consegna parziale, Consegna completata, Missione fallita, Sono arrivato qui, Salta questa stazione, Ricalcola.

Il ricalcolo riparte sempre dai contratti salvati: quelli accettati, la merce in stiva e le consegne dovute non si perdono.
- **Salta questa stazione** esclude i contratti confermati che hanno operazioni lì. Se in quella stazione ci sono operazioni obbligatorie, lo segnala e le mantiene.
- **Missione non disponibile** propone stazioni alternative dal tuo storico. Sono **previsioni**, non contratti.
- **Missione fallita** lascia registrata la merce a bordo, con un avviso: sei tu a verificare in gioco se le casse ci sono ancora.

## 6. Intelligence (osservazioni)
Ogni offerta inserita registra un'osservazione:
- luogo, data e ora, patch;
- compagnia e grado;
- ritiro e consegna, SCU, ricompensa;
- esito: presente, assente, accettata, completata.

"Registra visita alla bacheca" registra anche le visite **senza** offerte. Quando la stessa offerta viene rivista (stesso ID, o stesso contenuto), le variazioni di ricompensa, SCU, luoghi e patch vengono annotate.

**Dove conviene cercare?** ordina i luoghi in base a quante visite della patch attuale hanno mostrato offerte. Per ciascun luogo mostra:
- il numero di visite e di offerte;
- la mediana di aUEC/SCU, con il numero di casi (n);
- il campione: *insufficiente* sotto 3 visite, *piccolo* sotto 10, *discreto* da 10 in su.

Nessuna percentuale e nessuna probabilità. I dati delle patch precedenti restano visibili come storico, marcati "obsoleto". Una patch è attuale se major.minor coincidono; senza patch il dato è "non verificabile".

Sono disponibili anche analisi per luogo, compagnia, rotta e patch.

## 7. Freight Radar
**Input**:
- partenza e destinazione, oppure un itinerario aperto;
- nave, capienza e cassa massima;
- gradi presso le compagnie;
- scali massimi;
- sistemi;
- priorità;
- patch attuale.

**Per ogni luogo** il radar mostra:
- le opportunità compatibili, cioè con grado, stiva e casse adatti;
- la deviazione rispetto al volo diretto (in linea retta, se le posizioni sono note);
- quante consegne vanno verso la destinazione;
- la ricompensa massima nota;
- fonti e patch;
- l'elenco di cosa verificare in gioco.

**Livelli di evidenza**, dal più forte al più debole:
1. osservata da te nella patch attuale;
2. osservata in una patch precedente;
3. modello Wiki della patch attuale;
4. catalogo storico.

**Tre alternative**:
- **conservativa**: solo luoghi con offerte che hai osservato nella patch attuale, deviazione minima;
- **equilibrata**: anche il catalogo della patch attuale, solo posizioni note;
- **esplorativa**: anche il catalogo storico e i luoghi senza posizione nota.

## 8. Fonti (verificate il 2026-11-08)

| Fonte | Accesso | Contenuto | Versione | Licenza | Limiti |
|---|---|---|---|---|---|
| Star Citizen Wiki API, `api.star-citizen.wiki/api/missions` | GitHub Actions a ogni pubblicazione e ogni giorno; dal container di sviluppo non è raggiungibile | modelli di missione dai file di gioco: datore, grado minimo, sistemi, ordini di trasporto (SCU min/max, cassa massima), token dei luoghi | `version` per record (4.10.2-LIVE.12881860 al 2026-11-08) | codice MIT; dati © CIG | ricompense spesso `null`; luoghi assegnati dinamicamente; significato dei token `Location\|Address` / `Destination\|Address` **non verificato in gioco** |
| SCHaulingPlanner (FSCSOFT-Official), `missions.js` | raw.githubusercontent.com, da GitHub Actions | 266 missioni di Stanton lette con OCR dai mission board, 2026-05-25 → 2026-06-01: compagnia, grado, ricompensa, consegne con SCU, ritiri | non dichiarata | MIT dichiarata nel README, file LICENSE assente | solo Stanton, gradi fino a Experienced; nessuna dimensione delle casse; con più ritiri per consegna la ripartizione non è indicata |
| Star Citizen Wiki API, `vehicles` | lettura manuale | Centaurus: 240 SCU, griglia e casse | 4.10.2 | come sopra | da ricontrollare a ogni patch |
| CitizenHQ (già in NAVCOM) | snapshot giornaliero | posizioni dei luoghi (distanze) | 4.10.2 | vedi FONTI.md | alcuni nomi del catalogo (spazioporti, centri Covalex) non hanno posizione |

I cataloghi sono scritti da `web/tools/fetch_logistics.mjs` in `web/data/logistics/` (JSON statici, nessuna chiave API). Se una fonte non risponde, il sito si pubblica comunque e la logistica funziona con i tuoi dati.

**Nomi dei luoghi.** Un nome del catalogo si collega a una posizione CitizenHQ solo:
- se coincide esattamente;
- oppure se è la parte finale di un solo nome ("Wide Forest Station" → "ARC-L1 Wide Forest Station").

Al 2026-11-08 si collegano 69 dei 100 luoghi di SCHaulingPlanner, più quelli risolti per suffisso. Gli altri restano "posizione non nota".

## 9. Persistenza e backup
- Database IndexedDB separato, `navcom-logistics`, con contratti, osservazioni e impostazioni. Il DATABASE PUNTI (`navcom`) non viene toccato.
- **Backup completo** (DATABASE PUNTI + logistica) in un solo JSON, formato `navcom-backup-completo`. Il **ripristino unisce** i dati e non cancella nulla: per lo stesso ID vince la versione aggiornata più di recente, e i punti esistenti restano invariati.
- Esportazione separata dei contratti in CSV e JSON (`navcom-logistics` v1).

## 10. Limiti noti
- Nessuna offerta in tempo reale: non esiste una fonte pubblica dei mission board attivi. La disponibilità la verifichi tu.
- OCR degli screenshot MobiGlas non ancora realizzato (Fase D): richiede un motore OCR locale da includere nel sito senza CDN.
- Le distanze sono in linea retta; il controllo degli ostacoli del PIANIFICATORE non viene applicato tratta per tratta.
- Il tempo di movimentazione delle casse dipende dai valori che inserisci tu; NAVCOM non ha dati misurati.
- La divisione di un movimento in più viaggi è un'ipotesi.
- Le tratte interstellari non hanno una distanza sommabile.
- L'incastro fisico delle casse nella griglia non è calcolato.
- Prestazioni (misurate): 10 contratti attivi circa 0,3 s, 20 circa 1,9 s, 30 circa 7 s. Il calcolo avviene nella pagina, che resta ferma per quel tempo.
