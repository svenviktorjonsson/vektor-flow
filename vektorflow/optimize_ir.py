from __future__ import annotations

from typing import Any

from . import ast, ir
from .ir_executor import (
    execute_const_binary_expr_via_runtime,
    execute_const_dot_attr_expr_via_runtime,
    execute_const_dot_index_expr_via_runtime,
    execute_const_primitive_cast_via_runtime,
    execute_const_unary_expr_via_runtime,
    execute_typed_coercion_via_runtime,
    execute_truthiness_via_runtime,
    execute_match_specificity_via_runtime,
    select_const_match_arm_via_runtime,
)
from .runtime import make_vmap
from .typed_ir import TypedModuleInfo


def _load_name(node: Any) -> str | None:
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return node.name
    return None


def _store_name(node: Any) -> str | None:
    if isinstance(node, (ir.StoreName, ir.StoreSlot)):
        return node.name
    return None


def _const_cast(name: str, value: Any) -> Any:
    try:
        return execute_const_primitive_cast_via_runtime(name, value)
    except Exception as exc:
        raise ValueError(name) from exc


def _const_coerce(type_expr: Any, value: Any) -> Any:
    try:
        coerced, _ = execute_typed_coercion_via_runtime(value, type_expr, {})
        return coerced
    except Exception as exc:
        raise ValueError(type_expr) from exc


def _const_runtime_value(node: Any) -> Any:
    if isinstance(node, ir.Const):
        return node.value
    if isinstance(node, ir.ListExpr):
        values: list[Any] = []
        for element in node.elements:
            values.append(_const_runtime_value(element))
        return values
    if isinstance(node, ir.MapExpr):
        values: dict[str, Any] = {}
        for name, value in node.fields:
            values[name] = _const_runtime_value(value)
        return make_vmap(values)
    if isinstance(node, ir.StructExpr):
        values: dict[str, Any] = {}
        for name, value in node.fields:
            values[name] = _const_runtime_value(value)
        return values
    raise ValueError(type(node).__name__)


def _expr_is_pure(node: Any) -> bool:
    if isinstance(node, ir.Const) or _load_name(node) is not None:
        return True
    if isinstance(node, ir.UnaryExpr):
        return _expr_is_pure(node.operand)
    if isinstance(node, ir.BinaryExpr):
        return _expr_is_pure(node.left) and _expr_is_pure(node.right)
    if isinstance(node, ir.ListExpr):
        return all(_expr_is_pure(e) for e in node.elements)
    if isinstance(node, ir.MultisetExpr):
        return all(_expr_is_pure(v) and _expr_is_pure(c) for v, c in node.pairs)
    if isinstance(node, ir.MapExpr):
        return all(_expr_is_pure(v) for _, v in node.fields)
    if isinstance(node, ir.LinkedListExpr):
        return all(_expr_is_pure(e) for e in node.elements) and (
            node.spread is None or _expr_is_pure(node.spread)
        )
    if isinstance(node, ir.StructExpr):
        return all(_expr_is_pure(v) for _, v in node.fields)
    if isinstance(node, ir.AttrExpr):
        return _expr_is_pure(node.value)
    if isinstance(node, ir.IndexExpr):
        return _expr_is_pure(node.value) and all(_expr_is_pure(idx) for idx in node.indices)
    if isinstance(node, ir.CoerceExpr):
        return _expr_is_pure(node.expr)
    if isinstance(node, ir.CallExpr):
        return (
            isinstance(node.func, ir.LoadName)
            and node.func.name in {"int", "num", "bool", "str"}
            and all(_expr_is_pure(a) for a in node.args)
            and not node.kwargs
            and not node.spreads
        )
    return False


def _expr_loads(node: Any) -> set[str]:
    if isinstance(node, ir.Const):
        return set()
    load_name = _load_name(node)
    if load_name is not None:
        return {load_name}
    if isinstance(node, ir.UnaryExpr):
        return _expr_loads(node.operand)
    if isinstance(node, ir.BinaryExpr):
        return _expr_loads(node.left) | _expr_loads(node.right)
    if isinstance(node, ir.CallExpr):
        used = _expr_loads(node.func)
        for arg in node.args:
            used |= _expr_loads(arg)
        for _, value in node.kwargs:
            used |= _expr_loads(value)
        for value in node.spreads:
            used |= _expr_loads(value)
        return used
    if isinstance(node, ir.ListExpr):
        used: set[str] = set()
        for e in node.elements:
            used |= _expr_loads(e)
        return used
    if isinstance(node, ir.MultisetExpr):
        used: set[str] = set()
        for value, count in node.pairs:
            used |= _expr_loads(value)
            used |= _expr_loads(count)
        return used
    if isinstance(node, ir.MapExpr):
        used: set[str] = set()
        for _, value in node.fields:
            used |= _expr_loads(value)
        return used
    if isinstance(node, ir.LinkedListExpr):
        used: set[str] = set()
        for e in node.elements:
            used |= _expr_loads(e)
        if node.spread is not None:
            used |= _expr_loads(node.spread)
        return used
    if isinstance(node, ir.StructExpr):
        used: set[str] = set()
        for _, v in node.fields:
            used |= _expr_loads(v)
        return used
    if isinstance(node, ir.AttrExpr):
        return _expr_loads(node.value)
    if isinstance(node, ir.IndexExpr):
        used = _expr_loads(node.value)
        for idx in node.indices:
            used |= _expr_loads(idx)
        return used
    if isinstance(node, ir.CoerceExpr):
        return _expr_loads(node.expr)
    return set()


