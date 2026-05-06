"""Extensive tests for ``vektorflow.stdlib.math`` — trig, exp/log, constants,
edge cases, error handling, and VKF-level integration via the interpreter."""

from __future__ import annotations

import contextlib
import math as pymath
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.math import build_math_namespace


# ---------------------------------------------------------------------------
# Helper: run a .vkf source snippet and return captured stdout lines
# ---------------------------------------------------------------------------

def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [ln for ln in buf.getvalue().splitlines() if ln.strip()]


def _approx(a: float, b: float, tol: float = 1e-10) -> bool:
    return abs(a - b) < tol


# ---------------------------------------------------------------------------
# resolve_stdlib contract
# ---------------------------------------------------------------------------

class TestResolveStdlibContract:
    def test_returns_dict(self) -> None:
        m = resolve_stdlib("math")
        assert isinstance(m, dict)

    def test_all_expected_names_present(self) -> None:
        m = resolve_stdlib("math")
        required = {
            "sin", "cos", "tan", "sinh", "cosh", "tanh",
            "asin", "acos", "atan", "atan2", "asinh", "acosh", "atanh",
            "exp", "ln", "lg", "lg2", "log", "sqrt", "abs",
            "pi", "e", "tau",
        }
        assert required <= set(m.keys())

    def test_unknown_stdlib_raises_key_error(self) -> None:
        with pytest.raises(KeyError):
            resolve_stdlib("does_not_exist")

    def test_all_functions_are_callable(self) -> None:
        m = resolve_stdlib("math")
        for name in ("sin", "cos", "tan", "sinh", "cosh", "tanh",
                     "asin", "acos", "atan", "atan2", "asinh", "acosh", "atanh",
                     "exp", "ln", "lg", "lg2", "sqrt", "log", "abs"):
            assert callable(m[name]), f"{name} should be callable"


# ---------------------------------------------------------------------------
# Trig — exact values
# ---------------------------------------------------------------------------

class TestTrigExact:
    def test_sin_zero(self) -> None:
        m = build_math_namespace()
        assert m["sin"](0.0) == 0.0

    def test_sin_pi_over_2(self) -> None:
        m = build_math_namespace()
        assert _approx(m["sin"](pymath.pi / 2), 1.0)

    def test_sin_pi(self) -> None:
        m = build_math_namespace()
        assert abs(m["sin"](pymath.pi)) < 1e-15

    def test_cos_zero(self) -> None:
        m = build_math_namespace()
        assert m["cos"](0.0) == 1.0

    def test_cos_pi(self) -> None:
        m = build_math_namespace()
        assert _approx(m["cos"](pymath.pi), -1.0)

    def test_tan_pi_over_4(self) -> None:
        m = build_math_namespace()
        assert _approx(m["tan"](pymath.pi / 4), 1.0)

    def test_sin_negative_angle(self) -> None:
        m = build_math_namespace()
        assert _approx(m["sin"](-pymath.pi / 2), -1.0)

    def test_sin_cos_pythagorean(self) -> None:
        m = build_math_namespace()
        for angle in [0.3, 1.0, 2.5]:
            s, c = m["sin"](angle), m["cos"](angle)
            assert _approx(s**2 + c**2, 1.0)


class TestInverseTrig:
    def test_asin_range(self) -> None:
        m = build_math_namespace()
        assert _approx(m["asin"](0.0), 0.0)
        assert _approx(m["asin"](1.0), pymath.pi / 2)
        assert _approx(m["asin"](-1.0), -pymath.pi / 2)

    def test_acos_range(self) -> None:
        m = build_math_namespace()
        assert _approx(m["acos"](1.0), 0.0)
        assert _approx(m["acos"](0.0), pymath.pi / 2)
        assert _approx(m["acos"](-1.0), pymath.pi)

    def test_atan_range(self) -> None:
        m = build_math_namespace()
        assert _approx(m["atan"](0.0), 0.0)
        assert _approx(m["atan"](1.0), pymath.pi / 4)
        assert _approx(m["atan"](-1.0), -pymath.pi / 4)

    def test_atan2_quadrants(self) -> None:
        m = build_math_namespace()
        assert _approx(m["atan2"](1, 1), pymath.pi / 4)
        assert _approx(m["atan2"](-1, 1), -pymath.pi / 4)
        assert _approx(m["atan2"](1, -1), 3 * pymath.pi / 4)
        assert _approx(m["atan2"](0, 1), 0.0)

    def test_asin_out_of_range(self) -> None:
        m = build_math_namespace()
        with pytest.raises((ValueError, Exception)):
            m["asin"](2.0)

    def test_roundtrip_sin_asin(self) -> None:
        m = build_math_namespace()
        for v in [0.0, 0.5, 1.0, -0.5, -1.0]:
            assert _approx(m["sin"](m["asin"](v)), v)


