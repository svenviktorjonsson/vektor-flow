from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.typed_vector import TypedVector


def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [line for line in buf.getvalue().splitlines() if line.strip()]


def test_typed_vector_shape_and_ndim() -> None:
    v = TypedVector([1, 2, 3, 4, 5, 6])
    assert v.shape == (6,)
    assert v.ndim == 1


def test_typed_vector_nested_shape_and_ndim() -> None:
    v = TypedVector([[1, 2], [3, 4]], vf_type_expr=None)
    assert v.shape == (2, 2)
    assert v.ndim == 2


def test_typed_vector_reshape_rebinds_in_place() -> None:
    v = TypedVector([1, 2, 3, 4], vf_type_expr=None)
    same = v.reshape((2, 2))
    assert same is v
    assert v == [[1, 2], [3, 4]]
    assert v.shape == (2, 2)
    assert v.ndim == 2


def test_typed_vector_reshape_shape_as_vector() -> None:
    shape = TypedVector([2, 2], vf_type_expr=None)
    v = TypedVector([1, 2, 3, 4], vf_type_expr=None)
    v.reshape(shape)
    assert v.shape == (2, 2)
    assert v == [[1, 2], [3, 4]]


def test_typed_vector_invalid_reshape_shape() -> None:
    v = TypedVector([1, 2, 3, 4], vf_type_expr=None)
    with pytest.raises(ValueError, match="cannot reshape array"):
        v.reshape((2, 3))


def test_typed_vector_ragged_shape_raises() -> None:
    with pytest.raises(ValueError, match="ragged values"):
        _ = TypedVector([[1, 2], [3]]).shape


def test_vkf_shape_ndim_and_reshape() -> None:
    src = """
[num:4] a: [1, 2, 3, 4]
:: a.shape
:: a.ndim
:: a.reshape((2,2))
:: a.shape
:: a.ndim
:: a
"""
    assert _run(src) == [
        "(4,)",
        "1",
        "[[1, 2], [3, 4]]",
        "(2, 2)",
        "2",
        "[[1, 2], [3, 4]]",
    ]
