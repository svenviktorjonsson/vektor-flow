"""Lowered intermediate representation for Vektor Flow.

This first pass is intentionally small and explicit. It sits beside the
existing AST/interpreter so we can validate semantics incrementally before
adding more aggressive optimizations or a native backend.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import ast


IRNode = Any


@dataclass(frozen=True, slots=True)
class Const:
    value: Any


@dataclass(frozen=True, slots=True)
class LoadName:
    name: str


@dataclass(frozen=True, slots=True)
class LoadSlot:
    slot: int
    name: str


@dataclass(frozen=True, slots=True)
class UnaryExpr:
    op: str
    operand: IRNode


@dataclass(frozen=True, slots=True)
class BinaryExpr:
    op: str
    left: IRNode
    right: IRNode


@dataclass(frozen=True, slots=True)
class ExprStmt:
    expr: IRNode


@dataclass(frozen=True, slots=True)
class CallExpr:
    func: IRNode
    args: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ListExpr:
    elements: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class MultisetExpr:
    pairs: list[tuple[IRNode, IRNode]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class MapExpr:
    fields: list[tuple[str, IRNode]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class LinkedListExpr:
    elements: list[IRNode] = field(default_factory=list)
    spread: IRNode | None = None


@dataclass(frozen=True, slots=True)
class StructExpr:
    fields: list[tuple[str, IRNode]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class AttrExpr:
    value: IRNode
    name: str


@dataclass(frozen=True, slots=True)
class MatchArm:
    condition: IRNode | None
    body: "Block"


@dataclass(frozen=True, slots=True)
class CoerceExpr:
    expr: IRNode
    target_type: Any


@dataclass(frozen=True, slots=True)
class StoreName:
    name: str
    value: IRNode
    declared_type: Any | None = None


@dataclass(frozen=True, slots=True)
class StoreSlot:
    slot: int
    name: str
    value: IRNode
    declared_type: Any | None = None


@dataclass(frozen=True, slots=True)
class PrintStmt:
    value: IRNode


@dataclass(frozen=True, slots=True)
class FunctionDef:
    name: str
    params: list[str]
    body: "Block"
    param_types: list[Any] = field(default_factory=list)
    return_type: Any | None = None


@dataclass(frozen=True, slots=True)
class IfStmt:
    condition: IRNode
    body: "Block"


@dataclass(frozen=True, slots=True)
class WhileStmt:
    condition: IRNode
    body: "Block"


@dataclass(frozen=True, slots=True)
class MatchStmt:
    discriminant: IRNode
    arms: list[MatchArm] = field(default_factory=list)
    loop: bool = False


@dataclass(frozen=True, slots=True)
class ContinueStmt:
    pass


@dataclass(frozen=True, slots=True)
class BreakStmt:
    pass


@dataclass(frozen=True, slots=True)
class ReturnStmt:
    value: IRNode | None


@dataclass(frozen=True, slots=True)
class Block:
    statements: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class Module:
    statements: list[IRNode] = field(default_factory=list)


def lower_module(module: ast.Module) -> Module:
    return Module([lower_stmt(stmt) for stmt in module.statements])


def lower_block(block: ast.Block) -> Block:
    return Block([lower_stmt(stmt) for stmt in block.statements])


def lower_stmt(node: Any) -> IRNode:
    if isinstance(node, ast.Bind):
        if not isinstance(node.target, ast.Ident):
            raise NotImplementedError(
                f"IR lowering does not yet support bind target {type(node.target).__name__}"
            )
        value = lower_expr(node.value)
        if node.declared_type is not None:
            value = CoerceExpr(value, node.declared_type)
        return StoreName(node.target.name, value, node.declared_type)
    if isinstance(node, ast.FuncDef):
        param_types: list[Any] = []
        for p in node.params:
            if p.param_func_type is not None:
                param_types.append(p.param_func_type)
            elif p.type_ref is not None:
                param_types.append(p.type_ref)
            else:
                param_types.append(None)
        return FunctionDef(
            node.name,
            [p.name for p in node.params],
            lower_body_as_block(node.body),
            param_types=param_types,
            return_type=node.func_type.codomain if node.func_type is not None else None,
        )
    if isinstance(node, ast.ExprStmt):
        if isinstance(node.expr, ast.ConditionalExpr):
            if node.expr.loop:
                return WhileStmt(lower_expr(node.expr.condition), lower_body_as_block(node.expr.body))
            return IfStmt(lower_expr(node.expr.condition), lower_body_as_block(node.expr.body))
        if isinstance(node.expr, ast.MatchStmt):
            return lower_stmt(node.expr)
        return ExprStmt(lower_expr(node.expr))
    if isinstance(node, ast.StdioPrint):
        return PrintStmt(lower_expr(node.value))
    if isinstance(node, ast.ReturnStmt):
        return ReturnStmt(None if node.value is None else lower_expr(node.value))
    if isinstance(node, ast.ContinueStmt):
        return ContinueStmt()
    if isinstance(node, ast.BreakStmt):
        return BreakStmt()
    if isinstance(node, ast.ConditionalExpr):
        if node.loop:
            return WhileStmt(lower_expr(node.condition), lower_body_as_block(node.body))
        return IfStmt(lower_expr(node.condition), lower_body_as_block(node.body))
    if isinstance(node, ast.MatchStmt):
        return MatchStmt(
            lower_expr(node.discriminant),
            [MatchArm(None if arm.condition is None else lower_expr(arm.condition), lower_body_as_block(arm.body)) for arm in node.arms],
            loop=node.loop,
        )
    raise NotImplementedError(f"IR lowering does not yet support stmt {type(node).__name__}")


def lower_body_as_block(node: Any) -> Block:
    if isinstance(node, ast.Block):
        return lower_block(node)
    if isinstance(node, ast.ExprStmt):
        return Block([lower_stmt(node)])
    if isinstance(
        node,
        (
            ast.Bind,
            ast.ReturnStmt,
            ast.ConditionalExpr,
            ast.MatchStmt,
            ast.ContinueStmt,
            ast.BreakStmt,
        ),
    ):
        return Block([lower_stmt(node)])
    return Block([ExprStmt(lower_expr(node))])


def lower_expr(node: Any) -> IRNode:
    def _ctor_name(expr: Any) -> str | None:
        if isinstance(expr, ast.Ident):
            return expr.name
        if isinstance(expr, ast.Attribute) and isinstance(expr.value, ast.Ident) and expr.value.name == "collections":
            return expr.name
        return None

    def _fixed_vector_type_from_expr(expr: Any) -> Any | None:
        if not isinstance(expr, ast.ListLit) or expr.axis_tag is not None or len(expr.elements) != 1:
            return None
        only = expr.elements[0]
        if not isinstance(only, ast.VectorRepeat):
            return None
        if not isinstance(only.value, ast.Ident):
            return None
        if not isinstance(only.count, ast.NumberLit):
            return None
        count = only.count.value
        if not isinstance(count, (int, float)) or int(count) != count:
            raise NotImplementedError("IR lowering only supports integer fixed-vector cast sizes")
        return ast.FixedVectorType(ast.PrimTypeRef(only.value.name), ast.TypeSizeConst(int(count)))

    if isinstance(node, ast.NumberLit):
        return Const(node.value)
    if isinstance(node, ast.BoolLit):
        return Const(node.value)
    if isinstance(node, ast.NullLit):
        return Const(None)
    if isinstance(node, ast.StringLit):
        if node.raw:
            return Const(node.value)
        if "$" in node.value:
            raise NotImplementedError("IR lowering does not yet support interpolated strings")
        return Const(node.value)
    if isinstance(node, ast.Ident):
        return LoadName(node.name)
    if isinstance(node, ast.Call):
        ctor = _ctor_name(node.func)
        fixed_vector_target = _fixed_vector_type_from_expr(node.func)
        if fixed_vector_target is not None:
            if len(node.args) != 1 or isinstance(node.args[0], (ast.NamedCallArg, ast.SpreadArg)):
                raise NotImplementedError("IR lowering only supports single-argument fixed-vector casts")
            return CoerceExpr(lower_expr(node.args[0]), fixed_vector_target)
        if ctor == "map":
            fields: list[tuple[str, IRNode]] = []
            for a in node.args:
                if not isinstance(a, ast.NamedCallArg):
                    raise NotImplementedError("IR lowering only supports keyword-style map(...) arguments")
                fields.append((a.name, lower_expr(a.value)))
            return MapExpr(fields)
        if ctor == "list":
            elems: list[IRNode] = []
            spread: IRNode | None = None
            for a in node.args:
                if isinstance(a, ast.NamedCallArg):
                    raise NotImplementedError("IR lowering does not support keyword args in list(...)")
                if isinstance(a, ast.SpreadArg):
                    if spread is not None or elems:
                        raise NotImplementedError("IR lowering only supports list(:expr) when it is the only argument")
                    spread = lower_expr(a.expr)
                    continue
                elems.append(lower_expr(a))
            return LinkedListExpr(elems, spread)
        args: list[IRNode] = []
        for a in node.args:
            if isinstance(a, (ast.NamedCallArg, ast.SpreadArg)):
                raise NotImplementedError("IR lowering does not yet support named or spread call args")
            args.append(lower_expr(a))
        return CallExpr(lower_expr(node.func), args)
    if isinstance(node, ast.ListLit):
        elements: list[IRNode] = []
        for e in node.elements:
            if isinstance(e, (ast.MsetSpill, ast.SpreadArg)):
                raise NotImplementedError("IR lowering does not yet support spread elements in list literals")
            elements.append(lower_expr(e))
        return ListExpr(elements)
    if isinstance(node, ast.MultisetLit):
        return MultisetExpr([(lower_expr(val), lower_expr(count)) for val, count in node.pairs])
    if isinstance(node, ast.StructLit):
        return StructExpr([(name, lower_expr(val)) for name, val in node.fields])
    if isinstance(node, ast.Attribute):
        return AttrExpr(lower_expr(node.value), node.name)
    if isinstance(node, ast.ConditionalExpr):
        if node.loop:
            raise NotImplementedError("IR lowering does not support loop conditionals as value expressions")
        raise NotImplementedError("IR lowering does not support conditionals as value expressions")
    if isinstance(node, ast.MatchStmt):
        raise NotImplementedError("IR lowering does not support match statements as value expressions")
    if isinstance(node, ast.UnaryOp):
        return UnaryExpr(node.op, lower_expr(node.operand))
    if isinstance(node, ast.BinOp):
        return BinaryExpr(node.op, lower_expr(node.left), lower_expr(node.right))
    raise NotImplementedError(f"IR lowering does not yet support expr {type(node).__name__}")
