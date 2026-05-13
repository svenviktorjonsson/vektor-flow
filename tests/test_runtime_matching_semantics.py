from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow import ast
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.type_values import type_match_specificity


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


def test_match_arm_type_union_pattern_works() -> None:
    src = """
x : 1
r : 0
x??
  int|str => r : 1
  r : 9
:: r
"""
    assert _run(src) == "1"


def test_match_arm_type_intersection_pattern_works() -> None:
    src = """
x : 1
r : 0
x??
  num&int => r : 1
  r : 9
:: r
"""
    assert _run(src) == "1"


def test_intersection_arm_beats_union_arm_on_same_value() -> None:
    src = """
x : 1
r : 0
x??
  int|str => r : 1
  num&int => r : 2
  r : 9
:: r
"""
    assert _run(src) == "2"


def test_semantic_type_equality_uses_subtype_compatibility() -> None:
    src = """
::: (x:num, y:num, z:num) = (x:num, y:num)
::: (x:num, y:num, z:num) ~= (x:num, y:num)
"""
    assert _run(src).splitlines() == [
        "<TypeExpr>=<TypeExpr>: true",
        "<TypeExpr>~=<TypeExpr>: false",
    ]


def test_union_and_intersection_type_equality_use_subtype_logic() -> None:
    assert type_match_specificity(ast.PrimTypeRef("int"), ast.TypeUnionExpr([ast.PrimTypeRef("int"), ast.PrimTypeRef("str")]), {}) is not None
    assert type_match_specificity(ast.PrimTypeRef("int"), ast.TypeIntersectionExpr([ast.PrimTypeRef("num"), ast.PrimTypeRef("int")]), {}) is not None
    assert type_match_specificity(ast.PrimTypeRef("str"), ast.TypeIntersectionExpr([ast.PrimTypeRef("num"), ast.PrimTypeRef("int")]), {}) is None


def test_struct_relational_ops_are_keywise() -> None:
    src = """
a : (x:1, y:5)
b : (x:2, y:4)
::: a < b
::: a >= b
"""
    assert _run(src).splitlines() == [
        "a<b: (x:true, y:false)",
        "a>=b: (x:false, y:true)",
    ]


def test_struct_relational_ops_support_scalar_broadcast() -> None:
    src = """
a : (x:1, y:2)
::: a > 0
"""
    assert _run(src) == "a>0: (x:true, y:true)"


def test_multiset_relational_ops_return_keyed_struct() -> None:
    src = r"""
a : {"a":2, "b":3}
b : {"a":5, "b":2}
::: a > b
::: a <= 2
"""
    assert _run(src).splitlines() == [
        "a>b: (a:false, b:true)",
        "a<=2: (a:true, b:false)",
    ]


def test_intersection_specificity_outranks_union_for_same_actual_type() -> None:
    actual = ast.PrimTypeRef("int")
    union_pattern = ast.TypeUnionExpr([ast.PrimTypeRef("int"), ast.PrimTypeRef("str")])
    intersection_pattern = ast.TypeIntersectionExpr([ast.PrimTypeRef("num"), ast.PrimTypeRef("int")])
    union_score = type_match_specificity(actual, union_pattern, {})
    intersection_score = type_match_specificity(actual, intersection_pattern, {})
    assert union_score is not None
    assert intersection_score is not None
    assert intersection_score > union_score
