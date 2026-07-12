from __future__ import annotations

import vektorflow.physics as physics
from vektorflow import physics_dynamics, physics_properties, physics_rigid_body
from vektorflow.physics import dynamics, properties, rigid_body


def test_physics_package_exports_current_core_interface() -> None:
    assert physics.PhysicsGeometry is properties.PhysicsGeometry
    assert physics.step_edge_dynamics is dynamics.step_edge_dynamics
    assert physics.tetra_mass_properties is rigid_body.tetra_mass_properties
    assert physics.step_rigid_body is rigid_body.step_rigid_body
    assert physics.hard_sphere_gpu_kernel_spec().pipeline.dimension == 3


def test_top_level_physics_modules_are_compatibility_adapters() -> None:
    assert physics_properties.PhysicsGeometry is properties.PhysicsGeometry
    assert physics_dynamics.step_edge_dynamics is dynamics.step_edge_dynamics
    assert physics_rigid_body.rigid_body_mass_properties is rigid_body.rigid_body_mass_properties
