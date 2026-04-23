"""Stdlib ``time`` — sleep, strftime, stamp."""

from __future__ import annotations

from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib


def test_resolve_time_stdlib() -> None:
    m = resolve_stdlib("time")
    assert "sleep" in m and "current_time" in m and "time_stamp" in m


def test_vkf_time_demo_runs() -> None:
    src = """
:.time
a : current_time("%Y")
:: time_stamp()
:: sleep(0.01)
:: a
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    s = str(ip.globals.get("a", ""))
    assert len(s) == 4 and s.isdigit()
