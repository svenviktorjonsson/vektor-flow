"""Doubly linked list for stdlib ``collections.list``."""

from __future__ import annotations

from typing import Any, Iterator


class _Node:
    __slots__ = ("prev", "next", "value")

    def __init__(self, value: Any) -> None:
        self.prev: _Node | None = None
        self.next: _Node | None = None
        self.value = value


class VFLinkedList:
    """Mutable sequence with O(1) append; ``list(...)`` from ``use(\"collections\")``."""

    __slots__ = ("_head", "_tail", "_len")

    def __init__(self) -> None:
        self._head: _Node | None = None
        self._tail: _Node | None = None
        self._len = 0

    @classmethod
    def single(cls, x: Any) -> VFLinkedList:
        out = cls()
        out.append(x)
        return out

    @classmethod
    def from_iterable(cls, it: Any) -> VFLinkedList:
        out = cls()
        for x in it:
            out.append(x)
        return out

    def __len__(self) -> int:
        return self._len

    def __iter__(self) -> Iterator[Any]:
        n = self._head
        while n is not None:
            yield n.value
            n = n.next

    def __repr__(self) -> str:
        parts = [repr(x) for x in self]
        return "VFLinkedList(" + ", ".join(parts) + ")"

    def append(self, x: Any) -> None:
        node = _Node(x)
        if self._tail is None:
            self._head = self._tail = node
        else:
            node.prev = self._tail
            self._tail.next = node
            self._tail = node
        self._len += 1

    def extend(self, it: Any) -> None:
        for x in it:
            self.append(x)

    def empty(self) -> bool:
        return self._len == 0

    def peek_left(self) -> Any | None:
        if self._head is None:
            return None
        return self._head.value

    def pop_left(self) -> Any | None:
        head = self._head
        if head is None:
            return None
        nxt = head.next
        self._head = nxt
        if nxt is None:
            self._tail = None
        else:
            nxt.prev = None
        self._len -= 1
        return head.value

    def to_list(self) -> list[Any]:
        return list(self)

    def insert(self, index: int, x: Any) -> None:
        if index < 0:
            index += self._len
        if index < 0 or index > self._len:
            raise IndexError("list insert index out of range")
        if index == self._len:
            self.append(x)
            return
        node = _Node(x)
        cur = self._head
        assert cur is not None
        for _ in range(index):
            assert cur is not None
            cur = cur.next
        assert cur is not None
        prev = cur.prev
        node.next = cur
        node.prev = prev
        cur.prev = node
        if prev is None:
            self._head = node
        else:
            prev.next = node
        self._len += 1
