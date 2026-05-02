"""``&`` concatenation: tuple, vector, string, multiset, struct."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_tuple_concat() -> None:
    assert _emit(":: (1, 2) & (3, 4)") == "(1, 2, 3, 4)"


def test_vector_concat() -> None:
    assert _emit(":: [1, 2] & [3, 4]") == "[1, 2, 3, 4]"


def test_string_concat() -> None:
    assert _emit(':: "ab" & "cd"') == "abcd"


def test_string_concat_stringifies_non_str_operand() -> None:
    """Same str-coercion rule as ``+`` when one side is a string (e.g. ``::: expr``)."""
    assert _emit(r':: 1 & "\n"') == _emit(r':: 1 + "\n"')


def test_mset_union_same_as_plus() -> None:
    out = _emit(":: {1:1, 2:1} & {2:1, 3:1}")
    out2 = _emit(":: {1:1, 2:1} + {2:1, 3:1}")
    assert out == out2


def test_struct_merge() -> None:
    src = """
a : (x:1, y:2)
b : (z:3,)
:: a & b
"""
    out = _emit(src)
    assert "3" in out and "1" in out
