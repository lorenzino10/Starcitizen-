"""Archivio locale SQLite: posizioni importate, punti personali, letture
Starmap, tratte verificate e rotte salvate. Funziona offline dopo il primo
import."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from ..data.models import ImportReport, Location

SCHEMA = """
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    system TEXT NOT NULL,
    type TEXT NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    qt_valid INTEGER NOT NULL,
    parent_uuid TEXT,
    game_version TEXT,
    source_updated_at TEXT,
    imported_at TEXT NOT NULL,
    UNIQUE(source, uuid)
);
CREATE INDEX IF NOT EXISTS ix_locations_system ON locations(system);

CREATE TABLE IF NOT EXISTS custom_points (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system TEXT NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
    notes TEXT DEFAULT '',
    origin TEXT DEFAULT 'manuale',
    created_at TEXT NOT NULL,
    UNIQUE(system, name)
);

-- Valori letti nella Starmap: conservati grezzi, NON convertiti in XYZ
-- finche' la trasformazione non e' verificata.
CREATE TABLE IF NOT EXISTS starmap_readings (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system TEXT NOT NULL,
    raw_values TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

-- Tratte provate in gioco dal giocatore (chiavi dei punti).
CREATE TABLE IF NOT EXISTS verified_routes (
    start_key TEXT NOT NULL,
    dest_key TEXT NOT NULL,
    system TEXT NOT NULL,
    notes TEXT DEFAULT '',
    verified_at TEXT NOT NULL,
    PRIMARY KEY (start_key, dest_key)
);

CREATE TABLE IF NOT EXISTS saved_routes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    system TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_log (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    system TEXT NOT NULL,
    ok INTEGER NOT NULL,
    stored INTEGER NOT NULL,
    game_version TEXT,
    details TEXT NOT NULL,
    at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self.conn
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    # ---- posizioni importate -------------------------------------------
    def replace_locations(self, source: str, system: str, locs: list[Location],
                          report: ImportReport) -> int:
        """Sostituisce in modo atomico le posizioni di (fonte, sistema).
        Se l'import e' fallito o vuoto i dati precedenti restano intatti."""
        if not report.ok or not locs:
            self.log_import(report)
            return 0
        ts = now_iso()
        with self.tx() as c:
            c.execute("DELETE FROM locations WHERE source=? AND system=?", (source, system))
            c.executemany(
                """INSERT OR REPLACE INTO locations
                   (source, uuid, name, system, type, x, y, z, qt_valid, parent_uuid,
                    game_version, source_updated_at, imported_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [(source, l.uuid, l.name, system, l.type, l.x, l.y, l.z, int(l.qt_valid),
                  l.parent_uuid, l.game_version, l.source_updated_at, ts) for l in locs],
            )
        report.stored = len(locs)
        self.log_import(report)
        return len(locs)

    def log_import(self, r: ImportReport) -> None:
        details = json.dumps({"fetched": r.fetched, "no_coords": r.skipped_no_coords,
                              "invalid": r.skipped_invalid, "errors": r.errors,
                              "warnings": r.warnings}, ensure_ascii=False)
        with self.tx() as c:
            c.execute("INSERT INTO import_log (source, system, ok, stored, game_version, details, at)"
                      " VALUES (?,?,?,?,?,?,?)",
                      (r.source, r.system, int(r.ok), r.stored, r.game_version, details, now_iso()))

    def locations(self, system: str, qt_only: bool = False) -> list[sqlite3.Row]:
        q = "SELECT * FROM locations WHERE system=?"
        if qt_only:
            q += " AND qt_valid=1"
        return self.conn.execute(q + " ORDER BY name", (system,)).fetchall()

    def import_history(self, limit: int = 20) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM import_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()

    def counts(self) -> dict[str, int]:
        rows = self.conn.execute("SELECT system, COUNT(*) n FROM locations GROUP BY system").fetchall()
        return {r["system"]: r["n"] for r in rows}

    # ---- punti personali ------------------------------------------------
    def add_custom_point(self, name: str, system: str, x: float, y: float, z: float,
                         notes: str = "", origin: str = "manuale") -> int:
        with self.tx() as c:
            cur = c.execute(
                """INSERT INTO custom_points (name, system, x, y, z, notes, origin, created_at)
                   VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(system, name) DO UPDATE SET x=excluded.x, y=excluded.y,
                   z=excluded.z, notes=excluded.notes, origin=excluded.origin""",
                (name, system, x, y, z, notes, origin, now_iso()))
            return cur.lastrowid

    def custom_points(self, system: str) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM custom_points WHERE system=? ORDER BY name",
                                 (system,)).fetchall()

    def delete_custom_point(self, point_id: int) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM custom_points WHERE id=?", (point_id,))

    # ---- letture Starmap (grezze) ----------------------------------------
    def add_starmap_reading(self, name: str, system: str, raw: dict, notes: str = "") -> int:
        with self.tx() as c:
            cur = c.execute("INSERT INTO starmap_readings (name, system, raw_values, notes, created_at)"
                            " VALUES (?,?,?,?,?)",
                            (name, system, json.dumps(raw, ensure_ascii=False), notes, now_iso()))
            return cur.lastrowid

    def starmap_readings(self, system: str) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM starmap_readings WHERE system=? ORDER BY id DESC",
                                 (system,)).fetchall()

    # ---- tratte verificate -----------------------------------------------
    def mark_verified(self, start_key: str, dest_key: str, system: str, notes: str = "") -> None:
        with self.tx() as c:
            c.execute("INSERT OR REPLACE INTO verified_routes VALUES (?,?,?,?,?)",
                      (start_key, dest_key, system, notes, now_iso()))

    def verified_pairs(self, system: str) -> set[tuple[str, str]]:
        rows = self.conn.execute("SELECT start_key, dest_key FROM verified_routes WHERE system=?",
                                 (system,)).fetchall()
        return {(r[0], r[1]) for r in rows}

    # ---- rotte salvate ---------------------------------------------------
    def save_route(self, name: str, system: str, payload: dict) -> int:
        with self.tx() as c:
            cur = c.execute("INSERT INTO saved_routes (name, system, payload, created_at) VALUES (?,?,?,?)",
                            (name, system, json.dumps(payload, ensure_ascii=False), now_iso()))
            return cur.lastrowid

    def saved_routes(self, system: str | None = None) -> list[sqlite3.Row]:
        if system:
            return self.conn.execute("SELECT * FROM saved_routes WHERE system=? ORDER BY id DESC",
                                     (system,)).fetchall()
        return self.conn.execute("SELECT * FROM saved_routes ORDER BY id DESC").fetchall()

    def delete_saved_route(self, route_id: int) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM saved_routes WHERE id=?", (route_id,))
