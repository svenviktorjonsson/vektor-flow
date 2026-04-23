"""Struct field bind copies the dict (immutable update); aliases keep the old value."""

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


def test_alias_sees_old_struct_after_field_update() -> None:
    out = _run(
        """p : ()
p.x : 1
q : p
p.x : 2
:: q.x
:: p.x
"""
    )
    lines = out.splitlines()
    assert lines[0] == "1"
    assert lines[1] == "2"


def test_nested_field_bind_copies() -> None:
    out = _run(
        """p : ()
p.a : ()
p.a.b : 1
p.a.b : 2
:: p.a.b
"""
    )
    assert out == "2"
