"""Reserved ``null`` literal."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_emit_null() -> None:
    assert _run(":: null") == "null"


def test_null_reflection_has_no_type() -> None:
    assert _run(":: null.") == "null"


def test_tuple_with_null() -> None:
    assert _run(":: (true, null, false)") == "(true, null, false)"


def test_null_compares_equal_to_false_conditional() -> None:
    assert _run("x: 1 = 2? 7\n:: x = null") == "true"
