"""Lowered intermediate representation for Vektor Flow.

This first pass is intentionally small and explicit. It sits beside the
existing AST/interpreter so we can validate semantics incrementally before
adding more aggressive optimizations or a native backend.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import ast
from .stdlib import STDLIB_MODULES


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
    kwargs: list[tuple[str, IRNode]] = field(default_factory=list)
    spreads: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ListExpr:
    elements: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class TupleExpr:
    elements: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SpliceExpr:
    expr: IRNode


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
class IndexExpr:
    value: IRNode
    indices: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class RangeExpr:
    start: IRNode | None
    end: IRNode | None


@dataclass(frozen=True, slots=True)
class PipeChainExpr:
    source: IRNode
    segments: list[IRNode | "Block"] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class AbsExpr:
    inner: IRNode


@dataclass(frozen=True, slots=True)
class TypeOfExpr:
    value: IRNode


@dataclass(frozen=True, slots=True)
class ScopeExpr:
    body: "Block"


@dataclass(frozen=True, slots=True)
class ScopeIdentityExpr:
    pass


@dataclass(frozen=True, slots=True)
class SpillExpr:
    value: IRNode


@dataclass(frozen=True, slots=True)
class MatchArm:
    condition: IRNode | None
    body: "Block"


@dataclass(frozen=True, slots=True)
class CoerceExpr:
    expr: IRNode
    target_type: Any


@dataclass(frozen=True, slots=True)
class BindExpr:
    target: IRNode
    value: IRNode


@dataclass(frozen=True, slots=True)
class AxisAlignExpr:
    value: IRNode
    key: IRNode


@dataclass(frozen=True, slots=True)
class InterpolatedStringExpr:
    template: str


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
class LabelPrintStmt:
    expr_text: str
    value: IRNode


@dataclass(frozen=True, slots=True)
class ModuleImportStmt:
    path_segments: list[str] = field(default_factory=list)
    alias: str | None = None


@dataclass(frozen=True, slots=True)
class SpillStmt:
    value: IRNode


@dataclass(frozen=True, slots=True)
class FunctionDef:
    name: str
    params: list[str]
    body: "Block"
    param_types: list[Any] = field(default_factory=list)
    return_type: Any | None = None
    param_specs: list[ast.Param] = field(default_factory=list)


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
class TypeDef:
    name: str
    type_expr: Any


@dataclass(frozen=True, slots=True)
class Block:
    statements: list[IRNode] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class Module:
    statements: list[IRNode] = field(default_factory=list)
    stdlib_imports: list["StdlibImport"] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class StdlibImport:
    module_name: str
    binding_name: str
    spill_exports: bool = False


def lower_module(module: ast.Module) -> Module:
    type_registry: dict[str, Any] = {}
    lowered: list[IRNode] = []
    stdlib_imports: list[StdlibImport] = []
    for stmt in module.statements:
        lowered_stmt = lower_stmt(stmt, type_registry, stdlib_imports=stdlib_imports, top_level=True)
        if lowered_stmt is not None:
            lowered.append(lowered_stmt)
    return Module(lowered, stdlib_imports=stdlib_imports)


def lower_block(block: ast.Block) -> Block:
    lowered: list[IRNode] = []
    for stmt in block.statements:
        lowered_stmt = lower_stmt(stmt, {}, top_level=False)
        if lowered_stmt is not None:
            lowered.append(lowered_stmt)
    return Block(lowered)


def lower_function_parts(
    params: list[ast.Param],
    body: Any,
    func_type: ast.FuncType | None = None,
    type_registry: dict[str, Any] | None = None,
) -> tuple[Block, list[Any], Any | None]:
    if type_registry is None:
        type_registry = {}
    param_types: list[Any] = []
    for p in params:
        if p.param_func_type is not None:
            param_types.append(_resolve_type_refs(p.param_func_type, type_registry))
        elif p.type_ref is not None:
            param_types.append(_resolve_type_refs(p.type_ref, type_registry))
        else:
            param_types.append(None)
    return_type = (
        _resolve_type_refs(func_type.codomain, type_registry)
        if func_type is not None
        else None
    )
    return lower_body_as_block(body), param_types, return_type


def _resolve_type_refs(type_expr: Any, type_registry: dict[str, Any]) -> Any:
    if isinstance(type_expr, ast.NamedTypeSpec):
        return ast.NamedTypeSpec(type_expr.name, _resolve_type_refs(type_expr.type_expr, type_registry))
    if isinstance(type_expr, ast.SymbolicDomainType):
        return type_expr
    if isinstance(type_expr, ast.TypePowerExpr):
        return ast.TypePowerExpr(_resolve_type_refs(type_expr.base, type_registry), _resolve_type_refs(type_expr.exponent, type_registry))
    if isinstance(type_expr, ast.SymbolicValueType):
        return ast.SymbolicValueType(None if type_expr.domain is None else _resolve_type_refs(type_expr.domain, type_registry))
    if isinstance(type_expr, ast.PrimTypeRef):
        return type_registry.get(type_expr.name, type_expr)
    if isinstance(type_expr, ast.TypeExpr):
        return ast.TypeExpr([(name, _resolve_type_refs(inner, type_registry)) for name, inner in type_expr.fields])
    if isinstance(type_expr, ast.TupleTypeExpr):
        return ast.TupleTypeExpr([_resolve_type_refs(inner, type_registry) for inner in type_expr.elements])
    if isinstance(type_expr, ast.FixedVectorType):
        return ast.FixedVectorType(_resolve_type_refs(type_expr.element_type, type_registry), type_expr.size)
    if isinstance(type_expr, ast.MultisetType):
        return ast.MultisetType(_resolve_type_refs(type_expr.element_type, type_registry))
    if isinstance(type_expr, ast.MapValueType):
        return ast.MapValueType([(name, _resolve_type_refs(inner, type_registry)) for name, inner in type_expr.fields])
    if isinstance(type_expr, ast.LinkedListValueType):
        return ast.LinkedListValueType([_resolve_type_refs(inner, type_registry) for inner in type_expr.elements])
    if isinstance(type_expr, ast.FuncType):
        return ast.FuncType(
            _resolve_type_refs(type_expr.domain, type_registry),
            _resolve_type_refs(type_expr.codomain, type_registry),
        )
    return type_expr


def _type_contains_symbolic_domain(type_expr: Any) -> bool:
    if isinstance(type_expr, ast.SymbolicDomainType):
        return True
    if isinstance(type_expr, ast.TypePowerExpr):
        return _type_contains_symbolic_domain(type_expr.base) or _type_contains_symbolic_domain(type_expr.exponent)
    if isinstance(type_expr, ast.FuncType):
        return _type_contains_symbolic_domain(type_expr.domain) or _type_contains_symbolic_domain(type_expr.codomain)
    if isinstance(type_expr, (ast.TypeUnionExpr, ast.TypeIntersectionExpr)):
        return any(_type_contains_symbolic_domain(member) for member in type_expr.members)
    if isinstance(type_expr, ast.TupleTypeExpr):
        return any(_type_contains_symbolic_domain(element) for element in type_expr.elements)
    if isinstance(type_expr, ast.TypeExpr):
        return any(_type_contains_symbolic_domain(inner) for _, inner in type_expr.fields)
    if isinstance(type_expr, ast.FixedVectorType):
        return _type_contains_symbolic_domain(type_expr.element_type) or _type_contains_symbolic_domain(type_expr.size)
    if isinstance(type_expr, ast.MultisetType):
        return _type_contains_symbolic_domain(type_expr.element_type)
    if isinstance(type_expr, ast.MapValueType):
        return any(_type_contains_symbolic_domain(inner) for _, inner in type_expr.fields)
    if isinstance(type_expr, ast.LinkedListValueType):
        return any(_type_contains_symbolic_domain(inner) for inner in type_expr.elements)
    if isinstance(type_expr, ast.NamedTypeSpec):
        return _type_contains_symbolic_domain(type_expr.type_expr)
    return False


def _type_surface_string(type_expr: Any) -> str:
    if isinstance(type_expr, ast.SymbolicDomainType):
        return type_expr.name
    if isinstance(type_expr, ast.TypePowerExpr):
        return f"{_type_surface_string(type_expr.base)}^{_type_surface_string(type_expr.exponent)}"
    if isinstance(type_expr, ast.TypeSizeConst):
        return str(type_expr.value)
    if isinstance(type_expr, ast.TypeSizeVar):
        return type_expr.name
    if isinstance(type_expr, ast.TypeSizeBinOp):
        return f"{_type_surface_string(type_expr.left)}{type_expr.op}{_type_surface_string(type_expr.right)}"
    if isinstance(type_expr, ast.PrimTypeRef):
        return type_expr.name
    if isinstance(type_expr, ast.FuncType):
        return f"{_type_surface_string(type_expr.domain)}->{_type_surface_string(type_expr.codomain)}"
    if isinstance(type_expr, ast.TupleTypeExpr):
        return "(" + ", ".join(_type_surface_string(element) for element in type_expr.elements) + ")"
    if isinstance(type_expr, ast.TypeExpr):
        return "(" + ", ".join(f"{name}:{_type_surface_string(inner)}" for name, inner in type_expr.fields) + ")"
    if isinstance(type_expr, ast.FixedVectorType):
        return f"[{_type_surface_string(type_expr.element_type)}:{_type_surface_string(type_expr.size)}]"
    if isinstance(type_expr, ast.TypeUnionExpr):
        return "|".join(_type_surface_string(member) for member in type_expr.members)
    if isinstance(type_expr, ast.TypeIntersectionExpr):
        return "&".join(_type_surface_string(member) for member in type_expr.members)
    if isinstance(type_expr, ast.MultisetType):
        return "{" + _type_surface_string(type_expr.element_type) + "}"
    if isinstance(type_expr, ast.MapValueType):
        return "map(" + ", ".join(f"{name}:{_type_surface_string(inner)}" for name, inner in type_expr.fields) + ")"
    if isinstance(type_expr, ast.LinkedListValueType):
        return "list(" + ", ".join(_type_surface_string(inner) for inner in type_expr.elements) + ")"
    if isinstance(type_expr, ast.NamedTypeSpec):
        return f"{type_expr.name}:{_type_surface_string(type_expr.type_expr)}"
    return str(type_expr)


def _try_record_stdlib_import(
    node: ast.SpillImport,
    stdlib_imports: list[StdlibImport] | None,
    *,
    top_level: bool,
) -> bool:
    if not isinstance(node.path, ast.DotModulePath):
        return False
    if len(node.path.segments) != 1:
        return False
    module_name = node.path.segments[0]
    if module_name not in STDLIB_MODULES:
        return False
    if stdlib_imports is None:
        raise NotImplementedError("IR lowering only supports stdlib imports at module top level")
    binding_name = node.alias or module_name
    stdlib_imports.append(
        StdlibImport(module_name=module_name, binding_name=binding_name, spill_exports=node.alias is None)
    )
    return True


def lower_stmt(
    node: Any,
    type_registry: dict[str, Any] | None = None,
    *,
    stdlib_imports: list[StdlibImport] | None = None,
    top_level: bool = False,
) -> IRNode | None:
    if type_registry is None:
        type_registry = {}
    if isinstance(node, ast.SpillImport) and _try_record_stdlib_import(node, stdlib_imports, top_level=top_level):
        return None
    if isinstance(node, ast.SpillImport):
        if not isinstance(node.path, ast.DotModulePath):
            raise NotImplementedError("IR lowering only supports dot-module spill imports")
        return ModuleImportStmt(list(node.path.segments), node.alias)
    if isinstance(node, ast.Bind):
        if isinstance(node.target, ast.Ident) and node.declared_type is None and isinstance(node.value, ast.TypeExpr):
            resolved_type = _resolve_type_refs(node.value, type_registry)
            type_registry[node.target.name] = resolved_type
            return TypeDef(node.target.name, resolved_type)
        declared_type = None if node.declared_type is None else _resolve_type_refs(node.declared_type, type_registry)
        if (
            isinstance(node.target, ast.Ident)
            and node.declared_type is None
            and _type_contains_symbolic_domain(node.value)
        ):
            resolved_domain = _resolve_type_refs(node.value, type_registry)
            value: IRNode = CallExpr(LoadName("symbolic"), [Const(node.target.name)])
            value = CallExpr(
                LoadName("assume"),
                [value, Const(f"{node.target.name} in {_type_surface_string(resolved_domain)}")],
            )
            return StoreName(node.target.name, value, ast.SymbolicValueType(resolved_domain))
        value = lower_expr(node.value)
        if declared_type is not None:
            value = CoerceExpr(value, declared_type)
        if not isinstance(node.target, ast.Ident):
            return ExprStmt(BindExpr(lower_expr(node.target), value))
        return StoreName(node.target.name, value, declared_type)
    if isinstance(node, ast.FuncDef):
        body, param_types, return_type = lower_function_parts(
            node.params,
            node.body,
            node.func_type,
            type_registry,
        )
        return FunctionDef(
            node.name,
            [p.name for p in node.params],
            body,
            param_specs=list(node.params),
            param_types=param_types,
            return_type=return_type,
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
    if isinstance(node, ast.StdioLabelPrint):
        return LabelPrintStmt(node.expr_text, lower_expr(node.value))
    if isinstance(node, ast.SpillValue):
        return SpillStmt(lower_expr(node.value))
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
        if node.catch:
            raise NotImplementedError("IR lowering does not yet support catch matches `!?`")
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
    def _lower_pipe_segment(node: Any) -> IRNode | Block:
        if isinstance(node, ast.Block):
            return lower_block(node)
        if isinstance(
            node,
            (
                ast.Bind,
                ast.ReturnStmt,
                ast.ConditionalExpr,
                ast.MatchStmt,
                ast.ContinueStmt,
                ast.BreakStmt,
                ast.StdioPrint,
                ast.StdioLabelPrint,
                ast.SpillValue,
            ),
        ):
            return lower_body_as_block(node)
        if isinstance(node, ast.ExprStmt):
            if isinstance(node.expr, (ast.ConditionalExpr, ast.MatchStmt)):
                return lower_body_as_block(node)
            return lower_expr(node.expr)
        return lower_expr(node)

    def _fixed_vector_type_from_expr(expr: Any) -> Any | None:
        if not isinstance(expr, ast.ListLit) or getattr(expr, "axis_tag", None) is not None or len(expr.elements) != 1:
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

    def _collection_ctor_from_expr(expr: Any) -> str | None:
        if not isinstance(expr, ast.Attribute):
            return None
        if expr.name not in {"map", "list"}:
            return None
        if not isinstance(expr.value, ast.Ident):
            return None
        if expr.value.name not in {"collections", "col"}:
            return None
        return expr.name

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
            return InterpolatedStringExpr(node.value)
        return Const(node.value)
    if isinstance(node, ast.Ident):
        return LoadName(node.name)
    if isinstance(node, ast.OpRef):
        return LoadName(node.symbol)
    if isinstance(node, ast.Call):
        fixed_vector_target = _fixed_vector_type_from_expr(node.func)
        if fixed_vector_target is not None:
            if len(node.args) != 1 or isinstance(node.args[0], (ast.NamedCallArg, ast.SpreadArg)):
                raise NotImplementedError("IR lowering only supports single-argument fixed-vector casts")
            return CoerceExpr(lower_expr(node.args[0]), fixed_vector_target)
        collection_ctor = _collection_ctor_from_expr(node.func)
        if collection_ctor == "map":
            fields: list[tuple[str, IRNode]] = []
            for a in node.args:
                if not isinstance(a, ast.NamedCallArg):
                    raise NotImplementedError("IR lowering only supports named fields in collections.map")
                fields.append((a.name, lower_expr(a.value)))
            return MapExpr(fields)
        if collection_ctor == "list":
            elements: list[IRNode] = []
            spread: IRNode | None = None
            for a in node.args:
                if isinstance(a, ast.NamedCallArg):
                    raise NotImplementedError("IR lowering does not support named fields in collections.list")
                if isinstance(a, ast.SpreadArg):
                    if spread is not None:
                        raise NotImplementedError("IR lowering only supports one spread in collections.list")
                    spread = lower_expr(a.expr)
                    continue
                elements.append(lower_expr(a))
            return LinkedListExpr(elements, spread)
        args: list[IRNode] = []
        kwargs: list[tuple[str, IRNode]] = []
        spreads: list[IRNode] = []
        for a in node.args:
            if isinstance(a, ast.NamedCallArg):
                kwargs.append((a.name, lower_expr(a.value)))
                continue
            if isinstance(a, ast.SpreadArg):
                spreads.append(lower_expr(a.expr))
                continue
            args.append(lower_expr(a))
        return CallExpr(lower_expr(node.func), args, kwargs, spreads)
    if isinstance(node, ast.ListLit):
        elements: list[IRNode] = []
        for e in node.elements:
            if isinstance(e, ast.MsetSpill):
                elements.append(SpliceExpr(lower_expr(e.expr)))
                continue
            if isinstance(e, ast.SpreadArg):
                raise NotImplementedError("IR lowering does not yet support tuple spread elements in list literals")
            elements.append(lower_expr(e))
        return ListExpr(elements)
    if isinstance(node, ast.TupleLit):
        elements: list[IRNode] = []
        for e in node.elements:
            if isinstance(e, ast.SpreadArg):
                elements.append(SpliceExpr(lower_expr(e.expr)))
                continue
            elements.append(lower_expr(e))
        return TupleExpr(elements)
    if isinstance(node, ast.MultisetLit):
        return MultisetExpr([(lower_expr(val), lower_expr(count)) for val, count in node.pairs])
    type_key_set = getattr(ast, "TypeKeySet", None)
    if type_key_set is not None and isinstance(node, type_key_set):
        raise NotImplementedError("IR lowering does not yet support type-key set spills")
    if isinstance(node, ast.AxisAlign):
        if node.label is not None:
            axis_key = "i" if node.label == "_" else node.label
            return AxisAlignExpr(lower_expr(node.value), Const(axis_key))
        indices = node.indices or []
        if len(indices) != 1:
            raise NotImplementedError("IR lowering only supports one axis access expression for arrow axis tags")
        return AxisAlignExpr(lower_expr(node.value), lower_expr(indices[0]))
    if isinstance(node, ast.StructLit):
        return StructExpr([(name, lower_expr(val)) for name, val in node.fields])
    bind_expr = getattr(ast, "BindExpr", None)
    if (bind_expr is not None and isinstance(node, bind_expr)) or isinstance(node, ast.Bind):
        if not isinstance(node.target, ast.Ident):
            raise NotImplementedError(
                f"IR lowering does not yet support bind expression target {type(node.target).__name__}"
            )
        return BindExpr(LoadName(node.target.name), lower_expr(node.value))
    if isinstance(node, ast.Attribute):
        return AttrExpr(lower_expr(node.value), node.name)
    if isinstance(node, ast.DottedIndex):
        return IndexExpr(lower_expr(node.base), [lower_expr(idx) for idx in node.indices])
    if isinstance(node, ast.RangeExpr):
        return RangeExpr(
            None if node.start is None else lower_expr(node.start),
            None if node.end is None else lower_expr(node.end),
        )
    if isinstance(node, ast.PipeChain):
        return PipeChainExpr(lower_expr(node.source), [_lower_pipe_segment(seg) for seg in node.segments])
    if isinstance(node, ast.AbsExpr):
        return AbsExpr(lower_expr(node.inner))
    if isinstance(node, ast.TypeOf):
        return TypeOfExpr(lower_expr(node.value))
    if isinstance(node, ast.ScopeExpr):
        return ScopeExpr(lower_block(node.body))
    if isinstance(node, ast.StructIdentity):
        return ScopeIdentityExpr()
    if isinstance(node, ast.SpillExpr):
        return SpillExpr(lower_expr(node.value))
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
