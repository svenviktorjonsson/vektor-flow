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
