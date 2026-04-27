"""Runtime type values (``PrimType``), ``infer_type``, and type equality for ``=``."""

from __future__ import annotations

from typing import Any

from .. import ast
from ..errors import ErrorTypeValue, EvalError, error_type_for_exception
from .collections_runtime import runtime_collection_kind
from .struct_value import VF_TYPE_KEY, get_type_name, is_struct_dict
from .multiset import Multiset
from .typed_vector import TypedVector
from .vflist import VFLinkedList
from .vmap import VMap


class PrimType:
    """Builtin type object: ``int``, ``num``, ``str``, ``byte``, ``bytes``, ``bool``, ``any``."""

    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name

    def __call__(self, *args: Any) -> Any:
        if self.name == "num":
            if len(args) == 1:
                v = args[0]
                if isinstance(v, bool):
                    return 1.0 if v else 0.0
                if isinstance(v, (int, float)):
                    return float(v)
                if isinstance(v, complex):
                    return v
                raise EvalError("num: expected a numeric value")
            if len(args) == 2:
                a, b = args[0], args[1]
                if isinstance(a, bool):
                    a = 1 if a else 0
                if isinstance(b, bool):
                    b = 1 if b else 0
                return complex(float(a), float(b))
            raise EvalError("num: expected 1 or 2 arguments")
        if self.name == "int":
            if len(args) != 1:
                raise EvalError("int: expected 1 argument")
            v = args[0]
            if isinstance(v, bool):
                return 1 if v else 0
            if isinstance(v, int) and not isinstance(v, bool):
                return int(v)
            if isinstance(v, float):
                if v != int(v):
                    raise EvalError("int: explicit cast from num requires an integer-valued number")
                return int(v)
            raise EvalError("int: expected bool, int, or integer-valued num")
        if self.name == "bytes":
            if len(args) != 1:
                raise EvalError("bytes: expected 1 argument")
            v = args[0]
            if isinstance(v, (bytes, bytearray)):
                return bytes(v)
            if isinstance(v, str):
                return v.encode("utf-8")
            raise EvalError("bytes: expected bytes or str")
        raise EvalError(f"type {self.name!r} is not callable")

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
    if isinstance(v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec, ast.MapValueType, ast.LinkedListValueType)):
        return True
    return isinstance(v, (PrimType, ErrorTypeValue))


def _type_field_equal(ta: Any, tb: Any) -> bool:
    if isinstance(ta, str) and isinstance(tb, str):
        return ta == tb
    if isinstance(ta, str) and isinstance(tb, ast.PrimTypeRef):
        return ta == tb.name
    if isinstance(tb, str) and isinstance(ta, ast.PrimTypeRef):
        return tb == ta.name
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
    if isinstance(a, ast.PrimTypeRef) and isinstance(b, ast.PrimTypeRef):
        return a.name == b.name
    if isinstance(a, ast.FuncType) and isinstance(b, ast.FuncType):
        return types_equal(a, b)
    return False


def types_equal(a: Any, b: Any) -> bool:
    if isinstance(a, ErrorTypeValue) and isinstance(b, ErrorTypeValue):
        return a.name == b.name and a.mask == b.mask
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
        if len(a.elements) != len(b.elements):
            return False
        return all(types_equal(x, y) for x, y in zip(a.elements, b.elements))
    if isinstance(a, ast.FixedVectorType) and isinstance(b, ast.FixedVectorType):
        return types_equal(a.element_type, b.element_type) and types_equal(a.size, b.size)
    if isinstance(a, ast.MultisetType) and isinstance(b, ast.MultisetType):
        return types_equal(a.element_type, b.element_type)
    if isinstance(a, ast.MapValueType) and isinstance(b, ast.MapValueType):
        if len(a.fields) != len(b.fields):
            return False
        for (na, ta), (nb, tb) in zip(a.fields, b.fields):
            if na != nb or not types_equal(ta, tb):
                return False
        return True
    if isinstance(a, ast.LinkedListValueType) and isinstance(b, ast.LinkedListValueType):
        if len(a.elements) != len(b.elements):
            return False
        return all(types_equal(x, y) for x, y in zip(a.elements, b.elements))
    if isinstance(a, ast.NamedTypeSpec) and isinstance(b, ast.NamedTypeSpec):
        return a.name == b.name and types_equal(a.type_expr, b.type_expr)
    if isinstance(a, ast.TypeSizeConst) and isinstance(b, ast.TypeSizeConst):
        return a.value == b.value
    if isinstance(a, ast.TypeSizeVar) and isinstance(b, ast.TypeSizeVar):
        return a.name == b.name
    if isinstance(a, ast.TypeSizeBinOp) and isinstance(b, ast.TypeSizeBinOp):
        return a.op == b.op and types_equal(a.left, b.left) and types_equal(a.right, b.right)
    if isinstance(a, ast.FuncType) and isinstance(b, ast.FuncType):
        return _func_domains_equal(a.domain, b.domain) and _codomains_equal(
            a.codomain, b.codomain
        )
    return False


