"""``::`` is rejected inside tuple/list/struct/map/multiset/call args (parse error)."""

from __future__ import annotations

import pytest

from vektorflow.errors import ParseError
from vektorflow.parser import parse_module


def test_emit_in_tuple_element_errors() -> None:
    with pytest.raises(ParseError, match="tuple literal"):
        parse_module("(1, 2::, 3)", "<t>")


def test_emit_after_tuple_element_errors() -> None:
    with pytest.raises(ParseError, match="tuple literal"):
        parse_module("(1, 2::)", "<t>")


def test_emit_whole_tuple_ok() -> None:
    parse_module(":: (1, 2)", "<t>")


def test_emit_in_vector_errors() -> None:
    with pytest.raises(ParseError, match="vector literal"):
        parse_module("[1, 2::, 3]", "<t>")


def test_emit_in_struct_field_errors() -> None:
    with pytest.raises(ParseError, match="struct literal"):
        parse_module('(x: 1::)', "<t>")


def test_emit_in_call_arg_errors() -> None:
    with pytest.raises(ParseError, match="function call argument"):
        parse_module('f(1, 2::)', "<t>")


def test_emit_in_op_call_arg_errors() -> None:
    with pytest.raises(ParseError, match="function call argument"):
        parse_module("+(1, 2::)", "<t>")


def test_multiset_comma_form_defaults_count_to_one() -> None:
    parse_module("{1, 2}", "<t>")


def test_emit_in_multiset_errors() -> None:
    with pytest.raises(ParseError, match="multiset literal"):
        parse_module("{1, 2::, 3}", "<t>")
