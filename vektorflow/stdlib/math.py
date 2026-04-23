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


def build_math_namespace() -> dict[str, Any]:
    """Namespace dict: names → callables (and ``abs`` → :func:`~vektorflow.runtime.absnorm.abs_or_norm`)."""
    from vektorflow.runtime.absnorm import abs_or_norm

    ns: dict[str, Any] = {
        "sin": _m.sin,
        "cos": _m.cos,
        "tan": _m.tan,
        "sinh": _m.sinh,
        "cosh": _m.cosh,
        "tanh": _m.tanh,
        "asin": _m.asin,
        "acos": _m.acos,
        "atan": _m.atan,
        "atan2": _m.atan2,
        "asinh": _m.asinh,
        "acosh": _m.acosh,
        "atanh": _m.atanh,
        "exp": _m.exp,
        "ln": _m.log,
        "lg": _m.log10,
        "lg2": _m.log2,
        "sqrt": _m.sqrt,
        "log": _log_base,
        "abs": abs_or_norm,
        "pi": _m.pi,
        "e": _m.e,
        "tau": _m.tau,
    }
    return ns
