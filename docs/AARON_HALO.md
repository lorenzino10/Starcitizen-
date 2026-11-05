# Primo caso di test: ARC-L1 → CRU-L4, Aaron Halo fascia 5

Comando: `python tools/aaron_halo_report.py` (oppure `esegui_test.bat`).
I valori NAVCOM sono calcolati dal motore partendo **solo** dalle coordinate
delle due stazioni (CitizenHQ, dati 4.10.2). La fixture
`tests/fixtures/stanton_arc_l1_cru_l4.json` non contiene alcun risultato calcolato.

## Risultati

| Grandezza | NAVCOM | Cornerstone | SCMiner | Differenza |
|---|---|---|---|---|
| Lunghezza della tratta | 24.003.285 km | 24.001.764 km | — | +1.521 km (0,006%) |
| Distanza HUD all'ingresso nella fascia 5 | 14.490.573 km | — | — | |
| **Distanza HUD al picco di densità** | **14.290.792 km** | 14.292.609 km | **14,3 Gm** | −1.817 km rispetto a Cornerstone (1% della larghezza della fascia); stessa lettura a 0,1 Gm di SCMiner |
| Distanza HUD all'uscita dalla fascia 5 | 14.080.145 km | — | — | |
| Lunghezza della finestra dentro la fascia | 410.427 km | — | "margin 345 Mm" | Definizione di SCMiner non pubblicata |
| z all'ingresso e all'uscita | 490 e 415 km | — | — | Entro la semi-altezza di ±4.998 km |
| Verso opposto, picco | 9.712.494 km | 9.709.155 km | — | +3.339 km |
| Somma dei due versi | 24.003.285 km, cioè la lunghezza della tratta | idem | — | Identità geometrica verificata |

## Cause delle divergenze
1. **Coordinate dei marker diverse.** Le carte Cornerstone risalgono a 3.16 / 3.19; NAVCOM usa le stazioni 4.10.2 da CitizenHQ. 1.521 km di differenza sulla lunghezza della tratta bastano a spiegare quasi tutto lo scarto sul picco.
2. **Arrotondamento di SCMiner.** "14.3 Gm" ha una risoluzione di 100.000 km: qualunque valore fra 14,25 e 14,35 Gm si legge così, quindi il confronto con SCMiner vale ±50.000 km.
3. **"Margin" di SCMiner contro la nostra finestra.** SCMiner non pubblica come calcola i 345 Mm (forse una porzione centrale della fascia, oppure con coordinate diverse). La nostra finestra è l'intero tratto di segmento con raggio compreso fra 20.230.000 e 20.407.000 km.
4. **Modello della fascia.** NAVCOM usa un guscio sferico limitato in |z|. Rispetto al modello cilindrico la differenza è sotto 1 km a questo raggio.

## Implicazioni pratiche (da non sottovalutare)
- La finestra è di circa 410.000 km, mentre un passo dell'HUD a 1 decimale in Gm vale 100.000 km: l'HUD basta per entrare nella fascia, **non** per centrare il picco con precisione.
- Tempi di reazione e decelerazione del motore QT **non** sono modellati. Il programma riporta distanze geometriche, non promette precisione di interruzione.
