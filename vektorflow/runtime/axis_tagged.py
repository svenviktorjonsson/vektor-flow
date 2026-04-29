"""Values produced by axis suffixes ``_``, ``_i``, ``_ij`` on literal vectors, tuples, or multisets."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable
from typing import Any

from .multiset import Multiset
from .multiset import (
    multiset_difference,
    multiset_intersection,
    multiset_symmetric_difference,
    multiset_union,
)
from .type_values import combine_typed_multiset_types, wrap_typed_multiset_result


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


def axis_tagged_binary_op(
    op: str,
    a: Any,
    b: Any,
    error_factory: Callable[[str], Exception],
) -> tuple[bool, Any]:
    if is_axis_tagged_value(a) and is_axis_tagged_value(b):
        a_idx = axis_tagged_idx(a)
        b_idx = axis_tagged_idx(b)
        if a_idx != b_idx:
            raise error_factory(f"axis mismatch: {a_idx!r} vs {b_idx!r}")
        ad, bd = axis_tagged_data(a), axis_tagged_data(b)
        if op == "AMPERSAND":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                return True, axis_tagged_wrap(ad + bd, a_idx)
            if isinstance(ad, list) and isinstance(bd, list):
                return True, axis_tagged_wrap(ad + bd, a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    wrap_typed_multiset_result(multiset_union(ad, bd), combine_typed_multiset_types(ad, bd)),
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
                    wrap_typed_multiset_result(multiset_union(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a_idx,
                )
        if op == "MINUS":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for -")
                return True, axis_tagged_wrap(tuple(x - y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    wrap_typed_multiset_result(multiset_difference(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a_idx,
                )
        if op == "STAR":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for *")
                return True, axis_tagged_wrap(tuple(x * y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    wrap_typed_multiset_result(multiset_intersection(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a_idx,
                )
        if op == "SLASH":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise error_factory("tuple length mismatch for /")
                return True, axis_tagged_wrap(tuple(x / y for x, y in zip(ad, bd)), a_idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return True, axis_tagged_wrap(
                    wrap_typed_multiset_result(
                        multiset_symmetric_difference(ad, bd), combine_typed_multiset_types(ad, bd)
                    ),
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
