# 📟 MISSION CONTROL (2.1.0)

Scheda che lavora come il Contract Manager del mobiGlas, partendo dalla posizione della PLANCIA.
NAVCOM **non è collegato al gioco**: le offerte vere le vedi nel mobiGlas e, se vuoi, le registri tu.
Il catalogo dice quali missioni *esistono* nei dati del gioco e dove *possono* essere offerte, mai che lo sono adesso.

## Struttura
- **Sinistra**: posizione (luogo, corpo, sistema o punto XYZ con il luogo più vicino come suggerimento), raggio di ricerca
  (*solo questo luogo* / *corpo celeste* / *intero sistema*), relazione (*DA qui*, *VERSO qui*, *da o verso*),
  PLAYER PROFILE, filtri (testo esatto o parziale anche sul nome interno, legalità, ritiro, destinazione,
  ricompensa minima, solo compatibili con la nave, ordinamento per ricompensa / distanza / nave / titolo).
- **Categorie** calcolate da NAVCOM: trasporto locale, fra pianeti e lune, fra sistemi, multidestinazione,
  destinazioni da determinare; consegne; bounty; mercenary; investigazione; recupero/raccolta/manutenzione; mining;
  eventi; Wikelo; corse; altre; illegali.
- **Schede**: OFFERTE · VISTE NEL MOBIGLAS · ACCETTATE · STORICO · PRIORITY / EVENTI.
- **Centro**: elenco compatto con titolo, stato del titolo, classe geografica, disponibilità, compatibilità con la nave.
- **Destra**: dettaglio con identificativi, offerta, ritiro, consegna, obiettivo, geografia, ricompensa, carico, nave,
  rischi, requisiti, condizioni, le tue registrazioni; azioni MOSTRA SULLA MAPPA, CALCOLA ROTTA, AGGIUNGI AL PIANO,
  RAGGRUPPA CON ALTRE, REGISTRA OFFERTA VISTA.
- **Sotto**: selezione con casella, RAGGRUPPA MISSIONI, ottimizzazione in tre modi, riepilogo, rotta.

Ingressi: **📟 MISSIONI DA QUESTA LOCALITÀ** e *verso la destinazione* nella PLANCIA; *Missioni da qui* e
*Missioni verso qui* nella scheda di un luogo dell'ATLANTE.

## Regole
- **Offerta, ritiro, consegna e obiettivo restano separati.** Un'offerta indicata sul pianeta microTech appare come
  "offerta nella regione microTech (non specificamente a New Babbage)". Con raggio *solo questo luogo* restano solo
  le offerte che i dati assegnano proprio a quel luogo, più i ritiri lì.
- **Disponibilità**: 🟠 CATALOGATA → 🟣 COMPATIBILE CON LA REGIONE → 🟡 POTENZIALMENTE ACCESSIBILE (regione e requisiti
  registrati compatibili) · ⛔ NON ACCESSIBILE (un requisito registrato non è soddisfatto). 🔵 VISIBILE, 🟢 ACCETTATA,
  COMPLETATA e FALLITA esistono solo per le tue registrazioni. Nessuno stato "disponibile adesso".
- **Requisiti**: grado minimo e massimo, prerequisito di reputazione, missioni richieste, CrimeStat.
  Un grado non registrato nel profilo resta "non verificabile", mai presunto. Le scale dei gradi (nome → reputazione)
  sono ricavate dal catalogo: 133 scale fazione/ambito.
- **Titoli** in lingua originale, mai tradotti: *verificato* (titolo letterale da Wiki o file), *risolto*
  (parametri a valore unico sostituiti), *dinamico* (`[TargetName]` o chiave del gioco mostrata come tale),
  *assente* ("Tipo · datore (titolo assente nei file)") con il nome interno a parte e "Titolo mobiGlas non verificato".
- **Geografia** solo da luoghi noti: LOCALE (stesso corpo), INTERPLANETARIO, INTERSTELLARE, DA DETERMINARE (il pool
  ammette più classi), MULTIDESTINAZIONE (più ritiri o consegne). Per bounty, mercenari e indagini la classe viene dai
  luoghi dell'obiettivo (pool non cargo dei file); senza luoghi resta NON NOTA, con il luogo d'offerta come nota.
- **RAGGRUPPA**: stessa partenza, stesso ritiro, stessa destinazione, destinazioni vicine (stesso pianeta con lune e
  stazioni), stesso sistema, stessa direzione interstellare. Appartenenza *certa* con luoghi fissi, *possibile* con pool.
  Pool con gli stessi membri su più luoghi diventano un solo gruppo ("X, Y, Z e altri N luoghi in comune").
