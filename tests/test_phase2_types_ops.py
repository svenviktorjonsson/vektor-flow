"""Phase 2: type shapes, struct literals, and binary + overload on structs."""

from __future__ import annotations

import ast as py_ast
import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.multiset import (
    Multiset,
    multiset_count_floor_div,
    multiset_count_mod,
    multiset_difference,
    multiset_union,
)


def _parse_multiset_print(s: str) -> Multiset:
    s = s.strip()
    if s.startswith("Multiset(") and s.endswith(")"):
        inner = s[len("Multiset(") : -1]
        d = py_ast.literal_eval(inner)
        return Multiset(d)
    if s.startswith("{") and s.endswith("}"):
        d = py_ast.literal_eval(s)
        return Multiset(d)
    raise AssertionError(f"expected Multiset(...) or {{...}} print, got {s!r}")


def _run_emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestPhase2TypesAndOps:
    def test_type_def_registers_shape(self) -> None:
        mod = parse_module("Point : (x:num, y:num)", filename="<test>")
        ip = Interpreter(Path(__file__))
        ip.run_module(mod)
        assert "Point" in ip.types
        assert [(n, t.name) for n, t in ip.types["Point"].fields] == [("x", "num"), ("y", "num")]

    def test_empty_type_record(self) -> None:
        mod = parse_module("Empty : ()", filename="<test>")
        ip = Interpreter(Path(__file__))
        ip.run_module(mod)
        assert ip.types["Empty"].fields == []

    def test_struct_literal_fields(self) -> None:
        src = """
p : (x:1, y:2)
:: p.x + p.y
"""
        assert _run_emit(src) == "3"

    def test_plus_overload_on_structs(self) -> None:
        src = """
Point : (x:num, y:num)
+(a:Point, b:Point): (x:a.x+b.x, y:a.y+b.y)
p : (x:1, y:2)
q : (x:3, y:4)
r : p + q
:: r.x + r.y
"""
        assert _run_emit(src) == "10"

    def test_tagged_struct_plus_default_elementwise(self) -> None:
        """No ``+(a:Point, b:Point):`` — default field-wise ``+`` on same tagged type."""
        src = """
Point(x:num, y:num):
    :

p : Point(2, 3)
q : Point(1, 4)
r : p + q
:: r.x + r.y
"""
        assert _run_emit(src) == "10"

    def test_struct_plus_default_elementwise_without_explicit_overload(self) -> None:
        src = """
p : (x:1,)
q : (x:2,)
:: (p + q).x
"""
        assert _run_emit(src) in ("3", "3.0")

    def test_struct_plus_mismatched_fields_requires_overload_or_fails(self) -> None:
        src = """
p : (x:1,)
q : (x:1, y:2)
:: (p + q).x
"""
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError):
            ip.run_module(mod)

    def test_typed_params_on_normal_function(self) -> None:
        src = """
f(a:num, b:num): a + b
:: f(2, 3)
"""
        assert _run_emit(src) == "5"

    def test_emit_colon_prints_local_scope(self) -> None:
        src = """
a : 1
b : 2
:: :
"""
        out = _run_emit(src)
        assert "a" in out and "b" in out
        assert "1" in out and "2" in out

    def test_operator_overload_rejects_primitive_param_types(self) -> None:
        src = "+(a:num, b:num): 0\n"
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError, match="at least one parameter"):
            ip.run_module(mod)

    def test_operator_overload_allows_custom_plus_primitive(self) -> None:
        src = """
Point(x:num):
    :

+(a:Point, b:num):
    Point(a.x + b)

p : Point(2)
:: (p + 3).x
"""
        assert _run_emit(src) in ("5", "5.0")

    def test_cast_overload_on_custom_type(self) -> None:
        src = """
Person(name:str, age:num):
    :

str(p:Person):
    p.name & ", " & p.age

p : Person("Ada", 42)
:: str(p)
"""
        assert _run_emit(src) in ("Ada, 42", "Ada, 42.0")

    def test_cast_overload_rejects_builtin_only_param(self) -> None:
        src = 'str(s:str): s\n'
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError, match="custom or constructed"):
            ip.run_module(mod)

    def test_dot_reach_overload_on_custom_type(self) -> None:
        src = """
Pair(x:num, y:num):
    :

.(p:Pair, key:str):
    key = "left"? @: p.x
    key = "right"? @: p.y
    @

p : Pair(3, 4)
:: p.left
:: p.("right")
"""
        assert _run_emit(src) in ("3\n4", "3.0\n4.0")


