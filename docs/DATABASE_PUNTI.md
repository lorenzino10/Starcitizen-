# DATABASE PUNTI (web 0.5.0)

Archivio personale delle destinazioni spaziali. **NAVCOM non genera
coordinate e non crea destinazioni da solo**: ogni punto del database è stato
inserito a mano, importato da Excel o JSON, oppure salvato dal pianificatore
partendo dalle XYZ che hai digitato tu.

## Campi

| Campo | Note |
|---|---|
| ID univoco | UUID assegnato al salvataggio; si conserva in export e backup |
| Nome | obbligatorio |
| Sistema | Stanton, Pyro, Nyx (obbligatorio) |
| X, Y, Z | numeri; frame del sistema (stella in 0,0,0), lo stesso di CitizenHQ e `/showlocation` |
| Unità | km o m; i valori sono salvati **come li hai scritti**, la conversione in metri avviene solo al momento del calcolo |
| Categoria | Mining, Esplorazione, Relitto, Punto personale, Altro |
| Materiale/risorsa | testo libero (con suggerimenti dai valori già usati) |
| Stato | Da verificare, Verificato, Non interessante |
| Classificazione | testo libero (es. Grotte, Relitti, Mining - prospezione), filtrabile; dalla 0.5.1 |
| Priorità | Alta, Media, Bassa o non assegnata; dalla 0.5.1 |
| Fonte dei dati | da dove vengono le coordinate (sito, dataset, misura in gioco); dalla 0.5.1 |
| Metodo di origine, Fonte risorse | metadati di provenienza; dalla 0.5.4 |
| Corpo celeste, Latitudine, Longitudine, Altitudine (m), X/Y/Z locali (km), Sistema di riferimento planetario | coordinate sul corpo; **conservate come scritte, mai convertite** in XYZ di sistema (il corpo ruota); dalla 0.5.4 |
| Note | testo libero |
| Data di inserimento | automatica; si conserva negli aggiornamenti |
| Data ultima verifica | manuale; impostata a oggi se scegli "Verificato" senza data |

Un punto senza tutte e tre le coordinate è una **scheda incompleta**: resta
nel database, ma il pulsante CALCOLA ROTTA è disattivato e il punto non
compare fra le destinazioni del pianificatore.

## Come entrano i punti
1. **Inserimento manuale** (modulo a sinistra, anche incollando l'output di `/showlocation`, che è in metri).
2. **Import Excel (.xlsx)**: anteprima, associazione delle colonne (proposta in automatico dalle intestazioni, modificabile), unità e sistema di default per le celle vuote, controllo dei duplicati, riepilogo finale con errori e avvisi riga per riga.
3. **Dal pianificatore**: "💾 Salva queste coordinate nel DATABASE PUNTI" copia nel modulo le XYZ e l'unità che hai inserito; il punto viene salvato solo quando premi "Salva punto".
4. **Ripristino di un backup JSON** (unione per ID oppure sostituzione completa).
5. **Migrazione automatica** dei vecchi "punti personali" (localStorage, metri): una sola volta per punto; se poi lo elimini, non ricompare.

## Sinonimi accettati in import
- Stato "Da georeferenziare" diventa "Da verificare" (la scheda senza XYZ resta comunque incompleta).
- Priorità "NON ASSEGNATA" diventa vuota; maiuscole e minuscole indifferenti.
- Colonne riconosciute anche come "Risorsa cercata", "Gruppo" (Classificazione), "Fonte geometria" (Fonte dei dati).
- Il lettore accetta anche i file .xlsx scritti da programmi .NET/OpenXML SDK (elementi XML con prefisso, es. `<x:row>`).

## Numeri accettati in import
`1234.5`, `1234,5`, `1.234,5`, `1,234.5`, `1 234,5`, `-1,2e9`, celle numeriche
di Excel. Il caso `1.234` (un solo punto seguito da tre cifre) è **ambiguo**:
viene letto come decimale (1,234) e segnalato negli avvisi. Se usi il punto
come separatore delle migliaia, controlla quegli avvisi.

## Duplicati
Due punti sono duplicati se sono nello **stesso sistema** e:
- le coordinate distano al massimo **1 m** (dopo la conversione in metri), oppure
- hanno lo **stesso nome** (senza differenze di maiuscole, spazi o accenti).

In import: "ignora" mantiene i punti esistenti; "aggiorna" sovrascrive **solo i campi
presenti e non vuoti nel file**: gli altri (es. classificazione o coordinate planetarie
assenti nel foglio) restano quelli già salvati. ID, data di inserimento e origine non cambiano.
X, Y, Z e unità si aggiornano insieme. Un duplicato
all'interno dello stesso file viene sempre scartato (vince la prima riga).
"Trova duplicati" raggruppa i doppioni già presenti e li fa selezionare per
l'eliminazione: non elimina nulla da solo.

## Avvisi di plausibilità (non bloccano)
Se un punto è oltre il 105% della distanza dall'origine del punto noto più
lontano del sistema, NAVCOM lo segnala e suggerisce un possibile errore di
unità (metri scritti come km o viceversa). Non corregge nulla.

## Grandi volumi
Duplicati e import usano un indice (ID, nome per sistema, griglia di 1 m): 3.355 punti si controllano in circa 0,3 s e si importano in circa 1 s.
La tabella mostra al massimo 400 righe alla volta; ricerca e filtri lavorano su tutto il database, e "seleziona tutti" vale per tutti i punti filtrati.

## Persistenza: cosa sapere
- I punti sono salvati in **IndexedDB**, nel browser e sul dispositivo che stai usando. Sopravvivono alla chiusura del browser e al riavvio del PC.
- **Non** sono sincronizzati: un altro browser, un altro PC o il telefono vedono un database separato.
- Si **perdono** se cancelli i dati del sito o la cronologia "completa", se usi la navigazione privata, se il browser libera spazio (NAVCOM chiede l'archiviazione persistente; la nota sotto i pulsanti dice se il browser l'ha concessa).
- Nessun server, nessun cloud: l'unica copia di sicurezza è quella che esporti. **Esporta regolarmente il JSON** (backup completo) o l'Excel.
- Se IndexedDB non è disponibile (alcune modalità private), NAVCOM lavora in memoria e lo dice chiaramente: i punti restano solo fino alla chiusura della pagina.

## Esportazione
- **Excel**: foglio "Punti NAVCOM" con le stesse intestazioni accettate dall'import (ID incluso), quindi reimportarlo non crea doppioni.
- **JSON**: formato `navcom-punti` v1, copia esatta di tutti i campi; è il backup consigliato.

## Limiti
- Solo `.xlsx`: i vecchi `.xls` vanno salvati come `.xlsx` da Excel. Il lettore è scritto in casa (nessuna libreria esterna, nessun CDN) e copre i file normali di Excel, LibreOffice e Google Sheets; formule senza valore calcolato in cache e fogli protetti con password non sono supportati.
- Le date esportate in Excel sono testo `gg/mm/aaaa hh:mm` (UTC).
- La versione desktop Python non ha questo database.
