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


def test_name_update_assignments() -> None:
    out = _run(
        """x : 10
x +: 5
x -: 3
x *: 2
x /: 4
x //: 2
x %: 2
:: x
"""
    )
    assert out == "1"


def test_logical_update_assignments() -> None:
    out = _run(
        """a : true
b : false
a /\\: b
b \\/: true
b ><: true
:: (a & "\\n")
:: b
"""
    )
    lines = out.splitlines()
    assert lines == ["false", "false"]


def test_attribute_and_index_update_assignments() -> None:
    out = _run(
        """p : ()
p.x : 4
p.x +: 3
v : [10, 20, 30]
v.(1) //: 3
:: (p.x & "\\n")
:: v
"""
    )
    lines = out.splitlines()
    assert lines == ["7", "[10, 6, 30]"]


def test_update_assignment_returns_assigned_value() -> None:
    out = _run(
        """f():
    x : 1
    x +: 2
:: f()
"""
    )
    assert out == "3"


def test_non_lvalue_update_assignment_rejected() -> None:
    with pytest.raises(ParseError):
        parse_module("f(1) +: 2\n", filename="<test>")
