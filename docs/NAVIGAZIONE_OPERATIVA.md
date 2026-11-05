# NAVCOM: navigazione operativa e pianificazione multi-tratta (Fasi 4 e 5)

Versione web 0.4.0. Il motore si trova in `web/js/core/`:

| File | Contenuto |
|---|---|
| `plan.js` | strategie, grafo, ordinamenti |
| `hud.js` | lettura HUD e incertezza |
| `qtdrive.js` | tempi di viaggio |
| `navgraph.js` | Dijkstra e percorso fra sistemi |
| `systems.js` | jump point |
| `instructions.js` | istruzioni per il pilota e controlli sulle coordinate |

Il motore gira in un Web Worker (`plan-worker.js`).

## 1. Cosa si sa e cosa è un'ipotesi

Verifica fatta il 2026-11-05. La colonna "Stato" dice come NAVCOM tratta ogni dato.

| Argomento | Fonte | Stato in NAVCOM |
|---|---|---|
| L'HUD mostra la distanza residua verso la destinazione durante il salto | starcitizen.tools, *Guide:Quantum Travel* | fatto |
| Sopra 1 Gm la lettura è in Gm con **un decimale** (es. "14.3 Gm"), quindi il passo è di 0,1 Gm (100.000 km) | SCMiner, calcolatore Aaron Halo | fonte terza, valore predefinito |
| Formato sotto 1 Gm (Mm o km, decimali) | nessuna fonte | **ipotesi**: Mm con 1 decimale, km con 0 decimali, configurabile |
| Regola di arrotondamento dell'HUD | nessuna fonte | **sconosciuta**: si usa l'intervallo intero di un passo |
| Uscita manuale: "hold B partway" | ByteCollectiveIO/sc-nav, halo-finder | fonte terza. SCMiner cita anche U e I, quindi le fonti non concordano: va verificato |
| Ripartenza QT dopo un'uscita: "Drop out 0.1–0.2 Gm before your target, then re-engage QT" | SCMiner | fonte terza: i salti da spazio profondo sono "Supportati da fonti", non "Verificati" |
| Ripetibilità delle uscite: circa ±200 km a bassa velocità. A piena crociera, 200 ms di reazione valgono 10.000–57.000 km; crociera QT da 53,6 a 283 Mm/s | sc-nav, halo-finder | fonte terza, usata solo come ordine di grandezza |
| Profilo del salto: accelerazione in due stadi (a1 fino a Ve, poi da a1 ad a2 fino a Vmax), crociera e decelerazione speculare | starcitizen.tools, *Guide:Quantum travel mechanics*, Alpha 4.10.0 | modello usato. I parametri del drive li inserisci tu |
| Spool, calibrazione, distanza minima di salto | non pubblicati | parametri facoltativi. Se mancano: "esclusi" oppure "non determinabile" |
| `/showlocation` copia negli appunti `Coordinates: x:… y:… z:…` in metri, nel frame del sistema (Hurston: `x:12850457093 y:0 z:0`, identico a CitizenHQ) | Valalol/Star-Citizen-Navigation | fonte terza. Il comportamento in 4.10 va collaudato |
| Le stazioni Gateway sono il lato di ogni jump point (Pyro: "Stanton Gateway", "Nyx Gateway"; Nyx: "Pyro Gateway", "Stanton Gateway") | CitizenHQ | dati. La distanza fra stazione e ingresso del tunnel non è nota |
| Raggi dei corpi di Pyro e Nyx | starmap.space | solo i raggi: le posizioni di starmap.space per Pyro non coincidono con quelle di CitizenHQ |

Nessuna fonte pubblica elenca i "collegamenti QT disponibili". In gioco si salta verso un marker se la linea non è ostruita e il carburante basta. Per questo il grafo di NAVCOM considera ogni coppia di marker come arco **candidato**, e l'evidenza di ogni arco è dichiarata.

## 2. Strategie

Tutte le strategie usano geometria esatta. Unità interna: metro, frame XYZ del sistema.

