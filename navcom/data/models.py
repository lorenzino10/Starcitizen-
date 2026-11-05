"""Modelli dati condivisi fra importazione, database e interfaccia."""
from __future__ import annotations

from dataclasses import dataclass, field

SYSTEMS = ("stanton", "pyro", "nyx")


@dataclass(slots=True)
class Location:
    """Posizione importata da una fonte esterna. Coordinate in metri."""
    uuid: str
    name: str
    system: str
    type: str
    x: float | None
    y: float | None
    z: float | None
    qt_valid: bool
    parent_uuid: str | None
    source: str
    game_version: str | None = None
    source_updated_at: str | None = None   # data della fonte, se nota
    id: int | None = None

    @property
    def has_coords(self) -> bool:
        return None not in (self.x, self.y, self.z)


@dataclass(slots=True)
class ImportReport:
    source: str
    system: str
    ok: bool
    fetched: int = 0
    stored: int = 0
    skipped_no_coords: int = 0
    skipped_invalid: int = 0
    game_version: str | None = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
