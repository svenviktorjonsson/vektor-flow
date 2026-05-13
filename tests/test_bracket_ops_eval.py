"""Multiset binary ``+ - // %`` use multiplicity semantics."""

from __future__ import annotations

import ast as py_ast
import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.multiset import (
    Multiset,
    multiset_difference,
    multiset_count_floor_div,
    multiset_count_mod,
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
        d = py_ast.literal_eval(s)
        return Multiset(d)
    raise AssertionError(f"expected Multiset(...) or {{...}} multiset print, got {s!r}")


@pytest.mark.parametrize("ch", ["+", "-", "//", "%"])
def test_multiset_ops_plain(ch: str) -> None:
    s = Multiset({1: 5, 2: 2})
    t = Multiset({1: 2, 2: 3, 3: 1})
    if ch == "+":
        expected = multiset_union(s, t)
    elif ch == "-":
        expected = multiset_difference(s, t)
    elif ch == "//":
        expected = multiset_count_floor_div(s, t)
    else:
        expected = multiset_count_mod(s, t)

    src = f"""S : {{1:5, 2:2}}
T : {{1:2, 2:3, 3:1}}
:: S {ch} T
"""
    out = _run_emit(src)
    assert _parse_multiset_repr(out) == expected


@pytest.mark.parametrize("ch", ["*", "/"])
def test_multiset_star_and_slash_are_not_defined(ch: str) -> None:
    src = f"""
A : {{1:2}}
B : {{1:1}}
:: (A {ch} B)
"""
    with pytest.raises(Exception, match=rf"operator \{ch} is not defined for multisets"):
        _run_emit(src)
