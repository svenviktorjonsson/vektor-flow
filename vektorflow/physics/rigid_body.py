"""Compatibility adapters for the canonical VKF rigid-body kernel.

Physics formulas live in ``compiler/self_hosted/stdlib/physics.vkf``. Native
and WASM hosts compile that source; this module preserves the historical Python
API for tooling and tests without maintaining a second implementation.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

from vektorflow.physics.properties import Number, PhysicsGeometry

Mat3 = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
Vec3 = tuple[float, float, float]
_KERNEL_PATH = Path(__file__).resolve().parents[2] / "compiler" / "self_hosted" / "stdlib" / "physics.vkf"


def _real(value: Any) -> float:
    result = complex(value)
    if abs(result.imag) > 1e-12:
        raise ValueError("rigid-body kernel returned a non-real value")
    return float(result.real)


def _vec3(values: Sequence[Number]) -> Vec3:
    raw = tuple(_real(value) for value in values)
    if len(raw) == 2:
        return (raw[0], raw[1], 0.0)
    if len(raw) == 3:
        return raw
    raise ValueError(f"expected 2D or 3D vector, got {len(raw)}D")


def _mat3(values: Sequence[Sequence[Number]]) -> Mat3:
    rows = tuple(_vec3(row) for row in values)
    if len(rows) != 3:
        raise ValueError("expected a 3x3 matrix")
    return rows  # type: ignore[return-value]


@lru_cache(maxsize=1)
def _kernel() -> dict[str, Any]:
    # Lazy imports avoid the interpreter -> stdlib.physics -> physics package
    # cycle during interpreter startup.
    from vektorflow.interpreter import Interpreter
    from vektorflow.parser import parse_module

    source = _KERNEL_PATH.read_text(encoding="utf-8")
    interpreter = Interpreter(file_path=_KERNEL_PATH)
    interpreter.run_module(parse_module(source, filename=_KERNEL_PATH.as_posix()))
    return interpreter.globals


def _call(name: str, *args: Any) -> Any:
    return _kernel()[name](*args)


@dataclass(frozen=True)
class RigidBodyMassProperties:
    __vf_py_attrs__ = True

    mass: float
    center_of_mass: Vec3
    inertia_tensor: Mat3


@dataclass(frozen=True)
class ForceApplication:
    __vf_py_attrs__ = True

    force: Vec3
    point: Vec3


@dataclass(frozen=True)
class RigidBodyState:
    __vf_py_attrs__ = True

    position: Vec3
    velocity: Vec3
    angular_velocity: Vec3 = (0.0, 0.0, 0.0)


def _properties(record: dict[str, Any]) -> RigidBodyMassProperties:
    return RigidBodyMassProperties(
        mass=_real(record["mass"]),
        center_of_mass=_vec3(record["center_of_mass"]),
        inertia_tensor=_mat3(record["inertia_tensor"]),
    )


def _properties_record(properties: RigidBodyMassProperties) -> dict[str, Any]:
    return {
        "mass": properties.mass,
        "center_of_mass": list(properties.center_of_mass),
        "inertia_tensor": [list(row) for row in properties.inertia_tensor],
    }


def parallel_axis_shift(mass: Number, displacement: Sequence[Number]) -> Mat3:
    return _mat3(_call("parallel_axis_shift3", _real(mass), list(_vec3(displacement))))


def tetra_mass_properties(
    vertices: Sequence[Sequence[Number]], volume: Sequence[int], *, density: Number
) -> RigidBodyMassProperties:
    points = [_vec3(vertices[index]) for index in volume]
    if len(points) != 4:
        raise ValueError("tetra mass properties require a 4-vertex volume element")
    return _properties(_call("tetra_mass_properties3", *[list(point) for point in points], _real(density)))


def rigid_body_mass_properties(geometry: PhysicsGeometry, *, density: Number | None = None) -> RigidBodyMassProperties:
    parts: list[dict[str, Any]] = []
    for index, volume in enumerate(geometry.volumes):
        configured = geometry.volume_properties.get(index, {})
        rho = _real(density if density is not None else configured.get("rho_V", 1.0))
        part = tetra_mass_properties(geometry.vertices, volume, density=rho)
        parts.append(_properties_record(part))
    if not parts:
        raise ValueError("rigid body mass properties require volume elements")
    combined = parts[0]
    for part in parts[1:]:
        combined = _call("combine_mass_properties3", combined, part)
    result = _properties(combined)
    if result.mass <= 0.0:
        raise ValueError("rigid body mass must be positive")
    return result


def step_rigid_body(
    state: RigidBodyState,
    properties: RigidBodyMassProperties,
    dt: Number,
    *,
    gravity: Sequence[Number] = (0.0, 0.0, 0.0),
    forces: Sequence[ForceApplication] = (),
) -> RigidBodyState:
    dt_value = _real(dt)
    if dt_value < 0.0:
        raise ValueError("dt must be non-negative")

    props = _properties_record(properties)
    momentum = _call("rb_scale3", properties.mass, list(_vec3(state.velocity)))
    angular_momentum = _call("rb_mat_vec3", props["inertia_tensor"], list(_vec3(state.angular_velocity)))
    total_force = _call("rb_scale3", properties.mass, list(_vec3(gravity)))
    total_torque = [0.0, 0.0, 0.0]
    center_world = _call("rb_add3", list(_vec3(state.position)), list(properties.center_of_mass))
    for applied in forces:
        application = _call("force_at_point3", list(_vec3(applied.force)), list(_vec3(applied.point)), center_world)
        total_force = _call("rb_add3", total_force, application["force"])
        total_torque = _call("rb_add3", total_torque, application["torque"])

    stepped = _call(
        "step_rigid_body_momentum3",
        {
            "position": list(_vec3(state.position)),
            "momentum": momentum,
            "angular_momentum": angular_momentum,
        },
        props,
        dt_value,
        total_force,
        total_torque,
    )
    return RigidBodyState(
        position=_vec3(stepped["position"]),
        velocity=_vec3(stepped["velocity"]),
        angular_velocity=_vec3(stepped["angular_velocity"]),
    )
