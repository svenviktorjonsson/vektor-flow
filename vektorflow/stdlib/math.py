"""Built-in ``math`` library for ``use("math")``.

Functions mirror common mathematical notation: ``lg`` = log10, ``lg2`` = log2,
``ln`` = natural log, ``log(x, y)`` = log base ``y`` of ``x``.
"""

from __future__ import annotations

import math as _m
from typing import Any, Callable


def _log_base(x: float, base: float) -> float:
    """``log_base(x, y)`` = log_y(x)."""
    if base <= 0 or base == 1:
        raise ValueError("log base must be positive and not 1")
    if x <= 0:
        raise ValueError("log argument must be positive")
    return _m.log(x) / _m.log(base)


def _map_unary_numeric(value: Any, fn: Callable[[Any], Any]) -> Any:
    """Apply a scalar math function across axis-tagged tensors recursively."""
    from vektorflow.runtime.axis_tagged import AxisTaggedValue
    from vektorflow.runtime.vfvector import VFVector

    if isinstance(value, AxisTaggedValue):
        return AxisTaggedValue(_map_unary_numeric(value.data, fn), value.idx)
    if isinstance(value, tuple):
        return tuple(_map_unary_numeric(item, fn) for item in value)
    if isinstance(value, VFVector):
        return VFVector(_map_unary_numeric(item, fn) for item in value)
    return fn(value)


def _lift_unary_numeric(fn: Callable[[Any], Any]) -> Callable[[Any], Any]:
    """Lift scalar math callables so VKF tensors keep their shape and axes."""

    def _wrapped(value: Any) -> Any:
        return _map_unary_numeric(value, fn)

    return _wrapped


def build_math_namespace() -> dict[str, Any]:
    """Namespace dict: names → callables (and ``abs`` → :func:`~vektorflow.runtime.absnorm.abs_or_norm`)."""
    from vektorflow.runtime.absnorm import abs_or_norm

    ns: dict[str, Any] = {
        "sin": _lift_unary_numeric(_m.sin),
        "cos": _lift_unary_numeric(_m.cos),
        "tan": _lift_unary_numeric(_m.tan),
        "sinh": _lift_unary_numeric(_m.sinh),
        "cosh": _lift_unary_numeric(_m.cosh),
        "tanh": _lift_unary_numeric(_m.tanh),
        "asin": _lift_unary_numeric(_m.asin),
        "acos": _lift_unary_numeric(_m.acos),
        "atan": _lift_unary_numeric(_m.atan),
        "atan2": _m.atan2,
        "asinh": _lift_unary_numeric(_m.asinh),
        "acosh": _lift_unary_numeric(_m.acosh),
        "atanh": _lift_unary_numeric(_m.atanh),
        "exp": _lift_unary_numeric(_m.exp),
        "ln": _lift_unary_numeric(_m.log),
        "lg": _lift_unary_numeric(_m.log10),
        "lg2": _lift_unary_numeric(_m.log2),
        "sqrt": _lift_unary_numeric(_m.sqrt),
        "log": _log_base,
        "abs": abs_or_norm,
        "pi": _m.pi,
        "e": _m.e,
        "tau": _m.tau,
    }
    return ns
