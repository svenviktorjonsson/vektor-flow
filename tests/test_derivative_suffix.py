from __future__ import annotations

import pytest

from vektorflow import ast
from vektorflow.errors import ParseError
from vektorflow.parser import parse_module


def _printed_expr(source: str) -> object:
    module = parse_module(f":: {source}\n", filename="<derivative-test>")
    stmt = module.statements[0]
    assert isinstance(stmt, ast.StdioPrint)
    return stmt.value


def _ident_names(values: list[object]) -> list[str]:
    out: list[str] = []
    for value in values:
        assert isinstance(value, ast.Ident)
        out.append(value.name)
    return out


def test_prime_suffix_uses_variable_before_call_args_for_multiletter_name() -> None:
    expr = _printed_expr("f'phi(phi)")
    assert isinstance(expr, ast.DerivativeExpr)
    assert _ident_names(expr.variables) == ["phi"]
    assert expr.call_args is not None
    assert _ident_names(expr.call_args) == ["phi"]


def test_second_prime_suffix_accepts_spaced_multiletter_variables_before_call_args() -> None:
    expr = _printed_expr("f''phi phi(phi)")
    assert isinstance(expr, ast.DerivativeExpr)
    assert _ident_names(expr.variables) == ["phi", "phi"]
    assert expr.call_args is not None
    assert _ident_names(expr.call_args) == ["phi"]


def test_compact_prime_suffix_still_supports_single_letter_variables() -> None:
    expr = _printed_expr("f''xy(x, y)")
    assert isinstance(expr, ast.DerivativeExpr)
    assert _ident_names(expr.variables) == ["x", "y"]
    assert expr.call_args is not None
    assert _ident_names(expr.call_args) == ["x", "y"]


def test_single_argument_call_can_supply_omitted_derivative_variable() -> None:
    expr = _printed_expr("f''(phi)")
    assert isinstance(expr, ast.DerivativeExpr)
    assert _ident_names(expr.variables) == ["phi", "phi"]
    assert expr.call_args is not None
    assert _ident_names(expr.call_args) == ["phi"]


def test_multi_argument_call_requires_explicit_derivative_variables() -> None:
    with pytest.raises(ParseError, match="requires one variable per prime before call arguments"):
        parse_module(":: f''(phi, psi)\n", filename="<derivative-test>")


def test_joined_multiletter_variables_are_one_identifier_and_need_separation() -> None:
    with pytest.raises(ParseError, match="requires one variable per prime before call arguments"):
        parse_module(":: f''phiphi(phi)\n", filename="<derivative-test>")


def test_differential_operator_lowers_to_diff_call_until_next_addition() -> None:
    expr = _printed_expr("d/dx x^2 + y")
    assert isinstance(expr, ast.BinOp)
    assert expr.op == "PLUS"
    assert isinstance(expr.left, ast.Call)
    assert isinstance(expr.left.func, ast.Ident)
    assert expr.left.func.name == "diff"
    assert isinstance(expr.left.args[1], ast.Ident)
    assert expr.left.args[1].name == "x"


def test_nth_differential_operator_carries_order() -> None:
    expr = _printed_expr("d^n/dx^n x")
    assert isinstance(expr, ast.Call)
    assert isinstance(expr.func, ast.Ident)
    assert expr.func.name == "diff"
    assert len(expr.args) == 3
    assert isinstance(expr.args[2], ast.Ident)
    assert expr.args[2].name == "n"


def test_differential_marker_after_expression_lowers_to_integ_call() -> None:
    expr = _printed_expr("x dx")
    assert isinstance(expr, ast.Call)
    assert isinstance(expr.func, ast.Ident)
    assert expr.func.name == "integ"
    assert isinstance(expr.args[1], ast.Ident)
    assert expr.args[1].name == "x"
