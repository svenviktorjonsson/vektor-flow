from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import ast, ir


@dataclass(frozen=True)
class NativeIntrinsic:
    module: str | None
    name: str
    kind: str


_MATH_NAMES = {
    "sin",
    "cos",
    "tan",
    "sinh",
    "cosh",
    "asin",
    "acos",
    "atan",
    "atan2",
    "asinh",
    "acosh",
    "atanh",
    "exp",
    "ln",
    "lg",
    "lg2",
    "sqrt",
    "log",
}

_STAT_VECTOR_NAMES = {"sum", "mean", "min", "max", "range", "count", "variance", "std"}
_STAT_VECTOR_FLOAT_NAMES = {"median", "percentile", "iqr", "zscore", "normalize", "covariance", "correlation"}
_STAT_SCALAR_NAMES = {"clamp", "sign"}
_MATH_CONST_NAMES = {"pi", "e", "tau"}


def resolve_native_intrinsic(func: Any) -> NativeIntrinsic | None:
    if isinstance(func, ir.LoadName):
        if func.name in _MATH_NAMES:
            return NativeIntrinsic(None, func.name, "math")
        return None
    if isinstance(func, ir.AttrExpr) and isinstance(func.value, ir.LoadName):
        base = func.value.name
        if base == "math" and func.name in _MATH_NAMES:
            return NativeIntrinsic("math", func.name, "math")
        if base == "math" and func.name in _MATH_CONST_NAMES:
            return NativeIntrinsic("math", func.name, "math_const")
        if base == "stat" and (func.name in _STAT_VECTOR_NAMES or func.name in _STAT_VECTOR_FLOAT_NAMES or func.name in _STAT_SCALAR_NAMES):
            return NativeIntrinsic("stat", func.name, "stat")
    return None


def infer_intrinsic_return_type(intrinsic: NativeIntrinsic, arg_types: list[Any]) -> Any:
    if intrinsic.kind == "math_const":
        _require_arity(intrinsic, len(arg_types), 0)
        return ast.PrimTypeRef("num")
    if intrinsic.kind == "math":
        _require_arity(intrinsic, len(arg_types), 2 if intrinsic.name in {"atan2", "log"} else 1)
        _require_all_numeric(intrinsic, arg_types)
        return ast.PrimTypeRef("num")
    if intrinsic.kind == "stat":
        if intrinsic.name == "clamp":
            _require_arity(intrinsic, len(arg_types), 3)
            _require_all_numeric(intrinsic, arg_types)
            return ast.PrimTypeRef("num")
        if intrinsic.name == "sign":
            _require_arity(intrinsic, len(arg_types), 1)
            _require_all_numeric(intrinsic, arg_types)
            return ast.PrimTypeRef("int")
        if intrinsic.name in {"covariance", "correlation"}:
            _require_arity(intrinsic, len(arg_types), 2)
            left_t = _require_numeric_vector(intrinsic, arg_types[0], 0)
            right_t = _require_numeric_vector(intrinsic, arg_types[1], 1)
            if left_t.size != right_t.size:
                raise ValueError(f"{_intrinsic_label(intrinsic)} requires equal fixed-vector sizes")
            return ast.PrimTypeRef("num")
        if intrinsic.name == "percentile":
            _require_arity(intrinsic, len(arg_types), 2)
            _require_numeric_vector(intrinsic, arg_types[0], 0)
            if not _is_scalar_numeric_type(arg_types[1]):
                raise ValueError(f"{_intrinsic_label(intrinsic)} requires a numeric percentile argument")
            return ast.PrimTypeRef("num")
        if intrinsic.name in {"zscore", "normalize"}:
            _require_arity(intrinsic, len(arg_types), 1)
            vector_t = _require_numeric_vector(intrinsic, arg_types[0], 0)
            return ast.FixedVectorType(ast.PrimTypeRef("num"), vector_t.size)
        _require_arity(intrinsic, len(arg_types), 1)
        _require_numeric_vector(intrinsic, arg_types[0], 0)
        if intrinsic.name == "count":
            return ast.PrimTypeRef("int")
        return ast.PrimTypeRef("num")
    raise ValueError(f"unknown intrinsic kind {intrinsic.kind}")


def intrinsic_uses_array_stats(intrinsic: NativeIntrinsic) -> bool:
    return intrinsic.kind == "stat" and intrinsic.name in {
        "min",
        "max",
        "range",
        "variance",
        "std",
        "median",
        "percentile",
        "iqr",
        "zscore",
        "normalize",
        "covariance",
        "correlation",
    }


def intrinsic_uses_array_sum(intrinsic: NativeIntrinsic) -> bool:
    return intrinsic.kind == "stat" and intrinsic.name in {"sum", "mean"}


def _intrinsic_label(intrinsic: NativeIntrinsic) -> str:
    return f"{intrinsic.module}.{intrinsic.name}" if intrinsic.module else intrinsic.name


def _require_arity(intrinsic: NativeIntrinsic, got: int, want: int) -> None:
    if got != want:
        raise ValueError(f"{_intrinsic_label(intrinsic)} expects {want} argument(s), got {got}")


def _require_all_numeric(intrinsic: NativeIntrinsic, arg_types: list[Any]) -> None:
    for arg_t in arg_types:
        if not _is_scalar_numeric_type(arg_t):
            raise ValueError(f"{_intrinsic_label(intrinsic)} requires numeric arguments")


def _require_numeric_vector(intrinsic: NativeIntrinsic, arg_type: Any, index: int) -> ast.FixedVectorType:
    vector_t = _normalize_type(arg_type)
    if not isinstance(vector_t, ast.FixedVectorType):
        raise ValueError(f"{_intrinsic_label(intrinsic)} argument {index + 1} requires a fixed vector")
    elem_t = _normalize_type(vector_t.element_type)
    if not _is_scalar_numeric_type(elem_t):
        raise ValueError(f"{_intrinsic_label(intrinsic)} argument {index + 1} requires a numeric vector")
    return vector_t


def _normalize_type(t: Any) -> Any:
    if isinstance(t, ast.NamedTypeSpec):
        return _normalize_type(t.type_expr)
    return t


def _is_scalar_numeric_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bool", "int", "num"}