class TestStructElementwiseMultisetFields:
    """Default struct multiset fields use count operators for ``+ - // %``."""

    @pytest.mark.parametrize("ch", ["+", "-", "//", "%"])
    def test_struct_field_multiset_ops_match_plain_multiset(self, ch: str) -> None:
        s = Multiset({1: 5, 2: 2})
        t = Multiset({1: 2, 2: 3, 3: 1})
        if ch == "+":
            expected = multiset_union(s, t)
        elif ch == "-":
            expected = multiset_difference(s, t)
        elif ch == "//":
            expected = multiset_count_floor_div(s, t)
        else:
            expected = multiset_count_mod(s, t)

        src = f"""
a : (m: {{1:5, 2:2}},)
b : (m: {{1:2, 2:3, 3:1}},)
r : a {ch} b
:: r.m
"""
        out = _run_emit(src)
        assert _parse_multiset_print(out) == expected

    @pytest.mark.parametrize("ch", ["*", "/"])
    def test_struct_field_multiset_star_and_slash_are_not_defined(self, ch: str) -> None:
        src = f"""
a : (m: {{1:2}},)
b : (m: {{1:1}},)
:: (a {ch} b)
"""
        with pytest.raises(EvalError, match=rf"operator \{ch} is not defined for multiset fields"):
            _run_emit(src)


class TestStructElementwiseArithmeticFields:
    """``%`` and ``^`` apply field-wise between structs (same shape)."""

    def test_struct_fieldwise_modulo(self) -> None:
        src = """
p : (x:10, y:9)
q : (x:4, y:3)
r : p % q
:: r.x + r.y
"""
        assert _run_emit(src) in ("2", "2.0")

    def test_struct_fieldwise_power(self) -> None:
        src = """
p : (x:2, y:3)
q : (x:4, y:2)
r : p ^ q
:: r.x + r.y
"""
        assert _run_emit(src) in ("25", "25.0")


class TestStructElementwiseNested:
    """Nested tagged structs combine field-wise recursively."""

    def test_nested_tagged_struct_plus(self) -> None:
        src = """
Inner(x:num, y:num):
    :

Outer(i:Inner, j:Inner):
    :

p : Outer(Inner(1, 2), Inner(3, 4))
q : Outer(Inner(5, 6), Inner(7, 8))
r : p + q
:: r.i.x + r.i.y + r.j.x + r.j.y
"""
        assert _run_emit(src) == "36"


class TestStructElementwiseTagRules:
    """Tagged vs untagged or mixed type names do not use default element-wise combine."""

    def test_tagged_plus_untagged_raises(self) -> None:
        src = """
Point(x:num, y:num):
    :

p : Point(1, 2)
q : (x:3, y:4)
:: p + q
"""
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError, match="overload"):
            ip.run_module(mod)

    def test_different_tagged_types_raise(self) -> None:
        src = """
A(x:num):
    :

B(y:num):
    :

p : A(1)
q : B(2)
:: p + q
"""
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError, match="overload"):
            ip.run_module(mod)

    def test_nested_untyped_struct_field_shape_mismatch_raises(self) -> None:
        """Inner records under the same field name must match keys for default ``+``."""
        src = """
p : (i: (x:1,),)
q : (i: (x:1, y:2),)
:: (p + q).i.x
"""
        mod = parse_module(src, filename="<test>")
        ip = Interpreter(Path(__file__))
        with pytest.raises(EvalError, match="nested struct"):
            ip.run_module(mod)


class TestEmitColonLocalScope:
    """``:: :`` prints bindings (see also ``TestPhase2TypesAndOps.test_emit_colon_prints_local_scope``)."""

    def test_emit_colon_nested_function_prints_locals(self) -> None:
        src = """
f(u:num, v:num):
    w : u + v
    :: :

f(10, 20)
:: 1
"""
        out = _run_emit(src)
        assert "u" in out and "v" in out and "w" in out
        assert "10" in out and "20" in out and "30" in out
