"""Built-in ``math`` namespace from ``vektorflow.stdlib.math``."""

from __future__ import annotations

import math as pymath

import pytest

from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.math import build_math_namespace


class TestResolveStdlib:
    def test_math(self) -> None:
        m = resolve_stdlib("math")
        assert callable(m["sin"])
        assert m["sin"](0.0) == 0.0

    def test_unknown(self) -> None:
        with pytest.raises(KeyError):
            resolve_stdlib("nope")


class TestTrig:
    def test_sin_cos_tan(self) -> None:
        m = build_math_namespace()
        assert m["sin"](0) == 0.0
        assert m["cos"](0) == 1.0
        assert m["tan"](0) == 0.0

    def test_inverse_trig(self) -> None:
        m = build_math_namespace()
        assert m["asin"](1.0) == pymath.asin(1.0)
        assert m["acos"](1.0) == 0.0
        assert m["atan"](1.0) == pymath.pi / 4

    def test_atan2(self) -> None:
        m = build_math_namespace()
        assert m["atan2"](1, 1) == pymath.pi / 4

    def test_hyperbolic(self) -> None:
        m = build_math_namespace()
        assert m["sinh"](0) == 0.0
        assert m["cosh"](0) == 1.0
        assert m["tanh"](0) == 0.0
        assert m["asinh"](0) == 0.0
        assert m["acosh"](1) == 0.0
        assert m["atanh"](0) == 0.0


class TestExpLog:
    def test_exp_ln(self) -> None:
        m = build_math_namespace()
        assert m["exp"](1.0) == pymath.e
        assert m["ln"](pymath.e) == 1.0

    def test_lg_lg2(self) -> None:
        m = build_math_namespace()
        assert m["lg"](100.0) == 2.0
        assert m["lg2"](8.0) == 3.0

    def test_log_base_y_of_x(self) -> None:
        m = build_math_namespace()
        # log_10(1000) = 3
        assert abs(m["log"](1000.0, 10.0) - 3.0) < 1e-12
        # log_2(256) = 8
        assert abs(m["log"](256.0, 2.0) - 8.0) < 1e-12

    def test_log_bad_base(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError):
            m["log"](4.0, 1.0)
        with pytest.raises(ValueError):
            m["log"](-1.0, 2.0)


class TestSqrtConstants:
    def test_sqrt(self) -> None:
        m = build_math_namespace()
        assert m["sqrt"](9.0) == 3.0

    def test_constants(self) -> None:
        m = build_math_namespace()
        assert m["pi"] == pymath.pi
        assert m["e"] == pymath.e


class TestAbsInMath:
    def test_abs_is_abs_or_norm(self) -> None:
        m = build_math_namespace()
        assert m["abs"](-3) == 3.0
        assert m["abs"]([3.0, 4.0]) == 5.0
