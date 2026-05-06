"""Tree-walking interpreter for Vektor Flow (phase 1)."""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from itertools import chain
from pathlib import Path
from typing import Any

from . import ast
from .errors import (
    BreakSignal,
    ContinueSignal,
    ControlFlow,
    ERROR_NAMESPACE,
    ErrorTypeValue,
    EvalError,
    ExitProgramSignal,
    ReturnSignal,
    error_type_match_specificity,
)
from .runtime.multiset import (
    Multiset,
    multiset_countwise_floordiv,
    multiset_difference,
    multiset_scalar_add,
    multiset_scalar_floordiv,
    multiset_scalar_subtract,
    multiset_union,
)
from .stdlib import STDLIB_MODULES, resolve_stdlib
from .stdlib.events import MouseEvent, KeyEvent, matches_event_code, event_match_specificity
from .use_resolve import resolve_dot_module, resolve_use_path
from .runtime.struct_value import (
    VF_TYPE_KEY,
    default_field_value,
    get_type_name,
    is_struct_dict,
    struct_tagged,
    with_type,
)
from .runtime.compare import struct_eq, struct_lt
from .runtime import (
    VFVectorBuilder,
    runtime_collection_assign_path,
    runtime_collection_contains,
    runtime_collection_ctor_call,
    runtime_collection_expanded_values,
    runtime_collection_index_read,
    runtime_collection_index_set,
    runtime_collection_kind,
    runtime_collection_elementwise_values,
    runtime_collection_pipe_result,
    runtime_collection_preserves_pipe_result,
    runtime_collection_path_step,
    runtime_collection_read_attr,
    runtime_collection_spill_values,
    runtime_collection_stringify,
    runtime_collection_to_multiset,
    runtime_collection_multiset_from_count_pairs,
    runtime_collection_multiset_from_values,
    runtime_collection_take,
    runtime_collection_set,
    make_vmap,
)
from .runtime.axis_broadcast import axis_broadcast_binary
from .runtime.axis_tagged import AxisTaggedValue
from .runtime.lazy_range import LazyInfiniteIterator, LazyList
from .runtime.type_values import (
    combine_typed_multiset_types,
    PrimType,
    combine_typed_vector_types,
    coerce_value,
    coerce_typed_value,
    infer_type,
    is_type_value,
    normalize_type_expr,
    resolve_return_type,
    type_match_specificity,
    types_equal,
    typed_multiset_type_of,
    wrap_typed_multiset_result,
    wrap_typed_vector_result,
)
from .runtime.typed_vector import TypedVector
from .runtime.vfvector import VFVector
from .runtime.vflist import VFLinkedList

# Sentinel: no outer ``$`` in ``env`` before a :class:`ast.MatchStmt` binds it.
_NO_PREVIOUS_DOLLAR = object()

OPERATOR_SYMBOLS = frozenset(
    {
        ".",
        "+",
        "-",
        "*",
        "/",
        "//",
        "%",
        "^",
        "&",
        "=",
        "~=",
        "!=",
        "<",
        "<=",
        ">",
        ">=",
        "/\\",
        "\\/",
        "><",
        "~",
    }
)

# Built-in value types: overloads on ordinary values may mention these, but at least
# one relevant parameter must still be custom / constructed.
_PRIMITIVE_VALUE_TYPES_FOR_OVERLOAD = frozenset(
    {"int", "num", "str", "bool", "byte", "bytes", "any", "vector"}
)


def _param_is_custom_typed(p: ast.Param) -> bool:
    if p.param_func_type is not None:
        return False
    t = p.type_name
    if t is None or t == "any":
        return False
    return t not in _PRIMITIVE_VALUE_TYPES_FOR_OVERLOAD


def _validate_custom_unary_overload(params: list[ast.Param], kind: str) -> None:
    if len(params) != 1:
        raise EvalError(f"{kind}: expected exactly one parameter")
    p = params[0]
    if _param_is_custom_typed(p):
        return
    raise EvalError(
        f"{kind}: parameter must name a custom or constructed type (e.g. `Point`)"
    )


def _validate_custom_operator_overload(params: list[ast.Param], kind: str) -> None:
    bad = [p.name for p in params if p.param_func_type is None and (p.type_name is None or p.type_name == "any")]
    if bad:
        raise EvalError(
            f"{kind}: overload parameters must be typed; untyped / `any` parameters are not allowed: "
            f"{', '.join(repr(n) for n in bad)}"
        )
    if any(_param_is_custom_typed(p) for p in params):
        return
    raise EvalError(
        f"{kind}: at least one parameter must name a custom or constructed type (e.g. `Point`)"
    )


BINOP_KIND_TO_SYM = {
    "PLUS": "+",
    "MINUS": "-",
    "STAR": "*",
    "SLASH": "/",
    "FLOORDIV": "//",
    "PERCENT": "%",
    "CARET": "^",
    "EQ": "=",
    "EXACT_EQ": "==",
    "NEQ": "!=",
    "STRUCT_NEQ": "~=",
    "LT": "<",
    "LE": "<=",
    "GT": ">",
    "GE": ">=",
    "AND": "/\\",
    "OR": "\\/",
    "XOR": "><",
    "AMPERSAND": "&",
}

UNARY_KIND_TO_SYM = {"MINUS": "-", "NOT": "~"}


def _collect_field_sources(body: Any) -> dict[str, Any]:
    """Body bindings ``name: …`` (simple identifiers) for ``f.name`` introspection."""
    out: dict[str, Any] = {}
    if isinstance(body, ast.Block):
        for st in body.statements:
            if isinstance(st, ast.Bind) and isinstance(st.target, ast.Ident):
                out[st.target.name] = st.value
    return out


def _expr_refs_param(expr: Any, param_names: set[str]) -> bool:
    if expr is None:
        return False
    if isinstance(expr, ast.Ident):
        return expr.name in param_names
    if isinstance(expr, ast.BinOp):
        return _expr_refs_param(expr.left, param_names) or _expr_refs_param(
            expr.right, param_names
        )
    if isinstance(expr, ast.UnaryOp):
        return _expr_refs_param(expr.operand, param_names)
    if isinstance(expr, ast.Call):
        if _expr_refs_param(expr.func, param_names):
            return True
        for a in expr.args:
            if isinstance(a, ast.NamedCallArg):
                if _expr_refs_param(a.value, param_names):
                    return True
            elif isinstance(a, ast.SpreadArg):
                if _expr_refs_param(a.expr, param_names):
                    return True
            elif _expr_refs_param(a, param_names):
                return True
        return False
    if isinstance(expr, ast.Attribute):
        return _expr_refs_param(expr.value, param_names)
    if isinstance(expr, ast.TupleLit):
        for e in expr.elements:
            if isinstance(e, ast.SpreadArg):
                if _expr_refs_param(e.expr, param_names):
                    return True
            elif _expr_refs_param(e, param_names):
                return True
        return False
    if isinstance(expr, ast.ListLit):
        for e in expr.elements:
            if isinstance(e, ast.MsetSpill):
                if _expr_refs_param(e.expr, param_names):
                    return True
            elif _expr_refs_param(e, param_names):
                return True
        return False
    if isinstance(expr, ast.MultisetLit):
        for a, b in expr.pairs:
            if _expr_refs_param(a, param_names) or _expr_refs_param(b, param_names):
                return True
        return False
    if isinstance(expr, ast.StructLit):
        for _n, v in expr.fields:
            if _expr_refs_param(v, param_names):
                return True
        return False
    if isinstance(expr, ast.DottedIndex):
        if _expr_refs_param(expr.base, param_names):
            return True
        return any(_expr_refs_param(i, param_names) for i in expr.indices)
    if isinstance(expr, ast.AbsExpr):
        return _expr_refs_param(expr.inner, param_names)
    if isinstance(expr, ast.RangeExpr):
        if expr.start is not None and _expr_refs_param(expr.start, param_names):
            return True
        if expr.end is not None and _expr_refs_param(expr.end, param_names):
            return True
        return False
    if isinstance(expr, ast.VectorRepeat):
        return _expr_refs_param(expr.value, param_names) or _expr_refs_param(
            expr.count, param_names
        )
    if isinstance(expr, ast.Lambda):
        return _expr_refs_param(expr.body, param_names)
    if isinstance(expr, ast.AxisAlign):
        if _expr_refs_param(expr.value, param_names):
            return True
        if expr.indices is not None:
            return any(_expr_refs_param(i, param_names) for i in expr.indices)
        return False
    if isinstance(expr, ast.TypeOf):
        return _expr_refs_param(expr.value, param_names)
    if isinstance(expr, ast.StructIdentity):
        return False
    return False


def _is_struct_ctor_body(body: Any) -> bool:
    """``Name(params):`` with no executable body, or only ``:`` (return local scope / record)."""
    if isinstance(body, ast.Block):
        if len(body.statements) == 0:
            return True
        if len(body.statements) == 1:
            st = body.statements[0]
            return isinstance(st, ast.ExprStmt) and isinstance(st.expr, ast.StructIdentity)
        return False
    return isinstance(body, ast.StructIdentity)


def _local_scope_as_record(env: dict[str, Any]) -> dict[str, Any]:
    """Snapshot of current locals as an untagged record (for ``:`` expression)."""
    out = {k: v for k, v in env.items() if k != VF_TYPE_KEY}
    return with_type(None, out)


def _vf_bool_display(b: bool) -> str:
    """Emit form for booleans: C++/JSON-style ``true``/``false`` (not Python ``True``/``False``)."""
    return "true" if b else "false"


def _exact_numeric_eq(a: Any, b: Any) -> bool:
    return type(a) is type(b) and a == b


def _exact_struct_eq(a: dict[str, Any], b: dict[str, Any]) -> bool:
    ak = list(a.keys())
    bk = list(b.keys())
    if ak != bk:
        return False
    for k in ak:
        if not _exact_eq(a[k], b[k]):
            return False
    return True


def _exact_multiset_eq(a: Multiset, b: Multiset) -> bool:
    if getattr(a, "vf_type_expr", None) != getattr(b, "vf_type_expr", None):
        return False
    ad = dict(a)
    bd = dict(b)
    if len(ad) != len(bd):
        return False
    for ak in ad:
        matched = False
        for bk in bd:
            if _exact_eq(ak, bk):
                if not _exact_eq(ad[ak], bd[bk]):
                    return False
                matched = True
                break
        if not matched:
            return False
    return True


def _multiset_keys_match(a: Multiset, b: Multiset) -> bool:
    return [key for key, _count in a.items_sorted()] == [key for key, _count in b.items_sorted()]


def _multiset_to_struct_counts(value: Multiset) -> dict[str, Any]:
    return with_type(None, {key: count for key, count in value.items_sorted()})


def _multiset_division_struct(a: Multiset, b: Any) -> dict[str, Any]:
    if isinstance(b, Multiset):
        if not _multiset_keys_match(a, b):
            raise EvalError("multiset key mismatch for /")
        out: dict[Any, Any] = {}
        for key, count in a.items_sorted():
            out[key] = count / b._c[key]
        return with_type(None, out)
    if isinstance(b, int) and not isinstance(b, bool):
        if b == 0:
            raise ZeroDivisionError("division by zero")
        return with_type(None, {key: count / b for key, count in a.items_sorted()})
    raise EvalError(f"unsupported right operand for multiset /: {type(b).__name__!r}")


def _exact_eq(a: Any, b: Any) -> bool:
    if type(a) is not type(b):
        return False
    if isinstance(a, (bool, int, float, complex, str, bytes, bytearray)):
        return a == b
    if isinstance(a, tuple):
        return len(a) == len(b) and all(_exact_eq(x, y) for x, y in zip(a, b))
    if isinstance(a, VFVector):
        if isinstance(a, TypedVector):
            if not types_equal(getattr(a, "vf_type_expr", None), getattr(b, "vf_type_expr", None)):
                return False
        return len(a) == len(b) and all(_exact_eq(x, y) for x, y in zip(a, b))
    if isinstance(a, Multiset):
        return _exact_multiset_eq(a, b)
    if is_struct_dict(a):
        return _exact_struct_eq(a, b)
    if isinstance(a, AxisTaggedValue):
        return a.idx == b.idx and _exact_eq(a.data, b.data)
    if isinstance(a, (VFunction, OpCallable, VStructCtor)):
        return a is b
    if is_type_value(a):
        return types_equal(a, b)
    return a == b


def _negate_bool_structure(value: Any) -> Any:
    if isinstance(value, bool):
        return not value
    if isinstance(value, AxisTaggedValue):
        return AxisTaggedValue(_negate_bool_structure(value.data), value.idx)
    if isinstance(value, tuple):
        return tuple(_negate_bool_structure(v) for v in value)
    if isinstance(value, VFVector):
        return VFVector(_negate_bool_structure(v) for v in value)
    if is_struct_dict(value):
        return with_type(
            None,
            {k: _negate_bool_structure(v) for k, v in value.items() if k != VF_TYPE_KEY},
        )
    raise EvalError("logical negation requires booleans or boolean structures")


def _is_bool_structure(value: Any) -> bool:
    if isinstance(value, bool):
        return True
    if isinstance(value, AxisTaggedValue):
        return _is_bool_structure(value.data)
    if isinstance(value, tuple):
        return all(_is_bool_structure(v) for v in value)
    if isinstance(value, VFVector):
        return all(_is_bool_structure(v) for v in value)
    if is_struct_dict(value):
        return all(_is_bool_structure(v) for k, v in value.items() if k != VF_TYPE_KEY)
    return False


