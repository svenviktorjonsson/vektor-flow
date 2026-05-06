"""Built-in ``math`` library for ``use("math")``.

Functions mirror common mathematical notation: ``lg`` = log10, ``lg2`` = log2,
``ln`` = natural log, ``log(x, y)`` = log base ``y`` of ``x``.

Unary functions apply element-wise over tuple/vector/struct-shaped numeric
values and nested axis-tagged collections. ``atan2`` and ``log`` follow the
same shape rules as numeric operators: same-shape zip, scalar broadcast, and
axis outer product when tagged indices differ.
"""

from __future__ import annotations

import math as _m
from collections.abc import Callable
from typing import Any


def _log_base(x: float, base: float) -> float:
    """``log_base(x, y)`` = log_y(x)."""
    if base <= 0 or base == 1:
        raise ValueError("log base must be positive and not 1")
    if x <= 0:
        raise ValueError("log argument must be positive")
    return _m.log(x) / _m.log(base)


def _to_float(x: Any) -> float:
    if isinstance(x, bool):
        raise TypeError("expected a number, got 'bool'")
    if isinstance(x, (int, float)):
        return float(x)
    raise TypeError(f"expected a number, got {type(x).__name__!r}")


def map_unary(fn: Callable[[float], float], x: Any) -> Any:
    """Apply ``fn`` element-wise to vectors / tuples / axis-tagged collections."""
    from vektorflow.runtime.axis_tagged import AxisTaggedValue
    from vektorflow.runtime.struct_value import (
        VF_TYPE_KEY,
        get_type_name,
        is_struct_dict,
        with_type,
    )
    from vektorflow.runtime.typed_vector import TypedVector
    from vektorflow.runtime.vfvector import VFVector

    if isinstance(x, AxisTaggedValue):
        return AxisTaggedValue(map_unary(fn, x.data), x.idx)
    if isinstance(x, (VFVector, TypedVector)):
        return VFVector(fn(_to_float(t)) for t in x)
    if isinstance(x, list):
        return VFVector(fn(_to_float(t)) for t in x)
    if isinstance(x, tuple):
        return tuple(map_unary(fn, t) for t in x)
    if is_struct_dict(x):
        mapped = {
            key: map_unary(fn, value)
            for key, value in x.items()
            if key != VF_TYPE_KEY
        }
        return with_type(get_type_name(x), mapped)
    return fn(_to_float(x))


def map_binary(fn: Callable[[float, float], float], a: Any, b: Any) -> Any:
    """Binary ``fn`` on scalars; zip element-wise on same-length vectors; scalar broadcast; axis outer product when indices differ."""
    from vektorflow.runtime.axis_broadcast import axis_broadcast_binary
    from vektorflow.runtime.axis_tagged import AxisTaggedValue
    from vektorflow.runtime.struct_value import (
        VF_TYPE_KEY,
        get_type_name,
        is_struct_dict,
        with_type,
    )
    from vektorflow.runtime.typed_vector import TypedVector
    from vektorflow.runtime.vfvector import VFVector

    if isinstance(a, AxisTaggedValue) and isinstance(b, AxisTaggedValue):
        if a.idx != b.idx:
            return axis_broadcast_binary(
                lambda x, y: fn(_to_float(x), _to_float(y)), a, b
            )
        return AxisTaggedValue(map_binary(fn, a.data, b.data), a.idx)
    if isinstance(a, AxisTaggedValue):
        return AxisTaggedValue(map_binary(fn, a.data, b), a.idx)
    if isinstance(b, AxisTaggedValue):
        return AxisTaggedValue(map_binary(fn, a, b.data), b.idx)

    if is_struct_dict(a) and is_struct_dict(b):
        a_keys = [key for key in a if key != VF_TYPE_KEY]
        b_keys = [key for key in b if key != VF_TYPE_KEY]
        if a_keys != b_keys:
            raise ValueError(f"struct key mismatch ({a_keys} vs {b_keys})")
        mapped = {key: map_binary(fn, a[key], b[key]) for key in a_keys}
        return with_type(get_type_name(a), mapped)
    if is_struct_dict(a):
        mapped = {
            key: map_binary(fn, value, b)
            for key, value in a.items()
            if key != VF_TYPE_KEY
        }
        return with_type(get_type_name(a), mapped)
    if is_struct_dict(b):
        mapped = {
            key: map_binary(fn, a, value)
            for key, value in b.items()
            if key != VF_TYPE_KEY
        }
        return with_type(get_type_name(b), mapped)

    if isinstance(a, tuple) and isinstance(b, tuple):
        if len(a) != len(b):
            raise ValueError(f"tuple length mismatch ({len(a)} vs {len(b)})")
        return tuple(map_binary(fn, x, y) for x, y in zip(a, b))
    if isinstance(a, tuple):
        return tuple(map_binary(fn, x, b) for x in a)
    if isinstance(b, tuple):
        return tuple(map_binary(fn, a, y) for y in b)

    va = isinstance(a, (VFVector, TypedVector, list))
    vb = isinstance(b, (VFVector, TypedVector, list))
    if va and vb:
        if len(a) != len(b):
            raise ValueError(f"vector length mismatch ({len(a)} vs {len(b)})")
        return VFVector(fn(_to_float(x), _to_float(y)) for x, y in zip(a, b))
    if va:
        return VFVector(fn(_to_float(x), _to_float(b)) for x in a)
    if vb:
        return VFVector(fn(_to_float(a), _to_float(y)) for y in b)
    return fn(_to_float(a), _to_float(b))


def build_math_namespace() -> dict[str, Any]:
    """Namespace dict: names → callables (and ``abs`` → :func:`~vektorflow.runtime.absnorm.abs_or_norm`)."""
    from vektorflow.runtime.absnorm import abs_or_norm

    def u(f: Callable[[float], float]) -> Callable[[Any], Any]:
        return lambda x: map_unary(f, x)

    ns: dict[str, Any] = {
        "sin": u(_m.sin),
        "cos": u(_m.cos),
        "tan": u(_m.tan),
        "sinh": u(_m.sinh),
        "cosh": u(_m.cosh),
        "tanh": u(_m.tanh),
        "asin": u(_m.asin),
        "acos": u(_m.acos),
        "atan": u(_m.atan),
        "atan2": lambda y, x: map_binary(
            lambda yy, xx: _m.atan2(yy, xx), y, x
        ),
        "asinh": u(_m.asinh),
        "acosh": u(_m.acosh),
        "atanh": u(_m.atanh),
        "exp": u(_m.exp),
        "ln": u(_m.log),
        "lg": u(_m.log10),
        "lg2": u(_m.log2),
        "sqrt": u(_m.sqrt),
        "log": lambda x, base: map_binary(_log_base, x, base),
        "abs": abs_or_norm,
        "pi": _m.pi,
        "e": _m.e,
        "tau": _m.tau,
    }
    return ns
