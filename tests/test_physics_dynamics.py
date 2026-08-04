from __future__ import annotations

import pytest

from vektorflow.physics_dynamics import effective_vertex_masses, edge_rotational_inertia, step_edge_dynamics
from vektorflow.physics_properties import PhysicsGeometry


def test_effective_vertex_masses_lump_edge_face_and_volume_density() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0, 0.0), (2.0, 0.0, 0.0), (0.0, 3.0, 0.0), (0.0, 0.0, 6.0)),
        edges=((0, 1),),
        faces=((0, 1, 2),),
        volumes=((0, 1, 2, 3),),
        vertex_properties={0: {"m": 1.0}},
        edge_properties={0: {"rho_L": 2.0}},
        face_properties={0: {"rho_A": 3.0}},
        volume_properties={0: {"rho_V": 1.0}},
    )

    assert effective_vertex_masses(geometry) == pytest.approx((7.5, 6.5, 4.5, 1.5))


def test_step_edge_dynamics_updates_linear_positions_and_velocities_from_density_mass() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (3.0, 0.0)),
        edges=((0, 1),),
        vertex_properties={0: {"v": (0.0, 0.0)}, 1: {"v": (0.0, 0.0)}},
        edge_properties={0: {"rho_L": 2.0, "L0": 2.0, "k": 10.0}},
    )

    stepped = step_edge_dynamics(geometry, 0.1)

    assert stepped.vertex_properties[0]["m_eff"] == pytest.approx(3.0)
    assert stepped.vertex_properties[1]["m_eff"] == pytest.approx(3.0)
    assert stepped.vertex_properties[0]["F"] == pytest.approx((10.0, 0.0))
    assert stepped.vertex_properties[1]["F"] == pytest.approx((-10.0, 0.0))
    assert stepped.vertex_properties[0]["v"] == pytest.approx((1.0 / 3.0, 0.0))
    assert stepped.vertex_properties[1]["v"] == pytest.approx((-1.0 / 3.0, 0.0))
    assert stepped.vertices[0] == pytest.approx((1.0 / 30.0, 0.0))
    assert stepped.vertices[1] == pytest.approx((3.0 - 1.0 / 30.0, 0.0))


def test_step_edge_dynamics_updates_orthogonal_cantilever_displacement() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (3.0, 1.0)),
        edges=((0, 1),),
        vertex_properties={0: {"m": 1.0, "v": (0.0, 0.0)}, 1: {"m": 1.0, "v": (0.0, 0.0)}},
        edge_properties={0: {"edge0": (3.0, 0.0), "k_perp": 10.0}},
    )

    stepped = step_edge_dynamics(geometry, 0.1)

    assert stepped.vertex_properties[0]["F"] == pytest.approx((0.0, 10.0))
    assert stepped.vertex_properties[1]["F"] == pytest.approx((0.0, -10.0))
    assert stepped.vertex_properties[0]["v"] == pytest.approx((0.0, 1.0))
    assert stepped.vertex_properties[1]["v"] == pytest.approx((0.0, -1.0))
    assert stepped.vertices[0] == pytest.approx((0.0, 0.1))
    assert stepped.vertices[1] == pytest.approx((3.0, 0.9))


def test_step_edge_dynamics_updates_edge_theta_and_omega_from_rotational_spring() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (1.0, 0.0)),
        edges=((0, 1),),
        vertex_properties={0: {"m": 1.0, "v": (0.0, 0.0)}, 1: {"m": 1.0, "v": (0.0, 0.0)}},
        edge_properties={0: {"theta": 1.0, "theta0": 0.0, "k_theta": 8.0, "I": 2.0}},
    )

    stepped = step_edge_dynamics(geometry, 0.25)

    assert stepped.edge_properties[0]["tau"] == pytest.approx(8.0)
    assert stepped.edge_properties[0]["I_eff"] == pytest.approx(2.0)
    assert stepped.edge_properties[0]["omega"] == pytest.approx(-1.0)
    assert stepped.edge_properties[0]["theta"] == pytest.approx(0.75)


def test_edge_rotational_inertia_falls_back_to_density_lumped_endpoint_masses() -> None:
    geometry = PhysicsGeometry.from_vertices(
        ((0.0, 0.0), (2.0, 0.0)),
        edges=((0, 1),),
        edge_properties={0: {"rho_L": 3.0}},
    )

    assert edge_rotational_inertia(geometry, 0) == pytest.approx(6.0)
