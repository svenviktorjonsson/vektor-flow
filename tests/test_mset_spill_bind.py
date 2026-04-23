"""Multiset spill in vectors and bind patterns for ``.(i,j)``."""

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


def test_mset_spill_to_vector() -> None:
    src = """
m : {1:2, 2:1}
v : [:m]
:: v
"""
    out = _emit(src)
    assert "1" in out and "2" in out
    assert out.count("1") >= 2


def test_bind_pattern_dotted_names() -> None:
    src = """
a : (0, 0)
a.(i, j) : (3, 4)
:: i
:: j
"""
    out = _emit(src)
    assert "3" in out and "4" in out
