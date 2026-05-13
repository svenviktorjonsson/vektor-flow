from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime import VFVector
from vektorflow.runtime.typed_vector import TypedVector
from vektorflow.runtime.type_values import PrimType, coerce_typed_value, coerce_value, infer_type


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_infer_int_byte_and_bytes_types() -> None:
    ip = Interpreter(Path(__file__))
    assert infer_type(3, ip.types).name == "int"
    assert infer_type(b"abc", ip.types).name == "bytes"


def test_implicit_bool_and_int_widening() -> None:
    assert coerce_value(True, "int") == 1
    assert coerce_value(False, "num") == 0.0
    assert coerce_value(3, "num") == 3.0
    assert coerce_value("3.25", "num") == 3.25


def test_num_to_int_not_implicit() -> None:
    with pytest.raises(Exception):
        coerce_value(3.25, "int")


def test_not_other_way_to_bool() -> None:
    with pytest.raises(Exception):
        coerce_value(1, "bool")
    with pytest.raises(Exception):
        coerce_value("x", "bool")


def test_str_to_bytes_but_not_bytes_to_str_implicit() -> None:
    assert coerce_value("hej", "bytes") == b"hej"
    with pytest.raises(Exception):
        coerce_value(b"hej", "str")


def test_byte_scalar_conversion() -> None:
    assert coerce_value(65, "byte") == 65
    with pytest.raises(Exception):
        coerce_value(300, "byte")


def test_explicit_cast_policy() -> None:
    assert PrimType("int")(True) == 1
    assert PrimType("int")("34") == 34
    assert PrimType("bool")(True) is True
    assert PrimType("bool")("true") is True
    assert PrimType("bool")("false") is False
    assert PrimType("num")(True) == 1.0
    assert PrimType("num")(34) == 34.0
    assert PrimType("num")("3.25") == 3.25
    assert PrimType("str")(34) == "34"
    assert PrimType("bytes")("hej") == b"hej"
    with pytest.raises(Exception):
        PrimType("int")(3.25)


def test_bad_numeric_strings_reject_cleanly() -> None:
    with pytest.raises(Exception, match="cannot coerce str"):
        coerce_value("hej", "num")
    with pytest.raises(Exception, match="cannot coerce str"):
        PrimType("num")("hej")
    with pytest.raises(Exception, match="cannot coerce str|integer-valued"):
        PrimType("int")("hej")
    with pytest.raises(Exception, match="true|false|only accepts bool or str"):
        PrimType("bool")("hej")
    with pytest.raises(Exception, match="true|false"):
        PrimType("bool")("0")
    with pytest.raises(Exception, match="only accepts bool or str"):
        PrimType("bool")(1)


def test_typeof_explicit_int_value_is_int() -> None:
    assert _run(":: int(true).") == "int"


def test_num_param_accepts_int_implicitly() -> None:
    src = """
f(x:num) -> num: x + 1
:: f(3)
"""
    assert _run(src) in ("4", "4.0")


def test_fixed_vector_coercion_applies_elementwise() -> None:
    ip = Interpreter(Path(__file__))
    t = parse_module("Vec2 : [num:2]", filename="<test>").statements[0].value
    out, _ = coerce_typed_value([1, True], t, ip.types)
    assert isinstance(out, TypedVector)
    assert isinstance(out, VFVector)
    assert not isinstance(out, list)
    assert tuple(out) == (1.0, 1.0)


def test_type_size_arithmetic_rejects_type_names() -> None:
    with pytest.raises(Exception):
        parse_module("f(x:[num:num+1]): x", filename="<test>")


def test_type_size_arithmetic_accepts_bool_constants() -> None:
    out = _run("""
[num:false+2] v: [1,2]
::: v.
""")
    assert out == "<TypeOf>: [num:2]"


def test_symbolic_fixed_vector_function_sizes_resolve() -> None:
    src = """
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y
out: join([1,2], [3,4,5])
::: out.
::: out
"""
    assert _run(src) == "<TypeOf>: [num:5]\nout: [1, 2, 3, 4, 5]"
