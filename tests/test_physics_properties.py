from __future__ import annotations

import pytest

from vektorflow.physics_properties import (
    PhysicsGeometry,
    inertia_tensor_from_point_masses,
    length,
    polygon_area,
    rotational_spring_damper_torque,
    spring_damper_edge_force,
    tetra_volume,
)


def _flat(matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]) -> tuple[float, ...]:
    return tuple(value for row in matrix for value in row)


def test_hardcoded_geometry_symbols_L_A_V() -> None:
    vertices = ((0.0, 0.0, 0.0), (3.0, 4.0, 0.0), (0.0, 4.0, 0.0), (0.0, 0.0, 6.0))

    assert length(vertices, (0, 1)) == pytest.approx(5.0)
    assert polygon_area(vertices, (0, 1, 2)) == pytest.approx(6.0)
    assert tetra_volume(vertices, (0, 1, 2, 3)) == pytest.approx(12.0)


def test_density_symbols_derive_mass_and_charge_for_element_dimensions() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (3.0, 4.0), (3.0, 0.0)),
        edges=((0, 1),),
        faces=((0, 1, 2),),
        edge_properties={0: {"rho_L": 2.0, "sigma_L": 0.25}},
        face_properties={0: {"rho_A": 3.0, "sigma_A": 0.5}},
    )

    assert geometry.L(0) == pytest.approx(5.0)
    assert geometry.A(0) == pytest.approx(6.0)
    assert geometry.mass("edge", 0) == pytest.approx(10.0)
    assert geometry.charge("edge", 0) == pytest.approx(1.25)
    assert geometry.mass("face", 0) == pytest.approx(18.0)
    assert geometry.charge("face", 0) == pytest.approx(3.0)


def test_volume_density_and_explicit_vertex_mass_charge() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (0.0, 4.0, 0.0), (0.0, 0.0, 6.0)),
        volumes=((0, 1, 2, 3),),
        vertex_properties={0: {"m": 4.0, "q": -1.5}},
        volume_properties={0: {"rho_V": 2.0, "sigma_V": 0.125}},
    )

    assert geometry.V(0) == pytest.approx(12.0)
    assert geometry.mass("vertex", 0) == pytest.approx(4.0)
    assert geometry.charge("vertex", 0) == pytest.approx(-1.5)
    assert geometry.mass("volume", 0) == pytest.approx(24.0)
    assert geometry.charge("volume", 0) == pytest.approx(1.5)


def test_velocity_and_angular_velocity_accessors_use_v_and_w() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0, 0.0),),
        vertex_properties={0: {"v": (1.0, 2.0, 3.0), "w": (0.0, 0.0, 7.0)}},
    )

    assert geometry.velocity("vertex", 0) == (1.0, 2.0, 3.0)
    assert geometry.angular_velocity("vertex", 0) == (0.0, 0.0, 7.0)


def test_inertia_tensor_I_from_point_masses() -> None:
    tensor = inertia_tensor_from_point_masses([((1.0, 0.0, 0.0), 2.0), ((0.0, 2.0, 0.0), 3.0)])

    assert _flat(tensor) == pytest.approx((12.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 14.0))


def test_geometry_inertia_tensor_lumps_element_masses_at_centroids() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (2.0, 0.0)),
        edges=((0, 1),),
        edge_properties={0: {"rho_L": 3.0}},
    )

    assert _flat(geometry.inertia_tensor()) == pytest.approx((0.0, 0.0, 0.0, 0.0, 6.0, 0.0, 0.0, 0.0, 6.0))


def test_edge_spring_damper_force_returns_endpoint_forces_and_tension() -> None:
    force_0, force_1, tension = spring_damper_edge_force(
        (0.0, 0.0),
        (3.0, 0.0),
        rest_length=2.0,
        spring_constant=10.0,
        damping=1.5,
        v0=(0.0, 0.0),
        v1=(2.0, 0.0),
    )

    assert tension == pytest.approx(13.0)
    assert force_0 == pytest.approx((13.0, 0.0))
    assert force_1 == pytest.approx((-13.0, -0.0))


def test_geometry_edge_force_uses_edge_properties_and_vertex_velocities() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (3.0, 0.0)),
        edges=((0, 1),),
        vertex_properties={0: {"v": (0.0, 0.0)}, 1: {"v": (2.0, 0.0)}},
        edge_properties={0: {"L0": 2.0, "k": 10.0, "c": 1.5}},
    )

    force_0, force_1, tension = geometry.edge_force(0)
    assert tension == pytest.approx(13.0)
    assert force_0 == pytest.approx((13.0, 0.0))
    assert force_1 == pytest.approx((-13.0, -0.0))


def test_rotational_spring_damper_torque_uses_angle_deviation_and_angular_friction() -> None:
    torque = rotational_spring_damper_torque(
        1.25,
        rest_angle=0.25,
        angular_spring_constant=8.0,
        angular_damping=1.5,
        angular_velocity=-2.0,
    )

    assert torque == pytest.approx(5.0)


def test_geometry_rotational_torque_uses_theta_constants_and_omega_alias() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (1.0, 0.0)),
        edges=((0, 1),),
        edge_properties={
            0: {
                "theta": 1.25,
                "theta0": 0.25,
                "k_theta": 8.0,
                "c_theta": 1.5,
                "omega": -2.0,
            }
        },
    )

    assert geometry.rotational_torque("edge", 0) == pytest.approx(5.0)


def test_geometry_rotational_torque_supports_readable_aliases() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0)),
        faces=((0, 1, 2),),
        face_properties={
            0: {
                "angle": 0.75,
                "rest_angle": 0.25,
                "angular_spring_constant": 4.0,
                "angular_friction": 0.5,
                "w_scalar": 3.0,
            }
        },
    )

    assert geometry.rotational_torque("face", 0) == pytest.approx(3.5)
