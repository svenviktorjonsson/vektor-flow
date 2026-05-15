"""Outer (tensor) product along two different axis names on tagged collections."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from vektorflow.errors import EvalError

from .axis_tagged import AxisTaggedValue
from .multiset import Multiset
from .vfvector import VFVector


def _is_axis_sequence(value: Any) -> bool:
    return isinstance(value, (tuple, VFVector))


def _map_right_tensor(
    fn: Callable[[Any, Any], Any],
    left_leaf: Any,
    right: Any,
) -> Any:
    if isinstance(right, tuple):
        return tuple(_map_right_tensor(fn, left_leaf, item) for item in right)
    if isinstance(right, VFVector):
        return VFVector(_map_right_tensor(fn, left_leaf, item) for item in right)
    return fn(left_leaf, right)


def _append_right_axis(
    fn: Callable[[Any, Any], Any],
    left: Any,
    right: Any,
) -> Any:
    if isinstance(left, tuple):
        return tuple(_append_right_axis(fn, item, right) for item in left)
    if isinstance(left, VFVector):
        return VFVector(_append_right_axis(fn, item, right) for item in left)
    return _map_right_tensor(fn, left, right)


def axis_broadcast_binary(
    fn: Callable[[Any, Any], Any],
    a: AxisTaggedValue,
    b: AxisTaggedValue,
) -> Any:
    """Apply ``fn(x, y)`` across two tagged axes and return one combined tensor.

    Older code returned nested ``AxisTaggedValue`` rows. That made printing look
    roughly right, but it lost the true tensor signature (`u` instead of `uv`).
    Geometry sugar needs the signature to describe the full rank.
    """
    ad, bd = a.data, b.data
    if isinstance(ad, Multiset) or isinstance(bd, Multiset):
        raise EvalError("axis broadcast is not supported for multisets")
    if _is_axis_sequence(ad) and _is_axis_sequence(bd):
        rows = _append_right_axis(fn, ad, bd)
        return AxisTaggedValue(rows, f"{a.idx}{b.idx}")
    raise EvalError(
        "axis broadcast needs both operands to be vectors or tuples "
        f"(got {type(ad).__name__!r} vs {type(bd).__name__!r})"
    )
