from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.errors import AssertionError as VfAssertionError, EvalError, ParseError
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> Interpreter:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    ip.run_module(mod)
    return ip


def _emit(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


def test_vector_builtin_attributes() -> None:
    ip = _run(
        """
v: [1, 2, 3]
shape: v.shape
ndim: v.ndim
size: v.size
length: v.length
"""
    )
    assert ip.globals["shape"] == (3,)
    assert ip.globals["ndim"] == 1
    assert ip.globals["size"] == 192
    assert ip.globals["length"] == 3


def test_zero_arg_attr_calls_work_for_size_and_length() -> None:
    ip = _run(
        """
v: [1, 2, 3]
sv: v.size()
lv: v.length()
"""
    )
    assert ip.globals["sv"] == 192
    assert ip.globals["lv"] == 3


def test_multiset_length_and_count() -> None:
    ip = _run(
        """
m: {1:2, 3:4}
length: m.length()
count: m.count()
"""
    )
    assert ip.globals["length"] == 2
    assert ip.globals["count"] == 6


def test_multiset_count_arg_and_has() -> None:
    ip = _run(
        """
m: {1:2, 3:4}
c1: m.count(1)
c2: m.count()
h1: m.has(3)
h2: m.has(2)
"""
    )
    assert ip.globals["c1"] == 2
    assert ip.globals["c2"] == 6
    assert ip.globals["h1"] is True
    assert ip.globals["h2"] is False


def test_vector_count_and_has() -> None:
    ip = _run(
        """
v: [1, 2, 2, 3]
c: v.count(2)
t: v.count()
h: v.has(3)
"""
    )
    assert ip.globals["c"] == 2
    assert ip.globals["t"] == 4
    assert ip.globals["h"] is True


def test_size_exists_on_scalars_and_structs() -> None:
    ip = _run(
        """
a: 7
b: "hej"
s: (x:1, y:true)
sa: a.size
sb: b.size
ss: s.size
"""
    )
    assert ip.globals["sa"] == 64
    assert ip.globals["sb"] == 24
    assert ip.globals["ss"] == 65


def test_scalar_size_zero_arg_call_works() -> None:
    ip = _run(
        """
a: 1
out: a.size()
"""
    )
    assert ip.globals["out"] == 64


def test_string_is_num_and_is_int_methods() -> None:
    ip = _run(
        """
a: "34"
b: "3.25"
c: "hej"
d: " 42 "
e: "true"
f: "0"
an: a.is_num()
ai: a.is_int()
ab: a.is_bool()
bn: b.is_num()
bi: b.is_int()
bb: b.is_bool()
cn: c.is_num()
ci: c.is_int()
cb: c.is_bool()
dn: d.is_num()
di: d.is_int()
db: d.is_bool()
eb: e.is_bool()
fb: f.is_bool()
"""
    )
    assert ip.globals["an"] is True
    assert ip.globals["ai"] is True
    assert ip.globals["ab"] is False
    assert ip.globals["bn"] is True
    assert ip.globals["bi"] is False
    assert ip.globals["bb"] is False
    assert ip.globals["cn"] is False
    assert ip.globals["ci"] is False
    assert ip.globals["cb"] is False
    assert ip.globals["dn"] is True
    assert ip.globals["di"] is True
    assert ip.globals["db"] is False
    assert ip.globals["eb"] is True
    assert ip.globals["fb"] is False


def test_string_shared_container_interface_has_count_length_size() -> None:
    ip = _run(
        """
s: "banana"
h1: s.has("na")
h2: s.has("xy")
c1: s.count("na")
c2: s.count("a")
c3: s.count()
l: s.length()
z: s.size()
"""
    )
    assert ip.globals["h1"] is True
    assert ip.globals["h2"] is False
    assert ip.globals["c1"] == 2
    assert ip.globals["c2"] == 3
    assert ip.globals["c3"] == 6
    assert ip.globals["l"] == 6
    assert ip.globals["z"] == 48


def test_struct_field_named_size_wins_over_builtin_size() -> None:
    ip = _run("s: (size:9,)\nout: s.size")
    assert ip.globals["out"] == 9


def test_raise_bang_raises_error_value() -> None:
    mod = parse_module("errors.Error(\"boom\")!", filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(EvalError, match="boom"):
        ip.run_module(mod)


def test_raise_bang_flows_into_bang_question_arms() -> None:
    out = _emit(
        """
errors.Error("boom")!!?
    errors.Error => :: "caught"
"""
    )
    assert out == "caught"


def test_assert_bang_passes_when_truthy() -> None:
    ip = _run("x: 3\nout: x>0?!")
    assert ip.globals["out"] is True


def test_assert_bang_raises_default_message() -> None:
    mod = parse_module("2<1?!", filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(VfAssertionError, match="assertion failed: 2<1"):
        ip.run_module(mod)


def test_assert_bang_raises_custom_message() -> None:
    mod = parse_module('2<1?! "bad math"', filename="<test>")
    ip = Interpreter(Path(__file__))
    with pytest.raises(VfAssertionError, match="bad math"):
        ip.run_module(mod)


def test_explicit_assertion_error_raise_flows_into_catch() -> None:
    out = _emit(
        """
errors.AssertionError("x must be positive")!!?
    errors.AssertionError => :: "caught assertion"
"""
    )
    assert out == "caught assertion"


def test_parse_error_humanizes_indent_token() -> None:
    with pytest.raises(ParseError, match="expected indented block"):
        parse_module("x?\n:: 1", filename="<test>")
