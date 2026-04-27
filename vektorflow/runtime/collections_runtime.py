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


def runtime_collection_set(value: Any, key: Any, item: Any) -> None:
    if runtime_collection_kind(value) == "map":
        value.set(key, item)
        return
    raise TypeError("runtime_collection_set only supports map-like runtime collections")


def runtime_collection_items_sorted(value: Any) -> list[tuple[Any, Any]]:
    if runtime_collection_kind(value) == "map":
        items = list(value.items())
        items.sort(key=lambda kv: (str(type(kv[0]).__name__), str(kv[0])))
        return items
    raise TypeError("runtime_collection_items_sorted only supports map-like runtime collections")
