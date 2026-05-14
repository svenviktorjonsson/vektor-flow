"""Axis suffixes on literal vectors, multisets, and positional tuples — not structs."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime import (
    AxisTaggedValue,
    axis_tagged_binary_op,
    axis_tagged_data,
    axis_tagged_idx,
    axis_tagged_set_idx,
    axis_tagged_stringify,
    axis_tagged_wrap,
    is_axis_tagged_value,
)


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

    def test_vector_arrow_axis_idx(self) -> None:
        src = """
v : [1, 2] -> i
:: v.idx
"""
        assert _emit(src) == "i"

    def test_arrow_axis_broadcasts_like_suffix(self) -> None:
        src = """
a : [1, 2] -> i
b : [10, 20] -> j
out : a * b
:: out.idx
:: out.(0).(1)
"""
        assert _emit(src).splitlines() == ["ij", "20"]

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

    def test_axis_tagged_display_uses_underlying_value_shape(self) -> None:
        src = """
v : [1, 2]_i
:: v
"""
        assert _emit(src) == "(1, 2)"

    def test_same_axis_add(self) -> None:
        src = """
a : [1, 2]_i
b : [10, 20]_i
:: (a + b).0
"""
        assert _emit(src) == "11"

    def test_shared_axis_length_mismatch_errors(self) -> None:
        src = """
a : [[1, 2], [3, 4]]_ij
b : [10, 20, 30]_j
:: a + b
"""
        with pytest.raises(EvalError, match="axis length mismatch"):
            _emit(src)

    def test_different_axes_broadcast_to_outer_result(self) -> None:
        src = """
a : [1, 2]_i
b : [10, 20]_j
out : a * b
:: out.idx
:: out.(0).(0)
:: out.(0).(1)
:: out.(1).(0)
:: out.(1).(1)
"""
        assert _emit(src).splitlines() == ["ij", "10", "20", "20", "40"]

    def test_shared_axis_broadcasts_across_missing_axis(self) -> None:
        src = """
a : [[1, 2], [3, 4]]_ij
b : [10, 20]_j
out : a * b
:: out.idx
:: out.(0).(0)
:: out.(0).(1)
:: out.(1).(0)
:: out.(1).(1)
"""
        assert _emit(src).splitlines() == ["ij", "10", "40", "30", "80"]

    def test_named_axes_align_even_when_operand_order_differs(self) -> None:
        src = """
a : [[1, 2], [3, 4]]_ij
b : [[10, 20], [100, 200]]_ki
out : a * b
:: out.idx
:: out.(0).(1).(1)
:: out.(1).(0).(0)
"""
        assert _emit(src).splitlines() == ["ijk", "200", "60"]

    def test_struct_literal_has_no_axis_suffix_in_parser(self) -> None:
        """Named record ``(x:1,)`` does not consume ``_i`` as axis — suffix is not attached to StructLit."""
        from vektorflow import ast as ast_mod
        from vektorflow.lexer import tokenize
        from vektorflow.parser import Parser

        toks = tokenize("p : (x:1,)\n", filename="<t>")
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


class TestAxisTaggedRuntimeHelpers:
    def test_wrap_idx_data_and_predicate_share_runtime_contract(self) -> None:
        tagged = axis_tagged_wrap((1, 2), "ij")
        assert isinstance(tagged, AxisTaggedValue)
        assert is_axis_tagged_value(tagged) is True
        assert axis_tagged_idx(tagged) == "ij"
        assert axis_tagged_data(tagged) == (1, 2)

        plain = axis_tagged_wrap((1, 2), None)
        assert plain == (1, 2)
        assert is_axis_tagged_value(plain) is False
        assert axis_tagged_idx(plain) is None
        assert axis_tagged_data(plain) == (1, 2)

    def test_set_idx_mutates_only_axis_tagged_values(self) -> None:
        tagged = AxisTaggedValue((1, 2), "i")
        assert axis_tagged_set_idx(tagged, "ij") is True
        assert tagged.idx == "ij"
        assert axis_tagged_set_idx((1, 2), "k") is False

    def test_stringify_delegates_to_runtime_owned_axis_tagged_data(self) -> None:
        tagged = AxisTaggedValue((1, 2), "i")
        assert axis_tagged_stringify(tagged, lambda item: repr(item)) == "(1, 2)"
        assert axis_tagged_stringify((1, 2), lambda item: repr(item)) is None

    def test_axis_tagged_binary_op_adds_matching_tuple_axes(self) -> None:
        handled, value = axis_tagged_binary_op(
            "PLUS",
            AxisTaggedValue((1, 2), "i"),
            AxisTaggedValue((10, 20), "i"),
            ValueError,
        )
        assert handled is True
        assert axis_tagged_idx(value) == "i"
        assert axis_tagged_data(value) == (11, 22)

    def test_axis_tagged_binary_op_scales_tuple_with_scalar(self) -> None:
        handled, value = axis_tagged_binary_op(
            "STAR",
            AxisTaggedValue((1, 2), "i"),
            3,
            ValueError,
        )
        assert handled is True
        assert axis_tagged_idx(value) == "i"
        assert axis_tagged_data(value) == (3.0, 6.0)

    def test_axis_tagged_binary_op_broadcasts_disjoint_axes(self) -> None:
        handled, value = axis_tagged_binary_op(
            "PLUS",
            AxisTaggedValue((1, 2), "i"),
            AxisTaggedValue((10, 20), "j"),
            ValueError,
        )
        assert handled is True
        assert axis_tagged_idx(value) == "ij"
        assert axis_tagged_data(value) == ((11, 21), (12, 22))

    def test_axis_tagged_binary_op_rejects_mixed_tagged_and_untagged(self) -> None:
        with pytest.raises(ValueError, match="cannot mix axis-tagged and untagged operands"):
            axis_tagged_binary_op(
                "PLUS",
                AxisTaggedValue((1, 2), "i"),
                (10, 20),
                ValueError,
            )
