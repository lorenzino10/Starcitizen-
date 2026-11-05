"""STAR CITIZEN NAVCOM — interfaccia Streamlit.

Avvio:  streamlit run navcom_app.py   (oppure avvia_navcom.bat su Windows)
L'interfaccia non contiene calcoli: usa solo navcom.services e navcom.core.
"""
from __future__ import annotations

import json

import pandas as pd
import streamlit as st

from navcom import __version__
from navcom.config import DB_PATH, DEFAULT_HUD_DECIMALS, DEFAULT_OBSTRUCTION_MARGIN
from navcom.core.halo import BANDS, HALO_SOURCE
from navcom.core.qt import NavPoint, RouteStatus
from navcom.core.units import fmt_auto, fmt_km, hud_reading, hud_resolution_m
from navcom.core.vector import Vec3, distance
from navcom.data import citizenhq
from navcom.data.bodies import load_seed, obstruction_model
from navcom.data.models import SYSTEMS
from navcom.db.database import Database
from navcom.services.planner import halo_options, import_system, nav_points, plan_to_target
from navcom.ui import plots

st.set_page_config(page_title="NAVCOM", page_icon="🛰", layout="wide")

st.markdown("""
<style>
.block-container {padding-top: 1.2rem;}
h1, h2, h3 {letter-spacing: .12em; text-transform: uppercase; color: #3fd0ff;}
div[data-testid="stMetricValue"] {font-family: Consolas, monospace; color: #5dff9d;}
.navbox {border: 1px solid #1d4466; border-left: 4px solid #3fd0ff; background: #0b1622;
         padding: .8rem 1rem; margin: .4rem 0; border-radius: 4px; font-family: Consolas, monospace;}
.navbox.warn {border-left-color: #ffb347;}
.navbox.bad {border-left-color: #ff5f6d;}
.big {font-size: 1.6rem; color: #ffb347; font-weight: bold;}
.stButton>button {letter-spacing: .15em; font-weight: bold; border: 1px solid #3fd0ff;}
</style>
""", unsafe_allow_html=True)

STATUS_ICON = {RouteStatus.VERIFIED.value: "🟢", RouteStatus.DATA_SUPPORTED.value: "🔵",
               RouteStatus.THEORETICAL.value: "🟠"}


@st.cache_resource
def get_db() -> Database:
    return Database(DB_PATH)


db = get_db()

# ---------------------------------------------------------------- sidebar
with st.sidebar:
    st.markdown(f"## 🛰 NAVCOM\n<small>v{__version__}</small>", unsafe_allow_html=True)
    system = st.selectbox("Sistema stellare", SYSTEMS, format_func=str.capitalize)
    counts = db.counts()
    st.caption(f"Posizioni in archivio per {system.capitalize()}: **{counts.get(system, 0)}**")
    if st.button("⟳ Importa / aggiorna dati", use_container_width=True):
        with st.spinner(f"Scarico le posizioni di {system} da CitizenHQ…"):
            rep = import_system(db, system)
        if rep.ok:
            st.success(f"{rep.stored} posizioni salvate. Versione dati: {rep.game_version or 'non nota'}. "
                       f"Senza coordinate: {rep.skipped_no_coords}, scartate: {rep.skipped_invalid}.")
        else:
            st.error("Import fallito, i dati precedenti restano in archivio: " + "; ".join(rep.errors))
        for w in rep.warnings:
            st.caption(f"⚠ {w}")
    st.divider()
    st.markdown("**Impostazioni di calcolo**")
    margin = st.slider("Margine ostacoli (× raggio corpo)", 1.0, 2.0, DEFAULT_OBSTRUCTION_MARGIN, 0.05,
                       help="Stima: il raggio di ostruzione reale del gioco non e' pubblicato.")
    hud_dec = st.number_input("Decimali mostrati dall'HUD", 0, 3, DEFAULT_HUD_DECIMALS,
                              help="Da confermare in gioco: serve solo a mostrare la lettura attesa.")
    qt_speed = st.number_input("Velocità QT di crociera (Mm/s, opzionale)", 0.0, 1000.0, 0.0, 1.0,
                               help="Se indicata, stima la durata delle finestre. Accelerazione e "
                                    "decelerazione NON sono modellate.")
    st.caption(citizenhq.ATTRIBUTION)

