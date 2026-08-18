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


def _axis_shape(value: Any, rank: int) -> tuple[int, ...]:
    shape: list[int] = []
    level = value
    for _ in range(rank):
        if not _is_axis_sequence(level):
            raise EvalError("axis-tagged data rank does not match its axis signature")
        shape.append(len(level))
        level = level[0] if level else ()
    return tuple(shape)


def _axis_get(value: Any, indices: tuple[int, ...]) -> Any:
    out = value
    for index in indices:
        out = out[index]
    return out


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
    if not _is_axis_sequence(ad) or not _is_axis_sequence(bd):
        raise EvalError(
            "axis broadcast needs both operands to be vectors or tuples "
            f"(got {type(ad).__name__!r} vs {type(bd).__name__!r})"
        )

    a_axes = str(a.idx)
    b_axes = str(b.idx)
    out_axes = a_axes + "".join(axis for axis in b_axes if axis not in a_axes)
    a_shape = _axis_shape(ad, len(a_axes))
    b_shape = _axis_shape(bd, len(b_axes))
    sizes = {axis: a_shape[index] for index, axis in enumerate(a_axes)}
    for index, axis in enumerate(b_axes):
        if axis in sizes and sizes[axis] != b_shape[index]:
            raise EvalError(
                f"axis length mismatch for {axis!r}: {sizes[axis]} != {b_shape[index]}"
            )
        sizes[axis] = b_shape[index]

    coordinates: dict[str, int] = {}

    def build(depth: int) -> Any:
        if depth == len(out_axes):
            left_indices = tuple(coordinates[axis] for axis in a_axes)
            right_indices = tuple(coordinates[axis] for axis in b_axes)
            return fn(_axis_get(ad, left_indices), _axis_get(bd, right_indices))
        axis = out_axes[depth]
        values = []
        for index in range(sizes[axis]):
            coordinates[axis] = index
            values.append(build(depth + 1))
        return VFVector(values)

    return AxisTaggedValue(build(0), out_axes)
