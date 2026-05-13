from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str, stdin_text: str = "") -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        with patch("sys.stdin", StringIO(stdin_text)):
            ip.run_module(mod)
    return buf.getvalue()


def test_trailing_stdio_read_binds_line_to_name() -> None:
    out = _run("a ::\n:: a\n", "hello\n")
    assert out == "hello"


def test_prefix_typed_stdio_read_coerces_input_expression() -> None:
    out = _run("num a ::\n:: a * 2\n", "21\n")
    assert out == "42"


def test_prompted_stdio_read_prints_name_prompt() -> None:
    out = _run("num a :::\n:: a\n", "7\n")
    assert out == "a: 7"


def test_eval_bind_from_runtime_source_string() -> None:
    out = _run('x :: "1*3"\n:: x\n')
    assert out == "3"


def test_typed_eval_bind_from_runtime_source_string() -> None:
    out = _run('num x :: "1+2"\n:: x * 4\n')
    assert out == "12"


def test_runtime_function_compile_from_source_string() -> None:
    out = _run('f(x,y) :: "x*y"\n:: f(3,4)\n')
    assert out == "12"
