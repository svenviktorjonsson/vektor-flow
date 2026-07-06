"""VKF ``physics`` stdlib: dimensions, unit constants, and quantities."""

from __future__ import annotations

from dataclasses import dataclass
import math
from math import isclose
from typing import Any, Callable

from vektorflow.physics.gpu_hard_discs import hard_disc_gpu_kernel_spec
from vektorflow.physics.gpu_hard_spheres import hard_sphere_gpu_kernel_spec
from vektorflow.physics.gpu_pipeline import gpu_physics_pipeline_spec
from vektorflow.physics.hard_discs import HardDisc, HardDiscSnapshot, HardDiscWorld2D
from vektorflow.physics.hard_spheres import HardSphere, HardSphereSnapshot, HardSphereWorld3D, demo_hard_spheres


DimensionVector = tuple[float, float, float, float, float, float, float]
DIMENSION_NAMES = ("L", "M", "T", "Theta", "I", "N", "J")
DIMENSIONLESS: DimensionVector = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)


def _clean_scalar(value: float) -> int | float:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _add_dimensions(a: DimensionVector, b: DimensionVector) -> DimensionVector:
    return tuple(x + y for x, y in zip(a, b))  # type: ignore[return-value]


def _sub_dimensions(a: DimensionVector, b: DimensionVector) -> DimensionVector:
    return tuple(x - y for x, y in zip(a, b))  # type: ignore[return-value]


def _scale_dimension(a: DimensionVector, scale: float) -> DimensionVector:
    return tuple(x * scale for x in a)  # type: ignore[return-value]


def _dimension_at(index: int) -> DimensionVector:
    values = [0.0] * 7
    values[index] = 1.0
    return tuple(values)  # type: ignore[return-value]


def _dimension_label(dimension: DimensionVector) -> str:
    parts: list[str] = []
    for name, power in zip(DIMENSION_NAMES, dimension):
        if power == 0:
            continue
        if power == 1:
            parts.append(name)
        else:
            parts.append(f"{name}^{_clean_scalar(power)}")
    return "1" if not parts else " ".join(parts)


