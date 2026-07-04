"""Rigid-body mass properties and dynamics for VKF volume elements."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from vektorflow.physics.properties import Number, PhysicsGeometry, Vec

Mat3 = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


def _vec3(values: Sequence[Number]) -> tuple[float, float, float]:
    raw = tuple(float(value) for value in values)
    if len(raw) == 2:
        return (raw[0], raw[1], 0.0)
    if len(raw) == 3:
        return raw
    raise ValueError(f"expected 2D or 3D vector, got {len(raw)}D")


def _add(a: Sequence[Number], b: Sequence[Number]) -> tuple[float, float, float]:
    ax, ay, az = _vec3(a)
    bx, by, bz = _vec3(b)
    return (ax + bx, ay + by, az + bz)


def _sub(a: Sequence[Number], b: Sequence[Number]) -> tuple[float, float, float]:
    ax, ay, az = _vec3(a)
    bx, by, bz = _vec3(b)
    return (ax - bx, ay - by, az - bz)


def _scale(a: Sequence[Number], scalar: Number) -> tuple[float, float, float]:
    ax, ay, az = _vec3(a)
    s = float(scalar)
    return (ax * s, ay * s, az * s)


def _dot(a: Sequence[Number], b: Sequence[Number]) -> float:
    ax, ay, az = _vec3(a)
    bx, by, bz = _vec3(b)
    return ax * bx + ay * by + az * bz


def _cross(a: Sequence[Number], b: Sequence[Number]) -> tuple[float, float, float]:
    ax, ay, az = _vec3(a)
    bx, by, bz = _vec3(b)
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)


def _mat_add(a: Mat3, b: Mat3) -> Mat3:
    return tuple(tuple(a[row][col] + b[row][col] for col in range(3)) for row in range(3))  # type: ignore[return-value]


def _mat_scale(a: Mat3, scalar: Number) -> Mat3:
    s = float(scalar)
    return tuple(tuple(value * s for value in row) for row in a)  # type: ignore[return-value]


def _outer(a: Sequence[Number], b: Sequence[Number]) -> Mat3:
    av = _vec3(a)
    bv = _vec3(b)
    return tuple(tuple(av[row] * bv[col] for col in range(3)) for row in range(3))  # type: ignore[return-value]


def _identity() -> Mat3:
    return ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _inertia_from_second_moment(second_moment: Mat3, density: Number) -> Mat3:
    scaled = _mat_scale(second_moment, density)
    trace = scaled[0][0] + scaled[1][1] + scaled[2][2]
    return tuple(
        tuple((trace if row == col else 0.0) - scaled[row][col] for col in range(3)) for row in range(3)
    )  # type: ignore[return-value]


def parallel_axis_shift(mass: Number, displacement: Sequence[Number]) -> Mat3:
    d = _vec3(displacement)
    d2 = _dot(d, d)
    outer = _outer(d, d)
    return tuple(
        tuple(float(mass) * ((d2 if row == col else 0.0) - outer[row][col]) for col in range(3))
        for row in range(3)
    )  # type: ignore[return-value]


def _mat_vec_mul(a: Mat3, v: Sequence[Number]) -> tuple[float, float, float]:
    vx, vy, vz = _vec3(v)
    return (
        a[0][0] * vx + a[0][1] * vy + a[0][2] * vz,
        a[1][0] * vx + a[1][1] * vy + a[1][2] * vz,
        a[2][0] * vx + a[2][1] * vy + a[2][2] * vz,
    )


def _inverse_mat3(a: Mat3) -> Mat3:
    det = (
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    )
    if abs(det) < 1e-12:
        raise ValueError("inertia tensor is singular")
    inv_det = 1.0 / det
    return (
        (
            (a[1][1] * a[2][2] - a[1][2] * a[2][1]) * inv_det,
            (a[0][2] * a[2][1] - a[0][1] * a[2][2]) * inv_det,
            (a[0][1] * a[1][2] - a[0][2] * a[1][1]) * inv_det,
        ),
        (
            (a[1][2] * a[2][0] - a[1][0] * a[2][2]) * inv_det,
            (a[0][0] * a[2][2] - a[0][2] * a[2][0]) * inv_det,
            (a[0][2] * a[1][0] - a[0][0] * a[1][2]) * inv_det,
        ),
        (
            (a[1][0] * a[2][1] - a[1][1] * a[2][0]) * inv_det,
            (a[0][1] * a[2][0] - a[0][0] * a[2][1]) * inv_det,
            (a[0][0] * a[1][1] - a[0][1] * a[1][0]) * inv_det,
        ),
    )


@dataclass(frozen=True)
class RigidBodyMassProperties:
    __vf_py_attrs__ = True

    mass: float
    center_of_mass: tuple[float, float, float]
    inertia_tensor: Mat3


@dataclass(frozen=True)
class ForceApplication:
    __vf_py_attrs__ = True

    force: tuple[float, float, float]
    point: tuple[float, float, float]


@dataclass(frozen=True)
class RigidBodyState:
    __vf_py_attrs__ = True

    position: tuple[float, float, float]
    velocity: tuple[float, float, float]
    angular_velocity: tuple[float, float, float] = (0.0, 0.0, 0.0)


def tetra_mass_properties(
    vertices: Sequence[Sequence[Number]], volume: Sequence[int], *, density: Number
) -> RigidBodyMassProperties:
    points = [_vec3(vertices[index]) for index in volume]
    if len(points) != 4:
        raise ValueError("tetra mass properties require a 4-vertex volume element")
    a, b, c, d = points
    signed_six_volume = _dot(_sub(b, a), _cross(_sub(c, a), _sub(d, a)))
    element_volume = abs(signed_six_volume) / 6.0
    mass = element_volume * float(density)
    center = _scale(_add(_add(a, b), _add(c, d)), 0.25)

    summed = (0.0, 0.0, 0.0)
    second_moment = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    for point in points:
        summed = _add(summed, point)
        second_moment = _mat_add(second_moment, _outer(point, point))
    second_moment = _mat_add(second_moment, _outer(summed, summed))
    second_moment = _mat_scale(second_moment, element_volume / 20.0)
    inertia_origin = _inertia_from_second_moment(second_moment, density)
    inertia_center = _mat_add(inertia_origin, _mat_scale(parallel_axis_shift(mass, center), -1.0))
    return RigidBodyMassProperties(mass=mass, center_of_mass=center, inertia_tensor=inertia_center)


def rigid_body_mass_properties(geometry: PhysicsGeometry, *, density: Number | None = None) -> RigidBodyMassProperties:
    parts: list[RigidBodyMassProperties] = []
    for index, volume in enumerate(geometry.volumes):
        props = geometry.volume_properties.get(index, {})
        rho = float(density if density is not None else props.get("rho_V", 1.0))
        parts.append(tetra_mass_properties(geometry.vertices, volume, density=rho))
    if not parts:
        raise ValueError("rigid body mass properties require volume elements")

    total_mass = sum(part.mass for part in parts)
    if total_mass <= 0.0:
        raise ValueError("rigid body mass must be positive")
    weighted_center = (0.0, 0.0, 0.0)
    for part in parts:
        weighted_center = _add(weighted_center, _scale(part.center_of_mass, part.mass))
    center = _scale(weighted_center, 1.0 / total_mass)

    inertia = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    for part in parts:
        shift = parallel_axis_shift(part.mass, _sub(part.center_of_mass, center))
        inertia = _mat_add(inertia, _mat_add(part.inertia_tensor, shift))
    return RigidBodyMassProperties(mass=total_mass, center_of_mass=center, inertia_tensor=inertia)


def step_rigid_body(
    state: RigidBodyState,
    properties: RigidBodyMassProperties,
    dt: Number,
    *,
    gravity: Sequence[Number] = (0.0, 0.0, 0.0),
    forces: Sequence[ForceApplication] = (),
) -> RigidBodyState:
    dt_f = float(dt)
    if dt_f < 0.0:
        raise ValueError("dt must be non-negative")
    gravity_force = _scale(gravity, properties.mass)
    total_force = gravity_force
    total_torque = (0.0, 0.0, 0.0)
    center_world = _add(state.position, properties.center_of_mass)
    for applied in forces:
        total_force = _add(total_force, applied.force)
        total_torque = _add(total_torque, _cross(_sub(applied.point, center_world), applied.force))
    acceleration = _scale(total_force, 1.0 / properties.mass)
    velocity = _add(state.velocity, _scale(acceleration, dt_f))
    position = _add(state.position, _scale(velocity, dt_f))
    angular_acceleration = _mat_vec_mul(_inverse_mat3(properties.inertia_tensor), total_torque)
    angular_velocity = _add(state.angular_velocity, _scale(angular_acceleration, dt_f))
    return RigidBodyState(position=position, velocity=velocity, angular_velocity=angular_velocity)
