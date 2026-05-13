"""Type reflection (``a.``), type literals, ``->`` signatures, ``num``/``i``/``j``."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime import VFVector


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_typeof_struct_matches_type_literal() -> None:
    src = """
a : (x:1, y:2)
::: a. = (x:num, y:num)
"""
    assert _run(src) == "<TypeOf>=<TypeExpr>: true"


def test_func_arrow_and_typeof() -> None:
    src = """
f(x:num) -> num: x^2
::: f. = (x:num) -> num
"""
    assert _run(src) == "<TypeOf>=<FuncType>: true"


def test_num_coercion_and_callable() -> None:
    src = """
f(x:num) -> num: x + 1
::: f(3)
::: num(3.14)
::: num(0, 1)
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("f(3): 4", "f(3): 4.0")
    assert lines[1] in ("num(3.14): 3.14", "num(3.14): 3.1400000000000001")
    assert lines[2].startswith("num(0, 1): ")
    assert "j" in lines[2]


def test_prefix_typed_bind_coerces_values() -> None:
    src = """
num a: 3
int b: true
bytes raw: "hej"
::: a
::: b
::: raw.
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("a: 3", "a: 3.0")
    assert lines[1] == "b: 1"
    assert lines[2] == "<TypeOf>: bytes"


def test_trailing_dot_type_can_drive_prefix_typed_bind() -> None:
    src = """
v : [1, 2]
v. value: [3, 4]
::: value. = v.
::: value
"""
    lines = _run(src).splitlines()
    assert lines[0] == "<TypeOf>=<TypeOf>: true"
    assert lines[1] == "value: [3, 4]"


def test_trailing_dot_type_can_be_used_inside_fixed_vector_type() -> None:
    src = """
v : [1, 2, 3, 4]
[v.:3] rows: [[1,2,3,4], [5,6,7,8], [9,10,11,12]]
::: rows.
"""
    assert _run(src) == "<TypeOf>: [[int:4]:3]"


def test_trailing_dot_on_call_result_is_typeof_call_result() -> None:
    src = """
f(x:num) -> num: x
::: f(3). = num
"""
    assert _run(src) == "<TypeOf>=num: true"


def test_parenthesized_typeof_stays_grouping_but_trailing_comma_makes_tuple_type() -> None:
    src = """
::: (1.)
::: (1.,)
(1.,) t: (1,)
::: t.
"""
    lines = _run(src).splitlines()
    assert lines[0] == "<TypeOf>: int"
    assert lines[1] == "(<TypeOf>): (int,)"
    assert lines[2] == "<TypeOf>: (int,)"


def test_trailing_dot_type_works_in_multiset_and_fixed_vector_type_positions() -> None:
    src = """
{1.34.} bag: {1.34:2}
[1.:3] xs: [1, 2, 3]
::: bag.
::: xs.
"""
    lines = _run(src).splitlines()
    assert lines[0] == "<TypeOf>: {num}"
    assert lines[1] == "<TypeOf>: [int:3]"


def test_multiset_bare_entries_still_reflect_element_type() -> None:
    src = """
m: {1, 2, 4:5}
::: m.
"""
    assert _run(src) == "<TypeOf>: {int}"


def test_imaginary_constants() -> None:
    src = """
::: i
::: j
::: i * i
"""
    lines = _run(src).splitlines()
    assert lines[0] == "i: 1j"
    assert lines[1] == "j: 1j"
    assert lines[2] == "i*i: (-1+0j)"


def test_vector_literal_uses_vector_runtime_type() -> None:
    ip = Interpreter(Path(__file__))
    ip.run_module(parse_module("v : [1, 2, 3]\n", filename="<test>"))
    value = ip.globals["v"]
    assert isinstance(value, VFVector)
    assert not isinstance(value, list)
    assert tuple(value) == (1, 2, 3)

