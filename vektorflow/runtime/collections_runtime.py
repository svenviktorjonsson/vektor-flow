"""Runtime-owned collection factories and predicates.

This module is the narrow seam the stdlib/interpreter/native runtime can share
while Python is being removed from collection ownership.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

from ..errors import EvalError
from .multiset import Multiset
from .typed_vector import TypedVector
from .vflist import VFLinkedList
from .vfqueue import VFQueue
from .vmap import VMap
from .vfvector import VFVector


def _string_is_num(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    try:
        float(stripped)
        return True
    except ValueError:
        try:
            complex(stripped)
            return True
        except ValueError:
            return False


def _string_is_int(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    try:
        int(stripped)
        return True
    except ValueError:
        try:
            as_num = float(stripped)
        except ValueError:
            return False
        return as_num == int(as_num)


def _string_is_bool(text: str) -> bool:
    stripped = text.strip().lower()
    return stripped in {"true", "false"}


def make_vmap(initial: dict[Any, Any] | None = None) -> VMap:
    return VMap(initial)


def make_vmap_from_call(
    pos: list[Any],
    kw: dict[str, Any],
    spreads: list[Any],
) -> VMap:
    if pos or spreads:
        raise EvalError("map() only accepts keyword-style pairs (x:value, …)")
    return make_vmap(kw)


def make_vflist(values: Iterable[Any] | None = None) -> VFLinkedList:
    if values is None:
        return VFLinkedList()
    return VFLinkedList.from_iterable(values)


def make_singleton_vflist(value: Any) -> VFLinkedList:
    return VFLinkedList.single(value)


def make_vflist_from_values(values: list[Any]) -> VFLinkedList:
    if not values:
        return make_vflist()
    if len(values) == 1:
        return make_singleton_vflist(values[0])
    return make_vflist(values)


def make_vflist_from_call(
    pos: list[Any],
    kw: dict[str, Any],
    spreads: list[Any],
) -> VFLinkedList:
    if kw:
        raise EvalError("list() does not accept keyword arguments")
    if spreads:
        if pos or len(spreads) != 1:
            raise EvalError("list(:…) spread must be the only argument")
        try:
            return make_vflist(spreads[0])
        except TypeError as e:
            raise EvalError("list(:…) requires an iterable") from e
    return make_vflist_from_values(pos)


def make_vfqueue(values: Iterable[Any] | None = None) -> VFQueue:
    if values is None:
        return VFQueue()
    return VFQueue.from_iterable(values)


def make_vfqueue_from_call(
    pos: list[Any],
    kw: dict[str, Any],
    spreads: list[Any],
) -> VFQueue:
    if pos or kw or spreads:
        raise EvalError("queue() takes no arguments")
    return make_vfqueue()


def make_multiset(pairs: Iterable[tuple[Any, int]] | None = None) -> Multiset:
    if pairs is None:
        return Multiset()
    return Multiset.from_pairs(list(pairs))


def runtime_collection_ctor_call(
    value: Any,
    pos: list[Any],
    kw: dict[str, Any],
    spreads: list[Any],
) -> Any | None:
    ctor = getattr(value, "_vkf_ctor", None)
    if ctor in {"map", "list", "queue"}:
        return value._vkf_impl(pos, kw, spreads)
    return None


def runtime_collection_kind(value: Any) -> str | None:
    if isinstance(value, VMap):
        return "map"
    if isinstance(value, VFLinkedList):
        return "list"
    if isinstance(value, VFQueue):
        return "queue"
    if isinstance(value, Multiset):
        return "multiset"
    return None


def is_runtime_collection(value: Any) -> bool:
    return runtime_collection_kind(value) is not None


def runtime_collection_contains(value: Any, key: Any) -> bool:
    if runtime_collection_kind(value) == "map":
        return key in value
    return False


def runtime_collection_get(value: Any, key: Any) -> Any:
    if runtime_collection_kind(value) == "map":
        return value.get(key)
    raise TypeError("runtime_collection_get only supports map-like runtime collections")


def runtime_collection_require_get(
    value: Any,
    key: Any,
    *,
    missing_suffix: str = "",
) -> Any:
    if runtime_collection_kind(value) == "map":
        if not runtime_collection_contains(value, key):
            raise EvalError(f"missing key {key!r}{missing_suffix}")
        return runtime_collection_get(value, key)
    raise TypeError("runtime_collection_require_get only supports map-like runtime collections")


def runtime_collection_set(value: Any, key: Any, item: Any) -> None:
    if runtime_collection_kind(value) == "map":
        value.set(key, item)
        return
    raise TypeError("runtime_collection_set only supports map-like runtime collections")


def runtime_collection_assign(value: Any, key: Any, item: Any) -> bool:
    if runtime_collection_kind(value) == "map":
        runtime_collection_set(value, key, item)
        return True
    return False


def runtime_collection_assign_path(value: Any, keys: list[Any], item: Any) -> bool:
    if runtime_collection_kind(value) == "map":
        if len(keys) != 1:
            raise EvalError("multi-key map assignment is not supported")
        return runtime_collection_assign(value, keys[0], item)
    return False


def runtime_collection_index_get(value: Any, key: Any) -> Any:
    if runtime_collection_kind(value) == "map":
        return runtime_collection_require_get(value, key)
    raise TypeError("runtime_collection_index_get only supports map-like runtime collections")


def runtime_collection_index_read(value: Any, key: Any) -> tuple[bool, Any]:
    if runtime_collection_kind(value) == "map":
        return True, runtime_collection_index_get(value, key)
    if runtime_collection_kind(value) == "multiset":
        return True, value.count(key)
    return False, None


def runtime_collection_index_set(value: Any, key: Any, item: Any) -> bool:
    return runtime_collection_assign(value, key, item)


def runtime_collection_items_sorted(value: Any) -> list[tuple[Any, Any]]:
    kind = runtime_collection_kind(value)
    if kind == "map":
        items = list(value.items())
        items.sort(key=lambda kv: (str(type(kv[0]).__name__), str(kv[0])))
        return items
    if kind == "multiset":
        return value.items_sorted()
    raise TypeError("runtime_collection_items_sorted only supports map/multiset runtime collections")


def runtime_collection_keys_sorted(value: Any) -> list[Any]:
    if runtime_collection_kind(value) == "map":
        return [key for key, _value in runtime_collection_items_sorted(value)]
    raise TypeError("runtime_collection_keys_sorted only supports map-like runtime collections")


def runtime_collection_values(value: Any) -> tuple[Any, ...]:
    kind = runtime_collection_kind(value)
    if kind in {"list", "queue"}:
        return tuple(value)
    raise TypeError("runtime_collection_values only supports list/queue runtime collections")


def runtime_collection_expanded_values(value: Any) -> tuple[Any, ...]:
    kind = runtime_collection_kind(value)
    if kind in {"list", "queue"}:
        return runtime_collection_values(value)
    if kind == "multiset":
        return tuple(value.elements())
    raise TypeError(
        "runtime_collection_expanded_values only supports list/queue/multiset runtime collections"
    )


def runtime_collection_spill_values(value: Any) -> tuple[Any, ...]:
    if runtime_collection_kind(value) != "multiset":
        raise EvalError("[: …] multiset spill requires a multiset value")
    return runtime_collection_expanded_values(value)


def runtime_collection_mapped_result(
    value: Any,
    mapped_values: Iterable[Any],
) -> Any | None:
    if runtime_collection_kind(value) == "multiset":
        counts: Counter[Any] = Counter()
        for item in mapped_values:
            counts[item] += 1
        return make_multiset(counts.items())
    return None


def runtime_collection_pipe_result(
    value: Any,
    mapped_values: Iterable[Any],
) -> tuple[bool, Any]:
    mapped = runtime_collection_mapped_result(value, mapped_values)
    if mapped is not None:
        return True, mapped
    return False, None


def runtime_collection_preserves_pipe_result(value: Any) -> bool:
    return runtime_collection_kind(value) == "multiset"


def runtime_collection_elementwise_values(value: Any) -> tuple[Any, ...] | None:
    if runtime_collection_kind(value) == "multiset":
        return runtime_collection_expanded_values(value)
    return None


def runtime_collection_stringify(
    value: Any,
    stringify_item: Any,
) -> str | None:
    kind = runtime_collection_kind(value)
    if kind == "map":
        items = runtime_collection_items_sorted(value)
        inner = ", ".join(
            f"{stringify_item(key)}:{stringify_item(item)}" for key, item in items
        )
        return "{" + inner + "}"
    if kind in {"list", "queue"}:
        return "[" + ", ".join(stringify_item(item) for item in runtime_collection_values(value)) + "]"
    if kind == "multiset":
        pairs = runtime_collection_items_sorted(value)
        if not pairs:
            return "{}"
        inner = ", ".join(
            f"{stringify_item(key)}:{stringify_item(count)}" for key, count in pairs
        )
        return "{" + inner + "}"
    return None


def runtime_collection_multiset_from_values(values: Iterable[Any]) -> Multiset:
    counts: Counter[Any] = Counter()
    for item in values:
        counts[item] += 1
    return make_multiset(counts.items())


def runtime_collection_to_multiset(values: Iterable[Any]) -> Multiset:
    kind = runtime_collection_kind(values)
    if kind == "multiset":
        return runtime_collection_multiset_from_values(runtime_collection_expanded_values(values))
    if kind in {"list", "queue"}:
        return runtime_collection_multiset_from_values(runtime_collection_values(values))
    return runtime_collection_multiset_from_values(values)


def runtime_collection_multiset_from_count_pairs(
    pairs: Iterable[tuple[Any, Any]],
) -> Multiset:
    counts: dict[Any, int] = {}
    for key, count_value in pairs:
        if isinstance(count_value, bool) or not isinstance(count_value, (int, float)):
            raise EvalError("multiset count must be a number")
        count = int(count_value)
        if float(count_value) != float(count):
            raise EvalError("multiset count must be an integer")
        if count < 0:
            raise EvalError("multiset count must be non-negative")
        if count == 0:
            continue
        counts[key] = counts.get(key, 0) + count
    return make_multiset(counts.items())


def runtime_collection_attr(value: Any, name: str) -> Any | None:
    if runtime_collection_kind(value) == "queue":
        if name == "put":
            return lambda item: value.put(item)
        if name == "get":
            return lambda: value.get()
        if name == "empty":
            return lambda: value.empty()
    return None


def runtime_object_size_bits(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return 1
    if isinstance(value, int) and not isinstance(value, bool):
        return 64
    if isinstance(value, float):
        return 64
    if isinstance(value, complex):
        return 128
    if isinstance(value, str):
        return len(value.encode("utf-8")) * 8
    if isinstance(value, (bytes, bytearray)):
        return len(value) * 8
    if isinstance(value, VFVector):
        return sum(runtime_object_size_bits(item) for item in value)
    if isinstance(value, tuple):
        return sum(runtime_object_size_bits(item) for item in value)
    kind = runtime_collection_kind(value)
    if kind == "multiset":
        return sum(runtime_object_size_bits(key) * count for key, count in value.items_sorted())
    if kind in {"list", "queue"}:
        return sum(runtime_object_size_bits(item) for item in value)
    if kind == "map":
        return sum(runtime_object_size_bits(item) for item in value.values())
    if isinstance(value, dict):
        return sum(runtime_object_size_bits(item) for item in value.values())
    return 0


def runtime_object_length(value: Any) -> int | None:
    if isinstance(value, (str, bytes, bytearray, tuple, VFVector)):
        return len(value)
    kind = runtime_collection_kind(value)
    if kind in {"list", "queue", "map"}:
        return len(value)
    if kind == "multiset":
        return len(value._c)
    return None


def runtime_object_read_attr(value: Any, name: str) -> Any | None:
    if isinstance(value, dict):
        return None
    if isinstance(value, str):
        if name == "is_num":
            return lambda: _string_is_num(value)
        if name == "is_int":
            return lambda: _string_is_int(value)
        if name == "is_bool":
            return lambda: _string_is_bool(value)
    if name == "has":
        def _has(item: Any) -> bool:
            if isinstance(value, (str, bytes, bytearray, tuple, VFVector)):
                return item in value
            kind = runtime_collection_kind(value)
            if kind == "multiset":
                return value.count(item) > 0
            if kind == "map":
                return item in value
            if kind in {"list", "queue"}:
                for candidate in value:
                    if candidate == item:
                        return True
                return False
            raise EvalError("has expects a container")

        return _has
    if name == "count":
        def _count(*args: Any) -> int:
            if len(args) > 1:
                raise EvalError("count expects at most one argument")
            kind = runtime_collection_kind(value)
            if len(args) == 0:
                if isinstance(value, (str, bytes, bytearray, tuple, VFVector)):
                    return len(value)
                if kind == "multiset":
                    return value.total()
                if kind in {"list", "queue", "map"}:
                    return len(value)
                raise EvalError("count() expects a container")
            item = args[0]
            if isinstance(value, str):
                return value.count(str(item))
            if isinstance(value, (bytes, bytearray)):
                if not isinstance(item, (bytes, bytearray)):
                    return 0
                return bytes(value).count(bytes(item))
            if isinstance(value, (tuple, VFVector)):
                return sum(1 for candidate in value if candidate == item)
            if kind == "multiset":
                return value.count(item)
            if kind == "map":
                return 1 if item in value else 0
            if kind in {"list", "queue"}:
                return sum(1 for candidate in value if candidate == item)
            raise EvalError("count(value) expects a container")

        return _count
    if name == "size":
        return runtime_object_size_bits(value)
    length = runtime_object_length(value)
    if name == "length" and length is not None:
        return length
    if isinstance(value, VFVector):
        if name == "shape":
            return (len(value),)
        if name == "ndim":
            return 1
        if name == "length":
            return len(value)
        if name == "size":
            return runtime_object_size_bits(value)
    if isinstance(value, TypedVector) and value.vf_type_expr is not None and name == "shape":
        return (len(value),)
    kind = runtime_collection_kind(value)
    if kind == "multiset" and name == "count":
        return value.total()
    return runtime_collection_attr(value, name)


def runtime_collection_read_attr(value: Any, name: str) -> Any | None:
    generic = runtime_object_read_attr(value, name)
    if generic is not None:
        return generic
    if runtime_collection_kind(value) == "map":
        return runtime_collection_require_get(value, name)
    return None


def runtime_collection_path_step(
    value: Any,
    key: Any,
    *,
    missing_suffix: str = "",
) -> tuple[bool, Any]:
    if runtime_collection_kind(value) == "map":
        return True, runtime_collection_require_get(
            value, key, missing_suffix=missing_suffix
        )
    return False, None


def runtime_collection_take_prefix(value: Any, count: int) -> tuple[Any, ...]:
    kind = runtime_collection_kind(value)
    if kind in {"list", "queue"}:
        items: list[Any] = []
        for i, item in enumerate(value):
            if i >= count:
                break
            items.append(item)
        return tuple(items)
    raise TypeError("runtime_collection_take_prefix only supports list/queue runtime collections")


def runtime_collection_take(value: Any, count: int) -> tuple[Any, ...] | None:
    kind = runtime_collection_kind(value)
    if kind in {"list", "queue"}:
        return runtime_collection_take_prefix(value, count)
    if kind == "multiset":
        raise EvalError("take: use a sequence or iterator, not a multiset")
    return None
