"""Runtime type values (``PrimType``), ``infer_type``, and type equality for ``=``."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .. import ast
from ..errors import ErrorTypeValue, EvalError, error_type_for_exception
from .axis_tagged import AxisTaggedValue
from .collections_runtime import runtime_collection_kind
from .struct_value import (
    VF_SPILL_BASE_KEY,
    VF_TYPE_KEY,
    get_spill_base,
    get_type_name,
    is_struct_dict,
    struct_has_spill_base,
)
from .multiset import Multiset
from .typed_vector import TypedVector
from .vflist import VFLinkedList
from .vfvector import VFVector, VFVectorBuilder
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
                if isinstance(v, str):
                    return _parse_num_string(v)
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
            if isinstance(v, str):
                return _parse_int_string(v)
            raise EvalError("int: expected bool, int, or integer-valued num")
        if self.name == "str":
            if len(args) != 1:
                raise EvalError("str: expected 1 argument")
            v = args[0]
            if isinstance(v, str):
                return v
            if isinstance(v, bytes):
                return v.decode("utf-8")
            return str(v)
        if self.name == "bool":
            if len(args) != 1:
                raise EvalError("bool: expected 1 argument")
            v = args[0]
            if isinstance(v, bool):
                return v
            if isinstance(v, str):
                return _parse_bool_string(v)
            raise EvalError("bool: explicit cast only accepts bool or str")
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


def _parse_num_string(text: str) -> float | complex:
    stripped = text.strip()
    if not stripped:
        raise EvalError("cannot coerce empty str to num")
    try:
        return float(stripped)
    except ValueError:
        try:
            return complex(stripped)
        except ValueError as exc:
            raise EvalError(f"cannot coerce str {text!r} to num") from exc


def _parse_int_string(text: str) -> int:
    stripped = text.strip()
    if not stripped:
        raise EvalError("cannot coerce empty str to int")
    try:
        return int(stripped)
    except ValueError:
        try:
            as_num = float(stripped)
        except ValueError as exc:
            raise EvalError(f"cannot coerce str {text!r} to int") from exc
        if as_num != int(as_num):
            raise EvalError("int: explicit cast from str requires an integer-valued number")
        return int(as_num)


def _parse_bool_string(text: str) -> bool:
    stripped = text.strip().lower()
    if stripped == "true":
        return True
    if stripped == "false":
        return False
    raise EvalError("bool: explicit cast from str requires 'true' or 'false'")


def is_type_value(v: Any) -> bool:
    if isinstance(v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec, ast.MapValueType, ast.LinkedListValueType)):
        return True
    if isinstance(v, type) and isinstance(getattr(v, "__vf_event_type_name__", None), str):
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


def _flatten_union_members(node: Any) -> list[Any]:
    if isinstance(node, ast.TypeUnionExpr):
        out: list[Any] = []
        for member in node.members:
            out.extend(_flatten_union_members(member))
        return out
    return [node]


def _flatten_intersection_members(node: Any) -> list[Any]:
    if isinstance(node, ast.TypeIntersectionExpr):
        out: list[Any] = []
        for member in node.members:
            out.extend(_flatten_intersection_members(member))
        return out
    return [node]


def _unordered_type_member_list_equal(a_members: list[Any], b_members: list[Any]) -> bool:
    if len(a_members) != len(b_members):
        return False
    used = [False] * len(b_members)
    for am in a_members:
        found = False
        for idx, bm in enumerate(b_members):
            if used[idx]:
                continue
            if types_equal(am, bm):
                used[idx] = True
                found = True
                break
        if not found:
            return False
    return True


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
    if isinstance(a, ast.TypeUnionExpr) and isinstance(b, ast.TypeUnionExpr):
        return _unordered_type_member_list_equal(
            _flatten_union_members(a),
            _flatten_union_members(b),
        )
    if isinstance(a, ast.TypeIntersectionExpr) and isinstance(b, ast.TypeIntersectionExpr):
        return _unordered_type_member_list_equal(
            _flatten_intersection_members(a),
            _flatten_intersection_members(b),
        )
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


def _resolve_named_type_once(
    type_expr: Any,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> Any:
    if isinstance(type_expr, PrimType):
        return ast.PrimTypeRef(type_expr.name)
    if isinstance(type_expr, ast.NamedTypeSpec):
        return type_expr.type_expr
    if isinstance(type_expr, ast.PrimTypeRef):
        resolved = type_registry.get(type_expr.name)
        if resolved is not None and not isinstance(resolved, ast.FuncType):
            return resolved
    if isinstance(type_expr, ast.TypeUnionExpr):
        return ast.TypeUnionExpr(
            [normalize_type_expr(member, type_registry) for member in type_expr.members]
        )
    if isinstance(type_expr, ast.TypeIntersectionExpr):
        return ast.TypeIntersectionExpr(
            [normalize_type_expr(member, type_registry) for member in type_expr.members]
        )
    return type_expr


def normalize_type_expr(
    type_expr: Any,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> Any:
    if isinstance(type_expr, type):
        host_name = getattr(type_expr, "__vf_event_type_name__", None)
        if isinstance(host_name, str):
            return ast.PrimTypeRef(host_name)
    seen: set[tuple[str, str]] = set()
    current = type_expr
    while True:
        key = (type(current).__name__, repr(current))
        if key in seen:
            return current
        seen.add(key)
        nxt = _resolve_named_type_once(current, type_registry)
        if nxt is current:
            return current
        current = nxt


def _prim_match_specificity(actual: str, pattern: str) -> int | None:
    if actual == pattern:
        return 100
    if pattern == "any":
        return 1
    if pattern == "num" and actual == "int":
        return 40
    if pattern == "vector" and actual == "vector":
        return 100
    if pattern == "multiset" and actual == "multiset":
        return 100
    if pattern == "tuple" and actual == "tuple":
        return 100
    if pattern == "struct" and actual == "struct":
        return 100
    if pattern == "map" and actual == "map":
        return 100
    if pattern == "list" and actual == "list":
        return 100
    event_supertypes = {
        "MouseMove": ("MouseEvent",),
        "MouseHover": ("MouseEvent",),
        "MouseDown": ("MouseEvent",),
        "MouseUp": ("MouseEvent",),
        "MouseWheel": ("MouseEvent",),
        "MouseDrag": ("MouseEvent",),
        "FrameEvent": ("any",),
        "FrameClosed": ("FrameEvent",),
        "FrameDocked": ("FrameEvent",),
        "FrameDragged": ("FrameEvent",),
        "FrameResized": ("FrameEvent",),
        "TouchEvent": ("any",),
        "MouseEvent": ("any",),
        "KeyboardEvent": ("any",),
        "KeyEvent": ("KeyboardEvent",),
        "KeyDown": ("KeyboardEvent", "KeyEvent"),
        "KeyUp": ("KeyboardEvent", "KeyEvent"),
    }
    for idx, super_name in enumerate(event_supertypes.get(actual, ()), start=1):
        if pattern == super_name:
            return max(2, 80 - idx * 10)
    return None


def _ordered_field_subset_match(
    actual_fields: list[tuple[str, Any]],
    pattern_fields: list[tuple[str, Any]],
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> int | None:
    if len(pattern_fields) > len(actual_fields):
        return None
    pos = 0
    score = 0
    for pname, ptype in pattern_fields:
        found = False
        while pos < len(actual_fields):
            aname, atype = actual_fields[pos]
            pos += 1
            if aname != pname:
                continue
            nested = type_match_specificity(atype, ptype, type_registry)
            if nested is None:
                return None
            score += 10 + nested
            found = True
            break
        if not found:
            return None
    return score


def _collapse_union_members(
    members: list[Any],
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> list[Any]:
    out: list[Any] = []
    for member in members:
        norm = normalize_type_expr(member, type_registry)
        if isinstance(norm, ast.TypeUnionExpr):
            for inner in _collapse_union_members(norm.members, type_registry):
                if not any(types_equal(inner, existing) for existing in out):
                    out.append(inner)
            continue
        if not any(types_equal(norm, existing) for existing in out):
            out.append(norm)
    return out


def _collapse_intersection_members(
    members: list[Any],
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> list[Any]:
    out: list[Any] = []
    for member in members:
        norm = normalize_type_expr(member, type_registry)
        if isinstance(norm, ast.TypeIntersectionExpr):
            for inner in _collapse_intersection_members(norm.members, type_registry):
                if not any(types_equal(inner, existing) for existing in out):
                    out.append(inner)
            continue
        if not any(types_equal(norm, existing) for existing in out):
            out.append(norm)
    return out


def type_match_specificity(
    actual: Any,
    pattern: Any,
    type_registry: dict[str, ast.TypeExpr | ast.FuncType],
) -> int | None:
    actual = normalize_type_expr(actual, type_registry)
    pattern = normalize_type_expr(pattern, type_registry)
    if types_equal(actual, pattern):
        return 1_000

    if isinstance(pattern, ast.TypeUnionExpr):
        best: int | None = None
        for member in _collapse_union_members(pattern.members, type_registry):
            score = type_match_specificity(actual, member, type_registry)
            if score is None:
                continue
            candidate = score - 25
            if best is None or candidate > best:
                best = candidate
        return best

    if isinstance(pattern, ast.TypeIntersectionExpr):
        scores: list[int] = []
        for member in _collapse_intersection_members(pattern.members, type_registry):
            score = type_match_specificity(actual, member, type_registry)
            if score is None:
                return None
            scores.append(score)
        return 250 + sum(scores)

    if isinstance(actual, ast.TypeUnionExpr):
        scores: list[int] = []
        for member in _collapse_union_members(actual.members, type_registry):
            score = type_match_specificity(member, pattern, type_registry)
            if score is None:
                return None
            scores.append(score)
        return min(scores) - 25 if scores else None

    if isinstance(actual, ast.TypeIntersectionExpr):
        best: int | None = None
        member_scores: list[int] = []
        for member in _collapse_intersection_members(actual.members, type_registry):
            score = type_match_specificity(member, pattern, type_registry)
            if score is not None:
                member_scores.append(score)
                if best is None or score > best:
                    best = score
        if best is None:
            return None
        return best + 25 + len(member_scores)

    if isinstance(actual, ast.PrimTypeRef) and isinstance(pattern, ast.PrimTypeRef):
        return _prim_match_specificity(actual.name, pattern.name)

    if isinstance(actual, ast.FixedVectorType):
        if isinstance(pattern, ast.PrimTypeRef):
            return _prim_match_specificity("vector", pattern.name)
        if isinstance(pattern, ast.FixedVectorType):
            if not types_equal(actual.size, pattern.size):
                return None
            nested = type_match_specificity(actual.element_type, pattern.element_type, type_registry)
            if nested is None:
                return None
            return 200 + nested

    if isinstance(actual, ast.MultisetType):
        if isinstance(pattern, ast.PrimTypeRef):
            return _prim_match_specificity("multiset", pattern.name)
        if isinstance(pattern, ast.MultisetType):
            nested = type_match_specificity(actual.element_type, pattern.element_type, type_registry)
            if nested is None:
                return None
            return 180 + nested

    if isinstance(actual, ast.TupleTypeExpr):
        if isinstance(pattern, ast.PrimTypeRef):
            return _prim_match_specificity("tuple", pattern.name)
        if isinstance(pattern, ast.TupleTypeExpr):
            if len(actual.elements) != len(pattern.elements):
                return None
            nested_scores: list[int] = []
            for av, pv in zip(actual.elements, pattern.elements):
                nested = type_match_specificity(av, pv, type_registry)
                if nested is None:
                    return None
                nested_scores.append(nested)
            return 150 + sum(nested_scores)

    if isinstance(actual, ast.TypeExpr):
        if isinstance(pattern, ast.PrimTypeRef):
            return _prim_match_specificity("struct", pattern.name)
        if isinstance(pattern, ast.TypeExpr):
            score = _ordered_field_subset_match(actual.fields, pattern.fields, type_registry)
            if score is None:
                return None
            return 220 + score

    if isinstance(actual, ast.MapValueType):
        if isinstance(pattern, ast.PrimTypeRef):
            return _prim_match_specificity("map", pattern.name)
        if isinstance(pattern, ast.MapValueType):
            score = _ordered_field_subset_match(actual.fields, pattern.fields, type_registry)
            if score is None:
                return None
            return 140 + score

    if isinstance(actual, ast.LinkedListValueType):
        if isinstance(pattern, ast.PrimTypeRef):
            return _prim_match_specificity("list", pattern.name)
        if isinstance(pattern, ast.LinkedListValueType):
            if len(actual.elements) != len(pattern.elements):
                return None
            nested_scores: list[int] = []
            for av, pv in zip(actual.elements, pattern.elements):
                nested = type_match_specificity(av, pv, type_registry)
                if nested is None:
                    return None
                nested_scores.append(nested)
            return 130 + sum(nested_scores)

    if isinstance(actual, ast.FuncType) and isinstance(pattern, ast.FuncType):
        if not types_equal(actual, pattern):
            return None
        return 900

    return None


def _is_host_vector_input(v: Any) -> bool:
    return isinstance(v, Sequence) and not isinstance(v, (str, bytes, bytearray, tuple, VFVector))


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
    if isinstance(v, VFVector):
        return "vector"
    if _is_host_vector_input(v):
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
        v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec, ast.MapValueType, ast.LinkedListValueType)
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

    if isinstance(v, AxisTaggedValue):
        return infer_type(v.data, type_registry)
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
    host_event_name = getattr(type(v), "__vf_event_type_name__", None)
    if isinstance(host_event_name, str):
        return ast.PrimTypeRef(host_event_name)
    if isinstance(v, VFVector):
        if isinstance(v, TypedVector) and v.vf_type_expr is not None:
            return v.vf_type_expr
        if not v:
            return ast.PrimTypeRef("vector")
        elem_type = infer_type(v[0], type_registry)
        if all(types_equal(infer_type(item, type_registry), elem_type) for item in v[1:]):
            return ast.FixedVectorType(elem_type, ast.TypeSizeConst(len(v)))
        return ast.PrimTypeRef("vector")
    if _is_host_vector_input(v):
        seq = tuple(v)
        if not seq:
            return ast.PrimTypeRef("vector")
        elem_type = infer_type(seq[0], type_registry)
        if all(types_equal(infer_type(item, type_registry), elem_type) for item in seq[1:]):
            return ast.FixedVectorType(elem_type, ast.TypeSizeConst(len(seq)))
        return ast.PrimTypeRef("vector")
    if isinstance(v, tuple):
        if len(v) == 0:
            return ast.TupleTypeExpr([])
        return ast.TupleTypeExpr([infer_type(x, type_registry) for x in v])
    collection_kind = runtime_collection_kind(v)
    if collection_kind == "multiset":
        if getattr(v, "vf_type_expr", None) is not None:
            return v.vf_type_expr
        keys = list(getattr(v, "_c", {}).keys())
        if not keys:
            return ast.PrimTypeRef("multiset")
        elem_type = infer_type(keys[0], type_registry)
        if all(types_equal(infer_type(item, type_registry), elem_type) for item in keys[1:]):
            return ast.MultisetType(elem_type)
        return ast.PrimTypeRef("multiset")
    if collection_kind == "map":
        return ast.MapValueType([(k, infer_type(val, type_registry)) for k, val in v.items()])
    if collection_kind == "list":
        return ast.LinkedListValueType([infer_type(item, type_registry) for item in v])
    if isinstance(v, dict) and is_struct_dict(v):
        if struct_has_spill_base(v):
            base_type = infer_type(get_spill_base(v), type_registry)
            tname = get_type_name(v)
            if tname is not None and tname in type_registry:
                return ast.TypeIntersectionExpr([type_registry[tname], base_type])
            return base_type
        tname = get_type_name(v)
        if tname is not None and tname in type_registry:
            return type_registry[tname]
        pairs = [
            (k, infer_type(v[k], type_registry))
            for k in v
            if k not in (VF_TYPE_KEY, VF_SPILL_BASE_KEY)
        ]
        return ast.TypeExpr(pairs)
    return ast.PrimTypeRef("any")


def coerce_value(val: Any, tname: str | None) -> Any:
    if isinstance(val, dict) and struct_has_spill_base(val):
        val = get_spill_base(val)
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
        if isinstance(val, str):
            return _parse_num_string(val)
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
    if not isinstance(val, (tuple, VFVector)) and not _is_host_vector_input(val):
        raise EvalError("expected a tuple-like value")
    seq = tuple(val)
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
    if not isinstance(val, (tuple, VFVector)) and not _is_host_vector_input(val):
        raise EvalError("expected a vector-like value")
    seq = tuple(val)
    _bind_type_size(type_expr.size, len(seq), size_bindings)
    out = VFVectorBuilder(len(seq))
    for item in seq:
        coerced, size_bindings = coerce_typed_value(
            item, type_expr.element_type, type_registry, size_bindings
        )
        out.append(coerced)
    resolved = resolve_return_type(type_expr, size_bindings)
    return TypedVector(out.build(), resolved)


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
    if isinstance(type_expr, ast.TypeUnionExpr):
        errors: list[str] = []
        for member in _collapse_union_members(type_expr.members, type_registry):
            trial_bindings = dict(size_bindings)
            try:
                coerced, new_bindings = coerce_typed_value(val, member, type_registry, trial_bindings)
                size_bindings.clear()
                size_bindings.update(new_bindings)
                return coerced, size_bindings
            except EvalError as exc:
                errors.append(str(exc))
        raise EvalError("value does not match any type-union branch")
    if isinstance(type_expr, ast.TypeIntersectionExpr):
        current = val
        for member in _collapse_intersection_members(type_expr.members, type_registry):
            current, size_bindings = coerce_typed_value(current, member, type_registry, size_bindings)
        return current, size_bindings
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
    if isinstance(type_expr, ast.TypeUnionExpr):
        return ast.TypeUnionExpr(
            [resolve_return_type(member, size_bindings) for member in type_expr.members]
        )
    if isinstance(type_expr, ast.TypeIntersectionExpr):
        return ast.TypeIntersectionExpr(
            [resolve_return_type(member, size_bindings) for member in type_expr.members]
        )
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


def wrap_typed_vector_result(values: Sequence[Any] | Any, type_expr: ast.FixedVectorType | None) -> VFVector:
    if type_expr is None:
        return VFVector(values)
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