def _infer_field_type(v: Any) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int) and not isinstance(v, bool):
        return "int"
    if isinstance(v, float):
        return "num"
    if isinstance(v, complex):
        return "num"
    if isinstance(v, (bytes, bytearray)):
        return "bytes"
    if isinstance(v, str):
        return "str"
    if isinstance(v, Multiset):
        return "multiset"
    if isinstance(v, list):
        if isinstance(v, TypedVector) and v.vf_type_expr is not None:
            return "vector"
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
    if isinstance(v, ErrorTypeValue):
        return v
    if isinstance(
        v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec, ast.MapValueType, ast.LinkedListValueType)
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
                pref = getattr(p, "type_ref", None)
                fields.append((p.name, pref if pref is not None else (p.type_name or "any")))
        domain: Any = (
            ast.TupleTypeExpr([])
            if not fields
            else ast.TypeExpr(fields)
        )
        return ast.FuncType(domain, ast.PrimTypeRef("any"))

    if isinstance(v, bool):
        return ast.PrimTypeRef("bool")
    if isinstance(v, int) and not isinstance(v, bool):
        return ast.PrimTypeRef("int")
    if isinstance(v, float):
        return ast.PrimTypeRef("num")
    if isinstance(v, complex):
        return ast.PrimTypeRef("num")
    if isinstance(v, BaseException):
        return error_type_for_exception(v)
    if isinstance(v, (bytes, bytearray)):
        return ast.PrimTypeRef("bytes")
    if isinstance(v, str):
        return ast.PrimTypeRef("str")
    if isinstance(v, list):
        if isinstance(v, TypedVector) and v.vf_type_expr is not None:
            return v.vf_type_expr
        if not v:
            return ast.PrimTypeRef("vector")
        elem_type = infer_type(v[0], type_registry)
        if all(types_equal(infer_type(item, type_registry), elem_type) for item in v[1:]):
            return ast.FixedVectorType(elem_type, ast.TypeSizeConst(len(v)))
        return ast.PrimTypeRef("vector")
    if isinstance(v, tuple):
        if len(v) == 0:
            return ast.TupleTypeExpr([])
        return ast.TupleTypeExpr([infer_type(x, type_registry) for x in v])
    collection_kind = runtime_collection_kind(v)
    if collection_kind == "multiset":
        if getattr(v, "vf_type_expr", None) is not None:
            return v.vf_type_expr
        return ast.PrimTypeRef("multiset")
    if collection_kind == "map":
        return ast.MapValueType([(k, infer_type(val, type_registry)) for k, val in v.items()])
    if collection_kind == "list":
        return ast.LinkedListValueType([infer_type(item, type_registry) for item in v])
    if isinstance(v, dict) and is_struct_dict(v):
        tname = get_type_name(v)
        if tname is not None and tname in type_registry:
            return type_registry[tname]
        pairs = [
            (k, infer_type(v[k], type_registry))
            for k in v
            if k != VF_TYPE_KEY
        ]
        return ast.TypeExpr(pairs)
    return ast.PrimTypeRef("any")


def coerce_value(val: Any, tname: str | None) -> Any:
    if tname is None or tname == "any":
        return val
    if tname == "int":
        if isinstance(val, bool):
            return 1 if val else 0
        if isinstance(val, int) and not isinstance(val, bool):
            return int(val)
        raise EvalError(f"cannot implicitly coerce {type(val).__name__} to int")
    if tname == "num":
        if isinstance(val, bool):
            return 1.0 if val else 0.0
        if isinstance(val, (int, float, complex)):
            return float(val) if isinstance(val, (int, float)) else val
        raise EvalError(f"cannot coerce {type(val).__name__} to num")
    if tname == "str":
        if isinstance(val, str):
            return val
        raise EvalError(f"cannot implicitly coerce {type(val).__name__} to str")
    if tname == "byte":
        if isinstance(val, int) and not isinstance(val, bool):
            if 0 <= val <= 255:
                return int(val)
            raise EvalError("cannot coerce int outside 0..255 to byte")
        raise EvalError(f"cannot coerce {type(val).__name__} to byte")
    if tname == "bytes":
        if isinstance(val, (bytes, bytearray)):
            return bytes(val)
        if isinstance(val, str):
            return val.encode("utf-8")
        raise EvalError(f"cannot coerce {type(val).__name__} to bytes")
    if tname == "bool":
        if isinstance(val, bool):
            return val
        raise EvalError(f"cannot implicitly coerce {type(val).__name__} to bool")
    return val


