"""Absolute value (scalar) and Euclidean norm (1D vector)."""

from __future__ import annotations

import math
from typing import Any


def abs_or_norm(x: Any) -> float:
    """``|x|``: absolute value for numbers; Euclidean norm for a 1D numeric vector.

    A **vector** is a non-empty ``list`` or ``tuple`` of real numbers (flat).
    Nested lists (matrices / higher rank) are rejected.
    """
    if isinstance(x, (bool,)):
        raise TypeError("abs_or_norm is not defined for bool")
    if isinstance(x, (int, float)):
        return float(abs(x))
    if isinstance(x, (list, tuple)):
        if len(x) == 0:
            raise ValueError("empty vector has no norm")
        for v in x:
            if isinstance(v, (list, tuple)):
                raise TypeError(
                    "norm is only defined for 1D vectors for now (got nested sequence)"
                )
            if not isinstance(v, (int, float)):
                raise TypeError(f"vector elements must be numeric, got {type(v).__name__}")
        return float(math.sqrt(sum(float(t) * float(t) for t in x)))
    raise TypeError(f"abs_or_norm expects a number or 1D vector, got {type(x).__name__}")
