from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> Interpreter:
    mod = parse_module(src, filename="<scope-blocks>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    return ip


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<scope-blocks>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_named_block_returns_last_row_not_whole_scope() -> None:
    src = """
value:
  3
  4
  5
::: value
"""
    assert _emit(src) == "value: 5"


def test_named_block_can_return_scope_explicitly_with_lone_colon() -> None:
    src = """
geometry:
  points: [1, 2, 3]
  edges: 4
  :
::: geometry.points.length()
::: geometry.edges
"""
    assert _emit(src).splitlines() == [
        "geometry.points.length(): 3",
        "geometry.edges: 4",
    ]


def test_named_block_defs_can_reference_siblings_and_return_explicit_scope() -> None:
    src = """
geometry:
  edge_pairs: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0]
  ]

  EdgeTouchesVertex(edge_index, vertex_index):
    pair: edge_pairs.(edge_index)
    @: (pair.(0) = vertex_index) \\/ (pair.(1) = vertex_index)

  :

::: geometry.EdgeTouchesVertex(0, 1)
::: geometry.EdgeTouchesVertex(0, 2)
"""
    assert _emit(src).splitlines() == [
        "geometry.EdgeTouchesVertex(0, 1): true",
        "geometry.EdgeTouchesVertex(0, 2): false",
    ]


def test_scope_struct_spills_like_any_other_keyvalue_struct() -> None:
    src = """
geometry:
  points: [1, 2, 3]
  edges: 4
  :

vals: [:geometry]
names: {:geometry}
::: vals
::: names
"""
    assert _emit(src).splitlines() == [
        "vals: [[1, 2, 3], 4]",
        "names: {edges:1, points:1}",
    ]


def test_scope_struct_can_be_statement_spilled_into_current_scope() -> None:
    src = """
geometry:
  points: [1, 2, 3]
  edges: 4
  :

:geometry
::: points.length()
::: edges
"""
    assert _emit(src).splitlines() == [
        "points.length(): 3",
        "edges: 4",
    ]


def test_scope_struct_preserves_creation_order_for_vector_spill() -> None:
    src = """
geometry:
  first: 1
  second: 2
  third: 3
  :

vals: [:geometry]
::: vals
"""
    assert _emit(src) == "vals: [1, 2, 3]"


def test_parenthesized_newline_block_is_anonymous_scope_returning_last_row() -> None:
    src = """
value: (
  1
  2
  3
)
::: value
"""
    assert _emit(src) == "value: 3"


def test_parenthesized_newline_block_can_return_local_scope_with_colon() -> None:
    src = """
value: (
  x: 3
  y: 4
  :
)
::: value.x
::: value.y
"""
    assert _emit(src).splitlines() == [
        "value.x: 3",
        "value.y: 4",
    ]


def test_tuple_still_requires_commas() -> None:
    src = """
value: (1, 2, 3)
::: value
"""
    assert _emit(src) == "value: (1, 2, 3)"


def test_multiline_parenthesized_commas_still_make_a_tuple() -> None:
    src = """
value: (
  1,
  2,
  3
)
::: value
"""
    assert _emit(src) == "value: (1, 2, 3)"