def _eval_type_size(expr: Any, bindings: dict[str, int]) -> int:
    if isinstance(expr, ast.TypeSizeConst):
        return expr.value
    if isinstance(expr, ast.TypeSizeVar):
        if expr.name not in bindings:
            raise EvalError(f"unbound type size symbol: {expr.name}")
        return bindings[expr.name]
    if isinstance(expr, ast.TypeSizeBinOp):
        left = _eval_type_size(expr.left, bindings)
        right = _eval_type_size(expr.right, bindings)
        if expr.op == "+":
            return left + right
        if expr.op == "-":
            return left - right
        raise EvalError(f"unsupported type size operator: {expr.op}")
    raise EvalError(f"invalid type size expression: {type(expr).__name__}")


def _bind_type_size(expr: Any, actual: int, bindings: dict[str, int]) -> None:
    if actual < 0:
        raise EvalError("type sizes must be non-negative")
    if isinstance(expr, ast.TypeSizeConst):
        if expr.value != actual:
            raise EvalError(f"expected size {expr.value}, got {actual}")
        return
    if isinstance(expr, ast.TypeSizeVar):
        prev = bindings.get(expr.name)
        if prev is None:
            bindings[expr.name] = actual
            return
        if prev != actual:
            raise EvalError(f"type size symbol {expr.name} expected {prev}, got {actual}")
        return
    expected = _eval_type_size(expr, bindings)
    if expected != actual:
        raise EvalError(f"expected size {expected}, got {actual}")


def _coerce_struct_value(
    val: Any,
    type_expr: ast.TypeExpr,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
    size_bindings: dict[str, int],
) -> Any:
    if not isinstance(val, dict) or not is_struct_dict(val):
        raise EvalError("expected a structured value")
    out: dict[str, Any] = {}
    for name, field_type in type_expr.fields:
        if name not in val:
            raise EvalError(f"missing field {name!r}")
        coerced, size_bindings = coerce_typed_value(
            val[name], field_type, type_registry, size_bindings
        )
        out[name] = coerced
    from .struct_value import with_type

    tname = get_type_name(val)
    return with_type(tname, out)


def _coerce_tuple_value(
    val: Any,
    type_expr: ast.TupleTypeExpr,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
    size_bindings: dict[str, int],
) -> tuple[Any, ...]:
    if not isinstance(val, (tuple, list)):
        raise EvalError("expected a tuple-like value")
    seq = list(val)
    if len(seq) != len(type_expr.elements):
        raise EvalError(f"expected tuple length {len(type_expr.elements)}, got {len(seq)}")
    out: list[Any] = []
    for item, item_type in zip(seq, type_expr.elements):
        coerced, size_bindings = coerce_typed_value(item, item_type, type_registry, size_bindings)
        out.append(coerced)
    return tuple(out)


def _coerce_fixed_vector_value(
    val: Any,
    type_expr: ast.FixedVectorType,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
    size_bindings: dict[str, int],
) -> Any:
    if not isinstance(val, (list, tuple)):
        raise EvalError("expected a vector-like value")
    seq = list(val)
    _bind_type_size(type_expr.size, len(seq), size_bindings)
    out: list[Any] = []
    for item in seq:
        coerced, size_bindings = coerce_typed_value(
            item, type_expr.element_type, type_registry, size_bindings
        )
        out.append(coerced)
    resolved = resolve_return_type(type_expr, size_bindings)
    if isinstance(val, tuple):
        return tuple(out)
    return TypedVector(out, resolved)


