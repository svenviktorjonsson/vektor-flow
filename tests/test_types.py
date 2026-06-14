"""Type reflection (``a.``), type literals, ``->`` signatures, ``num``/``i``/``j``."""

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


def test_typeof_struct_matches_type_literal() -> None:
    src = """
a : (x:1, y:2)
:: a. = (x:num, y:num)
"""
    assert _run(src) == "true"


def test_func_arrow_and_typeof() -> None:
    src = """
f(x:num) -> num: x^2
:: f. = (x:num) -> num
"""
    assert _run(src) == "true"


def test_num_coercion_and_callable() -> None:
    src = """
f(x:num) -> num: x + 1
:: f(3)
:: num(3.14)
:: num(0, 1)
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("4", "4.0")
    assert lines[1] in ("3.14", "3.1400000000000001")
    assert "j" in lines[2]


def test_prefix_typed_bind_coerces_values() -> None:
    src = """
num a: 3
int b: true
chr raw: "h"
:: a
:: b
:: raw.
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("3", "3.0")
    assert lines[1] == "1"
    assert lines[2] == "chr"


def test_trailing_dot_type_can_drive_prefix_typed_bind() -> None:
    src = """
v : [1, 2]
v. value: [3, 4]
:: value. = v.
:: value
"""
    lines = _run(src).splitlines()
    assert lines[0] == "true"
    assert lines[1] == "[3, 4]"


def test_trailing_dot_type_can_be_used_inside_fixed_vector_type() -> None:
    src = """
v : [1, 2, 3, 4]
[v.:3] rows: [[1,2,3,4], [5,6,7,8], [9,10,11,12]]
:: rows.
"""
    assert _run(src) == "[[num:4]:3]"


def test_trailing_dot_on_call_result_is_typeof_call_result() -> None:
    src = """
f(x:num) -> num: x
:: f(3). = num
"""
    assert _run(src) == "true"


def test_parenthesized_typeof_stays_grouping_but_trailing_comma_makes_tuple_type() -> None:
    src = """
:: (1.)
:: (1.,)
(1.,) t: (1,)
:: t.
"""
    lines = _run(src).splitlines()
    assert lines[0] == "num"
    assert lines[1] == "(num,)"
    assert lines[2] == "(num,)"


def test_trailing_dot_type_works_in_multiset_and_fixed_vector_type_positions() -> None:
    src = """
{1.34.} bag: {1.34:2}
[1.:3] xs: [1, 2, 3]
:: bag.
:: xs.
"""
    lines = _run(src).splitlines()
    assert lines[0] == "{num}"
    assert lines[1] == "[num:3]"


def test_typeof_interpolation_uses_surface_type_format() -> None:
    src = """
p : (x:1, y:2)
xs : [1, 2, 3]
f(x:num) -> num: x
:: "p. = $(p.)"
:: "xs. = $(xs.)"
:: "f. = $(f.)"
"""
    lines = _run(src).splitlines()
    assert lines[0] == "p. = (x:num, y:num)"
    assert lines[1] == "xs. = [num:3]"
    assert lines[2] == "f. = (x:num) -> num"


def test_imaginary_constants() -> None:
    src = """
:: i
:: j
:: i * i
"""
    lines = _run(src).splitlines()
    assert lines[0] == "i"
    assert lines[1] == "i"
    assert lines[2] == "-1"