- **Ottimizzazione** (MASSIMO GUADAGNO / MINIMO TEMPO / MIGLIORE EFFICIENZA): solo trasporti con ritiro e consegna,
  con il motore di stacking dell'ATLANTE (capacità dopo ogni tappa, casse, ordine). Bounty e mercenari restano attività
  separate, mai sommate al cargo. Modelli con pool o dati mancanti sono esclusi con il motivo. Ogni valore del riepilogo
  porta la sua origine: *noto*, *calcolato*, *parziale*, *mancante*.
- **Rotte**: stesso sistema → tratta QT al PIANIFICATORE; altro sistema → gateway di uscita, salto, gateway d'ingresso,
  destinazione. Nessuna distanza euclidea fra sistemi; il tunnel non ha lunghezza né durata nei dati.

## PLAYER PROFILE e registro
- Fazioni e gradi (scelti dalle scale del catalogo o come valore numerico), certificazioni (modelli "Certification" del
  catalogo), missioni completate (dal catalogo o scritte a mano), tag, CrimeStat 0–5, note.
- REGISTRA OFFERTA VISTA: parte dal modello (titolo e UUID copiati), chiede stato, luogo dove l'hai vista, ricompensa
  letta, movimenti (merce, SCU, cassa, ritiro e consegna reali). Con gli SCU compilati nasce anche il contratto della
  LOGISTICA, che può entrare nel piano cargo. Stato **ACCETTATA** = solo l'archivio di NAVCOM.
- OCR degli screenshot: **non implementato**. Gli screenshot restano nel browser come allegati.
- Archivio: chiavi `mcRecords` e `playerProfile` nelle meta di IndexedDB `navcom-logistics`. Nessuna modifica dello
  schema. Il BACKUP COMPLETO le include; il ripristino unisce per ID e non sovrascrive un profilo già compilato.

## Fonti
| Fonte | Uso | Stato |
|---|---|---|
| Star Citizen Wiki API `/api/missions` (+ `/missions/{id}`, `/missions/filters`, `/game-versions`, `/game-versions/default`) | titoli, gruppi di varianti, versione LIVE, campi di dettaglio (tipo, luoghi della starmap, prerequisiti, reputazione, `hidden_in_mobiglas`, durata, cooldown) | pubblica, verificata; usata dalla pipeline |
| scunpacked (file del gioco) | contratti, pool di luoghi, ordini di carico, requisiti (`MinStanding`, `MaxStanding`, `Prerequisites`, `CrimeStat`, `Cooldown`), luoghi degli obiettivi | pubblica, usata dalla pipeline |
| VerseBase | — | risponde 403 ai client automatici: non usata |
| versefiles | — | solo HTML, nessuna API: non usata (niente scraping) |
| SC Toolbox | — | bloccato da robots.txt: solo link |

Non esiste in nessuna fonte un **Offer ID** (l'identificativo di un'offerta del mobiGlas): NAVCOM non lo mostra.

## Campi: reali, parziali, inconoscibili
- **Dai dati reali**: titolo (quando letterale), nome interno, UUID, gruppo di varianti, tipo, datore, fazione,
  luoghi d'offerta, pool di ritiro e consegna, luoghi degli obiettivi, ordini di carico (SCU e cassa massima),
  ricompensa fissa o intervallo, gradi e prerequisiti, CrimeStat, limite di tempo, cooldown, illegalità.
- **Parziali**: titoli dinamici (765) e assenti (65); descrizioni (solo dove la Wiki le ha senza segnaposto);
  ricompense calcolate dal gioco (nessun importo); luoghi non riconosciuti nella starmap; geografia dei pool;
  tempo dell'itinerario (serve la velocità QT e i tempi di carico).
- **Inconoscibili senza il gioco**: se un'offerta è visibile ora, a quale luogo del pool il gioco assegna il
  contratto, la quantità esatta, la ricompensa di una missione dinamica, il tuo grado reale, l'Offer ID.

## Dati reali (catalogo 4.10.2-LIVE.12881860)
4.197 modelli. Titoli: 3.367 verificati, 765 dinamici, 65 assenti. Prerequisiti di missione: 4.328 su 4.340 con titolo.
New Babbage, raggio corpo (microTech): 1.089 righe (43 potenzialmente accessibili senza profilo, 922 compatibili con
la regione, 124 catalogate con ritiro o obiettivo nella regione). Raggio *solo questo luogo*: 293 righe, tutte
CATALOGATE (nessun modello indica New Babbage come luogo d'offerta). Port Tressler, solo il luogo: 99 righe.
Geografia: 1.185 modelli hanno solo il luogo d'offerta (NON NOTA); i trasporti locali certi sono 12, perché quasi tutti
i trasporti usano pool che ammettono più classi.

## Test
`web/tests/mc.test.mjs`: MC-1..MC-19 con dati **sintetici dichiarati** (nomi di luoghi reali per leggibilità,
coordinate, contratti e gradi inventati), più MC-R sui dati reali, saltato se il catalogo locale non c'è.
