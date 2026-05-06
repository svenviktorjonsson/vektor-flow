from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter, _binop
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<runtime-compare-derivations>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class LtOnly:
    def __init__(self, value: int) -> None:
        self.value = value

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, LtOnly):
            return NotImplemented
        return self.value < other.value


def test_scalar_relational_family_derives_from_lt_only() -> None:
    a = LtOnly(2)
    b = LtOnly(5)
    c = LtOnly(2)

    assert _binop("LT", a, b) is True
    assert _binop("GT", b, a) is True
    assert _binop("EQ", a, c) is True
    assert _binop("STRUCT_NEQ", a, c) is False
    assert _binop("LE", a, c) is True
    assert _binop("GE", b, a) is True


def test_structured_boolean_outputs_compose_with_logical_ops() -> None:
    src = """
a : (x:1, y:5)
b : (x:2, y:4)
::: (a < b) /\\ (a >= b)
::: (a < b) \\/ (a >= b)
::: ~ (a < b)
"""
    assert _run(src).splitlines() == [
        "(x:false, y:false)",
        "(x:true, y:true)",
        "(x:false, y:true)",
    ]


def test_structural_neq_is_derived_from_structural_eq_for_structs() -> None:
    src = """
a : (x:1, y:2)
b : (x:1, y:3)
::: a = b
::: a ~= b
"""
    assert _run(src).splitlines() == [
        "(x:true, y:false)",
        "(x:false, y:true)",
    ]


def test_structured_boolean_ops_broadcast_scalar_bool() -> None:
    src = """
a : (x:1, y:5)
b : (x:2, y:4)
::: (a < b) /\\ true
::: false \\/ (a < b)
"""
    assert _run(src).splitlines() == [
        "(x:true, y:false)",
        "(x:true, y:false)",
    ]
