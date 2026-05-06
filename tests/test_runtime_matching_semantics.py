from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<runtime-matching>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_open_struct_type_match_allows_extra_fields() -> None:
    src = """
s : (x:1, y:2, z:3)
r : 0
s??
  (x:num, y:num) => r : 1
  r : 9
:: r
"""
    assert _run(src) == "1"


def test_more_specific_type_arm_beats_broader_type_arm() -> None:
    src = """
v : [1, 2, 3, 4]
r : 0
v??
  [num:4] => r : 1
  [int:4] => r : 2
  r : 9
:: r
"""
    assert _run(src) == "2"


def test_semantic_type_equality_uses_subtype_compatibility() -> None:
    src = """
::: (x:num, y:num, z:num) = (x:num, y:num)
::: (x:num, y:num, z:num) ~= (x:num, y:num)
"""
    assert _run(src).splitlines() == ["true", "false"]


def test_struct_relational_ops_are_keywise() -> None:
    src = """
a : (x:1, y:5)
b : (x:2, y:4)
::: a < b
::: a >= b
"""
    assert _run(src).splitlines() == [
        "(x:true, y:false)",
        "(x:false, y:true)",
    ]


def test_struct_relational_ops_support_scalar_broadcast() -> None:
    src = """
a : (x:1, y:2)
::: a > 0
"""
    assert _run(src) == "(x:true, y:true)"


def test_multiset_relational_ops_return_keyed_struct() -> None:
    src = r"""
a : {"a":2, "b":3}
b : {"a":5, "b":2}
::: a > b
::: a <= 2
"""
    assert _run(src).splitlines() == [
        "(a:false, b:true)",
        "(a:true, b:false)",
    ]
