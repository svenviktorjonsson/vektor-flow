from __future__ import annotations

import io
from contextlib import redirect_stdout
from pathlib import Path

from vektorflow import ast as ast_mod
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _emit(src: str) -> str:
    ip = Interpreter(Path(__file__))
    buf = io.StringIO()
    with redirect_stdout(buf):
        ip.run_module(parse_module(src, "<test>"))
    return buf.getvalue().strip()


def test_parenthesized_colon_is_bind_expression() -> None:
    mod = parse_module("b: 42\n:: (a:b)\n:: a\n", "<test>")
    printed = mod.statements[1].value

    assert isinstance(printed, ast_mod.BindExpr)
    assert _emit("b: 42\n:: (a:b)\n:: a\n").splitlines() == ["42", "42"]


def test_single_field_record_requires_trailing_comma() -> None:
    mod = parse_module("r: (x:1,)\n:: r.x\n", "<test>")
    value = mod.statements[0].value

    assert isinstance(value, ast_mod.StructLit)
    assert _emit("r: (x:1,)\n:: r.x\n") == "1"


def test_multi_field_record_stays_record() -> None:
    mod = parse_module("r: (x:1, y:2)\n:: r.y\n", "<test>")
    value = mod.statements[0].value

    assert isinstance(value, ast_mod.StructLit)
    assert _emit("r: (x:1, y:2)\n:: r.y\n") == "2"

