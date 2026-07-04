"""Built-in ``physics`` library for VKF physics-engine access."""

from __future__ import annotations

from typing import Any

from vektorflow.physics import (
    ForceApplication,
    PhysicsGeometry,
    RigidBodyState,
    effective_vertex_masses,
    edge_rotational_inertia,
    is_free_stiffness,
    is_rigid_stiffness,
    length,
    orthogonal_spring_damper_edge_force,
    parallel_axis_shift,
    polygon_area,
    rigid_body_mass_properties,
    rotational_spring_damper_torque,
    spring_damper_edge_force,
    step_edge_dynamics,
    step_rigid_body,
    stiffness_value,
    tetra_mass_properties,
    tetra_volume,
)


def _geometry(
    vertices: Any,
    *,
    edges: Any = (),
    faces: Any = (),
    volumes: Any = (),
    vertex_properties: Any | None = None,
    edge_properties: Any | None = None,
    face_properties: Any | None = None,
    volume_properties: Any | None = None,
) -> PhysicsGeometry:
    return PhysicsGeometry.from_vertices(
        vertices,
        edges=edges,
        faces=faces,
        volumes=volumes,
        vertex_properties=vertex_properties,
        edge_properties=edge_properties,
        face_properties=face_properties,
        volume_properties=volume_properties,
    )


def build_physics_namespace() -> dict[str, Any]:
    return {
        "ForceApplication": ForceApplication,
        "PhysicsGeometry": PhysicsGeometry,
        "RigidBodyState": RigidBodyState,
        "effective_vertex_masses": effective_vertex_masses,
        "edge_rotational_inertia": edge_rotational_inertia,
        "geometry": _geometry,
        "is_free_stiffness": is_free_stiffness,
        "is_rigid_stiffness": is_rigid_stiffness,
        "length": length,
        "orthogonal_spring_damper_edge_force": orthogonal_spring_damper_edge_force,
        "parallel_axis_shift": parallel_axis_shift,
        "polygon_area": polygon_area,
        "rigid_body_mass_properties": rigid_body_mass_properties,
        "rotational_spring_damper_torque": rotational_spring_damper_torque,
        "spring_damper_edge_force": spring_damper_edge_force,
        "step_edge_dynamics": step_edge_dynamics,
        "step_rigid_body": step_rigid_body,
        "stiffness_value": stiffness_value,
        "tetra_mass_properties": tetra_mass_properties,
        "tetra_volume": tetra_volume,
    }
