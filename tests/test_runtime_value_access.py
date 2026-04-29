from __future__ import annotations

import pytest

from vektorflow.runtime import AxisTaggedValue
from vektorflow.runtime.value_access import (
    normalize_runtime_index,
    runtime_value_index_get,
    runtime_value_index_set,
)


def test_normalize_runtime_index_accepts_integral_float_and_str() -> None:
    assert normalize_runtime_index(3.0, ValueError) == 3
    assert normalize_runtime_index(4, ValueError) == 4
    assert normalize_runtime_index("x", ValueError) == "x"


def test_normalize_runtime_index_rejects_bool() -> None:
    with pytest.raises(ValueError, match="index must be int or str"):
        normalize_runtime_index(True, ValueError)


def test_runtime_value_index_get_unwraps_axis_tagged_dict() -> None:
    handled, value = runtime_value_index_get(
        AxisTaggedValue({"x": 1}, "i"),
        "x",
        ValueError,
    )

    assert handled is True
    assert value == 1


def test_runtime_value_index_get_delegates_to_collection_reader_with_normalized_key() -> None:
    def fake_read_collection(base: object, key: object) -> tuple[bool, object]:
        assert base == ("a", "b")
        assert key == 2
        return True, "ok"

    handled, value = runtime_value_index_get(
        ("a", "b"),
        2.0,
        ValueError,
        fake_read_collection,
    )

    assert handled is True
    assert value == "ok"


def test_runtime_value_index_set_updates_axis_tagged_dict() -> None:
    container = AxisTaggedValue({"x": 1}, "i")

    handled = runtime_value_index_set(
        container,
        "x",
        9,
        ValueError,
    )

    assert handled is True
    assert container.data["x"] == 9


def test_runtime_value_index_set_rejects_lazy_list_assignment() -> None:
    class FakeLazyList:
        pass

    from vektorflow.runtime.lazy_range import LazyList

    lazy = object.__new__(LazyList)
    with pytest.raises(ValueError, match="cannot assign through index on lazy list"):
        runtime_value_index_set(lazy, 0, 1, ValueError)