| Codice | Percorso | Note |
|---|---|---|
| **S1** | [partenza →] A → salto A→B interrotto in C → volo convenzionale fino a P | C è la proiezione di P sul segmento A-B, con `t ∈ (0,1)` |
| **S0** | posizione libera → salto verso M interrotto → volo | solo se indichi una posizione XYZ |
| **S2** | [partenza →] A → salto A→B interrotto in C1 → nuovo salto C1→M interrotto in C2 → volo | C1 è scelto perché la retta C1→M passi il più vicino possibile a P |

**Calcolo di C1 (S2), in forma chiusa.** Le direzioni da M verso i punti del segmento A-B stanno nel piano (M, A, B). La direzione più vicina a `u = (P−M)/|P−M|` è la proiezione di `u` su quel piano. Se `n` è la normale al piano:
- residuo = `|P−M|·|u·n|`;
- lettura HUD verso M all'uscita = `|P−M|·cos θ`.

P deve stare fra C1 e M. Per S2 si esaminano tutte le coppie A-B, combinate con i `kNear` marker più vicini a P (40 per default, configurabile).

**Perché S2 serve.** La seconda lettura HUD riguarda la distanza verso un marker vicino, quindi l'unità è più fine. In più la seconda tratta è corta, quindi la velocità all'uscita è più bassa. Con `/showlocation` dopo la prima uscita, l'errore della prima fase si azzera, perché si ricalcola dalla posizione reale.

**Grafo e salti completi verso A.** Se indichi la partenza, i salti completi fino ad A si calcolano con Dijkstra su grafo denso, in versione O(n²) a matrice, cioè quella ottimale per i grafi completi. Gli archi sono direzionali (lo stato di A→B è indipendente da B→A). Gli archi non ammessi nella modalità scelta valgono ∞. Il peso è il tempo, con criterio "tempo" e velocità QT note, altrimenti la distanza.

**Fra sistemi.** Si calcola prima un BFS sui collegamenti logici dei jump point, poi Dijkstra in ogni sistema fino alla stazione Gateway di uscita. Le coordinate di sistemi diversi non vengono mai sommate né confrontate. Il grafico mostra solo il sistema di P.

## 3. Evidenza e modalità

| Evidenza | Significato | Stato mostrato |
|---|---|---|
| gioco | segnata da te "provata in gioco" (direzionale), oppure capacità "salti da spazio profondo" verificata nelle impostazioni | 🟢 Verificata |
| dati | entrambi i marker sono QT secondo CitizenHQ, modello ostacoli completo, nessun ostacolo neppure incerto, nessun marker al centro o sulla superficie di un corpo | 🔵 Supportata |
| fonti | salto da spazio profondo documentato da terzi (vedi tabella) | 🔵 Supportata |
| geometria | qualunque altro caso | 🟠 Teorica |

- **Modalità operativa**: solo tratte Verificate o Supportate. Esclude le tratte bloccate (ostacolo certo con il margine impostato), quelle che hai segnato "non disponibile in gioco" e, se lo imposti, i salti da spazio profondo. Se non resta nulla, NAVCOM dice che i dati non bastano.
- **Modalità geometrica**: considera tutto. Le tratte bloccate compaiono solo se richieste. Lo stato di ogni tratta resta visibile.
- Nessuna promozione automatica: una tratta diventa Verificata solo con il pulsante "✔ Provata in gioco".

### Partenza non utilizzabile e cause di scarto (dalla 0.5.6)
- **Pianeti e lune come partenza**: in CitizenHQ il marker di un pianeta (es. "microTech") sta al **centro** del corpo. Indica il pianeta, non dove ti trovi. Ogni tratta che parte da lì è teorica, quindi in modalità operativa da quel marker non si raggiunge nulla. NAVCOM lo spiega e propone fino a 5 marker vicini (stazioni orbitali, comm array) da cui partono tratte operative, con distanza e numero di tratte. Le proposte sono calcolate dai dati e **non provate in gioco**. La partenza cambia solo se premi "Usa come partenza e ricalcola": NAVCOM non sa dove sei e non sostituisce mai da solo la tua posizione.
- Una posizione XYZ incollata che cade dentro un pianeta o una luna è trattata allo stesso modo (centro o superficie): mai operativa.
- **Nessuna rotta operativa**: NAVCOM mostra quante combinazioni sono state scartate e perché. Le cause sono partenza non raggiungibile, tratta teorica (centro, superficie, ostacolo incerto), dati incompleti, ostacolo, collegamento non disponibile (segnato da te) e altro (impostazioni). Il verdetto distingue tre casi:
  - *informazioni insufficienti*: almeno una parte degli scarti dipende da dati mancanti o incerti, quindi la destinazione **non** è dichiarata irraggiungibile;
  - *non raggiungibile con i dati attuali*: tutti gli scarti sono ostacoli certi o tratte che hai segnato non disponibili;
  - *problema di partenza*: la destinazione non è stata nemmeno valutata.