def _logical_scalar_binop(op: str, a: bool, b: bool) -> bool:
    if op == "AND":
        return a and b
    if op == "OR":
        return a or b
    if op == "XOR":
        return a ^ b
    raise EvalError(f"unknown logical operator {op!r}")


def _logical_structure_binop(op: str, a: Any, b: Any) -> Any:
    if isinstance(a, bool) and isinstance(b, bool):
        return _logical_scalar_binop(op, a, b)
    if isinstance(a, AxisTaggedValue) and isinstance(b, AxisTaggedValue):
        if a.idx != b.idx:
            raise EvalError("axis alignment mismatch for logical op")
        return AxisTaggedValue(_logical_structure_binop(op, a.data, b.data), a.idx)
    if isinstance(a, AxisTaggedValue) and isinstance(b, bool):
        return AxisTaggedValue(_logical_structure_binop(op, a.data, b), a.idx)
    if isinstance(b, AxisTaggedValue) and isinstance(a, bool):
        return AxisTaggedValue(_logical_structure_binop(op, a, b.data), b.idx)
    if is_struct_dict(a) and is_struct_dict(b):
        if get_type_name(a) != get_type_name(b):
            raise EvalError("struct shape mismatch for logical op")
        akeys = [k for k in a.keys() if k != VF_TYPE_KEY]
        bkeys = [k for k in b.keys() if k != VF_TYPE_KEY]
        if akeys != bkeys:
            raise EvalError("struct shape mismatch for logical op")
        return with_type(None, {k: _logical_structure_binop(op, a[k], b[k]) for k in akeys})
    if is_struct_dict(a) and isinstance(b, bool):
        akeys = [k for k in a.keys() if k != VF_TYPE_KEY]
        return with_type(None, {k: _logical_structure_binop(op, a[k], b) for k in akeys})
    if is_struct_dict(b) and isinstance(a, bool):
        bkeys = [k for k in b.keys() if k != VF_TYPE_KEY]
        return with_type(None, {k: _logical_structure_binop(op, a, b[k]) for k in bkeys})
    if isinstance(a, tuple) and isinstance(b, tuple):
        if len(a) != len(b):
            raise EvalError("tuple length mismatch for logical op")
        return tuple(_logical_structure_binop(op, x, y) for x, y in zip(a, b))
    if isinstance(a, tuple) and isinstance(b, bool):
        return tuple(_logical_structure_binop(op, x, b) for x in a)
    if isinstance(b, tuple) and isinstance(a, bool):
        return tuple(_logical_structure_binop(op, a, y) for y in b)
    if isinstance(a, VFVector) and isinstance(b, VFVector):
        if len(a) != len(b):
            raise EvalError("vector length mismatch for logical op")
        return VFVector(_logical_structure_binop(op, x, y) for x, y in zip(a, b))
    if isinstance(a, VFVector) and isinstance(b, bool):
        return VFVector(_logical_structure_binop(op, x, b) for x in a)
    if isinstance(b, VFVector) and isinstance(a, bool):
        return VFVector(_logical_structure_binop(op, a, y) for y in b)
    raise EvalError("logical operators require booleans or aligned boolean structures")


def _try_scalar_relational_derivation(op: str, a: Any, b: Any) -> Any:
    def _try_lt(x: Any, y: Any) -> bool | None:
        try:
            return bool(x < y)
        except Exception:
            return None

    if op == "LT":
        lt = _try_lt(a, b)
        if lt is not None:
            return lt
        return a < b
    if op == "GT":
        lt = _try_lt(b, a)
        if lt is not None:
            return lt
        return a > b
    if op == "EQ":
        lt_ab = _try_lt(a, b)
        lt_ba = _try_lt(b, a)
        if lt_ab is not None and lt_ba is not None:
            return (not lt_ab) and (not lt_ba)
        return a == b
    if op == "STRUCT_NEQ":
        return not _try_scalar_relational_derivation("EQ", a, b)
    if op == "LE":
        return _logical_scalar_binop(
            "OR",
            _try_scalar_relational_derivation("LT", a, b),
            _try_scalar_relational_derivation("EQ", a, b),
        )
    if op == "GE":
        return _logical_scalar_binop(
            "OR",
            _try_scalar_relational_derivation("GT", a, b),
            _try_scalar_relational_derivation("EQ", a, b),
        )
    raise EvalError(f"unknown relational operator {op!r}")


def _structural_compare(op: str, a: Any, b: Any) -> Any:
    if op == "STRUCT_NEQ":
        return _negate_bool_structure(_structural_compare("EQ", a, b))
    if isinstance(a, Multiset) and isinstance(b, Multiset):
        if not _multiset_keys_match(a, b):
            raise EvalError("multiset key mismatch for relational op")
        return with_type(
            None,
            {key: _structural_compare(op, count, b._c[key]) for key, count in a.items_sorted()},
        )
    if isinstance(a, Multiset) and isinstance(b, int) and not isinstance(b, bool):
        return with_type(None, {key: _structural_compare(op, count, b) for key, count in a.items_sorted()})
    if isinstance(b, Multiset) and isinstance(a, int) and not isinstance(a, bool):
        return with_type(None, {key: _structural_compare(op, a, count) for key, count in b.items_sorted()})
    if is_struct_dict(a) and is_struct_dict(b):
        if get_type_name(a) != get_type_name(b):
            raise EvalError("struct shape mismatch for relational op")
        akeys = [k for k in a.keys() if k != VF_TYPE_KEY]
        bkeys = [k for k in b.keys() if k != VF_TYPE_KEY]
        if akeys != bkeys:
            raise EvalError("struct shape mismatch for relational op")
        return with_type(None, {k: _structural_compare(op, a[k], b[k]) for k in akeys})
    if is_struct_dict(a) and not is_struct_dict(b):
        akeys = [k for k in a.keys() if k != VF_TYPE_KEY]
        return with_type(None, {k: _structural_compare(op, a[k], b) for k in akeys})
    if is_struct_dict(b) and not is_struct_dict(a):
        bkeys = [k for k in b.keys() if k != VF_TYPE_KEY]
        return with_type(None, {k: _structural_compare(op, a, b[k]) for k in bkeys})
    if isinstance(a, tuple) and isinstance(b, tuple):
        if len(a) != len(b):
            raise EvalError("tuple length mismatch for relational op")
        return tuple(_structural_compare(op, x, y) for x, y in zip(a, b))
    if isinstance(a, tuple) and isinstance(b, (int, float, complex, bool)):
        return tuple(_structural_compare(op, x, b) for x in a)
    if isinstance(b, tuple) and isinstance(a, (int, float, complex, bool)):
        return tuple(_structural_compare(op, a, y) for y in b)
    if isinstance(a, VFVector) and isinstance(b, VFVector):
        if len(a) != len(b):
            raise EvalError("vector length mismatch for relational op")
        return VFVector(_structural_compare(op, x, y) for x, y in zip(a, b))
    if isinstance(a, VFVector) and isinstance(b, (int, float, complex, bool)):
        return VFVector(_structural_compare(op, x, b) for x in a)
    if isinstance(b, VFVector) and isinstance(a, (int, float, complex, bool)):
        return VFVector(_structural_compare(op, a, y) for y in b)
    return _binop(op, a, b)


