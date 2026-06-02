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
    _pick_best_overload,
    _pick_overload_for_symbol,
    _stringify,
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
    runtime_collection_index_set,
    runtime_collection_pipe_result,
    runtime_collection_preserves_pipe_result,
    runtime_collection_read_attr,
)
from .runtime.type_values import PrimType, coerce_typed_value, is_type_value, resolve_return_type
from .runtime.type_surface import runtime_type_surface_metadata
from .runtime.absnorm import abs_or_norm
from .runtime.type_values import infer_type
from .stdlib import STDLIB_MODULES, resolve_stdlib
from .stdlib.events import event_match_specificity
from . import ir


class IRReturnSignal(Exception):
    def __init__(self, value: Any) -> None:
        super().__init__("ir return")
        self.value = value


class IRBreakSignal(Exception):
    pass


class IRContinueSignal(Exception):
    pass


@dataclass
class IRFunctionValue:
    name: str
    params: list[str]
    body: ir.Block
    closure: dict[str, Any]
    param_types: list[Any]
    return_type: Any | None
    param_specs: list[Any] = field(default_factory=list)


@dataclass
class IROpCallable:
    symbol: str


@dataclass
class IRExecutor:
    file_path: Path

    def __post_init__(self) -> None:
        self.file_path = self.file_path.resolve()
        self.base_dir = self.file_path.parent
        self.globals: dict[str, Any] = {}
        self.builtin: dict[str, Any] = {}
        self.types: dict[str, Any] = {}
        self.op_overloads: dict[str, list[IRFunctionValue]] = {}
        self.cast_overloads: dict[str, list[IRFunctionValue]] = {}
        self.module_cache: dict[Any, Any] = {}
        self._merge_stdlibs()
        self.builtin["i"] = 1j
        self.builtin["j"] = 1j
        self.builtin["take"] = _builtin_take
        self.builtin["to_list"] = _builtin_to_list
        self.builtin["to_multiset"] = _builtin_to_multiset
        for _tn in ("int", "num", "str", "byte", "bytes", "bool", "any"):
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
        return None

    def exec_block(self, block: ir.Block, env: dict[str, Any]) -> None:
        for stmt in block.statements:
            self.exec_stmt(stmt, env)

    def eval_block_result(self, block: ir.Block, env: dict[str, Any]) -> Any:
        result: Any = None
        for stmt in block.statements:
            result = self.exec_stmt(stmt, env)
        return result

    def exec_stmt(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ir.TypeDef):
            self.types[node.name] = node.type_expr
            return None
        if isinstance(node, ir.StoreName):
            val = self.eval_expr(node.value, env)
            if node.declared_type is not None:
                val, _ = coerce_typed_value(val, node.declared_type, self.types)
            if node.declared_type is None and is_type_value(val):
                self.types[node.name] = val
            env[node.name] = val
            return val
        if isinstance(node, ir.StoreSlot):
            val = self.eval_expr(node.value, env)
            if node.declared_type is not None:
                val, _ = coerce_typed_value(val, node.declared_type, self.types)
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
            fn.closure[node.name] = fn
            if node.name in ("num", "str", "bool", "byte") and len(node.param_specs) == 1:
                self.cast_overloads.setdefault(node.name, []).append(fn)
            elif node.name in OPERATOR_SYMBOLS:
                self.op_overloads.setdefault(node.name, []).append(fn)
                env[node.name] = IROpCallable(node.name)
            else:
                env[node.name] = fn
            return None
        if isinstance(node, ir.ExprStmt):
            return self.eval_expr(node.expr, env)
        if isinstance(node, ir.PrintStmt):
            value = self.eval_expr(node.value, env)
            print(_stringify(value, self.types), end="", flush=True)
            return None
        if isinstance(node, ir.LabelPrintStmt):
            value = self.eval_expr(node.value, env)
            print(f"{node.expr_text}: {_stringify(value, self.types)}")
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
            while True:
                disc = self.eval_expr(node.discriminant, env)
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
                try:
                    self.eval_block_result(chosen.body, env)
                except IRContinueSignal:
                    if node.loop:
                        continue
                    return None
                except IRBreakSignal:
                    return None
                if not node.loop:
                    return None
            return None
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
            for element in node.elements:
                if isinstance(element, ir.SpliceExpr):
                    spread_value = self.eval_expr(element.expr, env)
                    if isinstance(spread_value, list):
                        out.extend(spread_value)
                        continue
                    out.extend(_spill_values_for_vector(spread_value))
                    continue
                out.append(self.eval_expr(element, env))
            return out
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
            raise EvalError("attribute access on non-struct")
        if isinstance(node, ir.IndexExpr):
            base = self.eval_expr(node.value, env)
            for idx in node.indices:
                key = self.eval_expr(idx, env)
                if isinstance(base, (list, tuple, str)):
                    base = base[int(key)]
                    continue
                if isinstance(base, dict):
                    if key in base:
                        base = base[key]
                        continue
                    overload = self._dispatch_operator_overload(".", [base, key])
                    if overload is not None:
                        base = overload
                        continue
                raise EvalError("index access on unsupported IR value")
            return base
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
            return infer_type(self.eval_expr(node.value, env), self.types)
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
            value, _ = coerce_typed_value(value, node.target_type, self.types)
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
            return _binop(node.op, left, right)
        raise EvalError(f"unknown IR expr {type(node).__name__}")

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

    def _call(self, fn: Any, args: list[Any]) -> Any:
        if isinstance(fn, IRFunctionValue):
            loc = dict(fn.closure)
            size_bindings: dict[str, int] = {}
            fixed_param_count = len([spec for spec in fn.param_specs if not getattr(spec, "variadic_positional", False) and not getattr(spec, "variadic_named", False)])
            arg_index = 0
            for idx, spec in enumerate(fn.param_specs):
                declared_type = fn.param_types[idx] if idx < len(fn.param_types) else None
                if getattr(spec, "variadic_positional", False):
                    rest = args[arg_index:]
                    if declared_type is not None:
                        coerced_rest = []
                        for raw in rest:
                            coerced, size_bindings = coerce_typed_value(raw, declared_type, self.types, size_bindings)
                            coerced_rest.append(coerced)
                        rest = coerced_rest
                    loc[spec.name] = tuple(rest)
                    arg_index = len(args)
                    continue
                if getattr(spec, "variadic_named", False):
                    loc[spec.name] = make_vmap({})
                    continue
                if arg_index >= len(args):
                    raise EvalError(f"missing argument {spec.name!r}")
                arg = args[arg_index]
                arg_index += 1
                if declared_type is not None:
                    arg, size_bindings = coerce_typed_value(arg, declared_type, self.types, size_bindings)
                loc[spec.name] = arg
            if arg_index < len(args) and len(fn.param_specs) == fixed_param_count:
                raise EvalError("too many positional arguments")
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
            return self.eval_block_result(rhs, e2)
        return self.eval_expr(rhs, e2)

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
                self._pipe_one_element_through_segments(el, segs, env)
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
    if isinstance(idx, float) and idx == int(idx):
        return int(idx)
    if isinstance(idx, int):
        return idx
    if isinstance(idx, str):
        return idx
    raise EvalError("index must be int or str")


def _ir_dotted_set_one(container: Any, idx: Any, value: Any) -> None:
    key = _ir_normalize_index(idx)
    if runtime_collection_index_set(container, key, value):
        return
    if isinstance(container, list):
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
