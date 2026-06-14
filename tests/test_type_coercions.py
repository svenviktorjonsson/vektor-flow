from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.runtime.type_values import PrimType, coerce_typed_value, coerce_value, infer_type


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_infer_base_types() -> None:
    ip = Interpreter(Path(__file__))
    assert infer_type(3, ip.types).name == "int"
    assert PrimType("chr")("x") == "x"
    assert infer_type("abc", ip.types).name == "str"


def test_core_primitive_type_functions_are_the_language_surface() -> None:
    src = """
:: bit.
:: chr.
:: int.
:: num.
:: str.
"""
    assert _run(src) == "(any) -> bit\n(any) -> chr\n(any) -> int\n(any, any = 0) -> num\n(any) -> str"


def test_removed_type_names_are_not_builtins() -> None:
    for name in ("type", "bool", "byte", "bytes", "float"):
        with pytest.raises(Exception, match=f"undefined name: '{name}'"):
            _run(f":: {name}")


def test_base_type_sizes_are_stable_semantic_targets() -> None:
    src = """
:: bit.size(true)
:: chr.size(chr(65))
:: int.size(1)
:: num.size(num(1))
"""
    assert _run(src) == "1\n8\n64\n128"


def test_str_and_fixed_chr_vector_are_distinct_representations() -> None:
    src = """
str s: "abcd"
[chr:4] chars: [chr(97), chr(98), chr(99), chr(100)]
:: s.
:: chars.
"""
    assert _run(src) == "str\n[chr:4]"


def test_real_complex_num_values_can_be_ordered() -> None:
    assert _run(":: num(2) < 3\n:: 3 > num(2)") == "true\ntrue"


def test_non_real_complex_num_values_cannot_be_ordered() -> None:
    with pytest.raises(Exception, match="ordering is only defined for real num values"):
        _run(":: num(2, 1) < 3")


def test_real_complex_num_values_can_index_sequences() -> None:
    assert _run("xs: [10, 20, 30]\n:: xs.(num(1))") == "20"


def test_non_real_complex_num_values_cannot_index_sequences() -> None:
    with pytest.raises(Exception, match="index must be int or str"):
        _run("xs: [10, 20, 30]\n:: xs.(num(1, 1))")


def test_implicit_bit_and_int_widening() -> None:
    assert coerce_value(True, "int") == 1
    assert coerce_value(False, "num") == 0j
    assert coerce_value(3, "num") == 3 + 0j


def test_num_to_int_not_implicit() -> None:
    with pytest.raises(Exception):
        coerce_value(3.25, "int")


def test_not_other_way_to_bit() -> None:
    with pytest.raises(Exception):
        coerce_value(1, "bit")
    with pytest.raises(Exception):
        coerce_value("x", "bit")


def test_chr_scalar_conversion() -> None:
    assert coerce_value(65, "chr") == "A"
    assert coerce_value("A", "chr") == "A"
    with pytest.raises(Exception):
        coerce_value("AB", "chr")


def test_explicit_cast_policy() -> None:
    assert PrimType("int")(True) == 1
    assert PrimType("num")(True) == 1.0
    assert PrimType("bit")("true") is True
    assert PrimType("chr")(65) == "A"
    with pytest.raises(Exception):
        PrimType("int")(3.25)


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
    assert out == [1.0, 1.0]


def test_type_size_arithmetic_rejects_type_names() -> None:
    with pytest.raises(Exception):
        parse_module("f(x:[num:num+1]): x", filename="<test>")


def test_type_size_arithmetic_accepts_bool_constants() -> None:
    out = _run("""
[num:false+2] v: [1,2]
:: v.
""")
    assert out == "[num:2]"


def test_symbolic_fixed_vector_function_sizes_resolve() -> None:
    src = """
join(x:[num:n], y:[num:m]) -> [num:n+m]:
    x & y
out: join([1,2], [3,4,5])
:: out.
:: out
"""
    assert _run(src) == "[num:5]\n[1, 2, 3, 4, 5]"
