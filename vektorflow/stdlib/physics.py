"""VKF ``physics`` stdlib: dimensions, unit constants, and quantities."""

from __future__ import annotations

from dataclasses import dataclass
from math import isclose
from typing import Any, Callable

from vektorflow.physics.hard_discs import HardDisc, HardDiscSnapshot, HardDiscWorld2D


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


def hard_disc_world(discs: Any, width: Any = 1.0, height: Any = 1.0) -> HardDiscWorld2D:
    """Create an event-driven 2D hard-disc collision world."""

    return HardDiscWorld2D(tuple(discs), width=float(width), height=float(height))


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


def demo_hard_discs() -> tuple[HardDisc, ...]:
    """Default 10-disc VKF collision proof setup."""

    return (
        disc(0.15, 0.18, 0.34, 0.20, 0.045, 0.75),
        disc(0.33, 0.16, 0.23, 0.30, 0.060, 1.35),
        disc(0.55, 0.16, -0.18, 0.34, 0.040, 1.95),
        disc(0.78, 0.20, -0.29, 0.24, 0.070, 2.60),
        disc(1.04, 0.18, -0.35, 0.20, 0.050, 3.30),
        disc(0.20, 0.50, 0.31, -0.25, 0.065, 1.05),
        disc(0.45, 0.45, 0.25, -0.23, 0.048, 1.65),
        disc(0.66, 0.53, -0.30, -0.28, 0.055, 2.25),
        disc(0.90, 0.48, -0.32, -0.18, 0.042, 2.90),
        disc(1.08, 0.63, -0.20, -0.31, 0.058, 3.70),
    )


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
        "disc": disc,
        "hard_disc_world": hard_disc_world,
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
        "demo_hard_discs": demo_hard_discs,
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
