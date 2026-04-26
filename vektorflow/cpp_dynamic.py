from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from . import ast, ir
from .typed_ir import TypedModuleInfo


@dataclass(frozen=True)
class DynamicEmitHooks:
    normalize_type: Callable[[Any], Any]
    expr_type: Callable[[Any, TypedModuleInfo], Any]
    emit_expr: Callable[[Any, dict[str, Any], dict[str, ir.FunctionDef], Any, TypedModuleInfo], str]
    emit_const: Callable[[Any], str]
    cpp_type: Callable[[Any, Any | None], str]


def cpp_dynamic_value_supported(t: Any, normalize_type: Callable[[Any], Any]) -> bool:
    t = normalize_type(t)
    if isinstance(t, ast.PrimTypeRef):
        return t.name in {"bool", "int", "num", "str"}
    if isinstance(t, ast.MapValueType):
        return all(cpp_dynamic_value_supported(inner, normalize_type) for _, inner in t.fields)
    if isinstance(t, ast.LinkedListValueType):
        return all(cpp_dynamic_value_supported(inner, normalize_type) for inner in t.elements)
    return False


def require_cpp_dynamic_value_supported(
    t: Any,
    normalize_type: Callable[[Any], Any],
    error_type: type[Exception],
    context: str,
) -> Any:
    t = normalize_type(t)
    if not cpp_dynamic_value_supported(t, normalize_type):
        raise error_type(
            f"{context} currently supports only primitive, map, and list values"
        )
    return t


def map_field_type(
    map_type: ast.MapValueType,
    field_name: str,
    error_type: type[Exception],
) -> Any:
    for name, inner in map_type.fields:
        if name == field_name:
            return inner
    raise error_type(f"missing inferred field type for map key {field_name!r}")


def emit_dynamic_any(
    expr: Any,
    expr_type: Any,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: Any,
    typed: TypedModuleInfo,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str:
    expr_type = require_cpp_dynamic_value_supported(
        expr_type,
        hooks.normalize_type,
        error_type,
        "compiled dynamic collections",
    )
    inner = hooks.emit_expr(expr, env, functions, state, typed)
    expr_type = hooks.normalize_type(expr_type)
    if isinstance(expr_type, ast.PrimTypeRef):
        cpp_t = hooks.cpp_type(expr_type, state)
        return f"std::any{{{cpp_t}({inner})}}"
    return f"std::any{{{inner}}}"


def emit_map_literal(
    node: ir.MapExpr,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: Any,
    typed: TypedModuleInfo,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str:
    inferred = hooks.expr_type(node, typed)
    if not isinstance(inferred, ast.MapValueType):
        raise error_type("map literal did not infer a map type")
    items: list[str] = []
    for name, value in node.fields:
        field_t = map_field_type(inferred, name, error_type)
        items.append(
            "{"
            + hooks.emit_const(name)
            + ", "
            + emit_dynamic_any(
                value,
                field_t,
                env,
                functions,
                state,
                typed,
                hooks=hooks,
                error_type=error_type,
            )
            + "}"
        )
    return f"vf_map_make({{{', '.join(items)}}})"


def emit_linked_list_literal(
    node: ir.LinkedListExpr,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: Any,
    typed: TypedModuleInfo,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str:
    inferred = hooks.expr_type(node, typed)
    if not isinstance(inferred, ast.LinkedListValueType):
        raise error_type("linked-list literal did not infer a linked-list type")
    if node.spread is not None:
        spread_t = hooks.normalize_type(hooks.expr_type(node.spread, typed))
        spread_code = hooks.emit_expr(node.spread, env, functions, state, typed)
        if isinstance(spread_t, ast.FixedVectorType):
            require_cpp_dynamic_value_supported(
                spread_t.element_type,
                hooks.normalize_type,
                error_type,
                "linked-list spread from vector",
            )
            return f"vf_list_from_array({spread_code})"
        if isinstance(spread_t, ast.LinkedListValueType):
            return spread_code
        raise error_type("linked-list spread requires a vector or linked-list source")
    items: list[str] = []
    for expr, item_t in zip(node.elements, inferred.elements):
        items.append(
            emit_dynamic_any(
                expr,
                item_t,
                env,
                functions,
                state,
                typed,
                hooks=hooks,
                error_type=error_type,
            )
        )
    return f"vf_list_make({{{', '.join(items)}}})"


def emit_map_coercion(
    node: ir.CoerceExpr,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: Any,
    typed: TypedModuleInfo,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str:
    target = hooks.normalize_type(node.target_type)
    if not isinstance(target, ast.MapValueType):
        raise error_type("internal: map coercion helper needs a map target")
    if isinstance(node.expr, ir.MapExpr):
        return emit_map_literal(
            node.expr,
            env,
            functions,
            state,
            typed,
            hooks=hooks,
            error_type=error_type,
        )
    return hooks.emit_expr(node.expr, env, functions, state, typed)


def emit_map_attr_access(
    node: ir.AttrExpr,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: Any,
    typed: TypedModuleInfo,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str:
    base_type = hooks.normalize_type(hooks.expr_type(node.value, typed))
    if not isinstance(base_type, ast.MapValueType):
        raise error_type("internal: map attr helper needs a map source")
    field_type = map_field_type(base_type, node.name, error_type)
    base_expr = hooks.emit_expr(node.value, env, functions, state, typed)
    return (
        f"std::any_cast<{hooks.cpp_type(field_type, state)}>"
        f"({base_expr}.at({hooks.emit_const(node.name)}))"
    )


def emit_linked_list_concat(
    left: str,
    right: str,
    left_type: Any,
    right_type: Any,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str | None:
    left_type = hooks.normalize_type(left_type)
    right_type = hooks.normalize_type(right_type)
    if isinstance(left_type, ast.LinkedListValueType) or isinstance(right_type, ast.LinkedListValueType):
        if not isinstance(left_type, ast.LinkedListValueType) or not isinstance(right_type, ast.LinkedListValueType):
            raise error_type("unsupported mixed linked-list expression for C++ emitter: AMPERSAND")
        return f"vf_list_cat({left}, {right})"
    return None


def emit_linked_list_coercion(
    node: ir.CoerceExpr,
    env: dict[str, Any],
    functions: dict[str, ir.FunctionDef],
    state: Any,
    typed: TypedModuleInfo,
    *,
    hooks: DynamicEmitHooks,
    error_type: type[Exception],
) -> str:
    target = hooks.normalize_type(node.target_type)
    if not isinstance(target, ast.LinkedListValueType):
        raise error_type(
            "internal: linked-list coercion helper needs a linked-list target"
        )
    if isinstance(node.expr, ir.LinkedListExpr):
        return emit_linked_list_literal(
            node.expr,
            env,
            functions,
            state,
            typed,
            hooks=hooks,
            error_type=error_type,
        )
    return hooks.emit_expr(node.expr, env, functions, state, typed)
