"""Function types: ``Name : domain -> codomain`` with ``->``."""

from __future__ import annotations

from pathlib import Path

from vektorflow import ast
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _ip() -> Interpreter:
    return Interpreter(Path(__file__))


class TestFuncTypeParse:
    def test_num_to_num(self) -> None:
        m = parse_module("Ftype : num -> num", "<t>")
        b = m.statements[0]
        assert isinstance(b, ast.Bind)
        assert isinstance(b.value, ast.FuncType)
        assert isinstance(b.value.domain, ast.PrimTypeRef)
        assert b.value.domain.name == "num"
        assert b.value.codomain == "num"

    def test_tuple_domain(self) -> None:
        m = parse_module("Ftype : (num, num) -> num", "<t>")
        ft = m.statements[0]
        assert isinstance(ft, ast.Bind)
        d = ft.value.domain
        assert isinstance(d, ast.TupleTypeExpr)
        assert d.elements == ["num", "num"]
        assert ft.value.codomain == "num"

    def test_named_record_domain(self) -> None:
        m = parse_module("Ftype : (x:num, y:num) -> num", "<t>")
        ft = m.statements[0].value
        assert isinstance(ft, ast.FuncType)
        assert isinstance(ft.domain, ast.TypeExpr)
        assert ft.domain.fields == [("x", "num"), ("y", "num")]
        assert ft.codomain == "num"

    def test_record_interface_unchanged(self) -> None:
        m = parse_module("Point : (x:num, y:num)", "<t>")
        b = m.statements[0]
        assert isinstance(b.value, ast.TypeExpr)
        assert b.value.fields == [("x", "num"), ("y", "num")]


class TestFuncTypeInterpreter:
    def test_registers_func_type(self) -> None:
        ip = _ip()
        ip.run_module(parse_module("Ftype : num -> num", "<t>"))
        assert "Ftype" in ip.types
        ft = ip.types["Ftype"]
        assert isinstance(ft, ast.FuncType)
        assert ft.codomain == "num"
