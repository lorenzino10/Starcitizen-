"""Genera data/punti_interesse.xlsx: punti interessanti di Stanton, Pyro e Nyx, classificati.

Le coordinate NON sono inventate: vengono da dataset pubblici scaricati da
github.com/ByteCollectiveIO/sc-nav (cartella poi/):
  - locations.json  -> Star Citizen Wiki API (CC BY-SA 4.0), dati 4.10.1, posizioni nel sistema (metri)
  - containers.json -> starmap.space (dataset community): pianeti, lune, Lagrange, anello Glaciem
  - poi.json        -> starmap.space (dataset community): POI di superficie (grotte, relitti, avamposti...)
Si usano solo i DATI (fatti), non il codice di sc-nav (licenza PolyForm Noncommercial).

Frame: lo stesso di CitizenHQ e di /showlocation (stella in 0,0,0, metri). sc-nav ha ruotato Pyro di
-85,23 gradi; qui la rotazione viene annullata e il risultato e' confrontato con valori CitizenHQ
letti il 5/11/2026 (tabella CHECKS). Se un controllo supera 1 km lo script si ferma.

Uso:  python tools/build_punti_interesse.py [cartella_cache]
"""
from __future__ import annotations

import json
import math
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "punti_interesse.xlsx"
RAW = "https://raw.githubusercontent.com/ByteCollectiveIO/sc-nav/main/poi/"
FILES = ["locations.json", "containers.json", "poi.json"]

# Valori CitizenHQ (/api/v1/positions, dati 4.10.2-LIVE) letti il 5/11/2026: servono a verificare il frame.
CHECKS = {
    ("pyro", "Checkmate"): (1833362390.019977, 10434543320.869617, 2570930.841284),
    ("pyro", "Ruin Station"): (-52336834868.99303, -43917925431.95215, -100477.857041),
    ("pyro", "RMB-ALME"): (42338868740.25851, -7606962824.124603, -15720636.237855),
    ("pyro", "Cluster BGR-560"): (-13950732702.48942, -12467739749.081625, -700000000.0),
    ("nyx", "Levski"): (-9641669472.432566, -11490738598.66563, -93642.5508),
    ("stanton", "Mining Base #01K-I43"): (12909246446.652163, 56043919.787593, 0.0),
    ("stanton", "Mining Base #0YX-O7Z"): (18674230445.965664, -21975738292.257637, 0.0),
    ("stanton", "Mining Base #1XA-3GI"): (22516326770.05966, 37186055458.12117, 0.0),
    ("stanton", "CRU L2"): (-20858376485.43327, -2931474402.05844, 0.0),
}
SRC_WIKI = "Star Citizen Wiki API 4.10.1 (CC BY-SA 4.0) via sc-nav locations.json"
SRC_SMC = "starmap.space via sc-nav containers.json"
SRC_SMP = "starmap.space via sc-nav poi.json"

HEAD = ["Nome", "Sistema", "X", "Y", "Z", "Unità", "Categoria", "Risorsa", "Stato", "Note",
        "Gruppo", "Sottocategoria", "Corpo", "Latitudine", "Longitudine", "Altitudine (m)",
        "X locale (km)", "Y locale (km)", "Z locale (km)", "QT diretto", "Fonte", "Controllo CitizenHQ"]