def _type_matches(
    actual: Any,
    pattern: Any,
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> bool:
    return type_match_specificity(actual, pattern, types) is not None


def _type_match_specificity(
    actual: Any,
    pattern: Any,
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> int | None:
    return type_match_specificity(actual, pattern, types)


def _wrap_vector_result_if_typed(op: str, result: Any, left: Any, right: Any) -> VFVector:
    """Attach refined vector types when present; otherwise materialize a plain runtime vector."""
    if not isinstance(left, TypedVector) and not isinstance(right, TypedVector):
        return VFVector(result)
    return wrap_typed_vector_result(result, combine_typed_vector_types(op, left, right))


def _expr_to_compact_string(expr: Any) -> str:
    """Readable RHS snapshot when parameters are not bound (e.g. ``f.y`` → ``\"2x\"``)."""
    if isinstance(expr, ast.Ident):
        return expr.name
    if isinstance(expr, ast.NumberLit):
        v = expr.value
        if isinstance(v, int):
            return str(v)
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v)
    if isinstance(expr, ast.BoolLit):
        return _vf_bool_display(expr.value)
    if isinstance(expr, ast.NullLit):
        return "null"
    if isinstance(expr, ast.StringLit):
        return repr(expr.value)
    if isinstance(expr, ast.BinOp):
        l = _expr_to_compact_string(expr.left)
        r = _expr_to_compact_string(expr.right)
        if (
            expr.op == "STAR"
            and isinstance(expr.left, ast.NumberLit)
            and isinstance(expr.right, ast.Ident)
        ):
            return f"{l}{r}"
        op_s = BINOP_KIND_TO_SYM.get(expr.op, expr.op)
        return f"{l}{op_s}{r}"
    if isinstance(expr, ast.UnaryOp):
        sym = UNARY_KIND_TO_SYM.get(expr.op, expr.op)
        inner = _expr_to_compact_string(expr.operand)
        if expr.op == "NOT":
            return f"{sym}{inner}"
        return f"{sym}{inner}"
    if isinstance(expr, ast.Call):
        fn = _expr_to_compact_string(expr.func)
        parts: list[str] = []
        for a in expr.args:
            if isinstance(a, ast.NamedCallArg):
                parts.append(f"{a.name}: {_expr_to_compact_string(a.value)}")
            elif isinstance(a, ast.SpreadArg):
                parts.append(f":{_expr_to_compact_string(a.expr)}")
            else:
                parts.append(_expr_to_compact_string(a))
        return f"{fn}({', '.join(parts)})"
    if isinstance(expr, ast.Attribute):
        return f"{_expr_to_compact_string(expr.value)}.{expr.name}"
    if isinstance(expr, ast.TupleLit):
        parts: list[str] = []
        for e in expr.elements:
            if isinstance(e, ast.SpreadArg):
                parts.append(f":{_expr_to_compact_string(e.expr)}")
            else:
                parts.append(_expr_to_compact_string(e))
        return f"({', '.join(parts)})"
    if isinstance(expr, ast.ListLit):
        inner = ", ".join(_expr_to_compact_string(e) for e in expr.elements)
        return f"[{inner}]"
    if isinstance(expr, ast.AxisAlign):
        inner = _expr_to_compact_string(expr.value)
        if expr.label is not None:
            return f"{inner}->{expr.label}"
        assert expr.indices is not None
        parts = ", ".join(_expr_to_compact_string(i) for i in expr.indices)
        return f"{inner}->({parts})"
    return f"<{type(expr).__name__}>"


def _event_object_code(value: Any) -> int | None:
    if isinstance(value, (MouseEvent, KeyEvent)):
        code = getattr(value, "event_code", 0)
        try:
            return int(code)
        except Exception:
            return None
    return None


def _contains_ast_nodes(items: list[Any]) -> bool:
    return any(getattr(item.__class__, "__module__", "") == ast.__name__ for item in items)


def _score_params_match(
    fn: VFunction,
    args: list[Any],
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> int | None:
    if len(fn.params) != len(args):
        return None
    score = 0
    for p, av in zip(fn.params, args):
        if p.param_func_type is not None:
            if not isinstance(av, VFunction):
                return None
            ft = getattr(av, "func_type", None)
            if ft is None:
                inferred = infer_type(av, types)
                nested = type_match_specificity(inferred, p.param_func_type, types)
                if nested is None:
                    return None
            else:
                nested = type_match_specificity(ft, p.param_func_type, types)
                if nested is None:
                    return None
            score += 2 + nested
            continue
        if p.type_ref is not None:
            actual = infer_type(av, types)
            nested = type_match_specificity(actual, p.type_ref, types)
            if nested is None:
                return None
            score += nested
            continue
        if p.type_name in (None, "any"):
            continue
        actual = infer_type(av, types)
        nested = type_match_specificity(actual, ast.PrimTypeRef(p.type_name), types)
        if nested is None:
            return None
        score += nested
    return score


def _pick_best_overload(
    variants: list[VFunction],
    args: list[Any],
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> VFunction | None:
    best: VFunction | None = None
    best_score = -1
    for fn in variants:
        s = _score_params_match(fn, args, types)
        if s is None:
            continue
        if s > best_score:
            best_score = s
            best = fn
    return best


def _pick_overload_for_symbol(
    op_overloads: dict[str, list[VFunction]],
    sym: str,
    args: list[Any],
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> VFunction | None:
    variants = op_overloads.get(sym) or []
    fns = [f for f in variants if len(f.params) == len(args)]
    return _pick_best_overload(fns, args, types)


def _format_param_list_display(params: list[ast.Param]) -> str:
    parts: list[str] = []
    for p in params:
        head = p.name
        if p.param_func_type is not None:
            head = f"{_format_nested_func_type_for_param(p.param_func_type)} {p.name}"
        elif p.type_ref is not None:
            head = f"{_format_type_ast_for_stringify(p.type_ref)} {p.name}"
        elif p.type_name:
            head = f"{p.type_name} {p.name}"
        if p.default_expr is not None:
            head = f"{head}:{_expr_to_compact_string(p.default_expr)}"
        parts.append(head)
    return ", ".join(parts)


def _format_nested_func_type_for_param(ft: ast.FuncType) -> str:
    return _format_ft_domain_part(ft.domain) + " -> " + _format_ft_codomain_part(ft.codomain)


def _format_ft_domain_part(dom: Any) -> str:
    if isinstance(dom, ast.PrimTypeRef):
        return dom.name
    if isinstance(dom, ast.TupleTypeExpr):
        if not dom.elements:
            return "()"
        return "(" + ", ".join(_format_type_ast_for_stringify(e) for e in dom.elements) + ")"
    if isinstance(dom, ast.TypeExpr):
        if not dom.fields:
            return "()"
        bits: list[str] = []
        for n, t in dom.fields:
            if isinstance(t, ast.FuncType):
                bits.append(f"{n}:{_format_nested_func_type_for_param(t)}")
            else:
                bits.append(f"{n}:{_format_type_ast_for_stringify(t)}")
        return "(" + ", ".join(bits) + ")"
    if isinstance(dom, ast.FixedVectorType):
        return _format_type_ast_for_stringify(dom)
    return "…"


def _format_ft_codomain_part(cod: Any) -> str:
    if isinstance(cod, str):
        return cod
    if isinstance(cod, ast.FuncType):
        return _format_nested_func_type_for_param(cod)
    if isinstance(cod, ast.PrimTypeRef):
        return cod.name
    if isinstance(cod, (ast.TupleTypeExpr, ast.TypeExpr, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec)):
        return _format_type_ast_for_stringify(cod)
    return "…"


def _format_type_ast_for_stringify(v: Any) -> str:
    """Surface-syntax type printout (no ``PrimTypeRef(...)`` / ``dataclass`` repr)."""
    if isinstance(v, ast.PrimTypeRef):
        return v.name
    if isinstance(v, ast.TypeUnionExpr):
        return "|".join(_format_type_ast_for_stringify(member) for member in v.members)
    if isinstance(v, ast.TypeIntersectionExpr):
        return "&".join(_format_type_ast_for_stringify(member) for member in v.members)
    if isinstance(v, ast.TypeSizeConst):
        return str(v.value)
    if isinstance(v, ast.TypeSizeVar):
        return v.name
    if isinstance(v, ast.TypeSizeBinOp):
        return f"{_format_type_ast_for_stringify(v.left)}{v.op}{_format_type_ast_for_stringify(v.right)}"
    if isinstance(v, ast.TupleTypeExpr):
        if not v.elements:
            return "()"
        if len(v.elements) == 1:
            return "(" + _format_type_ast_for_stringify(v.elements[0]) + ",)"
        return "(" + ", ".join(_format_type_ast_for_stringify(e) for e in v.elements) + ")"
    if isinstance(v, ast.TypeExpr):
        if not v.fields:
            return "()"
        bits: list[str] = []
        for n, t in v.fields:
            if isinstance(t, ast.FuncType):
                bits.append(f"{n}:{_format_nested_func_type_for_param(t)}")
            else:
                bits.append(f"{n}:{_format_type_ast_for_stringify(t)}")
        return "(" + ", ".join(bits) + ")"
    if isinstance(v, ast.FixedVectorType):
        return f"[{_format_type_ast_for_stringify(v.element_type)}:{_format_type_ast_for_stringify(v.size)}]"
    if isinstance(v, ast.MultisetType):
        return "{" + _format_type_ast_for_stringify(v.element_type) + "}"
    if isinstance(v, ast.MapValueType):
        if not v.fields:
            return "map()"
        return "map(" + ", ".join(f"{n}:{_format_type_ast_for_stringify(t)}" for n, t in v.fields) + ")"
    if isinstance(v, ast.LinkedListValueType):
        return "list(" + ", ".join(_format_type_ast_for_stringify(t) for t in v.elements) + ")"
    if isinstance(v, ast.NamedTypeSpec):
        return f"{v.name}:{_format_type_ast_for_stringify(v.type_expr)}"
    if isinstance(v, ast.FuncType):
        return _format_nested_func_type_for_param(v)
    return "…"


def _format_untagged_dict_as_record(
    v: dict[str, Any],
    types: dict[str, ast.TypeExpr | ast.FuncType] | None,
) -> str:
    keys = [k for k in v if k != VF_TYPE_KEY]
    keys.sort(key=lambda k: (str(type(k).__name__), str(k)))
    parts = [f"{_stringify(k, types)}:{_stringify(v[k], types)}" for k in keys]
    return f"({', '.join(parts)})"


def _format_vfunction_display(vf: VFunction) -> str:
    label = vf.name if vf.name is not None else "$"
    pl = _format_param_list_display(vf.params)
    if vf.func_type is not None:
        tail = _format_ft_codomain_part(vf.func_type.codomain)
        return f"{label}({pl}) -> {tail}"
    return f"{label}({pl})"


def _format_vstruct_ctor_display(c: VStructCtor) -> str:
    return f"{c.name}({_format_param_list_display(c.params)})"


@dataclass
class VFunction:
    """User function; ``name`` is ``None`` for lambdas ``$(…)``."""

    name: str | None
    params: list[ast.Param]
    body: Any
    closure: dict[str, Any]
    func_type: ast.FuncType | None = None
    field_sources: dict[str, Any] = field(default_factory=dict)
    ip: Any = field(default=None, repr=False)

    def __call__(self, *args: Any) -> Any:
        """Allow VFunction to be used as a Python callable (e.g. event handlers)."""
        if self.ip is None:
            raise TypeError("VFunction has no interpreter reference; cannot call from Python")
        return self.ip._call(self, list(args), self.ip.globals)


@dataclass
class OpCallable:
    """Callable view of an operator symbol (``+``, ``/\\``, …) for ``+(2,3)`` syntax."""

    symbol: str
    ip: Any  # Interpreter

    def __call__(self, *args: Any) -> Any:
        return self.ip._dispatch_op_call(self.symbol, list(args))


@dataclass
class VStructCtor:
    """Struct ``class``: ``Name(params):`` with no body — call ``Name(...)`` to build a tagged struct."""

    name: str
    params: list[ast.Param]
    closure: dict[str, Any]


class Interpreter:
    """Per-file interpreter: ``builtin`` (stdlib) vs ``globals`` (module bindings)."""

    def __init__(self, file_path: Path) -> None:
        self.file_path = file_path.resolve()
        self.base_dir = self.file_path.parent
        self.module_cache: dict[str, Any] = {}
        self.builtin: dict[str, Any] = {}
        self.globals: dict[str, Any] = {}
        self.types: dict[str, ast.TypeExpr | ast.FuncType] = {}
        self.op_overloads: dict[str, list[VFunction]] = {}
        self.display_overloads: list[VFunction] = []
        self.cast_overloads: dict[str, list[VFunction]] = {}
        # `@:` may only return to the nearest callable `:` scope.
        self._return_scope_depth: int = 0
        self._merge_stdlibs()
        self.builtin["take"] = _builtin_take
        self.builtin["to_list"] = _builtin_to_list
        self.builtin["to_multiset"] = _builtin_to_multiset
        for _tn in ("int", "num", "str", "byte", "bytes", "bool", "any"):
            self.builtin[_tn] = PrimType(_tn)
        self.builtin["i"] = 1j
        self.builtin["j"] = 1j
        self.builtin["errors"] = make_vmap(ERROR_NAMESPACE)

    def _merge_stdlibs(self) -> None:
        for name in ("math", "capture", "io", "collections", "stat"):
            if name in STDLIB_MODULES:
                try:
                    self.builtin[name] = resolve_stdlib(name)
                except KeyError:
                    pass

    def _resolve(self, name: str, env: dict[str, Any]) -> Any:
        if name in env:
            return env[name]
        if name in self.builtin:
            return self.builtin[name]
        raise EvalError(f"undefined name: {name!r}")

    def _resolve_runtime_type_expr(self, type_expr: Any, env: dict[str, Any]) -> Any:
        if isinstance(type_expr, ast.TypeOf):
            return self.eval_expr(type_expr, env)
        if isinstance(type_expr, ast.NamedTypeSpec):
            return ast.NamedTypeSpec(type_expr.name, self._resolve_runtime_type_expr(type_expr.type_expr, env))
        if isinstance(type_expr, ast.TypeUnionExpr):
            return ast.TypeUnionExpr(
                [self._resolve_runtime_type_expr(member, env) for member in type_expr.members]
            )
        if isinstance(type_expr, ast.TypeIntersectionExpr):
            return ast.TypeIntersectionExpr(
                [self._resolve_runtime_type_expr(member, env) for member in type_expr.members]
            )
        if isinstance(type_expr, ast.FixedVectorType):
            return ast.FixedVectorType(self._resolve_runtime_type_expr(type_expr.element_type, env), type_expr.size)
        if isinstance(type_expr, ast.MultisetType):
            return ast.MultisetType(self._resolve_runtime_type_expr(type_expr.element_type, env))
        if isinstance(type_expr, ast.TypeExpr):
            return ast.TypeExpr([(name, self._resolve_runtime_type_expr(inner, env)) for name, inner in type_expr.fields])
        if isinstance(type_expr, ast.TupleTypeExpr):
            return ast.TupleTypeExpr([self._resolve_runtime_type_expr(inner, env) for inner in type_expr.elements])
        if isinstance(type_expr, ast.MapValueType):
            return ast.MapValueType([(name, self._resolve_runtime_type_expr(inner, env)) for name, inner in type_expr.fields])
        if isinstance(type_expr, ast.LinkedListValueType):
            return ast.LinkedListValueType([self._resolve_runtime_type_expr(inner, env) for inner in type_expr.elements])
        if isinstance(type_expr, ast.FuncType):
            return ast.FuncType(
                self._resolve_runtime_type_expr(type_expr.domain, env),
                self._resolve_runtime_type_expr(type_expr.codomain, env),
            )
        return type_expr

    def _eval_call_args(
        self, raw_args: list[Any], env: dict[str, Any]
    ) -> tuple[list[Any], dict[str, Any], list[Any]]:
        pos: list[Any] = []
        kw: dict[str, Any] = {}
        spreads: list[Any] = []
        for a in raw_args:
            if isinstance(a, ast.NamedCallArg):
                kw[a.name] = self.eval_expr(a.value, env)
            elif isinstance(a, ast.SpreadArg):
                spreads.append(self.eval_expr(a.expr, env))
            else:
                pos.append(self.eval_expr(a, env))
        return pos, kw, spreads

    def _iter_named_spread_items(self, value: Any) -> list[tuple[str, Any]]:
        if is_struct_dict(value):
            return [(k, value[k]) for k in value if k != VF_TYPE_KEY]
        kind = runtime_collection_kind(value)
        if kind == "map":
            return [(str(k), v) for k, v in value.items()]
        raise EvalError("named call spread requires a keyed struct or map value")

    def _iter_positional_spread_items(self, value: Any) -> list[Any]:
        if isinstance(value, tuple):
            return list(value)
        if isinstance(value, VFVector):
            return list(value)
        kind = runtime_collection_kind(value)
        if kind in {"list", "queue"}:
            return list(value)
        raise EvalError("positional call spread requires a tuple, vector, list, or queue value")

    def _normalize_vkf_call_args(
        self,
        raw_args: list[Any],
        env: dict[str, Any],
        *,
        callee_name: str,
    ) -> tuple[list[Any], dict[str, Any]]:
        pos: list[Any] = []
        named: dict[str, Any] = {}
        named_source: dict[str, str] = {}
        named_started = False
        for arg in raw_args:
            if isinstance(arg, ast.NamedCallArg):
                named_started = True
                value = self.eval_expr(arg.value, env)
                prev = named_source.get(arg.name)
                if prev == "direct":
                    raise EvalError(f"{callee_name}: multiple values for argument {arg.name!r}")
                named[arg.name] = value
                named_source[arg.name] = "direct"
                continue
            if isinstance(arg, ast.SpreadArg):
                spread_value = self.eval_expr(arg.expr, env)
                if is_struct_dict(spread_value) or runtime_collection_kind(spread_value) == "map":
                    named_started = True
                    for key, value in self._iter_named_spread_items(spread_value):
                        named[key] = value
                        named_source[key] = "spill"
                    continue
                if named_started:
                    raise EvalError(f"{callee_name}: positional arguments cannot appear after named arguments")
                pos.extend(self._iter_positional_spread_items(spread_value))
                continue
            if named_started:
                raise EvalError(f"{callee_name}: positional arguments cannot appear after named arguments")
            pos.append(self.eval_expr(arg, env))
        return pos, named

    def _bind_vkf_params(
        self,
        params: list[ast.Param],
        raw_args: list[Any],
        env: dict[str, Any],
        *,
        callee_name: str,
    ) -> tuple[dict[str, Any], dict[str, int]]:
        pos, named = self._normalize_vkf_call_args(raw_args, env, callee_name=callee_name)
        param_names = [p.name for p in params]
        param_lookup = {p.name: p for p in params}
        for key in named:
            if key not in param_lookup:
                raise EvalError(f"{callee_name}: unknown argument {key!r}")
        if len(pos) > len(params):
            raise EvalError(f"{callee_name}: too many positional arguments")

        loc = dict(env)
        size_bindings: dict[str, int] = {}
        for index, param in enumerate(params):
            if param.name in named:
                raw_value = named[param.name]
            elif index < len(pos):
                raw_value = pos[index]
            elif param.default_expr is not None:
                raw_value = self.eval_expr(param.default_expr, loc)
            else:
                raise EvalError(f"{callee_name}: missing argument {param.name!r}")

            if param.type_ref is not None:
                coerced, size_bindings = coerce_typed_value(
                    raw_value,
                    param.type_ref,
                    self.types,
                    size_bindings,
                )
            else:
                coerced = self._coerce_param(raw_value, param)
            loc[param.name] = coerced
        return loc, size_bindings

    def _assign_bind(self, target: Any, val: Any, env: dict[str, Any]) -> None:
        if isinstance(target, ast.Ident):
            env[target.name] = val
            return
        if isinstance(target, ast.Attribute):
            if target.name == "idx":
                base = self.eval_expr(target.value, env)
                if not isinstance(base, AxisTaggedValue):
                    raise EvalError(".idx assignment requires an axis-tagged value")
                if not isinstance(val, str):
                    raise EvalError("idx must be a string")
                base.idx = val
                return
            root_name, keys = _attribute_chain(target)
            if root_name not in env:
                raise EvalError(
                    f"cannot assign struct field: {root_name!r} is not bound in this scope"
                )
            d = env[root_name]
            if runtime_collection_assign_path(d, keys, val):
                return
            if not isinstance(d, dict):
                raise EvalError("field bind requires struct")
            env[root_name] = _dict_set_path(d, keys, val)
            return
        if isinstance(target, ast.DottedIndex):
            if all(isinstance(ix, ast.Ident) for ix in target.indices):
                self.eval_expr(target.base, env)
                if not isinstance(val, (VFVector, tuple)):
                    raise EvalError(
                        "bind pattern .(name,…) requires a tuple or vector on the right"
                    )
                seq = tuple(val)
                if len(seq) != len(target.indices):
                    raise EvalError("bind pattern length does not match value")
                for ix, item in zip(target.indices, seq):
                    env[ix.name] = item
                return
            container = self.eval_expr(target.base, env)
            idxs = [self.eval_expr(i, env) for i in target.indices]
            n = len(idxs)
            if n == 0:
                raise EvalError("empty .() bind")
            if n == 1:
                _dotted_set_one(container, idxs[0], val)
                return
            if not isinstance(val, (VFVector, tuple)):
                raise EvalError("multi-index bind requires a tuple or vector value")
            vals = tuple(val)
            if len(vals) != n:
                raise EvalError("index count and value count must match")
            for i, v in zip(idxs, vals):
                _dotted_set_one(container, i, v)
            return
        raise EvalError("invalid bind target")

    def run_module(self, module: ast.Module) -> Any:
        env = self.globals
        # A file/module is an outer callable `:` scope: top-level `@:` returns from the file.
        self._return_scope_depth += 1
        try:
            for stmt in module.statements:
                try:
                    self.eval_stmt(stmt, env)
                except ReturnSignal as r:
                    return r.value
                except ContinueSignal:
                    raise EvalError("continue is not valid here (use `?>` / `??>` loops)")
                except BreakSignal:
                    raise EvalError("@| break outside >> pipe")
                except ExitProgramSignal as e:
                    sys.exit(e.code)
            return None
        finally:
            self._return_scope_depth -= 1

    def eval_stmt(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ast.ContinueStmt):
            raise ContinueSignal()
        if isinstance(node, ast.BreakStmt):
            raise BreakSignal()
        if isinstance(node, ast.ExitProgramStmt):
            raise ExitProgramSignal(0)
        if isinstance(node, ast.ReturnEmitStmt):
            if self._return_scope_depth <= 0:
                raise EvalError("@: return outside `:` scope")
            v = self.eval_expr(node.value, env)
            self._print_value(v, env)
            raise ReturnSignal(v)
        if isinstance(node, ast.ReturnStmt):
            if self._return_scope_depth <= 0:
                raise EvalError("@: return outside `:` scope")
            v = None if node.value is None else self.eval_expr(node.value, env)
            raise ReturnSignal(v)
        if isinstance(node, ast.MatchStmt):
            self._eval_match(node, env)
            return None
        if isinstance(node, ast.ConditionalExpr):
            self.eval_expr(node, env)
            return None
        if isinstance(node, ast.Bind):
            if node.declared_type is not None:
                value = self.eval_expr(node.value, env)
                resolved_type = self._resolve_runtime_type_expr(node.declared_type, env)
                coerced, _ = coerce_typed_value(value, resolved_type, self.types)
                self._assign_bind(node.target, coerced, env)
                return coerced
            if isinstance(node.target, ast.Ident) and isinstance(
                node.value, (ast.TypeExpr, ast.FuncType, ast.PrimTypeRef, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec)
            ):
                self.types[node.target.name] = node.value
                return None
            if isinstance(node.target, ast.Ident) and isinstance(
                node.value, ast.Ident
            ):
                tname = node.value.name
                if tname in ("num", "str", "bool"):
                    env[node.target.name] = default_field_value(tname, self.types)
                    return env[node.target.name]
            assigned = self.eval_expr(node.value, env)
            self._assign_bind(node.target, assigned, env)
            return assigned
        if isinstance(node, ast.Emit):
            val = self.eval_expr(node.value, env)
            if node.to_file is not None:
                raise EvalError(
                    "writing to a path via :: is removed; use io.write_text(path, text)"
                )
            self._print_value(val, env)
            return None
        if isinstance(node, ast.StdioPrint):
            val = self.eval_expr(node.value, env)
            self._print_value(val, env)
            return None
        if isinstance(node, ast.SpillImport):
            mod = self._eval_dot_module(node.path)
            if not isinstance(mod, dict):
                raise EvalError("spill import requires a module namespace")
            if node.alias is not None:
                # ``alias:.path`` — bind only, no spill.
                env[node.alias] = mod
            else:
                # ``:.path`` — spill exports only.
                short_name = node.path.segments[-1] if node.path.segments else ""
                for k, v in _spill_exports(mod, short_name).items():
                    env[k] = v
            return None
        if isinstance(node, ast.StdioReadLine):
            t = node.target
            if not isinstance(t, ast.Ident):
                raise EvalError("stdin read requires a simple name")
            line = sys.stdin.readline()
            line = "" if line == "" else line.rstrip("\r\n")
            env[t.name] = line
            return None
        if isinstance(node, ast.StdioPrompt):
            t = node.target
            if not isinstance(t, ast.Ident):
                raise EvalError("::: stdin prompt requires a simple name")
            print(f"{t.name}: ", end="", flush=True)
            line = sys.stdin.readline()
            line = "" if line == "" else line.rstrip("\r\n")
            env[t.name] = line
            return None
        if isinstance(node, ast.FuncDefStdin):
            if node.interactive_prompt:
                ps = ", ".join(p.name for p in node.params)
                print(f"{node.name}({ps}): ", end="", flush=True)
            line = sys.stdin.readline()
            line = "" if line == "" else line.rstrip("\r\n")
            from .parser import parse_expression

            body = parse_expression(line, filename=str(self.file_path))
            closure = dict(env)
            vf = VFunction(
                node.name, node.params, body, closure, None, field_sources={}
            )
            vf.ip = self
            closure[node.name] = vf
            env[node.name] = vf
            return None
        if isinstance(node, ast.FuncDef):
            body = node.body
            if _is_struct_ctor_body(body):
                if node.func_type is not None:
                    raise EvalError(
                        f"{node.name!r}: empty definition with `->` is invalid; "
                        "remove the return type or add a body"
                    )
                if node.name in OPERATOR_SYMBOLS:
                    raise EvalError(
                        f"{node.name!r}: operator overload must define an expression; "
                        "`:` alone is only for named type constructors"
                    )
                type_expr = ast.TypeExpr(
                    [(p.name, p.type_name or "any") for p in node.params]
                )
                self.types[node.name] = type_expr
                ctor = VStructCtor(node.name, node.params, dict(env))
                if node.name == "display" and len(node.params) == 1:
                    raise EvalError(
                        "display overload must be a function with a body, not a struct constructor"
                    )
                env[node.name] = ctor
                return None
            closure = dict(env)
            vf = VFunction(
                node.name,
                node.params,
                node.body,
                closure,
                node.func_type,
                field_sources=_collect_field_sources(node.body),
            )
            vf.ip = self
            closure[node.name] = vf
            if node.name == "display" and len(node.params) == 1:
                _validate_custom_unary_overload(node.params, "display(value: T)")
                self.display_overloads.append(vf)
            elif node.name in ("num", "str", "bool", "byte") and len(node.params) == 1:
                _validate_custom_unary_overload(node.params, f"{node.name}(value: T)")
                self.cast_overloads.setdefault(node.name, []).append(vf)
            elif node.name in OPERATOR_SYMBOLS:
                if node.name == ".":
                    if len(node.params) != 2:
                        raise EvalError("operator '.': expected exactly two parameters")
                    if not _param_is_custom_typed(node.params[0]):
                        raise EvalError("operator '.': first parameter must be a custom or constructed type")
                    if node.params[1].param_func_type is None and node.params[1].type_name is None:
                        raise EvalError("operator '.': second parameter must be typed")
                else:
                    _validate_custom_operator_overload(node.params, f"operator {node.name!r}")
                self.op_overloads.setdefault(node.name, []).append(vf)
                env[node.name] = OpCallable(node.name, self)
            else:
                env[node.name] = vf
            return None
        if isinstance(node, ast.ExprStmt):
            return self.eval_expr(node.expr, env)
        raise EvalError(f"unknown stmt {type(node).__name__}")

    def _match_eq(self, a: Any, b: Any) -> bool:
        return _exact_eq(a, b)

    def _match_specificity(self, a: Any, b: Any) -> int | None:
        """Return match specificity for ``??`` arm selection, or ``None`` when not matched."""
        if self._match_eq(a, b):
            return 1_000_000
        a_event_code = _event_object_code(a)
        if a_event_code is not None and isinstance(b, int):
            s = event_match_specificity(a_event_code, b)
            if s is not None:
                return s
            s = event_match_specificity(b, a_event_code)
            if s is not None:
                return s
            return None
        b_event_code = _event_object_code(b)
        if b_event_code is not None and isinstance(a, int):
            s = event_match_specificity(a, b_event_code)
            if s is not None:
                return s
            s = event_match_specificity(b_event_code, a)
            if s is not None:
                return s
            return None
        if isinstance(a, int) and isinstance(b, int):
            s = event_match_specificity(a, b)
            if s is not None:
                return s
            s = event_match_specificity(b, a)
            if s is not None:
                return s
            return None
        if isinstance(b, ErrorTypeValue) and isinstance(a, BaseException):
            return error_type_match_specificity(a, b)
        if is_type_value(b):
            actual = infer_type(a, self.types)
            s = _type_match_specificity(actual, b, self.types)
            if s is not None:
                return s
        return None

    def _eval_match_body(self, body: Any, env: dict[str, Any]) -> None:
        if isinstance(body, ast.Block):
            for stmt in body.statements:
                self.eval_stmt(stmt, env)
            return
        self.eval_expr(body, env)

    def _eval_match(self, node: ast.MatchStmt, env: dict[str, Any]) -> None:
        # Semantics: nested if/else over discriminant equality; ``$`` is the subject.
        # ``??>`` repeats automatically; ``??`` runs once.
        # Bind ``$`` in ``env`` (no copy): arm bodies must update the same dict as the discriminant sees.
        prev_dollar: Any = env.get("$", _NO_PREVIOUS_DOLLAR)
        try:
            if node.catch:
                try:
                    self.eval_expr(node.discriminant, env)
                    return
                except (ControlFlow, SystemExit):
                    raise
                except BaseException as exc:
                    disc = exc
                env["$"] = disc
                best_arm: ast.MatchArm | None = None
                best_spec = -1
                default_arm: ast.MatchArm | None = None
                for arm in node.arms:
                    if arm.condition is None:
                        if default_arm is None:
                            default_arm = arm
                        continue
                    m = self.eval_expr(arm.condition, env)
                    spec = self._match_specificity(disc, m)
                    if spec is None:
                        continue
                    if spec > best_spec:
                        best_spec = spec
                        best_arm = arm
                chosen = best_arm if best_arm is not None else default_arm
                if chosen is not None:
                    self._eval_match_body(chosen.body, env)
                    return
                raise disc
            while True:
                disc = self.eval_expr(node.discriminant, env)
                env["$"] = disc
                best_arm: ast.MatchArm | None = None
                best_spec = -1
                default_arm: ast.MatchArm | None = None
                for arm in node.arms:
                    if arm.condition is None:
                        if default_arm is None:
                            default_arm = arm
                        continue
                    m = self.eval_expr(arm.condition, env)
                    spec = self._match_specificity(disc, m)
                    if spec is None:
                        continue
                    if spec > best_spec:
                        best_spec = spec
                        best_arm = arm
                chosen = best_arm if best_arm is not None else default_arm
                if chosen is not None:
                    if node.loop:
                        try:
                            self._eval_match_body(chosen.body, env)
                        except ContinueSignal:
                            continue
                        except BreakSignal:
                            return
                    else:
                        self._eval_match_body(chosen.body, env)
                    if not node.loop:
                        return
                    continue
                return
        finally:
            if prev_dollar is _NO_PREVIOUS_DOLLAR:
                env.pop("$", None)
            else:
                env["$"] = prev_dollar

    def _eval_match_as_value(self, node: ast.MatchStmt, env: dict[str, Any]) -> Any:
        self._eval_match(node, env)
        return None

    def _axis_key_from_arrow_access(self, node: ast.AxisAlign, env: dict[str, Any]) -> str:
        if node.label is not None:
            return "i" if node.label == "_" else node.label
        assert node.indices is not None
        evaluated = [self.eval_expr(e, env) for e in node.indices]
        if len(evaluated) != 1:
            raise EvalError(
                "axis access `->(...)` expects exactly one index expression for axis tagging"
            )
        v = evaluated[0]
        if isinstance(v, str):
            return v
        if isinstance(v, bool):
            raise EvalError("axis key cannot be bool")
        if isinstance(v, int):
            return str(v)
        if isinstance(v, float):
            if math.isfinite(v) and math.floor(v) == v:
                return str(int(v))
            return str(v)
        raise EvalError(
            f"axis access for tagging expected string or number key, got {type(v).__name__}"
        )

    def _eval_axis_align(self, val: Any, node: ast.AxisAlign, env: dict[str, Any]) -> Any:
        axes = self._axis_key_from_arrow_access(node, env)
        if isinstance(val, AxisTaggedValue):
            raise EvalError(
                "axis alignment expects an untagged value; value is already axis-tagged"
            )
        if isinstance(val, LazyList):
            raise EvalError("axis alignment is not allowed on a lazy infinite range")
        if isinstance(val, dict):
            raise EvalError(
                "axis alignment is not allowed on structs or maps (use a vector, tuple, or multiset)"
            )
        if val is None or isinstance(val, (bool, int, float, str)):
            raise EvalError("axis alignment is not allowed on scalars or strings")
        if isinstance(val, (VFVector, tuple, Multiset)):
            return AxisTaggedValue(val, axes)
        raise EvalError(
            f"axis alignment is not supported for values of type {type(val).__name__}"
        )

    def eval_expr(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ast.ConditionalExpr):
            if node.loop:
                while True:
                    c = self.eval_expr(node.condition, env)
                    _disallow_vector_truthiness(c, "`?>` loop condition")
                    if not bool(c):
                        break
                    try:
                        self._eval_match_body(node.body, env)
                    except ContinueSignal:
                        continue
                    except BreakSignal:
                        return None
                return None
            c = self.eval_expr(node.condition, env)
            _disallow_vector_truthiness(c, "`?` condition")
            if not bool(c):
                return None
            self._eval_match_body(node.body, env)
            return None
        if isinstance(node, ast.MatchStmt):
            return self._eval_match_as_value(node, env)
        if isinstance(node, ast.NumberLit):
            return node.value
        if isinstance(node, ast.BoolLit):
            return node.value
        if isinstance(node, ast.NullLit):
            return None
        if isinstance(node, ast.StringLit):
            s = node.value
            if getattr(node, "raw", False):
                return s
            if "$" not in s:
                return s
            from .parser import parse_expression
            from .string_interpolate import interpolate_string

            def eval_inner(src: str) -> Any:
                sub = parse_expression(src, filename=str(self.file_path.name))
                return self.eval_expr(sub, env)

            def resolve_chain(path: str) -> Any:
                parts = path.split(".")
                if not parts:
                    raise EvalError("empty interpolation path")
                v = self._resolve(parts[0], env)
                for p in parts[1:]:
                    handled, stepped = runtime_collection_path_step(
                        v, p, missing_suffix=" in string interpolation"
                    )
                    if handled:
                        v = stepped
                    elif isinstance(v, dict):
                        if p not in v:
                            raise EvalError(
                                f"missing field {p!r} in string interpolation"
                            )
                        v = v[p]
                    elif getattr(type(v), "__vf_py_attrs__", False):
                        if not hasattr(v, p):
                            raise EvalError(
                                f"missing attribute {p!r} in string interpolation"
                            )
                        v = getattr(v, p)
                    else:
                        raise EvalError(
                            "string interpolation path requires a struct value"
                        )
                return v

            return interpolate_string(s, eval_inner, resolve_chain)
        if isinstance(node, ast.Ident):
            return self._resolve(node.name, env)
        if isinstance(node, ast.AxisAlign):
            return self._eval_axis_align(
                self.eval_expr(node.value, env), node, env
            )
        if isinstance(node, ast.TupleLit):
            out: list[Any] = []
            for e in node.elements:
                if isinstance(e, ast.SpreadArg):
                    v = self.eval_expr(e.expr, env)
                    if isinstance(v, AxisTaggedValue):
                        v = v.data
                    if isinstance(v, (tuple, VFVector)):
                        out.extend(v)
                    else:
                        raise EvalError(
                            "tuple spread (`:expr`) requires a tuple or vector value"
                        )
                    continue
                out.append(self.eval_expr(e, env))
            t = tuple(out)
            return t
        if isinstance(node, ast.ListLit):
            if len(node.elements) == 1 and isinstance(
                node.elements[0], ast.RangeExpr
            ):
                re0 = node.elements[0]
                if re0.end is None:
                    inner = self.eval_expr(re0, env)
                    if not isinstance(inner, LazyInfiniteIterator):
                        raise EvalError("internal: lazy range expected iterator")
                    return LazyList(inner)
                r = self.eval_expr(re0, env)
                seq = VFVector(r)
                return seq
            out = VFVectorBuilder()
            for e in node.elements:
                if isinstance(e, ast.MsetSpill):
                    m = self.eval_expr(e.expr, env)
                    out.extend(runtime_collection_spill_values(m))
                    continue
                if isinstance(e, ast.VectorRepeat):
                    v = self.eval_expr(e.value, env)
                    n = self.eval_expr(e.count, env)
                    if isinstance(n, bool) or not isinstance(n, (int, float)):
                        raise EvalError("vector repeat count must be a number")
                    if isinstance(n, float) and n != int(n):
                        raise EvalError("vector repeat count must be an integer")
                    k = int(n)
                    if k < 0:
                        raise EvalError("vector repeat count must be non-negative")
                    for _ in range(k):
                        out.append(v)
                    continue
                out.append(self.eval_expr(e, env))
            return out.build()
        if isinstance(node, ast.StructLit):
            return {
                name: self.eval_expr(val, env)
                for name, val in node.fields
            }
        if isinstance(node, ast.StructIdentity):
            return _local_scope_as_record(env)
        if isinstance(node, ast.MultisetLit):
            pairs: list[tuple[Any, Any]] = []
            for ke, ce in node.pairs:
                key = self.eval_expr(ke, env)
                pairs.append((key, self.eval_expr(ce, env)))
            m = runtime_collection_multiset_from_count_pairs(pairs)
            return m
        if isinstance(node, ast.RangeExpr):
            if node.end is None:
                if node.start is None:
                    return LazyInfiniteIterator(0)
                lo = self.eval_expr(node.start, env)
                if not isinstance(lo, (int, float)):
                    raise EvalError("lazy range start must be a number")
                return LazyInfiniteIterator(int(lo))
            if node.start is None:
                hi = self.eval_expr(node.end, env)
                if not isinstance(hi, (int, float)):
                    raise EvalError("range end must be a number")
                return _materialize_inclusive_range(0, int(hi))
            a = self.eval_expr(node.start, env)
            b = self.eval_expr(node.end, env)
            if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
                raise EvalError("range endpoints must be numbers")
            return _materialize_inclusive_range(int(a), int(b))
        if isinstance(node, ast.UnaryOp):
            return self._eval_unary(node, env)
        if isinstance(node, ast.StdinPipe):
            line = sys.stdin.readline()
            line = "" if line == "" else line.rstrip("\r\n")
            e2 = dict(env)
            e2["$"] = line
            return self.eval_expr(node.expr, e2)
        if isinstance(node, ast.PipeChain):
            return self._eval_pipe_chain(node, env)
        if isinstance(node, ast.BinOp):
            return self._eval_binop(node, env)
        if isinstance(node, ast.Lambda):
            params = [ast.Param(p, None) for p in node.params]
            vf = VFunction(
                None, params, node.body, dict(env), None, field_sources={}
            )
            vf.ip = self
            return vf
        if isinstance(node, ast.OpRef):
            return OpCallable(node.symbol, self)
        if isinstance(node, ast.Call):
            fn = self.eval_expr(node.func, env)
            pos, kw, spreads = self._eval_call_args(node.args, env)
            ctor_result = runtime_collection_ctor_call(fn, pos, kw, spreads)
            if ctor_result is not None:
                return ctor_result
            if isinstance(fn, OpCallable):
                if kw or spreads:
                    raise EvalError(f"operator calls do not accept keyword or spread arguments")
                return fn(*pos)
            if isinstance(fn, PrimType):
                if kw or spreads:
                    raise EvalError("type casts do not accept keyword or spread arguments")
                if len(pos) == 1:
                    variants = self.cast_overloads.get(fn.name) or []
                    cast_fn = _pick_best_overload([f for f in variants if len(f.params) == 1], pos, self.types)
                    if cast_fn is not None:
                        return self._call(cast_fn, pos, env)
                return fn(*pos)
            if isinstance(fn, VStructCtor):
                return self._call_struct_ctor(fn, node.args, env)
            if isinstance(fn, VFunction):
                return self._call(fn, node.args, env)
            if kw or spreads:
                if spreads:
                    raise EvalError("this call does not support spread arguments")
                if callable(fn):
                    return fn(*pos, **kw)
                raise EvalError(
                    "this call does not accept keyword or spread arguments"
                )
            return self._call(fn, pos, env)
        if isinstance(node, ast.Attribute):
            o = self.eval_expr(node.value, env)
            if node.name == "idx" and isinstance(o, AxisTaggedValue):
                return o.idx
            if isinstance(o, VStructCtor):
                raise EvalError(
                    f"{o.name} is a struct constructor; call {o.name}(...) to get a value"
                )
            if isinstance(o, VFunction):
                param_names = {p.name for p in o.params}
                if node.name in param_names:
                    raise EvalError(
                        f"cannot read parameter {node.name!r} on function; "
                        "it is only bound when the function is called"
                    )
                if node.name in o.field_sources:
                    rhs = o.field_sources[node.name]
                    if _expr_refs_param(rhs, param_names):
                        return _expr_to_compact_string(rhs)
                    e2 = dict(o.closure)
                    return self.eval_expr(rhs, e2)
                raise EvalError(
                    f"function has no body binding {node.name!r}"
                )
            collection_attr = runtime_collection_read_attr(o, node.name)
            if collection_attr is not None:
                return collection_attr
            if isinstance(o, dict):
                if node.name in o:
                    return o[node.name]
                if is_struct_dict(o):
                    variants = self.op_overloads.get(".") or []
                    fn = _pick_best_overload([f for f in variants if len(f.params) == 2], [o, node.name], self.types)
                    if fn is not None:
                        return self._call(fn, [o, node.name], env)
                raise EvalError(f"missing field {node.name!r}")
            if getattr(type(o), "__vf_py_attrs__", False):
                if not hasattr(o, node.name):
                    raise EvalError(f"missing attribute {node.name!r}")
                return getattr(o, node.name)
            raise EvalError("attribute access on non-struct")
        if isinstance(node, ast.DottedIndex):
            base = self.eval_expr(node.base, env)
            keys = [self.eval_expr(i, env) for i in node.indices]
            if len(keys) == 0:
                raise EvalError("empty .()")
            if len(keys) == 1:
                try:
                    return _dotted_get_one(base, keys[0])
                except Exception:
                    if isinstance(base, dict) and is_struct_dict(base):
                        variants = self.op_overloads.get(".") or []
                        fn = _pick_best_overload([f for f in variants if len(f.params) == 2], [base, keys[0]], self.types)
                        if fn is not None:
                            return self._call(fn, [base, keys[0]], env)
                    raise
            return tuple(_dotted_get_one(base, k) for k in keys)
        if isinstance(node, ast.AbsExpr):
            from .runtime.absnorm import abs_or_norm

            return abs_or_norm(self.eval_expr(node.inner, env))
        if isinstance(node, ast.DotModulePath):
            return self._eval_dot_module(node)
        if isinstance(node, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.MapValueType, ast.LinkedListValueType, ast.NamedTypeSpec, ast.TypeSizeConst, ast.TypeSizeVar, ast.TypeSizeBinOp)):
            return node
        if isinstance(node, ast.TypeOf):
            v = self.eval_expr(node.value, env)
            return infer_type(v, self.types)
        raise EvalError(f"unknown expr {type(node).__name__}")

    def _dispatch_op_call(self, sym: str, args: list[Any]) -> Any:
        variants = self.op_overloads.get(sym) or []
        fns = [f for f in variants if len(f.params) == len(args)]
        fn = _pick_best_overload(fns, args, self.types)
        if fn is None:
            raise EvalError(f"no matching overload for {sym!r} with {len(args)} argument(s)")
        return self._call(fn, args, self.globals)

    def _coerce_param(self, val: Any, p: ast.Param) -> Any:
        if p.type_ref is not None:
            coerced, _ = coerce_typed_value(val, p.type_ref, self.types)
            return coerced
        if p.param_func_type is not None:
            if not isinstance(val, VFunction):
                raise EvalError(f"expected {p.name} to be a function")
            if val.func_type is None:
                inferred = infer_type(val, self.types)
                if not types_equal(inferred, p.param_func_type):
                    raise EvalError(
                        f"{p.name}: function value does not match the declared type"
                    )
            else:
                if not types_equal(val.func_type, p.param_func_type):
                    raise EvalError(
                        f"{p.name}: function value does not match the declared type"
                    )
            return val
        return coerce_value(val, p.type_name)

    def _call(self, fn: Any, args: list[Any], env: dict[str, Any]) -> Any:
        if isinstance(fn, VFunction):
            if _contains_ast_nodes(args):
                loc, size_bindings = self._bind_vkf_params(
                    fn.params,
                    args,
                    env,
                    callee_name=fn.name or "$",
                )
            else:
                if len(args) != len(fn.params):
                    required = sum(1 for p in fn.params if p.default_expr is None)
                    if not (required <= len(args) <= len(fn.params)):
                        raise EvalError(
                            f"{fn.name or '$'}: expected between {required} and {len(fn.params)} argument(s), got {len(args)}"
                        )
                loc = dict(fn.closure)
                size_bindings: dict[str, int] = {}
                for index, p in enumerate(fn.params):
                    if index < len(args):
                        a = args[index]
                    elif p.default_expr is not None:
                        a = self.eval_expr(p.default_expr, loc)
                    else:
                        raise EvalError(f"{fn.name or '$'}: missing argument {p.name!r}")
                    if p.type_ref is not None:
                        coerced, size_bindings = coerce_typed_value(a, p.type_ref, self.types, size_bindings)
                        loc[p.name] = coerced
                    else:
                        loc[p.name] = self._coerce_param(a, p)
            result = self._eval_function_body(fn.body, loc)
            if fn.func_type is not None:
                resolved_return = resolve_return_type(fn.func_type.codomain, size_bindings)
                result, _ = coerce_typed_value(result, resolved_return, self.types, size_bindings)
            return result
        if isinstance(fn, VStructCtor):
            return self._call_struct_ctor(fn, list(args), env)
        if callable(fn):
            return fn(*args)
        raise EvalError(f"not callable: {type(fn).__name__}")

    def _call_struct_ctor(
        self,
        fn: VStructCtor,
        raw_args: list[Any],
        env: dict[str, Any],
    ) -> Any:
        if _contains_ast_nodes(raw_args):
            loc, _ = self._bind_vkf_params(
                fn.params,
                raw_args,
                env,
                callee_name=fn.name,
            )
        else:
            required = sum(1 for p in fn.params if p.default_expr is None)
            if not (required <= len(raw_args) <= len(fn.params)):
                raise EvalError(
                    f"{fn.name}: expected between {required} and {len(fn.params)} argument(s), got {len(raw_args)}"
                )
            loc = dict(fn.closure)
            for index, p in enumerate(fn.params):
                if index < len(raw_args):
                    a = raw_args[index]
                elif p.default_expr is not None:
                    a = self.eval_expr(p.default_expr, loc)
                else:
                    raise EvalError(f"{fn.name}: missing argument {p.name!r}")
                loc[p.name] = self._coerce_param(a, p)
        return with_type(
            fn.name,
            {p.name: loc[p.name] for p in fn.params},
        )

    def _eval_function_body(self, body: Any, env: dict[str, Any]) -> Any:
        """Implicit return: only the last *function-scope* statement counts.

        If that statement is an expression, its value is the function result (no ``@:``).
        The last line inside a nested block is not the function return;
        use ``@:`` to return from the callable. Early return is always ``@:``.
        """
        self._return_scope_depth += 1
        try:
            if isinstance(body, ast.Block):
                result: Any = None
                try:
                    for stmt in body.statements:
                        result = self.eval_stmt(stmt, env)
                except ReturnSignal as r:
                    return r.value
                return result
            try:
                return self.eval_expr(body, env)
            except ReturnSignal as r:
                return r.value
        finally:
            self._return_scope_depth -= 1

    def _print_value(self, val: Any, env: dict[str, Any]) -> None:
        s = self._stringify_for_display(val, env)
        # No implicit newline: ``:: expr`` prints exactly ``s``; use ``::: expr`` (sugar for
        # ``:: (expr & "\\n")``) or embed ``\\n`` in the value for line-oriented output.
        print(s, end="", flush=True)

    def _pick_unary_overload(self, variants: list[VFunction], val: Any) -> VFunction | None:
        best_fn: VFunction | None = None
        best_s = -1
        for fn in variants:
            if len(fn.params) != 1:
                continue
            s = _score_params_match(fn, [val], self.types)
            if s is None:
                continue
            if s > best_s:
                best_s = s
                best_fn = fn
        return best_fn

    def _stringify_for_display(self, val: Any, env: dict[str, Any]) -> str:
        if self.display_overloads:
            best_fn = self._pick_unary_overload(self.display_overloads, val)
            if best_fn is not None:
                shown = self._call(best_fn, [val], env)
                return _stringify(shown, self.types)
        str_variants = self.cast_overloads.get("str") or []
        if str_variants:
            cast_fn = self._pick_unary_overload(str_variants, val)
            if cast_fn is not None:
                shown = self._call(cast_fn, [val], env)
                return _stringify(shown, self.types)
        return _stringify(val, self.types)

    def _eval_unary(self, node: ast.UnaryOp, env: dict[str, Any]) -> Any:
        v = self.eval_expr(node.operand, env)
        sym = UNARY_KIND_TO_SYM.get(node.op)
        if sym and isinstance(v, dict) and is_struct_dict(v):
            variants = self.op_overloads.get(sym) or []
            f1 = [f for f in variants if len(f.params) == 1]
            fn = _pick_best_overload(f1, [v], self.types)
            if fn is not None:
                return self._call(fn, [v], env)
        if node.op == "MINUS":
            if isinstance(v, dict):
                raise EvalError("struct negation requires -(a): … overload")
            return -v
        if node.op == "NOT":
            if _is_bool_structure(v):
                return _negate_bool_structure(v)
            _disallow_vector_truthiness(v, "`not` / `~`")
            return not bool(v)
        raise EvalError(f"unknown unary {node.op}")

    def _pipe_bind_dollar(self, rhs: Any, env: dict[str, Any], dollar: Any) -> Any:
        """Pipe RHS is an expression or ``;``-separated stmts (``Block``): ``::$``, ``$? …``, etc."""
        e2 = dict(env)
        e2["$"] = dollar
        if isinstance(rhs, ast.Block):
            last: Any = None
            for stmt in rhs.statements:
                last = self.eval_stmt(stmt, e2)
            return last
        return self.eval_expr(rhs, e2)

    def _pipe_one_element_through_segments(
        self, el: Any, segs: list[Any], env: dict[str, Any]
    ) -> Any:
        """Run ``el`` through every ``>>`` segment in order (single streaming step)."""
        v = el
        for seg in segs:
            v = self._pipe_bind_dollar(seg, env, v)
        return v

    def _eval_pipe_chain(self, node: ast.PipeChain, env: dict[str, Any]) -> Any:
        """One element at a time through the whole chain; ``@|`` / ``@>`` respect outer iteration."""
        left_v = self.eval_expr(node.source, env)
        segs = node.segments
        if not segs:
            return left_v

        def _foreach_element(
            fn: Any,
        ) -> None:
            if isinstance(left_v, AxisTaggedValue):
                d = left_v.data
                if isinstance(d, tuple):
                    for el in d:
                        try:
                            fn(el)
                        except BreakSignal:
                            break
                        except ContinueSignal:
                            continue
                    return
                runtime_values = runtime_collection_elementwise_values(d)
                if runtime_values is not None:
                    for el in runtime_values:
                        try:
                            fn(el)
                        except BreakSignal:
                            break
                        except ContinueSignal:
                            continue
                    return
                try:
                    fn(left_v)
                except BreakSignal:
                    return
                except ContinueSignal:
                    return
                return
            if isinstance(left_v, tuple):
                for el in left_v:
                    try:
                        fn(el)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            if isinstance(left_v, VFVector):
                for el in left_v:
                    try:
                        fn(el)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            if isinstance(left_v, str):
                for ch in left_v:
                    try:
                        fn(ch)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            if isinstance(left_v, frozenset):
                for el in left_v:
                    try:
                        fn(el)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            if isinstance(left_v, set):
                for el in left_v:
                    try:
                        fn(el)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            runtime_values = runtime_collection_elementwise_values(left_v)
            if runtime_values is not None:
                for el in runtime_values:
                    try:
                        fn(el)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            if isinstance(left_v, LazyInfiniteIterator):
                for el in left_v:
                    try:
                        fn(el)
                    except BreakSignal:
                        break
                    except ContinueSignal:
                        continue
                return
            try:
                fn(left_v)
            except BreakSignal:
                return
            except ContinueSignal:
                return

        if isinstance(left_v, AxisTaggedValue):
            d = left_v.data
            if isinstance(d, (tuple, VFVector)):
                out_t: list[Any] = []

                def _collect(el: Any) -> None:
                    out_t.append(
                        self._pipe_one_element_through_segments(el, segs, env)
                    )

                _foreach_element(_collect)
                tagged_result: Any = tuple(out_t) if isinstance(d, tuple) else VFVector(out_t)
                return AxisTaggedValue(tagged_result, left_v.idx)
            if runtime_collection_preserves_pipe_result(d):
                out: list[Any] = []

                def _mset(el: Any) -> None:
                    out.append(self._pipe_one_element_through_segments(el, segs, env))

                _foreach_element(_mset)
                handled, mapped = runtime_collection_pipe_result(d, out)
                if handled:
                    return AxisTaggedValue(mapped, left_v.idx)
            return self._pipe_one_element_through_segments(left_v, segs, env)

        if isinstance(left_v, tuple):
            out: list[Any] = []

            def _t(el: Any) -> None:
                out.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_t)
            return tuple(out)
        if isinstance(left_v, VFVector):
            out_l: list[Any] = []

            def _l(el: Any) -> None:
                out_l.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_l)
            return VFVector(out_l)
        if isinstance(left_v, str):
            parts: list[str] = []

            def _s(ch: Any) -> None:
                parts.append(
                    str(self._pipe_one_element_through_segments(ch, segs, env))
                )

            _foreach_element(_s)
            return "".join(parts)
        if isinstance(left_v, frozenset):
            out_f: list[Any] = []

            def _f(el: Any) -> None:
                out_f.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_f)
            return frozenset(out_f)
        if isinstance(left_v, set):
            out_s: list[Any] = []

            def _st(el: Any) -> None:
                out_s.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_st)
            return set(out_s)
        if runtime_collection_preserves_pipe_result(left_v):
            out_ms: list[Any] = []

            def _ms(el: Any) -> None:
                out_ms.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_ms)
            handled, mapped = runtime_collection_pipe_result(left_v, out_ms)
            if handled:
                return mapped
        if isinstance(left_v, LazyInfiniteIterator):

            def _lazy(el: Any) -> None:
                self._pipe_one_element_through_segments(el, segs, env)

            _foreach_element(_lazy)
            return None
        return self._pipe_one_element_through_segments(left_v, segs, env)

    def _eval_binop(self, node: ast.BinOp, env: dict[str, Any]) -> Any:
        if node.op == "PIPE":
            raise EvalError("internal: use PipeChain for `>>`, not BinOp(PIPE)")
        a = self.eval_expr(node.left, env)
        b = self.eval_expr(node.right, env)
        if node.op == "EXACT_EQ":
            return _exact_eq(a, b)
        if node.op == "NEQ":
            return not _exact_eq(a, b)
        if node.op == "EQ" and is_type_value(a) and is_type_value(b):
            return _type_matches(a, b, self.types) or _type_matches(b, a, self.types)
        if node.op == "STRUCT_NEQ" and is_type_value(a) and is_type_value(b):
            return not (
                _type_matches(a, b, self.types) or _type_matches(b, a, self.types)
            )
        sym = BINOP_KIND_TO_SYM.get(node.op)
        sd = bool(is_struct_dict(a) and is_struct_dict(b))
        if node.op not in ("EXACT_EQ", "NEQ") and sym and (is_struct_dict(a) or is_struct_dict(b)):
            variants = self.op_overloads.get(sym) or []
            f2 = [f for f in variants if len(f.params) == 2]
            fn = _pick_best_overload(f2, [a, b], self.types)
            if fn is not None:
                return self._call(fn, [a, b], env)
        if node.op in ("LT", "LE", "GT", "GE", "EQ", "STRUCT_NEQ"):
            if is_struct_dict(a) or is_struct_dict(b) or isinstance(a, Multiset) or isinstance(b, Multiset):
                return _structural_compare(node.op, a, b)
        if node.op in ("AND", "OR", "XOR") and (_is_bool_structure(a) or _is_bool_structure(b)):
            return _logical_structure_binop(node.op, a, b)
        if sym and sd:
            if node.op == "AMPERSAND":
                return _struct_merge_concat(a, b)
            if node.op in ("LT", "LE", "GT", "GE", "EQ", "STRUCT_NEQ"):
                return _structural_compare(node.op, a, b)
            if node.op in (
                "PLUS",
                "MINUS",
                "STAR",
                "SLASH",
                "PERCENT",
                "CARET",
            ):
                defaulted = _default_struct_elementwise_binop(
                    node.op, a, b, self.types
                )
                if defaulted is not None:
                    return defaulted
            if node.op == "PLUS":
                raise EvalError(
                    "struct + struct requires a +(a, b): … overload "
                    "(same field names and types, or define + with two parameters)"
                )
            raise EvalError(
                f"no overload for {sym} on two structs; define {sym}(a, b): …"
            )
        if node.op == "PLUS":
            if isinstance(a, str) and not isinstance(b, str):
                return a + _stringify(b, self.types)
            if isinstance(b, str) and not isinstance(a, str):
                return _stringify(a, self.types) + b
        if node.op == "AMPERSAND":
            if isinstance(a, str) and not isinstance(b, str):
                return a + _stringify(b, self.types)
            if isinstance(b, str) and not isinstance(a, str):
                return _stringify(a, self.types) + b
        return _binop(node.op, a, b)

    def _eval_dot_module(self, path: ast.DotModulePath) -> Any:
        segs = path.segments
        cache_key = ("dot", str(self.base_dir), tuple(segs))
        if cache_key in self.module_cache:
            return self.module_cache[cache_key]

        try:
            resolved = resolve_dot_module(self.base_dir, segs)
        except FileNotFoundError:
            if len(segs) == 1 and segs[0] in STDLIB_MODULES:
                m = resolve_stdlib(segs[0])
                self.module_cache[cache_key] = m
                return m
            raise EvalError(f"module not found: {segs!r}") from None

        if resolved.is_file():
            ns = self._load_vkf_file(resolved)
            self.module_cache[cache_key] = ns
            return ns
        if resolved.is_dir():
            ns = self._load_folder(resolved)
            self.module_cache[cache_key] = ns
            return ns
        raise EvalError(f"not a file or directory: {resolved}")

    def _eval_use(self, spec: str) -> Any:
        """Legacy string path resolution (e.g. tests, tooling)."""
        cache_key = f"{self.base_dir}::{spec}"
        if cache_key in self.module_cache:
            return self.module_cache[cache_key]

        try:
            path = resolve_use_path(self.base_dir, spec)
        except FileNotFoundError:
            if spec in STDLIB_MODULES:
                m = resolve_stdlib(spec)
                self.module_cache[cache_key] = m
                return m
            raise EvalError(f"use: path not found {spec!r}") from None

        if path.is_file():
            ns = self._load_vkf_file(path)
            self.module_cache[cache_key] = ns
            return ns
        if path.is_dir():
            ns = self._load_folder(path)
            self.module_cache[cache_key] = ns
            return ns
        raise EvalError(f"use: not a file or directory: {path}")

    def _load_vkf_file(self, path: Path) -> dict[str, Any]:
        from .parser import parse_module

        source = path.read_text(encoding="utf-8")
        mod = parse_module(source, filename=str(path))
        child = Interpreter(path)
        child.module_cache = self.module_cache
        child.builtin = {}
        child._merge_stdlibs()
        child.globals = {}
        child.run_module(mod)
        self.types.update(child.types)
        for k, vs in child.op_overloads.items():
            self.op_overloads.setdefault(k, []).extend(vs)
        self.display_overloads.extend(child.display_overloads)
        return _exports(child.globals)

    def _load_folder(self, folder: Path) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for p in sorted(folder.iterdir()):
            if p.name.startswith("_"):
                continue
            if p.is_file() and p.suffix.lower() == ".vkf":
                out[p.stem] = self._load_vkf_file(p)
            elif p.is_dir():
                out[p.name] = self._load_folder(p)
        return out


