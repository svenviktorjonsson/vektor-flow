"""Small IR executor used to validate lowered semantics against the AST interpreter."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import ast
from .errors import EvalError
from .interpreter import (
    BINOP_KIND_TO_SYM,
    OPERATOR_SYMBOLS,
    UNARY_KIND_TO_SYM,
    VFunction,
    VStructCtor,
    _expr_refs_param,
    _expr_to_compact_string,
    _binop,
    _default_struct_elementwise_binop,
    _stringify,
)
from .runtime import axis_tagged_idx, axis_tagged_set_idx, is_axis_tagged_value, make_multiset, make_vflist, make_vmap, runtime_collection_ctor_call
from .runtime.struct_value import (
    apply_struct_unary_fallback,
    bind_struct_constructor_fields,
    construct_struct_value,
    is_struct_dict,
    merge_struct_values,
    read_struct_field,
    score_struct_type_match,
)
from .runtime.compare import runtime_match_eq, runtime_match_specificity, struct_compare_binop
from .runtime.call_args import bind_function_call_args
from .runtime import (
    runtime_collection_assign_path,
    runtime_collection_index_read,
    runtime_collection_index_set,
    runtime_collection_read_attr,
    runtime_value_index_get,
    runtime_value_index_set,
)
from .runtime.type_values import PrimType, coerce_typed_value, infer_type, is_type_value, resolve_return_type, types_equal
from .runtime.type_values import coerce_value
from .stdlib import STDLIB_AUTOLOADED_NAMESPACES, STDLIB_MODULES, resolve_stdlib
from . import ir
from .ir import lower_function_parts, lower_module


class IRReturnSignal(Exception):
    def __init__(self, value: Any) -> None:
        super().__init__("ir return")
        self.value = value


class IRBreakSignal(Exception):
    pass


class IRContinueSignal(Exception):
    pass


@dataclass(frozen=True)
class IRExecutionOutcome:
    result: Any
    globals: dict[str, Any]
    types: dict[str, Any]
    module: ir.Module


@dataclass
class IRFunctionValue:
    name: str
    params: list[str]
    body: ir.Block
    closure: dict[str, Any]
    param_specs: list[Any]
    param_types: list[Any]
    return_type: Any | None


@dataclass
class IROverloadedCallable:
    name: str
    variants: list[IRFunctionValue]


def _score_ir_param_specs_match(
    param_specs: list[Any],
    args: list[Any],
    types: dict[str, Any],
) -> int | None:
    if len(param_specs) != len(args):
        return None
    score = 0
    for p, av in zip(param_specs, args):
        if p.param_func_type is not None:
            if not isinstance(av, (IRFunctionValue, VFunction)):
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
            struct_score = score_struct_type_match(av, p.type_name, types)
            if struct_score is not None:
                score += struct_score
                continue
        return None
    return score


def _pick_best_ir_overload(
    variants: list[IRFunctionValue],
    args: list[Any],
    types: dict[str, Any],
) -> IRFunctionValue | None:
    best: IRFunctionValue | None = None
    best_score = -1
    for fn in variants:
        match_score = _score_ir_param_specs_match(fn.param_specs, args, types)
        if match_score is None:
            continue
        if match_score > best_score:
            best_score = match_score
            best = fn
    return best


def _resolve_ir_overload_callable(
    env: dict[str, Any],
    symbol: str,
) -> IROverloadedCallable | None:
    candidate = env.get(symbol)
    if isinstance(candidate, IROverloadedCallable):
        return candidate
    return None


def execute_unary_via_runtime(
    env: dict[str, Any],
    op: str,
    value: Any,
    types: dict[str, Any],
) -> tuple[bool, Any]:
    symbol = UNARY_KIND_TO_SYM.get(op)
    if symbol and isinstance(value, dict) and is_struct_dict(value):
        overloads = _resolve_ir_overload_callable(env, symbol)
        if overloads is not None:
            overload = _pick_best_ir_overload(overloads.variants, [value], types)
            if overload is not None:
                return True, (overloads, overload, [value])
    handled, result = apply_struct_unary_fallback(op, value, EvalError)
    if handled:
        return True, result
    return False, None


def execute_binary_via_runtime(
    env: dict[str, Any],
    op: str,
    left: Any,
    right: Any,
    types: dict[str, Any],
) -> tuple[bool, Any]:
    symbol = BINOP_KIND_TO_SYM.get(op)
    both_struct = bool(is_struct_dict(left) and is_struct_dict(right))
    if symbol and (is_struct_dict(left) or is_struct_dict(right)):
        overloads = _resolve_ir_overload_callable(env, symbol)
        if overloads is not None:
            overload = _pick_best_ir_overload(overloads.variants, [left, right], types)
            if overload is not None:
                return True, (overloads, overload, [left, right])
    if symbol and both_struct:
        if op == "AMPERSAND":
            return True, merge_struct_values(left, right)
        comparison = struct_compare_binop(op, left, right, types)
        if comparison is not None:
            return True, comparison
        if op in {"PLUS", "MINUS", "STAR", "SLASH", "FLOOR_DIV", "PERCENT", "CARET"}:
            defaulted = _default_struct_elementwise_binop(op, left, right, types)
            if defaulted is not None:
                return True, defaulted
        if op == "PLUS":
            raise EvalError(
                "struct + struct requires a +(a, b): … overload "
                "(same field names and types, or define + with two parameters)"
            )
        raise EvalError(
            f"no overload for {symbol} on two structs; define {symbol}(a, b): …"
        )
    return False, None


def resolve_runtime_dispatch_result(
    result: Any,
    *,
    dispatch_callable: Any,
) -> Any:
    if (
        isinstance(result, tuple)
        and len(result) == 3
        and isinstance(result[0], IROverloadedCallable)
    ):
        _, overload, overload_args = result
        return dispatch_callable(overload, overload_args)
    return result


def execute_unary_expr_via_runtime(
    env: dict[str, Any],
    op: str,
    value: Any,
    types: dict[str, Any],
    *,
    dispatch_callable: Any,
) -> Any:
    handled, result = execute_unary_via_runtime(env, op, value, types)
    if handled:
        return resolve_runtime_dispatch_result(
            result,
            dispatch_callable=dispatch_callable,
        )
    if op == "MINUS":
        return -value
    if op == "NOT":
        return not execute_truthiness_via_runtime(value)
    raise EvalError(f"unknown unary {op}")


def execute_binary_expr_via_runtime(
    env: dict[str, Any],
    op: str,
    left: Any,
    right: Any,
    types: dict[str, Any],
    *,
    dispatch_callable: Any,
) -> Any:
    handled, result = execute_binary_via_runtime(env, op, left, right, types)
    if handled:
        return resolve_runtime_dispatch_result(
            result,
            dispatch_callable=dispatch_callable,
        )
    if op == "EQ" and is_type_value(left) and is_type_value(right):
        return types_equal(left, right)
    if op == "NEQ" and is_type_value(left) and is_type_value(right):
        return not types_equal(left, right)
    if op == "PLUS":
        if isinstance(left, str) and not isinstance(right, str):
            return left + _stringify(right, types)
        if isinstance(right, str) and not isinstance(left, str):
            return _stringify(left, types) + right
    if op == "AMPERSAND":
        if isinstance(left, str) and not isinstance(right, str):
            return left + _stringify(right, types)
        if isinstance(right, str) and not isinstance(left, str):
            return _stringify(left, types) + right
    if op == "AND":
        return execute_truthiness_via_runtime(left) and execute_truthiness_via_runtime(right)
    if op == "OR":
        return execute_truthiness_via_runtime(left) or execute_truthiness_via_runtime(right)
    if op == "XOR":
        return execute_truthiness_via_runtime(left) != execute_truthiness_via_runtime(right)
    return _binop(op, left, right)


def execute_const_unary_expr_via_runtime(op: str, value: Any) -> Any:
    return execute_unary_expr_via_runtime(
        {},
        op,
        value,
        {},
        dispatch_callable=lambda _overload, _args: (_ for _ in ()).throw(
            EvalError("const unary folding cannot dispatch dynamic overloads")
        ),
    )


def execute_const_binary_expr_via_runtime(op: str, left: Any, right: Any) -> Any:
    return execute_binary_expr_via_runtime(
        {},
        op,
        left,
        right,
        {},
        dispatch_callable=lambda _overload, _args: (_ for _ in ()).throw(
            EvalError("const binary folding cannot dispatch dynamic overloads")
        ),
    )


def select_match_arm_via_runtime(
    discriminant: Any,
    arms: list[Any],
    *,
    eval_condition: Any,
    match_specificity: Any,
) -> Any | None:
    chosen = None
    best_spec = -1
    default_arm = None
    for arm in arms:
        condition = getattr(arm, "condition", None)
        if condition is None:
            if default_arm is None:
                default_arm = arm
            continue
        spec = match_specificity(discriminant, eval_condition(condition))
        if spec is None:
            continue
        if spec > best_spec:
            best_spec = spec
            chosen = arm
    return chosen if chosen is not None else default_arm


def execute_match_eq_via_runtime(
    left: Any,
    right: Any,
    types: dict[str, Any],
) -> bool:
    return runtime_match_eq(
        left,
        right,
        types,
        lambda x, y: bool(_binop("EQ", x, y)),
    )


def execute_match_specificity_via_runtime(
    left: Any,
    right: Any,
    types: dict[str, Any],
) -> int | None:
    return runtime_match_specificity(
        left,
        right,
        types,
        lambda x, y: bool(_binop("EQ", x, y)),
    )


def execute_match_stmt_via_runtime(
    *,
    loop: bool,
    arms: list[Any],
    eval_discriminant: Any,
    eval_condition: Any,
    match_specificity: Any,
    run_body: Any,
    continue_signal: type[BaseException],
    break_signal: type[BaseException],
) -> None:
    while True:
        discriminant = eval_discriminant()
        chosen = select_match_arm_via_runtime(
            discriminant,
            arms,
            eval_condition=eval_condition,
            match_specificity=match_specificity,
        )
        if chosen is None:
            return None
        if loop:
            try:
                run_body(chosen, discriminant)
            except continue_signal:
                continue
            except break_signal:
                return None
            continue
        run_body(chosen, discriminant)
        return None


def execute_catch_match_via_runtime(
    *,
    eval_discriminant: Any,
    arms: list[Any],
    eval_condition: Any,
    match_specificity: Any,
    run_body: Any,
    set_subject: Any,
    rethrow: Any,
    passthrough: tuple[type[BaseException], ...],
) -> None:
    try:
        eval_discriminant()
        return None
    except passthrough:
        raise
    except BaseException as exc:
        discriminant = exc
    set_subject(discriminant)
    chosen = select_match_arm_via_runtime(
        discriminant,
        arms,
        eval_condition=eval_condition,
        match_specificity=match_specificity,
    )
    if chosen is not None:
        run_body(chosen, discriminant)
        return None
    rethrow(discriminant)


def select_const_match_arm_via_runtime(
    discriminant: Any,
    arms: list[Any],
    *,
    match_specificity: Any,
) -> Any | None:
    return select_match_arm_via_runtime(
        discriminant,
        arms,
        eval_condition=lambda condition: condition.value if isinstance(condition, ir.Const) else condition,
        match_specificity=match_specificity,
    )


def execute_primitive_cast_call_via_runtime(
    fn: PrimType,
    args: list[Any],
    kw: dict[str, Any] | None = None,
    spreads: list[Any] | None = None,
    *,
    pick_overload: Any | None = None,
    dispatch_overload: Any | None = None,
) -> Any:
    kw = kw or {}
    spreads = spreads or []
    if spreads:
        raise EvalError("type casts do not accept spread arguments")
    if kw:
        raise EvalError("type casts do not accept keyword arguments")
    if len(args) == 1 and pick_overload is not None and dispatch_overload is not None:
        overload = pick_overload(fn.name, args)
        if overload is not None:
            return dispatch_overload(overload, args)
    return fn(*args)


def execute_const_primitive_cast_via_runtime(name: str, value: Any) -> Any:
    return execute_primitive_cast_call_via_runtime(PrimType(name), [value])


def execute_typed_coercion_via_runtime(
    value: Any,
    target_type: Any,
    types: dict[str, Any],
    size_bindings: dict[str, int] | None = None,
) -> tuple[Any, dict[str, int]]:
    return coerce_typed_value(value, target_type, types, size_bindings)


def execute_truthiness_via_runtime(value: Any) -> bool:
    return bool(value)


def execute_conditional_control_via_runtime(
    *,
    loop: bool,
    eval_condition: Any,
    run_body: Any,
    continue_signal: type[BaseException],
    break_signal: type[BaseException],
) -> None:
    if loop:
        while execute_truthiness_via_runtime(eval_condition()):
            try:
                run_body()
            except continue_signal:
                continue
            except break_signal:
                return None
        return None
    if not execute_truthiness_via_runtime(eval_condition()):
        return None
    run_body()
    return None


def execute_dot_attr_via_runtime(
    env: dict[str, Any],
    base: Any,
    name: str,
    types: dict[str, Any],
) -> tuple[bool, Any]:
    return execute_named_path_step_via_runtime(
        env,
        base,
        name,
        types,
    )


def execute_dot_attr_expr_via_runtime(
    env: dict[str, Any],
    base: Any,
    name: str,
    types: dict[str, Any],
    *,
    resolve_dispatch_result: Any,
) -> Any:
    handled, result = execute_dot_attr_via_runtime(env, base, name, types)
    if not handled:
        raise EvalError("attribute access on non-struct")
    return resolve_dispatch_result(result)


def execute_named_path_step_via_runtime(
    env: dict[str, Any],
    base: Any,
    name: str,
    types: dict[str, Any],
    *,
    missing_suffix: str = "",
) -> tuple[bool, Any]:
    if name == "idx":
        idx = axis_tagged_idx(base)
        if idx is not None:
            return True, idx
    if isinstance(base, VStructCtor):
        raise EvalError(
            f"{base.name} is a struct constructor; call {base.name}(...) to get a value"
        )
    if isinstance(base, VFunction):
        param_names = {p.name for p in base.params}
        if name in param_names:
            raise EvalError(
                f"cannot read parameter {name!r} on function; "
                "it is only bound when the function is called"
            )
        if name in base.field_sources:
            rhs = base.field_sources[name]
            if _expr_refs_param(rhs, param_names):
                return True, _expr_to_compact_string(rhs)
            e2 = dict(base.closure)
            return True, base.ip.eval_expr(rhs, e2)
        raise EvalError(f"function has no body binding {name!r}")
    collection_attr = runtime_collection_read_attr(base, name)
    if collection_attr is not None:
        return True, collection_attr
    if isinstance(base, dict):
        try:
            return True, read_struct_field(
                base,
                name,
                lambda msg: EvalError(f"{msg}{missing_suffix}"),
            )
        except EvalError:
            pass
        if is_struct_dict(base):
            overloads = _resolve_ir_overload_callable(env, ".")
            if overloads is not None:
                overload = _pick_best_ir_overload(overloads.variants, [base, name], types)
                if overload is not None:
                    return True, (overloads, overload, [base, name])
        raise EvalError(f"missing field {name!r}{missing_suffix}")
    if getattr(type(base), "__vf_py_attrs__", False):
        if not hasattr(base, name):
            raise EvalError(f"missing attribute {name!r}{missing_suffix}")
        return True, getattr(base, name)
    return False, None


def execute_named_path_chain_via_runtime(
    env: dict[str, Any],
    base: Any,
    parts: list[str],
    types: dict[str, Any],
    *,
    missing_suffix: str = "",
    resolve_dispatch_result: Any | None = None,
) -> Any:
    current = base
    for part in parts:
        handled, result = execute_named_path_step_via_runtime(
            env,
            current,
            part,
            types,
            missing_suffix=missing_suffix,
        )
        if not handled:
            raise EvalError("string interpolation path requires a struct value")
        if (
            isinstance(result, tuple)
            and len(result) == 3
            and isinstance(result[0], IROverloadedCallable)
        ):
            if resolve_dispatch_result is None:
                raise EvalError("runtime path overload requires a dispatch resolver")
            current = resolve_dispatch_result(result)
        else:
            current = result
    return current


def execute_dot_index_via_runtime(
    env: dict[str, Any],
    base: Any,
    key: Any,
    types: dict[str, Any],
) -> tuple[bool, Any]:
    try:
        handled, value = runtime_value_index_get(
            base,
            key,
            EvalError,
            runtime_collection_index_read,
        )
        if handled:
            return True, value
    except EvalError:
        if not (isinstance(base, dict) and is_struct_dict(base)):
            raise
    if isinstance(base, dict) and is_struct_dict(base):
        overloads = _resolve_ir_overload_callable(env, ".")
        if overloads is not None:
            overload = _pick_best_ir_overload(overloads.variants, [base, key], types)
            if overload is not None:
                return True, (overloads, overload, [base, key])
    raise EvalError(".(...) on unsupported value")


def execute_dot_index_expr_via_runtime(
    env: dict[str, Any],
    base: Any,
    keys: list[Any],
    types: dict[str, Any],
    *,
    resolve_dispatch_result: Any,
) -> Any:
    if len(keys) == 0:
        raise EvalError("empty .()")
    if len(keys) == 1:
        handled, result = execute_dot_index_via_runtime(env, base, keys[0], types)
        if not handled:
            raise EvalError(".(...) on unsupported value")
        return resolve_dispatch_result(result)
    out: list[Any] = []
    for key in keys:
        handled, result = execute_dot_index_via_runtime(env, base, key, types)
        if not handled:
            raise EvalError(".(...) on unsupported value")
        out.append(resolve_dispatch_result(result))
    return tuple(out)


def execute_const_dot_attr_expr_via_runtime(base: Any, name: str) -> Any:
    return execute_dot_attr_expr_via_runtime(
        {},
        base,
        name,
        {},
        resolve_dispatch_result=lambda _result: (_ for _ in ()).throw(
            EvalError("const attr folding cannot dispatch dynamic overloads")
        )
        if (
            isinstance(_result, tuple)
            and len(_result) == 3
            and isinstance(_result[0], IROverloadedCallable)
        )
        else _result,
    )


def execute_const_dot_index_expr_via_runtime(base: Any, keys: list[Any]) -> Any:
    return execute_dot_index_expr_via_runtime(
        {},
        base,
        keys,
        {},
        resolve_dispatch_result=lambda _result: (_ for _ in ()).throw(
            EvalError("const index folding cannot dispatch dynamic overloads")
        )
        if (
            isinstance(_result, tuple)
            and len(_result) == 3
            and isinstance(_result[0], IROverloadedCallable)
        )
        else _result,
    )


def _runtime_struct_assign_path(base: dict[str, Any], keys: list[str], value: Any) -> dict[str, Any]:
    if len(keys) == 1:
        out = dict(base)
        out[keys[0]] = value
        return out
    head = keys[0]
    child = base.get(head)
    if not isinstance(child, dict):
        child = {}
    out = dict(base)
    out[head] = _runtime_struct_assign_path(dict(child), keys[1:], value)
    return out


def execute_dot_attr_assign_via_runtime(
    base: Any,
    keys: list[str],
    value: Any,
) -> tuple[bool, Any]:
    if keys == ["idx"]:
        if not is_axis_tagged_value(base):
            raise EvalError(".idx assignment requires an axis-tagged value")
        if not isinstance(value, str):
            raise EvalError("idx must be a string")
        axis_tagged_set_idx(base, value)
        return True, base
    if runtime_collection_assign_path(base, keys, value):
        return True, base
    if not isinstance(base, dict):
        raise EvalError("field bind requires struct")
    return True, _runtime_struct_assign_path(base, keys, value)


def execute_dot_index_assign_via_runtime(
    base: Any,
    keys: list[Any],
    value: Any,
) -> tuple[bool, Any]:
    if len(keys) == 0:
        raise EvalError("empty .() bind")
    if len(keys) == 1:
        if runtime_value_index_set(
            base,
            keys[0],
            value,
            EvalError,
            runtime_collection_index_set,
        ):
            return True, base
        raise EvalError("cannot assign through .() on this value")
    if not isinstance(value, (list, tuple)):
        raise EvalError("multi-index bind requires a tuple or list value")
    values = list(value)
    if len(values) != len(keys):
        raise EvalError("index count and value count must match")
    for key, item in zip(keys, values):
        if not runtime_value_index_set(
            base,
            key,
            item,
            EvalError,
            runtime_collection_index_set,
        ):
            raise EvalError("cannot assign through .() on this value")
    return True, base


@dataclass
class IRExecutor:
    file_path: Path

    def __post_init__(self) -> None:
        self.file_path = self.file_path.resolve()
        self.base_dir = self.file_path.parent
        self.globals: dict[str, Any] = {}
        self.builtin: dict[str, Any] = {}
        self.types: dict[str, Any] = {}
        self._merge_stdlibs()
        self.builtin["i"] = 1j
        self.builtin["j"] = 1j
        for _tn in ("int", "num", "str", "byte", "bytes", "bool", "any"):
            self.builtin[_tn] = PrimType(_tn)

    def _merge_stdlibs(self) -> None:
        for name in STDLIB_AUTOLOADED_NAMESPACES:
            if name in STDLIB_MODULES:
                try:
                    self.builtin[name] = resolve_stdlib(name)
                except KeyError:
                    pass

    def _apply_stdlib_imports(self, module: ir.Module, env: dict[str, Any]) -> None:
        for imported in module.stdlib_imports:
            namespace = resolve_stdlib(imported.module_name)
            if imported.spill_exports:
                env.update(namespace)
            elif list(namespace.keys()) == [imported.module_name]:
                env[imported.binding_name] = namespace[imported.module_name]
                continue
            env[imported.binding_name] = namespace

    def _resolve(self, name: str, env: dict[str, Any]) -> Any:
        if name in env:
            return env[name]
        if name in self.builtin:
            return self.builtin[name]
        raise EvalError(f"undefined name: {name!r}")

    def run_module(self, module: ir.Module) -> Any:
        env = self.globals
        self._apply_stdlib_imports(module, env)
        try:
            for stmt in module.statements:
                self.exec_stmt(stmt, env)
        except IRReturnSignal as r:
            return r.value
        except IRContinueSignal:
            raise EvalError("continue is not valid here (use `?>` / `??>` loops)") from None
        except IRBreakSignal:
            raise EvalError("@| break outside >> pipe") from None
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
                val, _ = execute_typed_coercion_via_runtime(val, node.declared_type, self.types)
            if node.declared_type is None and is_type_value(val):
                self.types[node.name] = val
            env[node.name] = val
            return None
        if isinstance(node, ir.StoreSlot):
            val = self.eval_expr(node.value, env)
            if node.declared_type is not None:
                val, _ = execute_typed_coercion_via_runtime(val, node.declared_type, self.types)
            if node.declared_type is None and is_type_value(val):
                self.types[node.name] = val
            env[node.name] = val
            return None
        if isinstance(node, ir.FunctionDef):
            fn = IRFunctionValue(
                node.name,
                list(node.params),
                node.body,
                dict(env),
                list(node.param_specs or []),
                list(node.param_types or []),
                node.return_type,
            )
            fn.closure[node.name] = fn
            if node.name in OPERATOR_SYMBOLS:
                current = env.get(node.name)
                if isinstance(current, IROverloadedCallable):
                    current.variants.append(fn)
                    env[node.name] = current
                elif isinstance(current, IRFunctionValue):
                    env[node.name] = IROverloadedCallable(node.name, [current, fn])
                else:
                    env[node.name] = IROverloadedCallable(node.name, [fn])
            else:
                env[node.name] = fn
            return None
        if isinstance(node, ir.ExprStmt):
            return self.eval_expr(node.expr, env)
        if isinstance(node, ir.PrintStmt):
            value = self.eval_expr(node.value, env)
            print(_stringify(value, self.types))
            return None
        if isinstance(node, ir.IfStmt):
            return execute_conditional_control_via_runtime(
                loop=False,
                eval_condition=lambda: self.eval_expr(node.condition, env),
                run_body=lambda: self.eval_block_result(node.body, env),
                continue_signal=IRContinueSignal,
                break_signal=IRBreakSignal,
            )
        if isinstance(node, ir.WhileStmt):
            return execute_conditional_control_via_runtime(
                loop=True,
                eval_condition=lambda: self.eval_expr(node.condition, env),
                run_body=lambda: self.eval_block_result(node.body, env),
                continue_signal=IRContinueSignal,
                break_signal=IRBreakSignal,
            )
        if isinstance(node, ir.MatchStmt):
            return execute_match_stmt_via_runtime(
                loop=node.loop,
                arms=node.arms,
                eval_discriminant=lambda: self.eval_expr(node.discriminant, env),
                eval_condition=lambda condition: self.eval_expr(condition, env),
                match_specificity=self._match_specificity,
                run_body=lambda arm, _disc: self.eval_block_result(arm.body, env),
                continue_signal=IRContinueSignal,
                break_signal=IRBreakSignal,
            )
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
        if isinstance(node, ir.LoadName):
            return self._resolve(node.name, env)
        if isinstance(node, ir.LoadSlot):
            return self._resolve(node.name, env)
        if isinstance(node, ir.CallExpr):
            fn = self.eval_expr(node.func, env)
            args = [self.eval_expr(a, env) for a in node.args]
            kwargs = {name: self.eval_expr(value, env) for name, value in node.kwargs}
            spreads = [self.eval_expr(value, env) for value in node.spreads]
            return self._call(fn, args, kwargs, spreads)
        if isinstance(node, ir.ListExpr):
            return [self.eval_expr(e, env) for e in node.elements]
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
        if isinstance(node, ir.AttrExpr):
            base = self.eval_expr(node.value, env)
            return execute_dot_attr_expr_via_runtime(
                env,
                base,
                node.name,
                self.types,
                resolve_dispatch_result=self._resolve_runtime_dispatch_result,
            )
        if isinstance(node, ir.IndexExpr):
            base = self.eval_expr(node.value, env)
            keys = [self.eval_expr(idx, env) for idx in node.indices]
            return execute_dot_index_expr_via_runtime(
                env,
                base,
                keys,
                self.types,
                resolve_dispatch_result=self._resolve_runtime_dispatch_result,
            )
        if isinstance(node, ir.CoerceExpr):
            value = self.eval_expr(node.expr, env)
            value, _ = execute_typed_coercion_via_runtime(value, node.target_type, self.types)
            return value
        if isinstance(node, ir.BindExpr):
            if not isinstance(node.target, ir.LoadName):
                raise EvalError(f"unsupported IR bind expr target {type(node.target).__name__}")
            value = self.eval_expr(node.value, env)
            env[node.target.name] = value
            return value
        if isinstance(node, ir.UnaryExpr):
            operand = self.eval_expr(node.operand, env)
            return execute_unary_expr_via_runtime(
                env,
                node.op,
                operand,
                self.types,
                dispatch_callable=self._call,
            )
        if isinstance(node, ir.BinaryExpr):
            left = self.eval_expr(node.left, env)
            right = self.eval_expr(node.right, env)
            return execute_binary_expr_via_runtime(
                env,
                node.op,
                left,
                right,
                self.types,
                dispatch_callable=self._call,
            )
        raise EvalError(f"unknown IR expr {type(node).__name__}")

    def _call(
        self,
        fn: Any,
        args: list[Any],
        kw: dict[str, Any] | None = None,
        spreads: list[Any] | None = None,
    ) -> Any:
        handled, ctor_result = execute_runtime_callable_via_runtime(
            fn,
            args,
            kw,
            spreads,
        )
        if handled:
            return ctor_result
        if isinstance(fn, IROverloadedCallable):
            if kw or spreads:
                raise EvalError(
                    "operator calls do not accept keyword or spread arguments"
                )
            overload = _pick_best_ir_overload(fn.variants, args, self.types)
            if overload is None:
                raise EvalError(
                    f"no matching overload for {fn.name!r} with {len(args)} argument(s)"
                )
            return self._call(overload, args)
        if isinstance(fn, IRFunctionValue):
            args = bind_function_call_args(fn.params, args, kw, spreads)
            loc = dict(fn.closure)
            size_bindings: dict[str, int] = {}
            for name, arg, declared_type in zip(fn.params, args, fn.param_types):
                if declared_type is not None:
                    arg, size_bindings = execute_typed_coercion_via_runtime(
                        arg,
                        declared_type,
                        self.types,
                        size_bindings,
                    )
                loc[name] = arg
            try:
                result = self.eval_block_result(fn.body, loc)
            except IRReturnSignal as r:
                result = r.value
            if fn.return_type is not None:
                resolved_return = resolve_return_type(fn.return_type, size_bindings)
                result, _ = execute_typed_coercion_via_runtime(
                    result,
                    resolved_return,
                    self.types,
                    size_bindings,
                )
            return result
        if isinstance(fn, PrimType):
            return execute_primitive_cast_call_via_runtime(fn, args, kw, spreads)
        if spreads:
            raise EvalError("this call does not support spread arguments")
        if callable(fn):
            return fn(*args, **(kw or {}))
        if kw:
            raise EvalError("this call does not accept keyword or spread arguments")
        raise EvalError(f"not callable: {type(fn).__name__}")

    def _match_specificity(self, a: Any, b: Any) -> int | None:
        return execute_match_specificity_via_runtime(a, b, self.types)

    def _resolve_runtime_dispatch_result(self, result: Any) -> Any:
        return resolve_runtime_dispatch_result(
            result,
            dispatch_callable=self._call,
        )


def prepare_ast_module_for_ir_execution(module: ast.Module) -> ir.Module:
    """Lower and optimize an AST module for direct IR execution."""
    from .optimize_ir import optimize_module

    return optimize_module(lower_module(module))


def execute_collection_ctor_via_runtime(
    fn: Any,
    args: list[Any],
    kw: dict[str, Any] | None = None,
    spreads: list[Any] | None = None,
) -> tuple[bool, Any]:
    result = runtime_collection_ctor_call(fn, args, kw or {}, spreads or [])
    if result is None:
        return False, None
    return True, result


def execute_runtime_callable_via_runtime(
    fn: Any,
    args: list[Any],
    kw: dict[str, Any] | None = None,
    spreads: list[Any] | None = None,
) -> tuple[bool, Any]:
    handled, result = execute_collection_ctor_via_runtime(fn, args, kw, spreads)
    if handled:
        return True, result
    if isinstance(fn, VStructCtor):
        if spreads:
            raise EvalError("struct constructor does not support spread arguments")
        return True, execute_struct_constructor_via_runtime(
            name=fn.name,
            params=fn.params,
            pos=args,
            kw=kw or {},
        )
    return False, None


def execute_ast_module_via_ir(
    file_path: Path,
    module: ast.Module,
    *,
    globals_env: dict[str, Any] | None = None,
    types_env: dict[str, Any] | None = None,
) -> IRExecutionOutcome:
    """Drive the current lowered/optimized IR path as one execution unit."""
    prepared = prepare_ast_module_for_ir_execution(module)
    executor = IRExecutor(file_path)
    if globals_env:
        executor.globals.update(globals_env)
    if types_env:
        executor.types.update(types_env)
    result = executor.run_module(prepared)
    return IRExecutionOutcome(
        result=result,
        globals=dict(executor.globals),
        types=dict(executor.types),
        module=prepared,
    )


def execute_function_via_ir(
    file_path: Path,
    *,
    name: str | None,
    params: list[Any],
    body: Any,
    closure: dict[str, Any],
    args: list[Any],
    func_type: Any | None,
    types_env: dict[str, Any] | None = None,
) -> Any:
    """Execute one lowerable function body through IR/runtime instead of AST walking."""
    types_copy = {} if types_env is None else dict(types_env)
    lowered_body, param_types, return_type = lower_function_parts(
        params,
        body,
        func_type,
        types_copy,
    )
    executor = IRExecutor(file_path)
    executor.types.update(types_copy)
    ir_fn = IRFunctionValue(
        name=name,
        params=[p.name for p in params],
        body=lowered_body,
        closure=dict(closure),
        param_specs=list(params),
        param_types=param_types,
        return_type=return_type,
    )
    if name is not None:
        ir_fn.closure[name] = ir_fn
    return executor._call(ir_fn, args)


def execute_struct_constructor_via_runtime(
    *,
    name: str,
    params: list[Any],
    pos: list[Any],
    kw: dict[str, Any],
) -> Any:
    """Drive named struct constructor calls through the execution seam module."""
    by_name = bind_struct_constructor_fields(
        name,
        params,
        pos,
        kw,
        coerce_value,
        EvalError,
    )
    return construct_struct_value(name, by_name)