@dataclass(frozen=True)
class Quantity:
    """A VKF scalar value carrying a seven-basis physical dimension."""

    value: float = 1.0
    dimension: DimensionVector = DIMENSIONLESS
    symbol: str = ""
    __vf_py_attrs__ = True

    @property
    def unitless(self) -> bool:
        return self.dimension == DIMENSIONLESS

    @property
    def dim(self) -> DimensionVector:
        return self.dimension

    @property
    def dimension_label(self) -> str:
        return _dimension_label(self.dimension)

    def require_unitless(self, context: str = "operation") -> int | float:
        if not self.unitless:
            raise ValueError(f"{context} requires a unitless quantity, got {self.dimension_label}")
        return _clean_scalar(self.value)

    def _assert_same_dimension(self, other: "Quantity", op: str) -> None:
        if self.dimension != other.dimension:
            raise ValueError(
                f"cannot {op} quantities with dimensions "
                f"{self.dimension_label} and {other.dimension_label}"
            )

    def _coerce_quantity(self, other: Any) -> "Quantity":
        if isinstance(other, Quantity):
            return other
        if isinstance(other, (int, float)) and not isinstance(other, bool):
            return Quantity(float(other), DIMENSIONLESS)
        return NotImplemented  # type: ignore[return-value]

    def __add__(self, other: Any) -> "Quantity":
        rhs = self._coerce_quantity(other)
        if rhs is NotImplemented:
            return NotImplemented
        self._assert_same_dimension(rhs, "add")
        return Quantity(self.value + rhs.value, self.dimension)

    def __radd__(self, other: Any) -> "Quantity":
        return self.__add__(other)

    def __sub__(self, other: Any) -> "Quantity":
        rhs = self._coerce_quantity(other)
        if rhs is NotImplemented:
            return NotImplemented
        self._assert_same_dimension(rhs, "subtract")
        return Quantity(self.value - rhs.value, self.dimension)

    def __rsub__(self, other: Any) -> "Quantity":
        lhs = self._coerce_quantity(other)
        if lhs is NotImplemented:
            return NotImplemented
        lhs._assert_same_dimension(self, "subtract")
        return Quantity(lhs.value - self.value, self.dimension)

    def __mul__(self, other: Any) -> "Quantity":
        rhs = self._coerce_quantity(other)
        if rhs is NotImplemented:
            return NotImplemented
        return Quantity(self.value * rhs.value, _add_dimensions(self.dimension, rhs.dimension))

    def __rmul__(self, other: Any) -> "Quantity":
        return self.__mul__(other)

    def __truediv__(self, other: Any) -> "Quantity":
        rhs = self._coerce_quantity(other)
        if rhs is NotImplemented:
            return NotImplemented
        return Quantity(self.value / rhs.value, _sub_dimensions(self.dimension, rhs.dimension))

    def __rtruediv__(self, other: Any) -> "Quantity":
        lhs = self._coerce_quantity(other)
        if lhs is NotImplemented:
            return NotImplemented
        return Quantity(lhs.value / self.value, _sub_dimensions(lhs.dimension, self.dimension))

    def __pow__(self, other: Any) -> "Quantity":
        if isinstance(other, Quantity):
            exponent = other.require_unitless("quantity exponent")
        elif isinstance(other, (int, float)) and not isinstance(other, bool):
            exponent = other
        else:
            return NotImplemented
        return Quantity(self.value**exponent, _scale_dimension(self.dimension, float(exponent)))

    def __neg__(self) -> "Quantity":
        return Quantity(-self.value, self.dimension, self.symbol)

    def __pos__(self) -> "Quantity":
        return self

    def _compare(self, other: Any, op: Callable[[float, float], bool], name: str) -> bool:
        rhs = self._coerce_quantity(other)
        if rhs is NotImplemented:
            return NotImplemented  # type: ignore[return-value]
        self._assert_same_dimension(rhs, name)
        return op(self.value, rhs.value)

    def __lt__(self, other: Any) -> bool:
        return self._compare(other, lambda a, b: a < b, "compare")

    def __le__(self, other: Any) -> bool:
        return self._compare(other, lambda a, b: a <= b, "compare")

    def __gt__(self, other: Any) -> bool:
        return self._compare(other, lambda a, b: a > b, "compare")

    def __ge__(self, other: Any) -> bool:
        return self._compare(other, lambda a, b: a >= b, "compare")

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, (Quantity, int, float)) or isinstance(other, bool):
            return False
        rhs = self._coerce_quantity(other)
        self._assert_same_dimension(rhs, "equate")
        return isclose(self.value, rhs.value)

    def __str__(self) -> str:
        value = _clean_scalar(self.value)
        if self.symbol and self.value == 1:
            return self.symbol
        return f"{value} [{self.dimension_label}]"

    def __repr__(self) -> str:
        return f"Quantity(value={self.value!r}, dimension={self.dimension!r}, symbol={self.symbol!r})"


@dataclass(frozen=True)
class Dimensions:
    L: Quantity = Quantity(1.0, _dimension_at(0), "L")
    M: Quantity = Quantity(1.0, _dimension_at(1), "M")
    T: Quantity = Quantity(1.0, _dimension_at(2), "T")
    Theta: Quantity = Quantity(1.0, _dimension_at(3), "Theta")
    I: Quantity = Quantity(1.0, _dimension_at(4), "I")
    N: Quantity = Quantity(1.0, _dimension_at(5), "N")
    J: Quantity = Quantity(1.0, _dimension_at(6), "J")
    Th: Quantity = Theta
    temp: Quantity = Theta
    __vf_py_attrs__ = True


@dataclass(frozen=True)
class Prefixes:
    k: float = 1e3
    h: float = 1e2
    da: float = 1e1
    d: float = 1e-1
    c: float = 1e-2
    m: float = 1e-3
    u: float = 1e-6
    n: float = 1e-9
    p: float = 1e-12
    __vf_py_attrs__ = True


