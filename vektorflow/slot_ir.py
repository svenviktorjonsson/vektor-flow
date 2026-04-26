from __future__ import annotations

from typing import Any

from . import ir
from .typed_ir import TypedModuleInfo


def lower_slots(module: ir.Module, typed: TypedModuleInfo) -> ir.Module:
    out: list[Any] = []
    for stmt in module.statements:
        if isinstance(stmt, ir.FunctionDef):
            slots = typed.function_slots.get(stmt.name, {})
            body = _lower_block(stmt.body, slots)
            out.append(
                ir.FunctionDef(
                    stmt.name,
                    list(stmt.params),
                    body,
                    list(stmt.param_types),
                    stmt.return_type,
                )
            )
        else:
            out.append(stmt)
    return ir.Module(out)


def _lower_block(block: ir.Block, slots: dict[str, int]) -> ir.Block:
    return ir.Block([_lower_stmt(stmt, slots) for stmt in block.statements])


def _lower_stmt(stmt: Any, slots: dict[str, int]) -> Any:
    if isinstance(stmt, ir.StoreName) and stmt.name in slots:
        return ir.StoreSlot(slots[stmt.name], stmt.name, _lower_expr(stmt.value, slots), stmt.declared_type)
    if isinstance(stmt, ir.PrintStmt):
        return ir.PrintStmt(_lower_expr(stmt.value, slots))
    if isinstance(stmt, ir.ExprStmt):
        return ir.ExprStmt(_lower_expr(stmt.expr, slots))
    if isinstance(stmt, ir.IfStmt):
        return ir.IfStmt(_lower_expr(stmt.condition, slots), _lower_block(stmt.body, slots))
    if isinstance(stmt, ir.WhileStmt):
        return ir.WhileStmt(_lower_expr(stmt.condition, slots), _lower_block(stmt.body, slots))
    if isinstance(stmt, ir.MatchStmt):
        return ir.MatchStmt(
            _lower_expr(stmt.discriminant, slots),
            [
                ir.MatchArm(
                    None if arm.condition is None else _lower_expr(arm.condition, slots),
                    _lower_block(arm.body, slots),
                )
                for arm in stmt.arms
            ],
            loop=stmt.loop,
        )
    if isinstance(stmt, ir.ReturnStmt):
        return ir.ReturnStmt(None if stmt.value is None else _lower_expr(stmt.value, slots))
    return stmt


def _lower_expr(expr: Any, slots: dict[str, int]) -> Any:
    if isinstance(expr, ir.LoadName) and expr.name in slots:
        return ir.LoadSlot(slots[expr.name], expr.name)
    if isinstance(expr, ir.UnaryExpr):
        return ir.UnaryExpr(expr.op, _lower_expr(expr.operand, slots))
    if isinstance(expr, ir.BinaryExpr):
        return ir.BinaryExpr(expr.op, _lower_expr(expr.left, slots), _lower_expr(expr.right, slots))
    if isinstance(expr, ir.CallExpr):
        return ir.CallExpr(_lower_expr(expr.func, slots), [_lower_expr(a, slots) for a in expr.args])
    if isinstance(expr, ir.ListExpr):
        return ir.ListExpr([_lower_expr(e, slots) for e in expr.elements])
    if isinstance(expr, ir.MultisetExpr):
        return ir.MultisetExpr([(_lower_expr(val, slots), _lower_expr(count, slots)) for val, count in expr.pairs])
    if isinstance(expr, ir.MapExpr):
        return ir.MapExpr([(name, _lower_expr(val, slots)) for name, val in expr.fields])
    if isinstance(expr, ir.LinkedListExpr):
        return ir.LinkedListExpr(
            [_lower_expr(e, slots) for e in expr.elements],
            None if expr.spread is None else _lower_expr(expr.spread, slots),
        )
    if isinstance(expr, ir.StructExpr):
        return ir.StructExpr([(name, _lower_expr(val, slots)) for name, val in expr.fields])
    if isinstance(expr, ir.AttrExpr):
        return ir.AttrExpr(_lower_expr(expr.value, slots), expr.name)
    if isinstance(expr, ir.CoerceExpr):
        return ir.CoerceExpr(_lower_expr(expr.expr, slots), expr.target_type)
    return expr
