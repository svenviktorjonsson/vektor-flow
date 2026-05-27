from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def test_recursive_function_surfaces_recursion_error() -> None:
    src = """
sin(x):
    sin(x * 3.14 / 180)

result: sin(1)
"""
    ip = Interpreter(Path(__file__))
    with pytest.raises(RecursionError, match="infinite recursion or recursion depth exceeded in 'sin'"):
        ip.run_module(parse_module(src, filename="<test>"))


def test_recursive_constructor_surfaces_recursion_error() -> None:
    src = """
Point(x):
    Point(x)

p: Point(1)
"""
    ip = Interpreter(Path(__file__))
    with pytest.raises(RecursionError, match="infinite recursion or recursion depth exceeded in 'Point'"):
        ip.run_module(parse_module(src, filename="<test>"))
