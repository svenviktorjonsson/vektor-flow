from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> Interpreter:
    mod = parse_module(src, filename="<type-spill-scope>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    return ip


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<type-spill-scope>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_binding_builtin_type_name_stores_the_type_value() -> None:
    ip = _run(
        """
a: int
same: a = int
"""
    )
    assert ip.globals["same"] is True


def test_parenthesized_spill_of_type_value_materializes_type_scope_record() -> None:
    out = _emit(
        """
ops: (:int)
::: ops.size
"""
    )
    assert out == "ops.size: (value:int) -> int"


def test_parenthesized_spill_of_typeof_value_exposes_same_type_surface() -> None:
    out = _emit(
        """
ops: (:1.)
::: ops.size
"""
    )
    assert out == "ops.size: (value:int) -> int"


def test_type_object_exposes_callable_members() -> None:
    ip = _run(
        """
t: 1.
out: t.size(1)
"""
    )
    assert ip.globals["out"] == 64


def test_statement_spill_of_type_value_exposes_type_metadata_into_local_scope() -> None:
    out = _emit(
        """
:int
::: size
"""
    )
    assert out == "size: (value:int) -> int"


def test_string_type_surface_uses_shared_runtime_member_metadata() -> None:
    src = """
S: str
ops: (:S)
::: ops.length
::: ops.count
::: ops.has
::: ops.is_bool
"""
    assert _emit(src).splitlines() == [
        "ops.length: (value:str) -> int",
        "ops.count: (value:str, item:any) -> int",
        "ops.has: (value:str, item:any) -> bool",
        "ops.is_bool: (value:str) -> bool",
    ]


def test_vector_spill_of_type_surface_returns_values_only_in_creation_order() -> None:
    src = """
vals: [:str]
::: vals.length()
::: vals.0
::: vals.1
::: vals.2
::: vals.3
::: vals.4
::: vals.5
::: vals.6
"""
    assert _emit(src).splitlines() == [
        "vals.length(): 7",
        "vals.(0): (value:str) -> int",
        "vals.(1): (value:str) -> int",
        "vals.(2): (value:str, item:any) -> bool",
        "vals.(3): (value:str, item:any) -> int",
        "vals.(4): (value:str) -> bool",
        "vals.(5): (value:str) -> bool",
        "vals.(6): (value:str) -> bool",
    ]


def test_multiset_spill_of_type_surface_returns_sorted_member_names() -> None:
    src = """
names: {:str}
::: names
"""
    assert _emit(src) == "names: {count:1, has:1, is_bool:1, is_int:1, is_num:1, length:1, size:1}"


def test_vector_spill_of_struct_returns_values_in_creation_order() -> None:
    src = """
r: (x:1, y:2, z:3)
vals: [:r]
::: vals
"""
    assert _emit(src) == "vals: [1, 2, 3]"


def test_multiset_spill_of_struct_returns_sorted_keys() -> None:
    src = """
r: (x:1, y:2, z:3)
names: {:r}
::: names
"""
    assert _emit(src) == "names: {x:1, y:1, z:1}"


def test_type_object_string_members_are_callable() -> None:
    src = """
t: "banana".
len_v: t.length("banana")
count_a: t.count("banana", "a")
has_na: t.has("banana", "na")
bool_v: t.is_bool("true")
::: len_v
::: count_a
::: has_na
::: bool_v
"""
    assert _emit(src).splitlines() == [
        "len_v: 6",
        "count_a: 3",
        "has_na: true",
        "bool_v: true",
    ]
