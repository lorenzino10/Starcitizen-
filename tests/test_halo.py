"""Aaron Halo: casi sintetici esatti + caso reale ARC-L1 -> CRU-L4 (fascia 5)."""
import json
from pathlib import Path

import pytest

from navcom.core.halo import BANDS, band_crossings, locate
from navcom.core.vector import Vec3, distance

GM = 1e9
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "stanton_arc_l1_cru_l4.json").read_text("utf-8"))


# ---- sintetici --------------------------------------------------------------
def test_radial_crossing_exact_values():
    # tratta radiale lungo x da 25 Gm a 15 Gm: i valori HUD sono differenze esatte
    a, b = Vec3(25 * GM, 0, 0), Vec3(15 * GM, 0, 0)
    (c,) = band_crossings(a, b, BANDS[5])
    assert c.enter_hud_m == pytest.approx(20_407_000_000 - 15 * GM)
    assert c.peak_hud_m == pytest.approx(20_320_000_000 - 15 * GM)
    assert c.exit_hud_m == pytest.approx(20_230_000_000 - 15 * GM)
    assert c.window_m == pytest.approx(177_000_000)
    assert c.within_height


def test_chord_through_belt_crosses_twice():
    # corda che entra ed esce dall'anello: due attraversamenti, simmetrici
    a, b = Vec3(-30 * GM, 20.3 * GM * 0.99, 0), Vec3(30 * GM, 20.3 * GM * 0.99, 0)
    cs = band_crossings(a, b, BANDS[5])
    assert len(cs) == 2
    assert cs[0].window_m == pytest.approx(cs[1].window_m)


def test_out_of_plane_crossing_flagged():
    a, b = Vec3(25 * GM, 0, 1e9), Vec3(15 * GM, 0, 1e9)
    assert all(not c.within_height for c in band_crossings(a, b, BANDS[5]))


def test_no_crossing_when_inside_belt_radius():
    assert band_crossings(Vec3(1 * GM, 0, 0), Vec3(2 * GM, 0, 0), BANDS[5]) == []


def test_locate():
    assert locate(Vec3(20_320_000_000, 0, 0))[0] == 5
    assert locate(Vec3(20_320_000_000, 0, 10_000_000))[0] is None   # 10.000 km fuori piano
    assert locate(Vec3(20_100_000_000, 0, 0))[0] is None            # vuoto fra fascia 3 e 4


# ---- caso reale ----------------------------------------------------------------
def _pts():
    p = FIXTURE["points"]
    return Vec3.of(p["ARC-L1"]["xyz_m"]), Vec3.of(p["CRU-L4"]["xyz_m"])


def test_arc_l1_to_cru_l4_band5_against_published():
    arc, cru = _pts()
    leg = distance(arc, cru)
    (c,) = band_crossings(arc, cru, BANDS[5])
    ref = FIXTURE["published"]
    # Lunghezza tratta: Cornerstone 24.001.764 km. Differenza attesa di qualche
    # migliaio di km per marker/versione diversi (vedi docs/AARON_HALO.md).
    assert abs(leg - ref["cornerstone_route_km"] * 1000) < 5_000_000
    # Picco fascia 5: Cornerstone 14.292.609 km; tolleranza 5.000 km (~3% della
    # larghezza della fascia), giustificata dalle diverse coordinate dei marker.
    assert abs(c.peak_hud_m - ref["cornerstone_band5_peak_km"] * 1000) < 5_000_000
    # SCMiner pubblica 14,3 Gm: il nostro picco arrotondato a 0,1 Gm deve coincidere
    assert round(c.peak_hud_m / GM, 1) == ref["scminer_band5_gm"]
    assert c.within_height
    # il valore SCMiner cade dentro la finestra calcolata
    assert c.exit_hud_m <= ref["scminer_band5_gm"] * GM <= c.enter_hud_m


def test_direction_sum_identity():
    # Nei due versi i valori di picco sommati danno la lunghezza della tratta
    arc, cru = _pts()
    (fw,) = band_crossings(arc, cru, BANDS[5])
    (bw,) = band_crossings(cru, arc, BANDS[5])
    assert fw.peak_hud_m + bw.peak_hud_m == pytest.approx(distance(arc, cru), rel=1e-12)
