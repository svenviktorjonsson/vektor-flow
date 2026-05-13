"""Axis tagging via tight ``expr->access`` (reuse ``->`` token); same adjacency as ``.``."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError, ParseError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestAxisAlignArrowSyntax:
    def test_vector_arrow_prints_as_vector(self) -> None:
        src = """
v : [1, 2]->i
:: v
"""
        assert _emit(src) == "[1, 2]"

    def test_vector_arrow_idx(self) -> None:
        src = """
v : [1, 2]->i
:: v.idx
"""
        assert _emit(src) == "i"

    def test_vector_arrow_ij(self) -> None:
        src = """
w : [1, 2, 3]->ij
:: w.idx
"""
        assert _emit(src) == "ij"

    def test_arrow_underscore_means_i(self) -> None:
        src = """
v : [1]->_
:: v.idx
"""
        assert _emit(src) == "i"

    def test_tuple_positional_arrow(self) -> None:
        src = """
t : (1, 2)->j
:: t.idx
"""
        assert _emit(src) == "j"

    def test_multiset_arrow(self) -> None:
        src = """
m : {1:1, 2:1}->i
:: m.idx
"""
        assert _emit(src) == "i"

    def test_idx_assignment(self) -> None:
        src = """
v : [1, 2]->i
v.idx : "ij"
:: v.idx
"""
        assert _emit(src) == "ij"

    def test_same_axis_add(self) -> None:
        src = """
a : [1, 2]->i
b : [10, 20]->i
:: (a + b).0
"""
        assert _emit(src) == "11"

    def test_same_axis_vector_add_preserves_vector_display(self) -> None:
        src = """
a : [1, 2]->i
b : [10, 20]->i
:: a + b
"""
        assert _emit(src) == "[11, 22]"

    def test_variable_axis_disambiguated(self) -> None:
        """``a->i`` tags axis ``i``; ``i`` can still be a variable elsewhere."""
        src = """
a : [1, 2]
b : [10, 20]
:: (a->i + b->i).0
"""
        assert _emit(src) == "11"

    def test_arrow_label_not_variable_even_if_bound(self) -> None:
        src = """
ij : [9, 9]
v : [1, 2]->ij
:: v.idx
"""
        assert _emit(src) == "ij"

    def test_arrow_dynamic_axis_string(self) -> None:
        src = """
name : "ij"
v : [1, 2, 3]->(name)
:: v.idx
"""
        assert _emit(src) == "ij"

    def test_literal_arrow_inline(self) -> None:
        src = """
:: ([1, 2, 3]->j).idx
"""
        assert _emit(src) == "j"

    def test_different_axis_vector_broadcast_prints_grid(self) -> None:
        assert _emit(":: [1, 2]->i + [3, 5]->j\n") == "[[4, 6], [5, 7]]"

    def test_different_axis_broadcast_outer_is_left_operand(self) -> None:
        """Left axis is outer; swapping operands swaps which index is outer."""
        assert _emit(":: [3, 5]->j + [1, 2]->i\n") == "[[4, 5], [6, 7]]"

    def test_different_axis_broadcast_percent_and_caret(self) -> None:
        assert _emit(":: [10, 11]->i % [3, 4]->j\n") == "[[1, 2], [2, 3]]"
        assert _emit(":: [2, 3]->i ^ [4, 5]->j\n") == "[[16, 32], [81, 243]]"

    def test_different_axis_broadcast_eq(self) -> None:
        # Equality is ``=`` (not ``==``). Parentheses: ``->`` binds tighter than ``=``.
        assert (
            _emit(":: ([1, 2]->i) = ([2, 3]->j)\n")
            == "[[false, false], [true, false]]"
        )

    def test_different_axis_ampersand_does_not_broadcast(self) -> None:
        src = """
a : [1, 2]->i
b : [3, 4]->j
:: a & b
"""
        with pytest.raises(EvalError, match="does not broadcast"):
            _emit(src)

    def test_scalar_plus_axis_tagged_vector(self) -> None:
        assert _emit(":: 10 + [1, 2]->i\n") == "[11, 12]"

    def test_vector_relational_lt_gt_zip(self) -> None:
        assert _emit(":: ([1, 5, 3]) < ([2, 4, 4])\n") == "[true, false, true]"
        assert _emit(":: ([2, 4, 4]) > ([1, 5, 3])\n") == "[true, false, true]"

    def test_vector_truthiness_question_rejected(self) -> None:
        with pytest.raises(EvalError, match="vector cannot be used as a boolean"):
            _emit("[1, 2]?\n  :: 1\n")

    def test_double_question_match_still_ok_with_vector_discriminant(self) -> None:
        assert _emit("v : [1, 2]\nv??\n  [1, 2] => :: 9\n  :: 0\n") == "9"

    def test_double_axis_align_errors(self) -> None:
        src = """
a : [1, 2]->i
:: a->j
"""
        with pytest.raises(EvalError, match="already axis-tagged"):
            _emit(src)

    def test_axis_on_struct_errors(self) -> None:
        src = """
p : (x:1, y:2)
:: (p->i).x
"""
        with pytest.raises(EvalError, match="axis alignment"):
            _emit(src)

    def test_loose_arrow_before_access_errors(self) -> None:
        with pytest.raises(ParseError, match="no space before"):
            parse_module("v : [1, 2] -> i\n:: v\n", filename="<t>")

    def test_loose_arrow_after_operator_errors(self) -> None:
        with pytest.raises(ParseError, match="no space after"):
            parse_module("v : [1, 2]-> i\n:: v\n", filename="<t>")


class TestStructNoAxisField:
    def test_structlit_has_no_axis_tag(self) -> None:
        from vektorflow import ast as ast_mod
        from vektorflow.lexer import tokenize
        from vektorflow.parser import Parser

        toks = tokenize("q : (x:1, y:2)\n", filename="<t>")
        p = Parser(toks)
        mod = p.parse_module()
        bind = mod.statements[0]
        v = bind.value
        assert isinstance(v, ast_mod.StructLit)
        assert not hasattr(v, "axis_tag") or getattr(v, "axis_tag", None) is None
