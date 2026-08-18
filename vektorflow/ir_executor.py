"""Small IR executor used to validate lowered semantics against the AST interpreter."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import EvalError
from .use_resolve import resolve_dot_module
from .interpreter import (
    BINOP_KIND_TO_SYM,
    OPERATOR_SYMBOLS,
    UNARY_KIND_TO_SYM,
    VF_SPILL_BASE_KEY,
    _builtin_take,
    _builtin_to_list,
    _builtin_to_multiset,
    _local_scope_as_record,
    _spill_expr_record,
    _spill_public_fields,
    _struct_or_self_base,
    _spill_values_for_vector,
    _binop,
    _default_struct_elementwise_binop,
    _format_ft_codomain_part,
    _format_param_list_display,
    _pick_best_overload,
    _pick_overload_for_symbol,
    _stringify,
    _struct_merge_concat,
    _structural_compare,
    _param_is_custom_typed,
    _validate_custom_unary_overload,
    _validate_custom_operator_overload,
)
from .runtime.lazy_range import LazyInfiniteIterator, LazyList
from .runtime import (
    AxisTaggedValue,
    VFVector,
    axis_tagged_wrap,
    make_multiset,
    make_vflist,
    make_vmap,
    runtime_collection_assign_path,
    runtime_collection_ctor_call,
    runtime_collection_elementwise_values,
    runtime_collection_expanded_values,
    runtime_collection_index_set,
    runtime_collection_index_read,
    runtime_collection_kind,
    runtime_collection_pipe_result,
    runtime_collection_preserves_pipe_result,
    runtime_collection_read_attr,
)
from .runtime.type_values import PrimType, coerce_typed_value, is_type_value, primitive_signature, resolve_return_type
from .runtime.type_surface import runtime_type_member_callable, runtime_type_surface_metadata
from .runtime.struct_value import is_struct_dict
from .runtime.operator_semantics import mixed_string_binary
from .runtime.absnorm import abs_or_norm
from .runtime.type_values import infer_type
from .stdlib import STDLIB_MODULES, resolve_stdlib
from .stdlib.physics import normalize_physical_vector_components
from .stdlib.events import event_match_specificity
from . import ast, ir


class IRReturnSignal(Exception):
    def __init__(self, value: Any) -> None:
        super().__init__("ir return")
        self.value = value


class IRBreakSignal(Exception):
    pass


class IRContinueSignal(Exception):
    pass


_NO_PREVIOUS_DOLLAR = object()


@dataclass
class IRFunctionValue:
    name: str
    params: list[str]
    body: ir.Block
    closure: dict[str, Any]
    param_types: list[Any]
    return_type: Any | None
    param_specs: list[Any] = field(default_factory=list)
    ip: Any = field(default=None, repr=False, compare=False)

    def __call__(self, *args: Any) -> Any:
        """Call an IR-backed language function through its owning runtime."""
        if self.ip is None:
            raise TypeError("IR function has no interpreter reference")
        if isinstance(self.ip, IRExecutor):
            return self.ip._call(self, list(args))
        return self.ip._call(self, list(args), self.ip.globals)


def _stringify_ir_value(value: Any, types: dict[str, Any]) -> str:
    if isinstance(value, IRFunctionValue):
        params = (
            _format_param_list_display(value.param_specs)
            if value.param_specs
            else ", ".join(value.params)
        )
        head = f"{value.name}({params})"
        if value.return_type is not None:
            return f"{head} -> {_format_ft_codomain_part(value.return_type)}"
        return head
    return _stringify(value, types)


@dataclass
class IROpCallable:
    symbol: str


@dataclass
class IRExecutor:
    file_path: Path
    host_interpreter: Any = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.file_path = self.file_path.resolve()
        self.base_dir = self.file_path.parent
        self.globals: dict[str, Any] = {}
        self.builtin: dict[str, Any] = {}
        self.types: dict[str, Any] = {}
        self.op_overloads: dict[str, list[IRFunctionValue]] = {}
        self.cast_overloads: dict[str, list[IRFunctionValue]] = {}
        self.module_cache: dict[Any, Any] = {}
        self._vf_call_depth = 0
        self._vf_call_depth_limit = 128
        self._merge_stdlibs()
        self.builtin["i"] = 1j
        self.builtin["j"] = 1j
        self.builtin["take"] = _builtin_take
        self.builtin["to_list"] = _builtin_to_list
        self.builtin["to_multiset"] = _builtin_to_multiset
        for _tn in ("bit", "int", "num", "chr", "str", "any"):
            self.builtin[_tn] = PrimType(_tn)

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

    def _resolve_runtime_type_expr(self, type_expr: Any, env: dict[str, Any]) -> Any:
        if isinstance(type_expr, ast.TypeOf):
            return self.eval_expr(ir.TypeOfExpr(ir.lower_expr(type_expr.value)), env)
        if isinstance(type_expr, ast.NamedTypeSpec):
            return ast.NamedTypeSpec(
                type_expr.name,
                self._resolve_runtime_type_expr(type_expr.type_expr, env),
            )
        if isinstance(type_expr, ast.TypeUnionExpr):
            return ast.TypeUnionExpr(
                [self._resolve_runtime_type_expr(member, env) for member in type_expr.members]
            )
        if isinstance(type_expr, ast.TypeIntersectionExpr):
            return ast.TypeIntersectionExpr(
                [self._resolve_runtime_type_expr(member, env) for member in type_expr.members]
            )
        if isinstance(type_expr, ast.TypePowerExpr):
            return ast.TypePowerExpr(
                self._resolve_runtime_type_expr(type_expr.base, env),
                self._resolve_runtime_type_expr(type_expr.exponent, env),
            )
        if isinstance(type_expr, ast.TypeDomainBinOp):
            return ast.TypeDomainBinOp(
                type_expr.op,
                self._resolve_runtime_type_expr(type_expr.left, env),
                self._resolve_runtime_type_expr(type_expr.right, env),
            )
        if isinstance(type_expr, ast.FixedVectorType):
            return ast.FixedVectorType(
                self._resolve_runtime_type_expr(type_expr.element_type, env),
                type_expr.size,
            )
        if isinstance(type_expr, ast.MultisetType):
            return ast.MultisetType(
                self._resolve_runtime_type_expr(type_expr.element_type, env)
            )
        if isinstance(type_expr, ast.TypeExpr):
            return ast.TypeExpr(
                [
                    (name, self._resolve_runtime_type_expr(inner, env))
                    for name, inner in type_expr.fields
                ]
            )
        if isinstance(type_expr, ast.TupleTypeExpr):
            return ast.TupleTypeExpr(
                [self._resolve_runtime_type_expr(inner, env) for inner in type_expr.elements]
            )
        if isinstance(type_expr, ast.MapValueType):
            return ast.MapValueType(
                [
                    (name, self._resolve_runtime_type_expr(inner, env))
                    for name, inner in type_expr.fields
                ]
            )
        if isinstance(type_expr, ast.LinkedListValueType):
            return ast.LinkedListValueType(
                [self._resolve_runtime_type_expr(inner, env) for inner in type_expr.elements]
            )
        if isinstance(type_expr, ast.FuncType):
            return ast.FuncType(
                self._resolve_runtime_type_expr(type_expr.domain, env),
                self._resolve_runtime_type_expr(type_expr.codomain, env),
            )
        return type_expr

    def run_module(self, module: ir.Module) -> Any:
        env = self.globals
        try:
            for stdlib_import in module.stdlib_imports:
                module_value = resolve_stdlib(stdlib_import.module_name)
                if stdlib_import.spill_exports and isinstance(module_value, dict):
                    env.update(module_value)
                else:
                    env[stdlib_import.binding_name] = module_value
            for stmt in module.statements:
                self.exec_stmt(stmt, env)
        except IRReturnSignal as r:
            return r.value
        except IRContinueSignal as exc:
            raise EvalError("continue is not valid here (use `?>` / `??>` loops)") from exc
        except IRBreakSignal as exc:
            raise EvalError("@| break outside >> pipe") from exc
        return None

    def exec_block(self, block: ir.Block, env: dict[str, Any]) -> None:
        for stmt in block.statements:
            self.exec_stmt(stmt, env)

    def eval_block_result(self, block: ir.Block, env: dict[str, Any]) -> Any:
        result: Any = None
        for stmt in block.statements:
            result = self.exec_stmt(stmt, env)
        return result

    def _eval_store_value(self, name: str, value: Any, env: dict[str, Any]) -> Any:
        """Preserve shared vector storage for ``name op: value`` updates."""
        current = env.get(name)
        if (
            current is not None
            and isinstance(value, ir.BinaryExpr)
            and isinstance(value.left, (ir.LoadName, ir.LoadSlot))
            and value.left.name == name
        ):
            updater = getattr(current, "__vf_update__", None)
            if callable(updater):
                updater(value.op, self.eval_expr(value.right, env))
                return current
            if isinstance(current, VFVector):
                updated = self.eval_expr(value, env)
                if isinstance(updated, VFVector) and len(updated) == len(current):
                    current[:] = updated
                    return current
                return updated
        return self.eval_expr(value, env)

    def exec_stmt(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ir.TypeDef):
            self.types[node.name] = self._resolve_runtime_type_expr(node.type_expr, env)
            return None
        if isinstance(node, ir.StoreName):
            val = self._eval_store_value(node.name, node.value, env)
            if node.declared_type is not None:
                declared_type = self._resolve_runtime_type_expr(node.declared_type, env)
                val, _ = coerce_typed_value(val, declared_type, self.types)
            if node.declared_type is None and is_type_value(val):
                self.types[node.name] = val
            env[node.name] = val
            return val
        if isinstance(node, ir.StoreSlot):
            val = self._eval_store_value(node.name, node.value, env)
            if node.declared_type is not None:
                declared_type = self._resolve_runtime_type_expr(node.declared_type, env)
                val, _ = coerce_typed_value(val, declared_type, self.types)
            if node.declared_type is None and is_type_value(val):
                self.types[node.name] = val
            env[node.name] = val
            return val
        if isinstance(node, ir.FunctionDef):
            fn = IRFunctionValue(
                node.name,
                list(node.params),
                node.body,
                dict(env),
                list(node.param_types),
                node.return_type,
                list(node.param_specs),
            )
            fn.ip = self.host_interpreter or self
            fn.closure[node.name] = fn
            if node.name == "::" and len(node.param_specs) == 1:
                _validate_custom_unary_overload(node.param_specs, "::(value: T)")
                self.op_overloads.setdefault(node.name, []).append(fn)
                env[node.name] = IROpCallable(node.name)
            elif node.name in ("num", "str", "bit", "chr") and len(node.param_specs) == 1:
                _validate_custom_unary_overload(
                    node.param_specs, f"{node.name}(value: T)"
                )
                self.cast_overloads.setdefault(node.name, []).append(fn)
            elif node.name in OPERATOR_SYMBOLS:
                if node.name == ".":
                    if len(node.param_specs) != 2:
                        raise EvalError("operator '.': expected exactly two parameters")
                    if not _param_is_custom_typed(node.param_specs[0]):
                        raise EvalError(
                            "operator '.': first parameter must be a custom or constructed type"
                        )
                    if (
                        node.param_specs[1].param_func_type is None
                        and node.param_specs[1].type_name is None
                    ):
                        raise EvalError("operator '.': second parameter must be typed")
                else:
                    _validate_custom_operator_overload(
                        node.param_specs, f"operator {node.name!r}"
                    )
                self.op_overloads.setdefault(node.name, []).append(fn)
                env[node.name] = IROpCallable(node.name)
            else:
                env[node.name] = fn
            return None
        if isinstance(node, ir.ExprStmt):
            return self.eval_expr(node.expr, env)
        if isinstance(node, ir.PrintStmt):
            value = self.eval_expr(node.value, env)
            emit_fn = self._pick_best_ir_overload(self.op_overloads.get("::") or [], [value])
            if emit_fn is not None:
                return self._call(emit_fn, [value])
            text = _stringify_ir_value(value, self.types)
            print(text, end="" if text.endswith("\n") else "\n", flush=True)
            return None
        if isinstance(node, ir.LabelPrintStmt):
            value = self.eval_expr(node.value, env)
            print(f"{node.expr_text}: {_stringify_ir_value(value, self.types)}")
            return None
        if isinstance(node, ir.ModuleImportStmt):
            mod = self._eval_dot_module_segments(node.path_segments)
            if not isinstance(mod, dict):
                raise EvalError("spill import requires a module namespace")
            if node.alias is not None:
                env[node.alias] = mod
            else:
                short_name = node.path_segments[-1] if node.path_segments else ""
                for key, value in _ir_spill_exports(mod, short_name).items():
                    env[key] = value
            return None
        if isinstance(node, ir.SpillStmt):
            value = self.eval_expr(node.value, env)
            type_surface = runtime_type_surface_metadata(value)
            fields = type_surface if type_surface is not None else _spill_public_fields(value)
            for key, field_value in fields.items():
                env[key] = field_value
            env[VF_SPILL_BASE_KEY] = _struct_or_self_base(value)
            return value
        if isinstance(node, ir.IfStmt):
            if bool(self.eval_expr(node.condition, env)):
                self.eval_block_result(node.body, env)
            return None
        if isinstance(node, ir.WhileStmt):
            while bool(self.eval_expr(node.condition, env)):
                try:
                    self.eval_block_result(node.body, env)
                except IRContinueSignal:
                    continue
                except IRBreakSignal:
                    break
            return None
        if isinstance(node, ir.MatchStmt):
            previous_dollar = env.get("$", _NO_PREVIOUS_DOLLAR)
            try:
                while True:
                    disc = self.eval_expr(node.discriminant, env)
                    env["$"] = disc
                    chosen: ir.MatchArm | None = None
                    best_spec = -1
                    default_arm: ir.MatchArm | None = None
                    for arm in node.arms:
                        if arm.condition is None:
                            if default_arm is None:
                                default_arm = arm
                            continue
                        spec = self._match_specificity(disc, self.eval_expr(arm.condition, env))
                        if spec is None:
                            continue
                        if spec > best_spec:
                            best_spec = spec
                            chosen = arm
                    chosen = chosen if chosen is not None else default_arm
                    if chosen is None:
                        return None
                    if not node.loop:
                        self.eval_block_result(chosen.body, env)
                        return None
                    try:
                        self.eval_block_result(chosen.body, env)
                    except IRContinueSignal:
                        continue
                    except IRBreakSignal:
                        return None
            finally:
                if previous_dollar is _NO_PREVIOUS_DOLLAR:
                    env.pop("$", None)
                else:
                    env["$"] = previous_dollar
        if isinstance(node, ir.ContinueStmt):
            raise IRContinueSignal()
        if isinstance(node, ir.BreakStmt):
            raise IRBreakSignal()
        if isinstance(node, ir.ReturnStmt):
            val = None if node.value is None else self.eval_expr(node.value, env)
            raise IRReturnSignal(val)
        raise EvalError(f"unknown IR stmt {type(node).__name__}")

    def eval_expr(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ir.Const):
            return node.value
        if isinstance(node, ir.InterpolatedStringExpr):
            from .ir import lower_expr
            from .parser import parse_expression
            from .string_interpolate import interpolate_string

            def eval_inner(src: str) -> Any:
                sub = parse_expression(src, filename=str(self.file_path.name))
                return self.eval_expr(lower_expr(sub), env)

            return interpolate_string(
                node.template,
                eval_inner,
                eval_inner,
                lambda value: _stringify(value, self.types),
            )
        if isinstance(node, ir.LoadName):
            return self._resolve(node.name, env)
        if isinstance(node, ir.LoadSlot):
            return self._resolve(node.name, env)
        if isinstance(node, ir.CallExpr):
            fn = self.eval_expr(node.func, env)
            args = [self.eval_expr(a, env) for a in node.args]
            kwargs = [(name, self.eval_expr(value, env)) for name, value in node.kwargs]
            spreads = [self.eval_expr(value, env) for value in node.spreads]
            ctor_result = runtime_collection_ctor_call(fn, args, kwargs, spreads)
            if ctor_result is not None:
                return ctor_result
            if isinstance(fn, PrimType):
                if kwargs or spreads:
                    raise EvalError("type casts do not accept keyword or spread arguments")
                if len(args) == 1:
                    variants = self.cast_overloads.get(fn.name) or []
                    cast_fn = self._pick_best_ir_overload(
                        [candidate for candidate in variants if len(candidate.param_specs) == 1],
                        args,
                    )
                    if cast_fn is not None:
                        return self._call(cast_fn, args)
                return fn(*args)
            if isinstance(fn, IRFunctionValue):
                return self._call(
                    fn,
                    args,
                    kwargs=kwargs,
                    spreads=spreads,
                    argument_order=node.argument_order,
                )
            if (
                isinstance(node.func, ir.AttrExpr)
                and not callable(fn)
                and not args
                and not kwargs
                and not spreads
            ):
                return fn
            if kwargs or spreads:
                raise EvalError("this IR call does not accept keyword or spread arguments")
            return self._call(fn, args)
        if isinstance(node, ir.ListExpr):
            if len(node.elements) == 1 and isinstance(node.elements[0], ir.RangeExpr):
                inner = self.eval_expr(node.elements[0], env)
                if node.elements[0].end is None:
                    if not isinstance(inner, LazyInfiniteIterator):
                        raise EvalError("internal: lazy range expected iterator")
                    return LazyList(inner)
                return list(inner)
            out: list[Any] = []
            literal_zero_indices: set[int] = set()
            for element_index, element in enumerate(node.elements):
                if isinstance(element, ir.SpliceExpr):
                    spread_value = self.eval_expr(element.expr, env)
                    if isinstance(spread_value, list):
                        out.extend(spread_value)
                        continue
                    out.extend(_spill_values_for_vector(spread_value))
                    continue
                if element_index in node.literal_zero_elements:
                    literal_zero_indices.add(len(out))
                out.append(self.eval_expr(element, env))
            return VFVector(normalize_physical_vector_components(
                out, literal_zero_indices=literal_zero_indices
            ))
        if isinstance(node, ir.TupleExpr):
            out: list[Any] = []
            for element in node.elements:
                if isinstance(element, ir.SpliceExpr):
                    spread_value = self.eval_expr(element.expr, env)
                    if isinstance(spread_value, list):
                        out.extend(spread_value)
                        continue
                    if isinstance(spread_value, tuple):
                        out.extend(spread_value)
                        continue
                    out.extend(_spill_values_for_vector(spread_value))
                    continue
                out.append(self.eval_expr(element, env))
            return tuple(out)
        if isinstance(node, ir.MapExpr):
            return make_vmap({name: self.eval_expr(value, env) for name, value in node.fields})
        if isinstance(node, ir.LinkedListExpr):
            if node.spread is not None:
                return make_vflist(self.eval_expr(node.spread, env))
            return make_vflist(self.eval_expr(e, env) for e in node.elements)
        if isinstance(node, ir.MultisetExpr):
            pairs: list[tuple[Any, int]] = []
            for value, count in node.pairs:
                pairs.append((self.eval_expr(value, env), int(self.eval_expr(count, env))))
            return make_multiset(pairs)
        if isinstance(node, ir.StructExpr):
            return {name: self.eval_expr(value, env) for name, value in node.fields}
        if isinstance(node, ir.AxisAlignExpr):
            value = self.eval_expr(node.value, env)
            key = self.eval_expr(node.key, env)
            if isinstance(key, bool):
                raise EvalError("axis key cannot be bool")
            if isinstance(key, (int, float)) and not isinstance(key, bool):
                key = str(int(key)) if isinstance(key, float) and key == int(key) else str(key)
            if not isinstance(key, str):
                raise EvalError(f"axis access for tagging expected string or number key, got {type(key).__name__}")
            if isinstance(value, AxisTaggedValue):
                raise EvalError("axis alignment expects an untagged value; value is already axis-tagged")
            if isinstance(value, dict):
                raise EvalError("axis alignment is not allowed on structs or maps (use a vector, tuple, or multiset)")
            if value is None or isinstance(value, (bool, int, float, str)):
                raise EvalError("axis alignment is not allowed on scalars or strings")
            if isinstance(value, list):
                value = tuple(value)
            return axis_tagged_wrap(value, key)
        if isinstance(node, ir.AttrExpr):
            base = self.eval_expr(node.value, env)
            if node.name == "idx" and isinstance(base, AxisTaggedValue):
                return base.idx
            if isinstance(base, IRFunctionValue):
                param_names = {spec.name for spec in base.param_specs}
                if node.name in param_names:
                    raise EvalError(
                        f"cannot read parameter {node.name!r} on function; "
                        "it is only bound when the function is called"
                    )
                source = next(
                    (
                        stmt.value
                        for stmt in base.body.statements
                        if isinstance(stmt, (ir.StoreName, ir.StoreSlot))
                        and stmt.name == node.name
                    ),
                    None,
                )
                if source is None:
                    raise EvalError(f"function has no body binding {node.name!r}")
                if _ir_expr_refs_names(source, param_names):
                    return _ir_expr_to_compact_string(source)
                return self.eval_expr(source, dict(base.closure))
            type_attr = runtime_type_member_callable(base, node.name)
            if type_attr is not None:
                return type_attr
            collection_attr = runtime_collection_read_attr(base, node.name)
            if collection_attr is not None:
                return collection_attr
            if isinstance(base, dict):
                if node.name in base:
                    return base[node.name]
                overload = self._dispatch_operator_overload(".", [base, node.name])
                if overload is not None:
                    return overload
                raise EvalError(f"missing field {node.name!r}")
            if hasattr(base, "items") and hasattr(base, "get") and hasattr(base, "__contains__"):
                if node.name in base:
                    return base.get(node.name)
                overload = self._dispatch_operator_overload(".", [base, node.name])
                if overload is not None:
                    return overload
                raise EvalError(f"missing field {node.name!r}")
            if getattr(type(base), "__vf_py_attrs__", False):
                if not hasattr(base, node.name):
                    raise EvalError(f"missing attribute {node.name!r}")
                return getattr(base, node.name)
            raise EvalError("attribute access on non-struct")
        if isinstance(node, ir.IndexExpr):
            base = self.eval_expr(node.value, env)
            keys = [self.eval_expr(idx, env) for idx in node.indices]
            if len(keys) > 1:
                return tuple(self._index_value(base, key) for key in keys)
            return base if not keys else self._index_value(base, keys[0])
        if isinstance(node, ir.RangeExpr):
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
                return _ir_materialize_inclusive_range(0, int(hi))
            start = self.eval_expr(node.start, env)
            end = self.eval_expr(node.end, env)
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                raise EvalError("range endpoints must be numbers")
            return _ir_materialize_inclusive_range(int(start), int(end))
        if isinstance(node, ir.PipeChainExpr):
            return self._eval_pipe_chain(node, env)
        if isinstance(node, ir.AbsExpr):
            return abs_or_norm(self.eval_expr(node.inner, env))
        if isinstance(node, ir.TypeOfExpr):
            value = self.eval_expr(node.value, env)
            if value is None:
                return None
            if isinstance(value, PrimType):
                return primitive_signature(value.name)
            return infer_type(value, self.types)
        if isinstance(node, ir.ScopeExpr):
            loc = dict(env)
            try:
                return self.eval_block_result(node.body, loc)
            except IRReturnSignal as r:
                return r.value
        if isinstance(node, ir.ScopeIdentityExpr):
            return _local_scope_as_record(env)
        if isinstance(node, ir.SpillExpr):
            return _spill_expr_record(self.eval_expr(node.value, env))
        if isinstance(node, ir.CoerceExpr):
            value = self.eval_expr(node.expr, env)
            target_type = self._resolve_runtime_type_expr(node.target_type, env)
            value, _ = coerce_typed_value(value, target_type, self.types)
            return value
        if isinstance(node, ir.BindExpr):
            value = self.eval_expr(node.value, env)
            self._assign_bind_expr(node.target, value, env)
            return value
        if isinstance(node, ir.UnaryExpr):
            operand = self.eval_expr(node.operand, env)
            sym = UNARY_KIND_TO_SYM.get(node.op)
            if sym is not None:
                overload = self._dispatch_operator_overload(sym, [operand])
                if overload is not None:
                    return overload
            if node.op == "MINUS":
                return -operand
            if node.op == "NOT":
                return not bool(operand)
            raise EvalError(f"unsupported IR unary op: {node.op}")
        if isinstance(node, ir.BinaryExpr):
            left = self.eval_expr(node.left, env)
            right = self.eval_expr(node.right, env)
            sym = BINOP_KIND_TO_SYM.get(node.op)
            if sym is not None:
                overload = self._dispatch_operator_overload(sym, [left, right])
                if overload is not None:
                    return overload
            mixed_string, mixed_value = mixed_string_binary(
                node.op, left, right, lambda value: _stringify(value, self.types)
            )
            if mixed_string:
                return mixed_value
            if is_struct_dict(left) and is_struct_dict(right):
                if node.op == "AMPERSAND":
                    return _struct_merge_concat(left, right)
                if node.op in ("LT", "LE", "GT", "GE", "EQ", "STRUCT_NEQ"):
                    return _structural_compare(node.op, left, right)
                if node.op in (
                    "PLUS",
                    "MINUS",
                    "STAR",
                    "SLASH",
                    "FLOORDIV",
                    "PERCENT",
                    "CARET",
                ):
                    defaulted = _default_struct_elementwise_binop(
                        node.op, left, right, self.types
                    )
                    if defaulted is not None:
                        return defaulted
                    raise EvalError(
                        "struct arithmetic requires matching field names and types "
                        "or an explicit operator overload"
                    )
            return _binop(node.op, left, right)
        raise EvalError(f"unknown IR expr {type(node).__name__}")

    def _index_value(self, base: Any, key: Any) -> Any:
        if isinstance(base, AxisTaggedValue):
            return self._index_value(base.data, key)
        if runtime_collection_kind(base) == "map":
            handled, value = runtime_collection_index_read(base, key)
            if handled:
                return value
        if isinstance(base, (list, tuple, str)) or (
            not isinstance(base, dict) and hasattr(base, "__getitem__") and hasattr(base, "__len__")
        ):
            return base[_ir_normalize_index(key)]
        if isinstance(base, dict):
            if key in base:
                return base[key]
            overload = self._dispatch_operator_overload(".", [base, key])
            if overload is not None:
                return overload
        raise EvalError("index access on unsupported IR value")

    def _assign_bind_expr(self, target: Any, value: Any, env: dict[str, Any]) -> None:
        if isinstance(target, (ir.LoadName, ir.LoadSlot)):
            env[target.name] = value
            return
        if isinstance(target, ir.AttrExpr):
            if target.name == "idx":
                base = self.eval_expr(target.value, env)
                if not isinstance(base, AxisTaggedValue):
                    raise EvalError(".idx assignment requires an axis-tagged value")
                if not isinstance(value, str):
                    raise EvalError("idx must be a string")
                base.idx = value
                return
            root_name, keys = _ir_attribute_chain(target)
            if root_name is not None and root_name in env:
                root_value = env[root_name]
                if runtime_collection_assign_path(root_value, keys, value):
                    return
                if not isinstance(root_value, dict):
                    raise EvalError("field bind requires struct")
                env[root_name] = _ir_dict_set_path(root_value, keys, value)
                return
            base = self.eval_expr(target.value, env)
            if runtime_collection_assign_path(base, [target.name], value):
                return
            if not isinstance(base, dict):
                raise EvalError("field bind requires struct")
            base[target.name] = value
            return
        if isinstance(target, ir.IndexExpr):
            if all(isinstance(idx, (ir.LoadName, ir.LoadSlot)) for idx in target.indices):
                container = self.eval_expr(target.value, env)
                if not isinstance(value, tuple):
                    if isinstance(value, list):
                        value = tuple(value)
                    else:
                        raise EvalError("bind pattern .(name,…) requires a tuple or vector on the right")
                if len(value) != len(target.indices):
                    raise EvalError("bind pattern length does not match value")
                for idx, item in zip(target.indices, value):
                    env[idx.name] = item
                return
            container = self.eval_expr(target.value, env)
            indices = [self.eval_expr(idx, env) for idx in target.indices]
            if not indices:
                raise EvalError("empty .() bind")
            if len(indices) == 1:
                _ir_dotted_set_one(container, indices[0], value)
                return
            if not isinstance(value, tuple):
                if isinstance(value, list):
                    value = tuple(value)
                else:
                    raise EvalError("multi-index bind requires a tuple or vector value")
            if len(value) != len(indices):
                raise EvalError("index count and value count must match")
            for idx, item in zip(indices, value):
                _ir_dotted_set_one(container, idx, item)
            return
        raise EvalError(f"unsupported IR bind target {type(target).__name__}")

    def _call(
        self,
        fn: Any,
        args: list[Any],
        *,
        kwargs: list[tuple[str, Any]] | None = None,
        spreads: list[Any] | None = None,
        argument_order: list[tuple[str, int]] | None = None,
    ) -> Any:
        if not isinstance(fn, IRFunctionValue):
            return self._call_impl(
                fn,
                args,
                kwargs=kwargs,
                spreads=spreads,
                argument_order=argument_order,
            )
        self._vf_call_depth += 1
        try:
            if self._vf_call_depth > self._vf_call_depth_limit:
                raise RecursionError(
                    f"infinite recursion or recursion depth exceeded in {fn.name!r}"
                )
            return self._call_impl(
                fn,
                args,
                kwargs=kwargs,
                spreads=spreads,
                argument_order=argument_order,
            )
        except RecursionError as err:
            if "infinite recursion or recursion depth exceeded" in str(err):
                raise
            raise RecursionError(
                f"infinite recursion or recursion depth exceeded in {fn.name!r}"
            ) from None
        finally:
            self._vf_call_depth -= 1

    def _call_impl(
        self,
        fn: Any,
        args: list[Any],
        *,
        kwargs: list[tuple[str, Any]] | None = None,
        spreads: list[Any] | None = None,
        argument_order: list[tuple[str, int]] | None = None,
    ) -> Any:
        if isinstance(fn, IRFunctionValue):
            loc = dict(fn.closure)
            size_bindings: dict[str, int] = {}
            positional: list[Any] = []
            named: dict[str, Any] = {}
            named_source: dict[str, str] = {}
            named_started = False
            kw_values = kwargs or []
            spread_values = spreads or []
            order = argument_order or (
                [("positional", idx) for idx in range(len(args))]
                + [("named", idx) for idx in range(len(kw_values))]
                + [("spread", idx) for idx in range(len(spread_values))]
            )
            for kind, index in order:
                if kind == "positional":
                    if named_started:
                        raise EvalError("positional arguments cannot appear after named arguments")
                    positional.append(args[index])
                    continue
                if kind == "named":
                    named_started = True
                    name, value = kw_values[index]
                    if named_source.get(name) == "direct":
                        raise EvalError(f"multiple values for argument {name!r}")
                    named[name] = value
                    named_source[name] = "direct"
                    continue
                spread = spread_values[index]
                if isinstance(spread, dict) or runtime_collection_kind(spread) == "map":
                    named_started = True
                    for key, value in spread.items():
                        if str(key).startswith("__vf_"):
                            continue
                        if not isinstance(key, str):
                            raise EvalError("map argument spill requires string keys")
                        named[key] = value
                        named_source[key] = "spread"
                    continue
                if named_started:
                    raise EvalError("positional arguments cannot appear after named arguments")
                try:
                    positional.extend(runtime_collection_expanded_values(spread))
                except TypeError as exc:
                    raise EvalError(
                        "argument spill requires a vector/list/tuple or record/map value"
                    ) from exc

            fixed_specs = [
                (idx, spec)
                for idx, spec in enumerate(fn.param_specs)
                if not getattr(spec, "variadic_positional", False)
                and not getattr(spec, "variadic_named", False)
            ]
            var_pos = next((spec for spec in fn.param_specs if getattr(spec, "variadic_positional", False)), None)
            var_named = next((spec for spec in fn.param_specs if getattr(spec, "variadic_named", False)), None)
            if len(positional) > len(fixed_specs) and var_pos is None:
                raise EvalError("too many positional arguments")
            fixed_names = {spec.name for _, spec in fixed_specs}
            unknown_named = {key: value for key, value in named.items() if key not in fixed_names}
            if unknown_named and var_named is None:
                raise EvalError(f"unknown argument {next(iter(unknown_named))!r}")

            used_named: set[str] = set()
            for fixed_index, (idx, spec) in enumerate(fixed_specs):
                declared_type = fn.param_types[idx] if idx < len(fn.param_types) else None
                if spec.name in named:
                    arg = named[spec.name]
                    used_named.add(spec.name)
                elif fixed_index < len(positional):
                    arg = positional[fixed_index]
                elif getattr(spec, "default_expr", None) is not None:
                    arg = self.eval_expr(ir.lower_expr(spec.default_expr), loc)
                else:
                    raise EvalError(f"missing argument {spec.name!r}")
                if declared_type is not None:
                    arg, size_bindings = coerce_typed_value(arg, declared_type, self.types, size_bindings)
                loc[spec.name] = arg
            if var_pos is not None:
                loc[var_pos.name] = tuple(positional[len(fixed_specs):])
            if var_named is not None:
                loc[var_named.name] = make_vmap(
                    {key: value for key, value in named.items() if key not in used_named and key not in fixed_names}
                )
            try:
                result = self.eval_block_result(fn.body, loc)
            except IRReturnSignal as r:
                result = r.value
            if fn.return_type is not None:
                resolved_return = resolve_return_type(fn.return_type, size_bindings)
                result, _ = coerce_typed_value(result, resolved_return, self.types, size_bindings)
            return result
        if isinstance(fn, IROpCallable):
            overload = self._dispatch_operator_overload(fn.symbol, args)
            if overload is not None:
                return overload
            raise EvalError(f"no matching overload for {fn.symbol!r} with {len(args)} argument(s)")
        if callable(fn):
            return fn(*args)
        raise EvalError(f"not callable: {type(fn).__name__}")

    def _pick_best_ir_overload(self, variants: list[IRFunctionValue], args: list[Any]) -> IRFunctionValue | None:
        wrapped = []
        for fn in variants:
            wrapped.append(type("IROverloadCandidate", (), {"params": fn.param_specs, "target": fn})())
        best = _pick_best_overload(wrapped, args, self.types)
        return None if best is None else best.target

    def _dispatch_operator_overload(self, sym: str, args: list[Any]) -> Any | None:
        variants = self.op_overloads.get(sym) or []
        fn = self._pick_best_ir_overload(variants, args)
        if fn is None:
            return None
        return self._call(fn, args)

    def _match_specificity(self, a: Any, b: Any) -> int | None:
        if isinstance(a, int) and isinstance(b, int):
            s = event_match_specificity(a, b)
            if s is not None:
                return s
            s = event_match_specificity(b, a)
            if s is not None:
                return s
            return None
        return 0 if a == b else None

    def _eval_dot_module_segments(self, segments: list[str]) -> Any:
        cache_key = ("dot", str(self.base_dir), tuple(segments))
        if cache_key in self.module_cache:
            return self.module_cache[cache_key]
        try:
            resolved = resolve_dot_module(self.base_dir, segments)
        except FileNotFoundError:
            if len(segments) == 1 and segments[0] in STDLIB_MODULES:
                module_value = resolve_stdlib(segments[0])
                self.module_cache[cache_key] = module_value
                return module_value
            raise EvalError(f"module not found: {segments!r}") from None
        if resolved.is_file():
            namespace = self._load_vkf_file(resolved)
            self.module_cache[cache_key] = namespace
            return namespace
        if resolved.is_dir():
            namespace = self._load_folder(resolved)
            self.module_cache[cache_key] = namespace
            return namespace
        raise EvalError(f"not a file or directory: {resolved}")

    def _load_vkf_file(self, path: Path) -> dict[str, Any]:
        from .parser import parse_module

        source = path.read_text(encoding="utf-8")
        module = parse_module(source, filename=str(path))
        lowered = ir.lower_module(module)
        child = IRExecutor(path)
        child.module_cache = self.module_cache
        child.builtin = {}
        child._merge_stdlibs()
        child.globals = {}
        child.run_module(lowered)
        self.types.update(child.types)
        for key, variants in child.op_overloads.items():
            self.op_overloads.setdefault(key, []).extend(variants)
        return _ir_exports(child.globals)

    def _load_folder(self, folder: Path) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for path in sorted(folder.iterdir()):
            if path.name.startswith("_"):
                continue
            if path.is_file() and path.suffix.lower() == ".vkf":
                out[path.stem] = self._load_vkf_file(path)
            elif path.is_dir():
                out[path.name] = self._load_folder(path)
        return out

    def _pipe_bind_dollar(self, rhs: Any, env: dict[str, Any], dollar: Any) -> Any:
        e2 = dict(env)
        e2["$"] = dollar
        if isinstance(rhs, ir.Block):
            try:
                return self.eval_block_result(rhs, e2)
            except IRReturnSignal as ret:
                return ret.value
        try:
            return self.eval_expr(rhs, e2)
        except IRReturnSignal as ret:
            return ret.value

    def _pipe_one_element_through_segments(self, el: Any, segs: list[Any], env: dict[str, Any]) -> Any:
        v = el
        for seg in segs:
            v = self._pipe_bind_dollar(seg, env, v)
        return v

    def _eval_pipe_chain(self, node: ir.PipeChainExpr, env: dict[str, Any]) -> Any:
        left_v = self.eval_expr(node.source, env)
        segs = node.segments
        if not segs:
            return left_v

        if isinstance(left_v, AxisTaggedValue):
            data = left_v.data
            if isinstance(data, tuple):
                return AxisTaggedValue(tuple(self._pipe_one_element_through_segments(el, segs, env) for el in data), left_v.idx)
            if isinstance(data, VFVector):
                return AxisTaggedValue(VFVector(self._pipe_one_element_through_segments(el, segs, env) for el in data), left_v.idx)
            runtime_values = runtime_collection_elementwise_values(data)
            if runtime_values is not None:
                out = [self._pipe_one_element_through_segments(el, segs, env) for el in runtime_values]
                handled, mapped = runtime_collection_pipe_result(data, out)
                if handled:
                    return AxisTaggedValue(mapped, left_v.idx)
            return self._pipe_one_element_through_segments(left_v, segs, env)

        if isinstance(left_v, tuple):
            return tuple(self._pipe_one_element_through_segments(el, segs, env) for el in left_v)
        if isinstance(left_v, list):
            return [self._pipe_one_element_through_segments(el, segs, env) for el in left_v]
        if isinstance(left_v, VFVector):
            return VFVector(self._pipe_one_element_through_segments(el, segs, env) for el in left_v)
        if isinstance(left_v, str):
            return "".join(str(self._pipe_one_element_through_segments(ch, segs, env)) for ch in left_v)
        if isinstance(left_v, frozenset):
            return frozenset(self._pipe_one_element_through_segments(el, segs, env) for el in left_v)
        if isinstance(left_v, set):
            return set(self._pipe_one_element_through_segments(el, segs, env) for el in left_v)
        runtime_values = runtime_collection_elementwise_values(left_v)
        if runtime_values is not None:
            out = [self._pipe_one_element_through_segments(el, segs, env) for el in runtime_values]
            handled, mapped = runtime_collection_pipe_result(left_v, out)
            if handled:
                return mapped
        if isinstance(left_v, LazyInfiniteIterator):
            for el in left_v:
                try:
                    self._pipe_one_element_through_segments(el, segs, env)
                except IRBreakSignal:
                    break
                except IRContinueSignal:
                    continue
            return None
        return self._pipe_one_element_through_segments(left_v, segs, env)


def _ir_attribute_chain(target: ir.AttrExpr) -> tuple[str | None, list[str]]:
    keys: list[str] = []
    cur: Any = target
    while isinstance(cur, ir.AttrExpr):
        keys.append(cur.name)
        cur = cur.value
    if not isinstance(cur, (ir.LoadName, ir.LoadSlot)):
        return None, list(reversed(keys))
    keys.reverse()
    return cur.name, keys


def _ir_dict_set_path(d: dict[str, Any], keys: list[str], value: Any) -> dict[str, Any]:
    if len(keys) == 1:
        out = dict(d)
        out[keys[0]] = value
        return out
    head = keys[0]
    child = d.get(head)
    if not isinstance(child, dict):
        child = {}
    out = dict(d)
    out[head] = _ir_dict_set_path(dict(child), keys[1:], value)
    return out


def _ir_normalize_index(idx: Any) -> Any:
    if isinstance(idx, bool):
        raise EvalError("index must be int or str")
    if isinstance(idx, complex):
        if idx.imag == 0 and idx.real == int(idx.real):
            return int(idx.real)
        raise EvalError("index must be int or str")
    if isinstance(idx, float) and idx == int(idx):
        return int(idx)
    if isinstance(idx, int):
        return idx
    if isinstance(idx, str):
        return idx
    raise EvalError("index must be int or str")


def _ir_expr_refs_names(node: Any, names: set[str]) -> bool:
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return node.name in names
    if isinstance(node, ir.UnaryExpr):
        return _ir_expr_refs_names(node.operand, names)
    if isinstance(node, ir.BinaryExpr):
        return _ir_expr_refs_names(node.left, names) or _ir_expr_refs_names(node.right, names)
    if isinstance(node, ir.CallExpr):
        return (
            _ir_expr_refs_names(node.func, names)
            or any(_ir_expr_refs_names(value, names) for value in node.args)
            or any(_ir_expr_refs_names(value, names) for _, value in node.kwargs)
            or any(_ir_expr_refs_names(value, names) for value in node.spreads)
        )
    if isinstance(node, ir.AttrExpr):
        return _ir_expr_refs_names(node.value, names)
    return False


def _ir_expr_to_compact_string(node: Any) -> str:
    if isinstance(node, ir.Const):
        return _stringify(node.value, {})
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return node.name
    if isinstance(node, ir.UnaryExpr):
        symbol = UNARY_KIND_TO_SYM.get(node.op, node.op)
        return f"{symbol}{_ir_expr_to_compact_string(node.operand)}"
    if isinstance(node, ir.BinaryExpr):
        if (
            node.op == "STAR"
            and isinstance(node.left, ir.Const)
            and isinstance(node.left.value, (int, float))
            and not isinstance(node.left.value, bool)
            and isinstance(node.right, (ir.LoadName, ir.LoadSlot))
        ):
            return (
                f"{_ir_expr_to_compact_string(node.left)}"
                f"{_ir_expr_to_compact_string(node.right)}"
            )
        symbol = BINOP_KIND_TO_SYM.get(node.op, node.op)
        return (
            f"{_ir_expr_to_compact_string(node.left)}"
            f"{symbol}"
            f"{_ir_expr_to_compact_string(node.right)}"
        )
    if isinstance(node, ir.AttrExpr):
        return f"{_ir_expr_to_compact_string(node.value)}.{node.name}"
    return type(node).__name__


def _ir_dotted_set_one(container: Any, idx: Any, value: Any) -> None:
    if runtime_collection_kind(container) == "map":
        if runtime_collection_index_set(container, idx, value):
            return
    key = _ir_normalize_index(idx)
    if runtime_collection_index_set(container, key, value):
        return
    if isinstance(container, (list, VFVector)):
        container[key] = value
        return
    if isinstance(container, dict):
        container[key] = value
        return
    raise EvalError("cannot assign through .() on this value")


def _ir_materialize_inclusive_range(lo: int, hi: int) -> tuple[int, ...]:
    if lo <= hi:
        return tuple(range(lo, hi + 1))
    return tuple(range(lo, hi - 1, -1))


def _ir_exports(env: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in env.items() if not k.startswith("_")}


def _ir_spill_exports(env: dict[str, Any], short_name: str) -> dict[str, Any]:
    return {k: v for k, v in _ir_exports(env).items() if k != short_name}