- I conteggi sono per combinazione: la stessa tratta può comparire in più combinazioni.
- **Prefiltro esatto**: in modalità operativa le combinazioni che verrebbero comunque rifiutate si scartano prima dei limiti di valutazione (`pool2`, `maxEvaluations`). Così non occupano posti a danno di quelle valide. Il prefiltro usa lo stesso criterio della valutazione finale (verificato da test su tutte le coppie), quindi non rende operativo nulla in più.
- **MOSTRA ALTERNATIVE GEOMETRICHE**: rilancia lo stesso calcolo in modalità geometrica e mostra il risultato in una sezione separata "NON OPERATIVE". Serve a capire quali tratte verificare in gioco, non a volare.
- **CALCOLA ROTTA dal DATABASE PUNTI** riparte da "Nessuna: trova da dove partire". La partenza scelta resta solo se spunti "Mantieni questa partenza quando calcoli dal DATABASE PUNTI".
- **Limite noto: stazioni in orbita bassa**. Port Tressler è a circa 1.126 km dal centro di microTech, dentro la sfera di sicurezza (raggio × 1,2 = 1.200 km). Il controllo ostacoli riduce la sfera a poco meno della distanza della stazione. Così risultano bloccate quasi tutte le tratte che hanno una componente verso il pianeta: da Port Tressler restano 4 tratte operative su 434. È una scelta prudente e non è stata cambiata. Si può allentare solo verificando le tratte in gioco ("✔ Provata in gioco").

### Modello ostacoli di Stanton e dati importati
Il seed di starmap.space e CitizenHQ non concordano sulla posizione di Calliope, Euterpe e Clio: la distanza fra le due posizioni va da 130.000 a 215.000 km. I marker (avamposti, grotte) usano il frame di CitizenHQ. Dalla 0.5.6 il corpo si controlla nella posizione importata, e la posizione del seed resta come ostacolo **incerto**. Le discrepanze sono elencate in DATI E IMPOSTAZIONI → Fonti.

## 4. Precisione dell'interruzione

Il pilota non esce "quando legge 13,9 Gm": quella lettura copre un passo intero, cioè 100.000 km. Esce nell'**istante in cui la lettura cambia** da (k+1) a k passi. A quale distanza avviene quel cambio dipende dalla regola di arrotondamento:

| Regola | Distanza del cambio |
|---|---|
| troncamento | (k+1)·passo |
| arrotondamento al più vicino | (k+½)·passo |
| per eccesso | k·passo |
| sconosciuta (predefinita) | intervallo [k·passo, (k+1)·passo] |

**Tempo di reazione.** Se inserisci la velocità QT e il tempo di reazione [τmin, τmax], l'uscita reale avviene fra v·τmin e v·τmax dopo il cambio. La velocità v è quella del profilo nel punto di uscita, che può essere in accelerazione, in crociera o in decelerazione. NAVCOM sceglie il k che minimizza il caso peggiore, quindi la compensazione è automatica. Senza questi dati scrive "non determinabile".

**Residuo per uscita a distanza HUD h.** Vale `√(r0² + (h − h0)²)`, dove r0 è la distanza perpendicolare di P dalla tratta. È una funzione convessa, quindi il massimo sta agli estremi dell'intervallo.

**Arrotondamento e dinamica restano separati.** Il valore "solo arrotondamento" e quello "con reazione" sono indicati separatamente. Non si aggiunge nessun errore non quantificato: latenza del server e frequenza di aggiornamento dell'HUD rientrano nel tuo τ, misurato in gioco.

