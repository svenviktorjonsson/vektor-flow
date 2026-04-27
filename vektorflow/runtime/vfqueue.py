"""Runtime-owned FIFO queue for stdlib ``collections.queue`` and event pumps."""

from __future__ import annotations

from typing import Any, Iterable, Iterator

from .vflist import VFLinkedList


class VFQueue:
    """FIFO queue with a minimal surface suitable for native-runtime ownership."""

    __vf_py_attrs__ = True
    __slots__ = ("_items",)

    def __init__(self, items: Iterable[Any] | None = None) -> None:
        self._items = VFLinkedList()
        if items is not None:
            self._items.extend(items)

    @classmethod
    def from_iterable(cls, items: Iterable[Any]) -> VFQueue:
        return cls(items)

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._items)

    def __repr__(self) -> str:
        return "VFQueue(" + ", ".join(repr(x) for x in self._items) + ")"

    def put(self, item: Any) -> None:
        self._items.append(item)

    def get(self) -> Any | None:
        return self._items.pop_left()

    def empty(self) -> bool:
        return self._items.empty()

