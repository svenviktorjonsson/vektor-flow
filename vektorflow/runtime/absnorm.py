"""Absolute value (scalar) and Euclidean norm (1D vector)."""

from __future__ import annotations

from collections.abc import Sequence
import math
from typing import Any

from .vfvector import VFVector


def _is_host_numeric_sequence(value: Any) -> bool:
    return isinstance(value, Sequence) and not isinstance(
        value,
        (str, bytes, bytearray, tuple, VFVector),
    )


def abs_or_norm(x: Any) -> float:
    """``|x|``: absolute value for numbers; Euclidean norm for a 1D numeric vector.

    A **vector** is a non-empty ``VFVector`` or ``tuple`` of real numbers (flat).
    Nested vectors / tuples (matrices / higher rank) are rejected.
    """
    if isinstance(x, (bool,)):
        raise TypeError("abs_or_norm is not defined for bool")
    if isinstance(x, (int, float)):
        return float(abs(x))
    if isinstance(x, (VFVector, tuple)) or _is_host_numeric_sequence(x):
        if len(x) == 0:
            raise ValueError("empty vector has no norm")
        for v in x:
            if isinstance(v, (VFVector, tuple)) or _is_host_numeric_sequence(v):
                raise TypeError(
                    "norm is only defined for 1D vectors for now (got nested sequence)"
                )
            if not isinstance(v, (int, float)):
                raise TypeError(f"vector elements must be numeric, got {type(v).__name__}")
        return float(math.sqrt(sum(float(t) * float(t) for t in x)))
    raise TypeError(f"abs_or_norm expects a number or 1D vector, got {type(x).__name__}")
