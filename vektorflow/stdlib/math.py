"""Built-in ``math`` library for ``use("math")``.

Functions mirror common mathematical notation: ``lg`` = log10, ``lg2`` = log2,
``ln`` = natural log, ``log(x, y)`` = log base ``y`` of ``x``.
"""

from __future__ import annotations

import math as _m
import cmath as _cm
from typing import Any, Callable


def _clean_num(value: Any) -> Any:
    if isinstance(value, complex) and value.imag == 0:
        return float(value.real)
    return value


def _complex_unary(fn: Callable[[complex], complex]) -> Callable[[Any], Any]:
    def _wrapped(value: Any) -> Any:
        return _clean_num(fn(value))

    return _wrapped


def _log_base(x: Any, base: Any) -> Any:
    """``log_base(x, y)`` = log_y(x)."""
    if base == 1:
        raise ValueError("log base must be positive and not 1")
    return _clean_num(_cm.log(x) / _cm.log(base))


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
        "sin": _lift_unary_numeric(lambda value: _clean_num(_cm.sin(value))),
        "cos": _lift_unary_numeric(lambda value: _clean_num(_cm.cos(value))),
        "tan": _lift_unary_numeric(lambda value: _clean_num(_cm.tan(value))),
        "sec": _lift_unary_numeric(lambda value: 1 / _clean_num(_cm.cos(value))),
        "cot": _lift_unary_numeric(lambda value: 1 / _clean_num(_cm.tan(value))),
        "csc": _lift_unary_numeric(lambda value: 1 / _clean_num(_cm.sin(value))),
        "sinh": _lift_unary_numeric(_complex_unary(_cm.sinh)),
        "cosh": _lift_unary_numeric(_complex_unary(_cm.cosh)),
        "tanh": _lift_unary_numeric(_complex_unary(_cm.tanh)),
        "asin": _lift_unary_numeric(_complex_unary(_cm.asin)),
        "acos": _lift_unary_numeric(_complex_unary(_cm.acos)),
        "atan": _lift_unary_numeric(_complex_unary(_cm.atan)),
        "acot": _lift_unary_numeric(lambda value: _clean_num(_cm.atan(1 / value))),
        "asec": _lift_unary_numeric(lambda value: _clean_num(_cm.acos(1 / value))),
        "acsc": _lift_unary_numeric(lambda value: _clean_num(_cm.asin(1 / value))),
        "atan2": _m.atan2,
        "asinh": _lift_unary_numeric(_complex_unary(_cm.asinh)),
        "acosh": _lift_unary_numeric(_complex_unary(_cm.acosh)),
        "atanh": _lift_unary_numeric(_complex_unary(_cm.atanh)),
        "exp": _lift_unary_numeric(lambda value: _clean_num(_cm.exp(value))),
        "ln": _lift_unary_numeric(lambda value: _clean_num(_cm.log(value))),
        "lg": _lift_unary_numeric(_complex_unary(_cm.log10)),
        "lg2": _lift_unary_numeric(_complex_unary(lambda value: _cm.log(value, 2))),
        "sqrt": _lift_unary_numeric(lambda value: _clean_num(_cm.sqrt(value))),
        "gamma": _lift_unary_numeric(lambda value: _m.gamma(value)),
        "erf": _lift_unary_numeric(lambda value: _m.erf(value)),
        "log": _log_base,
        "abs": abs_or_norm,
        "pi": _m.pi,
        "e": _m.e,
        "tau": _m.tau,
    }
    return ns
