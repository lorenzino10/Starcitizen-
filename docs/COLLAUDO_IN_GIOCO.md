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

## 7. Rotazione dei pianeti (ATLANTE, interruttore ◷ Adesso)
1. Atterra (o resta in hangar) in una base di Stanton, per esempio Lorville o New Babbage.
2. Nell'ATLANTE seleziona la base: la scheda mostra "Ora locale" e "alba/tramonto fra N min reali".
3. Annota l'ora reale in cui in gioco la stella tocca l'orizzonte e confrontala con la previsione.
4. Se lo scarto è entro 2-3 minuti reali, la rotazione è confermata per quel corpo. Se lo scarto è costante su più giorni, è un errore di fase (correzione in gradi); se cresce, è la durata del giorno.

## 8. SITUAZIONE: rapporto con le fazioni (ATLANTE, 3.3.0)
1. Nel mobiGlas apri Reputation e annota grado e, se visibile, il numero di reputazione con la fazione della base (es. Headhunters, Citizens For Prosperity, XenoThreat).
2. Nell'ATLANTE seleziona la base, "✎ La mia reputazione", inserisci il grado o il numero e salva.
3. Avvicinati: se torrette o guardie ti sparano mentre NAVCOM dice NEUTRALE o A RISCHIO, segna "OSTILE" con una nota e annota la tua reputazione: è il dato che manca nei file (soglia del grado ostile).
4. Confronta temperatura e respirabilità con il casco e l'indicatore della tuta in superficie.
