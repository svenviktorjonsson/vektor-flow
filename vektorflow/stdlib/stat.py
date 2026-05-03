"""Built-in ``stat`` library for ``use("stat")`` / ``:.stat``.

Descriptive statistics and probability utilities operating on Python
sequences (vectors, lists, tuples) of numeric values.

Functions:
    mean, median, mode, variance, std, min_val, max_val, range_val,
    sum_val, count, percentile, iqr, zscore, normalize,
    covariance, correlation, clamp, sign
"""

from __future__ import annotations

import random as _random
import math as _m
from typing import Any, Sequence


def _to_floats(seq: Any) -> list[float]:
    """Convert any iterable of numerics to a list[float]."""
    try:
        return [float(x) for x in seq]
    except (TypeError, ValueError) as e:
        raise TypeError(f"stat: all elements must be numeric — {e}") from e


def _require_nonempty(xs: list[float], name: str) -> None:
    if not xs:
        raise ValueError(f"stat.{name}: sequence must be non-empty")


def _shape_to_dims(shape: Any) -> tuple[int, ...]:
    """Convert nested shape-like data into a tuple of integer dimensions.

    Accepts scalar sizes, 1-D lists like ``[2, 3]``, and nested lists
    like ``[[2], [3, 4]]`` (flattened).
    """

    if isinstance(shape, (int, float)):
        try:
            dim = int(shape)
        except (TypeError, ValueError, OverflowError) as e:
            raise TypeError(f"stat: shape must be numeric, got {shape!r}") from e
        if dim != shape:
            raise TypeError(f"stat: shape sizes must be integers, got {shape!r}")
        if dim < 0:
            raise ValueError(f"stat: shape sizes must be non-negative, got {dim}")
        return (dim,)

    if isinstance(shape, (list, tuple)):
        dims: list[int] = []
        for axis in shape:
            dims.extend(_shape_to_dims(axis))
        return tuple(dims)

    raise TypeError(
        "stat: shape must be a non-negative integer or a nested list/tuple of integers"
    )


def _validate_shape(shape: Any, *, name: str = "shape") -> tuple[int, ...]:
    dims = _shape_to_dims(shape)
    if any(dim <= 0 for dim in dims):
        raise ValueError(f"stat.{name}: each shape size must be > 0, got {dims}")
    return dims


def _uniform_single(low: float, high: float) -> float:
    lo = float(low)
    hi = float(high)
    if lo > hi:
        lo, hi = hi, lo
    return lo + (hi - lo) * _random.random()


def _randn(mean: float, sigma: float) -> float:
    if sigma <= 0:
        return float(mean)
    return _random.gauss(float(mean), float(_m.sqrt(float(sigma))))


def _build_nested(shape: tuple[int, ...], factory: Any) -> Any:
    if not shape:
        return factory()
    if len(shape) == 1:
        return [factory() for _ in range(shape[0])]
    return [_build_nested(shape[1:], factory) for _ in range(shape[0])]


def _to_float_vector(seq: Any, *, name: str) -> list[float]:
    if not isinstance(seq, Sequence):
        raise TypeError(f"stat.{name}: expected a sequence of numerics")
    xs = [float(x) for x in seq]
    if len(xs) == 0:
        raise ValueError(f"stat.{name}: sequence must be non-empty")
    return xs


def _uniform_factory_with_shape(
    low: float, high: float, shape: tuple[int, ...]
) -> Any:
    def _sample() -> float:
        return _uniform_single(low, high)

    return _build_nested(shape, _sample)


def _normal_factory(
    mean: Sequence[float], variance: Sequence[float], shape: tuple[int, ...]
) -> Any:
    means = list(mean)
    vars = list(variance)
    if len(means) != len(vars):
        raise ValueError(
            "stat.random.normal: mean and variance must be same length"
        )
    d = len(means)

    def _sample_vec() -> list[float]:
        return [_randn(m, v) for m, v in zip(means, vars)]

    def _sample_scalar() -> float:
        return _sample_vec()[0]

    if d == 1:
        return _build_nested(shape, _sample_scalar)
    return _build_nested(shape, _sample_vec)


def uniform(low: float, high: float, shape: Any) -> Any:
    """Draw random numbers from a uniform distribution in [low, high]."""
    dims = _validate_shape(shape)
    return _uniform_factory_with_shape(low, high, dims)


def normal(
    mean: Sequence[float],
    variance: Sequence[float],
    shape: Any,
) -> Any:
    """Draw random samples from a normal distribution.

    ``mean`` and ``variance`` are 1-D vectors that define the component-wise
    Gaussian parameters for the returned elements.
    """
    mean_v = _to_float_vector(mean, name="random.normal.mean")
    var_v = _to_float_vector(variance, name="random.normal.variance")
    if len(mean_v) != len(var_v):
        raise ValueError("stat.random.normal: mean and variance must be same length")
    if any(v < 0 for v in var_v):
        raise ValueError("stat.random.normal: variance entries must be non-negative")
    dims = _validate_shape(shape, name="random.normal.shape")
    return _normal_factory(mean_v, var_v, dims)


def random_namespace() -> dict[str, Any]:
    return {
        "uniform": uniform,
        "normal": normal,
    }


