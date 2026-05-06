"""Multiset runtime value.

Counts are canonicalized to non-negative integers, with zero counts removed.
This module only owns the value semantics; operator semantics live higher in
the interpreter/runtime layers.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Callable, Iterator


class Multiset:
    """Immutable multiset: hashable elements → positive integer counts."""

    __slots__ = ("_c", "vf_type_expr")

    def __init__(self, counts: dict[Any, int] | Counter | None = None) -> None:
        self._c: Counter[Any] = Counter()
        self.vf_type_expr = None
        if counts is not None:
            for k, v in counts.items():
                count = _normalize_multiset_count(v)
                if count > 0:
                    self._c[k] += count

    @classmethod
    def from_pairs(cls, pairs: list[tuple[Any, int]]) -> Multiset:
        c: Counter[Any] = Counter()
        for k, v in pairs:
            count = _normalize_multiset_count(v)
            if count > 0:
                c[k] += count
        m = cls()
        m._c = c
        return m

    def count(self, elem: Any) -> int:
        return int(self._c[elem])

    def total(self) -> int:
        return int(sum(self._c.values()))

    def elements(self) -> Iterator[Any]:
        """Yield each element repeated according to multiplicity in canonical order."""
        for k, n in self.items_sorted():
            for _ in range(n):
                yield k

    def items_sorted(self) -> list[tuple[Any, int]]:
        """Deterministic iteration: sorted by Python's default ``<`` on keys."""
        return sorted(self._c.items(), key=lambda kv: kv[0])

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Multiset):
            return NotImplemented
        return self._c == other._c

    def __repr__(self) -> str:
        return f"Multiset({dict(self._c)})"


def cartesian_binary(
    a: Multiset,
    b: Multiset,
    op: Callable[[Any, Any], Any],
) -> Multiset:
    """Apply ``op`` to every pair (x, y) with multiplicity count(x)*count(y)."""
    out: Counter[Any] = Counter()
    for x, cx in a._c.items():
        if cx == 0:
            continue
        for y, cy in b._c.items():
            if cy == 0:
                continue
            out[op(x, y)] += cx * cy
    return Multiset(out)


def multiset_union(a: Multiset, b: Multiset) -> Multiset:
    c = Counter(a._c)
    c.update(b._c)
    return Multiset(c)


def multiset_difference(a: Multiset, b: Multiset) -> Multiset:
    c = Counter(a._c)
    for k, v in b._c.items():
        c[k] -= v
        if c[k] <= 0:
            del c[k]
    return Multiset({k: v for k, v in c.items() if v > 0})


def multiset_intersection(a: Multiset, b: Multiset) -> Multiset:
    """``min(count_A(k), count_B(k))``; keys missing on either side count as 0."""
    out: Counter[Any] = Counter()
    for k in set(a._c.keys()) | set(b._c.keys()):
        m = min(int(a._c.get(k, 0)), int(b._c.get(k, 0)))
        if m > 0:
            out[k] = m
    return Multiset(dict(out))


def multiset_symmetric_difference(a: Multiset, b: Multiset) -> Multiset:
    return multiset_union(multiset_difference(a, b), multiset_difference(b, a))


def multiset_scalar_add(a: Multiset, amount: int) -> Multiset:
    amount = _normalize_multiset_count(amount)
    if amount == 0:
        return Multiset(dict(a._c))
    out: Counter[Any] = Counter()
    for key, count in a._c.items():
        nxt = count + amount
        if nxt > 0:
            out[key] = nxt
    return Multiset(dict(out))


def multiset_scalar_subtract(a: Multiset, amount: int) -> Multiset:
    amount = _normalize_multiset_count(amount)
    if amount == 0:
        return Multiset(dict(a._c))
    out: Counter[Any] = Counter()
    for key, count in a._c.items():
        nxt = count - amount
        if nxt > 0:
            out[key] = nxt
    return Multiset(dict(out))


def multiset_scalar_floordiv(a: Multiset, amount: int) -> Multiset:
    amount = _normalize_multiset_count(amount)
    if amount == 0:
        raise ZeroDivisionError("integer division or modulo by zero")
    out: Counter[Any] = Counter()
    for key, count in a._c.items():
        nxt = count // amount
        if nxt > 0:
            out[key] = nxt
    return Multiset(dict(out))


def multiset_countwise_floordiv(a: Multiset, b: Multiset) -> Multiset:
    if set(a._c.keys()) != set(b._c.keys()):
        raise KeyError("multiset key mismatch for //")
    out: Counter[Any] = Counter()
    for key, count in a.items_sorted():
        divisor = int(b._c[key])
        if divisor == 0:
            raise ZeroDivisionError("integer division or modulo by zero")
        nxt = count // divisor
        if nxt > 0:
            out[key] = nxt
    return Multiset(dict(out))


def _normalize_multiset_count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError("multiset counts must be non-negative integers")
    if value < 0:
        raise ValueError("multiset counts must be non-negative")
    return value
