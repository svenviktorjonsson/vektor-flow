"""Builtin type-member surface.

Two layers:
- callable surface on the type object itself, e.g. ``(1.).size(1)``
- reflective metadata surface for ``(:1.)`` / ``[:1.]`` / ``{:1.}``
"""

from __future__ import annotations

from typing import Any

from .. import ast
from ..errors import EvalError
from .collections_runtime import (
    make_vflist,
    make_vfqueue,
    make_vmap,
    runtime_collection_kind,
    runtime_collection_read_attr,
    runtime_object_length,
    runtime_object_size_bits,
)
from .char_value import VFChr
from .multiset import Multiset
from .type_values import PrimType
from .vfvector import VFVector


def _type_expr_from_value(value: Any) -> Any | None:
    if isinstance(value, ast.NamedTypeSpec):
        return value.type_expr
    if isinstance(value, (PrimType, ast.PrimTypeRef)):
        return ast.PrimTypeRef(value.name)
    if isinstance(
        value,
        (
            ast.TypeExpr,
            ast.FuncType,
            ast.TupleTypeExpr,
            ast.TypeUnionExpr,
            ast.TypeIntersectionExpr,
            ast.FixedVectorType,
            ast.MultisetType,
            ast.MapValueType,
            ast.LinkedListValueType,
        ),
    ):
        return value
    return None


def _exemplar_for_type_value(value: Any) -> Any | None:
    type_expr = _type_expr_from_value(value)
    if isinstance(type_expr, ast.PrimTypeRef):
        name = type_expr.name
        if name == "int":
            return 0
        if name == "num":
            return 0j
        if name == "bit":
            return False
        if name == "chr":
            return VFChr("\0")
        if name == "str":
            return ""
        if name == "tuple":
            return ()
        if name == "vector":
            return VFVector()
        if name == "multiset":
            return Multiset()
        if name == "map":
            return make_vmap()
        if name == "list":
            return make_vflist()
        if name == "queue":
            return make_vfqueue()
        if name == "struct":
            return {}
        return None
    if isinstance(type_expr, ast.FixedVectorType):
        return VFVector()
    if isinstance(type_expr, ast.MultisetType):
        return Multiset()
    if isinstance(type_expr, ast.TupleTypeExpr):
        return ()
    if isinstance(type_expr, ast.MapValueType):
        return make_vmap()
    if isinstance(type_expr, ast.LinkedListValueType):
        return make_vflist()
    if isinstance(type_expr, ast.TypeExpr):
        return {}
    return None


def _size_return_type() -> Any:
    return ast.PrimTypeRef("int")


def _bool_return_type() -> Any:
    return ast.PrimTypeRef("bit")


def _length_return_type() -> Any:
    return ast.PrimTypeRef("int")


def _count_return_type() -> Any:
    return ast.PrimTypeRef("int")


def _shape_return_type() -> Any:
    return ast.TupleTypeExpr([ast.PrimTypeRef("int")])


def _any_type() -> Any:
    return ast.PrimTypeRef("any")


def _func_type(param_pairs: list[tuple[str, Any]], codomain: Any) -> ast.FuncType:
    if not param_pairs:
        domain: Any = ast.TupleTypeExpr([])
    else:
        domain = ast.TypeExpr(param_pairs)
    return ast.FuncType(domain, codomain)


def runtime_type_surface_metadata(value: Any) -> dict[str, Any] | None:
    type_expr = _type_expr_from_value(value)
    exemplar = _exemplar_for_type_value(value)
    if type_expr is None or exemplar is None:
        return None

    fields: dict[str, Any] = {
        "size": _func_type([("value", type_expr)], _size_return_type()),
    }

    if runtime_object_length(exemplar) is not None:
        fields["length"] = _func_type([("value", type_expr)], _length_return_type())

    is_container_like = isinstance(exemplar, (str, bytes, bytearray, tuple, VFVector))
    kind = runtime_collection_kind(exemplar)
    if kind in {"multiset", "map", "list", "queue"}:
        is_container_like = True
    if is_container_like:
        fields["has"] = _func_type([("value", type_expr), ("item", _any_type())], _bool_return_type())
        fields["count"] = _func_type([("value", type_expr), ("item", _any_type())], _count_return_type())

    if isinstance(exemplar, VFVector):
        fields["shape"] = _func_type([("value", type_expr)], _shape_return_type())
        fields["ndim"] = _func_type([("value", type_expr)], _length_return_type())

    if isinstance(exemplar, str):
        fields["is_num"] = _func_type([("value", type_expr)], _bool_return_type())
        fields["is_int"] = _func_type([("value", type_expr)], _bool_return_type())
        fields["is_bool"] = _func_type([("value", type_expr)], _bool_return_type())

    if kind == "queue":
        fields["put"] = _func_type([("value", type_expr), ("item", _any_type())], _any_type())
        fields["get"] = _func_type([("value", type_expr)], _any_type())
        fields["empty"] = _func_type([("value", type_expr)], _bool_return_type())

    return fields


def _invoke_runtime_member(target: Any, name: str, args: tuple[Any, ...]) -> Any:
    if name == "size":
        if args:
            raise EvalError("size expects no extra arguments")
        return runtime_object_size_bits(target)
    attr = runtime_collection_read_attr(target, name)
    if attr is None:
        raise EvalError(f"{name} is not available on the provided value")
    if callable(attr):
        return attr(*args)
    if args:
        raise EvalError(f"{name} expects no extra arguments")
    return attr


def runtime_type_member_callable(type_value: Any, name: str) -> Any | None:
    metadata = runtime_type_surface_metadata(type_value)
    if metadata is None or name not in metadata:
        return None

    def _member(value: Any, *rest: Any) -> Any:
        return _invoke_runtime_member(value, name, rest)

    return _member
