"""Whitespace rules for the reach operator `.` (field / index vs type-of)."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import ParseError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_tight_dot_field_access() -> None:
    src = """
p : (x:1, y:2)
:: p.x
"""
    assert _run(src) == "1"


def test_space_after_dot_typeof_not_field() -> None:
    src = """
p : (x:1, y:2)
:: p. = (x:num, y:num)
"""
    assert _run(src) == "true"


def test_space_after_dot_same_line_ident_errors() -> None:
    with pytest.raises(ParseError, match="space after"):
        parse_module("p : (x:1)\n:: p. x", "<t>")


def test_space_before_dot_errors() -> None:
    with pytest.raises(ParseError, match="adjacent"):
        parse_module("p : (x:1)\n:: p .x", "<t>")


def test_space_both_sides_errors() -> None:
    with pytest.raises(ParseError, match="adjacent"):
        parse_module("p : (x:1)\n:: p . x", "<t>")
