"""``abs_or_norm`` — scalar absolute value and 1D vector Euclidean norm."""

from __future__ import annotations

import pytest

from vektorflow.runtime.absnorm import abs_or_norm


class TestAbsScalar:
    def test_positive(self) -> None:
        assert abs_or_norm(3) == 3.0

    def test_negative(self) -> None:
        assert abs_or_norm(-3) == 3.0

    def test_float(self) -> None:
        assert abs_or_norm(-2.5) == 2.5


class TestNormVector:
    def test_unit(self) -> None:
        assert abs_or_norm([1.0, 0.0]) == 1.0

    def test_pythagoras(self) -> None:
        assert abs_or_norm([3.0, 4.0]) == 5.0

    def test_tuple(self) -> None:
        assert abs_or_norm((3, 4)) == 5.0

    def test_nested_rejected(self) -> None:
        with pytest.raises(TypeError, match="1D"):
            abs_or_norm([[1, 2], [3, 4]])

    def test_empty_rejected(self) -> None:
        with pytest.raises(ValueError, match="empty"):
            abs_or_norm([])


class TestBadTypes:
    def test_bool_rejected(self) -> None:
        with pytest.raises(TypeError):
            abs_or_norm(True)
