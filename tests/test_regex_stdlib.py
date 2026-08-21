"""Stdlib ``regex`` — regular-expression matching and extraction."""

from __future__ import annotations

import pytest

from vektorflow.stdlib import resolve_stdlib


class TestRegexMatch:
    def test_named_groups(self) -> None:
        regex = resolve_stdlib("regex")
        result = regex["match"](
            "values are 10 and 20",
            r"values are (?P<a>\d+) and (?P<b>\d+)",
        )
        assert result == {"a": "10", "b": "20"}

    def test_numbered_groups_as_m0_m1(self) -> None:
        regex = resolve_stdlib("regex")
        result = regex["match"]("capture 10 and 20 from this", r"(\d+) and (\d+)")
        assert result["m0"] == "10"
        assert result["m1"] == "20"

    def test_no_match(self) -> None:
        regex = resolve_stdlib("regex")
        with pytest.raises(ValueError, match="did not match"):
            regex["match"]("nope", r"(?P<x>\d+)")


class TestRegexGroups:
    def test_tuple(self) -> None:
        regex = resolve_stdlib("regex")
        assert regex["groups"]("x: 3.14", r"(\d+)\.(\d+)") == ("3", "14")
