"""Struct ``class`` definitions: ``Name(params):`` with no body, then ``Name(...)`` builds a struct."""

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


def test_struct_ctor_positional_and_field_access() -> None:
    src = """
Point(x:num, y:num):

p : Point(3, 4)
::: p.x
::: p.y
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("3", "3.0")
    assert lines[1] in ("4", "4.0")


def test_struct_ctor_keyword_args() -> None:
    src = """
Point(x:num, y:num):

p : Point(x: 1, y: 2)
:: p.x + p.y
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("3", "3.0")


def test_struct_ctor_colon_body_same_as_empty() -> None:
    """Tagged values print as ``Point(x:…, y:…)`` (constructor-style), not bare ``(x:…)``."""
    src = """
Point(x:num, y:num):
    :

p : Point(1, 2)
:: p
"""
    assert _run(src).strip() == "Point(x:1, y:2)"


def test_function_value_prints_name_param_types_and_codomain() -> None:
    src = """
f(x:num, y:num): x + y
g(x:num) -> num: x^2
::: f
::: g
"""
    lines = _run(src).splitlines()
    assert lines[0] == "f(num x, num y)"
    assert lines[1] == "g(num x) -> num"


def test_struct_ctor_reference_prints_constructor_head() -> None:
    src = """
Point(x:num, y:num):
    :
:: Point
"""
    assert _run(src).strip() == "Point(num x, num y)"


def test_lambda_prints_dollar_signature() -> None:
    src = """
h : ($(x): x^2)
:: h
"""
    assert _run(src).strip() == "$(x)"


def test_colon_expr_returns_local_scope_in_function() -> None:
    src = """
f(x:num, y:num):
    :

r : f(3, 4)
:: r.x + r.y
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("7", "7.0")


def test_empty_body_with_arrow_errors() -> None:
    src = """
f(x:num) -> num:

"""
    with pytest.raises(EvalError, match="empty definition"):
        _run(src)


def test_attribute_on_ctor_errors() -> None:
    src = """
Point(x:num, y:num):

:: Point.x
"""
    with pytest.raises(EvalError, match="struct constructor"):
        _run(src)


def test_operator_requires_body_after_colon() -> None:
    from vektorflow.errors import ParseError

    src = """
+(a, b):

"""
    with pytest.raises(ParseError, match="operator function must have a body"):
        parse_module(src, filename="<test>")
