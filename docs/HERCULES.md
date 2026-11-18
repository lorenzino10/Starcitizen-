# HERCULES · Piano di carico

Programma separato da NAVCOM, nella cartella `web/hercules/` (pagina statica, nessuna libreria esterna).
Sul sito: `https://lorenzino10.github.io/Starcitizen-/hercules/`.

## Cosa fa
Inserisci le consegne **nell'ordine del viaggio** e, per ognuna, quante casse hai per taglia (1, 2, 4, 8, 16, 24, 32 SCU).
Il programma:
1. dispone le casse nelle griglie della nave: ultima consegna in fondo (verso la prua), prima consegna vicino alla rampa e sopra;
2. posa una cassa solo se può uscire verso la rampa senza spostare casse di tappe successive (scorrendo, o sollevandola col raggio traente se l'opzione è attiva);
3. se non c'è un posto "pulito" la posa dove costringe a spostare meno casse e lo dichiara nello scarico;
4. dà la **sequenza di carico** (eseguibile: ogni cassa ha un percorso libero quando la carichi), lo **scarico tappa per tappa** e la vista della stiva dopo ogni tappa.

Prova 4 varianti (casse grandi/piccole prima × per lungo/di traverso, × da sinistra/da destra) e tiene quella con meno casse fuori, meno spostamenti e prime consegne più vicine alla rampa.

## Dati (file di gioco 4.10.3-LIVE.13165946, scunpacked-data)
| Nave | Griglia | Misure (L × lungh. × H) | SCU | Cassa max |
|---|---|---|---|---|
| C2 | CRUS_Starlifter_CargoGrid_Large_C2 | 10 × 18,75 × 5 m | 480 | 10 × 10 × 2,5 |
| C2 | CRUS_Starlifter_CargoGrid_Small_C2 | 7,5 × 11,25 × 5 m | 216 | 7,5 × 10 × 2,5 |
| M2 | Large_M2 / Small_M2 | 10 × 18,75 × 3,75 / 7,5 × 11,25 × 3,75 | 360 / 162 | come C2 |
| A2 | Small_A2 | 7,5 × 22,5 × 2,5 m | 216 | 7,5 × 10 × 2,5 |

Casse (`inventoryOccupancyDimensions`): 1 SCU 1,25³ · 2 SCU 1,25×2,5×1,25 · 4 SCU 2,5×2,5×1,25 · 8 SCU 2,5³ · 16 SCU 2,5×5×2,5 · 24 SCU 2,5×7,5×2,5 · 32 SCU 2,5×10×2,5 m.

Conseguenza utile: nella griglia piccola della C2 (larga 7,5 m) la 32 SCU sta solo per lungo; nella grande sta anche di traverso. Con sole 32 SCU la C2 ne porta 20 (640 SCU), non 21.

## Ipotesi da verificare in gioco
- **Posizione delle griglie**: i file danno le misure ma non dove stanno nella nave. Default: griglia grande verso la rampa, piccola verso la prua, centrate. Si inverte dall'interfaccia.
- Lo spazio fuori dalle griglie è considerato libero per far passare le casse.
- Le casse non si ribaltano e devono appoggiare per intero; il sollevamento resta dentro l'altezza della griglia.

## File
- `web/hercules/engine.js`: motore puro (griglie, posa, scarico simulato, ordine di carico).
- `web/hercules/render.js`: vista 3D isometrica e piani in SVG.
- `web/hercules/app.js`, `index.html`, `hercules.css`: interfaccia; i dati inseriti restano nel browser (localStorage `hercules-piano-v1`).
- `web/tests/hercules.test.mjs`: test (geometria, ordine di carico eseguibile, casi pieni e oltre capacità).
