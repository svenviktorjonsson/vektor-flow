"""Vector literals: ``value : count`` repeats."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestVectorRepeat:
    def test_two_three_equals_three_twos(self) -> None:
        assert _emit(":: [2:3]") == "[2, 2, 2]"

    def test_user_example(self) -> None:
        assert _emit(":: [3:4,5:2]") == "[3, 3, 3, 3, 5, 5]"

    def test_with_spaces(self) -> None:
        assert _emit(":: [3 : 4, 5 : 2]") == "[3, 3, 3, 3, 5, 5]"

    def test_mixed_with_plain_elements(self) -> None:
        assert _emit(":: [1, 2:2, 3]") == "[1, 2, 2, 3]"

    def test_zero_count(self) -> None:
        assert _emit(":: [7:0]") == "[]"
