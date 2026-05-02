from __future__ import annotations

from vektorflow.errors import ERROR_NAMESPACE
from vektorflow import ast
from vektorflow.runtime.compare import (
    runtime_match_eq,
    runtime_match_specificity,
    struct_compare_binop,
)
from vektorflow.runtime.struct_value import with_type
from vektorflow.runtime.type_values import PrimType
from vektorflow.stdlib.events import MouseEvent, encode_event_code, encode_ui_pattern


def test_struct_compare_binop_handles_ordering_and_equality() -> None:
    point_type = {
        "Point": ast.TypeExpr(fields=[("x", "num"), ("y", "num")]),
    }
    left = with_type("Point", {"x": 1, "y": 2})
    right = with_type("Point", {"x": 1, "y": 3})

    assert struct_compare_binop("LT", left, right, point_type) is True
    assert struct_compare_binop("LE", left, right, point_type) is True
    assert struct_compare_binop("GT", right, left, point_type) is True
    assert struct_compare_binop("GE", right, left, point_type) is True
    assert struct_compare_binop("EQ", left, left, point_type) is True
    assert struct_compare_binop("NEQ", left, right, point_type) is True


def test_struct_compare_binop_returns_none_for_unsupported_operator() -> None:
    point_type = {
        "Point": ast.TypeExpr(fields=[("x", "num")]),
    }
    left = with_type("Point", {"x": 1})
    right = with_type("Point", {"x": 2})

    assert struct_compare_binop("PLUS", left, right, point_type) is None


def test_runtime_match_eq_prefers_struct_semantics() -> None:
    point_type = {
        "Point": ast.TypeExpr(fields=[("x", "num")]),
    }
    left = with_type("Point", {"x": 1})
    right = with_type("Point", {"x": 1})

    matched = runtime_match_eq(left, right, point_type, lambda a, b: a == b)

    assert matched is True


def test_runtime_match_specificity_prefers_exact_non_event_match() -> None:
    specificity = runtime_match_specificity("hello", "hello", {}, lambda a, b: a == b)

    assert specificity == 1_000_000


def test_runtime_match_specificity_matches_runtime_type_value() -> None:
    specificity = runtime_match_specificity(
        True,
        PrimType("bool"),
        {},
        lambda a, b: a == b,
    )

    assert specificity == 1


def test_runtime_match_specificity_matches_specific_error_type() -> None:
    specificity = runtime_match_specificity(
        KeyError("missing"),
        ERROR_NAMESPACE["KEY_ERROR"],
        {},
        lambda a, b: a == b,
    )

    assert specificity is not None


def test_runtime_match_specificity_matches_host_event_object_to_ui_pattern() -> None:
    event = MouseEvent.from_dict({
        "event": "drag",
        "x": 0,
        "y": 0,
        "code": encode_event_code("drag", "f1"),
        "ui_code": encode_ui_pattern("drag"),
    })

    specificity = runtime_match_specificity(
        event,
        encode_ui_pattern("drag"),
        {},
        lambda a, b: a == b,
    )

    assert specificity == 0


def test_runtime_match_specificity_uses_ui_code_fallback_for_host_event_object() -> None:
    event = MouseEvent.from_dict({
        "event": "drag",
        "x": 0,
        "y": 0,
        "ui_code": encode_ui_pattern("drag"),
    })

    specificity = runtime_match_specificity(
        event,
        encode_ui_pattern("drag"),
        {},
        lambda a, b: a == b,
    )

    assert specificity == 0


def test_runtime_match_specificity_matches_host_event_payload_to_ui_pattern() -> None:
    event = {
        "event": "drag",
        "code": encode_event_code("drag", "f1"),
        "ui_code": encode_ui_pattern("drag"),
    }

    specificity = runtime_match_specificity(
        event,
        encode_ui_pattern("drag"),
        {},
        lambda a, b: a == b,
    )

    assert specificity == 0


def test_runtime_match_specificity_uses_ui_code_fallback_for_host_event_payload() -> None:
    event = {
        "event": "drag",
        "ui_code": encode_ui_pattern("drag"),
    }

    specificity = runtime_match_specificity(
        event,
        encode_ui_pattern("drag"),
        {},
        lambda a, b: a == b,
    )

    assert specificity == 0