points = nav_points(db, system)
if not points:
    st.title("STAR CITIZEN NAVCOM")
    st.warning(f"Nessuna posizione in archivio per {system.capitalize()}. Premi **Importa / aggiorna dati** "
               "nella barra laterale (serve Internet solo la prima volta).")
    st.stop()

model = obstruction_model(system, margin)
sorted_pts = sorted(points.values(), key=lambda p: (not p.qt_valid, p.name.lower()))
qt_pts = [p for p in sorted_pts if p.qt_valid]


def label(p: NavPoint) -> str:
    return f"{p.name}{'' if p.qt_valid else '  (non QT)'}"


def xyz_input(prefix: str) -> Vec3:
    unit = st.radio("Unità", ["km", "m"], horizontal=True, key=f"{prefix}_unit")
    k = 1000.0 if unit == "km" else 1.0
    c1, c2, c3 = st.columns(3)
    x = c1.number_input("X", value=0.0, format="%.3f", key=f"{prefix}_x")
    y = c2.number_input("Y", value=0.0, format="%.3f", key=f"{prefix}_y")
    z = c3.number_input("Z", value=0.0, format="%.3f", key=f"{prefix}_z")
    return Vec3(x * k, y * k, z * k)


def hud_text(m: float) -> str:
    res = hud_resolution_m(m, hud_dec)
    return f"{hud_reading(m, hud_dec)}  (un passo dell'ultima cifra = {fmt_auto(res)})"


st.title("STAR CITIZEN NAVCOM")
tab_route, tab_halo, tab_points, tab_saved, tab_data = st.tabs(
    ["🧭 ROTTA", "☄ AARON HALO", "📍 PUNTI PERSONALI", "💾 ROTTE SALVATE", "🗄 DATI E FONTI"])

