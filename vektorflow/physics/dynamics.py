"""Time stepping for VKF physics geometry.

The first running-mode slice integrates edge linear dynamics and edge rotation
using the property names defined in ``physics_properties``.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Sequence

from vektorflow.physics.properties import Number, PhysicsGeometry, Vec


def _add(a: Sequence[Number], b: Sequence[Number]) -> Vec:
    if len(a) != len(b):
        raise ValueError("vector dimensions must match")
    return tuple(float(x) + float(y) for x, y in zip(a, b, strict=True))


def _scale(a: Sequence[Number], scalar: Number) -> Vec:
    return tuple(float(x) * float(scalar) for x in a)


def _zero(dims: int) -> Vec:
    return tuple(0.0 for _ in range(dims))


def effective_vertex_masses(geometry: PhysicsGeometry) -> tuple[float, ...]:
    """Return vertex masses after lumping edge/face/volume density masses."""

    masses = [geometry.mass("vertex", index) for index in range(len(geometry.vertices))]
    for edge_index, edge in enumerate(geometry.edges):
        edge_mass = geometry.mass("edge", edge_index)
        if edge_mass:
            share = edge_mass / len(edge)
            for vertex_index in edge:
                masses[vertex_index] += share
    for face_index, face in enumerate(geometry.faces):
        face_mass = geometry.mass("face", face_index)
        if face_mass:
            share = face_mass / len(face)
            for vertex_index in face:
                masses[vertex_index] += share
    for volume_index, volume in enumerate(geometry.volumes):
        volume_mass = geometry.mass("volume", volume_index)
        if volume_mass:
            share = volume_mass / len(volume)
            for vertex_index in volume:
                masses[vertex_index] += share
    return tuple(masses)


def edge_rotational_inertia(geometry: PhysicsGeometry, edge_index: int) -> float:
    """Resolve edge rotational inertia for running mode."""

    props = geometry.edge_properties.get(edge_index, {})
    if "I" in props:
        return float(props["I"])
    edge = geometry.edges[edge_index]
    masses = effective_vertex_masses(geometry)
    return geometry.L(edge_index) ** 2 * (masses[edge[0]] + masses[edge[1]]) / 4.0


def step_edge_dynamics(geometry: PhysicsGeometry, dt: Number) -> PhysicsGeometry:
    """Advance edge linear and rotational dynamics by ``dt``.

    Linear integration is semi-implicit Euler:
    force -> velocity -> position. Edge masses from ``rho_L`` are lumped onto
    vertices, so edges with density affect endpoint acceleration even when
    endpoint ``m`` is not explicitly authored.
    """

    dt_f = float(dt)
    if dt_f < 0.0:
        raise ValueError("dt must be non-negative")
    if not geometry.vertices:
        return geometry

    dims = len(geometry.vertices[0])
    vertices = [tuple(vertex) for vertex in geometry.vertices]
    vertex_props = {index: dict(props) for index, props in geometry.vertex_properties.items()}
    edge_props = {index: dict(props) for index, props in geometry.edge_properties.items()}

    masses = effective_vertex_masses(geometry)
    forces = [_zero(dims) for _ in vertices]
    for edge_index, edge in enumerate(geometry.edges):
        axial_0, axial_1, _ = geometry.edge_force(edge_index)
        forces[edge[0]] = _add(forces[edge[0]], axial_0)
        forces[edge[1]] = _add(forces[edge[1]], axial_1)

        perp_0, perp_1, _ = geometry.edge_orthogonal_force(edge_index)
        forces[edge[0]] = _add(forces[edge[0]], perp_0)
        forces[edge[1]] = _add(forces[edge[1]], perp_1)

    for index, point in enumerate(vertices):
        mass = masses[index]
        props = vertex_props.setdefault(index, {})
        velocity = tuple(float(value) for value in props.get("v", _zero(dims)))  # type: ignore[arg-type]
        if len(velocity) != dims:
            raise ValueError(f"vertex {index} velocity dimension does not match geometry")
        if mass > 0.0:
            acceleration = _scale(forces[index], 1.0 / mass)
            velocity = _add(velocity, _scale(acceleration, dt_f))
            point = _add(point, _scale(velocity, dt_f))
        props["m_eff"] = mass
        props["F"] = forces[index]
        props["v"] = velocity
        vertices[index] = point

    for edge_index in range(len(geometry.edges)):
        props = edge_props.setdefault(edge_index, {})
        torque = geometry.rotational_torque("edge", edge_index)
        inertia = edge_rotational_inertia(geometry, edge_index)
        omega = float(props.get("omega", props.get("w_scalar", 0.0)))
        theta = float(props.get("theta", props.get("angle", 0.0)))
        if inertia > 0.0:
            omega += (-torque / inertia) * dt_f
            theta += omega * dt_f
        props["I_eff"] = inertia
        props["tau"] = torque
        props["omega"] = omega
        props["theta"] = theta

    return PhysicsGeometry.from_vertices(
        vertices,
        edges=geometry.edges,
        faces=geometry.faces,
        volumes=geometry.volumes,
        vertex_properties=vertex_props,
        edge_properties=edge_props,
        face_properties=deepcopy(dict(geometry.face_properties)),
        volume_properties=deepcopy(dict(geometry.volume_properties)),
    )