def _forward_name_into_stmt(stmt: Any, name: str, value: Any) -> Any | None:
    if isinstance(stmt, ir.ExprStmt) and _load_name(stmt.expr) == name:
        return ir.ExprStmt(value)
    if isinstance(stmt, ir.PrintStmt) and _load_name(stmt.value) == name:
        return ir.PrintStmt(value)
    if isinstance(stmt, ir.ReturnStmt) and stmt.value is not None and _load_name(stmt.value) == name:
        return ir.ReturnStmt(value)
    return None


def _stmt_loads(node: Any) -> set[str]:
    if isinstance(node, (ir.StoreName, ir.StoreSlot)):
        return _expr_loads(node.value)
    if isinstance(node, ir.PrintStmt):
        return _expr_loads(node.value)
    if isinstance(node, ir.ExprStmt):
        return _expr_loads(node.expr)
    if isinstance(node, ir.IfStmt):
        used = _expr_loads(node.condition)
        for sub in node.body.statements:
            used |= _stmt_loads(sub)
        return used
    if isinstance(node, ir.WhileStmt):
        used = _expr_loads(node.condition)
        for sub in node.body.statements:
            used |= _stmt_loads(sub)
        return used
    if isinstance(node, ir.MatchStmt):
        used = _expr_loads(node.discriminant)
        for arm in node.arms:
            if arm.condition is not None:
                used |= _expr_loads(arm.condition)
            for sub in arm.body.statements:
                used |= _stmt_loads(sub)
        return used
    if isinstance(node, ir.ReturnStmt):
        return set() if node.value is None else _expr_loads(node.value)
    return set()


def fold_expr(node: Any) -> Any:
    if isinstance(node, ir.Const) or _load_name(node) is not None:
        return node
    if isinstance(node, ir.UnaryExpr):
        operand = fold_expr(node.operand)
        if isinstance(operand, ir.Const):
            try:
                return ir.Const(execute_const_unary_expr_via_runtime(node.op, operand.value))
            except Exception:
                pass
        return ir.UnaryExpr(node.op, operand)
    if isinstance(node, ir.BinaryExpr):
        left = fold_expr(node.left)
        right = fold_expr(node.right)
        if isinstance(left, ir.Const) and isinstance(right, ir.Const):
            try:
                return ir.Const(execute_const_binary_expr_via_runtime(node.op, left.value, right.value))
            except Exception:
                pass
        return ir.BinaryExpr(node.op, left, right)
    if isinstance(node, ir.CallExpr):
        func = fold_expr(node.func)
        args = [fold_expr(a) for a in node.args]
        kwargs = [(name, fold_expr(value)) for name, value in node.kwargs]
        spreads = [fold_expr(value) for value in node.spreads]
        if (
            isinstance(func, ir.LoadName)
            and len(args) == 1
            and isinstance(args[0], ir.Const)
            and func.name in {"int", "num", "bool", "str"}
            and not kwargs
            and not spreads
        ):
            try:
                return ir.Const(_const_cast(func.name, args[0].value))
            except ValueError:
                pass
        return ir.CallExpr(func, args, kwargs, spreads)
    if isinstance(node, ir.ListExpr):
        return ir.ListExpr([fold_expr(e) for e in node.elements])
    if isinstance(node, ir.MultisetExpr):
        return ir.MultisetExpr([(fold_expr(value), fold_expr(count)) for value, count in node.pairs])
    if isinstance(node, ir.MapExpr):
        return ir.MapExpr([(name, fold_expr(val)) for name, val in node.fields])
    if isinstance(node, ir.LinkedListExpr):
        return ir.LinkedListExpr(
            [fold_expr(e) for e in node.elements],
            None if node.spread is None else fold_expr(node.spread),
        )
    if isinstance(node, ir.StructExpr):
        return ir.StructExpr([(name, fold_expr(val)) for name, val in node.fields])
    if isinstance(node, ir.AttrExpr):
        value = fold_expr(node.value)
        try:
            return ir.Const(execute_const_dot_attr_expr_via_runtime(_const_runtime_value(value), node.name))
        except Exception:
            return ir.AttrExpr(value, node.name)
    if isinstance(node, ir.IndexExpr):
        value = fold_expr(node.value)
        indices = [fold_expr(idx) for idx in node.indices]
        try:
            return ir.Const(
                execute_const_dot_index_expr_via_runtime(
                    _const_runtime_value(value),
                    [_const_runtime_value(idx) for idx in indices],
                )
            )
        except Exception:
            return ir.IndexExpr(value, indices)
    if isinstance(node, ir.CoerceExpr):
        expr = fold_expr(node.expr)
        if isinstance(expr, ir.CoerceExpr) and expr.target_type == node.target_type:
            return expr
        if isinstance(expr, ir.Const):
            try:
                return ir.Const(_const_coerce(node.target_type, expr.value))
            except ValueError:
                pass
        return ir.CoerceExpr(expr, node.target_type)
    return node


