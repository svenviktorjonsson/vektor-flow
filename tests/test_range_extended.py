"""Range: implicit start, signed step, lazy infinite."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.lazy_range import LazyInfiniteIterator


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_implicit_start_list() -> None:
    assert _emit(":: [..3]") == "[0, 1, 2, 3]"


def test_signed_step_down() -> None:
    assert _emit(":: [3..0]") == "[3, 2, 1, 0]"


def test_lazy_infinite_emit_repr() -> None:
    assert _emit("x : (1..)\n:: x") == "range from 1"


def test_lazy_from_zero() -> None:
    assert _emit("x : (..)\n:: x") == "range from 0"


def test_lazy_list_literal_wraps_infinite() -> None:
    """``[1..]`` is a lazy list; materialize with ``take`` / ``to_list``."""
    assert _emit("v : [1..]\n:: take(4, v)") == "(1, 2, 3, 4)"


def test_to_list_and_to_multiset() -> None:
    src = """
v : [1..]
:: to_list(3, v)
:: to_multiset(4, v)
"""
    out = _emit(src)
    assert "[1, 2, 3]" in out
    assert "{1:1, 2:1, 3:1, 4:1}" in out


def test_lazy_iterator_steps() -> None:
    mod = parse_module("x : (5..)", filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    it = ip.globals["x"]
    assert isinstance(it, LazyInfiniteIterator)
    assert it.start == 5
    assert next(it) == 5
    assert next(it) == 6


def test_materialize_same_as_explicit() -> None:
    assert _emit(":: [..2]") == _emit(":: [0..2]")
