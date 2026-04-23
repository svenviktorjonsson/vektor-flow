"""Boolean ``/\\`` / ``\\/`` / ``><`` / ``~``."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _emit_bool(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestXor:
    def test_xor_true_false(self) -> None:
        assert _emit_bool(":: (1 = 1) >< (1 = 0)") == "true"

    def test_xor_true_true(self) -> None:
        assert _emit_bool(":: (1 = 1) >< (1 = 1)") == "false"

    def test_xor_with_numbers(self) -> None:
        assert _emit_bool(":: 1 >< 0") == "true"