def optimize_stmt(node: Any) -> list[Any]:
    if isinstance(node, ir.TypeDef):
        return [node]
    if isinstance(node, ir.StoreName):
        return [ir.StoreName(node.name, fold_expr(node.value), node.declared_type)]
    if isinstance(node, ir.StoreSlot):
        return [ir.StoreSlot(node.slot, node.name, fold_expr(node.value), node.declared_type)]
    if isinstance(node, ir.PrintStmt):
        return [ir.PrintStmt(fold_expr(node.value))]
    if isinstance(node, ir.ExprStmt):
        return [ir.ExprStmt(fold_expr(node.expr))]
    if isinstance(node, ir.ReturnStmt):
        return [ir.ReturnStmt(None if node.value is None else fold_expr(node.value))]
    if isinstance(node, ir.ContinueStmt):
        return [node]
    if isinstance(node, ir.BreakStmt):
        return [node]
    if isinstance(node, ir.IfStmt):
        cond = fold_expr(node.condition)
        body = optimize_block(node.body, allow_dead_store_elimination=False)
        if isinstance(cond, ir.Const):
            return body.statements if execute_truthiness_via_runtime(cond.value) else []
        return [ir.IfStmt(cond, body)]
    if isinstance(node, ir.WhileStmt):
        cond = fold_expr(node.condition)
        body = optimize_block(node.body, allow_dead_store_elimination=False)
        if isinstance(cond, ir.Const) and not execute_truthiness_via_runtime(cond.value):
            return []
        return [ir.WhileStmt(cond, body)]
    if isinstance(node, ir.MatchStmt):
        disc = fold_expr(node.discriminant)
        arms = [
            ir.MatchArm(
                None if arm.condition is None else fold_expr(arm.condition),
                optimize_block(arm.body, allow_dead_store_elimination=False),
            )
            for arm in node.arms
        ]
        if isinstance(disc, ir.Const) and not node.loop:
            if any(arm.condition is not None and not isinstance(arm.condition, ir.Const) for arm in arms):
                return [ir.MatchStmt(disc, arms, loop=node.loop)]
            chosen = select_const_match_arm_via_runtime(
                disc.value,
                arms,
                match_specificity=lambda a, b: execute_match_specificity_via_runtime(a, b, {}),
            )
            if chosen is None:
                return []
            return chosen.body.statements
        return [ir.MatchStmt(disc, arms, loop=node.loop)]
    if isinstance(node, ir.FunctionDef):
        return [
            ir.FunctionDef(
                node.name,
                list(node.params),
                optimize_block(node.body),
                list(node.param_types),
                node.return_type,
                list(node.param_specs),
            )
        ]
    raise TypeError(type(node).__name__)


def optimize_block(block: ir.Block, *, allow_dead_store_elimination: bool = True) -> ir.Block:
    out: list[Any] = []
    for stmt in block.statements:
        out.extend(optimize_stmt(stmt))
    forwarded: list[Any] = []
    i = 0
    while i < len(out):
        stmt = out[i]
        store_name = _store_name(stmt)
        if i + 1 < len(out) and store_name is not None and _expr_is_pure(stmt.value):
            replaced = _forward_name_into_stmt(out[i + 1], store_name, stmt.value)
            if replaced is not None:
                forwarded.append(replaced)
                i += 2
                continue
        forwarded.append(stmt)
        i += 1
    if not allow_dead_store_elimination:
        return ir.Block(forwarded)
    kept: list[Any] = []
    live: set[str] = set()
    for stmt in reversed(forwarded):
        store_name = _store_name(stmt)
        if store_name is not None:
            if store_name not in live and _expr_is_pure(stmt.value):
                continue
            live.discard(store_name)
            live |= _stmt_loads(stmt)
            kept.append(stmt)
            continue
        live |= _stmt_loads(stmt)
        kept.append(stmt)
    kept.reverse()
    return ir.Block(kept)