def quantity(value: Any = 1.0, dimension: Any = DIMENSIONLESS, symbol: str = "") -> Quantity:
    if isinstance(value, Quantity):
        if dimension != DIMENSIONLESS or symbol:
            raise ValueError("quantity(existing) cannot override dimension or symbol")
        return value
    if isinstance(dimension, Quantity):
        dimension = dimension.dimension
    return Quantity(float(value), tuple(float(x) for x in dimension), symbol)


def unitless(value: Any = 1.0) -> Quantity:
    return quantity(value, DIMENSIONLESS)


def require_unitless(value: Any, context: str = "function") -> Any:
    if isinstance(value, Quantity):
        return value.require_unitless(context)
    return value


def disc(x: Any, y: Any, vx: Any, vy: Any, radius: Any, density: Any = 1.0) -> HardDisc:
    """Create a 2D hard-disc vertex impostor for collision simulation."""

    return HardDisc(float(x), float(y), float(vx), float(vy), float(radius), float(density))


def hard_disc_world(
    discs: Any,
    width: Any = 1.0,
    height: Any = 1.0,
    restitution: Any = 1.0,
    gravity: Any = (0.0, 0.0),
) -> HardDiscWorld2D:
    """Create an event-driven 2D hard-disc collision world."""

    return HardDiscWorld2D(
        tuple(discs),
        width=float(width),
        height=float(height),
        restitution=float(restitution),
        gravity=(float(gravity[0]), float(gravity[1])),
    )


def sphere(x: Any, y: Any, z: Any, vx: Any, vy: Any, vz: Any, radius: Any, density: Any = 1.0) -> HardSphere:
    """Create a 3D hard-sphere collision impostor."""

    return HardSphere(float(x), float(y), float(z), float(vx), float(vy), float(vz), float(radius), float(density))


def hard_sphere_world(
    spheres: Any,
    width: Any = 1.0,
    depth: Any = 1.0,
    height: Any = 1.0,
    restitution: Any = 1.0,
    gravity: Any = (0.0, 0.0, -9.81),
) -> HardSphereWorld3D:
    """Create a 3D hard-sphere world inside a virtual box."""

    return HardSphereWorld3D(
        tuple(spheres),
        width=float(width),
        depth=float(depth),
        height=float(height),
        restitution=float(restitution),
        gravity=(float(gravity[0]), float(gravity[1]), float(gravity[2])),
    )


def snapshot_at(world: HardDiscWorld2D, time: Any) -> HardDiscSnapshot:
    """Advance ``world`` to ``time`` and return the exact analytic snapshot."""

    return world.advance_to(float(time))


def snapshot_disc(snapshot: HardDiscSnapshot, index: Any) -> HardDisc:
    return snapshot.discs[int(index)]


def snapshot_center(world: HardDiscWorld2D, snapshot: HardDiscSnapshot, index: Any, z: Any = 0.0) -> list[float]:
    """Return a render-space [x,y,z] center with the world centered on origin."""

    item = snapshot_disc(snapshot, index)
    return [item.x - world.width * 0.5, item.y - world.height * 0.5, float(z)]


def snapshot_radius(snapshot: HardDiscSnapshot, index: Any) -> float:
    return snapshot_disc(snapshot, index).radius


def snapshot_scale(snapshot: HardDiscSnapshot, index: Any, z: Any = 0.035) -> list[float]:
    radius = snapshot_radius(snapshot, index)
    return [radius * 2.0, radius * 2.0, float(z)]


def snapshot_kinetic_energy(snapshot: HardDiscSnapshot) -> float:
    return snapshot.kinetic_energy


def snapshot_min_gap(snapshot: HardDiscSnapshot) -> float:
    return snapshot.min_gap


def disc_impostors(
    world: HardDiscWorld2D,
    snapshot: HardDiscSnapshot,
    colors: Any = None,
    *,
    z: Any = 0.0,
) -> list[dict[str, Any]]:
    palette = list(colors) if colors is not None else []
    impostors: list[dict[str, Any]] = []
    for index, item in enumerate(snapshot.discs):
        impostors.append(
            {
                "x": item.x - world.width * 0.5,
                "y": item.y - world.height * 0.5,
                "z": float(z),
                "radius": item.radius,
                "color": palette[index % len(palette)] if palette else density_color(item.density),
                "density": item.density,
                "mass": item.mass,
            }
        )
    return impostors


