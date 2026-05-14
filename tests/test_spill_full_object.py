from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<spill-full-object>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_spilled_int_wrapper_keeps_builtin_numeric_behavior() -> None:
    src = """
Name(int x):
  :x
  :

a: Name(3)
sum: a + 2
eq: a = 3
sz: a.size()
::: sum
::: eq
::: sz
"""
    assert _run(src).splitlines() == [
        "sum: 5",
        "eq: true",
        "sz: 64",
    ]


def test_spilled_wrapper_can_extend_fields_without_losing_base_behavior() -> None:
    src = """
NamedInt(int x):
  :x
  label: "wrapped"
  :

a: NamedInt(3)
sum: a + 2
tag: a.label
::: sum
::: tag
"""
    assert _run(src).splitlines() == [
        "sum: 5",
        "tag: wrapped",
    ]


def test_spilled_string_wrapper_keeps_shared_container_interface() -> None:
    src = """
NamedStr(str text):
  :text
  label: "wrapped"
  :

s: NamedStr("banana")
has_na: s.has("na")
count_a: s.count("a")
len_v: s.length()
tag: s.label
::: has_na
::: count_a
::: len_v
::: tag
"""
    assert _run(src).splitlines() == [
        "has_na: true",
        "count_a: 3",
        "len_v: 6",
        "tag: wrapped",
    ]


def test_spilled_wrapper_matches_broader_builtin_type_in_switch() -> None:
    src = """
Name(int x):
  :x
  :

a: Name(3)
r: 0
a??
  int => r: 1
  r: 9
::: r
"""
    assert _run(src) == "r: 1"


def test_spilled_wrapper_passes_to_typed_builtin_param() -> None:
    src = """
Name(int x):
  :x
  :

add1(int x): x + 1
a: Name(3)
::: add1(a)
"""
    assert _run(src) == "add1(a): 4"