# Gruppo -> (categoria NAVCOM, ordine, nome foglio)
GROUPS = {
    "Mining - Campi asteroidi Lagrange": ("Mining", 1, "M1 Asteroidi Lagrange"),
    "Mining - Basi minerarie su asteroide": ("Mining", 2, "M2 Basi minerarie asteroide"),
    "Mining - Cluster asteroidi QT": ("Mining", 3, "M3 Cluster asteroidi QT"),
    "Mining - Anello Glaciem e Keeger (Nyx)": ("Mining", 4, "M4 Glaciem Nyx"),
    "Grotte": (None, 5, "G Grotte"),
    "Relitti": ("Relitto", 6, "R Relitti"),
    "Derelict - insediamenti abbandonati": ("Esplorazione", 7, "D Derelict"),
    "Basi su asteroide (Pyro)": ("Esplorazione", 8, "B Basi asteroide Pyro"),
    "Bunker, basi e strutture sotterranee": ("Esplorazione", 9, "B Bunker e basi"),
    "Avamposti": ("Esplorazione", 10, "A Avamposti"),
    "Strutture speciali": ("Esplorazione", 11, "S Strutture speciali"),
    "Natura": ("Esplorazione", 12, "N Natura"),
    "Stazioni, gateway e città": ("Altro", 13, "C Stazioni e citta"),
    "Punti di Lagrange": ("Altro", 14, "L Punti di Lagrange"),
    "Pianeti e lune (centro)": ("Altro", 15, "P Pianeti e lune"),
    "Varie": ("Altro", 16, "V Varie"),
}
SYS = {"stanton": "Stanton", "pyro": "Pyro", "nyx": "Nyx"}


def load(cache: Path) -> dict:
    cache.mkdir(parents=True, exist_ok=True)
    out = {}
    for f in FILES:
        p = cache / f
        if not p.exists():
            urllib.request.urlretrieve(RAW + f, p)
        out[f] = json.loads(p.read_text(encoding="utf-8"))
    return out


def pyro_angle(locs) -> float:
    """Angolo che riporta il Pyro di sc-nav nel frame CitizenHQ, ricavato da Checkmate."""
    c = next(x["global_m"] for x in locs if x["system"] == "Pyro" and x["name"] == "Checkmate")
    h = CHECKS[("pyro", "Checkmate")]
    return math.atan2(h[1], h[0]) - math.atan2(c[1], c[0])


def to_chq(system: str, xyz, ang: float):
    x, y, z = (float(v) for v in xyz)
    if system == "pyro":
        x, y = x * math.cos(ang) - y * math.sin(ang), x * math.sin(ang) + y * math.cos(ang)
    return round(x, 1), round(y, 1), round(z, 1)


def row(**k) -> dict:
    r = {h: None for h in HEAD}
    r.update({"Unità": "m", "Stato": "Da verificare"}, **k)
    cat = GROUPS[r["Gruppo"]][0]
    r["Categoria"] = r.get("Categoria") or cat
    return r


def classify_surface(t: str, cls: str, name: str):
    """Tipo starmap.space -> (gruppo, sottocategoria) oppure None se va scartato."""
    c = (cls or "").strip()
    if t == "Cave":
        return "Grotte", c.split(",")[0] if c else "Grotta"
    if t == "Wreck" or c.startswith("Derelict Crash Site"):
        return "Relitti", c or "Relitto"
    if t in ("Derelict Outpost", "Derelict Settlement", "Abandoned Outpost"):
        return "Derelict - insediamenti abbandonati", t
    if t in ("Colonial Bunker", "Underground Facility", "Forward Operating Base", "Onyx Facility", "Druglab", "Prison"):
        return "Bunker, basi e strutture sotterranee", t
    if t in ("Outpost", "Colonial Outpost", "Security Outpost"):
        return "Avamposti", f"{t} - {c}" if c and c.lower() not in ("none", "not classified") else t
    if t in ("Comm Array", "Planetary Alignment Facility", "Orbital Laser Platform", "Ground Activation Platform",
             "Distribution Center", "Scrapyard", "Unknown"):
        return "Strutture speciali", "Mining Tower" if name.startswith("Mining Tower") else t
    if t in ("River", "Animal Area"):
        return "Natura", c or t
    if t in ("Landing Zone", "LandingZone", "Spaceport", "RestStop"):
        return "Stazioni, gateway e città", t
    if t in ("Racetrack", "Racetrack (Community)", "Easteregg"):
        return "Varie", t
    return None  # Mission Area, Object Container, Event, AsteroidBase (gia' dalla Wiki), voci tecniche