# ---------------------------------------------------------------- ROTTA
with tab_route:
    left, right = st.columns([1, 2])
    with left:
        st.subheader("Partenza")
        start = st.selectbox("Posizione di partenza", sorted_pts, format_func=label, key="r_start")
        st.subheader("Destinazione")
        mode = st.radio("Tipo", ["Punto ufficiale", "Punto personale", "Coordinate XYZ", "Starmap"],
                        horizontal=True)
        target: Vec3 | None = None
        target_name = ""
        if mode == "Punto ufficiale":
            t = st.selectbox("Destinazione", [p for p in sorted_pts if not p.key.startswith("cp:")],
                             format_func=label, key="r_dest")
            target, target_name = t.pos, t.name
        elif mode == "Punto personale":
            cps = [p for p in sorted_pts if p.key.startswith("cp:")]
            if cps:
                t = st.selectbox("Punto personale", cps, format_func=label)
                target, target_name = t.pos, t.name
            else:
                st.info("Nessun punto personale per questo sistema: aggiungilo nella scheda PUNTI PERSONALI.")
        elif mode == "Coordinate XYZ":
            st.caption("Coordinate nel frame della griglia di sistema (stessa origine dei dati importati).")
            target = xyz_input("r")
            target_name = "Coordinate personalizzate"
        else:
            st.warning("Modalità Starmap: formato, unità e origine dei valori della Starmap non sono ancora "
                       "stati verificati, quindi la conversione in XYZ non è definita e NON viene calcolata. "
                       "Puoi registrare le letture nella scheda PUNTI PERSONALI.")
        go_btn = st.button("▶ CALCOLA ROTTA", type="primary", use_container_width=True,
                           disabled=target is None)
        include_blocked = st.checkbox("Mostra anche tratte bloccate da corpi celesti")

    if go_btn and target is not None:
        res, _ = plan_to_target(db, system, start, target, margin, include_blocked)
        st.session_state["route"] = dict(start=start, target=target, target_name=target_name, res=res)

    with right:
        r = st.session_state.get("route")
        if not r:
            st.info("Scegli partenza e destinazione, poi premi CALCOLA ROTTA.")
        else:
            res, tgt = r["res"], r["target"]
            direct = distance(r["start"].pos, tgt)
            m1, m2, m3 = st.columns(3)
            m1.metric("Volo convenzionale diretto", fmt_auto(direct))
            m2.metric("Tratte QT utili", len(res))
            if res:
                m3.metric("Miglior residuo", fmt_auto(res[0].residual_m))
            if not res:
                st.warning("Nessuna tratta QT dai marker noti avvicina il bersaglio. Unica opzione: volo convenzionale.")
            else:
                df = pd.DataFrame([{
                    "#": i + 1,
                    "Stato": f"{STATUS_ICON[x.status.value]} {x.status.value}",
                    "Destinazione QT": x.dest.name,
                    "Interrompi a (HUD verso dest.)": fmt_km(x.hud_remaining_m) if x.needs_manual_drop else "— arrivo",
                    "Distanza QT": fmt_auto(x.qt_travel_m),
                    "Residuo convenzionale": fmt_auto(x.residual_m),
                    "Risparmio": fmt_auto(x.gain_m),
                    "Ostacoli": ", ".join(o.body for o in x.obstructions) or "—",
                } for i, x in enumerate(res[:50])])
                st.dataframe(df, hide_index=True, height=260)
                pick = st.selectbox("Dettaglio tratta", range(min(50, len(res))),
                                    format_func=lambda i: f"#{i+1} {res[i].dest.name}")
                x = res[pick]
                cls = "bad" if x.blocked else "warn" if x.status is RouteStatus.THEORETICAL else ""
                steps = [f"1. Partenza: <b>{x.start.name}</b>",
                         f"2. Imposta destinazione QT <b>{x.dest.name}</b> e salta (tratta {fmt_km(x.leg_length_m)})"]
                if x.needs_manual_drop:
                    steps.append(f"3. Interrompi il salto quando la distanza verso {x.dest.name} è "
                                 f"<span class='big'>{fmt_km(x.hud_remaining_m)}</span><br>"
                                 f"&nbsp;&nbsp;&nbsp;lettura HUD attesa: {hud_text(x.hud_remaining_m)}")
                else:
                    steps.append("3. Nessuna interruzione: completa il salto")
                steps.append(f"4. Volo convenzionale verso <b>{r['target_name']}</b>: {fmt_km(x.residual_m)}")
                notes = "".join(f"<br>⚠ {n}" for n in x.notes)
                st.markdown(f"<div class='navbox {cls}'>{STATUS_ICON[x.status.value]} <b>{x.status.value}</b><br>"
                            + "<br>".join(steps) + notes + "</div>", unsafe_allow_html=True)
                st.caption("Distanze HUD calcolate geometricamente dai dati. Non includono tempo di reazione, "
                           "decelerazione del motore QT né l'eventuale distanza di arrivo del marker.")
                if qt_speed > 0 and x.needs_manual_drop:
                    st.caption(f"Stima a velocità costante {qt_speed:.0f} Mm/s: un errore di 1 s "
                               f"all'interruzione sposta il punto di ~{fmt_auto(qt_speed * 1e6)}.")
                mode_plot = st.radio("Vista", ["2D", "3D"], horizontal=True, key="route_view")
                fig = plots.system_figure(
                    list(points.values()), model.bodies,
                    segments=[(x.start.pos, x.dest.pos, "Tratta QT", plots.CYAN),
                              (x.drop_point, tgt, "Volo convenzionale", plots.GREEN)],
                    marks=[(x.start.pos, "Partenza", plots.CYAN, "circle"),
                           (x.drop_point, "Interruzione", plots.AMBER, "x"),
                           (tgt, "Bersaglio", plots.GREEN, "star")],
                    mode=mode_plot)
                st.plotly_chart(fig)
                c1, c2 = st.columns(2)
                with c1:
                    name = st.text_input("Nome rotta", value=f"{x.start.name} → {r['target_name']}")
                    if st.button("💾 Salva rotta"):
                        payload = {
                            "start": {"key": x.start.key, "name": x.start.name, "xyz_m": x.start.pos.as_tuple()},
                            "qt_dest": {"key": x.dest.key, "name": x.dest.name, "xyz_m": x.dest.pos.as_tuple()},
                            "target": {"name": r["target_name"], "xyz_m": tgt.as_tuple()},
                            "drop_point_xyz_m": x.drop_point.as_tuple(),
                            "hud_remaining_m": x.hud_remaining_m, "qt_travel_m": x.qt_travel_m,
                            "residual_m": x.residual_m, "leg_length_m": x.leg_length_m,
                            "status": x.status.value, "notes": x.notes,
                            "obstruction_margin": margin,
                        }
                        rid = db.save_route(name, system, payload)
                        st.success(f"Rotta salvata (#{rid}).")
                with c2:
                    st.write("")
                    if x.status is not RouteStatus.VERIFIED and st.button("✔ Ho provato questa tratta in gioco"):
                        db.mark_verified(x.start.key, x.dest.key, system)
                        st.success("Tratta segnata come verificata. Ricalcola per aggiornare lo stato.")