class HardDiscImpostorDriver:
    __vf_py_attrs__ = True

    def __init__(self, world: HardDiscWorld2D, renderer: Any, colors: Any = None, *, z: Any = 0.0) -> None:
        self.world = world
        self.renderer = renderer
        self.colors = colors
        self.z = float(z)
        self.last_snapshot = world.snapshot()

    def step(self, time: Any, frame_index: Any = 0) -> "HardDiscImpostorDriver":
        self.last_snapshot = snapshot_at(self.world, time)
        self.renderer.render(disc_impostors(self.world, self.last_snapshot, self.colors, z=self.z))
        return self

    def finish(self) -> Any:
        if hasattr(self.renderer, "save_capture"):
            return self.renderer.save_capture()
        return None


def hard_disc_impostor_driver(world: HardDiscWorld2D, renderer: Any, colors: Any = None, z: Any = 0.0) -> HardDiscImpostorDriver:
    return HardDiscImpostorDriver(world, renderer, colors, z=z)


def hard_disc_gpu_runtime(
    discs: Any,
    *,
    width: Any = 1.0,
    height: Any = 1.0,
    restitution: Any = 1.0,
    gravity: Any = (0.0, 0.0),
    solver_iterations: Any = 3,
    contact_band_ratio: Any = 0.05,
    max_particles_per_cell: Any = 64,
) -> dict[str, Any]:
    """Return a VKF scene physics spec for WebGPU hard-disc impostors."""

    items = tuple(discs)
    kernel = hard_disc_gpu_kernel_spec()
    particles: list[float] = []
    max_radius = 0.0
    for item in items:
        radius = float(getattr(item, "radius"))
        density = float(getattr(item, "density"))
        mass = float(getattr(item, "mass"))
        particles.extend(
            [
                float(getattr(item, "x")),
                float(getattr(item, "y")),
                radius,
                density,
                float(getattr(item, "vx")),
                float(getattr(item, "vy")),
                mass,
                0.0,
            ]
        )
        max_radius = max(max_radius, radius)
    return {
        "kind": "hard_disc_2d",
        "collider_kind": kernel.collider_kind,
        "particle_count": len(items),
        "particle_stride_f32": kernel.particle_stride_f32,
        "workgroup_size": kernel.workgroup_size,
        "params_stride_f32": kernel.params_stride_f32,
        "width": float(width),
        "height": float(height),
        "restitution": float(restitution),
        "gravity": [float(gravity[0]), float(gravity[1])],
        "solver_iterations": int(solver_iterations),
        "contact_band_ratio": float(contact_band_ratio),
        "max_particles_per_cell": int(max_particles_per_cell),
        "max_radius": max_radius,
        "initial_particles": particles,
        "collision_matrix": [float(restitution), 0.0, 0.0, 1.0],
        "wgsl": kernel.wgsl,
        "pipeline": {
            "dimension": kernel.pipeline.dimension,
            "stages": [stage.kind for stage in kernel.pipeline.stages],
            "rigid_body_supported": kernel.pipeline.rigid_body_supported,
            "collision_matrix_supported": kernel.pipeline.collision_matrix_supported,
        },
    }