def _attribute_chain(target: ast.Attribute) -> tuple[str, list[str]]:
    keys: list[str] = []
    cur: Any = target
    while isinstance(cur, ast.Attribute):
        keys.append(cur.name)
        cur = cur.value
    if not isinstance(cur, ast.Ident):
        raise EvalError("invalid struct bind target")
    keys.reverse()
    return cur.name, keys


def _dict_set_path(d: dict, keys: list[str], val: Any) -> dict:
    """Immutable struct update: new dict tree with ``keys`` set to ``val``."""
    if len(keys) == 1:
        out = dict(d)
        out[keys[0]] = val
        return out
    k0 = keys[0]
    child = d.get(k0)
    if not isinstance(child, dict):
        child = {}
    out = dict(d)
    out[k0] = _dict_set_path(dict(child), keys[1:], val)
    return out


def _exports(env: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in env.items() if not k.startswith("_")}


def _spill_exports(env: dict[str, Any], short_name: str) -> dict[str, Any]:
    return {
        k: v for k, v in _exports(env).items()
        if k != short_name
    }


def _builtin_take(n: Any, seq: Any) -> tuple[Any, ...]:
    from itertools import islice

    if not isinstance(n, (int, float)) or (isinstance(n, float) and n != int(n)):
        raise EvalError("take: first argument must be an integer")
    k = int(n)
    if k < 0:
        raise EvalError("take: count must be non-negative")
    if isinstance(seq, AxisTaggedValue):
        return _builtin_take(k, seq.data)
    if isinstance(seq, LazyList):
        return seq.take_prefix(k)
    if isinstance(seq, LazyInfiniteIterator):
        return tuple(islice(seq, k))
    runtime_taken = runtime_collection_take(seq, k)
    if runtime_taken is not None:
        return runtime_taken
    if isinstance(seq, (VFVector, tuple)):
        return tuple(seq[:k])
    if isinstance(seq, (str, bytes)):
        raise EvalError("take: use a sequence or iterator, not str/bytes")
    if isinstance(seq, dict):
        raise EvalError("take: use a sequence or iterator, not dict")
    try:
        return tuple(islice(iter(seq), k))
    except TypeError:
        raise EvalError("take: expected lazy range, lazy list, list, tuple, or iterable")


