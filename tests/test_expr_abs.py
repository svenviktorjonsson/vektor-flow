"""Mini expression evaluator: ``|x|``, math calls, vectors."""

from __future__ import annotations

import pytest

from vektorflow.errors import ParseError
from vektorflow.expr import eval_expression, parse_expression


class TestAbsBars:
    def test_scalar(self) -> None:
        assert eval_expression("|-3|") == 3.0

    def test_nested(self) -> None:
        assert eval_expression("||-5||") == 5.0

    def test_vector_norm(self) -> None:
        assert eval_expression("|[3, 4]|") == 5.0

    def test_with_math_sin(self) -> None:
        assert abs(eval_expression("|sin(0)|") - 0.0) < 1e-12


class TestMathCalls:
    def test_lg_lg2_ln(self) -> None:
        assert abs(eval_expression("lg(100)") - 2.0) < 1e-12
        assert abs(eval_expression("lg2(8)") - 3.0) < 1e-12
        assert abs(eval_expression("ln(exp(1))") - 1.0) < 1e-12

    def test_log_xy(self) -> None:
        assert abs(eval_expression("log(8, 2)") - 3.0) < 1e-12


class TestParseErrors:
    def test_unclosed_abs(self) -> None:
        with pytest.raises(ParseError):
            parse_expression("|1 + 2")


class TestEnvOverride:
    def test_user_overrides_math(self) -> None:
        v = eval_expression("foo(1)", env={"foo": lambda x: x + 10})
        assert v == 11
