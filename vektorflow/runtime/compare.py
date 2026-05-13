"""Default ordering and equality for struct dicts (README lexicographic rule)."""

from __future__ import annotations

from typing import Any

from .. import ast
from .struct_value import VF_SPILL_BASE_KEY, VF_TYPE_KEY, field_order_for_compare, get_type_name
from .vfvector import VFVector


def struct_eq(a: Any, b: Any, types: dict[str, ast.TypeExpr | ast.FuncType]) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        ta, tb = get_type_name(a), get_type_name(b)
        if ta != tb:
            return False
        keys = set(a) | set(b)
        keys.discard(VF_TYPE_KEY)
        keys.discard(VF_SPILL_BASE_KEY)
        for k in keys:
            if k not in a or k not in b:
                return False
            if not struct_eq(a[k], b[k], types):
                return False
        return True
    if isinstance(a, (VFVector, tuple)) and isinstance(b, (VFVector, tuple)):
        if len(a) != len(b):
            return False
        return all(struct_eq(x, y, types) for x, y in zip(a, b))
    return a == b


def struct_lt(a: dict, b: dict, types: dict[str, ast.TypeExpr | ast.FuncType]) -> bool:
    keys = field_order_for_compare(a, b, types)
    for k in keys:
        if k in (VF_TYPE_KEY, VF_SPILL_BASE_KEY):
            continue
        if k not in a or k not in b:
            continue
        c = _cmp_values(a[k], b[k], types)
        if c < 0:
            return True
        if c > 0:
            return False
    return False


def _cmp_values(a: Any, b: Any, types: dict[str, ast.TypeExpr | ast.FuncType]) -> int:
    if struct_eq(a, b, types):
        return 0
    if isinstance(a, dict) and isinstance(b, dict):
        if struct_lt(a, b, types):
            return -1
        if struct_lt(b, a, types):
            return 1
        return 0
    try:
        if a < b:
            return -1
        if b < a:
            return 1
    except TypeError:
        pass
    sa, sb = str(type(a)), str(type(b))
    if sa < sb:
        return -1
    if sa > sb:
        return 1
    return -1 if id(a) < id(b) else (1 if id(a) > id(b) else 0)
