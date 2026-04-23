"""Regression: `?` switches with `$`, nested parens, bind RHS, and pipe `@|` / `@>`."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run_prints(src: str) -> str:
    mod = parse_module(src, filename="<test_switch_patterns>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_bind_outer_sets_dollar_in_paren_arms() -> None:
    """Outer ``a?`` binds ``$``; arm conditions are compared with the discriminant (``2? …`` not ``true? …`` when the subject is a number)."""
    assert _run_prints("a : 2\nb: a? (2? $ + 1; 0)\n:: b") == "3"
    assert _run_prints("a : 0\nb: a? (2? $ + 1; 9)\n:: b") == "9"


def test_bind_indented_single_arm_value() -> None:
    """``result: x?`` with indented body ``$^2`` (value as expression)."""
    src = """
x : 4
result: x?
  $^2
:: result
"""
    assert _run_prints(src) == "16"


def test_parens_only_sanity() -> None:
    assert _run_prints("a : 1\nb : a? (true? 0; 1)\n:: b") == "0"


def test_semicolon_between_match_arms_after_at_bar() -> None:
    """``@|`` may consume the following ``;``; the parser still reads the next arm (see ``_parse_switch_arms_list``)."""
    out = _run_prints("..>>::$;$? (20? @|; 0)")
    lines = [x.rstrip() for x in out.splitlines() if x.strip() != ""]
    assert lines == [str(i) for i in range(21)]


def test_implicit_mul_in_bracketed_arms() -> None:
    assert _run_prints("a: 4\n:: a? (4? 2a; 0)\n") == "8"

