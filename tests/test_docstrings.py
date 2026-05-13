from __future__ import annotations

import contextlib
import subprocess
from io import StringIO
from pathlib import Path

from vektorflow import ast
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parents[1]


def _run(src: str) -> str:
    mod = parse_module(src, filename="<docstrings>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_parser_captures_head_function_docstring() -> None:
    mod = parse_module(
        """
f(x:num):
  "square plus one"
  x^2 + 1
""",
        filename="<docstrings>",
    )
    fn = mod.statements[0]
    assert isinstance(fn, ast.FuncDef)
    assert fn.docstring == "square plus one"


def test_parser_captures_triple_quoted_function_docstring() -> None:
    mod = parse_module(
        '''
f(x:num):
  """square
  plus one"""
  x^2 + 1
''',
        filename="<docstrings>",
    )
    fn = mod.statements[0]
    assert isinstance(fn, ast.FuncDef)
    assert fn.docstring == "square\n  plus one"


def test_parser_captures_raw_triple_quoted_function_docstring() -> None:
    mod = parse_module(
        """
f(path:str):
  '''raw $path \\ stays'''
  x^2 + 1
""",
        filename="<docstrings>",
    )
    fn = mod.statements[0]
    assert isinstance(fn, ast.FuncDef)
    assert fn.docstring == r"raw $path \ stays"


def test_head_docstring_does_not_break_struct_ctor_classification() -> None:
    src = """
Point(x:num, y:num):
  "2d point"
  :
p: Point(1, 2)
::: p.x
"""
    assert _run(src) == "p.x: 1"


def test_docstring_only_body_is_not_misclassified_as_ctor() -> None:
    src = """
f():
  "docs only"
::: f
"""
    assert _run(src) == "f: f()"


def test_docstring_does_not_change_function_result() -> None:
    src = """
f(x:num):
  "square plus one"
  x^2 + 1
::: f(3)
"""
    assert _run(src) == "f(3): 10"


def test_vscode_docstring_helper() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "tests" / "test_vscode_docstrings.js")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "ok"
