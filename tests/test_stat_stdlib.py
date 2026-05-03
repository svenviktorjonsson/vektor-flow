"""Extensive tests for ``vektorflow.stdlib.stat`` — descriptive statistics,
probability utilities, edge cases, error handling, and VKF interpreter integration."""

from __future__ import annotations

import contextlib
import math
from io import StringIO
from pathlib import Path

import pytest

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.stdlib import resolve_stdlib
from vektorflow.stdlib.stat import (
    build_stat_namespace,
    clamp,
    normal,
    correlation,
    count,
    covariance,
    iqr,
    max_val,
    mean,
    median,
    min_val,
    mode,
    normalize,
    percentile,
    range_val,
    sign,
    std,
    sum_val,
    uniform,
    variance,
    zscore,
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _run(src: str) -> list[str]:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        ip.run_module(mod)
    return [ln for ln in buf.getvalue().splitlines() if ln.strip()]


def _run_with_stat_import(src: str) -> list[str]:
    body = src.lstrip()
    if body.startswith("stat: .stat"):
        return _run(body)
    return _run(f"stat: .stat\n{body}")


def _approx(a: float, b: float, tol: float = 1e-10) -> bool:
    return abs(a - b) < tol


# ---------------------------------------------------------------------------
# resolve_stdlib contract
# ---------------------------------------------------------------------------

class TestResolveStatStdlib:
    def test_stat_in_resolve_stdlib(self) -> None:
        s = resolve_stdlib("stat")
        expected = {
            "mean", "median", "mode", "variance", "std",
            "min", "max", "range", "sum", "count",
            "percentile", "iqr", "zscore", "normalize",
            "covariance", "correlation", "clamp", "sign",
            "random",
        }
        assert expected <= set(s.keys())

    def test_stat_random_namespace_present(self) -> None:
        s = resolve_stdlib("stat")
        random_ns = s["random"]
        assert isinstance(random_ns, dict)
        assert set(random_ns.keys()) == {"uniform", "normal"}
        assert callable(random_ns["uniform"])
        assert callable(random_ns["normal"])

    def test_all_callable(self) -> None:
        s = resolve_stdlib("stat")
        for k, v in s.items():
            if k == "random":
                assert isinstance(v, dict)
                assert set(v.keys()) == {"uniform", "normal"}
            else:
                assert callable(v), f"{k} should be callable"

    def test_unknown_stdlib_raises(self) -> None:
        with pytest.raises(KeyError):
            resolve_stdlib("stats_typo")


# ---------------------------------------------------------------------------
# mean
# ---------------------------------------------------------------------------

class TestMean:
    def test_single_element(self) -> None:
        assert mean([5]) == 5.0

    def test_integers(self) -> None:
        assert mean([1, 2, 3, 4, 5]) == 3.0

    def test_floats(self) -> None:
        assert _approx(mean([1.5, 2.5]), 2.0)

    def test_negative_values(self) -> None:
        assert mean([-1, -2, -3]) == -2.0

    def test_mixed_sign(self) -> None:
        assert mean([-5, 5]) == 0.0

    def test_zeros(self) -> None:
        assert mean([0, 0, 0]) == 0.0

    def test_large_sequence(self) -> None:
        xs = list(range(1, 101))
        assert mean(xs) == 50.5

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            mean([])

    def test_non_numeric_raises(self) -> None:
        with pytest.raises(TypeError):
            mean(["a", "b"])

    def test_tuple_input(self) -> None:
        assert mean((2, 4, 6)) == 4.0


# ---------------------------------------------------------------------------
# median
# ---------------------------------------------------------------------------

class TestMedian:
    def test_odd_count(self) -> None:
        assert median([1, 2, 3]) == 2.0

    def test_even_count(self) -> None:
        assert median([1, 2, 3, 4]) == 2.5

    def test_single_element(self) -> None:
        assert median([7]) == 7.0

    def test_unsorted_input(self) -> None:
        assert median([5, 1, 3]) == 3.0

    def test_negative_values(self) -> None:
        assert median([-3, -1, -2]) == -2.0

    def test_duplicates(self) -> None:
        assert median([1, 1, 1]) == 1.0

    def test_two_elements(self) -> None:
        assert median([2, 8]) == 5.0

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            median([])


# ---------------------------------------------------------------------------
# mode
# ---------------------------------------------------------------------------

class TestMode:
    def test_clear_winner(self) -> None:
        assert mode([1, 2, 2, 3]) == 2.0

    def test_all_same(self) -> None:
        assert mode([5, 5, 5]) == 5.0

    def test_tie_returns_smallest(self) -> None:
        # tie between 1.0 and 2.0 — smallest wins
        result = mode([1, 2, 1, 2])
        assert result == 1.0

    def test_single_element(self) -> None:
        assert mode([42]) == 42.0

    def test_all_unique_returns_smallest(self) -> None:
        result = mode([3, 1, 2])
        assert result == 1.0

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            mode([])


# ---------------------------------------------------------------------------
# variance & std
# ---------------------------------------------------------------------------

class TestVarianceStd:
    def test_population_variance(self) -> None:
        # mean=2, deviations: -1,0,1 → var=2/3
        assert _approx(variance([1, 2, 3]), 2 / 3)

    def test_sample_variance_ddof1(self) -> None:
        assert _approx(variance([1, 2, 3], ddof=1), 1.0)

    def test_variance_constant_sequence(self) -> None:
        assert variance([5, 5, 5]) == 0.0

    def test_std_matches_sqrt_variance(self) -> None:
        xs = [1, 2, 3, 4, 5]
        assert _approx(std(xs), math.sqrt(variance(xs)))

    def test_std_known_value(self) -> None:
        # [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, pop std=2
        xs = [2, 4, 4, 4, 5, 5, 7, 9]
        assert _approx(std(xs), 2.0)

    def test_variance_single_element_ddof0(self) -> None:
        assert variance([42]) == 0.0

    def test_variance_single_element_ddof1_raises(self) -> None:
        with pytest.raises(ValueError):
            variance([42], ddof=1)

    def test_variance_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            variance([])

    def test_sample_std(self) -> None:
        xs = [1, 2, 3]
        assert _approx(std(xs, ddof=1), math.sqrt(variance(xs, ddof=1)))


# ---------------------------------------------------------------------------
# min, max, range, sum, count
# ---------------------------------------------------------------------------

class TestAggregates:
    def test_min(self) -> None:
        assert min_val([3, 1, 4, 1, 5]) == 1.0

    def test_max(self) -> None:
        assert max_val([3, 1, 4, 1, 5]) == 5.0

    def test_range(self) -> None:
        assert range_val([1, 5, 3]) == 4.0

    def test_range_single(self) -> None:
        assert range_val([7]) == 0.0

    def test_sum(self) -> None:
        assert sum_val([1, 2, 3, 4]) == 10.0

    def test_sum_empty(self) -> None:
        assert sum_val([]) == 0.0

    def test_count_list(self) -> None:
        assert count([1, 2, 3]) == 3

    def test_count_empty(self) -> None:
        assert count([]) == 0

    def test_count_tuple(self) -> None:
        assert count((1, 2, 3, 4, 5)) == 5

    def test_min_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            min_val([])

    def test_max_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            max_val([])

    def test_range_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            range_val([])

    def test_min_negative(self) -> None:
        assert min_val([-5, -1, -3]) == -5.0

    def test_max_negative(self) -> None:
        assert max_val([-5, -1, -3]) == -1.0


# ---------------------------------------------------------------------------
# percentile & iqr
# ---------------------------------------------------------------------------

class TestPercentile:
    def test_p0_is_min(self) -> None:
        xs = [1, 2, 3, 4, 5]
        assert percentile(xs, 0) == 1.0

    def test_p100_is_max(self) -> None:
        xs = [1, 2, 3, 4, 5]
        assert percentile(xs, 100) == 5.0

    def test_p50_is_median(self) -> None:
        xs = [1, 2, 3, 4, 5]
        assert _approx(percentile(xs, 50), median(xs))

    def test_p25(self) -> None:
        xs = [1, 2, 3, 4]
        p25 = percentile(xs, 25)
        assert 1.0 <= p25 <= 2.0

    def test_p75(self) -> None:
        xs = [1, 2, 3, 4]
        p75 = percentile(xs, 75)
        assert 3.0 <= p75 <= 4.0

    def test_out_of_range_p_raises(self) -> None:
        with pytest.raises(ValueError):
            percentile([1, 2], -1)
        with pytest.raises(ValueError):
            percentile([1, 2], 101)

    def test_single_element(self) -> None:
        assert percentile([42], 0) == 42.0
        assert percentile([42], 100) == 42.0

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            percentile([], 50)


class TestIqr:
    def test_iqr_known(self) -> None:
        xs = [1, 2, 3, 4, 5, 6, 7, 8]
        result = iqr(xs)
        assert result > 0

    def test_iqr_constant(self) -> None:
        assert iqr([5, 5, 5, 5]) == 0.0

    def test_iqr_is_q75_minus_q25(self) -> None:
        xs = [1, 2, 3, 4, 5, 6, 7, 8]
        assert _approx(iqr(xs), percentile(xs, 75) - percentile(xs, 25))


# ---------------------------------------------------------------------------
# zscore
# ---------------------------------------------------------------------------

class TestZscore:
    def test_length_preserved(self) -> None:
        xs = [1, 2, 3, 4, 5]
        assert len(zscore(xs)) == 5

    def test_mean_zero(self) -> None:
        z = zscore([1, 2, 3, 4, 5])
        assert _approx(sum(z) / len(z), 0.0, tol=1e-10)

    def test_std_one(self) -> None:
        z = zscore([1, 2, 3, 4, 5])
        var = sum(zi**2 for zi in z) / len(z)
        assert _approx(var, 1.0, tol=1e-10)

    def test_constant_sequence_returns_zeros(self) -> None:
        z = zscore([7, 7, 7])
        assert z == [0.0, 0.0, 0.0]

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            zscore([])

    def test_two_element_symmetry(self) -> None:
        z = zscore([0.0, 10.0])
        assert _approx(z[0], -z[1])


# ---------------------------------------------------------------------------
# normalize
# ---------------------------------------------------------------------------

class TestNormalize:
    def test_range_is_zero_to_one(self) -> None:
        n = normalize([2, 4, 6, 8, 10])
        assert _approx(min(n), 0.0)
        assert _approx(max(n), 1.0)

    def test_constant_returns_zeros(self) -> None:
        n = normalize([5, 5, 5])
        assert n == [0.0, 0.0, 0.0]

    def test_two_elements(self) -> None:
        n = normalize([0, 10])
        assert _approx(n[0], 0.0)
        assert _approx(n[1], 1.0)

    def test_length_preserved(self) -> None:
        xs = [1, 3, 2, 5, 4]
        assert len(normalize(xs)) == 5

    def test_order_preserved(self) -> None:
        xs = [1, 2, 3]
        n = normalize(xs)
        assert n[0] < n[1] < n[2]

    def test_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            normalize([])


class TestRandomNamespace:
    def test_uniform_shape_and_bounds(self) -> None:
        out = uniform(2.0, 5.0, [2, 3])
        assert len(out) == 2
        assert all(len(row) == 3 for row in out)
        for row in out:
            for v in row:
                assert 2.0 <= v <= 5.0

    def test_uniform_nested_shape(self) -> None:
        out = uniform(-1.0, 1.0, [[2], [2]])
        assert len(out) == 2
        assert len(out[0]) == 2

    def test_uniform_swapped_bounds(self) -> None:
        sample = uniform(5.0, 1.0, 4)
        assert len(sample) == 4
        assert all(1.0 <= v <= 5.0 for v in sample)


class TestNormalNamespace:
    def test_normal_shape_with_vector_mean_and_variance(self) -> None:
        out = normal([0.0, 1.0], [1.0, 4.0], [2, 2])
        assert len(out) == 2
        assert len(out[0]) == 2
        assert len(out[0][0]) == 2
        assert len(out[0][1]) == 2
        assert all(len(v) == 2 for row in out for v in row)
        for row in out:
            for sample in row:
                assert len(sample) == 2
                assert all(_is_num(x) for x in sample)

    def test_normal_scalar_default_shape(self) -> None:
        # 1-D gaussian when mean/variance have len 1: output keeps requested shape.
        out = normal([10.0], [1.0], 3)
        assert isinstance(out, list)
        assert len(out) == 3
        assert all(_is_num(v) for v in out)

    def test_normal_shape_uses_via_vkf(self) -> None:
        lines = _run_with_stat_import(":: stat.random.normal([0.0, 1.0], [1.0, 1.0], [2, 2])")
        assert len(lines) == 1
        assert lines[0].startswith("[[")


def _is_num(v: object) -> bool:
    try:
        float(v)
    except (TypeError, ValueError):
        return False
    return True


# ---------------------------------------------------------------------------
# covariance & correlation
# ---------------------------------------------------------------------------

class TestCovarianceCorrelation:
    def test_covariance_positive(self) -> None:
        xs = [1, 2, 3]
        ys = [1, 2, 3]
        assert covariance(xs, ys) > 0

    def test_covariance_negative(self) -> None:
        xs = [1, 2, 3]
        ys = [3, 2, 1]
        assert covariance(xs, ys) < 0

    def test_covariance_zero(self) -> None:
        xs = [1, 2, 3]
        ys = [5, 5, 5]  # constant y → cov=0
        assert _approx(covariance(xs, ys), 0.0)

    def test_covariance_symmetric(self) -> None:
        xs = [1, 2, 3, 4]
        ys = [2, 4, 6, 8]
        assert _approx(covariance(xs, ys), covariance(ys, xs))

    def test_covariance_unequal_length_raises(self) -> None:
        with pytest.raises(ValueError):
            covariance([1, 2, 3], [1, 2])

    def test_covariance_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            covariance([], [])

    def test_correlation_perfect_positive(self) -> None:
        xs = [1, 2, 3, 4, 5]
        ys = [2, 4, 6, 8, 10]
        assert _approx(correlation(xs, ys), 1.0)

    def test_correlation_perfect_negative(self) -> None:
        xs = [1, 2, 3, 4, 5]
        ys = [5, 4, 3, 2, 1]
        assert _approx(correlation(xs, ys), -1.0)

    def test_correlation_zero_for_constant(self) -> None:
        xs = [1, 2, 3]
        ys = [4, 4, 4]
        assert correlation(xs, ys) == 0.0

    def test_correlation_range(self) -> None:
        xs = [1, 2, 3, 4, 5]
        ys = [2, 3, 5, 3, 4]
        r = correlation(xs, ys)
        assert -1.0 <= r <= 1.0

    def test_correlation_unequal_length_raises(self) -> None:
        with pytest.raises(ValueError):
            correlation([1, 2], [1, 2, 3])

    def test_correlation_empty_raises(self) -> None:
        with pytest.raises(ValueError):
            correlation([], [])


# ---------------------------------------------------------------------------
# clamp & sign
# ---------------------------------------------------------------------------

class TestClampSign:
    def test_clamp_within_range(self) -> None:
        assert clamp(5.0, 0.0, 10.0) == 5.0

    def test_clamp_below_min(self) -> None:
        assert clamp(-5.0, 0.0, 10.0) == 0.0

    def test_clamp_above_max(self) -> None:
        assert clamp(15.0, 0.0, 10.0) == 10.0

    def test_clamp_at_min(self) -> None:
        assert clamp(0.0, 0.0, 10.0) == 0.0

    def test_clamp_at_max(self) -> None:
        assert clamp(10.0, 0.0, 10.0) == 10.0

    def test_clamp_negative_range(self) -> None:
        assert clamp(-3.0, -5.0, -1.0) == -3.0

    def test_sign_positive(self) -> None:
        assert sign(5.0) == 1

    def test_sign_negative(self) -> None:
        assert sign(-3.0) == -1

    def test_sign_zero(self) -> None:
        assert sign(0.0) == 0

    def test_sign_small_positive(self) -> None:
        assert sign(1e-15) == 1

    def test_sign_small_negative(self) -> None:
        assert sign(-1e-15) == -1


# ---------------------------------------------------------------------------
# VKF interpreter integration
# ---------------------------------------------------------------------------

class TestStatVkfIntegration:
    def test_mean_via_vkf(self) -> None:
        lines = _run_with_stat_import(":: stat.mean([1, 2, 3, 4, 5])")
        assert float(lines[0]) == pytest.approx(3.0)

    def test_median_via_vkf(self) -> None:
        lines = _run_with_stat_import(":: stat.median([1, 2, 3])")
        assert float(lines[0]) == pytest.approx(2.0)

    def test_std_via_vkf(self) -> None:
        lines = _run_with_stat_import(":: stat.std([2, 4, 4, 4, 5, 5, 7, 9])")
        assert float(lines[0]) == pytest.approx(2.0)

    def test_min_max_via_vkf(self) -> None:
        src = """
stat: .stat
:: stat.min([3, 1, 4, 1, 5])
:: stat.max([3, 1, 4, 1, 5])
"""
        lines = _run_with_stat_import(src)
        assert float(lines[0]) == pytest.approx(1.0)
        assert float(lines[1]) == pytest.approx(5.0)

    def test_sum_count_via_vkf(self) -> None:
        src = """
stat: .stat
:: stat.sum([1, 2, 3, 4])
:: stat.count([1, 2, 3, 4])
"""
        lines = _run_with_stat_import(src)
        assert float(lines[0]) == pytest.approx(10.0)
        assert float(lines[1]) == pytest.approx(4.0)

    def test_clamp_via_vkf(self) -> None:
        lines = _run_with_stat_import(":: stat.clamp(15.0, 0.0, 10.0)")
        assert float(lines[0]) == pytest.approx(10.0)

    def test_sign_via_vkf(self) -> None:
        src = """
stat: .stat
:: stat.sign(-5.0)
:: stat.sign(0.0)
:: stat.sign(3.0)
"""
        lines = _run_with_stat_import(src)
        assert float(lines[0]) == pytest.approx(-1.0)
        assert float(lines[1]) == pytest.approx(0.0)
        assert float(lines[2]) == pytest.approx(1.0)

    def test_stat_bound_as_namespace(self) -> None:
        src = """
s : .stat
:: s.mean([10, 20, 30])
"""
        lines = _run(src)
        assert float(lines[0]) == pytest.approx(20.0)

    def test_stat_pipeline(self) -> None:
        """mean of normalized [1..5] should be exactly 0.5."""
        src = """
stat: .stat
data : [1, 2, 3, 4, 5]
n : stat.normalize(data)
:: stat.mean(n)
"""
        lines = _run_with_stat_import(src)
        assert float(lines[0]) == pytest.approx(0.5, abs=0.01)
