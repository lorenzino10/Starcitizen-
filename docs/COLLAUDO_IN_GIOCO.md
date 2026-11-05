# Collaudo in gioco

Questi controlli non si possono automatizzare, perché NAVCOM non legge il gioco. Corrispondono ai test "todo" in `web/tests/collaudo.test.mjs`. Quando ne confermi uno, aggiorna le impostazioni corrispondenti in NAVCOM, così il risultato entra nei calcoli.

## 1. Formato HUD e regola di arrotondamento
1. Scegli un salto lungo, di oltre 20 Gm, ed esegui un primo salto completo. Guarda come cambia la distanza: unità, decimali e il momento in cui passa da Gm a Mm e poi a km.
2. Ripeti il salto. Esci nell'istante in cui la lettura passa da X,1 a X,0 Gm.
3. Digita `/showlocation` e calcola la distanza reale dal marker con NAVCOM (scheda PUNTI PERSONALI e poi ROTTA).
   - Se la distanza reale è vicina a X,1 → troncamento.
   - Se è vicina a X,05 → arrotondamento.
   - Se è vicina a X,0 → per eccesso.

   Togli prima lo spostamento dovuto al tuo tempo di reazione (vedi punto 2).
4. Imposta il risultato in DATI E IMPOSTAZIONI → HUD.

## 2. Tempo di reazione
1. In crociera a velocità nota (Vmax del drive), esci nell'istante in cui la lettura cambia. Ripeti 5 volte.
2. Per ogni prova, ricava con `/showlocation` lo scarto fra la posizione reale e il punto del cambio.
3. Calcola τ = scarto / velocità. Inserisci il minimo e il massimo osservati: comprendono latenza e aggiornamento dell'HUD.

## 3. Uscita manuale e nuovo salto
1. Verifica il tasto di uscita: "tieni premuto B" secondo sc-nav; SCMiner cita anche U e I.
2. Dopo l'uscita, prova un nuovo salto verso un marker.
3. Se funziona, imposta "Salti da spazio profondo: verificati".

## 4. /showlocation
Davanti a una stazione nota, confronta l'output con le coordinate in DATI E IMPOSTAZIONI → Posizioni. Se coincidono, il frame è lo stesso di CitizenHQ.

## 5. Distanza minima di salto e parametri del drive
1. Annota la distanza minima che il gioco accetta.
2. Annota Vmax, Ve, a1, a2 e la preparazione del tuo drive (fonte: scheda del componente, oppure misura sul profilo di velocità).

## 6. Tratte
Dopo ogni salto riuscito o fallito, usa nel PIANIFICATORE i pulsanti "✔ Provata in gioco" o "✖ Non disponibile in gioco". Valgono per la sola direzione A→B.