def hard_sphere_gpu_runtime(
    spheres: Any,
    *,
    width: Any = 1.0,
    depth: Any = 1.0,
    height: Any = 1.0,
    restitution: Any = 1.0,
    gravity: Any = (0.0, 0.0, -9.81),
    solver_iterations: Any = 4,
    contact_band_ratio: Any = 0.04,
    max_particles_per_cell: Any = 96,
) -> dict[str, Any]:
    """Return a VKF scene physics spec for WebGPU hard-sphere impostors."""

    items = tuple(spheres)
    kernel = hard_sphere_gpu_kernel_spec()
    particles: list[float] = []
    max_radius = 0.0
    for item in items:
        radius = float(getattr(item, "radius"))
        density = float(getattr(item, "density"))
        mass = float(getattr(item, "mass"))
        particles.extend(
            [
                float(getattr(item, "x")),
                float(getattr(item, "y")),
                float(getattr(item, "z")),
                radius,
                float(getattr(item, "vx")),
                float(getattr(item, "vy")),
                float(getattr(item, "vz")),
                density,
                mass,
                0.0,
                0.0,
                0.0,
            ]
        )
        max_radius = max(max_radius, radius)
    return {
        "kind": "hard_sphere_3d",
        "collider_kind": kernel.collider_kind,
        "particle_count": len(items),
        "particle_stride_f32": kernel.particle_stride_f32,
        "workgroup_size": kernel.workgroup_size,
        "params_stride_f32": kernel.params_stride_f32,
        "width": float(width),
        "depth": float(depth),
        "height": float(height),
        "restitution": float(restitution),
        "gravity": [float(gravity[0]), float(gravity[1]), float(gravity[2])],
        "solver_iterations": int(solver_iterations),
        "contact_band_ratio": float(contact_band_ratio),
        "max_particles_per_cell": int(max_particles_per_cell),
        "max_radius": max_radius,
        "initial_particles": particles,
        "collision_matrix": [float(restitution), 0.0, 0.0, 1.0],
        "wgsl": kernel.wgsl,
        "pipeline": {
            "dimension": kernel.pipeline.dimension,
            "stages": [stage.kind for stage in kernel.pipeline.stages],
            "rigid_body_supported": kernel.pipeline.rigid_body_supported,
            "collision_matrix_supported": kernel.pipeline.collision_matrix_supported,
        },
    }


def gpu_placeholder_axis(count: Any, value: Any = 0.0) -> list[float]:
    """Return a constant axis list used only to size GPU-driven impostor meshes."""

    return [float(value) for _ in range(max(0, int(count)))]


def demo_hard_discs(count: Any = 1000, width: Any = 1.20, height: Any = 0.80, speed_scale: Any = 1.0) -> tuple[HardDisc, ...]:
    """Deterministic non-overlapping hard-disc proof setup."""

    n = max(1, int(count))
    world_w = float(width)
    world_h = float(height)
    cols = max(1, math.ceil(math.sqrt(n * world_w / world_h)))
    rows = math.ceil(n / cols)
    cell_w = world_w / cols
    cell_h = world_h / rows
    base_radius = min(cell_w, cell_h) * 0.24
    out: list[HardDisc] = []
    for index in range(n):
        col = index % cols
        row = index // cols
        jitter_x = (((index * 37) % 17) - 8) / 8.0 * cell_w * 0.10
        jitter_y = (((index * 53) % 19) - 9) / 9.0 * cell_h * 0.10
        radius = base_radius * (0.72 + 0.24 * ((index * 11) % 7) / 6.0)
        x = (col + 0.5) * cell_w + jitter_x
        y = (row + 0.5) * cell_h + jitter_y
        x = min(world_w - radius, max(radius, x))
        y = min(world_h - radius, max(radius, y))
        angle = ((index * 137) % 360) * math.pi / 180.0
        speed = float(speed_scale) * (0.045 + 0.035 * ((index * 29) % 11) / 10.0)
        density = 0.75 + (3.70 - 0.75) * ((index * 23) % 101) / 100.0
        out.append(disc(x, y, math.cos(angle) * speed, math.sin(angle) * speed, radius, density))
    return tuple(out)


def density_color(density: Any) -> list[float]:
    """Map material density to one fill color; mass still uses density directly."""

    t = max(0.0, min(1.0, (float(density) - 0.75) / (3.70 - 0.75)))
    return [
        0.08 + 0.88 * t,
        0.72 - 0.28 * t,
        0.92 - 0.74 * t,
        1.0,
    ]


