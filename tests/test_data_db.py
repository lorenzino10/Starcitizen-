"""Parser CitizenHQ (con risposte simulate) e database SQLite."""
import httpx
import pytest

from navcom.data import citizenhq
from navcom.data.bodies import obstruction_model
from navcom.data.models import ImportReport
from navcom.db.database import Database
from navcom.services.planner import nav_points, plan_to_target
from navcom.core.vector import Vec3

SAMPLE = [
    {"uuid": "u1", "name": "Alpha Station", "type": "Manmade_VisibleOnInteraction", "system": "stanton",
     "parentUuid": "p", "x": 1.0e10, "y": 0, "z": 0, "qtValid": True},
    {"uuid": "u2", "name": "Beta Station", "type": "Manmade_VisibleOnInteraction", "system": "stanton",
     "parentUuid": "p", "x": -1.0e10, "y": 2.0e9, "z": 0, "qtValid": True},
    {"uuid": "u3", "name": "Senza coordinate", "type": "Outpost", "system": "stanton",
     "parentUuid": "p", "x": None, "y": None, "z": None, "qtValid": True},
    {"uuid": "u4", "name": "Rotto", "x": "abc", "y": 0, "z": 0},
    {"name": ""},
]
HEALTH = {"status": "ok", "jobs": {"scunpacked": {"version": "4.10.2-LIVE.12881860"}}}


def _client(handler):
    return httpx.Client(base_url=citizenhq.BASE_URL, transport=httpx.MockTransport(handler))


def test_parse_positions_counts_and_skips():
    rep = ImportReport("citizenhq", "stanton", False)
    locs = citizenhq.parse_positions(SAMPLE, "stanton", "4.10.2", rep)
    assert [l.name for l in locs] == ["Alpha Station", "Beta Station"]
    assert rep.skipped_no_coords == 1 and rep.skipped_invalid == 2


def test_parse_accepts_wrapped_payload():
    rep = ImportReport("citizenhq", "stanton", False)
    assert len(citizenhq.parse_positions({"data": SAMPLE[:2]}, "stanton", None, rep)) == 2
    with pytest.raises(citizenhq.ApiError):
        citizenhq.parse_positions({"unexpected": 1}, "stanton", None, rep)


def test_fetch_system_ok_with_version():
    def handler(req):
        if req.url.path.endswith("/health"):
            return httpx.Response(200, json=HEALTH)
        assert req.url.params["system"] == "stanton"
        return httpx.Response(200, json=SAMPLE)
    locs, rep = citizenhq.fetch_system("stanton", client=_client(handler))
    assert rep.ok and rep.game_version == "4.10.2-LIVE.12881860" and len(locs) == 2


def test_fetch_system_http_error_and_health_down(monkeypatch):
    monkeypatch.setattr(citizenhq.time, "sleep", lambda s: None)

    def handler(req):
        if req.url.path.endswith("/health"):
            return httpx.Response(503)
        return httpx.Response(404)
    locs, rep = citizenhq.fetch_system("stanton", client=_client(handler))
    assert not rep.ok and locs == [] and "HTTP 404" in rep.errors[0]
    assert any("/health" in w for w in rep.warnings)


def test_fetch_system_timeout(monkeypatch):
    monkeypatch.setattr(citizenhq.time, "sleep", lambda s: None)

    def handler(req):
        raise httpx.ConnectTimeout("lento", request=req)
    locs, rep = citizenhq.fetch_system("stanton", client=_client(handler))
    assert not rep.ok and "timeout" in rep.errors[0]


def test_failed_import_keeps_previous_data():
    db = Database(":memory:")
    rep = ImportReport("citizenhq", "stanton", True)
    locs = citizenhq.parse_positions(SAMPLE, "stanton", "v", rep)
    assert db.replace_locations("citizenhq", "stanton", locs, rep) == 2
    bad = ImportReport("citizenhq", "stanton", False, errors=["giu'"])
    assert db.replace_locations("citizenhq", "stanton", [], bad) == 0
    assert len(db.locations("stanton")) == 2
    assert [r["ok"] for r in db.import_history()] == [0, 1]


def test_custom_points_routes_and_planning():
    db = Database(":memory:")
    rep = ImportReport("citizenhq", "stanton", True)
    db.replace_locations("citizenhq", "stanton", citizenhq.parse_positions(SAMPLE, "stanton", "v", rep), rep)
    db.add_custom_point("Relitto", "stanton", 0, 1.0e9, 0, "test")
    pts = nav_points(db, "stanton")
    assert "cp:Relitto" in pts and not pts["cp:Relitto"].qt_valid
    start = pts["citizenhq:u1"]
    res, model = plan_to_target(db, "stanton", start, pts["cp:Relitto"].pos, 1.2)
    assert res and res[0].dest.key == "citizenhq:u2"
    rid = db.save_route("prova", "stanton", {"x": 1})
    assert db.saved_routes("stanton")[0]["id"] == rid
    db.mark_verified("citizenhq:u1", "citizenhq:u2", "stanton")
    res, _ = plan_to_target(db, "stanton", start, pts["cp:Relitto"].pos, 1.2)
    assert res[0].status.value == "Verificata nel gioco"


def test_stanton_seed_model():
    m = obstruction_model("stanton")
    names = {b.name for b in m.bodies}
    assert m.complete and {"Crusader", "Hurston", "ArcCorp", "Microtech"} <= names
    assert not obstruction_model("pyro").complete
