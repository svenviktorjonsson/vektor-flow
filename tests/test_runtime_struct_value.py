from __future__ import annotations

from types import SimpleNamespace

from vektorflow import ast
from vektorflow.runtime.struct_value import (
    apply_struct_unary_fallback,
    bind_struct_constructor_fields,
    VF_TYPE_KEY,
    combine_struct_values_elementwise,
    construct_struct_value,
    get_type_name,
    merge_struct_values,
    read_struct_field,
    score_struct_type_match,
    snapshot_scope_record,
    stringify_struct_value,
    with_type,
)


def test_merge_struct_values_preserves_matching_type_and_overrides_rhs() -> None:
    left = with_type("Point", {"x": 1, "y": 2})
    right = with_type("Point", {"y": 9, "z": 3})

    merged = merge_struct_values(left, right)

    assert get_type_name(merged) == "Point"
    assert merged["x"] == 1
    assert merged["y"] == 9
    assert merged["z"] == 3


def test_merge_struct_values_drops_type_when_record_types_differ() -> None:
    left = with_type("Point", {"x": 1})
    right = with_type("Vec", {"y": 2})

    merged = merge_struct_values(left, right)

    assert get_type_name(merged) is None
    assert VF_TYPE_KEY not in merged
    assert merged == {"x": 1, "y": 2}


def test_merge_struct_values_treats_untagged_records_as_plain_records() -> None:
    left = with_type(None, {"x": 1})
    right = with_type(None, {"x": 4, "y": 2})

    merged = merge_struct_values(left, right)

    assert get_type_name(merged) is None
    assert merged == {"x": 4, "y": 2}


def test_stringify_struct_value_preserves_tagged_type_name_and_field_order() -> None:
    point_type = {
        "Point": ast.TypeExpr(fields=[("x", "num"), ("y", "num")]),
    }
    value = with_type("Point", {"y": 2, "x": 1})

    shown = stringify_struct_value(value, point_type, str)

    assert shown == "Point(x:1, y:2)"


def test_stringify_struct_value_sorts_untagged_record_keys() -> None:
    value = with_type(None, {"b": 2, "a": 1})

    shown = stringify_struct_value(value, None, str)

    assert shown == "(a:1, b:2)"


def test_combine_struct_values_elementwise_preserves_tag_and_declared_field_order() -> None:
    point_type = {
        "Point": ast.TypeExpr(fields=[("x", "num"), ("y", "num")]),
    }
    left = with_type("Point", {"y": 2, "x": 1})
    right = with_type("Point", {"x": 10, "y": 20})

    combined = combine_struct_values_elementwise(left, right, point_type, lambda a, b: a + b)

    assert combined == with_type("Point", {"x": 11, "y": 22})


def test_combine_struct_values_elementwise_returns_none_for_mixed_tagged_and_untagged() -> None:
    point_type = {
        "Point": ast.TypeExpr(fields=[("x", "num")]),
    }
    left = with_type("Point", {"x": 1})
    right = with_type(None, {"x": 2})

    combined = combine_struct_values_elementwise(left, right, point_type, lambda a, b: a + b)

    assert combined is None


def test_combine_struct_values_elementwise_returns_empty_tagged_record_for_empty_shape() -> None:
    empty_type = {
        "Empty": ast.TypeExpr(fields=[]),
    }
    left = with_type("Empty", {})
    right = with_type("Empty", {})

    combined = combine_struct_values_elementwise(left, right, empty_type, lambda a, b: a + b)

    assert combined == with_type("Empty", {})


def test_snapshot_scope_record_filters_runtime_type_key() -> None:
    scope = {"x": 1, "y": 2, VF_TYPE_KEY: "Point"}

    snapped = snapshot_scope_record(scope)

    assert snapped == {"x": 1, "y": 2}
    assert VF_TYPE_KEY not in snapped


def test_score_struct_type_match_prefers_exact_tag_match() -> None:
    types = {
        "Point": ast.TypeExpr(fields=[("x", "num"), ("y", "num")]),
    }
    value = with_type("Point", {"x": 1, "y": 2})

    score = score_struct_type_match(value, "Point", types)

    assert score == 2