def disc_color(index: Any) -> list[float]:
    colors = (
        (0.10, 0.74, 0.92, 1.0),
        (0.98, 0.50, 0.45, 1.0),
        (0.54, 0.89, 0.36, 1.0),
        (1.00, 0.82, 0.25, 1.0),
        (0.70, 0.55, 0.98, 1.0),
        (0.98, 0.35, 0.72, 1.0),
        (0.35, 0.91, 0.75, 1.0),
        (0.93, 0.63, 0.27, 1.0),
        (0.50, 0.70, 1.00, 1.0),
        (0.86, 0.92, 0.38, 1.0),
    )
    return list(colors[int(index) % len(colors)])


def build_physics_namespace() -> dict[str, Any]:
    d = Dimensions()
    prefixes = Prefixes()
    metre = Quantity(1.0, d.L.dimension, "m")
    kilogram = Quantity(1.0, d.M.dimension, "kg")
    second = Quantity(1.0, d.T.dimension, "s")
    kelvin = Quantity(1.0, d.Theta.dimension, "K")
    ampere = Quantity(1.0, d.I.dimension, "A")
    mole = Quantity(1.0, d.N.dimension, "mol")
    candela = Quantity(1.0, d.J.dimension, "cd")
    ns: dict[str, Any] = {
        "Quantity": Quantity,
        "dimensions": d,
        "L": d.L,
        "M": d.M,
        "T": d.T,
        "Theta": d.Theta,
        "I": d.I,
        "N": d.N,
        "J": d.J,
        "Th": d.Th,
        "prefixes": prefixes,
        "quantity": quantity,
        "unitless": unitless,
        "require_unitless": require_unitless,
        "HardDisc": HardDisc,
        "HardDiscWorld2D": HardDiscWorld2D,
        "HardSphere": HardSphere,
        "HardSphereSnapshot": HardSphereSnapshot,
        "HardSphereWorld3D": HardSphereWorld3D,
        "disc": disc,
        "hard_disc_world": hard_disc_world,
        "sphere": sphere,
        "hard_sphere_world": hard_sphere_world,
        "snapshot_at": snapshot_at,
        "snapshot_disc": snapshot_disc,
        "snapshot_center": snapshot_center,
        "snapshot_radius": snapshot_radius,
        "snapshot_scale": snapshot_scale,
        "snapshot_kinetic_energy": snapshot_kinetic_energy,
        "snapshot_min_gap": snapshot_min_gap,
        "disc_impostors": disc_impostors,
        "HardDiscImpostorDriver": HardDiscImpostorDriver,
        "hard_disc_impostor_driver": hard_disc_impostor_driver,
        "hard_disc_gpu_runtime": hard_disc_gpu_runtime,
        "hard_sphere_gpu_runtime": hard_sphere_gpu_runtime,
        "gpu_placeholder_axis": gpu_placeholder_axis,
        "gpu_physics_pipeline_spec": gpu_physics_pipeline_spec,
        "hard_disc_gpu_kernel_spec": hard_disc_gpu_kernel_spec,
        "hard_sphere_gpu_kernel_spec": hard_sphere_gpu_kernel_spec,
        "demo_hard_discs": demo_hard_discs,
        "demo_hard_spheres": demo_hard_spheres,
        "density_color": density_color,
        "disc_color": disc_color,
        "one": Quantity(1.0, DIMENSIONLESS, "1"),
        "m": metre,
        "km": prefixes.k * metre,
        "cm": prefixes.c * metre,
        "mm": prefixes.m * metre,
        "um": prefixes.u * metre,
        "kg": kilogram,
        "g": prefixes.m * kilogram,
        "mg": prefixes.u * kilogram,
        "s": second,
        "sec": second,
        "second": second,
        "seconds": second,
        "min": 60 * second,
        "minute": 60 * second,
        "minutes": 60 * second,
        "h": 3600 * second,
        "hour": 3600 * second,
        "hours": 3600 * second,
        "d": 86400 * second,
        "day": 86400 * second,
        "days": 86400 * second,
        "month": 2629800 * second,
        "months": 2629800 * second,
        "y": 31557600 * second,
        "year": 31557600 * second,
        "years": 31557600 * second,
        "K": kelvin,
        "A": ampere,
        "mol": mole,
        "mole": mole,
        "moles": mole,
        "cd": candela,
        "candela": candela,
        "candelas": candela,
    }
    return ns
