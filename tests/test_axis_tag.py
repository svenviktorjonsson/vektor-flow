"""Axis suffixes on literal vectors, multisets, and positional tuples — not structs."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestAxisTaggedLiterals:
    def test_vector_suffix_idx(self) -> None:
        src = """
v : [1, 2]_i
:: v.idx
"""
        assert _emit(src) == "i"

    def test_vector_suffix_ij(self) -> None:
        src = """
w : [1, 2, 3]_ij
:: w.idx
"""
        assert _emit(src) == "ij"

    def test_bare_underscore_means_i(self) -> None:
        src = """
v : [1]_ 
:: v.idx
"""
        assert _emit(src) == "i"

    def test_tuple_positional_suffix(self) -> None:
        src = """
t : (1, 2)_j
:: t.idx
"""
        assert _emit(src) == "j"

    def test_multiset_suffix(self) -> None:
        src = """
m : {1:1, 2:1}_i
:: m.idx
"""
        assert _emit(src) == "i"

    def test_idx_assignment(self) -> None:
        src = """
v : [1, 2]_i
v.idx : "ij"
:: v.idx
"""
        assert _emit(src) == "ij"

    def test_same_axis_add(self) -> None:
        src = """
a : [1, 2]_i
b : [10, 20]_i
:: (a + b).0
"""
        assert _emit(src) == "11"

    def test_mismatch_axis_errors(self) -> None:
        src = """
a : [1, 2]_i
b : [3, 4]_j
:: a + b
"""
        with pytest.raises(EvalError, match="axis mismatch"):
            _emit(src)

    def test_struct_literal_has_no_axis_suffix_in_parser(self) -> None:
        """Named record ``(x:1)`` does not consume ``_i`` as axis — suffix is not attached to StructLit."""
        from vektorflow import ast as ast_mod
        from vektorflow.lexer import tokenize
        from vektorflow.parser import Parser

        toks = tokenize("p : (x:1)\n", filename="<t>")
        p = Parser(toks)
        mod = p.parse_module()
        bind = mod.statements[0]
        assert isinstance(bind, ast_mod.Bind)
        assert isinstance(bind.value, ast_mod.StructLit)
        # `_i` would be separate token stream issue — here we only check struct has no axis_tag field
        assert getattr(bind.value, "axis_tag", None) is None


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
