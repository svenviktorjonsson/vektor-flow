"""Function types: ``Name : domain -> codomain`` with ``->``."""

from __future__ import annotations

from pathlib import Path

from vektorflow import ast
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _ip() -> Interpreter:
    return Interpreter(Path(__file__))


class TestFuncTypeParse:
    def test_prefix_typed_bind_parse(self) -> None:
        m = parse_module("[num:2] v: [1,2]", "<t>")
        b = m.statements[0]
        assert isinstance(b, ast.Bind)
        assert isinstance(b.declared_type, ast.FixedVectorType)
        assert isinstance(b.declared_type.element_type, ast.PrimTypeRef)
        assert b.declared_type.element_type.name == "num"

    def test_num_to_num(self) -> None:
        m = parse_module("Ftype : num -> num", "<t>")
        b = m.statements[0]
        assert isinstance(b, ast.Bind)
        assert isinstance(b.value, ast.FuncType)
        assert isinstance(b.value.domain, ast.PrimTypeRef)
        assert b.value.domain.name == "num"
        assert isinstance(b.value.codomain, ast.PrimTypeRef)
        assert b.value.codomain.name == "num"

    def test_tuple_domain(self) -> None:
        m = parse_module("Ftype : (num, num) -> num", "<t>")
        ft = m.statements[0]
        assert isinstance(ft, ast.Bind)
        d = ft.value.domain
        assert isinstance(d, ast.TupleTypeExpr)
        assert all(isinstance(x, ast.PrimTypeRef) for x in d.elements)
        assert [x.name for x in d.elements] == ["num", "num"]
        assert isinstance(ft.value.codomain, ast.PrimTypeRef)
        assert ft.value.codomain.name == "num"

    def test_named_record_domain(self) -> None:
        m = parse_module("Ftype : (x:num, y:num) -> num", "<t>")
        ft = m.statements[0].value
        assert isinstance(ft, ast.FuncType)
        assert isinstance(ft.domain, ast.TypeExpr)
        assert isinstance(ft.domain.fields[0][1], ast.PrimTypeRef)
        assert isinstance(ft.domain.fields[1][1], ast.PrimTypeRef)
        assert [(n, t.name) for n, t in ft.domain.fields] == [("x", "num"), ("y", "num")]
        assert isinstance(ft.codomain, ast.PrimTypeRef)
        assert ft.codomain.name == "num"

    def test_record_interface_unchanged(self) -> None:
        m = parse_module("Point : (x:num, y:num)", "<t>")
        b = m.statements[0]
        assert isinstance(b.value, ast.TypeExpr)
        assert [(n, t.name) for n, t in b.value.fields] == [("x", "num"), ("y", "num")]

    def test_fixed_vector_type_binding(self) -> None:
        m = parse_module("Vec3 : [num:3]", "<t>")
        b = m.statements[0]
        assert isinstance(b, ast.Bind)
        assert isinstance(b.value, ast.FixedVectorType)
        assert isinstance(b.value.element_type, ast.PrimTypeRef)
        assert b.value.element_type.name == "num"
        assert isinstance(b.value.size, ast.TypeSizeConst)
        assert b.value.size.value == 3

    def test_symbolic_fixed_vector_param_and_named_return(self) -> None:
        m = parse_module(
            "func(x:[num:n]) -> x:[num:n+1]: [:x,1]",
            "<t>",
        )
        f = m.statements[0]
        assert isinstance(f, ast.FuncDef)
        assert isinstance(f.params[0].type_ref, ast.FixedVectorType)
        ptype = f.params[0].type_ref
        assert isinstance(ptype.size, ast.TypeSizeVar)
        assert ptype.size.name == "n"
        assert f.func_type is not None
        assert isinstance(f.func_type.codomain, ast.NamedTypeSpec)
        assert f.func_type.codomain.name == "x"
        rtype = f.func_type.codomain.type_expr
        assert isinstance(rtype, ast.FixedVectorType)
        assert isinstance(rtype.size, ast.TypeSizeBinOp)
        assert rtype.size.op == "+"

    def test_tuple_type_can_contain_fixed_vectors(self) -> None:
        m = parse_module("Ftype : ([num:n], [num:n+1]) -> [num:n+1]", "<t>")
        ft = m.statements[0].value
        assert isinstance(ft, ast.FuncType)
        assert isinstance(ft.domain, ast.TupleTypeExpr)
        assert isinstance(ft.domain.elements[0], ast.FixedVectorType)
        assert isinstance(ft.codomain, ast.FixedVectorType)

    def test_record_domain_can_contain_symbolic_nested_vectors(self) -> None:
        m = parse_module("Ftype : (left:[num:n], right:[num:n+1]) -> (left:[num:n], right:[num:n+1])", "<t>")
        ft = m.statements[0].value
        assert isinstance(ft, ast.FuncType)
        assert isinstance(ft.domain, ast.TypeExpr)
        assert isinstance(ft.domain.fields[0][1], ast.FixedVectorType)
        assert isinstance(ft.codomain, ast.TypeExpr)

    def test_multiset_type_binding_parse(self) -> None:
        m = parse_module("Bag : {num}", "<t>")
        b = m.statements[0]
        assert isinstance(b.value, ast.MultisetType)
        assert isinstance(b.value.element_type, ast.PrimTypeRef)
        assert b.value.element_type.name == "num"


class TestFuncTypeInterpreter:
    def test_registers_func_type(self) -> None:
        ip = _ip()
        ip.run_module(parse_module("Ftype : num -> num", "<t>"))
        assert "Ftype" in ip.types
        ft = ip.types["Ftype"]
        assert isinstance(ft, ast.FuncType)
        assert isinstance(ft.codomain, ast.PrimTypeRef)
        assert ft.codomain.name == "num"

    def test_stringify_fixed_vector_type_nodes(self) -> None:
        ip = _ip()
        ip.run_module(parse_module("Vec3 : [num:3]", "<t>"))
        assert ip._stringify_for_display(ip.types["Vec3"], ip.globals) == "[num:3]"

    def test_symbolic_fixed_vector_return_is_checked(self) -> None:
        ip = _ip()
        src = """
extend(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y

out: extend([1,2], [3,4,5])
"""
        ip.run_module(parse_module(src, "<t>"))
        assert ip._stringify_for_display(ip.globals["out"], ip.globals) == "[1, 2, 3, 4, 5]"