class TestHyperbolic:
    def test_sinh_zero(self) -> None:
        m = build_math_namespace()
        assert m["sinh"](0.0) == 0.0

    def test_cosh_zero(self) -> None:
        m = build_math_namespace()
        assert m["cosh"](0.0) == 1.0

    def test_tanh_zero(self) -> None:
        m = build_math_namespace()
        assert m["tanh"](0.0) == 0.0

    def test_tanh_approaches_limits(self) -> None:
        m = build_math_namespace()
        assert m["tanh"](100.0) > 0.999
        assert m["tanh"](-100.0) < -0.999

    def test_asinh_zero(self) -> None:
        m = build_math_namespace()
        assert m["asinh"](0.0) == 0.0

    def test_acosh_one(self) -> None:
        m = build_math_namespace()
        assert m["acosh"](1.0) == 0.0

    def test_atanh_zero(self) -> None:
        m = build_math_namespace()
        assert m["atanh"](0.0) == 0.0

    def test_cosh_identity(self) -> None:
        m = build_math_namespace()
        for x in [0.5, 1.0, 2.0]:
            assert _approx(m["cosh"](x) ** 2 - m["sinh"](x) ** 2, 1.0)


# ---------------------------------------------------------------------------
# Exp / Log
# ---------------------------------------------------------------------------

class TestExpLog:
    def test_exp_zero(self) -> None:
        m = build_math_namespace()
        assert m["exp"](0.0) == 1.0

    def test_exp_one(self) -> None:
        m = build_math_namespace()
        assert _approx(m["exp"](1.0), pymath.e)

    def test_exp_negative(self) -> None:
        m = build_math_namespace()
        assert _approx(m["exp"](-1.0), 1 / pymath.e)

    def test_ln_e(self) -> None:
        m = build_math_namespace()
        assert _approx(m["ln"](pymath.e), 1.0)

    def test_ln_one(self) -> None:
        m = build_math_namespace()
        assert m["ln"](1.0) == 0.0

    def test_ln_exp_roundtrip(self) -> None:
        m = build_math_namespace()
        for v in [0.5, 1.0, 2.0, 10.0]:
            assert _approx(m["ln"](m["exp"](v)), v)

    def test_lg_10(self) -> None:
        m = build_math_namespace()
        assert _approx(m["lg"](10.0), 1.0)

    def test_lg_100(self) -> None:
        m = build_math_namespace()
        assert _approx(m["lg"](100.0), 2.0)

    def test_lg_1000(self) -> None:
        m = build_math_namespace()
        assert _approx(m["lg"](1000.0), 3.0)

    def test_lg2_2(self) -> None:
        m = build_math_namespace()
        assert _approx(m["lg2"](2.0), 1.0)

    def test_lg2_8(self) -> None:
        m = build_math_namespace()
        assert _approx(m["lg2"](8.0), 3.0)

    def test_lg2_1024(self) -> None:
        m = build_math_namespace()
        assert _approx(m["lg2"](1024.0), 10.0)

    def test_log_base_10(self) -> None:
        m = build_math_namespace()
        assert _approx(m["log"](1000.0, 10.0), 3.0)

    def test_log_base_2(self) -> None:
        m = build_math_namespace()
        assert _approx(m["log"](256.0, 2.0), 8.0)

    def test_log_base_e(self) -> None:
        m = build_math_namespace()
        assert _approx(m["log"](pymath.e, pymath.e), 1.0)

    def test_log_bad_base_one_raises(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError):
            m["log"](10.0, 1.0)

    def test_log_bad_base_zero_raises(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError):
            m["log"](10.0, 0.0)

    def test_log_negative_base_raises(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError):
            m["log"](10.0, -2.0)

    def test_log_negative_arg_raises(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError):
            m["log"](-5.0, 2.0)

    def test_log_zero_arg_raises(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError):
            m["log"](0.0, 2.0)


# ---------------------------------------------------------------------------
# Sqrt & Constants
# ---------------------------------------------------------------------------

class TestSqrtAndConstants:
    def test_sqrt_zero(self) -> None:
        m = build_math_namespace()
        assert m["sqrt"](0.0) == 0.0

    def test_sqrt_one(self) -> None:
        m = build_math_namespace()
        assert m["sqrt"](1.0) == 1.0

    def test_sqrt_four(self) -> None:
        m = build_math_namespace()
        assert m["sqrt"](4.0) == 2.0

    def test_sqrt_nine(self) -> None:
        m = build_math_namespace()
        assert m["sqrt"](9.0) == 3.0

    def test_sqrt_two(self) -> None:
        m = build_math_namespace()
        assert _approx(m["sqrt"](2.0), pymath.sqrt(2))

    def test_sqrt_negative_raises(self) -> None:
        m = build_math_namespace()
        with pytest.raises((ValueError, Exception)):
            m["sqrt"](-1.0)

    def test_pi_value(self) -> None:
        m = build_math_namespace()
        assert m["pi"] == pymath.pi

    def test_e_value(self) -> None:
        m = build_math_namespace()
        assert m["e"] == pymath.e

    def test_tau_is_two_pi(self) -> None:
        m = build_math_namespace()
        assert _approx(m["tau"], 2 * pymath.pi)


