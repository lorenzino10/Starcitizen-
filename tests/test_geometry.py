"""Test con coordinate sintetiche e risultati esatti, calcolabili a mano."""
import math

import pytest

from navcom.core.geometry import project_point_on_segment, segment_hits_sphere, segment_sphere_roots
from navcom.core.vector import Vec3, distance


def test_distance_3_4_12():
    # 3-4-12 -> 13
    assert distance(Vec3(1, 1, 1), Vec3(4, 5, 13)) == 13.0


def test_projection_inside_segment():
    p = project_point_on_segment(Vec3(0, 0, 0), Vec3(10, 0, 0), Vec3(3, 4, 0))
    assert p.t == pytest.approx(0.3)
    assert p.point == Vec3(3, 0, 0)
    assert p.distance == pytest.approx(4.0)


def test_projection_clamped_before_start():
    p = project_point_on_segment(Vec3(0, 0, 0), Vec3(10, 0, 0), Vec3(-5, 3, 0))
    assert p.t == 0.0 and p.t_unclamped == pytest.approx(-0.5)
    assert p.point == Vec3(0, 0, 0)
    assert p.distance == pytest.approx(math.sqrt(34))


def test_projection_clamped_after_end():
    p = project_point_on_segment(Vec3(0, 0, 0), Vec3(10, 0, 0), Vec3(13, 4, 0))
    assert p.t == 1.0 and p.t_unclamped == pytest.approx(1.3)
    assert p.distance == pytest.approx(5.0)


def test_projection_oblique_3d():
    # direzione (4,4,2) lunga 6; il bersaglio sta a 3/4 del segmento piu'
    # uno scarto perpendicolare (2,-2,0), lungo 2*sqrt(2)
    a = Vec3(1, 2, 3)
    b = a + Vec3(4, 4, 2)
    p = a + Vec3(3, 3, 1.5) + Vec3(2, -2, 0)
    r = project_point_on_segment(a, b, p)
    assert r.t == pytest.approx(0.75)
    assert r.point.as_tuple() == pytest.approx((4, 5, 4.5))
    assert r.distance == pytest.approx(2 * math.sqrt(2))


def test_projection_degenerate_segment():
    r = project_point_on_segment(Vec3(1, 1, 1), Vec3(1, 1, 1), Vec3(4, 5, 1))
    assert r.t == 0.0 and r.distance == pytest.approx(5.0)


def test_projection_large_coordinates_precision():
    # scala reale (decine di Gm): stesso caso del primo test moltiplicato 1e9
    k = 1e9
    p = project_point_on_segment(Vec3(0, 0, 0), Vec3(10 * k, 0, 0), Vec3(3 * k, 4 * k, 0))
    assert p.distance == pytest.approx(4 * k, abs=1e-3)


def test_sphere_roots_two_crossings():
    roots = segment_sphere_roots(Vec3(-10, 0, 0), Vec3(10, 0, 0), Vec3(0, 0, 0), 5)
    assert roots == pytest.approx([0.25, 0.75])


def test_sphere_roots_tangent_and_miss():
    assert segment_sphere_roots(Vec3(-10, 5, 0), Vec3(10, 5, 0), Vec3(0, 0, 0), 5) == pytest.approx([0.5])
    assert segment_sphere_roots(Vec3(-10, 6, 0), Vec3(10, 6, 0), Vec3(0, 0, 0), 5) == []


def test_sphere_roots_outside_segment_are_dropped():
    # la sfera e' attraversata solo dal prolungamento della retta
    assert segment_sphere_roots(Vec3(10, 0, 0), Vec3(20, 0, 0), Vec3(0, 0, 0), 5) == []


def test_segment_hits_sphere():
    assert segment_hits_sphere(Vec3(-10, 1, 0), Vec3(10, 1, 0), Vec3(0, 0, 0), 2)
    assert not segment_hits_sphere(Vec3(-10, 3, 0), Vec3(10, 3, 0), Vec3(0, 0, 0), 2)
