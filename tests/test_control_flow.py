"""Control flow: ``@:`` return, ``@>`` / ``@|`` on ``>>`` pipes, ``@!`` exit, and **switches** ``expr?``."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_implicit_return_last_line_compact() -> None:
    """Last row as a plain expression is the function result (no ``@:`` on that line)."""
    src = """
f(x):
    x^2
:: f(3)
"""
    assert _run(src) == "9"


def test_explicit_return_early() -> None:
    """``@:`` exits the function; last line still works when no early return runs."""
    src = """
f(x):
    @: x + 10
    99
:: f(1)
"""
    assert _run(src) == "11"


def test_match_conditional_assign() -> None:
    """``expr?`` dispatches on equality; arms use only ``?`` (no ``=>``)."""
    src = """
f(n):
  n < 1?
    1?
      n: 1
      @: n
    0? @: n
:: f(0)
"""
    assert _run(src) == "1"


def test_match_recursion_count() -> None:
    """Tail dispatch via a switch and ``@:`` (no ``>>`` pipe)."""
    src = """
g(i):
  i < 3?
    1? @: g(i + 1)
    0? @: i
:: g(0)
"""
    assert _run(src) == "3"


def test_match_rewind_body_then_at_gt() -> None:
    """Switch re-entry: ``@>`` last in an arm runs prior binds, then re-runs the same ``expr?``."""
    src = """
k : 0
k < 3?
  1?
    k : k + 1
    @>
  0? :: k
"""
    assert _run(src) == "3"


def test_match_at_module_level_then_leading_print() -> None:
    """Indented ``?`` + ``DEDENT`` can be directly followed by ``::`` (no spurious stdio line)."""
    src = """
x: 4
t: 0
x>3?
  true?
    a: 3
    b: a + 1
    t: a * b
  t: -1
:: t
"""
    assert _run(src) == "12"


def test_match_ternary_print() -> None:
    """Ternary with emit per arm: ``(true? …; false? …)`` on the value of the discriminant."""
    assert _run("x : 5\nx>2? (true? :: x; false? :: x+1)") == "5"
    assert _run("x : 1\nx>2? (true? :: x; false? :: x+1)") == "2"


def test_break_outside_pipe_errors() -> None:
    with pytest.raises(EvalError, match="break outside >> pipe"):
        _run("@|")


def test_exit_program_raises_system_exit() -> None:
    mod = parse_module("@!", filename="<t>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(SystemExit) as ei:
        ip.run_module(mod)
    assert ei.value.code == 0
