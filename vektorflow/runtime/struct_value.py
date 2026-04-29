"""Runtime struct tagging and default values for named types."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .. import ast

VF_TYPE_KEY = "__vf_type__"


def is_struct_dict(v: Any) -> bool:
    """Plain dict-backed struct (Multiset is not a dict)."""
    return isinstance(v, dict)


def struct_tagged(v: dict) -> bool:
    return VF_TYPE_KEY in v


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


def construct_struct_value(type_name: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Create a tagged runtime struct value for a named constructor result."""
    return with_type(type_name, fields)


def bind_struct_constructor_fields(
    type_name: str,
    params: list[Any],
    pos: list[Any],
    kw: dict[str, Any],
    coerce_item: Callable[[Any, str], Any],
    error_factory: Callable[[str], Exception],
) -> dict[str, Any]:
    """Bind positional/keyword constructor args to named struct fields with coercion."""
    by_name: dict[str, Any] = {}
    field_types = {p.name: p.type_name for p in params}
    for i, a in enumerate(pos):
        if i >= len(params):
            raise error_factory(f"{type_name}: too many positional arguments")
        pname = params[i].name
        if pname in by_name:
            raise error_factory(f"{type_name}: multiple values for field {pname!r}")
        by_name[pname] = coerce_item(a, params[i].type_name)
    for k, v in kw.items():
        if k not in field_types:
            raise error_factory(f"{type_name}: unknown field {k!r}")
        if k in by_name:
            raise error_factory(f"{type_name}: multiple values for field {k!r}")
        by_name[k] = coerce_item(v, field_types[k])
    for p in params:
        if p.name not in by_name:
            raise error_factory(f"{type_name}: missing field {p.name!r}")
    return by_name


def read_struct_field(
    value: Any,
    field_name: str,
    error_factory: Callable[[str], Exception],
) -> Any:
    """Read a field from a struct-like runtime record with the standard missing-field contract."""
    if not is_struct_dict(value):
        raise error_factory("attribute access on non-struct")
    if field_name not in value:
        raise error_factory(f"missing field {field_name!r}")
    return value[field_name]


def apply_struct_unary_fallback(
    op: str,
    value: Any,
    error_factory: Callable[[str], Exception],
) -> tuple[bool, Any]:
    """Apply the runtime fallback contract for unary ops on struct-like values."""
    if op == "MINUS" and isinstance(value, dict):
        raise error_factory("struct negation requires -(a): … overload")
    if op == "NOT" and is_struct_dict(value):
        raise error_factory("struct ~ requires ~(a): … overload")
    return False, None


def snapshot_scope_record(env: dict[str, Any]) -> dict[str, Any]:
    """Snapshot locals as an untagged struct-like record, excluding runtime type metadata."""
    out = {k: v for k, v in env.items() if k != VF_TYPE_KEY}
    return with_type(None, out)


def merge_struct_values(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """``a & b`` for struct-like records: fields from ``a`` then ``b``; duplicate keys take ``b``."""
    ta, tb = get_type_name(a), get_type_name(b)
    out: dict[str, Any] = {}
    for key, value in a.items():
        if key == VF_TYPE_KEY:
            continue
        out[key] = value
    for key, value in b.items():
        if key == VF_TYPE_KEY:
            continue
        out[key] = value
    if ta and ta == tb:
        return with_type(ta, out)
    return with_type(None, out)


def combine_struct_values_elementwise(
    a: dict[str, Any],
    b: dict[str, Any],
    types: dict[str, ast.TypeExpr | ast.FuncType],
    combine_items: Any,
) -> dict[str, Any] | None:
    """Element-wise combine two struct-like records when their tags and field shapes match."""
    ta, tb = get_type_name(a), get_type_name(b)
    if (ta is None) != (tb is None):
        return None
    if ta is not None and tb is not None and ta != tb:
        return None
    keys_a = {k for k in a if k != VF_TYPE_KEY}
    keys_b = {k for k in b if k != VF_TYPE_KEY}
    if keys_a != keys_b:
        return None
    if not keys_a:
        return with_type(ta, {}) if ta else {}

    if ta and ta in types and isinstance(types[ta], ast.TypeExpr):
        order = [f[0] for f in types[ta].fields if f[0] in keys_a]
        for k in sorted(keys_a):
            if k not in order:
                order.append(k)
    else:
        order = sorted(keys_a)

    out: dict[str, Any] = {}
    for k in order:
        if k not in keys_a:
            continue
        out[k] = combine_items(a[k], b[k])
    return with_type(ta, out) if ta else out


def score_struct_type_match(
    value: Any,
    type_name: str,
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> int | None:
    """Specificity score for matching a struct-like runtime value against a named struct parameter."""
    if not is_struct_dict(value):
        return None
    tag = get_type_name(value)
    if tag == type_name:
        return 2
    if tag is not None or type_name not in types:
        return None
    spec = types[type_name]
    if not isinstance(spec, ast.TypeExpr):
        return None
    need = {f[0] for f in spec.fields}
    have = set(value.keys()) - {VF_TYPE_KEY}
    if need <= have:
        return 1
    return None


def stringify_struct_value(
    value: dict[str, Any],
    types: dict[str, ast.TypeExpr | ast.FuncType] | None,
    stringify_item: Any,
) -> str:
    if struct_tagged(value):
        return _stringify_tagged_struct_value(value, types, stringify_item)
    return _stringify_untagged_struct_value(value, stringify_item)


def _stringify_untagged_struct_value(
    value: dict[str, Any],
    stringify_item: Any,
) -> str:
    keys = [key for key in value if key != VF_TYPE_KEY]
    keys.sort(key=lambda key: (str(type(key).__name__), str(key)))
    parts = [f"{stringify_item(key)}:{stringify_item(value[key])}" for key in keys]
    return f"({', '.join(parts)})"


def _stringify_tagged_struct_value(
    value: dict[str, Any],
    types: dict[str, ast.TypeExpr | ast.FuncType] | None,
    stringify_item: Any,
) -> str:
    type_name = get_type_name(value)
    if not type_name:
        return _stringify_untagged_struct_value(value, stringify_item)
    if types is not None and type_name in types:
        spec = types[type_name]
        if isinstance(spec, ast.TypeExpr):
            keys = [field[0] for field in spec.fields if field[0] in value and field[0] != VF_TYPE_KEY]
        else:
            keys = [key for key in value if key != VF_TYPE_KEY]
    else:
        keys = [key for key in value if key != VF_TYPE_KEY]
    parts = [f"{key}:{stringify_item(value[key])}" for key in keys]
    return f"{type_name}({', '.join(parts)})"


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
    keys = [k for k in a if k != VF_TYPE_KEY]
    if ta == tb and keys:
        return keys
    return sorted({k for k in a if k != VF_TYPE_KEY} | {k for k in b if k != VF_TYPE_KEY})