def mean(seq: Any) -> float:
    """Arithmetic mean of a sequence."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "mean")
    return sum(xs) / len(xs)


def median(seq: Any) -> float:
    """Median of a sequence (middle value or average of two middle values)."""
    xs = sorted(_to_floats(seq))
    _require_nonempty(xs, "median")
    n = len(xs)
    mid = n // 2
    if n % 2 == 1:
        return xs[mid]
    return (xs[mid - 1] + xs[mid]) / 2.0


def mode(seq: Any) -> float:
    """Most frequent value. Ties: smallest value wins (deterministic)."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "mode")
    counts: dict[float, int] = {}
    for x in xs:
        counts[x] = counts.get(x, 0) + 1
    max_count = max(counts.values())
    candidates = sorted(k for k, v in counts.items() if v == max_count)
    return candidates[0]


def variance(seq: Any, *, ddof: int = 0) -> float:
    """Population variance (ddof=0) or sample variance (ddof=1)."""
    xs = _to_floats(seq)
    n = len(xs)
    if n < ddof + 1:
        raise ValueError(
            f"stat.variance: need at least {ddof + 1} elements for ddof={ddof}, got {n}"
        )
    mu = sum(xs) / n
    return sum((x - mu) ** 2 for x in xs) / (n - ddof)


def std(seq: Any, *, ddof: int = 0) -> float:
    """Standard deviation (population by default; ddof=1 for sample)."""
    return _m.sqrt(variance(seq, ddof=ddof))


def min_val(seq: Any) -> float:
    """Minimum value of a sequence."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "min")
    return min(xs)


def max_val(seq: Any) -> float:
    """Maximum value of a sequence."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "max")
    return max(xs)


def range_val(seq: Any) -> float:
    """Range (max - min) of a sequence."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "range")
    return max(xs) - min(xs)


def sum_val(seq: Any) -> float:
    """Sum of all elements."""
    return sum(_to_floats(seq))


def count(seq: Any) -> int:
    """Number of elements in the sequence."""
    try:
        return len(list(seq))
    except TypeError as e:
        raise TypeError(f"stat.count: not iterable — {e}") from e


def percentile(seq: Any, p: float) -> float:
    """p-th percentile of seq (0 <= p <= 100). Uses linear interpolation."""
    xs = sorted(_to_floats(seq))
    _require_nonempty(xs, "percentile")
    if not (0.0 <= p <= 100.0):
        raise ValueError(f"stat.percentile: p must be in [0, 100], got {p}")
    n = len(xs)
    if n == 1:
        return xs[0]
    idx = (p / 100.0) * (n - 1)
    lo = int(idx)
    hi = lo + 1
    if hi >= n:
        return xs[-1]
    frac = idx - lo
    return xs[lo] + frac * (xs[hi] - xs[lo])


def iqr(seq: Any) -> float:
    """Interquartile range (Q3 - Q1), i.e. percentile(75) - percentile(25)."""
    return percentile(seq, 75.0) - percentile(seq, 25.0)


def zscore(seq: Any) -> list[float]:
    """Z-scores of each element: (x - mean) / std. Returns a list."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "zscore")
    s = std(xs)
    if s == 0.0:
        return [0.0] * len(xs)
    mu = mean(xs)
    return [(x - mu) / s for x in xs]


def normalize(seq: Any) -> list[float]:
    """Min-max normalization to [0, 1]. Returns a list."""
    xs = _to_floats(seq)
    _require_nonempty(xs, "normalize")
    lo = min(xs)
    hi = max(xs)
    if hi == lo:
        return [0.0] * len(xs)
    span = hi - lo
    return [(x - lo) / span for x in xs]


def covariance(seq_x: Any, seq_y: Any, *, ddof: int = 0) -> float:
    """Covariance of two sequences (population by default; ddof=1 for sample)."""
    xs = _to_floats(seq_x)
    ys = _to_floats(seq_y)
    if len(xs) != len(ys):
        raise ValueError(
            f"stat.covariance: sequences must have equal length ({len(xs)} vs {len(ys)})"
        )
    n = len(xs)
    if n < ddof + 1:
        raise ValueError(
            f"stat.covariance: need at least {ddof + 1} elements for ddof={ddof}"
        )
    mu_x = sum(xs) / n
    mu_y = sum(ys) / n
    return sum((x - mu_x) * (y - mu_y) for x, y in zip(xs, ys)) / (n - ddof)


def correlation(seq_x: Any, seq_y: Any) -> float:
    """Pearson correlation coefficient of two sequences [-1, 1]."""
    xs = _to_floats(seq_x)
    ys = _to_floats(seq_y)
    if len(xs) != len(ys):
        raise ValueError(
            f"stat.correlation: sequences must have equal length ({len(xs)} vs {len(ys)})"
        )
    if not xs:
        raise ValueError("stat.correlation: sequences must be non-empty")
    sx = std(xs)
    sy = std(ys)
    if sx == 0.0 or sy == 0.0:
        return 0.0
    return covariance(xs, ys) / (sx * sy)


def clamp(x: float, lo: float, hi: float) -> float:
    """Clamp x to the range [lo, hi]."""
    return float(max(lo, min(hi, x)))


def sign(x: float) -> int:
    """Sign of x: -1, 0, or 1."""
    v = float(x)
    if v > 0:
        return 1
    if v < 0:
        return -1
    return 0


def build_stat_namespace() -> dict[str, Any]:
    return {
        "mean": mean,
        "median": median,
        "mode": mode,
        "variance": variance,
        "std": std,
        "min": min_val,
        "max": max_val,
        "range": range_val,
        "sum": sum_val,
        "count": count,
        "percentile": percentile,
        "iqr": iqr,
        "zscore": zscore,
        "normalize": normalize,
        "covariance": covariance,
        "correlation": correlation,
        "clamp": clamp,
        "sign": sign,
        "random": random_namespace(),
    }