def coerce_typed_value(
    val: Any,
    type_expr: Any,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
    size_bindings: dict[str, int] | None = None,
) -> tuple[Any, dict[str, int]]:
    if size_bindings is None:
        size_bindings = {}
    if isinstance(type_expr, ast.NamedTypeSpec):
        return coerce_typed_value(val, type_expr.type_expr, type_registry, size_bindings)
    if isinstance(type_expr, PrimType):
        return coerce_value(val, type_expr.name), size_bindings
    if isinstance(type_expr, ast.PrimTypeRef):
        if type_expr.name in type_registry and not isinstance(type_registry[type_expr.name], ast.FuncType):
            return coerce_typed_value(val, type_registry[type_expr.name], type_registry, size_bindings)
        return coerce_value(val, type_expr.name), size_bindings
    if isinstance(type_expr, ast.FixedVectorType):
        return _coerce_fixed_vector_value(val, type_expr, type_registry, size_bindings), size_bindings
    if isinstance(type_expr, ast.MultisetType):
        if not isinstance(val, Multiset):
            raise EvalError("expected a multiset value")
        out: list[tuple[Any, int]] = []
        for elem, count in val._c.items():
            coerced, size_bindings = coerce_typed_value(elem, type_expr.element_type, type_registry, size_bindings)
            out.append((coerced, count))
        ms = Multiset.from_pairs(out)
        ms.vf_type_expr = resolve_return_type(type_expr, size_bindings)
        return ms, size_bindings
    if isinstance(type_expr, ast.TypeExpr):
        return _coerce_struct_value(val, type_expr, type_registry, size_bindings), size_bindings
    if isinstance(type_expr, ast.TupleTypeExpr):
        return _coerce_tuple_value(val, type_expr, type_registry, size_bindings), size_bindings
    if isinstance(type_expr, ast.FuncType):
        ft = infer_type(val, type_registry)
        if not types_equal(ft, type_expr):
            raise EvalError("function value does not match the declared type")
        return val, size_bindings
    return val, size_bindings


def resolve_return_type(type_expr: Any, size_bindings: dict[str, int]) -> Any:
    if isinstance(type_expr, ast.NamedTypeSpec):
        return resolve_return_type(type_expr.type_expr, size_bindings)
    if isinstance(type_expr, ast.FixedVectorType):
        return ast.FixedVectorType(
            resolve_return_type(type_expr.element_type, size_bindings),
            ast.TypeSizeConst(_eval_type_size(type_expr.size, size_bindings)),
        )
    if isinstance(type_expr, ast.MultisetType):
        return ast.MultisetType(resolve_return_type(type_expr.element_type, size_bindings))
    if isinstance(type_expr, ast.TypeExpr):
        return ast.TypeExpr(
            [(name, resolve_return_type(inner, size_bindings)) for name, inner in type_expr.fields]
        )
    if isinstance(type_expr, ast.TupleTypeExpr):
        return ast.TupleTypeExpr([resolve_return_type(inner, size_bindings) for inner in type_expr.elements])
    return type_expr


def typed_vector_type_of(val: Any) -> ast.FixedVectorType | None:
    if isinstance(val, TypedVector) and isinstance(val.vf_type_expr, ast.FixedVectorType):
        return val.vf_type_expr
    return None


def _resolved_size_of(type_expr: ast.FixedVectorType) -> int | None:
    if isinstance(type_expr.size, ast.TypeSizeConst):
        return type_expr.size.value
    return None


def combine_typed_vector_types(op: str, a: Any, b: Any) -> ast.FixedVectorType | None:
    ta = typed_vector_type_of(a)
    tb = typed_vector_type_of(b)
    if op == "AMPERSAND" and ta is not None and tb is not None:
        sa = _resolved_size_of(ta)
        sb = _resolved_size_of(tb)
        if sa is None or sb is None:
            return None
        if not types_equal(ta.element_type, tb.element_type):
            return None
        return ast.FixedVectorType(ta.element_type, ast.TypeSizeConst(sa + sb))
    if op in ("PLUS", "MINUS", "STAR", "SLASH"):
        if ta is not None and tb is not None:
            sa = _resolved_size_of(ta)
            sb = _resolved_size_of(tb)
            if sa is None or sb is None or sa != sb:
                return None
            if not types_equal(ta.element_type, tb.element_type):
                return None
            return ta
    if op == "STAR":
        if ta is not None and isinstance(b, (bool, int, float, complex)):
            return ta
        if tb is not None and isinstance(a, (bool, int, float, complex)):
            return tb
    return None


def wrap_typed_vector_result(values: list[Any], type_expr: ast.FixedVectorType | None) -> list[Any]:
    if type_expr is None:
        return values
    return TypedVector(values, type_expr)


def typed_multiset_type_of(val: Any) -> ast.MultisetType | None:
    if isinstance(val, Multiset) and isinstance(getattr(val, "vf_type_expr", None), ast.MultisetType):
        return val.vf_type_expr
    return None


def combine_typed_multiset_types(a: Any, b: Any) -> ast.MultisetType | None:
    ta = typed_multiset_type_of(a)
    tb = typed_multiset_type_of(b)
    if ta is None or tb is None:
        return None
    if not types_equal(ta.element_type, tb.element_type):
        return None
    return ta


def wrap_typed_multiset_result(value: Multiset, type_expr: ast.MultisetType | None) -> Multiset:
    if type_expr is None:
        return value
    value.vf_type_expr = type_expr
    return value