# ---------------------------------------------------------------- AARON HALO
with tab_halo:
    if system != "stanton":
        st.info("L'Aaron Halo è in Stanton: seleziona Stanton nella barra laterale.")
    else:
        c1, c2 = st.columns([1, 2])
        with c1:
            h_start = st.selectbox("Partenza", qt_pts, format_func=label, key="h_start")
            band = st.select_slider("Fascia", list(BANDS), value=5)
            b = BANDS[band]
            st.caption(f"Fascia {band}: {fmt_km(b.inner_m)} – {fmt_km(b.outer_m)} dal centro di Stanton, "
                       f"picco {fmt_km(b.peak_m)}, semi-altezza ±{fmt_km(b.half_height_m)}")
            which = st.radio("Destinazione QT", ["Trova le migliori", "Scegli io"], horizontal=True)
            h_dest = None
            if which == "Scegli io":
                h_dest = st.selectbox("Destinazione", [p for p in qt_pts if p.key != h_start.key],
                                      format_func=label, key="h_dest").key
            h_go = st.button("▶ CALCOLA INTERRUZIONE", type="primary", use_container_width=True)
            st.caption(f"Fasce: {HALO_SOURCE}. Metodo alternativo sempre valido: nella Starmap guarda la "
                       f"distanza dal marker di Stanton ed esci a {fmt_km(b.peak_m)}.")
        if h_go:
            st.session_state["halo"] = (h_start, band, halo_options(db, h_start, band, margin, h_dest))
        with c2:
            hs = st.session_state.get("halo")
            if hs:
                hstart, hband, opts = hs
                if not opts:
                    st.warning("Nessuna tratta da questa partenza attraversa la fascia scelta entro la sua altezza.")
                else:
                    rows = []
                    for o in opts[:40]:
                        c = o.crossing
                        row = {"Stato": f"{STATUS_ICON[o.status]} {o.status}", "Destinazione QT": o.dest.name,
                               "HUD ingresso": fmt_km(c.enter_hud_m),
                               "HUD picco": fmt_km(c.peak_hud_m) if c.peak_hud_m is not None else "—",
                               "HUD uscita": fmt_km(c.exit_hud_m), "Finestra": fmt_auto(c.window_m),
                               "z (km)": f"{c.z_enter_m/1000:,.0f}"}
                        if qt_speed > 0:
                            row["Finestra (s, stima)"] = f"{c.window_seconds(qt_speed * 1e6):.1f}"
                        rows.append(row)
                    st.dataframe(pd.DataFrame(rows), hide_index=True, height=260)
                    i = st.selectbox("Dettaglio", range(len(rows)), format_func=lambda k: opts[k].dest.name)
                    o = opts[i]
                    c = o.crossing
                    aim = c.peak_hud_m if c.peak_hud_m is not None else (c.enter_hud_m + c.exit_hud_m) / 2
                    notes = "".join(f"<br>⚠ {n}" for n in o.notes)
                    st.markdown(
                        f"<div class='navbox'>Imposta destinazione <b>{o.dest.name}</b> e salta.<br>"
                        f"Entri nella fascia {hband} a <b>{fmt_km(c.enter_hud_m)}</b>, ne esci a "
                        f"<b>{fmt_km(c.exit_hud_m)}</b>.<br>Bersaglio (picco di densità): "
                        f"<span class='big'>{fmt_km(aim)}</span><br>Lettura HUD attesa: {hud_text(aim)}"
                        f"{notes}</div>", unsafe_allow_html=True)
                    P = lambda t: o.start.pos + (o.dest.pos - o.start.pos) * t  # noqa: E731
                    fig = plots.system_figure(
                        qt_pts, model.bodies,
                        segments=[(o.start.pos, o.dest.pos, "Tratta QT", plots.CYAN)],
                        marks=[(o.start.pos, "Partenza", plots.CYAN, "circle"),
                               (P(c.t_enter), "Ingresso", plots.GREEN, "triangle-up"),
                               (P(c.t_exit), "Uscita", plots.RED, "triangle-down")],
                        rings_m=[(BANDS[hband].inner_m, f"Fascia {hband} interno"),
                                 (BANDS[hband].outer_m, f"Fascia {hband} esterno")],
                        mode=st.radio("Vista", ["2D", "3D"], horizontal=True, key="halo_view"))
                    st.plotly_chart(fig)
                    if st.button("💾 Salva questa interruzione"):
                        rid = db.save_route(f"Halo F{hband}: {o.start.name} → {o.dest.name}", "stanton", {
                            "type": "aaron_halo", "band": hband, "start": o.start.name, "qt_dest": o.dest.name,
                            "enter_hud_m": c.enter_hud_m, "peak_hud_m": c.peak_hud_m, "exit_hud_m": c.exit_hud_m,
                            "window_m": c.window_m, "status": o.status, "band_source": HALO_SOURCE})
                        st.success(f"Salvata (#{rid}).")

