"""Client per la API pubblica di CitizenHQ (https://citizenhq.space/api).

Verificato il 2026-11-05:
  * GET /api/v1/positions?system=stanton|pyro|nyx -> array JSON di oggetti
    {uuid, name, type, system, parentUuid, x, y, z, qtValid}
  * x/y/z in metri, frame della griglia del sistema (la stella 'Stanton' e' a
    0,0,0; Crusader coincide al metro con il dataset starmap.space); possono
    essere null.
  * GET /api/v1/health -> stato e tempi di sincronizzazione, contiene la
    versione del gioco dei dati scunpacked (es. 4.10.2-LIVE.12881860).
  * Solo GET, nessuna chiave, limite fair-use 60 richieste/minuto per IP
    (burst 30), oltre risponde 429.
  * Attribuzione richiesta: "Daten via UEX Corp, SC Trade Tools, scunpacked &
    Star Citizen Wiki". I dati sono forniti "come sono".

Il parser e' tollerante: accetta sia un array sia un oggetto con chiave
'data'/'items'/'positions', scarta voci senza nome o con coordinate non
numeriche e conta le voci senza coordinate.
"""
from __future__ import annotations

import math
import re
import time
from typing import Any

import httpx

from .models import SYSTEMS, ImportReport, Location

BASE_URL = "https://citizenhq.space/api/v1"
SOURCE = "citizenhq"
ATTRIBUTION = "Dati via CitizenHQ (UEX Corp, SC Trade Tools, scunpacked, Star Citizen Wiki)"
USER_AGENT = "STAR-CITIZEN-NAVCOM/0.1 (uso personale)"
_VERSION_RE = re.compile(r"\b\d+\.\d+(?:\.\d+)?-(?:LIVE|PTU|EPTU)\.\d+\b")


class ApiError(RuntimeError):
    pass


def _get_json(client: httpx.Client, path: str, params: dict | None = None,
              retries: int = 3) -> tuple[Any, httpx.Headers]:
    """GET con gestione di timeout, 429 (Retry-After) e errori 5xx."""
    last: str = ""
    for attempt in range(retries):
        try:
            r = client.get(path, params=params)
        except httpx.TimeoutException:
            last = "timeout"
        except httpx.HTTPError as e:
            last = f"errore di rete: {e.__class__.__name__}: {e}"
        else:
            if r.status_code == 200:
                try:
                    return r.json(), r.headers
                except ValueError as e:
                    raise ApiError(f"{path}: risposta non JSON ({e})") from e
            if r.status_code == 429:
                wait = float(r.headers.get("Retry-After", "5") or 5)
                last = f"HTTP 429 (limite richieste), attendo {wait:.0f}s"
                time.sleep(min(wait, 30))
                continue
            if 500 <= r.status_code < 600:
                last = f"HTTP {r.status_code}"
            else:
                raise ApiError(f"{path}: HTTP {r.status_code}")
        time.sleep(1.5 * (attempt + 1))
    raise ApiError(f"{path}: fallito dopo {retries} tentativi ({last})")


def _num(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, bool):
        raise ValueError("booleano al posto di un numero")
    f = float(v)
    if not math.isfinite(f):
        raise ValueError("numero non finito")
    return f


def _rows(payload: Any) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("data", "items", "positions", "results"):
            if isinstance(payload.get(k), list):
                return payload[k]
    raise ApiError("struttura JSON inattesa per /positions")


def parse_positions(payload: Any, system: str, game_version: str | None,
                    report: ImportReport) -> list[Location]:
    out: list[Location] = []
    for row in _rows(payload):
        if not isinstance(row, dict) or not row.get("name"):
            report.skipped_invalid += 1
            continue
        try:
            x, y, z = _num(row.get("x")), _num(row.get("y")), _num(row.get("z"))
        except (TypeError, ValueError):
            report.skipped_invalid += 1
            continue
        loc = Location(
            uuid=str(row.get("uuid") or f"{system}:{row['name']}"),
            name=str(row["name"]).strip(),
            system=str(row.get("system") or system).lower(),
            type=str(row.get("type") or "?"),
            x=x, y=y, z=z,
            qt_valid=bool(row.get("qtValid", False)),
            parent_uuid=row.get("parentUuid"),
            source=SOURCE,
            game_version=game_version,
        )
        if not loc.has_coords:
            report.skipped_no_coords += 1
            continue
        out.append(loc)
    return out


def find_game_version(health: Any) -> str | None:
    """Cerca nel JSON di /health una stringa di versione tipo 4.10.2-LIVE.123."""
    m = _VERSION_RE.search(str(health))
    return m.group(0) if m else None


def fetch_system(system: str, timeout: float = 20.0,
                 client: httpx.Client | None = None) -> tuple[list[Location], ImportReport]:
    system = system.lower()
    report = ImportReport(source=SOURCE, system=system, ok=False)
    if system not in SYSTEMS:
        report.errors.append(f"sistema sconosciuto: {system}")
        return [], report
    own = client is None
    client = client or httpx.Client(base_url=BASE_URL, timeout=timeout,
                                    headers={"User-Agent": USER_AGENT})
    try:
        try:
            health, _ = _get_json(client, "/health", retries=1)
            report.game_version = find_game_version(health)
        except ApiError as e:
            report.warnings.append(f"/health non disponibile: {e}")
        if not report.game_version:
            report.warnings.append("versione del gioco non determinata")
        payload, headers = _get_json(client, "/positions", {"system": system})
        if headers.get("X-Data-Source"):
            report.warnings.append(f"X-Data-Source: {headers['X-Data-Source']}")
        locs = parse_positions(payload, system, report.game_version, report)
        report.fetched = len(locs) + report.skipped_no_coords + report.skipped_invalid
        report.ok = True
        return locs, report
    except ApiError as e:
        report.errors.append(str(e))
        return [], report
    finally:
        if own:
            client.close()
