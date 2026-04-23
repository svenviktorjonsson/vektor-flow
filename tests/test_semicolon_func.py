"""Semicolon-separated function bodies and ``f.name`` introspection for body binds."""

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


def _run_expect_eval_error(src: str) -> None:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError):
        ip.run_module(mod)


def test_semicolon_inline_same_line_as_def() -> None:
    src = """
f(x): y:2; x*y
:: f(3)
"""
    lines = _run(src).splitlines()
    assert lines[-1] in ("6", "6.0")


def test_semicolon_indented_block() -> None:
    src = """
f(x):
\ty:2; x*y
:: f(3)
"""
    lines = _run(src).splitlines()
    assert lines[-1] in ("6", "6.0")


def test_func_field_literal_value() -> None:
    src = """
f(x): y:2; x*y
:: f.y
"""
    assert _run(src) == "2"


def test_func_field_implicit_mul_string_when_param_unbound() -> None:
    src = """
f(x):
\ty: 2x
\tx*y
:: f.y
"""
    assert _run(src) == "2x"


def test_func_field_param_name_is_error() -> None:
    src = """
f(x): y:2; x*y
:: f.x
"""
    _run_expect_eval_error(src)


def test_arrow_type_with_semicolon_body() -> None:
    src = """
f(x:num) -> num: y:2; x*y
:: f(3)
"""
    lines = _run(src).splitlines()
    assert lines[-1] in ("6", "6.0")
