"""Runtime type values (``PrimType``), ``infer_type``, and type equality for ``=``."""

from __future__ import annotations

from typing import Any

from .. import ast
from ..errors import EvalError
from .struct_value import VF_TYPE_KEY, get_type_name, is_struct_dict
from .multiset import Multiset


class PrimType:
    """Builtin type object: ``num``, ``str``, ``byte``, ``any`` — ``num`` is also callable."""

    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name

    def __call__(self, *args: Any) -> Any:
        if self.name != "num":
            raise EvalError(f"type {self.name!r} is not callable")
        if len(args) == 1:
            v = args[0]
            if isinstance(v, bool):
                raise EvalError("num: boolean is not a number")
            if isinstance(v, (int, float)):
                return float(v)
            if isinstance(v, complex):
                return v
            raise EvalError("num: expected a number")
        if len(args) == 2:
            a, b = args[0], args[1]
            if isinstance(a, bool) or isinstance(b, bool):
                raise EvalError("num: boolean is not a number")
            return complex(float(a), float(b))
        raise EvalError("num: expected 1 or 2 arguments")

    def __eq__(self, other: object) -> bool:
        if isinstance(other, PrimType):
            return self.name == other.name
        if isinstance(other, ast.PrimTypeRef):
            return self.name == other.name
        return False

    def __hash__(self) -> int:
        return hash(("PrimType", self.name))

    def __repr__(self) -> str:
        return f"PrimType({self.name!r})"


def is_type_value(v: Any) -> bool:
    if isinstance(v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef)):
        return True
    return isinstance(v, PrimType)


def _type_field_equal(ta: Any, tb: Any) -> bool:
    if isinstance(ta, str) and isinstance(tb, str):
        return ta == tb
    return types_equal(ta, tb)


def _func_domains_equal(a: Any, b: Any) -> bool:
    if types_equal(a, b):
        return True
    pa = _prim_from_domain_maybe(a)
    pb = _prim_from_domain_maybe(b)
    if pa is not None and pb is not None:
        return pa == pb
    return False


def _prim_from_domain_maybe(d: Any) -> str | None:
    if isinstance(d, ast.PrimTypeRef):
        return d.name
    if isinstance(d, ast.TypeExpr) and len(d.fields) == 1:
        t = d.fields[0][1]
        if isinstance(t, str):
            return t
    return None


def _codomains_equal(a: Any, b: Any) -> bool:
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, ast.FuncType) and isinstance(b, ast.FuncType):
        return types_equal(a, b)
    return False


def types_equal(a: Any, b: Any) -> bool:
    if isinstance(a, PrimType) and isinstance(b, PrimType):
        return a.name == b.name
    if isinstance(a, PrimType) and isinstance(b, ast.PrimTypeRef):
        return a.name == b.name
    if isinstance(b, PrimType) and isinstance(a, ast.PrimTypeRef):
        return b.name == a.name
    if isinstance(a, ast.PrimTypeRef) and isinstance(b, ast.PrimTypeRef):
        return a.name == b.name
    if isinstance(a, ast.TypeExpr) and isinstance(b, ast.TypeExpr):
        if len(a.fields) != len(b.fields):
            return False
        for (na, ta), (nb, tb) in zip(a.fields, b.fields):
            if na != nb:
                return False
            if not _type_field_equal(ta, tb):
                return False
        return True
    if isinstance(a, ast.TupleTypeExpr) and isinstance(b, ast.TupleTypeExpr):
        return a.elements == b.elements
    if isinstance(a, ast.FuncType) and isinstance(b, ast.FuncType):
        return _func_domains_equal(a.domain, b.domain) and _codomains_equal(
            a.codomain, b.codomain
        )
    return False


def _infer_field_type(v: Any) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int) and not isinstance(v, bool):
        return "num"
    if isinstance(v, float):
        return "num"
    if isinstance(v, complex):
        return "num"
    if isinstance(v, (bytes, bytearray)):
        return "byte"
    if isinstance(v, str):
        return "str"
    if isinstance(v, Multiset):
        return "multiset"
    if isinstance(v, list):
        return "vector"
    if isinstance(v, tuple):
        return "tuple"
    if isinstance(v, dict) and is_struct_dict(v):
        return "struct"
    return "any"


def infer_type(
    v: Any,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> Any:
    """Return a type AST or ``PrimType``-compatible value for ``v``."""
    if isinstance(v, PrimType):
        return v
    if isinstance(
        v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef)
    ):
        return v

    if type(v).__name__ == "VFunction":
        ft = getattr(v, "func_type", None)
        if ft is not None:
            return ft
        params = getattr(v, "params", [])
        fields: list[tuple[str, Any]] = []
        for p in params:
            pft = getattr(p, "param_func_type", None)
            if pft is not None:
                fields.append((p.name, pft))
            else:
                fields.append((p.name, p.type_name or "any"))
        domain: Any = (
            ast.TupleTypeExpr([])
            if not fields
            else ast.TypeExpr(fields)
        )
        return ast.FuncType(domain, "any")

    if isinstance(v, bool):
        return ast.PrimTypeRef("bool")
    if isinstance(v, int) and not isinstance(v, bool):
        return ast.PrimTypeRef("num")
    if isinstance(v, float):
        return ast.PrimTypeRef("num")
    if isinstance(v, complex):
        return ast.PrimTypeRef("num")
    if isinstance(v, (bytes, bytearray)):
        return ast.PrimTypeRef("byte")
    if isinstance(v, str):
        return ast.PrimTypeRef("str")
    if isinstance(v, list):
        return ast.PrimTypeRef("vector")
    if isinstance(v, tuple):
        if len(v) == 0:
            return ast.TupleTypeExpr([])
        return ast.TupleTypeExpr([_infer_field_type(x) for x in v])
    if isinstance(v, Multiset):
        return ast.PrimTypeRef("multiset")
    if isinstance(v, dict) and is_struct_dict(v):
        tname = get_type_name(v)
        if tname is not None and tname in type_registry:
            return type_registry[tname]
        pairs = [
            (k, _infer_field_type(v[k]))
            for k in v
            if k != VF_TYPE_KEY
        ]
        return ast.TypeExpr(pairs)
    return ast.PrimTypeRef("any")


def coerce_value(val: Any, tname: str | None) -> Any:
    if tname is None or tname == "any":
        return val
    if tname == "num":
        if isinstance(val, bool):
            raise EvalError("cannot coerce bool to num")
        if isinstance(val, (int, float, complex)):
            return float(val) if isinstance(val, (int, float)) else val
        raise EvalError(f"cannot coerce {type(val).__name__} to num")
    if tname == "str":
        return str(val)
    if tname == "byte":
        if isinstance(val, (bytes, bytearray)):
            return bytes(val)
        if isinstance(val, str):
            return val.encode("utf-8")
        raise EvalError(f"cannot coerce {type(val).__name__} to byte")
    if tname == "bool":
        return bool(val)
    return val
