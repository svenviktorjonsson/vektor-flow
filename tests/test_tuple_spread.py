"""Tuple spread ``:(…)`` for flat concatenation."""

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


def test_tuple_spread_concat() -> None:
    assert _emit(":: (:(1, 2), :(3, 4))") == "(1, 2, 3, 4)"


def test_tuple_spread_with_vector() -> None:
    src = """
u : [5, 6]
:: (:(1, 2), :u)
"""
    assert _emit(src) == "(1, 2, 5, 6)"