def test_score_struct_type_match_accepts_untagged_shape_match() -> None:
    types = {
        "Point": ast.TypeExpr(fields=[("x", "num"), ("y", "num")]),
    }
    value = with_type(None, {"x": 1, "y": 2, "z": 3})

    score = score_struct_type_match(value, "Point", types)

    assert score == 1


def test_score_struct_type_match_rejects_missing_field_shape() -> None:
    types = {
        "Point": ast.TypeExpr(fields=[("x", "num"), ("y", "num")]),
    }
    value = with_type(None, {"x": 1})

    score = score_struct_type_match(value, "Point", types)

    assert score is None


def test_construct_struct_value_tags_named_constructor_result() -> None:
    value = construct_struct_value("Point", {"x": 1, "y": 2})

    assert get_type_name(value) == "Point"
    assert value["x"] == 1
    assert value["y"] == 2


def test_construct_struct_value_does_not_mutate_input_fields() -> None:
    fields = {"x": 1}

    value = construct_struct_value("Point", fields)
    fields["x"] = 9

    assert value["x"] == 1


def test_bind_struct_constructor_fields_accepts_positional_and_keyword_args() -> None:
    params = [
        SimpleNamespace(name="x", type_name="num"),
        SimpleNamespace(name="y", type_name="num"),
    ]

    bound = bind_struct_constructor_fields(
        "Point",
        params,
        [1],
        {"y": 2},
        lambda value, _type_name: value,
        ValueError,
    )

    assert bound == {"x": 1, "y": 2}


def test_bind_struct_constructor_fields_rejects_unknown_keyword() -> None:
    params = [SimpleNamespace(name="x", type_name="num")]

    try:
        bind_struct_constructor_fields(
            "Point",
            params,
            [],
            {"z": 9},
            lambda value, _type_name: value,
            ValueError,
        )
    except ValueError as exc:
        assert str(exc) == "Point: unknown field 'z'"
    else:
        raise AssertionError("expected ValueError")


def test_bind_struct_constructor_fields_rejects_missing_field() -> None:
    params = [SimpleNamespace(name="x", type_name="num")]

    try:
        bind_struct_constructor_fields(
            "Point",
            params,
            [],
            {},
            lambda value, _type_name: value,
            ValueError,
        )
    except ValueError as exc:
        assert str(exc) == "Point: missing field 'x'"
    else:
        raise AssertionError("expected ValueError")


def test_read_struct_field_returns_existing_value() -> None:
    value = with_type("Point", {"x": 1, "y": 2})

    field = read_struct_field(value, "x", ValueError)

    assert field == 1


def test_read_struct_field_rejects_missing_field() -> None:
    value = with_type("Point", {"x": 1})

    try:
        read_struct_field(value, "y", ValueError)
    except ValueError as exc:
        assert str(exc) == "missing field 'y'"
    else:
        raise AssertionError("expected ValueError")


def test_read_struct_field_rejects_non_struct_value() -> None:
    try:
        read_struct_field(123, "x", ValueError)
    except ValueError as exc:
        assert str(exc) == "attribute access on non-struct"
    else:
        raise AssertionError("expected ValueError")


def test_apply_struct_unary_fallback_rejects_struct_negation() -> None:
    try:
        apply_struct_unary_fallback("MINUS", {"x": 1}, ValueError)
    except ValueError as exc:
        assert str(exc) == "struct negation requires -(a): … overload"
    else:
        raise AssertionError("expected ValueError")


def test_apply_struct_unary_fallback_rejects_struct_not() -> None:
    try:
        apply_struct_unary_fallback("NOT", {"x": 1}, ValueError)
    except ValueError as exc:
        assert str(exc) == "struct ~ requires ~(a): … overload"
    else:
        raise AssertionError("expected ValueError")


def test_apply_struct_unary_fallback_ignores_non_struct_values() -> None:
    handled, result = apply_struct_unary_fallback("MINUS", 3, ValueError)

    assert handled is False
    assert result is None