def _builtin_to_list(n: Any, seq: Any) -> list[Any]:
    """Materialize the first ``n`` elements of a generator or sequence into a Python list."""
    return list(_builtin_take(n, seq))


def _builtin_to_multiset(n: Any, seq: Any) -> Multiset:
    """Build a multiset from the first ``n`` elements (count 1 per occurrence)."""
    return runtime_collection_to_multiset(_builtin_take(n, seq))


def _dotted_get_one(base: Any, k: Any) -> Any:
    if isinstance(base, AxisTaggedValue):
        return _dotted_get_one(base.data, k)
    if isinstance(base, LazyList):
        return base.get_at(_normalize_index(k))
    handled, value = runtime_collection_index_read(base, _normalize_index(k))
    if handled:
        return value
    if isinstance(base, VFVector):
        return base[_normalize_index(k)]
    if isinstance(base, dict):
        if k not in base:
            raise EvalError(f"missing key {k!r}")
        return base[k]
    if isinstance(base, tuple):
        return base[_normalize_index(k)]
    if isinstance(base, str):
        return base[_normalize_index(k)]
    raise EvalError(".(...) on unsupported value")


def _dotted_set_one(container: Any, k: Any, val: Any) -> None:
    if isinstance(container, LazyList):
        raise EvalError("cannot assign through index on lazy list")
    if runtime_collection_index_set(container, _normalize_index(k), val):
        return
    if isinstance(container, VFVector):
        container[_normalize_index(k)] = val
    elif isinstance(container, dict):
        container[k] = val
    else:
        raise EvalError("cannot assign through .() on this value")


