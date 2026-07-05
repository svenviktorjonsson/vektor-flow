"""VKF ``physics`` stdlib: dimensions, unit constants, and quantities."""

from __future__ import annotations

from dataclasses import dataclass
from math import isclose
from typing import Any, Callable


DimensionVector = tuple[float, float, float, float, float, float, float]
DIMENSION_NAMES = ("L", "T", "M", "K", "A", "Cd", "Mole")
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
    T: Quantity = Quantity(1.0, _dimension_at(1), "T")
    M: Quantity = Quantity(1.0, _dimension_at(2), "M")
    K: Quantity = Quantity(1.0, _dimension_at(3), "K")
    A: Quantity = Quantity(1.0, _dimension_at(4), "A")
    Cd: Quantity = Quantity(1.0, _dimension_at(5), "Cd")
    Mole: Quantity = Quantity(1.0, _dimension_at(6), "Mole")
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


def build_physics_namespace() -> dict[str, Any]:
    d = Dimensions()
    prefixes = Prefixes()
    metre = Quantity(1.0, d.L.dimension, "m")
    second = Quantity(1.0, d.T.dimension, "s")
    ns: dict[str, Any] = {
        "Quantity": Quantity,
        "dimensions": d,
        "prefixes": prefixes,
        "quantity": quantity,
        "unitless": unitless,
        "require_unitless": require_unitless,
        "one": Quantity(1.0, DIMENSIONLESS, "1"),
        "m": metre,
        "km": prefixes.k * metre,
        "cm": prefixes.c * metre,
        "mm": prefixes.m * metre,
        "um": prefixes.u * metre,
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
    }
    return ns
