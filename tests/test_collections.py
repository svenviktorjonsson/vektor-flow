"""Stdlib ``collections`` — ``map`` (mutable map) and ``list`` (linked list)."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.vmap import VMap


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_map_keyword_init_and_assign() -> None:
    src = """
:.collections
a : map(x:3, y:4)
a.z : 9
a.4 : 7
:: a.x
:: a.y
:: a.z
:: a.(4)
"""
    lines = _run(src).splitlines()
    assert lines == ["3", "4", "9", "7"]


def test_map_empty() -> None:
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(":.collections\nm : map()", "<t>"))
    assert isinstance(ip.globals["m"], VMap)
    assert len(ip.globals["m"]) == 0


def test_uppercase_empty_map_prefers_runtime_ctor() -> None:
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(":.collections\nM : map()", "<t>"))
    assert isinstance(ip.globals["M"], VMap)
    assert len(ip.globals["M"]) == 0


def test_list_variadic_and_single_and_spread() -> None:
    src = """
:.collections
u : [1, 2, 3]
L1 : list(2, 3, 4)
L2 : list(2)
L3 : list(u)
L4 : list(:u)
:: L1
:: L2
:: L3
:: L4
"""
    out = _run(src).splitlines()
    # VFLinkedList prints like a bracket list via interpreter._stringify (not repr()).
    assert out[0] == "[2, 3, 4]"
    assert out[1] == "[2]"
    # list(u) with one group — single cell holding the value u
    assert out[2] == "[[1, 2, 3]]"
    # list(:u) — spread iterable into cells
    assert out[3] == "[1, 2, 3]"


def test_uppercase_empty_list_prefers_runtime_ctor() -> None:
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module(":.collections\nL : list()", "<t>"))
    assert list(ip.globals["L"]) == []


def test_take_on_linked_list() -> None:
    src = """
:.collections
L : list(1, 2, 3, 4)
:: take(2, L)
"""
    assert _run(src) == "(1, 2)"


def test_queue() -> None:
    src = """
:.collections
q : queue()
q.put(1)
q.put(2)
a : q.get()
b : q.get()
c : q.get()
d : q.empty()
:: a
:: b
:: c
:: d
"""
    out = _run(src).splitlines()
    assert out[0] in ("1.0", "1")
    assert out[1] in ("2.0", "2")
    assert "None" in out[2] or out[2] == "" or "null" in out[2]
    assert "True" in out[3] or "true" in out[3].lower()
