"""Runtime struct tagging and default values for named types."""

from __future__ import annotations

from typing import Any

from .. import ast

VF_TYPE_KEY = "__vf_type__"
VF_SPILL_BASE_KEY = "__vf_spill_base__"


def is_struct_dict(v: Any) -> bool:
    """Plain dict-backed struct (Multiset is not a dict)."""
    return isinstance(v, dict)


def struct_tagged(v: dict) -> bool:
    return VF_TYPE_KEY in v


def struct_has_spill_base(v: dict) -> bool:
    return VF_SPILL_BASE_KEY in v


def get_spill_base(v: dict) -> Any | None:
    return v.get(VF_SPILL_BASE_KEY)


def get_type_name(v: dict) -> str | None:
    t = v.get(VF_TYPE_KEY)
    return str(t) if t is not None else None


def with_type(type_name: str | None, fields: dict[str, Any]) -> dict[str, Any]:
    out = dict(fields)
    if type_name is not None:
        out[VF_TYPE_KEY] = type_name
    else:
        out.pop(VF_TYPE_KEY, None)
    return out


def with_spill_base(type_name: str | None, base: Any, fields: dict[str, Any]) -> dict[str, Any]:
    out = with_type(type_name, fields)
    out[VF_SPILL_BASE_KEY] = base
    return out


def public_struct_items(v: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in v.items()
        if key not in (VF_TYPE_KEY, VF_SPILL_BASE_KEY)
    }


def default_field_value(
    tname: str,
    types: dict[str, ast.TypeExpr | ast.FuncType],
    seen: set[str] | None = None,
) -> Any:
    if seen is None:
        seen = set()
    if tname in ("num",):
        return 0.0
    if tname in ("str",):
        return ""
    if tname in ("byte",):
        return b""
    if tname in ("bool",):
        return False
    if tname in seen:
        raise ValueError(f"circular type dependency involving {tname!r}")
    if tname not in types:
        return with_type(None, {})
    spec = types[tname]
    if isinstance(spec, ast.FuncType):
        return None
    seen = set(seen)
    seen.add(tname)
    return default_struct(tname, types, seen)


def default_struct(
    type_name: str,
    types: dict[str, ast.TypeExpr | ast.FuncType],
    seen: set[str] | None = None,
) -> dict[str, Any]:
    spec = types[type_name]
    if not isinstance(spec, ast.TypeExpr):
        return with_type(type_name, {})
    fields: dict[str, Any] = {}
    for fname, ft in spec.fields:
        fields[fname] = default_field_value(ft, types, seen)
    return with_type(type_name, fields)


def field_order_for_compare(
    a: dict, b: dict, types: dict[str, ast.TypeExpr | ast.FuncType]
) -> list[str]:
    ta, tb = get_type_name(a), get_type_name(b)
    if ta and ta == tb and ta in types:
        spec = types[ta]
        if isinstance(spec, ast.TypeExpr):
            return [f[0] for f in spec.fields]
    keys = [k for k in a if k not in (VF_TYPE_KEY, VF_SPILL_BASE_KEY)]
    if ta == tb and keys:
        return keys
    return sorted(
        {k for k in a if k not in (VF_TYPE_KEY, VF_SPILL_BASE_KEY)}
        | {k for k in b if k not in (VF_TYPE_KEY, VF_SPILL_BASE_KEY)}
    )

