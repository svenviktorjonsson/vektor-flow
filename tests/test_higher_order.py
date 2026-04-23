"""Higher-order functions: function-typed parameters and ``-> num->num`` return types."""

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


def test_method_returns_function_taking_num() -> None:
    """``method(f:num->num, x:num) -> num->num`` returns ``g`` with ``g(y:num) -> num``."""
    src = """
id(x:num) -> num: x

method(f:num->num, x:num) -> num->num:
	g(y:num) -> num: f(f(x*y)*y)
	g

:: method(id, 2)(3)
"""
    lines = _run(src).splitlines()
    assert lines[-1] in ("18", "18.0")


def test_func_typed_param_rejects_non_function() -> None:
    src = """
method(f:num->num, x:num) -> num:
	x

:: method(1, 2)
"""
    with pytest.raises(EvalError, match="function"):
        _run(src)


def test_nested_return_type_parse() -> None:
    from vektorflow import ast as a

    mod = parse_module(
        "h(f:num->num) -> num->num:\n\tf\n",
        "<t>",
    )
    fd = mod.statements[0]
    assert isinstance(fd, a.FuncDef)
    assert fd.func_type is not None
    assert isinstance(fd.func_type.codomain, a.FuncType)