def build(data: dict):
    locs = data["locations.json"]["locations"]
    ang = pyro_angle(locs)
    rows, checks = [], []

    # ---- 1. Spazio: Wiki (posizioni globali)
    for x in locs:
        if x["global_m"] is None:
            continue
        s = x["system"].lower()
        n, t = x["name"].strip(), x["type"]
        X, Y, Z = to_chq(s, x["global_m"], ang)
        if t.startswith("Manmade"):
            g, sub = "Stazioni, gateway e città", "Stazione / gateway / città"
            if n.startswith("Wikelo"):
                sub = "Wikelo Emporium (baratto)"
        elif n.startswith(("Mining Base", "RMB-")):
            g, sub = "Mining - Basi minerarie su asteroide", "Base mineraria su asteroide"
        elif t == "Asteroid":  # CRU L2, PYR1 L1 ...
            g, sub = "Mining - Campi asteroidi Lagrange", "Campo asteroidi al punto di Lagrange"
        elif n.startswith("Cluster"):
            g, sub = "Mining - Cluster asteroidi QT", "Cluster di asteroidi"
        elif n.startswith(("RAB-", "PYAM-")):
            g, sub = "Basi su asteroide (Pyro)", "Rough & Ready asteroid base (RAB)" if n.startswith("RAB-") else "PYAM (struttura su asteroide)"
        else:
            g, sub = "Varie", t
        note = []
        if x["has_resources"]:
            note.append("Wiki: risorse presenti (has_resources, dati 4.8.2), tipo di minerale non indicato")
        elif g.startswith("Mining"):
            note.append("Wiki: nessun dato sulle risorse")
        if x.get("amenities"):
            note.append("Servizi: " + ", ".join(x["amenities"][:6]))
        rows.append(row(Nome=n, Sistema=SYS[s], X=X, Y=Y, Z=Z, Gruppo=g, Sottocategoria=sub,
                        Note="; ".join(note) or None, **{"QT diretto": "sì" if x["qt_valid"] else "no", "Fonte": SRC_WIKI}))

    space_xyz = defaultdict(list)
    for r in rows:
        space_xyz[r["Sistema"]].append((r["X"], r["Y"], r["Z"]))

    def near_existing(sysname, p, tol=1000.0):
        return any(math.dist(p, q) <= tol for q in space_xyz[sysname])

    # ---- 2. starmap.space containers: Lagrange, pianeti, Glaciem/Keeger
    for c in data["containers.json"]:
        s = c["System"].lower()
        if s not in SYS:
            continue
        t, n = c["Type"], c["ObjectContainer"].strip()
        p = to_chq(s, (c["XCoord"], c["YCoord"], c["ZCoord"]), ang)
        if p == (0.0, 0.0, 0.0) or t in ("Star", "Other", "Jumppoint", "AsteroidBase", "Refinery Station", "RestStop", "Naval Station"):
            continue  # stelle, duplicati di stazioni/gateway gia' presi dalla Wiki, voci senza coordinate
        if near_existing(SYS[s], p):
            continue
        if t in ("Lagrange", "Lagrange Point"):
            g, sub, nm = "Punti di Lagrange", "Punto di Lagrange (vuoto, senza stazione)", n.replace("_", " ")
        elif t == "Planet":
            g, sub, nm = "Pianeti e lune (centro)", f"Corpo celeste, raggio {c['BodyRadius']/1000:,.0f} km".replace(",", "."), n
        elif t == "AsteroidBelt":
            g = "Mining - Anello Glaciem e Keeger (Nyx)"
            if "keeger" in n.lower():
                sub = "Segmento Keeger (missioni)"
            elif "Mission" in n:
                sub = "Segmento Glaciem (missioni)"
            else:
                sub = "Segmento anello Glaciem"
            nm = n
        else:
            continue
        rows.append(row(Nome=nm, Sistema=SYS[s], X=p[0], Y=p[1], Z=p[2], Gruppo=g, Sottocategoria=sub,
                        Note=f"Nome interno {c['InternalName']}; {c['Comment']}" if c.get("Comment") else None,
                        Fonte=SRC_SMC))
        space_xyz[SYS[s]].append(p)

    # ---- 3. starmap.space POI: superficie (coordinate locali del corpo) + pochi relitti nello spazio
    for x in data["poi.json"]:
        s = x["System"].lower()
        if s not in SYS:
            continue
        n = " ".join(x["PoiName"].split())
        body = x["Planet"]
        if body == "Space":
            if x["Type"] == "Wreck" and s == "nyx":  # unici POI spaziali con coordinate di sistema plausibili
                p = to_chq(s, (x["XCoord"], x["YCoord"], x["ZCoord"]), ang)
                rows.append(row(Nome=n, Sistema=SYS[s], X=p[0], Y=p[1], Z=p[2], Gruppo="Relitti",
                                Sottocategoria="Relitto nello spazio", Fonte=SRC_SMP,
                                Note=f"Segnalato su starmap.space il {x['Submitted'][:10]}"))
            continue
        if n.startswith(("ObjectContainer", "RL_", "OC_")) or "(missing)" in n or "(old)" in n.lower():
            continue
        cl = classify_surface(x["Type"], x["Classification"] or "", n)
        if not cl:
            continue
        g, sub = cl
        minerals = (x["Minerals"] or "").strip() or None
        cat = ("Mining" if minerals else "Esplorazione") if g == "Grotte" else None
        note = [f"Superficie di {body}: QT su {body}, poi navigazione con lat/lon (le coordinate locali ruotano con il corpo)"]
        if x.get("NextQTMarker"):
            note.append(f"Marker QT vicino: {x['NextQTMarker']}")
        if x.get("SpecialLoot"):
            note.append(f"Loot: {x['SpecialLoot']}")
        if x.get("POI_Defenses") and x["POI_Defenses"] not in ("0", ""):
            note.append(f"Difese: {x['POI_Defenses']}")
        if x.get("Comment"):
            note.append(x["Comment"].strip())
        rows.append(row(Nome=f"{n} ({body})", Sistema=SYS[s], Gruppo=g, Sottocategoria=sub, Categoria=cat,
                        Risorsa=minerals, Corpo=body, Latitudine=x["Latitude"], Longitudine=x["Longitude"],
                        **{"Altitudine (m)": x["Height"], "X locale (km)": x["XCoord"], "Y locale (km)": x["YCoord"],
                           "Z locale (km)": x["ZCoord"], "Fonte": f"{SRC_SMP} (inserito {x['Submitted'][:10]})"},
                        Note="; ".join(note)))

    # ---- nomi unici per sistema (NAVCOM considera duplicati i nomi uguali)
    seen = Counter()
    for r in rows:
        key = (r["Sistema"], r["Nome"].lower())
        seen[key] += 1
        if seen[key] > 1:
            r["Nome"] = f"{r['Nome']} #{seen[key]}"

    # ---- controllo frame contro CitizenHQ
    by = {(r["Sistema"].lower(), r["Nome"]): r for r in rows}
    for (s, n), h in CHECKS.items():
        r = by[(s, n)]
        d = math.dist((r["X"], r["Y"], r["Z"]), h)
        checks.append((SYS[s], n, d))
        r["Controllo CitizenHQ"] = f"OK, scarto {d:,.0f} m (05/11/2026)".replace(",", ".")
        if d > 1000:
            raise SystemExit(f"Controllo frame fallito per {n}: {d:.0f} m")

    rows.sort(key=lambda r: (GROUPS[r["Gruppo"]][1], ["Stanton", "Pyro", "Nyx"].index(r["Sistema"]), r["Corpo"] or "", r["Nome"]))
    return rows, checks, math.degrees(ang)


