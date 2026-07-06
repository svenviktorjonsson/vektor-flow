from __future__ import annotations

import pytest

from vektorflow.physics.hard_spheres import HardSphere, HardSphereWorld3D, demo_hard_spheres
from vektorflow.stdlib import resolve_stdlib


def test_hard_sphere_world_applies_3d_gravity() -> None:
    world = HardSphereWorld3D((HardSphere(0.5, 0.5, 0.8, 0.0, 0.0, 0.0, 0.05),), gravity=(0.0, 0.0, -9.81))

    snapshot = world.advance_to(0.1)
    sphere = snapshot.spheres[0]

    assert sphere.z == pytest.approx(0.8 - 0.5 * 9.81 * 0.1 * 0.1, abs=2.0e-3)
    assert sphere.vz == pytest.approx(-0.981, abs=2.0e-3)


def test_hard_sphere_floor_collision_uses_restitution() -> None:
    world = HardSphereWorld3D(
        (HardSphere(0.5, 0.5, 0.07, 0.0, 0.0, -0.8, 0.05),),
        restitution=0.9,
        gravity=(0.0, 0.0, 0.0),
    )

    snapshot = world.advance_to(0.05)
    sphere = snapshot.spheres[0]

    assert sphere.z >= sphere.radius
    assert sphere.vz == pytest.approx(0.72)


def test_demo_hard_spheres_start_and_remain_non_overlapping() -> None:
    world = HardSphereWorld3D(
        demo_hard_spheres(count=100, width=3.0, depth=2.0, height=2.0),
        width=3.0,
        depth=2.0,
        height=2.0,
        restitution=0.9,
        gravity=(0.0, 0.0, -9.81),
    )

    assert world.snapshot().min_gap >= -1.0e-8
    worst = min(world.advance_to(frame / 60.0) and world.min_gap() for frame in range(0, 121, 10))

    assert worst >= -1.0e-6


def test_physics_namespace_exposes_3d_hard_sphere_world() -> None:
    ns = resolve_stdlib("physics")
    spheres = ns["demo_hard_spheres"](100, width=3.0, depth=2.0, height=2.0)
    world = ns["hard_sphere_world"](spheres, width=3.0, depth=2.0, height=2.0, restitution=0.9)

    assert len(world.snapshot().spheres) == 100
    assert world.restitution == pytest.approx(0.9)
