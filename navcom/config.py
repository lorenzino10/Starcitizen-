"""Percorsi e impostazioni dell'applicazione."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("NAVCOM_DATA_DIR", ROOT / "dati"))
DB_PATH = DATA_DIR / "navcom.sqlite3"

# Margine applicato al raggio dei corpi celesti nel controllo ostacoli.
# E' una STIMA: il raggio di ostruzione reale usato dal gioco non e' noto.
DEFAULT_OBSTRUCTION_MARGIN = 1.2
# Decimali che si presume l'HUD mostri durante il QT (da confermare in gioco).
DEFAULT_HUD_DECIMALS = 1
