from __future__ import annotations

import math

import pytest

from vektorflow.physics_properties import is_free_stiffness, is_rigid_stiffness, stiffness_value
from vektorflow.physics_rigid_body import (
    ForceApplication,
    RigidBodyState,
    parallel_axis_shift,
    rigid_body_mass_properties,
    step_rigid_body,
    tetra_mass_properties,
)
from vektorflow.physics_properties import PhysicsGeometry


def _flat(matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]) -> tuple[float, ...]:
    return tuple(value for row in matrix for value in row)


def test_stiffness_zero_is_free_and_inf_is_rigid() -> None:
    assert is_free_stiffness(0.0)
    assert stiffness_value("inf") == math.inf
    assert stiffness_value("rigid") == math.inf
    assert is_rigid_stiffness(math.inf)
    assert is_rigid_stiffness("infinity")


def test_tetra_mass_properties_compute_mass_center_and_solid_inertia() -> None:
    vertices = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

    props = tetra_mass_properties(vertices, (0, 1, 2, 3), density=6.0)

    assert props.mass == pytest.approx(1.0)
    assert props.center_of_mass == pytest.approx((0.25, 0.25, 0.25))
    assert _flat(props.inertia_tensor) == pytest.approx(
        (
            0.075,
            0.0125,
            0.0125,
            0.0125,
            0.075,
            0.0125,
            0.0125,
            0.0125,
            0.075,
        )
    )


def test_rigid_body_mass_properties_aggregate_volume_elements() -> None:
    geometry = PhysicsGeometry.from_vertices(
        (
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (0.0, 1.0, 0.0),
            (0.0, 0.0, 1.0),
            (2.0, 0.0, 0.0),
            (1.0, 1.0, 0.0),
            (1.0, 0.0, 1.0),
        ),
        volumes=((0, 1, 2, 3), (1, 4, 5, 6)),
        volume_properties={0: {"rho_V": 6.0}, 1: {"rho_V": 6.0}},
    )

    props = rigid_body_mass_properties(geometry)

    assert props.mass == pytest.approx(2.0)
    assert props.center_of_mass == pytest.approx((0.75, 0.25, 0.25))


def test_parallel_axis_shift_matches_tensor_form() -> None:
    assert _flat(parallel_axis_shift(2.0, (1.0, 2.0, 0.0))) == pytest.approx(
        (8.0, -4.0, 0.0, -4.0, 2.0, 0.0, 0.0, 0.0, 10.0)
    )


def test_gravity_updates_rigid_body_velocity_and_position_without_collision() -> None:
    props = tetra_mass_properties(
        ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        (0, 1, 2, 3),
        density=6.0,
    )

    stepped = step_rigid_body(
        RigidBodyState(position=(0.0, 0.0, 0.0), velocity=(0.0, 0.0, 0.0)),
        props,
        0.5,
        gravity=(0.0, 0.0, -9.8),
    )

    assert stepped.velocity == pytest.approx((0.0, 0.0, -4.9))
    assert stepped.position == pytest.approx((0.0, 0.0, -2.45))
    assert stepped.angular_velocity == pytest.approx((0.0, 0.0, 0.0))


def test_off_center_force_updates_angular_velocity_through_inertia_tensor() -> None:
    props = tetra_mass_properties(
        ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
        (0, 1, 2, 3),
        density=6.0,
    )

    stepped = step_rigid_body(
        RigidBodyState(position=(0.0, 0.0, 0.0), velocity=(0.0, 0.0, 0.0)),
        props,
        0.1,
        forces=(ForceApplication(force=(0.0, 1.0, 0.0), point=(1.25, 0.25, 0.25)),),
    )

    assert stepped.angular_velocity == pytest.approx((-0.2, -0.2, 1.4))
