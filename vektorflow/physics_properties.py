"""Geometry-derived physics properties for the VKF physics engine.

This module is intentionally small and deterministic: it gives the symbolic
and simulator layers one place to resolve canonical names such as L, A, V, m,
q, v, w, and I from authored geometry plus physics property dictionaries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Mapping, Sequence

Number = int | float
Vec = tuple[float, ...]
Mat3 = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


def _vec(values: Sequence[Number], *, dims: int | None = None) -> Vec:
    out = tuple(float(value) for value in values)
    if dims is not None and len(out) != dims:
        raise ValueError(f"expected {dims}D vector, got {len(out)}D")
    return out


def _vec3(values: Sequence[Number]) -> tuple[float, float, float]:
    raw = _vec(values)
    if len(raw) == 2:
        return (raw[0], raw[1], 0.0)
    if len(raw) == 3:
        return raw
    raise ValueError(f"expected 2D or 3D vector, got {len(raw)}D")


def _sub(a: Sequence[Number], b: Sequence[Number]) -> Vec:
    if len(a) != len(b):
        raise ValueError("vector dimensions must match")
    return tuple(float(x) - float(y) for x, y in zip(a, b, strict=True))


def _dot(a: Sequence[Number], b: Sequence[Number]) -> float:
    if len(a) != len(b):
        raise ValueError("vector dimensions must match")
    return sum(float(x) * float(y) for x, y in zip(a, b, strict=True))


def _cross3(a: Sequence[Number], b: Sequence[Number]) -> tuple[float, float, float]:
    ax, ay, az = _vec3(a)
    bx, by, bz = _vec3(b)
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)


def _norm(values: Sequence[Number]) -> float:
    return math.sqrt(sum(float(value) * float(value) for value in values))


def length(vertices: Sequence[Sequence[Number]], edge: tuple[int, int]) -> float:
    """Return L, the Euclidean length of an edge between two vertices."""

    return _norm(_sub(vertices[edge[1]], vertices[edge[0]]))


def polygon_area(vertices: Sequence[Sequence[Number]], face: Sequence[int]) -> float:
    """Return A for a polygon in 2D or a planar polygon embedded in 3D."""

    if len(face) < 3:
        return 0.0
    points = [_vec(vertices[index]) for index in face]
    dims = len(points[0])
    if any(len(point) != dims for point in points):
        raise ValueError("polygon vertices must have consistent dimensions")
    if dims == 2:
        total = 0.0
        for point, nxt in zip(points, [*points[1:], points[0]], strict=True):
            total += point[0] * nxt[1] - nxt[0] * point[1]
        return abs(total) * 0.5
    if dims == 3:
        normal = [0.0, 0.0, 0.0]
        for point, nxt in zip(points, [*points[1:], points[0]], strict=True):
            normal[0] += (point[1] - nxt[1]) * (point[2] + nxt[2])
            normal[1] += (point[2] - nxt[2]) * (point[0] + nxt[0])
            normal[2] += (point[0] - nxt[0]) * (point[1] + nxt[1])
        return 0.5 * _norm(normal)
    raise ValueError(f"polygon area supports 2D or 3D vertices, got {dims}D")


def tetra_volume(vertices: Sequence[Sequence[Number]], volume: Sequence[int]) -> float:
    """Return V for a tetrahedral volume element."""

    if len(volume) != 4:
        raise ValueError("only tetrahedral volume elements are supported in this first physics slice")
    a, b, c, d = (_vec3(vertices[index]) for index in volume)
    ab = _sub(b, a)
    ac = _sub(c, a)
    ad = _sub(d, a)
    return abs(_dot(ab, _cross3(ac, ad))) / 6.0


def centroid(vertices: Sequence[Sequence[Number]], indices: Sequence[int]) -> tuple[float, float, float]:
    points = [_vec3(vertices[index]) for index in indices]
    count = float(len(points))
    return (
        sum(point[0] for point in points) / count,
        sum(point[1] for point in points) / count,
        sum(point[2] for point in points) / count,
    )


def inertia_tensor_from_point_masses(
    point_masses: Sequence[tuple[Sequence[Number], Number]],
    *,
    about: Sequence[Number] = (0.0, 0.0, 0.0),
) -> Mat3:
    """Return I, the 3x3 inertia tensor for point masses around ``about``."""

    origin = _vec3(about)
    tensor = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    for point, mass in point_masses:
        px, py, pz = _sub(_vec3(point), origin)
        r2 = px * px + py * py + pz * pz
        coords = (px, py, pz)
        for row in range(3):
            for col in range(3):
                tensor[row][col] += float(mass) * ((r2 if row == col else 0.0) - coords[row] * coords[col])
    return (tuple(tensor[0]), tuple(tensor[1]), tuple(tensor[2]))  # type: ignore[return-value]


def spring_damper_edge_force(
    p0: Sequence[Number],
    p1: Sequence[Number],
    *,
    rest_length: Number,
    spring_constant: Number,
    damping: Number = 0.0,
    v0: Sequence[Number] | None = None,
    v1: Sequence[Number] | None = None,
) -> tuple[Vec, Vec, float]:
    """Return endpoint forces and tension for a damped spring along an edge."""

    delta = _sub(p1, p0)
    current_length = _norm(delta)
    if current_length == 0.0:
        raise ValueError("edge force is undefined for coincident vertices")
    direction = tuple(component / current_length for component in delta)
    relative_speed = 0.0
    if v0 is not None or v1 is not None:
        zero = tuple(0.0 for _ in delta)
        relative_velocity = _sub(v1 or zero, v0 or zero)
        relative_speed = _dot(relative_velocity, direction)
    tension = float(spring_constant) * (current_length - float(rest_length)) + float(damping) * relative_speed
    force_on_0 = tuple(tension * component for component in direction)
    force_on_1 = tuple(-component for component in force_on_0)
    return (force_on_0, force_on_1, tension)


def rotational_spring_damper_torque(
    angle: Number,
    *,
    rest_angle: Number = 0.0,
    angular_spring_constant: Number,
    angular_damping: Number = 0.0,
    angular_velocity: Number = 0.0,
) -> float:
    """Return torque from angular deviation and angular friction/damping.

    Positive torque follows positive angle deviation. Callers can negate it when
    applying a restoring torque in their chosen constraint orientation.
    """

    return float(angular_spring_constant) * (float(angle) - float(rest_angle)) + float(angular_damping) * float(
        angular_velocity
    )


@dataclass(frozen=True)
class PhysicsGeometry:
    vertices: tuple[Vec, ...]
    edges: tuple[tuple[int, int], ...] = ()
    faces: tuple[tuple[int, ...], ...] = ()
    volumes: tuple[tuple[int, ...], ...] = ()
    vertex_properties: Mapping[int, Mapping[str, object]] = field(default_factory=dict)
    edge_properties: Mapping[int, Mapping[str, object]] = field(default_factory=dict)
    face_properties: Mapping[int, Mapping[str, object]] = field(default_factory=dict)
    volume_properties: Mapping[int, Mapping[str, object]] = field(default_factory=dict)

    @classmethod
    def from_vertices(
        cls,
        vertices: Sequence[Sequence[Number]],
        *,
        edges: Sequence[tuple[int, int]] = (),
        faces: Sequence[Sequence[int]] = (),
        volumes: Sequence[Sequence[int]] = (),
        vertex_properties: Mapping[int, Mapping[str, object]] | None = None,
        edge_properties: Mapping[int, Mapping[str, object]] | None = None,
        face_properties: Mapping[int, Mapping[str, object]] | None = None,
        volume_properties: Mapping[int, Mapping[str, object]] | None = None,
    ) -> "PhysicsGeometry":
        return cls(
            vertices=tuple(_vec(vertex) for vertex in vertices),
            edges=tuple(edges),
            faces=tuple(tuple(face) for face in faces),
            volumes=tuple(tuple(volume) for volume in volumes),
            vertex_properties=vertex_properties or {},
            edge_properties=edge_properties or {},
            face_properties=face_properties or {},
            volume_properties=volume_properties or {},
        )

    def L(self, edge_index: int) -> float:
        return length(self.vertices, self.edges[edge_index])

    def A(self, face_index: int) -> float:
        return polygon_area(self.vertices, self.faces[face_index])

    def V(self, volume_index: int) -> float:
        return tetra_volume(self.vertices, self.volumes[volume_index])

    def velocity(self, element_kind: str, index: int) -> Vec:
        return _vec(self._properties(element_kind, index).get("v", ()))

    def angular_velocity(self, element_kind: str, index: int) -> Vec:
        return _vec(self._properties(element_kind, index).get("w", ()))

    def temperature(self, element_kind: str, index: int) -> float:
        return float(self._properties(element_kind, index).get("T", 0.0))

    def mass(self, element_kind: str, index: int) -> float:
        props = self._properties(element_kind, index)
        if "m" in props:
            return float(props["m"])
        if element_kind == "edge" and "rho_L" in props:
            return float(props["rho_L"]) * self.L(index)
        if element_kind == "face" and "rho_A" in props:
            return float(props["rho_A"]) * self.A(index)
        if element_kind == "volume" and "rho_V" in props:
            return float(props["rho_V"]) * self.V(index)
        return 0.0

    def charge(self, element_kind: str, index: int) -> float:
        props = self._properties(element_kind, index)
        if "q" in props:
            return float(props["q"])
        if element_kind == "edge" and "sigma_L" in props:
            return float(props["sigma_L"]) * self.L(index)
        if element_kind == "face" and "sigma_A" in props:
            return float(props["sigma_A"]) * self.A(index)
        if element_kind == "volume" and "sigma_V" in props:
            return float(props["sigma_V"]) * self.V(index)
        return 0.0

    def inertia_tensor(self, *, about: Sequence[Number] = (0.0, 0.0, 0.0)) -> Mat3:
        masses: list[tuple[Sequence[Number], float]] = []
        for index, point in enumerate(self.vertices):
            mass = self.mass("vertex", index)
            if mass:
                masses.append((point, mass))
        for index, edge in enumerate(self.edges):
            mass = self.mass("edge", index)
            if mass:
                masses.append((centroid(self.vertices, edge), mass))
        for index, face in enumerate(self.faces):
            mass = self.mass("face", index)
            if mass:
                masses.append((centroid(self.vertices, face), mass))
        for index, volume in enumerate(self.volumes):
            mass = self.mass("volume", index)
            if mass:
                masses.append((centroid(self.vertices, volume), mass))
        return inertia_tensor_from_point_masses(masses, about=about)

    def edge_force(self, edge_index: int) -> tuple[Vec, Vec, float]:
        props = self.edge_properties.get(edge_index, {})
        edge = self.edges[edge_index]
        return spring_damper_edge_force(
            self.vertices[edge[0]],
            self.vertices[edge[1]],
            rest_length=float(props.get("L0", props.get("rest_length", self.L(edge_index)))),
            spring_constant=float(props.get("k", props.get("spring_constant", 0.0))),
            damping=float(props.get("c", props.get("damping", 0.0))),
            v0=self.vertex_properties.get(edge[0], {}).get("v"),  # type: ignore[arg-type]
            v1=self.vertex_properties.get(edge[1], {}).get("v"),  # type: ignore[arg-type]
        )

    def rotational_torque(
        self,
        element_kind: str,
        index: int,
        *,
        angle: Number | None = None,
        angular_velocity: Number | None = None,
    ) -> float:
        props = self._properties(element_kind, index)
        current_angle = float(angle if angle is not None else props.get("theta", props.get("angle", 0.0)))
        current_angular_velocity = float(
            angular_velocity if angular_velocity is not None else props.get("omega", props.get("w_scalar", 0.0))
        )
        return rotational_spring_damper_torque(
            current_angle,
            rest_angle=float(props.get("theta0", props.get("rest_angle", 0.0))),
            angular_spring_constant=float(props.get("k_theta", props.get("angular_spring_constant", 0.0))),
            angular_damping=float(props.get("c_theta", props.get("angular_damping", props.get("angular_friction", 0.0)))),
            angular_velocity=current_angular_velocity,
        )

    def _properties(self, element_kind: str, index: int) -> Mapping[str, object]:
        if element_kind == "vertex":
            return self.vertex_properties.get(index, {})
        if element_kind == "edge":
            return self.edge_properties.get(index, {})
        if element_kind == "face":
            return self.face_properties.get(index, {})
        if element_kind == "volume":
            return self.volume_properties.get(index, {})
        raise ValueError(f"unknown physics element kind: {element_kind!r}")
