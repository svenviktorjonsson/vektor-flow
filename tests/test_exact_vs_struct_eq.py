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


def test_numeric_semantic_vs_exact_equality() -> None:
    src = """
::: 2 = 2.0
::: 2 == 2.0
::: 2 ~= 2.0
::: 2 != 2.0
"""
    assert _run(src).splitlines() == ["2=2: true", "2==2: false", "2~=2: false", "2!=2: true"]


def test_vector_semantic_vs_exact_equality() -> None:
    src = """
::: [1, 2] = [1.0, 2.0]
::: [1, 2] == [1.0, 2.0]
::: [1, 2] ~= [1.0, 2.0]
::: [1, 2] != [1.0, 2.0]
"""
    assert _run(src).splitlines() == [
        "[1, 2]=[1, 2]: [true, true]",
        "[1, 2]==[1, 2]: false",
        "[1, 2]~=[1, 2]: [false, false]",
        "[1, 2]!=[1, 2]: true",
    ]


def test_struct_semantic_vs_exact_equality() -> None:
    src = """
a : (x:1, y:2)
b : (x:1.0, y:2.0)
::: a = b
::: a == b
::: a ~= b
::: a != b
"""
    assert _run(src).splitlines() == [
        "a=b: (x:true, y:true)",
        "a==b: false",
        "a~=b: (x:false, y:false)",
        "a!=b: true",
    ]


def test_match_exact_tier_uses_exact_equality() -> None:
    src = """
x : 2.0
out : "default"
x??
  2 => out : "int"
  num => out : "num"
  out : "default"
:: out
"""
    assert _run(src) == "num"
