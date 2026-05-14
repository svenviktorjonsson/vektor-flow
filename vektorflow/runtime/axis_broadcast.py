"""Outer (tensor) product along two different axis names on tagged collections."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from vektorflow.errors import EvalError

from .axis_tagged import AxisTaggedValue
from .multiset import Multiset
from .vfvector import VFVector


def axis_broadcast_binary(
    fn: Callable[[Any, Any], Any],
    a: AxisTaggedValue,
    b: AxisTaggedValue,
) -> Any:
    """Apply ``fn(x, y)`` for each ``x`` along ``a.idx`` and ``y`` along ``b.idx`` (outer product)."""
    ad, bd = a.data, b.data
    if isinstance(ad, VFVector) and isinstance(bd, VFVector):
        rows = [
            AxisTaggedValue(VFVector([fn(x, y) for y in bd]), b.idx)
            for x in ad
        ]
        return AxisTaggedValue(VFVector(rows), a.idx)
    if isinstance(ad, tuple) and isinstance(bd, tuple):
        rows = tuple(
            AxisTaggedValue(tuple(fn(x, y) for y in bd), b.idx)
            for x in ad
        )
        return AxisTaggedValue(rows, a.idx)
    if isinstance(ad, Multiset) or isinstance(bd, Multiset):
        raise EvalError("axis broadcast is not supported for multisets")
    raise EvalError(
        "axis broadcast needs both operands to be vectors or tuples "
        f"(got {type(ad).__name__!r} vs {type(bd).__name__!r})"
    )
