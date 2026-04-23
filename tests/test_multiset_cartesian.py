"""Cartesian binary distribution for multisets (default set ``op`` semantics)."""

from __future__ import annotations

import pytest

from vektorflow.runtime.multiset import Multiset, cartesian_binary


class TestCartesianBinary:
    def test_singleton_plus(self) -> None:
        a = Multiset({1: 1})
        b = Multiset({2: 1})
        r = cartesian_binary(a, b, lambda x, y: x + y)
        assert r == Multiset({3: 1})

    def test_multiplicity_product(self) -> None:
        """count(a)*count(b) pairs contribute to op(a,b)."""
        a = Multiset({1: 2})
        b = Multiset({10: 3})
        r = cartesian_binary(a, b, lambda x, y: x + y)
        assert r.count(11) == 2 * 3

    def test_three_distinct_pairs(self) -> None:
        a = Multiset({1: 1, 2: 1})
        b = Multiset({10: 1, 100: 1})
        r = cartesian_binary(a, b, lambda x, y: x + y)
        assert r == Multiset({11: 1, 12: 1, 102: 1, 101: 1})

    def test_multiplication_op(self) -> None:
        a = Multiset({2: 1, 3: 1})
        b = Multiset({4: 2})
        r = cartesian_binary(a, b, lambda x, y: x * y)
        assert r.count(8) == 1 * 2
        assert r.count(12) == 1 * 2

    def test_same_result_bucket_sums_multiplicities(self) -> None:
        """Different pairs can map to the same op result; counts add."""
        a = Multiset({1: 1, 2: 1})
        b = Multiset({1: 1, 2: 1})
        r = cartesian_binary(a, b, lambda x, y: x + y)
        # 1+2 and 2+1 both give 3
        assert r.count(3) == 2
        assert r.count(2) == 1
        assert r.count(4) == 1

    def test_empty_left(self) -> None:
        a = Multiset({})
        b = Multiset({1: 1})
        r = cartesian_binary(a, b, lambda x, y: x + y)
        assert r == Multiset({})

    def test_empty_right(self) -> None:
        a = Multiset({1: 1})
        b = Multiset({})
        r = cartesian_binary(a, b, lambda x, y: x + y)
        assert r == Multiset({})

    def test_both_empty(self) -> None:
        assert cartesian_binary(Multiset({}), Multiset({}), lambda x, y: x + y) == Multiset({})

    def test_tuple_elements_hashable(self) -> None:
        """Result keys may be tuples (still hashable)."""
        a = Multiset({(0, 0): 1})
        b = Multiset({(1, 0): 1})
        r = cartesian_binary(a, b, lambda x, y: (x[0] + y[0], x[1] + y[1]))
        assert r.count((1, 0)) == 1

    def test_high_multiplicity(self) -> None:
        a = Multiset({5: 10})
        b = Multiset({7: 4})
        r = cartesian_binary(a, b, lambda x, y: x * y)
        assert r.count(35) == 40
