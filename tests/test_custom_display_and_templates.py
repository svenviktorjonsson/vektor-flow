from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import EvalError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_print_uses_display_overload_before_str() -> None:
    src = """
Person(name:str, age:num):
    :

str(p:Person):
    "str:" & p.name

display(p:Person):
    "display:" & p.name

p : Person("Ada", 42)
:: p
"""
    assert _run(src) == "display:Ada"


def test_print_falls_back_to_custom_str_overload() -> None:
    src = """
Person(name:str, age:num):
    :

str(p:Person):
    p.name & ", " & p.age

p : Person("Ada", 42)
:: p
"""
    assert _run(src) in ("Ada, 42", "Ada, 42.0")


def test_explicit_str_cast_still_uses_custom_str_overload() -> None:
    src = """
Person(name:str):
    :

str(p:Person):
    "cast:" & p.name

p : Person("Ada")
:: str(p)
"""
    assert _run(src) == "cast:Ada"


def test_operator_overload_with_typed_custom_values() -> None:
    src = """
Point(x:num, y:num):
    :

+(a:Point, b:Point):
    Point(a.x + b.x, a.y + b.y)

Point p: Point(1, 2)
Point q: Point(3, 4)
:: (p + q).x + (p + q).y
"""
    assert _run(src) == "10"


def test_reach_overload_with_typed_custom_value() -> None:
    src = """
Pair(x:num, y:num):
    :

.(p:Pair, key:str):
    key = "left"? @: p.x
    key = "right"? @: p.y
    @

Pair p: Pair(3, 4)
:: p.left
:: p.("right")
"""
    assert _run(src) in ("3\n4", "3.0\n4.0")


def test_nested_templated_array_bind_and_return() -> None:
    src = """
wrap(x:[[num:n]:m]) -> [[num:n]:m]:
    x

[[num:2]:2] grid: [[1,2], [3,4]]
out: wrap(grid)
:: out.
:: out
"""
    assert _run(src) == "[[num:2]:2]\n[[1, 2], [3, 4]]"


def test_nested_templated_array_rejects_shape_mismatch() -> None:
    src = """
[[num:2]:2] grid: [[1,2], [3]]
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError):
        ip.run_module(mod)


def test_typed_vector_concat_preserves_refined_type() -> None:
    src = """
[num:2] a: [1,2]
[num:3] b: [3,4,5]
out: a & b
:: out.
:: out
"""
    assert _run(src) == "[num:5]\n[1, 2, 3, 4, 5]"


def test_typed_vector_elementwise_plus_preserves_refined_type() -> None:
    src = """
[num:2] a: [1,2]
[num:2] b: [3,4]
out: a + b
:: out.
:: out
"""
    assert _run(src) == "[num:2]\n[4, 6]"


def test_typed_vector_scalar_scale_preserves_refined_type() -> None:
    src = """
[num:2] a: [1,2]
out: 2 * a
:: out.
:: out
"""
    assert _run(src) == "[num:2]\n[2, 4]"


def test_typed_multiset_bind_and_reflection() -> None:
    src = """
{num} bag: {1:2, 3:1}
:: bag.
:: bag
"""
    assert _run(src) == "{num}\n{1:2, 3:1}"


def test_typed_multiset_function_param_and_return() -> None:
    src = """
merge(a:{num}, b:{num}) -> {num}:
    a + b

out: merge({1:1}, {2:2})
:: out.
:: out
"""
    assert _run(src) == "{num}\n{1:1, 2:2}"


def test_typed_multiset_rejects_bad_element_type() -> None:
    src = """
{num} bag: {"x":1}
"""
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError):
        ip.run_module(mod)


def test_structured_symbolic_vectors_reflect_resolved_nested_types() -> None:
    src = """
push_right(p:(left:[num:n], right:[num:m]), extra:[num:k]) -> (left:[num:n], right:[num:m+k]):
    (left:p.left, right:p.right & extra)

state: (left:[1,2], right:[3])
out: push_right(state, [4,5])
:: out.
:: out.right.
:: out.right
"""
    assert _run(src) == "(left:[num:2], right:[num:3])\n[num:3]\n[3, 4, 5]"
