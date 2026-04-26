"""Tree-walking interpreter for Vektor Flow (phase 1)."""

from __future__ import annotations

import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import ast
from .errors import (
    BreakSignal,
    ContinueSignal,
    EvalError,
    ExitProgramSignal,
    ReturnSignal,
)
from .runtime.multiset import (
    Multiset,
    multiset_difference,
    multiset_intersection,
    multiset_symmetric_difference,
    multiset_union,
)
from .stdlib import STDLIB_MODULES, resolve_stdlib
from .stdlib.events import matches_event_code, event_match_specificity
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
    resolve_return_type,
    types_equal,
    wrap_typed_multiset_result,
    wrap_typed_vector_result,
)
from .runtime.vflist import VFLinkedList
from .runtime.vmap import VMap

# Sentinel: no outer ``$`` in ``env`` before a :class:`ast.MatchStmt` binds it.
_NO_PREVIOUS_DOLLAR = object()

OPERATOR_SYMBOLS = frozenset(
    {
        ".",
        "+",
        "-",
        "*",
        "/",
        "%",
        "^",
        "&",
        "=",
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
    "PERCENT": "%",
    "CARET": "^",
    "EQ": "=",
    "NEQ": "!=",
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
    if isinstance(expr, ast.StdinPipe):
        return _expr_refs_param(expr.expr, param_names)
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
    return f"<{type(expr).__name__}>"


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
                if not types_equal(inferred, p.param_func_type):
                    return None
            else:
                if not types_equal(ft, p.param_func_type):
                    return None
            score += 2
            continue
        if p.type_name in (None, "any"):
            continue
        if p.type_name == "num":
            if isinstance(av, bool) or not isinstance(av, (int, float, complex)):
                return None
            score += 2
            continue
        if p.type_name == "bool":
            if not isinstance(av, bool):
                return None
            score += 2
            continue
        if p.type_name == "str":
            if not isinstance(av, str):
                return None
            score += 2
            continue
        if p.type_name == "byte":
            if not isinstance(av, (bytes, bytearray)):
                return None
            score += 2
            continue
        if isinstance(av, dict) and is_struct_dict(av):
            tag = get_type_name(av)
            if tag == p.type_name:
                score += 2
                continue
            if tag is None and p.type_name in types:
                spec = types[p.type_name]
                if not isinstance(spec, ast.TypeExpr):
                    continue
                need = {f[0] for f in spec.fields}
                have = set(av.keys()) - {VF_TYPE_KEY}
                if need <= have:
                    score += 1
                    continue
        return None
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


def _format_param_list_display(params: list[ast.Param]) -> str:
    parts: list[str] = []
    for p in params:
        if p.param_func_type is not None:
            parts.append(
                f"{p.name}:{_format_nested_func_type_for_param(p.param_func_type)}"
            )
        elif p.type_ref is not None:
            parts.append(f"{p.name}:{_format_type_ast_for_stringify(p.type_ref)}")
        elif p.type_name:
            parts.append(f"{p.name}:{p.type_name}")
        else:
            parts.append(p.name)
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
    if isinstance(cod, (ast.TupleTypeExpr, ast.TypeExpr, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec)):
        return _format_type_ast_for_stringify(cod)
    return "…"


def _format_type_ast_for_stringify(v: Any) -> str:
    """Surface-syntax type printout (no ``PrimTypeRef(...)`` / ``dataclass`` repr)."""
    if isinstance(v, ast.PrimTypeRef):
        return v.name
    if isinstance(v, ast.TypeSizeConst):
        return str(v.value)
    if isinstance(v, ast.TypeSizeVar):
        return v.name
    if isinstance(v, ast.TypeSizeBinOp):
        return f"{_format_type_ast_for_stringify(v.left)}{v.op}{_format_type_ast_for_stringify(v.right)}"
    if isinstance(v, ast.TupleTypeExpr):
        if not v.elements:
            return "()"
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


def _format_multiset_stringify(
    m: Multiset,
    types: dict[str, ast.TypeExpr | ast.FuncType] | None,
) -> str:
    pairs = m.items_sorted()
    if not pairs:
        return "{}"
    inner = ", ".join(
        f"{_stringify(k, types)}:{_stringify(c, types)}" for k, c in pairs
    )
    return "{" + inner + "}"


def _format_vmap_stringify(
    m: VMap,
    types: dict[str, ast.TypeExpr | ast.FuncType] | None,
) -> str:
    items = list(m.items())
    items.sort(key=lambda kv: (str(type(kv[0]).__name__), str(kv[0])))
    inner = ", ".join(
        f"{_stringify(k, types)}:{_stringify(val, types)}" for k, val in items
    )
    return "{" + inner + "}"


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

    def _merge_stdlibs(self) -> None:
        for name in ("math", "capture", "io", "collections", "stat", "ui"):
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
            if isinstance(d, VMap):
                if len(keys) != 1:
                    raise EvalError("multi-key map assignment is not supported")
                d._d[keys[0]] = val
                return
            if not isinstance(d, dict):
                raise EvalError("field bind requires struct")
            env[root_name] = _dict_set_path(d, keys, val)
            return
        if isinstance(target, ast.DottedIndex):
            if all(isinstance(ix, ast.Ident) for ix in target.indices):
                self.eval_expr(target.base, env)
                if not isinstance(val, (list, tuple)):
                    raise EvalError(
                        "bind pattern .(name,…) requires a tuple or list on the right"
                    )
                seq = list(val)
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
            if not isinstance(val, (list, tuple)):
                raise EvalError("multi-index bind requires a tuple or list value")
            vals = list(val)
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
                coerced, _ = coerce_typed_value(value, node.declared_type, self.types)
                self._assign_bind(node.target, coerced, env)
                return None
            if isinstance(node.target, ast.Ident) and isinstance(
                node.value, (ast.TypeExpr, ast.FuncType, ast.PrimTypeRef, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec)
            ):
                self.types[node.target.name] = node.value
                return None
            if isinstance(node.target, ast.Ident) and isinstance(
                node.value, ast.Ident
            ):
                tname = node.value.name
                if tname in ("num", "str", "bool"):
                    env[node.target.name] = default_field_value(tname, self.types)
                    return None
            self._assign_bind(node.target, self.eval_expr(node.value, env), env)
            return None
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
                # If the module wraps a single value under the short name (e.g. ui returns
                # {"ui": UIRoot()}), unwrap it so ``ui:.ui`` gives the UIRoot directly.
                short = node.path.segments[-1] if node.path.segments else None
                if short and list(mod.keys()) == [short]:
                    env[node.alias] = mod[short]
                else:
                    env[node.alias] = mod
            else:
                # ``:.path`` — spill exports AND bind under short name
                short_name = node.path.segments[-1] if node.path.segments else None
                if short_name:
                    env[short_name] = mod
                for k, v in _exports(mod).items():
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
        if isinstance(a, int) and isinstance(b, int):
            # Event code matching: exact code vs scoped integer patterns.
            if matches_event_code(a, b) or matches_event_code(b, a):
                return True
        if is_type_value(a) and is_type_value(b):
            return types_equal(a, b)
        if bool(is_struct_dict(a) and is_struct_dict(b)):
            return struct_eq(a, b, self.types)
        return bool(_binop("EQ", a, b))

    def _match_specificity(self, a: Any, b: Any) -> int | None:
        """Return match specificity for ``??`` arm selection, or ``None`` when not matched."""
        if isinstance(a, int) and isinstance(b, int):
            s = event_match_specificity(a, b)
            if s is not None:
                return s
            s = event_match_specificity(b, a)
            if s is not None:
                return s
            return None
        return 0 if self._match_eq(a, b) else None

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

    def eval_expr(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ast.ConditionalExpr):
            if node.loop:
                while bool(self.eval_expr(node.condition, env)):
                    try:
                        self._eval_match_body(node.body, env)
                    except ContinueSignal:
                        continue
                    except BreakSignal:
                        return None
                return None
            if not bool(self.eval_expr(node.condition, env)):
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
                    if isinstance(v, VMap):
                        if p not in v._d:
                            raise EvalError(
                                f"missing key {p!r} in string interpolation"
                            )
                        v = v._d[p]
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
        if isinstance(node, ast.TupleLit):
            out: list[Any] = []
            for e in node.elements:
                if isinstance(e, ast.SpreadArg):
                    v = self.eval_expr(e.expr, env)
                    if isinstance(v, AxisTaggedValue):
                        v = v.data
                    if isinstance(v, (tuple, list)):
                        out.extend(v)
                    else:
                        raise EvalError(
                            "tuple spread (`:expr`) requires a tuple or vector value"
                        )
                    continue
                out.append(self.eval_expr(e, env))
            t = tuple(out)
            if node.axis_tag is not None:
                return AxisTaggedValue(t, node.axis_tag)
            return t
        if isinstance(node, ast.ListLit):
            if len(node.elements) == 1 and isinstance(
                node.elements[0], ast.RangeExpr
            ):
                re0 = node.elements[0]
                if re0.end is None:
                    if node.axis_tag is not None:
                        raise EvalError(
                            "axis suffix is not allowed on a lazy infinite range literal"
                        )
                    inner = self.eval_expr(re0, env)
                    if not isinstance(inner, LazyInfiniteIterator):
                        raise EvalError("internal: lazy range expected iterator")
                    return LazyList(inner)
                r = self.eval_expr(re0, env)
                seq = list(r)
                if node.axis_tag is not None:
                    return AxisTaggedValue(tuple(seq), node.axis_tag)
                return seq
            out: list[Any] = []
            for e in node.elements:
                if isinstance(e, ast.MsetSpill):
                    m = self.eval_expr(e.expr, env)
                    if not isinstance(m, Multiset):
                        raise EvalError("[: …] multiset spill requires a multiset value")
                    out.extend(m.elements())
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
            if node.axis_tag is not None:
                return AxisTaggedValue(tuple(out), node.axis_tag)
            return out
        if isinstance(node, ast.StructLit):
            return {
                name: self.eval_expr(val, env)
                for name, val in node.fields
            }
        if isinstance(node, ast.StructIdentity):
            return _local_scope_as_record(env)
        if isinstance(node, ast.MultisetLit):
            c: Counter[Any] = Counter()
            for ke, ce in node.pairs:
                key = self.eval_expr(ke, env)
                cnt_v = self.eval_expr(ce, env)
                if isinstance(cnt_v, bool) or not isinstance(cnt_v, (int, float)):
                    raise EvalError("multiset count must be a number")
                n = int(cnt_v)
                if float(cnt_v) != float(n):
                    raise EvalError("multiset count must be an integer")
                if n < 0:
                    raise EvalError("multiset count must be non-negative")
                c[key] += n
            m = Multiset(c)
            if node.axis_tag is not None:
                return AxisTaggedValue(m, node.axis_tag)
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
            ctor = getattr(fn, "_vkf_ctor", None)
            if ctor == "map":
                return fn._vkf_impl(pos, kw, spreads)
            if ctor == "list":
                return fn._vkf_impl(pos, kw, spreads)
            if ctor == "queue":
                return fn._vkf_impl(pos, kw, spreads)
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
                if spreads:
                    raise EvalError("struct constructor does not support spread arguments")
                return self._call_struct_ctor(fn, pos, kw, env)
            if kw or spreads:
                if isinstance(fn, VFunction):
                    raise EvalError(
                        "this call does not accept keyword or spread arguments"
                    )
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
            if isinstance(o, VMap):
                if node.name not in o._d:
                    raise EvalError(f"missing key {node.name!r}")
                return o._d[node.name]
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
        if isinstance(node, (ast.TypeExpr, ast.FuncType, ast.PrimTypeRef, ast.FixedVectorType, ast.MultisetType, ast.MapValueType, ast.LinkedListValueType, ast.NamedTypeSpec, ast.TypeSizeConst, ast.TypeSizeVar, ast.TypeSizeBinOp)):
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
            loc = dict(fn.closure)
            size_bindings: dict[str, int] = {}
            for p, a in zip(fn.params, args):
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
            return self._call_struct_ctor(fn, args, {}, env)
        if callable(fn):
            return fn(*args)
        raise EvalError(f"not callable: {type(fn).__name__}")

    def _call_struct_ctor(
        self,
        fn: VStructCtor,
        pos: list[Any],
        kw: dict[str, Any],
        _env: dict[str, Any],
    ) -> Any:
        # _env / fn.closure reserved for future default expressions
        params = fn.params
        by_name: dict[str, Any] = {}
        for i, a in enumerate(pos):
            if i >= len(params):
                raise EvalError(f"{fn.name}: too many positional arguments")
            pname = params[i].name
            if pname in by_name:
                raise EvalError(f"{fn.name}: multiple values for field {pname!r}")
            by_name[pname] = coerce_value(a, params[i].type_name)
        for k, v in kw.items():
            if k not in {p.name for p in params}:
                raise EvalError(f"{fn.name}: unknown field {k!r}")
            if k in by_name:
                raise EvalError(f"{fn.name}: multiple values for field {k!r}")
            pt = next(p.type_name for p in params if p.name == k)
            by_name[k] = coerce_value(v, pt)
        for p in params:
            if p.name not in by_name:
                raise EvalError(f"{fn.name}: missing field {p.name!r}")
        return with_type(fn.name, by_name)

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
        # If the value already ends with a newline (e.g. ``$ & "\n"``), do not add another.
        if s.endswith("\n"):
            print(s, end="")
        else:
            print(s)

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
            if isinstance(v, dict) and is_struct_dict(v):
                raise EvalError("struct ~ requires ~(a): … overload")
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
                if isinstance(d, Multiset):
                    for el in d.elements():
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
            if isinstance(left_v, list):
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
            if isinstance(left_v, Multiset):
                for el in left_v.elements():
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
            if isinstance(d, tuple):
                out_t: list[Any] = []

                def _collect(el: Any) -> None:
                    out_t.append(
                        self._pipe_one_element_through_segments(el, segs, env)
                    )

                _foreach_element(_collect)
                return AxisTaggedValue(tuple(out_t), left_v.idx)
            if isinstance(d, Multiset):
                out: Counter[Any] = Counter()

                def _mset(el: Any) -> None:
                    v = self._pipe_one_element_through_segments(el, segs, env)
                    out[v] += 1

                _foreach_element(_mset)
                return AxisTaggedValue(Multiset(out), left_v.idx)
            return self._pipe_one_element_through_segments(left_v, segs, env)

        if isinstance(left_v, tuple):
            out: list[Any] = []

            def _t(el: Any) -> None:
                out.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_t)
            return tuple(out)
        if isinstance(left_v, list):
            out_l: list[Any] = []

            def _l(el: Any) -> None:
                out_l.append(self._pipe_one_element_through_segments(el, segs, env))

            _foreach_element(_l)
            return out_l
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
        if isinstance(left_v, Multiset):
            out_ms: Counter[Any] = Counter()

            def _ms(el: Any) -> None:
                v = self._pipe_one_element_through_segments(el, segs, env)
                out_ms[v] += 1

            _foreach_element(_ms)
            return Multiset(out_ms)
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
        if node.op == "EQ" and is_type_value(a) and is_type_value(b):
            return types_equal(a, b)
        if node.op == "NEQ" and is_type_value(a) and is_type_value(b):
            return not types_equal(a, b)
        sym = BINOP_KIND_TO_SYM.get(node.op)
        sd = bool(is_struct_dict(a) and is_struct_dict(b))
        if sym and (is_struct_dict(a) or is_struct_dict(b)):
            variants = self.op_overloads.get(sym) or []
            f2 = [f for f in variants if len(f.params) == 2]
            fn = _pick_best_overload(f2, [a, b], self.types)
            if fn is not None:
                return self._call(fn, [a, b], env)
        if sym and sd:
            if node.op == "AMPERSAND":
                return _struct_merge_concat(a, b)
            if node.op == "LT":
                return struct_lt(a, b, self.types)
            if node.op == "LE":
                return struct_lt(a, b, self.types) or struct_eq(
                    a, b, self.types
                )
            if node.op == "GT":
                return struct_lt(b, a, self.types)
            if node.op == "GE":
                return not struct_lt(a, b, self.types)
            if node.op == "EQ":
                return struct_eq(a, b, self.types)
            if node.op == "NEQ":
                return not struct_eq(a, b, self.types)
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
    if isinstance(seq, VFLinkedList):
        return tuple(islice(iter(seq), k))
    if isinstance(seq, (list, tuple)):
        return tuple(seq[:k])
    if isinstance(seq, Multiset):
        raise EvalError("take: use a sequence or iterator, not a multiset")
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
    t = _builtin_take(n, seq)
    c: Counter[Any] = Counter()
    for x in t:
        c[x] += 1
    return Multiset(c)


def _dotted_get_one(base: Any, k: Any) -> Any:
    if isinstance(base, AxisTaggedValue):
        return _dotted_get_one(base.data, k)
    if isinstance(base, LazyList):
        return base.get_at(_normalize_index(k))
    if isinstance(base, VMap):
        kk = _normalize_index(k)
        if kk not in base._d:
            raise EvalError(f"missing key {kk!r}")
        return base._d[kk]
    if isinstance(base, list):
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
    if isinstance(container, VMap):
        container._d[_normalize_index(k)] = val
        return
    if isinstance(container, list):
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
    if isinstance(v, (ast.TypeExpr, ast.FuncType, ast.TupleTypeExpr, ast.PrimTypeRef, ast.FixedVectorType, ast.MultisetType, ast.NamedTypeSpec, ast.TypeSizeConst, ast.TypeSizeVar, ast.TypeSizeBinOp)):
        return _format_type_ast_for_stringify(v)
    if isinstance(v, dict) and is_struct_dict(v):
        if struct_tagged(v):
            return _format_tagged_struct_record(v, types)
        return _format_untagged_dict_as_record(v, types)
    if isinstance(v, AxisTaggedValue):
        return _stringify(v.data, types)
    if isinstance(v, VMap):
        return _format_vmap_stringify(v, types)
    if isinstance(v, VFLinkedList):
        return "[" + ", ".join(_stringify(x, types) for x in v) + "]"
    if isinstance(v, Multiset):
        return _format_multiset_stringify(v, types)
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
    if isinstance(v, list):
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
            raise EvalError(f"axis mismatch: {a.idx!r} vs {b.idx!r}")
        ad, bd = a.data, b.data
        if op == "AMPERSAND":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                return AxisTaggedValue(ad + bd, a.idx)
            if isinstance(ad, list) and isinstance(bd, list):
                return AxisTaggedValue(ad + bd, a.idx)
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(multiset_union(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a.idx,
                )
            raise EvalError(
                "unsupported types inside axis-tagged values for & "
                "(use tuple, vector, or multiset)"
            )
        if op == "PLUS":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for +")
                return AxisTaggedValue(
                    tuple(x + y for x, y in zip(ad, bd)), a.idx
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
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(multiset_intersection(ad, bd), combine_typed_multiset_types(ad, bd)),
                    a.idx,
                )
        if op == "SLASH":
            if isinstance(ad, tuple) and isinstance(bd, tuple):
                if len(ad) != len(bd):
                    raise EvalError("tuple length mismatch for /")
                return AxisTaggedValue(
                    tuple(x / y for x, y in zip(ad, bd)), a.idx
                )
            if isinstance(ad, Multiset) and isinstance(bd, Multiset):
                return AxisTaggedValue(
                    wrap_typed_multiset_result(
                        multiset_symmetric_difference(ad, bd), combine_typed_multiset_types(ad, bd)
                    ),
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
        if isinstance(b, AxisTaggedValue) and isinstance(a, (int, float)):
            if isinstance(b.data, tuple):
                af = float(a)
                return AxisTaggedValue(tuple(af * x for x in b.data), b.idx)
    if isinstance(a, AxisTaggedValue) or isinstance(b, AxisTaggedValue):
        raise EvalError("cannot mix axis-tagged and untagged operands")
    if op == "AMPERSAND":
        if isinstance(a, str) and isinstance(b, str):
            return a + b
        if isinstance(a, tuple) and isinstance(b, tuple):
            return a + b
        if isinstance(a, list) and isinstance(b, list):
            return wrap_typed_vector_result(a + b, combine_typed_vector_types(op, a, b))
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(multiset_union(a, b), combine_typed_multiset_types(a, b))
        if isinstance(a, dict) and isinstance(b, dict) and is_struct_dict(a) and is_struct_dict(b):
            return _struct_merge_concat(a, b)
        raise EvalError(
            f"unsupported operand types for &: {type(a).__name__!r} and {type(b).__name__!r}"
        )
    if op == "PLUS":
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                raise EvalError("list length mismatch for +")
            return wrap_typed_vector_result(
                [x + y for x, y in zip(a, b)],
                combine_typed_vector_types(op, a, b),
            )
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(multiset_union(a, b), combine_typed_multiset_types(a, b))
        return a + b
    if op == "MINUS":
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                raise EvalError("list length mismatch for -")
            return wrap_typed_vector_result(
                [x - y for x, y in zip(a, b)],
                combine_typed_vector_types(op, a, b),
            )
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(multiset_difference(a, b), combine_typed_multiset_types(a, b))
        return a - b
    if op == "STAR":
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                raise EvalError("list length mismatch for *")
            return wrap_typed_vector_result(
                [x * y for x, y in zip(a, b)],
                combine_typed_vector_types(op, a, b),
            )
        if isinstance(a, (int, float)) and isinstance(b, list):
            return wrap_typed_vector_result(
                [float(a) * x for x in b],
                combine_typed_vector_types(op, a, b),
            )
        if isinstance(a, list) and isinstance(b, (int, float)):
            return wrap_typed_vector_result(
                [x * float(b) for x in a],
                combine_typed_vector_types(op, a, b),
            )
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(multiset_intersection(a, b), combine_typed_multiset_types(a, b))
        return a * b
    if op == "SLASH":
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                raise EvalError("list length mismatch for /")
            return wrap_typed_vector_result(
                [x / y for x, y in zip(a, b)],
                combine_typed_vector_types(op, a, b),
            )
        if isinstance(a, Multiset) and isinstance(b, Multiset):
            return wrap_typed_multiset_result(
                multiset_symmetric_difference(a, b), combine_typed_multiset_types(a, b)
            )
        return a / b
    if op == "PERCENT":
        return a % b
    if op == "CARET":
        return a**b
    if op == "EQ":
        return a == b
    if op == "NEQ":
        return a != b
    if op == "LT":
        return a < b
    if op == "LE":
        return a <= b
    if op == "GT":
        return a > b
    if op == "GE":
        return a >= b
    if op == "AND":
        return bool(a) and bool(b)
    if op == "OR":
        return bool(a) or bool(b)
    if op == "XOR":
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
            return multiset_intersection(av, bv)
        if op == "SLASH":
            return multiset_symmetric_difference(av, bv)
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
