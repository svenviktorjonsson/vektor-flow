"""Values produced by axis tags such as ``-> i`` or suffixes ``_i``."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable
from typing import Any

from .multiset import Multiset
from .multiset import (
    multiset_count_floor_div,
    multiset_count_mod,
    multiset_difference,
    multiset_union,
)


@dataclass
class AxisTaggedValue:
    """Tuple vector, multiset, or positional tuple with axis labels (``idx``) for dimension matching."""

    data: Any  # tuple | Multiset
    idx: str

    def __repr__(self) -> str:
        return f"AxisTagged({self.data!r}, idx={self.idx!r})"


def is_axis_tagged_value(value: Any) -> bool:
    return isinstance(value, AxisTaggedValue)


def axis_tagged_wrap(value: Any, idx: str | None) -> Any:
    if idx is None:
        return value
    return AxisTaggedValue(value, idx)


def axis_tagged_data(value: Any) -> Any:
    if isinstance(value, AxisTaggedValue):
        return value.data
    return value


def axis_tagged_idx(value: Any) -> str | None:
    if isinstance(value, AxisTaggedValue):
        return value.idx
    return None


def axis_tagged_set_idx(value: Any, idx: str) -> bool:
    if not isinstance(value, AxisTaggedValue):
        return False
    value.idx = idx
    return True


def axis_tagged_stringify(value: Any, stringify_item: Any) -> str | None:
    if not isinstance(value, AxisTaggedValue):
        return None
    return stringify_item(value.data)


def _wrap_typed_multiset_result(result: Multiset, a: Multiset, b: Multiset) -> Any:
    from .type_values import combine_typed_multiset_types, wrap_typed_multiset_result

    return wrap_typed_multiset_result(result, combine_typed_multiset_types(a, b))


def _apply_scalar_axis_op(op: str, left: Any, right: Any, error_factory: Callable[[str], Exception]) -> Any:
    if op == "PLUS":
        return left + right
    if op == "MINUS":
        return left - right
    if op == "STAR":
        return left * right
    if op == "SLASH":
        return left / right
    if op == "FLOOR_DIV":
        return left // right
    if op == "PERCENT":
        return left % right
    raise error_factory(f"unsupported operator {op!r} for broadcast axis-tagged values")


def _axis_outer_tuple_op(
    op: str,
    left: tuple[Any, ...],
    right: tuple[Any, ...],
    error_factory: Callable[[str], Exception],
) -> tuple[Any, ...]:
    return tuple(
        tuple(_apply_scalar_axis_op(op, lv, rv, error_factory) for rv in right)
        for lv in left
    )


def _is_axis_sequence(value: Any) -> bool:
    return isinstance(value, (tuple, list))


def _axis_shape(value: Any) -> tuple[int, ...]:
    if not _is_axis_sequence(value):
        return ()
    seq = tuple(value)
    if not seq:
        return (0,)
    inner = _axis_shape(seq[0])
    for item in seq[1:]:
        if _axis_shape(item) != inner:
            raise ValueError("axis-tagged data must be rectangular")
    return (len(seq),) + inner


def _axis_value_at(value: Any, idx: str, coords: dict[str, int]) -> Any:
    cur = value
    for axis_name in idx:
        cur = cur[coords[axis_name]]
    return cur


def _build_axis_tensor(
    out_idx: str,
    shape_by_axis: dict[str, int],
    leaf: Callable[[dict[str, int]], Any],
) -> Any:
    def rec(axis_pos: int, coords: dict[str, int]) -> Any:
        if axis_pos >= len(out_idx):
            return leaf(coords)
        axis_name = out_idx[axis_pos]
        size = shape_by_axis[axis_name]
        return tuple(rec(axis_pos + 1, {**coords, axis_name: i}) for i in range(size))

    return rec(0, {})


def _axis_broadcast_tuple_op(
    op: str,
    left: Any,
    left_idx: str,
    right: Any,
    right_idx: str,
    error_factory: Callable[[str], Exception],
) -> tuple[Any, str]:
    left_shape = _axis_shape(left)
    right_shape = _axis_shape(right)
    if len(left_shape) != len(left_idx):
        raise error_factory(f"axis rank mismatch for left operand: idx {left_idx!r} vs shape {left_shape!r}")
    if len(right_shape) != len(right_idx):
        raise error_factory(f"axis rank mismatch for right operand: idx {right_idx!r} vs shape {right_shape!r}")

    shape_by_axis: dict[str, int] = {}
    for axis_name, size in zip(left_idx, left_shape):
        shape_by_axis[axis_name] = size
    for axis_name, size in zip(right_idx, right_shape):
        prev = shape_by_axis.get(axis_name)
        if prev is not None and prev != size:
            raise error_factory(f"axis length mismatch on {axis_name!r}: {prev} vs {size}")
        shape_by_axis[axis_name] = size

    out_idx = left_idx + "".join(axis_name for axis_name in right_idx if axis_name not in left_idx)
    result = _build_axis_tensor(
        out_idx,
        shape_by_axis,
        lambda coords: _apply_scalar_axis_op(
            op,
            _axis_value_at(left, left_idx, coords),
            _axis_value_at(right, right_idx, coords),
            error_factory,
        ),
    )
    return result, out_idx


def axis_tagged_binary_op(
    op: str,
    a: Any,
    b: Any,
    error_factory: Callable[[str], Exception],
) -> tuple[bool, Any]:
    if is_axis_tagged_value(a) and is_axis_tagged_value(b):
        a_idx = axis_tagged_idx(a)
        b_idx = axis_tagged_idx(b)
        ad, bd = axis_tagged_data(a), axis_tagged_data(b)
        if _is_axis_sequence(ad) and _is_axis_sequence(bd) and op in {"PLUS", "MINUS", "STAR", "SLASH", "FLOOR_DIV", "PERCENT"}:
            result, out_idx = _axis_broadcast_tuple_op(op, ad, a_idx or "", bd, b_idx or "", error_factory)
            return True, axis_tagged_wrap(result, out_idx)
        if a_idx != b_idx:
            if isinstance(ad, tuple) and isinstance(bd, tuple) and set(a_idx or "").isdisjoint(set(b_idx or "")):
                if op in {"PLUS", "MINUS", "STAR", "SLASH", "FLOOR_DIV", "PERCENT"}:
                    return True, axis_tagged_wrap(_axis_outer_tuple_op(op, ad, bd, error_factory), f"{a_idx}{b_idx}")
            raise error_factory(f"axis mismatch: {a_idx!r} vs {b_idx!r}")
        if op == "AMPERSAND":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                return True, axis_tagged_wrap(ad + bd, a_idx)
            if isinstance(ad, list) and isinstance(bd, list):
                return True, axis_tagged_wrap(ad + bd, a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    _wrap_typed_multiset_result(multiset_union(ad, bd), ad, bd),
                    a_idx,
                )
            raise error_factory(
                "unsupported types inside axis-tagged values for & (use tuple, vector, or multiset)"
            )
        if op == "PLUS":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for +")
                return True, axis_tagged_wrap(tuple(x + y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    _wrap_typed_multiset_result(multiset_union(ad, bd), ad, bd),
                    a_idx,
                )
        if op == "MINUS":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for -")
                return True, axis_tagged_wrap(tuple(x - y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    _wrap_typed_multiset_result(multiset_difference(ad, bd), ad, bd),
                    a_idx,
                )
        if op == "STAR":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for *")
                return True, axis_tagged_wrap(tuple(x * y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                raise error_factory("operator * is not defined for multisets; use +, -, //, or % on counts")
        if op == "SLASH":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for /")
                return True, axis_tagged_wrap(tuple(x / y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                raise error_factory("operator / is not defined for multisets; use +, -, //, or % on counts")
        if op == "FLOOR_DIV":
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    _wrap_typed_multiset_result(multiset_count_floor_div(ad, bd), ad, bd),
                    a_idx,
                )
        if op == "PERCENT":
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    _wrap_typed_multiset_result(multiset_count_mod(ad, bd), ad, bd),
                    a_idx,
                )
        raise error_factory(
            f"unsupported operator {op!r} for two axis-tagged values of these types"
        )
    if op == "STAR":
        if is_axis_tagged_value(a) and isinstance(b, (int, float)):
            if isinstance(axis_tagged_data(a), tuple):
                bf = float(b)
                return True, axis_tagged_wrap(tuple(bf * x for x in axis_tagged_data(a)), axis_tagged_idx(a))
        if is_axis_tagged_value(b) and isinstance(a, (int, float)):
            if isinstance(axis_tagged_data(b), tuple):
                af = float(a)
                return True, axis_tagged_wrap(tuple(af * x for x in axis_tagged_data(b)), axis_tagged_idx(b))
    if is_axis_tagged_value(a) or is_axis_tagged_value(b):
        raise error_factory("cannot mix axis-tagged and untagged operands")
    return False, None
