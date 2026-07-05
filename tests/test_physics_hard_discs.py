from __future__ import annotations

import pytest

from vektorflow.physics_hard_discs import HardDisc, HardDiscWorld2D
from vektorflow.stdlib.physics import density_color, disc_impostors


def test_pair_collision_conserves_energy_and_respects_radius() -> None:
    world = HardDiscWorld2D(
        (
            HardDisc(0.25, 0.5, 0.20, 0.0, 0.08, density=1.0),
            HardDisc(0.75, 0.5, -0.20, 0.0, 0.12, density=1.0),
        )
    )
    energy0 = world.snapshot().kinetic_energy

    before = world.advance_to(0.70)
    after = world.advance_to(1.20)

    assert before.discs[0].vx > 0.0
    assert after.discs[0].vx < 0.0
    assert after.kinetic_energy == pytest.approx(energy0)
    assert after.min_gap >= -1.0e-8


def test_wall_collision_reflects_without_energy_loss() -> None:
    world = HardDiscWorld2D((HardDisc(0.25, 0.4, -0.30, 0.10, 0.05, density=2.0),))
    energy0 = world.snapshot().kinetic_energy

    snapshot = world.advance_to(1.0)

    assert snapshot.discs[0].vx == pytest.approx(0.30)
    assert snapshot.discs[0].vy == pytest.approx(0.10)
    assert snapshot.kinetic_energy == pytest.approx(energy0)
    assert snapshot.discs[0].x >= snapshot.discs[0].radius


def test_event_queue_handles_multiple_discs_without_overlap() -> None:
    discs = (
        HardDisc(0.18, 0.20, 0.32, 0.22, 0.035),
        HardDisc(0.42, 0.25, -0.12, 0.30, 0.050),
        HardDisc(0.72, 0.22, -0.25, 0.18, 0.045),
        HardDisc(0.30, 0.55, 0.20, -0.17, 0.055),
        HardDisc(0.60, 0.58, -0.30, -0.19, 0.040),
        HardDisc(0.82, 0.72, -0.18, -0.28, 0.060),
    )
    world = HardDiscWorld2D(discs, width=1.0, height=0.8)
    energy0 = world.snapshot().kinetic_energy

    for step in range(1, 101):
        snapshot = world.advance_to(step * 0.04)
        assert snapshot.min_gap >= -1.0e-7
        assert snapshot.kinetic_energy == pytest.approx(energy0)


def test_impostor_color_reflects_density_and_density_changes_mass() -> None:
    light = HardDisc(0.25, 0.5, 0.0, 0.0, 0.08, density=0.75)
    heavy = HardDisc(0.75, 0.5, 0.0, 0.0, 0.08, density=3.70)
    world = HardDiscWorld2D((light, heavy))
    snapshot = world.snapshot()

    impostors = disc_impostors(world, snapshot)

    assert heavy.mass > light.mass
    assert impostors[0]["color"] == pytest.approx(density_color(light.density))
    assert impostors[1]["color"] == pytest.approx(density_color(heavy.density))
    assert impostors[0]["color"] != impostors[1]["color"]
