"""``::(value: T):`` customizes how ``::`` prints values of type ``T``."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestDisplayOverload:
    def test_display_rejects_primitive_value_type(self) -> None:
        src = '::(value:num): :: "$value"\n'
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError, match="custom or constructed"):
            ip.run_module(mod)

    def test_display_overload_used_by_double_colon(self) -> None:
        src = """
Point : (x:num, y:num)
::(value:Point): :: "($value.x,$value.y)"
p : (x:1, y:2)
:: p
"""
        assert _run(src.strip()) == "(1,2)"

    def test_display_name_is_ordinary_function(self) -> None:
        src = """
Point : (x:num, y:num)
display(value:Point): "($value.x,$value.y)"
p : (x:1, y:2)
:: p
:: display(p)
"""
        assert _run(src.strip()) == "(x:1, y:2)\n(1,2)"

    def test_emit_name_is_undefined(self) -> None:
        ip = Interpreter(Path(__file__))
        with contextlib.redirect_stdout(StringIO()):
            try:
                ip.run_module(parse_module('emit("x")', "<t>"))
            except EvalError as e:
                assert "undefined name" in str(e) and "emit" in str(e)
            else:
                raise AssertionError("expected EvalError")