def _normalize_index(idx: Any) -> Any:
    if isinstance(idx, bool):
        raise EvalError("index must be int or str")
    if isinstance(idx, float) and idx == int(idx):
        return int(idx)
    if isinstance(idx, int):
        return idx
    if isinstance(idx, str):
        return idx
    raise EvalError("index must be int or str")


def _materialize_inclusive_range(lo: int, hi: int) -> tuple:
    if lo <= hi:
        return tuple(range(lo, hi + 1))
    return tuple(range(lo, hi - 1, -1))


def _format_tagged_struct_record(
    v: dict[str, Any],
    types: dict[str, ast.TypeExpr | ast.FuncType] | None,
) -> str:
    """Print tagged values as ``Point(x:1, y:2)`` (constructor-style; field order from the type when known)."""
    tname = get_type_name(v)
    if not tname:
        keys = [k for k in v if k != VF_TYPE_KEY]
        parts = [f"{k}:{_stringify(v[k], types)}" for k in keys]
        return f"({', '.join(parts)})"
    keys: list[str]
    if types is not None and tname in types:
        spec = types[tname]
        if isinstance(spec, ast.TypeExpr):
            keys = [f[0] for f in spec.fields if f[0] in v and f[0] != VF_TYPE_KEY]
        else:
            keys = [k for k in v if k != VF_TYPE_KEY]
    else:
        keys = [k for k in v if k != VF_TYPE_KEY]
    parts: list[str] = []
    for k in keys:
        parts.append(f"{k}:{_stringify(v[k], types)}")
    return f"{tname}({', '.join(parts)})"


