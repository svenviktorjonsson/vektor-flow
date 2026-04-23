"""``.`` is the reach-in operator: ``a.(i, j, ...)`` reads; ``a.(i, j): (u, v)`` writes."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run(src: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return buf.getvalue().strip()


class TestDottedIndex:
    def test_get_one(self) -> None:
        assert _run("a : [10, 20, 30]\n:: a.(1)") == "20"

    def test_get_numeric_without_parens(self) -> None:
        assert _run("a : [10, 20, 30]\n:: a.1") == "20"

    def test_nested_mixed_numeric_and_parens(self) -> None:
        # ``m.1.0`` lexes as ``m`` ``.`` ``1.0`` (one float) — use ``.()`` for the inner index.
        assert (
            _run("m : [[1, 2], [3, 4]]\nm.1.(0) : 100\n:: m")
            == "[[1, 2], [100, 4]]"
        )

    def test_get_many(self) -> None:
        assert _run("a : [1, 2, 3, 4]\n:: a.(0, 1, 2, 3)") == "(1, 2, 3, 4)"

    def test_set_one(self) -> None:
        assert _run("a : [1, 2, 3]\na.(1) : 99\n:: a") == "[1, 99, 3]"

    def test_set_parallel(self) -> None:
        assert _run("a : [0, 0, 0]\na.(2) : 2\n:: a") == "[0, 0, 2]"

    def test_set_multi(self) -> None:
        assert _run("a : [1, 2, 3]\na.(0, 2) : (10, 30)\n:: a") == "[10, 2, 30]"

    def test_nested(self) -> None:
        assert (
            _run("m : [[1, 2], [3, 4]]\nm.(1).(0) : 100\n:: m")
            == "[[1, 2], [100, 4]]"
        )

    def test_implicit_mul_with_list(self) -> None:
        assert _run(":: 2 * [1, 2]") == "[2, 4]"
        assert _run(":: 2 [1, 2]") == "[2, 4]"

    def test_struct_string_keys(self) -> None:
        assert _run('p : ()\np.x : 5\n:: p.("x")') == "5"

    def test_dot_string_same_as_identifier(self) -> None:
        assert _run('p : ()\np.hej : 9\n:: p."hej"') == "9"
        assert _run('p : ()\np.hej : 9\n:: p.hej') == "9"

    def test_dollar_dot_is_value_key_not_name(self) -> None:
        # Bare .i is field name i; dynamic key must use a non--parallel-bind index (e.g. .(i+0)).
        assert _run("i : 4\na : ()\na.i : 5\n:: a") == "(i:5)"
        assert _run("i : 4\na : ()\na.(i + 0) : 5\n:: a") == "(4:5)"

    def test_paren_expr_for_dynamic_key(self) -> None:
        assert _run("a : ()\na.(1+2) : 9\n:: a.(3)") == "9"
        assert _run("a : ()\na.$(1+2) : 9\n:: a.(3)") == "9"

    def test_parallel_string_keys_on_struct(self) -> None:
        assert (
            _run('a : ()\na.("1","8"): (3,"9")\n:: a')
            == "(1:3, 8:9)"
        )

    def test_underscore_name(self) -> None:
        assert _run("row_1 : [7]\n:: row_1.(0)") == "7"
