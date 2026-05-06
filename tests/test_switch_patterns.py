"""Regression: ``??`` switches with ``=>``, ``$``, nested parens, and pipe ``@|`` / ``@>``."""

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
    """Outer ``a??`` binds ``$`` for arm bodies even though ``??`` itself yields ``null``."""
    assert _run_prints("a : 2\nb: 0\na??\n  2 => b: $ + 1\n  b: 0\n:: b") == "3"
    assert _run_prints("a : 0\nb: 0\na??\n  2 => b: $ + 1\n  b: 9\n:: b") == "9"


def test_bind_indented_single_arm_value() -> None:
    """Indented ``??`` switch arm body may still perform effects."""
    src = """
x : 4
result: 0
x??
  4 =>
    result: $^2
  result: 0
:: result
"""
    assert _run_prints(src) == "16"


def test_parens_only_sanity() -> None:
    assert _run_prints("a : 1\nb : 9\na??\n  1 => b: 0\n  b: 1\n:: b") == "0"


def test_semicolon_between_match_arms_after_at_bar() -> None:
    """``@|`` may consume the following ``;``; parser still reads the next ``??`` arm."""
    out = _run_prints("..>>:::$;$?? (20 => @|)")
    lines = [x.rstrip() for x in out.splitlines() if x.strip() != ""]
    assert lines == [str(i) for i in range(21)]


def test_implicit_mul_in_bracketed_arms() -> None:
    assert _run_prints("a: 4\nout: 0\na??\n  4 => out: 2a\n  out: 0\n:: out\n") == "8"


def test_match_arm_fixed_vector_type_pattern() -> None:
    """``??`` arm ``[elem:size]`` matches discriminant by inferred fixed-vector type."""
    src = """
v : [1, 2, 3, 4]
r : 0
v ??
  [num:4] => r : 1
  r : 0
:: r
"""
    assert _run_prints(src) == "1"
    src2 = """
v : [1, 2, 3]
r : 0
v ??
  [num:4] => r : 1
  r : 9
:: r
"""
    assert _run_prints(src2) == "9"