# ---------------------------------------------------------------- PUNTI PERSONALI
with tab_points:
    c1, c2 = st.columns(2)
    with c1:
        st.subheader("Nuovo punto XYZ")
        with st.form("cp_form", clear_on_submit=False):
            cp_name = st.text_input("Nome")
            cp_xyz = xyz_input("cp")
            cp_notes = st.text_area("Note", height=70)
            if st.form_submit_button("Salva punto") and cp_name.strip():
                db.add_custom_point(cp_name.strip(), system, cp_xyz.x, cp_xyz.y, cp_xyz.z, cp_notes)
                st.success("Punto salvato.")
                st.rerun()
        st.subheader("Lettura dalla Starmap (solo archivio)")
        st.caption("Registra i valori così come li leggi nella Starmap del gioco (testo libero, con unità). "
                   "Vengono conservati grezzi: la conversione in XYZ verrà attivata solo dopo aver verificato "
                   "formato, unità, origine e sistema di riferimento.")
        with st.form("sm_form"):
            sm_name = st.text_input("Nome lettura")
            sm_raw = st.text_area("Valori letti (una riga per campo, es. 'Distanza: 12.3 Gm')", height=100)
            sm_notes = st.text_input("Contesto (dove ti trovavi, cosa era selezionato)")
            if st.form_submit_button("Archivia lettura") and sm_name.strip():
                raw = {f"riga_{i+1}": line for i, line in enumerate(sm_raw.splitlines()) if line.strip()}
                db.add_starmap_reading(sm_name.strip(), system, raw, sm_notes)
                st.success("Lettura archiviata.")
    with c2:
        st.subheader("Punti personali")
        cps = db.custom_points(system)
        if not cps:
            st.caption("Nessun punto.")
        for p in cps:
            with st.expander(f"★ {p['name']}"):
                st.code(f"X {p['x']:.3f} m\nY {p['y']:.3f} m\nZ {p['z']:.3f} m", language=None)
                if p["notes"]:
                    st.write(p["notes"])
                if st.button("Elimina", key=f"del_cp_{p['id']}"):
                    db.delete_custom_point(p["id"])
                    st.rerun()
        st.subheader("Letture Starmap archiviate")
        for s in db.starmap_readings(system):
            with st.expander(f"{s['name']}  ·  {s['created_at']}"):
                st.json(json.loads(s["raw_values"]))
                st.caption(s["notes"] or "")

