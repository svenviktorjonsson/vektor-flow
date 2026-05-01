"""Control flow: ``@`` returns, ``@>`` / ``@|`` loop control, ``@!`` exit, conditionals, and switches."""

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


def test_update_operators_mutate_vector_memory() -> None:
    src = """
v: [1,2]
alias: v
v +: [3,4]
v *: 2
v -: [2,4]
v /: 2
:: alias
"""
    assert _run(src) == "[3, 4]"


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


def test_bare_at_returns_null() -> None:
    assert _run("f():\n  @\n:: f()") == "null"


def test_at_colon_returns_local_scope_object() -> None:
    out = _run("f():\n  a: 1\n  b: 2\n  @:\n:: f()")
    assert "a" in out and "b" in out
    assert "1" in out and "2" in out


def test_at_returns_nearest_colon_scope_only() -> None:
    src = """
f():
  g():
    @: 3
  g()
  9
:: f()
"""
    assert _run(src) == "9"


def test_module_is_implicit_return_scope() -> None:
    mod = parse_module("x: 1\n@ : x + 2\n", filename="<test>")
    ip = Interpreter(Path(__file__))
    assert ip.run_module(mod) == 3


def test_conditional_assign() -> None:
    """``expr? body`` runs body when truthy and otherwise falls through."""
    src = """
f(n):
  n < 1?
    n: 1
    @: n
  @: n
:: f(0)
"""
    assert _run(src) == "1"


def test_conditional_recursion_count() -> None:
    """Tail recursion driven by ``expr? body`` with explicit fallthrough return."""
    src = """
g(i):
  i < 3? @: g(i + 1)
  @: i
:: g(0)
"""
    assert _run(src) == "3"


def test_switch_loop_continue_with_at_gt() -> None:
    """``@>`` continues the nearest explicit ``??>`` loop."""
    src = """
k : 0
k??>
  0 =>
    k : k + 1
    @>
  1 =>
    k : k + 1
    @>
  2 =>
    k : k + 1
    @>
  3 => @|
:: k
"""
    assert _run(src) == "3"


def test_conditional_at_module_level_then_leading_print() -> None:
    """Indented conditional + ``DEDENT`` can be directly followed by ``::``."""
    src = """
x: 4
t: 0
x>3?
  a: 3
  b: a + 1
  t: a * b
x<=3? t: -1
:: t
"""
    assert _run(src) == "12"


def test_switch_ternary_print() -> None:
    """Switch with ``??`` + ``=>`` on a boolean discriminant."""
    assert _run("x : 5\nx>2?? (true => :: x; false => :: x+1)") == "5"
    assert _run("x : 1\nx>2?? (true => :: x; false => :: x+1)") == "2"


def test_conditional_expression_returns_null_on_false() -> None:
    assert _run("x: 1\n:: (x>2? 99)") == "null"


def test_conditional_expression_returns_null_on_true_after_effects() -> None:
    assert _run("x: 0\n:: (true? x: 1)\n:: x") == "null\n1"


def test_conditional_loop_continue_with_at_gt() -> None:
    src = """
k: 0
k<3?>
  k: k + 1
  @>
:: k
"""
    assert _run(src) == "3"


def test_switch_expression_returns_null_when_no_arm_matches() -> None:
    assert _run("x: 9\n:: x?? (1 => 10)") == "null"


def test_switch_statement_no_match_is_noop() -> None:
    assert _run("x: 9\nx?? (1 => :: 10)\n:: 1") == "1"


def test_switch_value_arm_beats_type_arm() -> None:
    src = """
x: 3
out: 0
x??
  3 => out: 1
  int => out: 2
:: out
"""
    assert _run(src) == "1"


def test_switch_type_arm_matches_runtime_value_type() -> None:
    src = """
x: true
out: 0
x??
  bool => out: 2
:: out
"""
    assert _run(src) == "2"


def test_catch_match_specific_error_beats_general_error() -> None:
    src = """
errors: .errors
out: 0
missing!?
  errors.ERROR => out: 1
  errors.EVAL_ERROR => out: 2
:: out
"""
    assert _run(src) == "2"


def test_catch_match_binds_subject_in_dollar() -> None:
    src = """
errors: .errors
out: 0
missing!?
  errors.ERROR =>
    $??
      errors.EVAL_ERROR => out: 7
:: out
"""
    assert _run(src) == "7"


def test_catch_match_no_error_is_noop() -> None:
    src = """
errors: .errors
out: 0
1!?
  errors.ERROR => out: 1
:: out
"""
    assert _run(src) == "0"


def test_catch_match_reraises_when_no_arm_matches() -> None:
    src = """
errors: .errors
missing!?
  errors.TYPE_ERROR => :: 1
"""
    with pytest.raises(EvalError, match="undefined name"):
        _run(src)


def test_errors_namespace_requires_import() -> None:
    src = """
out: 0
missing!?
  errors.ERROR => out: 1
:: out
"""
    with pytest.raises(EvalError, match="undefined name: 'errors'"):
        _run(src)


def test_errors_namespace_access_succeeds_when_imported() -> None:
    src = """
errors: .errors
out: 0
missing!?
  errors.EVAL_ERROR => out: 1
:: out
"""
    assert _run(src) == "1"


def test_break_outside_pipe_errors() -> None:
    with pytest.raises(EvalError, match="break outside >> pipe"):
        _run("@|")


def test_exit_program_raises_system_exit() -> None:
    mod = parse_module("@!", filename="<t>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(SystemExit) as ei:
        ip.run_module(mod)
    assert ei.value.code == 0
