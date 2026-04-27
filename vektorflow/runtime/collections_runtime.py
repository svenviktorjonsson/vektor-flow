"""Runtime-owned collection factories and predicates.

This module is the narrow seam the stdlib/interpreter/native runtime can share
while Python is being removed from collection ownership.
"""

from __future__ import annotations

from typing import Any, Iterable

from ..errors import EvalError
from .multiset import Multiset
from .vflist import VFLinkedList
from .vfqueue import VFQueue
from .vmap import VMap


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


def runtime_collection_attr(value: Any, name: str) -> Any | None:
    if runtime_collection_kind(value) == "queue":
        if name == "put":
            return lambda item: value.put(item)
        if name == "get":
            return lambda: value.get()
        if name == "empty":
            return lambda: value.empty()
    return None


def runtime_collection_read_attr(value: Any, name: str) -> Any | None:
    if runtime_collection_kind(value) == "map":
        return runtime_collection_require_get(value, name)
    return runtime_collection_attr(value, name)


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
