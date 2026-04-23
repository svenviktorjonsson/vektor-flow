"""Lazy infinite range from ``start`` upward by step +1."""

from __future__ import annotations

from typing import Any, Iterator


class LazyInfiniteIterator(Iterator[int]):
    """Yields ``start`` forever: ``start``, ``start+1``, ``start+2``, …"""

    __slots__ = ("start", "_cur")

    def __init__(self, start: int) -> None:
        self.start = start
        self._cur = start

    def __iter__(self) -> LazyInfiniteIterator:
        return self

    def __next__(self) -> int:
        v = self._cur
        self._cur += 1
        return v

    def __repr__(self) -> str:
        return f"<lazy range from {self.start}>"


class LazyList:
    """List-shaped value backed by a lazy iterator; materializes a prefix when indexed or ``take`` is used."""

    __slots__ = ("_it", "_cache")

    def __init__(self, it: LazyInfiniteIterator) -> None:
        self._it = it
        self._cache: list[Any] = []

    def _ensure(self, i: int) -> None:
        while len(self._cache) <= i:
            self._cache.append(next(self._it))

    def get_at(self, i: int) -> Any:
        self._ensure(i)
        return self._cache[i]

    def take_prefix(self, n: int) -> tuple[Any, ...]:
        if n <= 0:
            return ()
        self._ensure(n - 1)
        return tuple(self._cache[:n])

    def __repr__(self) -> str:
        return f"<lazy list from {self._it.start}>"