# ---------------------------------------------------------------- ROTTE SALVATE
with tab_saved:
    saved = db.saved_routes(system)
    if not saved:
        st.caption("Nessuna rotta salvata per questo sistema.")
    for s in saved:
        p = json.loads(s["payload"])
        with st.expander(f"{s['name']}  ·  {s['created_at']}"):
            if "hud_remaining_m" in p:
                st.markdown(f"Salta verso **{p['qt_dest']['name']}**, interrompi a **{fmt_km(p['hud_remaining_m'])}**, "
                            f"poi volo convenzionale {fmt_km(p['residual_m'])}. Stato: {p['status']}")
            elif p.get("type") == "aaron_halo":
                peak = p.get("peak_hud_m")
                st.markdown(f"Fascia {p['band']}: salta verso **{p['qt_dest']}**, interrompi fra "
                            f"{fmt_km(p['enter_hud_m'])} e {fmt_km(p['exit_hud_m'])}"
                            + (f" (picco {fmt_km(peak)})" if peak else ""))
            st.json(p, expanded=False)
            if st.button("Elimina", key=f"del_r_{s['id']}"):
                db.delete_saved_route(s["id"])
                st.rerun()

# ---------------------------------------------------------------- DATI E FONTI
with tab_data:
    st.subheader("Posizioni in archivio")
    rows = db.locations(system)
    df = pd.DataFrame([{"Nome": r["name"], "Tipo": r["type"], "QT": "sì" if r["qt_valid"] else "no",
                        "X (km)": r["x"] / 1000, "Y (km)": r["y"] / 1000, "Z (km)": r["z"] / 1000,
                        "Fonte": r["source"], "Versione gioco": r["game_version"] or "n.d.",
                        "Importato": r["imported_at"]} for r in rows])
    q = st.text_input("Filtra per nome")
    if q:
        df = df[df["Nome"].str.contains(q, case=False, na=False)]
    st.dataframe(df, hide_index=True, height=320)
    st.subheader("Storico importazioni")
    hist = db.import_history()
    st.dataframe(pd.DataFrame([{"Quando": h["at"], "Fonte": h["source"], "Sistema": h["system"],
                                "Esito": "ok" if h["ok"] else "ERRORE", "Salvate": h["stored"],
                                "Versione": h["game_version"], "Dettagli": h["details"]} for h in hist]),
                 hide_index=True)
    st.subheader("Corpi celesti per il controllo ostacoli")
    seed = load_seed(system)
    if seed:
        st.caption(f"Fonte: {seed['_meta']['source']}. Conflitti noti: " + "; ".join(seed["_meta"]["known_conflicts"]))
    else:
        st.warning("Nessun dato sui corpi celesti per questo sistema: tutte le tratte risultano 'Teoriche'.")
    st.markdown("**Legenda stati**: 🟢 verificata nel gioco (segnata da te) · 🔵 supportata dai dati "
                "(marker QT da fonte, nessun ostacolo noto) · 🟠 teorica, da verificare.")