HFILL = PatternFill("solid", fgColor="1F3A5F")
HFONT = Font(bold=True, color="FFFFFF")
WIDTH = {"Nome": 42, "Note": 60, "Gruppo": 30, "Sottocategoria": 34, "Fonte": 46, "Controllo CitizenHQ": 26, "Risorsa": 26}


def write_table(ws, rows):
    ws.append(HEAD)
    for c in ws[1]:
        c.fill, c.font = HFILL, HFONT
    for r in rows:
        ws.append([r[h] for h in HEAD])
    for i, h in enumerate(HEAD, 1):
        ws.column_dimensions[get_column_letter(i)].width = WIDTH.get(h, 14)
    for col in ("C", "D", "E"):
        for c in ws[col][1:]:
            c.number_format = "0"
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = ws.dimensions


def main():
    cache = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".cache" / "sc-nav"
    rows, checks, deg = build(load(cache))
    space = [r for r in rows if r["X"] is not None]
    surf = [r for r in rows if r["X"] is None]

    wb = Workbook()
    ws = wb.active
    ws.title = "Riepilogo"
    ws.append(["PUNTI INTERESSANTI - Stanton, Pyro, Nyx (generato il 05/11/2026)"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append(["Ogni foglio ha le colonne dell'import DATABASE PUNTI di NAVCOM (Nome, Sistema, X, Y, Z, Unità, Categoria, Risorsa, Stato, Note) + colonne extra ignorate dall'import."])
    ws.append(["Coordinate in METRI, frame di sistema (stella in 0,0,0) = CitizenHQ e /showlocation. Stato di tutte le righe: Da verificare."])
    ws.append(["I punti di superficie NON hanno X/Y/Z di sistema (il corpo ruota): entrano come schede incomplete, con lat/lon e coordinate locali nelle colonne extra."])
    ws.append([])
    ws.append(["Gruppo", "Foglio", "Categoria NAVCOM", "Stanton", "Pyro", "Nyx", "Totale", "Con XYZ di sistema"])
    for c in ws[6]:
        c.fill, c.font = HFILL, HFONT
    for g, (cat, _, sheet) in sorted(GROUPS.items(), key=lambda kv: kv[1][1]):
        gr = [r for r in rows if r["Gruppo"] == g]
        if not gr:
            continue
        cnt = Counter(r["Sistema"] for r in gr)
        cats = sorted({r["Categoria"] for r in gr})
        ws.append([g, sheet, " / ".join(cats), cnt["Stanton"], cnt["Pyro"], cnt["Nyx"], len(gr), sum(r["X"] is not None for r in gr)])
    ws.append(["TOTALE", "", "", *(sum(r["Sistema"] == s for r in rows) for s in ("Stanton", "Pyro", "Nyx")), len(rows), len(space)])
    ws[ws.max_row][0].font = Font(bold=True)
    for col, w in zip("ABCDEFGH", (40, 28, 26, 10, 10, 10, 10, 18)):
        ws.column_dimensions[col].width = w

    write_table(wb.create_sheet("TUTTI spazio XYZ"), [r for r in space if not r["Gruppo"].startswith("Mining - Anello")])
    for g, (_, _, sheet) in sorted(GROUPS.items(), key=lambda kv: kv[1][1]):
        gr = [r for r in rows if r["Gruppo"] == g]
        if gr:
            write_table(wb.create_sheet(sheet), gr)

    f = wb.create_sheet("Fonti e avvertenze")
    lines = [
        ["FONTI"],
        ["Star Citizen Wiki API (api.star-citizen.wiki), dati di gioco 4.10.1-LIVE, CC BY-SA 4.0: stazioni, gateway, basi su asteroide, campi asteroidi, cluster. Risorse (has_resources) dai dati 4.8.2."],
        ["starmap.space (dataset community): pianeti, lune, punti di Lagrange, segmenti degli anelli di Nyx, POI di superficie (grotte, relitti, avamposti, bunker...). La maggior parte dei POI è stata inserita ad agosto 2026."],
        ["Entrambi letti dal repository github.com/ByteCollectiveIO/sc-nav (cartella poi/). Usati solo i dati, non il codice (licenza PolyForm Noncommercial)."],
        ["CitizenHQ (citizenhq.space/api/v1, dati 4.10.2-LIVE): usata come riferimento del frame. Controlli a campione nella tabella sotto."],
        [],
        ["FRAME E CONVERSIONI"],
        [f"Pyro: sc-nav ruota i dati della Wiki di -85,23°. Qui la rotazione è stata annullata (+{deg:.7f}°, ricavata da Checkmate) per tornare al frame di CitizenHQ."],
        ["Stanton e Nyx: nessuna conversione, i dati coincidono con CitizenHQ."],
        ["Arrotondamento: 0,1 m."],
        [],
        ["CONTROLLI A CAMPIONE CONTRO CITIZENHQ (05/11/2026)"],
        ["Sistema", "Punto", "Scarto (m)"],
        *[[s, n, round(d, 1)] for s, n, d in checks],
        [],
        ["AVVERTENZE (leggile prima di fidarti)"],
        ["1. Stato 'Da verificare' ovunque: nessun punto è stato visitato in gioco. Mettilo 'Verificato' solo dopo /showlocation sul posto."],
        ["2. Superficie: le X/Y/Z locali (km) sono nel frame del corpo, che RUOTA. Non sono convertibili in coordinate di sistema fisse: NAVCOM le importa come schede incomplete (niente CALCOLA ROTTA). Usa QT sul corpo, poi lat/lon/altitudine."],
        ["3. Risorse: la Wiki dice solo SE un campo ha risorse, non QUALI. Le grotte hanno il minerale solo in 35 casi su ~800 (dato starmap.space). Composizione reale: scanner in gioco o SCMiner/UEX."],
        ["4. Mining Base #... (Stanton) e RMB-... (Pyro): nome e tipo dalla Wiki (Asteroid, has_resources). Che cosa siano esattamente in gioco (base, cluster, campo) va confermato sul posto."],
        ["5. Cluster ... (Pyro) e RAB-...: QT valido secondo la Wiki; per i cluster la Wiki non dichiara risorse."],
        ["6. Anello Glaciem/Keeger: ogni riga è il centro di un segmento dell'anello (contenitore di gioco), non un singolo asteroide. Non tutti sono raggiungibili con QT diretto."],
        ["7. Punti di Lagrange 'vuoti': sono il punto teorico, non una destinazione QT selezionabile."],
        ["8. Dati 4.10.x: con la 4.11 nomi e posizioni possono cambiare. Rigenera con: python tools/build_punti_interesse.py"],
        ["9. Doppioni in import: NAVCOM unisce per nome o per coordinate entro 1 m nello stesso sistema. I nomi ripetuti qui hanno il suffisso #2, #3... I fogli per gruppo ripetono le righe di 'TUTTI spazio XYZ': se importi entrambi, i doppioni vengono ignorati."],
    ]
    for ln in lines:
        f.append(ln)
    for i in (1, 7, 12, 16):
        f.cell(i, 1).font = Font(bold=True)
    f.column_dimensions["A"].width = 18
    f.column_dimensions["B"].width = 30
    for r in f.iter_rows():
        r[0].alignment = Alignment(wrap_text=False)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"{OUT}: {len(rows)} punti ({len(space)} con XYZ di sistema), rotazione Pyro {deg:.7f} gradi")
    for s, n, d in checks:
        print(f"  check {s:8s} {n:28s} {d:10.1f} m")
    print(Counter(r["Gruppo"] for r in rows))


if __name__ == "__main__":
    main()
