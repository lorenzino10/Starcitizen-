"""Tratte QT, classificazione e ostacoli su casi sintetici esatti."""
import pytest

from navcom.core.qt import (Body, NavPoint, ObstructionModel, RouteStatus, check_obstructions,
                            evaluate_leg, rank_candidates)
from navcom.core.vector import Vec3

S = NavPoint("s", "S", Vec3(0, 0, 0), qt_valid=True)
D = NavPoint("d", "D", Vec3(100, 0, 0), qt_valid=True)
EMPTY_COMPLETE = ObstructionModel(bodies=(), complete=True)


def test_leg_drop_point_and_hud_distance():
    r = evaluate_leg(S, D, Vec3(6, 8, 0), EMPTY_COMPLETE)
    assert r.t == pytest.approx(0.06)
    assert r.qt_travel_m == pytest.approx(6)
    assert r.hud_remaining_m == pytest.approx(94)   # valore da attendere in HUD
    assert r.residual_m == pytest.approx(8)         # volo convenzionale dopo il drop
    assert r.direct_m == pytest.approx(10)          # triangolo 6-8-10
    assert r.gain_m == pytest.approx(2)
    assert r.needs_manual_drop
    assert r.status is RouteStatus.DATA_SUPPORTED


def test_target_beyond_destination_no_drop():
    r = evaluate_leg(S, D, Vec3(130, 40, 0), EMPTY_COMPLETE)
    assert r.t == 1.0 and r.hud_remaining_m == 0
    assert r.residual_m == pytest.approx(50)
    assert not r.needs_manual_drop


def test_hud_plus_travel_equals_leg_length():
    r = evaluate_leg(S, NavPoint("d2", "D2", Vec3(30, 40, 120), True), Vec3(10, 30, 50), EMPTY_COMPLETE)
    assert r.qt_travel_m + r.hud_remaining_m == pytest.approx(r.leg_length_m)
    assert r.leg_length_m == pytest.approx(130)


def test_ranking_by_residual_and_exclusion_of_useless_legs():
    target = Vec3(50, 10, 0)
    near = NavPoint("near", "near", Vec3(100, 0, 0), True)     # residuo 10
    better = NavPoint("better", "better", Vec3(100, 20, 0), True)  # passa per (50,10): residuo 0
    behind = NavPoint("behind", "behind", Vec3(-100, 0, 0), True)  # non avvicina
    res = rank_candidates(S, target, [near, better, behind], EMPTY_COMPLETE)
    assert [r.dest.key for r in res] == ["better", "near"]
    assert res[0].residual_m == pytest.approx(0, abs=1e-9)
    assert res[1].residual_m == pytest.approx(10)


def test_obstruction_blocks_and_is_excluded():
    planet = Body("P", Vec3(50, 0, 0), 5)
    model = ObstructionModel(bodies=(planet,), margin=1.0, complete=True)
    assert check_obstructions(S.pos, D.pos, model)[0].clearance_m == pytest.approx(-5)
    res = rank_candidates(S, Vec3(60, 8, 0), [D], model)
    assert res == []
    res = rank_candidates(S, Vec3(60, 8, 0), [D], model, include_blocked=True)
    assert res[0].blocked


def test_margin_extends_obstruction():
    body = Body("P", Vec3(50, 5.5, 0), 5)
    assert not check_obstructions(S.pos, D.pos, ObstructionModel((body,), 1.0, True))
    assert check_obstructions(S.pos, D.pos, ObstructionModel((body,), 1.2, True))


def test_endpoint_on_surface_not_blocked_when_leaving_outward():
    planet = Body("P", Vec3(0, 0, 0), 10)
    surface = NavPoint("o", "outpost", Vec3(10, 0, 0), True)
    away = NavPoint("a", "away", Vec3(100, 0, 0), True)
    other_side = NavPoint("b", "other side", Vec3(-100, 0, 0), True)
    model = ObstructionModel((planet,), 1.2, True)
    assert check_obstructions(surface.pos, away.pos, model) == []
    assert check_obstructions(surface.pos, other_side.pos, model)


def test_classification_rules():
    free_start = NavPoint("free", "free", Vec3(0, 0, 0), qt_valid=False)
    assert evaluate_leg(free_start, D, Vec3(50, 1, 0), EMPTY_COMPLETE).status is RouteStatus.THEORETICAL
    incomplete = ObstructionModel((), complete=False)
    assert evaluate_leg(S, D, Vec3(50, 1, 0), incomplete).status is RouteStatus.THEORETICAL
    uncertain = ObstructionModel((Body("star?", Vec3(50, 0, 0), 5, uncertain=True),), 1.0, True)
    r = evaluate_leg(S, D, Vec3(50, 1, 0), uncertain)
    assert r.status is RouteStatus.THEORETICAL and not r.blocked
    assert evaluate_leg(S, D, Vec3(50, 1, 0), EMPTY_COMPLETE, verified=True).status is RouteStatus.VERIFIED
