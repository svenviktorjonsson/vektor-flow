"""Reserved ``true`` / ``false`` literals."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_emit_true_false() -> None:
    assert _run(":: true") == "true"
    assert _run(":: false") == "false"


def test_tuple_of_bools() -> None:
    assert _run(":: (true, false)") == "(true, false)"
