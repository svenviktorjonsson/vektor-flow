"""Pipe: vector/tuple map element-wise; scalar binds ``$`` once."""

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


class TestPipeElementwise:
    def test_list_squares(self) -> None:
        assert _run(":: [1..5] >> $^2") == "[1, 4, 9, 16, 25]"

    def test_tuple_squares(self) -> None:
        assert _run(":: (1..5) >> $^2") == "(1, 4, 9, 16, 25)"

    def test_scalar_pipe(self) -> None:
        assert _run(":: 4 >> $^2") == "16"

    def test_pipe_expression_can_bind_comprehension_result(self) -> None:
        src = """
x: [1, 2, 3]
a: x >> $ + 1
:: a
"""
        assert _run(src) == "[2, 3, 4]"

    def test_range_tuple_squares(self) -> None:
        assert _run(":: (0..4) >> $^2") == "(0, 1, 4, 9, 16)"

    def test_string_each_char(self) -> None:
        assert _run(':: "hi" >> $') == "hi"

    def test_string_concat_preserve_str(self) -> None:
        assert _run(':: "ab" >> $ & $') == "aabb"

    def test_multiset_pipe_preserves_multiset(self) -> None:
        assert _run(":: {1:2, 2:1} >> $ * 2") == "{2:2, 4:1}"

    def test_lazy_range_pipe_emit_print_until_break(self) -> None:
        """``..`` drives ``>>`` until ``@|``; RHS uses ``$??`` switch arms."""
        out = _run("..>>::$;$?? (20 => @|)")
        lines = [x.rstrip() for x in out.splitlines() if x.strip() != ""]
        assert lines == [str(i) for i in range(21)]

    def test_finite_range_pipe_emit_print(self) -> None:
        """``..20`` is a finite tuple; ``>> ::$`` prints each element (same RHS form as lazy ``..``)."""
        out = _run("..20>>::$")
        lines = [x.rstrip() for x in out.splitlines() if x.strip() != ""]
        assert lines == [str(i) for i in range(21)]

    def test_nested_pipe_one_element_through_chain(self) -> None:
        """Multiple ``>>`` segments stream one value through the whole chain (no per-stage lists)."""
        assert _run(":: (1..3) >> $ >> $ * 2") == _run(":: (1..3) >> $ * 2")

    def test_indented_pipe_block_returns_last_row_onward(self) -> None:
        src = """
..5 >>
    x: 4
    $ + x
>>
    :: $
"""
        assert _run(src) == "4\n5\n6\n7\n8\n9"

    def test_indented_pipe_block_locals_do_not_leak(self) -> None:
        src = """
x: 100
:: (1..2) >>
    x: $ + 10
    x
:: x
"""
        assert _run(src) == "(11, 12)\n100"

    def test_pipe_block_return_branches_to_onward_value(self) -> None:
        src = """
:: (0..3) >>
    $ < 2?
        @: $ + 10
    $ + 20
"""
        assert _run(src) == "(10, 11, 22, 23)"

    def test_pipe_block_return_is_local_inside_outer_function(self) -> None:
        src = """
f():
    xs: (0..2) >>
        $ == 1?
            @: 99
        $
    @: xs
:: f()
"""
        assert _run(src) == "(0, 99, 2)"

    def test_triple_colon_line_emit_sugar(self) -> None:
        """``::: expr`` is label-print and remains usable inside pipe segments."""
        assert _run("::: 1") == "1: 1"
        assert _run("..3>>::: $") == "$: 0\n$: 1\n$: 2\n$: 3"

    def test_interpolated_string_in_pipe_function_uses_display_stringifier(self) -> None:
        src = r"""
F(i):
    :: "call $i\n"
    @: i
..2 >> F($)
"""
        assert _run(src.strip()) == "call 0\ncall 1\ncall 2"
