from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow import ast
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


def test_parser_accepts_declaration_style_params_and_defaults() -> None:
    mod = parse_module("f(num x, num y:4): x + y", "<test>")
    fn = mod.statements[0]
    assert isinstance(fn, ast.FuncDef)
    assert fn.params[0].name == "x"
    assert fn.params[0].type_name == "num"
    assert fn.params[0].default_expr is None
    assert fn.params[1].name == "y"
    assert fn.params[1].type_name == "num"
    assert isinstance(fn.params[1].default_expr, ast.NumberLit)
    assert fn.params[1].default_expr.value == 4


def test_defaults_are_evaluated_at_call_time_from_earlier_params() -> None:
    src = """
f(num x, num y:x+1, num z:y+1): x + y + z
::: f(2)
::: f(2, z:10)
"""
    assert _run(src).splitlines() == ["9", "15"]


def test_named_calls_allow_any_order_and_mixed_tail_keywords() -> None:
    src = """
f(num x, num y, num z:0): x*100 + y*10 + z
::: f(y:2, x:1)
::: f(1, z:3, y:2)
"""
    assert _run(src).splitlines() == ["120", "123"]


def test_call_spreads_support_positional_and_named_categories() -> None:
    src = """
f(num x, num y, num z:0): x*100 + y*10 + z
a: (y:4, z:5)
::: f(:[1,2], :a)
"""
    assert _run(src).splitlines() == ["145"]


def test_named_spread_later_wins_but_direct_duplicate_errors() -> None:
    src = """
f(num x, num y:0): x*10 + y
a: (x:1)
b: (x:2, y:3)
::: f(:a, :b)
"""
    assert _run(src).splitlines() == ["23"]

    dup = """
f(num x): x
:: f(x:1, x:2)
"""
    with pytest.raises(EvalError, match="multiple values for argument 'x'"):
        _run(dup)


def test_positional_after_named_is_rejected() -> None:
    src = """
f(num x, num y): x + y
:: f(x:1, 2)
"""
    with pytest.raises(EvalError, match="positional arguments cannot appear after named arguments"):
        _run(src)
