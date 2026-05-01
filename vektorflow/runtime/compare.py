"""Default ordering and equality for struct dicts (README lexicographic rule)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .. import ast
from ..errors import ErrorTypeValue, error_type_match_specificity
from ..stdlib.events import event_match_specificity, matches_event_code
from .struct_value import VF_TYPE_KEY, field_order_for_compare, get_type_name
from .type_values import PrimType, infer_type, is_type_value, types_equal


def _event_code_of(value: Any) -> int | None:
    """Return a host event's exact integer code without exposing transport shape."""
    if isinstance(value, dict):
        event_code = value.get("event_code", value.get("code"))
        if isinstance(event_code, int) and event_code:
            return event_code
    event_code = getattr(value, "event_code", None)
    if isinstance(event_code, int) and event_code:
        return event_code
    code = getattr(value, "code", None)
    if isinstance(code, int) and code:
        return code
    return None


def struct_compare_binop(
    op: str,
    a: dict,
    b: dict,
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> bool | None:
    """Apply a comparison operator to two struct-like records, or ``None`` if unsupported."""
    if op == "LT":
        return struct_lt(a, b, types)
    if op == "LE":
        return struct_lt(a, b, types) or struct_eq(a, b, types)
    if op == "GT":
        return struct_lt(b, a, types)
    if op == "GE":
        return not struct_lt(a, b, types)
    if op == "EQ":
        return struct_eq(a, b, types)
    if op == "NEQ":
        return not struct_eq(a, b, types)
    return None


def runtime_match_eq(
    a: Any,
    b: Any,
    types: dict[str, ast.TypeExpr | ast.FuncType],
    generic_eq: Callable[[Any, Any], bool],
) -> bool:
    a_event = _event_code_of(a)
    b_event = _event_code_of(b)
    if a_event is not None and isinstance(b, int):
        return matches_event_code(a_event, b)
    if b_event is not None and isinstance(a, int):
        return matches_event_code(b_event, a)
    if isinstance(a, int) and isinstance(b, int):
        if matches_event_code(a, b) or matches_event_code(b, a):
            return True
    if is_type_value(a) and is_type_value(b):
        return types_equal(a, b)
    if isinstance(a, dict) and isinstance(b, dict):
        return struct_eq(a, b, types)
    return generic_eq(a, b)


def runtime_match_specificity(
    a: Any,
    b: Any,
    types: dict[str, ast.TypeExpr | ast.FuncType],
    generic_eq: Callable[[Any, Any], bool],
) -> int | None:
    """Runtime specificity for ``??`` matching, excluding interpreter control-flow mechanics."""
    a_event = _event_code_of(a)
    b_event = _event_code_of(b)
    if a_event is not None and isinstance(b, int):
        return event_match_specificity(a_event, b)
    if b_event is not None and isinstance(a, int):
        return event_match_specificity(b_event, a)
    if isinstance(a, int) and isinstance(b, int):
        s = event_match_specificity(a, b)
        if s is not None:
            return s
        s = event_match_specificity(b, a)
        if s is not None:
            return s
        return None
    if runtime_match_eq(a, b, types, generic_eq):
        return 1_000_000
    if isinstance(b, ErrorTypeValue) and isinstance(a, BaseException):
        return error_type_match_specificity(a, b)
    if is_type_value(b):
        actual = infer_type(a, types)
        if types_equal(actual, b):
            return 1
        if isinstance(b, PrimType) and b.name == "any":
            return 0
    return None


def struct_eq(a: Any, b: Any, types: dict[str, ast.TypeExpr | ast.FuncType]) -> bool:
    if isinstance(a, dict) and isinstance(b, dict):
        ta, tb = get_type_name(a), get_type_name(b)
        if ta != tb:
            return False
        keys = set(a) | set(b)
        keys.discard(VF_TYPE_KEY)
        for k in keys:
            if k not in a or k not in b:
                return False
            if not struct_eq(a[k], b[k], types):
                return False
        return True
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return False
        return all(struct_eq(x, y, types) for x, y in zip(a, b))
    return a == b


def struct_lt(a: dict, b: dict, types: dict[str, ast.TypeExpr | ast.FuncType]) -> bool:
    keys = field_order_for_compare(a, b, types)
    for k in keys:
        if k == VF_TYPE_KEY:
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