def optimize_module(module: ir.Module) -> ir.Module:
    out: list[Any] = []
    for stmt in module.statements:
        out.extend(optimize_stmt(stmt))
    return ir.Module(out, stdlib_imports=list(module.stdlib_imports))


def eliminate_noop_coercions(module: ir.Module, typed: TypedModuleInfo) -> ir.Module:
    return ir.Module([_strip_stmt(stmt, typed) for stmt in module.statements], stdlib_imports=list(module.stdlib_imports))


def _strip_stmt(stmt: Any, typed: TypedModuleInfo) -> Any:
    if isinstance(stmt, ir.TypeDef):
        return stmt
    if isinstance(stmt, ir.FunctionDef):
        return ir.FunctionDef(
            stmt.name,
            list(stmt.params),
            ir.Block([_strip_stmt(sub, typed) for sub in stmt.body.statements]),
            list(stmt.param_types),
            stmt.return_type,
            list(stmt.param_specs),
        )
    if isinstance(stmt, ir.StoreName):
        return ir.StoreName(stmt.name, _strip_expr(stmt.value, typed), stmt.declared_type)
    if isinstance(stmt, ir.StoreSlot):
        return ir.StoreSlot(stmt.slot, stmt.name, _strip_expr(stmt.value, typed), stmt.declared_type)
    if isinstance(stmt, ir.PrintStmt):
        return ir.PrintStmt(_strip_expr(stmt.value, typed))
    if isinstance(stmt, ir.ExprStmt):
        return ir.ExprStmt(_strip_expr(stmt.expr, typed))
    if isinstance(stmt, ir.ReturnStmt):
        return ir.ReturnStmt(None if stmt.value is None else _strip_expr(stmt.value, typed))
    if isinstance(stmt, ir.IfStmt):
        return ir.IfStmt(_strip_expr(stmt.condition, typed), ir.Block([_strip_stmt(sub, typed) for sub in stmt.body.statements]))
    if isinstance(stmt, ir.WhileStmt):
        return ir.WhileStmt(_strip_expr(stmt.condition, typed), ir.Block([_strip_stmt(sub, typed) for sub in stmt.body.statements]))
    if isinstance(stmt, ir.MatchStmt):
        return ir.MatchStmt(
            _strip_expr(stmt.discriminant, typed),
            [
                ir.MatchArm(
                    None if arm.condition is None else _strip_expr(arm.condition, typed),
                    ir.Block([_strip_stmt(sub, typed) for sub in arm.body.statements]),
                )
                for arm in stmt.arms
            ],
            loop=stmt.loop,
        )
    return stmt


def _strip_expr(node: Any, typed: TypedModuleInfo) -> Any:
    if isinstance(node, ir.CoerceExpr):
        inner = _strip_expr(node.expr, typed)
        try:
            inner_t = typed.expr_type(node.expr)
        except Exception:
            inner_t = None
        if inner_t is not None and inner_t == node.target_type:
            return inner
        return ir.CoerceExpr(inner, node.target_type)
    if isinstance(node, ir.UnaryExpr):
        return ir.UnaryExpr(node.op, _strip_expr(node.operand, typed))
    if isinstance(node, ir.BinaryExpr):
        return ir.BinaryExpr(node.op, _strip_expr(node.left, typed), _strip_expr(node.right, typed))
    if isinstance(node, ir.CallExpr):
        return ir.CallExpr(
            _strip_expr(node.func, typed),
            [_strip_expr(arg, typed) for arg in node.args],
            [(name, _strip_expr(value, typed)) for name, value in node.kwargs],
            [_strip_expr(value, typed) for value in node.spreads],
        )
    if isinstance(node, ir.ListExpr):
        return ir.ListExpr([_strip_expr(e, typed) for e in node.elements])
    if isinstance(node, ir.MultisetExpr):
        return ir.MultisetExpr([(_strip_expr(value, typed), _strip_expr(count, typed)) for value, count in node.pairs])
    if isinstance(node, ir.StructExpr):
        return ir.StructExpr([(name, _strip_expr(val, typed)) for name, val in node.fields])
    if isinstance(node, ir.AttrExpr):
        return ir.AttrExpr(_strip_expr(node.value, typed), node.name)
    if isinstance(node, ir.IndexExpr):
        return ir.IndexExpr(_strip_expr(node.value, typed), [_strip_expr(idx, typed) for idx in node.indices])
    return node
