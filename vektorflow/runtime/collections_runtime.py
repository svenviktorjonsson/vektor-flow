"""Runtime-owned collection factories and predicates.

This module is the narrow seam the stdlib/interpreter/native runtime can share
while Python is being removed from collection ownership.
"""

from __future__ import annotations

from typing import Any, Iterable

from .multiset import Multiset
from .vflist import VFLinkedList
from .vfqueue import VFQueue
from .vmap import VMap


def make_vmap(initial: dict[Any, Any] | None = None) -> VMap:
    return VMap(initial)


def make_vflist(values: Iterable[Any] | None = None) -> VFLinkedList:
    if values is None:
        return VFLinkedList()
    return VFLinkedList.from_iterable(values)


def make_singleton_vflist(value: Any) -> VFLinkedList:
    return VFLinkedList.single(value)


def make_vfqueue(values: Iterable[Any] | None = None) -> VFQueue:
    if values is None:
        return VFQueue()
    return VFQueue.from_iterable(values)


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