def _stringify_op_callable(o: OpCallable) -> str:
    variants = o.ip.op_overloads.get(o.symbol) or []
    if variants:
        return _format_vfunction_display(variants[0])
    return f"{o.symbol}(…)"


def _stringify(
    v: Any,
    types: dict[str, ast.TypeExpr | ast.FuncType] | None = None,
) -> str:
    if isinstance(v, VFunction):
        return _format_vfunction_display(v)
    if isinstance(v, VStructCtor):
        return _format_vstruct_ctor_display(v)
    if isinstance(v, OpCallable):
        return _stringify_op_callable(v)
    if isinstance(v, PrimType):
        return v.name
    if isinstance(v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec, ast.TypeSizeConst, ast.TypeSizeVar, ast.TypeSizeBinOp)):
        return _format_type_ast_for_stringify(v)
    if isinstance(v, dict) and is_struct_dict(v):
        if struct_tagged(v):
            return _format_tagged_struct_record(v, types)
        return _format_untagged_dict_as_record(v, types)
    if isinstance(v, AxisTaggedValue):
        return _stringify(v.data, types)
    runtime_string = runtime_collection_stringify(
        v,
        lambda item: _stringify(item, types),
    )
    if runtime_string is not None:
        return runtime_string
    if isinstance(v, LazyInfiniteIterator):
        return f"range from {v.start}"
    if isinstance(v, LazyList):
        return f"lazy list from {v._it.start}"
    if isinstance(v, bool):
        return _vf_bool_display(v)
    if v is None:
        return "null"
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    if isinstance(v, complex):
        return str(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, (bytes, bytearray)):
        hx = v.hex()
        if len(hx) > 64:
            return f"byte(len {len(v)})"
        return f"byte[{hx}]"
    if isinstance(v, VFVector):
        return "[" + ", ".join(_stringify(x, types) for x in v) + "]"
    if isinstance(v, tuple):
        if len(v) == 1:
            return f"({_stringify(v[0], types)},)"
        return "(" + ", ".join(_stringify(x, types) for x in v) + ")"
    if isinstance(v, (set, frozenset)):
        if not v:
            return "{}"
        ordered = sorted(v, key=lambda x: (str(type(x).__name__), str(x)))
        return "{" + ", ".join(_stringify(x, types) for x in ordered) + "}"
    if getattr(type(v), "__vf_py_attrs__", False):
        # Host-backed values (e.g. UI events): print their public attributes as a record.
        try:
            attrs = vars(v)
        except TypeError:
            attrs = None
        if isinstance(attrs, dict):
            keys = [k for k in attrs.keys() if not str(k).startswith("_")]
            keys.sort(key=lambda k: str(k))
            parts = [f"{k}:{_stringify(attrs[k], types)}" for k in keys]
            return "(" + ", ".join(parts) + ")"
        return str(v)
    return "…"


def _disallow_vector_truthiness(v: Any, what: str) -> None:
    """Vectors are not booleans; use element-wise comparisons or a ``??`` match."""
    if isinstance(v, (VFVector, TypedVector)):
        raise EvalError(
            f"{what}: a vector cannot be used as a boolean "
            "(use element-wise `=`, `<`, `>`, …, or a `??` match on a value)"
        )


def _axis_broadcast_tagged_binop(op: str, a: AxisTaggedValue, b: AxisTaggedValue) -> Any:
    """When ``a.idx != b.idx``: outer axis ``a.idx``, inner ``b.idx``.

    Each cell is ``_binop(op, x, y)``. ``&`` is excluded: concatenation stays along
    one shared axis only.

    Result is nested axis tags; stringification peels tags and shows a plain grid
    (e.g. ``[1,2]->i + [3,5]->j`` → ``[[4, 6], [5, 7]]``).
    """
    if op == "AMPERSAND":
        raise EvalError(
            "`&` concatenates along a single axis only; it does not broadcast across different axis names"
        )
    return axis_broadcast_binary(lambda x, y: _binop(op, x, y), a, b)


def _struct_merge_concat(a: dict, b: dict) -> dict:
    """``a & b`` for structs: fields from ``a`` then ``b``; duplicate keys take ``b``."""
    ta, tb = get_type_name(a), get_type_name(b)
    out: dict[str, Any] = {}
    for k, v in a.items():
        if k == VF_TYPE_KEY:
            continue
        out[k] = v
    for k, v in b.items():
        if k == VF_TYPE_KEY:
            continue
        out[k] = v
    if ta and ta == tb:
        return with_type(ta, out)
    return with_type(None, out)


