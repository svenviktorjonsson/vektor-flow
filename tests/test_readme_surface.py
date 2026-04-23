"""End-to-end checks for README-documented surface features."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestStringInterpolation:
    def test_dollar_var_and_format(self) -> None:
        src = """
a : 4.2345
:: "printing $a.2f"
"""
        assert _emit(src) == "printing 4.23"


class TestTypeInstanceAndEmit:
    def test_struct_literal_zero_sum(self) -> None:
        src = """
Point : (x:num, y:num)
p : (x:0, y:0)
:: p.x + p.y
"""
        assert _emit(src) == "0"

    def test_primitive_type_defaults(self) -> None:
        src = """
n : num
s : str
b : bool
:: n
:: s
:: b
"""
        assert _emit(src) == "0\n\nfalse"

    def test_emit_overload(self) -> None:
        src = """
Point : (x:num, y:num)
display(value:Point): "($value.x,$value.y)"
q : (x:3, y:4)
:: q
"""
        assert _emit(src) == "(3,4)"


class TestPrimitiveDefaults:
    def test_num_str_bool_defaults(self) -> None:
        src = r"""
n : num
s : str
b : bool
:: (n = 0) /\ (s = "") /\ (~ b)
"""
        assert _emit(src) == "true"


class TestDefaultStructOrder:
    def test_lt_lexicographic(self) -> None:
        src = """
a : (x:1, y:2)
b : (x:1, y:3)
:: (a < b)
"""
        assert _emit(src) == "true"


class TestListRangeAndLambda:
    def test_list_range_expands(self) -> None:
        src = """
v : [1..3]
:: v.0 + v.1 + v.2
"""
        assert _emit(src) == "6"

    def test_lambda_call(self) -> None:
        src = """
:: ($(x): x^2)(5)
"""
        assert _emit(src) == "25"


class TestKeywordOperatorDef:
    def test_and_def(self) -> None:
        # Operator overloads must use custom/constructed parameter types (not num/str/…).
        src = r"""
T(x:num):
    :
/\(a:T, b:T): a.x + b.x
:: /\(T(2), T(3))
"""
        assert _emit(src) == "5"