# ---------------------------------------------------------------------------
# Abs / norm
# ---------------------------------------------------------------------------

class TestAbsNorm:
    def test_abs_positive_int(self) -> None:
        m = build_math_namespace()
        assert m["abs"](5) == 5.0

    def test_abs_negative_int(self) -> None:
        m = build_math_namespace()
        assert m["abs"](-7) == 7.0

    def test_abs_zero(self) -> None:
        m = build_math_namespace()
        assert m["abs"](0) == 0.0

    def test_abs_float(self) -> None:
        m = build_math_namespace()
        assert m["abs"](-3.5) == 3.5

    def test_abs_vector_3_4(self) -> None:
        m = build_math_namespace()
        assert _approx(m["abs"]([3.0, 4.0]), 5.0)

    def test_abs_vector_all_zeros(self) -> None:
        m = build_math_namespace()
        assert m["abs"]([0.0, 0.0, 0.0]) == 0.0

    def test_abs_vector_unit(self) -> None:
        m = build_math_namespace()
        assert _approx(m["abs"]([1.0, 0.0, 0.0]), 1.0)

    def test_unary_math_rejects_bool(self) -> None:
        m = build_math_namespace()
        with pytest.raises(TypeError, match="expected a number"):
            m["sqrt"](True)

    def test_binary_math_is_positionwise_on_tuples(self) -> None:
        m = build_math_namespace()
        assert m["log"]((4.0, 8.0), 2.0) == (2.0, 3.0)

    def test_binary_math_is_keywise_on_structs(self) -> None:
        m = build_math_namespace()
        assert m["log"]({"x": 4.0, "y": 8.0}, 2.0) == {"x": 2.0, "y": 3.0}

    def test_binary_math_rejects_struct_key_mismatch(self) -> None:
        m = build_math_namespace()
        with pytest.raises(ValueError, match="struct key mismatch"):
            m["atan2"]({"x": 1.0}, {"y": 1.0})


# ---------------------------------------------------------------------------
# VKF-level integration (interpreter runs .vkf source)
# ---------------------------------------------------------------------------

class TestMathVkfIntegration:
    def test_sin_via_vkf(self) -> None:
        # interpreter strips trailing .0 for integer results
        lines = _run(":.math\n:: sin(0.0)")
        assert float(lines[0]) == pytest.approx(0.0)

    def test_cos_via_vkf(self) -> None:
        lines = _run(":.math\n:: cos(0.0)")
        assert float(lines[0]) == pytest.approx(1.0)

    def test_sqrt_via_vkf(self) -> None:
        lines = _run(":.math\n:: sqrt(9.0)")
        assert float(lines[0]) == pytest.approx(3.0)

    def test_pi_constant_via_vkf(self) -> None:
        lines = _run(":.math\n:: pi")
        assert float(lines[0]) == pytest.approx(pymath.pi)

    def test_e_constant_via_vkf(self) -> None:
        lines = _run(":.math\n:: e")
        assert float(lines[0]) == pytest.approx(pymath.e)

    def test_ln_via_vkf(self) -> None:
        lines = _run(":.math\n:: ln(1.0)")
        assert float(lines[0]) == pytest.approx(0.0)

    def test_lg_via_vkf(self) -> None:
        lines = _run(":.math\n:: lg(100.0)")
        assert float(lines[0]) == pytest.approx(2.0)

    def test_lg2_via_vkf(self) -> None:
        lines = _run(":.math\n:: lg2(8.0)")
        assert float(lines[0]) == pytest.approx(3.0)

    def test_exp_via_vkf(self) -> None:
        lines = _run(":.math\n:: exp(0.0)")
        assert float(lines[0]) == pytest.approx(1.0)

    def test_math_used_in_expression(self) -> None:
        # sin^2 + cos^2 = 1
        src = """
:.math
x : 0.7
r : sin(x)^2 + cos(x)^2
:: r
"""
        lines = _run(src)
        assert float(lines[0]) == pytest.approx(1.0, abs=1e-12)

    def test_math_namespace_bound(self) -> None:
        # bind math as 'm', access via m.sqrt
        src = """
m : .math
:: m.sqrt(16.0)
"""
        lines = _run(src)
        assert float(lines[0]) == pytest.approx(4.0)