**S2.** Il caso peggiore senza ricalcolo si valuta ai 4 vertici degli intervalli delle due uscite. Con `/showlocation` e ricalcolo conta solo la seconda uscita.

**Caso ARC-L1 → CRU-L4.** Tratta di 24.003.285 km, interruzione ideale a 13.921.999 km, residuo 1.201 km. L'HUD in Gm con un decimale dà "da 14,0 a 13,9 Gm". Con regola sconosciuta, l'uscita cade fra 13,9 e 14,0 Gm. Il residuo massimo è di circa **78.010 km**, non 1.201 km. Quel numero era precisione matematica, non ottenibile.

## 5. Tempi

| Voce | Calcolo |
|---|---|
| Salto completo | preparazione + durata del profilo a due stadi |
| Salto interrotto | preparazione + tempo per percorrere la distanza fino all'uscita |
| Volo convenzionale | profilo trapezoidale (accelerazione = decelerazione) |
| Jump point | tempo di transito che inserisci tu |

- Se l'uscita manuale è considerata istantanea, NAVCOM lo dichiara.
- Se manca un parametro necessario, il tempo è "non determinabile" e NAVCOM elenca cosa manca.
- Senza accelerazioni il tempo è un **limite inferiore**.
- Senza preparazione il tempo "esclude la preparazione".

## 6. Criteri di ordinamento

Tutti i criteri sono documentati e non usano pesi nascosti. Gli ordinamenti sono lessicografici.

| Criterio | Chiavi in ordine |
|---|---|
| Minima distanza residua | residuo teorico → residuo massimo → distanza QT |
| Minimo tempo | tempo totale (i piani senza tempo determinabile vanno in fondo) → residuo |
| Migliore raggiungibilità operativa | evidenza peggiore fra le tratte (gioco < dati/fonti < geometria) → residuo massimo entro la "distanza finale accettabile" (parametro facoltativo) → residuo massimo → numero di interruzioni → numero di salti → tempo (oppure distanza QT) |

**Preselezione** (parametri in `DEFAULT_OPTS`, `plan.js`):
- i candidati sono ordinati con una chiave rapida (residuo, oppure tempo stimato a Vmax);
- poi vengono valutati in dettaglio finché non bastano: `limit×2` per il residuo, `limit×4` per il tempo, `poolOperativo = 300` per il criterio operativo, con un massimo di 40.000;
- S2 conserva i migliori `pool2 = 3000` candidati per residuo nominale.

## 7. Controlli sulle coordinate

NAVCOM avvisa nei casi seguenti:
- punto dentro un corpo celeste;
- punto oltre la regione coperta dai dati;
- unità sospetta: metri inseriti come km (il punto rientra nei dati se diviso per 1000) oppure km inseriti come metri;
- marker QT più vicino a oltre **5 Gm** (soglia solo informativa);
- dati sui corpi celesti incompleti;
- partenza in un sistema senza collegamento noto.

## 8. Prestazioni

- 400 marker producono circa 160.000 tratte direzionali S1 e 3,2 milioni di combinazioni S2, in forma chiusa senza allocazioni.
- In Node il calcolo richiede meno di un secondo. Nel browser gira in un Web Worker: l'interfaccia non si blocca.
- Gli ostacoli per coppia di marker restano in cache nel worker finché non cambiano i dati, il margine o le verifiche.

## 9. Cosa non è operativo (separato di proposito)

- Formato HUD sotto 1 Gm e regola di arrotondamento: ipotesi finché non vengono collaudati.
- Direzione del volo convenzionale finale: nessun marker di gioco indica P.
  - NAVCOM fornisce gli angoli rispetto al marker di destinazione e alla stella.
  - Fornisce anche la "Correzione in volo" con due `/showlocation`.
  - Non conosce l'orientamento della nave.
- Pianeti in rotazione: i marker al centro o in superficie restano Teorici.
- La versione desktop Python (Streamlit) non include le Fasi 4 e 5: il pianificatore è solo nella versione web.
