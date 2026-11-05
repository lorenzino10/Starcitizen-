"""Confronto Aaron Halo ARC-L1 -> CRU-L4 (fascia 5) con i valori pubblicati.

Uso:  python tools/aaron_halo_report.py
Calcola i valori con il motore NAVCOM partendo dalle sole coordinate della
fixture e li confronta con SCMiner e Cornerstone.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from navcom.core.halo import BANDS, band_crossings  # noqa: E402
from navcom.core.units import fmt_km, hud_reading  # noqa: E402
from navcom.core.vector import Vec3, distance  # noqa: E402

fx = json.loads((ROOT / "tests" / "fixtures" / "stanton_arc_l1_cru_l4.json").read_text("utf-8"))
arc = Vec3.of(fx["points"]["ARC-L1"]["xyz_m"])
cru = Vec3.of(fx["points"]["CRU-L4"]["xyz_m"])
pub = fx["published"]

leg = distance(arc, cru)
(fw,) = band_crossings(arc, cru, BANDS[5])
(bw,) = band_crossings(cru, arc, BANDS[5])

print("ARC-L1 -> CRU-L4, fascia 5 (coordinate CitizenHQ 4.10.2)")
print(f"  lunghezza tratta       NAVCOM {fmt_km(leg):>16}  Cornerstone {pub['cornerstone_route_km']:,} km"
      f"  diff {leg/1000 - pub['cornerstone_route_km']:+,.0f} km")
print(f"  HUD ingresso fascia    NAVCOM {fmt_km(fw.enter_hud_m):>16}")
print(f"  HUD picco densita'     NAVCOM {fmt_km(fw.peak_hud_m):>16}  Cornerstone {pub['cornerstone_band5_peak_km']:,} km"
      f"  diff {fw.peak_hud_m/1000 - pub['cornerstone_band5_peak_km']:+,.0f} km")
print(f"  HUD uscita fascia      NAVCOM {fmt_km(fw.exit_hud_m):>16}")
print(f"  lettura HUD (1 dec.)   NAVCOM {hud_reading(fw.peak_hud_m):>16}  SCMiner {pub['scminer_band5_gm']} Gm")
print(f"  finestra nella fascia  NAVCOM {fmt_km(fw.window_m):>16}  (SCMiner 'margin' 345 Mm, definizione non pubblicata)")
print(f"  z ingresso/uscita      {fw.z_enter_m/1000:,.0f} km / {fw.z_exit_m/1000:,.0f} km (semi-altezza fascia 4.998 km)")
print(f"  verso opposto, picco   NAVCOM {fmt_km(bw.peak_hud_m):>16}  Cornerstone {pub['cornerstone_reverse_band5_peak_km']:,} km")
print(f"  identita' somma        {fmt_km(fw.peak_hud_m + bw.peak_hud_m)} = lunghezza tratta {fmt_km(leg)}")
