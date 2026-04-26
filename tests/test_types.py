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
bytes raw: "hej"
:: a
:: b
:: raw.
"""
    lines = _run(src).splitlines()
    assert lines[0] in ("3", "3.0")
    assert lines[1] == "1"
    assert lines[2] == "bytes"


def test_imaginary_constants() -> None:
    src = """
:: i
:: j
:: i * i
"""
    lines = _run(src).splitlines()
    assert lines[0] == "1j"
    assert lines[1] == "1j"
    assert lines[2] == "(-1+0j)"

