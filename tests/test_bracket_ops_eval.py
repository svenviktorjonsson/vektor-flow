"""Focused multiset operator semantics."""

from __future__ import annotations

import ast as py_ast
import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import AxisTaggedValue, Interpreter, _binop
from vektorflow.parser import parse_module
from vektorflow.runtime.multiset import (
    Multiset,
    multiset_difference,
    multiset_scalar_add,
    multiset_scalar_floordiv,
    multiset_scalar_subtract,
    multiset_union,
)


def _run_emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def _parse_multiset_repr(s: str) -> Multiset:
    s = s.strip()
    if s.startswith("Multiset(") and s.endswith(")"):
        inner = s[len("Multiset(") : -1]
        d = py_ast.literal_eval(inner)
        return Multiset(d)
    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1].strip()
        if not inner:
            return Multiset({})
        parts = [part.strip() for part in inner.split(",") if part.strip()]
        counts: dict[object, int] = {}
        for part in parts:
            key_src, value_src = part.split(":", 1)
            key_src = key_src.strip()
            value_src = value_src.strip()
            try:
                key = py_ast.literal_eval(key_src)
            except Exception:
                key = key_src
            value = int(py_ast.literal_eval(value_src))
            counts[key] = value
        return Multiset(counts)
    raise AssertionError(f"expected Multiset(...) or {{...}} multiset print, got {s!r}")


@pytest.mark.parametrize("ch", ["+", "-"])
def test_multiset_ops_plain(ch: str) -> None:
    s = Multiset({1: 1, 2: 2})
    t = Multiset({2: 1, 3: 1})
    if ch == "+":
        expected = multiset_union(s, t)
    else:
        expected = multiset_difference(s, t)

    src = f"""S : {{1:1, 2:2}}
T : {{2:1, 3:1}}
:: S {ch} T
"""
    out = _run_emit(src)
    assert _parse_multiset_repr(out) == expected


def test_multiset_star_is_not_defined() -> None:
    src = """
A : {1:2}
B : {2:1}
:: (A * B)
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(Exception, match=r"operator \* is not defined for multisets"):
        ip.run_module(mod)


def test_multiset_division_leaves_multiset_land_into_struct() -> None:
    src = r"""
A : {"a":2, "b":3}
B : {"a":5, "b":2}
::: A / B
::: A / 2
"""
    lines = _run_emit(src).splitlines()
    assert lines[0] == "(a:0.4, b:1.5)"
    assert lines[1] in {"(a:1, b:1.5)", "(a:1.0, b:1.5)"}


def test_multiset_scalar_broadcast_plus_minus_over_existing_keys_only() -> None:
    assert _parse_multiset_repr(_run_emit(':: {"a":2, "b":3} + 1')) == multiset_scalar_add(
        Multiset({"a": 2, "b": 3}),
        1,
    )
    assert _parse_multiset_repr(_run_emit(':: {"a":2, "b":1} - 2')) == multiset_scalar_subtract(
        Multiset({"a": 2, "b": 1}),
        2,
    )


def test_multiset_floordiv_runtime_support_scalar_and_keywise() -> None:
    assert _binop("FLOORDIV", Multiset({"a": 5, "b": 2}), 2) == multiset_scalar_floordiv(
        Multiset({"a": 5, "b": 2}),
        2,
    )
    assert _binop("FLOORDIV", Multiset({"a": 5, "b": 2}), Multiset({"a": 2, "b": 2})) == Multiset(
        {"a": 2, "b": 1}
    )


def test_multiset_literal_duplicate_entries_override_later() -> None:
    out = _run_emit(":: {1:2, 1:5, 2:0}")
    assert _parse_multiset_repr(out) == Multiset({1: 5})


def test_axis_tagged_multiset_scalar_ops_follow_same_rules() -> None:
    tagged = AxisTaggedValue(Multiset({"a": 2, "b": 3}), "i")
    plus = _binop("PLUS", tagged, 1)
    minus = _binop("MINUS", tagged, 2)
    floordiv = _binop("FLOORDIV", tagged, 2)
    slash = _binop("SLASH", tagged, 2)
    assert isinstance(plus, AxisTaggedValue)
    assert plus.data == Multiset({"a": 3, "b": 4})
    assert isinstance(minus, AxisTaggedValue)
    assert minus.data == Multiset({"b": 1})
    assert isinstance(floordiv, AxisTaggedValue)
    assert floordiv.data == Multiset({"a": 1, "b": 1})
    assert isinstance(slash, AxisTaggedValue)
    assert slash.data == {"a": 1.0, "b": 1.5}
