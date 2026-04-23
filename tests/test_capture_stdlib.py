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


class TestCaptureGroups:
    def test_tuple(self) -> None:
        c = resolve_stdlib("capture")
        assert c["groups"]("x: 3.14", r"(\d+)\.(\d+)") == ("3", "14")
