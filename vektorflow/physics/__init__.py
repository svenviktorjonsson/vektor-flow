"""Physics engine core package.

This package owns VKF physics semantics. Top-level ``vektorflow.physics_*``
modules are compatibility adapters; new code should import from here.
"""

from vektorflow.physics.dynamics import effective_vertex_masses, edge_rotational_inertia, step_edge_dynamics
from vektorflow.physics.hard_discs import CollisionEvent, HardDisc, HardDiscSnapshot, HardDiscWorld2D
from vektorflow.physics.properties import (
    Mat3,
    Number,
    PhysicsGeometry,
    Vec,
    centroid,
    inertia_tensor_from_point_masses,
    is_free_stiffness,
    is_rigid_stiffness,
    length,
    orthogonal_spring_damper_edge_force,
    polygon_area,
    rotational_spring_damper_torque,
    spring_damper_edge_force,
    stiffness_value,
    tetra_volume,
)
from vektorflow.physics.rigid_body import (
    ForceApplication,
    RigidBodyMassProperties,
    RigidBodyState,
    parallel_axis_shift,
    rigid_body_mass_properties,
    step_rigid_body,
    tetra_mass_properties,
)

__all__ = [
    "ForceApplication",
    "Mat3",
    "Number",
    "PhysicsGeometry",
    "RigidBodyMassProperties",
    "RigidBodyState",
    "Vec",
    "centroid",
    "CollisionEvent",
    "effective_vertex_masses",
    "edge_rotational_inertia",
    "HardDisc",
    "HardDiscSnapshot",
    "HardDiscWorld2D",
    "inertia_tensor_from_point_masses",
    "is_free_stiffness",
    "is_rigid_stiffness",
    "length",
    "orthogonal_spring_damper_edge_force",
    "parallel_axis_shift",
    "polygon_area",
    "rigid_body_mass_properties",
    "rotational_spring_damper_torque",
    "spring_damper_edge_force",
    "step_edge_dynamics",
    "step_rigid_body",
    "stiffness_value",
    "tetra_mass_properties",
    "tetra_volume",
]
