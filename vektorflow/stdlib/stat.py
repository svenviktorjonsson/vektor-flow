"""Built-in ``stat`` library for ``use("stat")`` / ``:.stat``.

Descriptive statistics and reduction helpers.

Classic statistics stay sequence-oriented. Explicit reducers such as
``all``/``any``/``sum``/``prod`` traverse nested structured values so the
language has a clear explicit reduction path for structured booleans and
numeric leaves.
"""

from __future__ import annotations

import math as _m
from collections.abc import Mapping, Sequence
from typing import Any

from ..runtime.axis_tagged import AxisTaggedValue
from ..runtime.multiset import Multiset
from ..runtime.struct_value import VF_TYPE_KEY, is_struct_dict
from ..runtime.vfvector import VFVector


def _is_real_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_numeric(value: Any) -> bool:
    return isinstance(value, (int, float, complex)) and not isinstance(value, bool)


def _iter_reduction_leaves(value: Any) -> Any:
    if isinstance(value, AxisTaggedValue):
        yield from _iter_reduction_leaves(value.data)
        return
    if isinstance(value, Multiset):
        for elem in value.elements():
            yield from _iter_reduction_leaves(elem)
        return
    if is_struct_dict(value):
        for key, inner in value.items():
            if key == VF_TYPE_KEY:
                continue
            yield from _iter_reduction_leaves(inner)
        return
    if isinstance(value, Mapping):
        for inner in value.values():
            yield from _iter_reduction_leaves(inner)
        return
    if isinstance(value, (VFVector, list, tuple)):
        for inner in value:
            yield from _iter_reduction_leaves(inner)
        return
    yield value


def _to_real_sequence(seq: Any, *, name: str) -> list[float]:
    try:
        xs = list(seq)
    except TypeError as e:
        raise TypeError(f"stat.{name}: expected an iterable of real numeric values — {e}") from e
    out: list[float] = []
    for item in xs:
        if not _is_real_number(item):
            raise TypeError(f"stat.{name}: all elements must be real numeric values")
        out.append(float(item))
    return out


def _to_numeric_leaves(value: Any, *, name: str) -> list[int | float | complex]:
    out: list[int | float | complex] = []
    for item in _iter_reduction_leaves(value):
        if not _is_numeric(item):
            raise TypeError(f"stat.{name}: all reduced leaves must be numeric")
        out.append(item)
    return out


def _to_bool_leaves(value: Any, *, name: str) -> list[bool]:
    out: list[bool] = []
    for item in _iter_reduction_leaves(value):
        if not isinstance(item, bool):
            raise TypeError(f"stat.{name}: all reduced leaves must be bool")
        out.append(item)
    return out


def _to_floats(seq: Any) -> list[float]:
    """Convert any iterable of numerics to a list[float]."""
    return _to_real_sequence(seq, name="numeric")


def _require_nonempty(xs: list[float], name: str) -> None:
    if not xs:
        raise ValueError(f"stat.{name}: sequence must be non-empty")


def mean(seq: Any) -> float:
    """Arithmetic mean of a sequence."""
    xs = _to_real_sequence(seq, name="mean")
    _require_nonempty(xs, "mean")
    return sum(xs) / len(xs)


def median(seq: Any) -> float:
    """Median of a sequence (middle value or average of two middle values)."""
    xs = sorted(_to_real_sequence(seq, name="median"))
    _require_nonempty(xs, "median")
    n = len(xs)
    mid = n // 2
    if n % 2 == 1:
        return xs[mid]
    return (xs[mid - 1] + xs[mid]) / 2.0


def mode(seq: Any) -> float:
    """Most frequent value. Ties: smallest value wins (deterministic)."""
    xs = _to_real_sequence(seq, name="mode")
    _require_nonempty(xs, "mode")
    counts: dict[float, int] = {}
    for x in xs:
        counts[x] = counts.get(x, 0) + 1
    max_count = max(counts.values())
    candidates = sorted(k for k, v in counts.items() if v == max_count)
    return candidates[0]


def variance(seq: Any, *, ddof: int = 0) -> float:
    """Population variance (ddof=0) or sample variance (ddof=1)."""
    xs = _to_real_sequence(seq, name="variance")
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
    xs = _to_real_sequence(seq, name="min")
    _require_nonempty(xs, "min")
    return min(xs)


def max_val(seq: Any) -> float:
    """Maximum value of a sequence."""
    xs = _to_real_sequence(seq, name="max")
    _require_nonempty(xs, "max")
    return max(xs)


def range_val(seq: Any) -> float:
    """Range (max - min) of a sequence."""
    xs = _to_real_sequence(seq, name="range")
    _require_nonempty(xs, "range")
    return max(xs) - min(xs)


def sum_val(value: Any) -> int | float | complex:
    """Reduce nested numeric leaves by addition."""
    xs = _to_numeric_leaves(value, name="sum")
    if not xs:
        return 0.0
    total = xs[0]
    for item in xs[1:]:
        total += item
    return total


def prod(value: Any) -> int | float | complex:
    """Reduce nested numeric leaves by multiplication."""
    xs = _to_numeric_leaves(value, name="prod")
    if not xs:
        return 1
    total = xs[0]
    for item in xs[1:]:
        total *= item
    return total


def all_val(value: Any) -> bool:
    """Reduce nested boolean leaves with logical conjunction."""
    xs = _to_bool_leaves(value, name="all")
    return all(xs)


def any_val(value: Any) -> bool:
    """Reduce nested boolean leaves with logical disjunction."""
    xs = _to_bool_leaves(value, name="any")
    return any(xs)


def count(seq: Any) -> int:
    """Number of elements in the sequence."""
    try:
        return len(list(seq))
    except TypeError as e:
        raise TypeError(f"stat.count: not iterable — {e}") from e


def percentile(seq: Any, p: float) -> float:
    """p-th percentile of seq (0 <= p <= 100). Uses linear interpolation."""
    xs = sorted(_to_real_sequence(seq, name="percentile"))
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
    xs = _to_real_sequence(seq, name="zscore")
    _require_nonempty(xs, "zscore")
    s = std(xs)
    if s == 0.0:
        return [0.0] * len(xs)
    mu = mean(xs)
    return [(x - mu) / s for x in xs]


def normalize(seq: Any) -> list[float]:
    """Min-max normalization to [0, 1]. Returns a list."""
    xs = _to_real_sequence(seq, name="normalize")
    _require_nonempty(xs, "normalize")
    lo = min(xs)
    hi = max(xs)
    if hi == lo:
        return [0.0] * len(xs)
    span = hi - lo
    return [(x - lo) / span for x in xs]


def covariance(seq_x: Any, seq_y: Any, *, ddof: int = 0) -> float:
    """Covariance of two sequences (population by default; ddof=1 for sample)."""
    xs = _to_real_sequence(seq_x, name="covariance")
    ys = _to_real_sequence(seq_y, name="covariance")
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
    xs = _to_real_sequence(seq_x, name="correlation")
    ys = _to_real_sequence(seq_y, name="correlation")
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
        "all": all_val,
        "any": any_val,
        "mean": mean,
        "median": median,
        "mode": mode,
        "variance": variance,
        "std": std,
        "min": min_val,
        "max": max_val,
        "range": range_val,
        "sum": sum_val,
        "prod": prod,
        "count": count,
        "percentile": percentile,
        "iqr": iqr,
        "zscore": zscore,
        "normalize": normalize,
        "covariance": covariance,
        "correlation": correlation,
        "clamp": clamp,
        "sign": sign,
    }
