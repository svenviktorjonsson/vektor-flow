"""Function types: ``Name : domain -> codomain`` with ``->``."""

from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow import ast
from vektorflow.interpreter import Interpreter
from vektorflow.parser import ParseError, parse_module


def _ip() -> Interpreter:
    return Interpreter(Path(__file__))


class TestFuncTypeParse:
    def test_func_def_declaration_style_params(self) -> None:
        m = parse_module("f(num x, int y): x", "<t>")
        f = m.statements[0]
        assert isinstance(f, ast.FuncDef)
        assert [p.name for p in f.params] == ["x", "y"]
        assert [p.type_name for p in f.params] == ["num", "int"]

    def test_func_type_named_declaration_style_domain(self) -> None:
        m = parse_module("Ftype : (num x, num y) -> num", "<t>")
        ft = m.statements[0].value
        assert isinstance(ft, ast.FuncType)
        assert isinstance(ft.domain, ast.TypeExpr)
        assert [(n, t.name) for n, t in ft.domain.fields] == [("x", "num"), ("y", "num")]

    def test_old_style_func_params_still_parse(self) -> None:
        m = parse_module("f(x:num, y:int): x", "<t>")
        f = m.statements[0]
        assert isinstance(f, ast.FuncDef)
        assert [p.name for p in f.params] == ["x", "y"]
        assert [p.type_name for p in f.params] == ["num", "int"]

    def test_declaration_style_params_and_defaults_parse(self) -> None:
        m = parse_module("f(num x, int y=4): x", "<t>")
        f = m.statements[0]
        assert isinstance(f, ast.FuncDef)
        assert [p.name for p in f.params] == ["x", "y"]
        assert [p.type_name for p in f.params] == ["num", "int"]
        assert f.params[0].default_expr is None
        assert isinstance(f.params[1].default_expr, ast.NumberLit)

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

    def test_type_union_and_intersection_parse_with_precedence(self) -> None:
        m = parse_module("Choice : num|str&int", "<t>")
        b = m.statements[0]
        assert isinstance(b, ast.Bind)
        assert isinstance(b.value, ast.TypeUnionExpr)
        assert len(b.value.members) == 2
        assert isinstance(b.value.members[0], ast.PrimTypeRef)
        assert b.value.members[0].name == "num"
        assert isinstance(b.value.members[1], ast.TypeIntersectionExpr)
        assert [member.name for member in b.value.members[1].members] == ["str", "int"]

    def test_declaration_style_param_accepts_union_and_intersection_types(self) -> None:
        m = parse_module("f(num|str x, num&int y): x", "<t>")
        f = m.statements[0]
        assert isinstance(f, ast.FuncDef)
        assert isinstance(f.params[0].type_ref, ast.TypeUnionExpr)
        assert isinstance(f.params[1].type_ref, ast.TypeIntersectionExpr)

    def test_tight_arrow_after_rparen_rejected_in_func_def(self) -> None:
        with pytest.raises(ParseError, match="spaced ` -> `"):
            parse_module("f(x:num)->num:\n  1\n", "<t>")

    def test_spaced_arrow_after_rparen_ok_in_func_def(self) -> None:
        m = parse_module("f(x:num) -> num:\n  1\n", "<t>")
        assert isinstance(m.statements[0], ast.FuncDef)

    def test_tight_arrow_after_rparen_rejected_in_type_bind(self) -> None:
        with pytest.raises(ParseError, match="spaced ` -> `"):
            parse_module("Ftype : (num)->num", "<t>")

    def test_empty_tuple_type_arrow_requires_space(self) -> None:
        with pytest.raises(ParseError, match="spaced ` -> `"):
            parse_module("Ftype : ()->num", "<t>")
        m = parse_module("Ftype : () -> num", "<t>")
        assert isinstance(m.statements[0].value, ast.FuncType)


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
