# Fonti dati: cosa è stato verificato (5 novembre 2026)

| Fonte | Esito | Cosa offre | Unità / frame | Limiti, licenza | Uso in NAVCOM |
|---|---|---|---|---|---|
| **CitizenHQ** `citizenhq.space/api/v1` | ✅ Verificata | `GET /positions?system=stanton\|pyro\|nyx&type=&q=` restituisce un array di `{uuid, name, type, system, parentUuid, x, y, z, qtValid}`. `GET /health` restituisce lo stato delle sincronizzazioni e la versione dei dati scunpacked (4.10.2-LIVE.12881860 al momento della verifica). | Metri. Frame della griglia del sistema: la stella *Stanton* è a (0,0,0). Crusader coincide al metro con il dataset starmap.space. Le coordinate possono essere `null` (per /health 193 posizioni su 232 hanno coordinate). | Solo GET, nessuna chiave, 60 richieste al minuto per IP (burst 30), oltre risponde 429. Attribuzione richiesta. Dati forniti "come sono". Licenza non specificata oltre all'attribuzione. | **Fonte principale** per l'import delle posizioni. |
| **Star Citizen Wiki API** `api.star-citizen.wiki` | ⚠ Non verificata | La pagina docs è una Swagger UI senza contenuto leggibile da qui, e la rete di sviluppo blocca l'host. Da sc-nav risulta che espone posizioni come `local_km` relative al contenitore, con `global_m` spesso nullo e, per Pyro, un frame ruotato di −85,23°. | — | CC BY-SA 4.0 | Non usata nella Fase 1. Da verificare dal tuo PC prima di integrarla. |
| **SCMiner Aaron Halo** `scminer.rocks/calculators/aaron-halo` | ✅ Consultata (nessuna API) | Calcolatore web. ARC-L1 → CRU-L4, fascia 5: "Exit at 14.3 Gm", margine 345 Mm, volo 1m 10s, finestra di reazione ~3,3 s. Fasce in Gm con 2 decimali. Coordinate dei marker e formula non pubblicate. | Gm | Nessuna API | Solo riferimento per il confronto nei test. |
| **Cornerstone / CaptSheppard** `cstone.space` | ✅ Tramite sc-nav | Survey di forma e densità dell'Aaron Halo: 10 fasce con raggio interno ed esterno, picco e semi-altezza. Valori di interruzione pubblicati (ARC-L1 → CRU-L4 fascia 5: 14.292.609 km). | km dal centro della griglia di Stanton | Nessuna licenza dichiarata. I valori misurati sono fatti, citati con attribuzione. | Tabella delle fasce in `navcom/core/halo.py`. |
| **VerseToolkit** `versetoolkit.com/starmap` | ❌ Nessuna API pubblica | Planner web con 572 località. Cita un percorso `/locations/positions` senza documentarlo. | Gm | Dati di gioco dalla Wiki (CC BY-SA). Nessuna licenza per il resto. | Non usata. |
| **Quantum** `quantumsc.org` | ❌ Nessuna API | App desktop (MIT). Le sue posizioni vengono dal database di Valalol. | — | MIT (codice) | Non usata. |
| **SC Org Navigator** `github.com/ByteCollectiveIO/sc-nav` | ✅ Analizzato | Suite FastAPI e SQLite. Contiene `poi/containers.json` (starmap.space: pianeti e lune con raggio, punti di Lagrange, jump point), `poi/locations.json` (Wiki, 4.10.1) e `poi/poi.json`, oltre al documento di progetto del suo Halo Finder. | Metri, stesso frame di CitizenHQ | PolyForm **Noncommercial** sul codice. I dataset hanno licenze proprie. | Codice NON copiato. Usati i raggi dei corpi di Stanton (`navcom/seed/stanton_bodies.json`, con attribuzione) e i valori Cornerstone citati. |
| **Star-Citizen-Navigation** `github.com/Valalol/Star-Citizen-Navigation` | ✅ Analizzato | `Database.json`: 38 contenitori di Stanton (pianeti, lune, Lagrange) con raggio, OM, parametri di rotazione e POI di superficie in coordinate locali. `Space_POI` è vuoto. | **km** | MIT. L'autore lo dichiara in parte deprecato. I dati sono dell'epoca 3.17. | Non usato. Utile in futuro per la rotazione dei pianeti e i POI di superficie (Fase 3). |

## Conflitti noti
- **Posizione della stella Stanton**: per CitizenHQ è a (0,0,0), per starmap.space è a (0,136; 1,294; 2,923) Gm. NAVCOM le considera entrambe come ostacolo *incerto*: se una tratta passa vicino a una delle due, viene classificata "Teorica".
- **Marker contro punto di Lagrange**: le stazioni (es. ARC-L1 Wide Forest Station) distano alcune migliaia di km dal punto di Lagrange omonimo. NAVCOM usa le stazioni, perché sono le destinazioni QT selezionabili in gioco.

## Cosa manca (da fare)
- Raggi dei corpi per Pyro e Nyx: senza questi dati le tratte in quei sistemi restano "Teoriche".
- Raggio di ostruzione QT reale: NAVCOM usa raggio del corpo × margine (1,2 di default), che è una **stima**.
- Formato delle coordinate della Starmap: non ancora identificato, quindi la conversione non è implementata.

## Aggiunte 0.7.0 (8 novembre 2026)

| Fonte | Esito | Cosa offre | Limiti, licenza | Uso in NAVCOM |
|---|---|---|---|---|
| **scunpacked-data** `github.com/StarCitizenWiki/scunpacked-data` | ✅ Verificata (commit 4.10.2-LIVE.12881860, 2026-10-28) | `starmap_positions.json` (1.840 entità, i 739 non nascosti identici a CitizenHQ), `contracts/*.json` (pool di luoghi, ordini di trasporto, ricompense, grado), `trade_locations.json`, `ships.json`. | Nessun file LICENSE; dati di gioco di Cloud Imperium. Modelli, non offerte. | **Atlante**: luoghi, modelli di missione, navi. Vedi [ATLAS.md](ATLAS.md). |
| **CitizenHQ** missioni | ❌ Non verificata | Endpoint missioni non documentato pubblicamente. | — | Non usata. |
| **UEX Corp** `api.uexcorp.uk/2.0` | ✅ Verificata in GET senza token | Prezzi commodity, terminali. | Termini: solo uso personale non commerciale. | Non integrata (priorità al trasporto). |

