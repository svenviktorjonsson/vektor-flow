"""Stdlib ``capture`` — regex-based extraction."""

from __future__ import annotations

import pytest

from vektorflow.stdlib import resolve_stdlib


class TestCaptureRegex:
    def test_named_groups(self) -> None:
        c = resolve_stdlib("capture")
        d = c["regex"](
            "values are 10 and 20",
            r"values are (?P<a>\d+) and (?P<b>\d+)",
        )
        assert d == {"a": "10", "b": "20"}

    def test_numbered_groups_as_m0_m1(self) -> None:
        c = resolve_stdlib("capture")
        d = c["regex"]("capture 10 and 20 from this", r"(\d+) and (\d+)")
        assert d["m0"] == "10"
        assert d["m1"] == "20"

    def test_no_match(self) -> None:
        c = resolve_stdlib("capture")
        with pytest.raises(ValueError, match="no match"):
            c["regex"]("nope", r"(?P<x>\d+)")

    def test_optional_named_groups_drop_missing_values(self) -> None:
        c = resolve_stdlib("capture")
        d = c["regex"]("capture 10", r"capture (?P<a>\d+)(?: and (?P<b>\d+))?")
        assert d == {"a": "10"}

    def test_no_groups_falls_back_to_full_match_under_underscore(self) -> None:
        c = resolve_stdlib("capture")
        d = c["regex"]("hello 42 world", r"\d+")
        assert d == {"_": "42"}


class TestCaptureGroups:
    def test_tuple(self) -> None:
        c = resolve_stdlib("capture")
        assert c["groups"]("x: 3.14", r"(\d+)\.(\d+)") == ("3", "14")