def _binop(op: str, a: Any, b: Any) -> Any:
    if isinstance(a, AxisTaggedValue) and isinstance(b, AxisTaggedValue):
        if a.idx != b.idx:
            return _axis_broadcast_tagged_binop(op, a, b)
        ad, bd = a.data, b.data
        if op == "AMPERSAND":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                return AxisTaggedValue(ad + bd, a.idx)
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                return AxisTaggedValue(_wrap_vector_result_if_typed(op, chain(ad, bd), ad, bd), a.idx)
            raise EvalError(
                "unsupported types inside axis-tagged values for & "
                "(use tuple or vector)"
            )
        if op == "PLUS":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for +")
                return AxisTaggedValue(
                    tuple(x + y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for +")
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x + y for x, y in zip(ad, bd)),
                        ad,
                        bd,
                    ),
                    a.idx,
                )
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(multiset_union(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a.idx,
                )
        if op == "MINUS":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for -")
                return AxisTaggedValue(
                    tuple(x - y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for -")
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x - y for x, y in zip(ad, bd)),
                        ad,
                        bd,
                    ),
                    a.idx,
                )
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(multiset_difference(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a.idx,
                )
        if op == "STAR":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for *")
                return AxisTaggedValue(
                    tuple(x * y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for *")
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x * y for x, y in zip(ad, bd)),
                        ad,
                        bd,
                    ),
                    a.idx,
                )
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                raise EvalError("operator * is not defined for multisets")
        if op == "SLASH":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for /")
                return AxisTaggedValue(
                    tuple(x / y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for /")
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x / y for x, y in zip(ad, bd)),
                        ad,
                        bd,
                    ),
                    a.idx,
                )
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return AxisTaggedValue(_multiset_division_struct(ad, bd), a.idx)
        if op == "FLOORDIV":
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                try:
                    return AxisTaggedValue(
                        wrap_typed_multiset_result(
                            multiset_countwise_floordiv(ad, bd),
                            combine_typed_multiset_types(ad, bd),
                        ),
                        a.idx,
                    )
                except KeyError as e:
                    raise EvalError(str(e)) from e
        if op == "PERCENT":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for %")
                return AxisTaggedValue(
                    tuple(x % y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for %")
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x % y for x, y in zip(ad, bd)),
                        ad,
                        bd,
                    ),
                    a.idx,
                )
        if op == "CARET":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for ^")
                return AxisTaggedValue(
                    tuple(x**y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for ^")
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x**y for x, y in zip(ad, bd)),
                        ad,
                        bd,
                    ),
                    a.idx,
                )
        if op in ("EQ", "NEQ", "LT", "LE", "GT", "GE"):
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for relational op")
                return AxisTaggedValue(
                    tuple(_binop(op, x, y) for x, y in zip(ad, bd)),
                    a.idx,
                )
            if isinstance(ad, VFVector) and isinstance(bd, VFVector):
                if len(ad) != len(bd):
                    raise EvalError("vector length mismatch for relational op")
                return AxisTaggedValue(
                    VFVector(_binop(op, x, y) for x, y in zip(ad, bd)),
                    a.idx,
                )
        raise EvalError(
            f"unsupported operator {op!r} for two axis-tagged values of these types"
        )
    if op == "STAR":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            if isinstance(a.data, tuple):
                bf = float(b)
                return AxisTaggedValue(tuple(bf * x for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (float(b) * x for x in a.data),
                        b,
                        a.data,
                    ),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            if isinstance(b.data, tuple):
                af = float(a)
                return AxisTaggedValue(tuple(af * x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x * float(a) for x in b.data),
                        b.data,
                        a,
                    ),
                    b.idx,
                )
    if op == "CARET":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            bf = float(b)
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(x**bf for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x**bf for x in a.data),
                        a.data,
                        b,
                    ),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            af = float(a)
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(af**x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (af**x for x in b.data),
                        a,
                        b.data,
                    ),
                    b.idx,
                )
    if op == "PERCENT":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            bf = float(b)
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(x % bf for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x % bf for x in a.data),
                        a.data,
                        b,
                    ),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            af = float(a)
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(af % x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (af % x for x in b.data),
                        a,
                        b.data,
                    ),
                    b.idx,
                )
    if op == "PLUS":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            bf = float(b)
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(x + bf for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x + bf for x in a.data),
                        a.data,
                        b,
                    ),
                    a.idx,
                )
            if isinstance(a.data, Multiset) and isinstance(b, int) and not isinstance(b, bool):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(
                        multiset_scalar_add(a.data, b),
                        typed_multiset_type_of(a.data),
                    ),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            af = float(a)
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(af + x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (af + x for x in b.data),
                        b.data,
                        a,
                    ),
                    b.idx,
                )
            if isinstance(b.data, Multiset) and isinstance(a, int) and not isinstance(a, bool):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(
                        multiset_scalar_add(b.data, a),
                        typed_multiset_type_of(b.data),
                    ),
                    b.idx,
                )
    if op == "MINUS":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            bf = float(b)
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(x - bf for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x - bf for x in a.data),
                        a.data,
                        b,
                    ),
                    a.idx,
                )
            if isinstance(a.data, Multiset) and isinstance(b, int) and not isinstance(b, bool):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(
                        multiset_scalar_subtract(a.data, b),
                        typed_multiset_type_of(a.data),
                    ),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            af = float(a)
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(af - x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (af - x for x in b.data),
                        b.data,
                        a,
                    ),
                    b.idx,
                )
    if op == "SLASH":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            bf = float(b)
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(x / bf for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x / bf for x in a.data),
                        a.data,
                        b,
                    ),
                    a.idx,
                )
            if isinstance(a.data, Multiset) and isinstance(b, int) and not isinstance(b, bool):
                return AxisTaggedValue(_multiset_division_struct(a.data, b), a.idx)
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            af = float(a)
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(af / x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (af / x for x in b.data),
                        b.data,
                        a,
                    ),
                    b.idx,
                )
    if op == "FLOORDIV":
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float)):
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(x // b for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (x // b for x in a.data),
                        a.data,
                        b,
                    ),
                    a.idx,
                )
            if isinstance(a.data, Multiset) and isinstance(b, int) and not isinstance(b, bool):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(
                        multiset_scalar_floordiv(a.data, b),
                        typed_multiset_type_of(a.data),
                    ),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(a // x for x in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    _wrap_vector_result_if_typed(
                        op,
                        (a // x for x in b.data),
                        a,
                        b.data,
                    ),
                    b.idx,
                )
    if op in ("EQ", "NEQ", "LT", "LE", "GT", "GE"):
        if isinstance(a, AxisTaggedValue) and isinstance(b, (int, float, bool)):
            if isinstance(a.data, tuple):
                return AxisTaggedValue(tuple(_binop(op, x, b) for x in a.data), a.idx)
            if isinstance(a.data, VFVector):
                return AxisTaggedValue(
                    VFVector(_binop(op, x, b) for x in a.data),
                    a.idx,
                )
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float, bool)):
            if isinstance(b.data, tuple):
                return AxisTaggedValue(tuple(_binop(op, a, y) for y in b.data), b.idx)
            if isinstance(b.data, VFVector):
                return AxisTaggedValue(
                    VFVector(_binop(op, a, y) for y in b.data),
                    b.idx,
                )
    if isinstance(a, AxisTaggedValue) or isinstance(b, AxisTaggedValue):
        raise EvalError("cannot mix axis-tagged and untagged operands")
    if op == "AMPERSAND":
        if isinstance(a, str) and isinstance(b, str):
            return a + b
        if isinstance(a, tuple) and isinstance(b, tuple):
            return a + b
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            return _wrap_vector_result_if_typed(op, chain(a, b), a, b)
        if isinstance(a, dict) and isinstance(b, dict) and is_struct_dict(a) and is_struct_dict(b):
            return _struct_merge_concat(a, b)
        raise EvalError(
            f"unsupported operand types for &: {type(a).__name__!r} and {type(b).__name__!r}"
        )
    if op == "PLUS":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for +")
            return _wrap_vector_result_if_typed(op, (x + y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            af = float(a)
            return _wrap_vector_result_if_typed(op, (af + x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            bf = float(b)
            return _wrap_vector_result_if_typed(op, (x + bf for x in a), a, b)
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(multiset_union(a, b), combine_typed_multiset_types(a, b))
        if isinstance(a, Multiset) and isinstance(b, int) and not isinstance(b, bool):
            return wrap_typed_multiset_result(multiset_scalar_add(a, b), typed_multiset_type_of(a))
        if isinstance(b, Multiset) and isinstance(a, int) and not isinstance(a, bool):
            return wrap_typed_multiset_result(multiset_scalar_add(b, a), typed_multiset_type_of(b))
        return a + b
    if op == "MINUS":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for -")
            return _wrap_vector_result_if_typed(op, (x - y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            af = float(a)
            return _wrap_vector_result_if_typed(op, (af - x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            bf = float(b)
            return _wrap_vector_result_if_typed(op, (x - bf for x in a), a, b)
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(multiset_difference(a, b), combine_typed_multiset_types(a, b))
        if isinstance(a, Multiset) and isinstance(b, int) and not isinstance(b, bool):
            return wrap_typed_multiset_result(multiset_scalar_subtract(a, b), typed_multiset_type_of(a))
        return a - b
    if op == "STAR":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for *")
            return _wrap_vector_result_if_typed(op, (x * y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            return _wrap_vector_result_if_typed(op, (float(a) * x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            return _wrap_vector_result_if_typed(op, (x * float(b) for x in a), a, b)
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            raise EvalError("operator * is not defined for multisets")
        return a * b
    if op == "SLASH":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for /")
            return _wrap_vector_result_if_typed(op, (x / y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            af = float(a)
            return _wrap_vector_result_if_typed(op, (af / x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            bf = float(b)
            return _wrap_vector_result_if_typed(op, (x / bf for x in a), a, b)
        if isinstance(a, Multiset):
            return _multiset_division_struct(a, b)
        return a / b
    if op == "FLOORDIV":
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            try:
                result = multiset_countwise_floordiv(a, b)
            except KeyError as e:
                raise EvalError(str(e)) from e
            return wrap_typed_multiset_result(result, combine_typed_multiset_types(a, b))
        if isinstance(a, Multiset) and isinstance(b, int) and not isinstance(b, bool):
            return wrap_typed_multiset_result(multiset_scalar_floordiv(a, b), typed_multiset_type_of(a))
        return a // b
    if op == "FLOORDIV":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for //")
            return _wrap_vector_result_if_typed(op, (x // y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            return _wrap_vector_result_if_typed(op, (a // x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            return _wrap_vector_result_if_typed(op, (x // b for x in a), a, b)
        return a // b
    if op == "PERCENT":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for %")
            return _wrap_vector_result_if_typed(op, (x % y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            return _wrap_vector_result_if_typed(op, (float(a) % x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            return _wrap_vector_result_if_typed(op, (x % float(b) for x in a), a, b)
        return a % b
    if op == "CARET":
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for ^")
            return _wrap_vector_result_if_typed(op, (x**y for x, y in zip(a, b)), a, b)
        if isinstance(a, (int, float)) and isinstance(b, VFVector):
            return _wrap_vector_result_if_typed(op, (float(a)**x for x in b), a, b)
        if isinstance(a, VFVector) and isinstance(b, (int, float)):
            return _wrap_vector_result_if_typed(op, (x**float(b) for x in a), a, b)
        return a**b
    if op in ("EQ", "STRUCT_NEQ", "LT", "LE", "GT", "GE"):
        if isinstance(a, tuple) and isinstance(b, tuple):
            if len(a) != len(b):
                raise EvalError("tuple length mismatch for relational op")
            return tuple(_binop(op, x, y) for x, y in zip(a, b))
        if isinstance(a, (int, float, bool)) and isinstance(b, tuple):
            return tuple(_binop(op, a, y) for y in b)
        if isinstance(a, tuple) and isinstance(b, (int, float, bool)):
            return tuple(_binop(op, x, b) for x in a)
        if isinstance(a, VFVector) and isinstance(b, VFVector):
            if len(a) != len(b):
                raise EvalError("vector length mismatch for relational op")
            return VFVector(_binop(op, x, y) for x, y in zip(a, b))
        if isinstance(a, (int, float, bool)) and isinstance(b, VFVector):
            return VFVector(_binop(op, a, y) for y in b)
        if isinstance(a, VFVector) and isinstance(b, (int, float, bool)):
            return VFVector(_binop(op, x, b) for x in a)
        return _try_scalar_relational_derivation(op, a, b)
    if op == "AND":
        if _is_bool_structure(a) or _is_bool_structure(b):
            return _logical_structure_binop(op, a, b)
        _disallow_vector_truthiness(a, "`and` left operand")
        if not bool(a):
            return False
        _disallow_vector_truthiness(b, "`and` right operand")
        return bool(b)
    if op == "OR":
        if _is_bool_structure(a) or _is_bool_structure(b):
            return _logical_structure_binop(op, a, b)
        _disallow_vector_truthiness(a, "`or` left operand")
        if bool(a):
            return True
        _disallow_vector_truthiness(b, "`or` right operand")
        return bool(b)
    if op == "XOR":
        if _is_bool_structure(a) or _is_bool_structure(b):
            return _logical_structure_binop(op, a, b)
        _disallow_vector_truthiness(a, "`xor` left operand")
        _disallow_vector_truthiness(b, "`xor` right operand")
        return bool(a) ^ bool(b)
    raise EvalError(f"unknown binary operator {op!r}")


def _combine_field_values_for_struct(
    op: str,
    av: Any,
    bv: Any,
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> Any:
    if isinstance(av, Multiset) and isinstance(bv, Multiset):
        if op == "PLUS":
            return multiset_union(av, bv)
        if op == "MINUS":
            return multiset_difference(av, bv)
        if op == "STAR":
            raise EvalError("operator * is not defined for multiset fields")
        if op == "SLASH":
            return _multiset_division_struct(av, bv)
        if op == "FLOORDIV":
            try:
                return multiset_countwise_floordiv(av, bv)
            except KeyError as e:
                raise EvalError(str(e)) from e
        raise EvalError(f"operator {op} is not defined for multiset fields")
    if isinstance(av, dict) and isinstance(bv, dict) and is_struct_dict(av) and is_struct_dict(bv):
        inner = _default_struct_elementwise_binop(op, av, bv, types)
        if inner is None:
            raise EvalError(
                "nested struct fields must match for element-wise operation"
            )
        return inner
    return _binop(op, av, bv)


def _default_struct_elementwise_binop(
    op: str,
    a: dict,
    b: dict,
    types: dict[str, ast.TypeExpr | ast.FuncType],
) -> dict | None:
    """Element-wise ``+ - * / % ^`` on two struct dicts with the same shape; ``None`` if not applicable."""
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
        out[k] = _combine_field_values_for_struct(op, a[k], b[k], types)
    return with_type(ta, out) if ta else out


def run_file(path: Path) -> None:
    from .parser import parse_module

    p = path.resolve()
    source = p.read_text(encoding="utf-8")
    mod = parse_module(source, filename=str(p))
    ip = Interpreter(p)
    ip.run_module(mod)
