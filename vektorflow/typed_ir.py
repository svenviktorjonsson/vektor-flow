from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import ast, ir
from .native_intrinsics import NativeIntrinsic, infer_intrinsic_return_type, resolve_native_intrinsic


class TypedIRError(Exception):
    pass


@dataclass(frozen=True)
class StdlibNamespaceType:
    module_name: str


@dataclass(frozen=True)
class StdlibFunctionType:
    module_name: str
    name: str


@dataclass(frozen=True)
class ImportedNamespaceType:
    path: str


@dataclass(frozen=True)
class ImportedFunctionType:
    path: str
    name: str


@dataclass(frozen=True)
class AxisTaggedType:
    value_type: Any
    axis_key: str | None


@dataclass
class TypedModuleInfo:
    expr_types: dict[int, Any] = field(default_factory=dict)
    stmt_input_envs: dict[int, dict[str, Any]] = field(default_factory=dict)
    stmt_output_envs: dict[int, dict[str, Any]] = field(default_factory=dict)
    function_envs: dict[str, dict[str, Any]] = field(default_factory=dict)
    function_slots: dict[str, dict[str, int]] = field(default_factory=dict)
    module_slots: dict[str, int] = field(default_factory=dict)

    def expr_type(self, node: Any) -> Any:
        try:
            return self.expr_types[id(node)]
        except KeyError as exc:
            raise TypedIRError(f"missing typed IR annotation for {type(node).__name__}") from exc


def _normalize_type(t: Any) -> Any:
    if isinstance(t, ast.NamedTypeSpec):
        return _normalize_type(t.type_expr)
    return t


def _promote_numeric(a: Any, b: Any) -> Any:
    a = _normalize_type(a)
    b = _normalize_type(b)
    if not isinstance(a, ast.PrimTypeRef) or not isinstance(b, ast.PrimTypeRef):
        raise TypedIRError("unsupported non-primitive numeric promotion")
    if a.name == "rational" or b.name == "rational":
        return ast.PrimTypeRef("rational")
    if a.name == "num" or b.name == "num":
        return ast.PrimTypeRef("num")
    if a.name == "int" and b.name == "int":
        return ast.PrimTypeRef("int")
    if a.name == "bit" and b.name == "bit":
        return ast.PrimTypeRef("bit")
    if {a.name, b.name} <= {"bit", "int"}:
        return ast.PrimTypeRef("int")
    raise TypedIRError(f"unsupported numeric promotion {a.name} vs {b.name}")


def _same_primitive_name(a: Any, b: Any) -> bool:
    a = _normalize_type(a)
    b = _normalize_type(b)
    return isinstance(a, ast.PrimTypeRef) and isinstance(b, ast.PrimTypeRef) and a.name == b.name


def _is_scalar_numeric_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bit", "int", "rational", "num"}


def _is_symbolic_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.SymbolicValueType) or (isinstance(t, ast.PrimTypeRef) and t.name == "symbolic")


SYMBOLIC_STDLIB_EXPORTS: frozenset[str] = frozenset({
    "assume",
    "cancel",
    "canonical",
    "collect",
    "complete_square",
    "compute",
    "conditions",
    "delta",
    "derivative",
    "differentiate",
    "diff",
    "difference",
    "dsolve",
    "expand",
    "factor",
    "grad",
    "gradient",
    "integ",
    "integral",
    "integrate",
    "latex",
    "move",
    "same",
    "shift",
    "solve",
    "trace",
    "trig_compress",
    "trig_expand",
})


def _same_type(a: Any, b: Any) -> bool:
    return _normalize_type(a) == _normalize_type(b)


def _infer_symbolic_builtin(name: str, arg_types: list[Any]) -> Any | None:
    has_symbolic_arg = any(_is_symbolic_type(t) for t in arg_types)
    if name == "symbolic":
        return ast.PrimTypeRef("symbolic")
    if name == "same":
        return ast.PrimTypeRef("bit") if has_symbolic_arg else None
    if name == "conditions":
        return ast.PrimTypeRef("str") if has_symbolic_arg else None
    if not has_symbolic_arg:
        return None
    if name in {"latex", "trace"}:
        return ast.PrimTypeRef("str")
    if name in {
        "assume",
        "cancel",
        "canonical",
        "collect",
        "complete_square",
        "compute",
        "delta",
        "derivative",
        "differentiate",
        "diff",
        "diff_n",
        "difference",
        "dsolve",
        "expand",
        "factor",
        "grad",
        "gradient",
        "integ",
        "integral",
        "integrate",
        "move",
        "shift",
        "solve",
        "trig_compress",
        "trig_expand",
        "sin",
        "cos",
        "tan",
        "sec",
        "cot",
        "csc",
        "exp",
        "ln",
        "sqrt",
    }:
        return ast.PrimTypeRef("symbolic")
    return None


def _promote_value_type(a: Any, b: Any) -> Any:
    a_n = _normalize_type(a)
    b_n = _normalize_type(b)
    if isinstance(a_n, ast.PrimTypeRef) and isinstance(b_n, ast.PrimTypeRef):
        return _promote_numeric(a_n, b_n)
    if _same_type(a_n, b_n):
        return a_n
    raise TypedIRError(f"unsupported value-type promotion {type(a_n).__name__} vs {type(b_n).__name__}")


def _axis_key_from_const(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value == int(value) else str(value)
    return None


def _axis_concat_key(left: str | None, right: str | None) -> str | None:
    if left is None or right is None:
        return None
    return f"{left}{right}"


def _scope_env_type(env: dict[str, Any]) -> ast.TypeExpr:
    return ast.TypeExpr([(name, _normalize_type(inner)) for name, inner in env.items()])


class IRTypeAnalyzer:
    def __init__(self, module: ir.Module) -> None:
        self.module = module
        self.functions = {stmt.name: stmt for stmt in module.statements if isinstance(stmt, ir.FunctionDef)}
        self.info = TypedModuleInfo()

    def _stdlib_env(self) -> dict[str, Any]:
        env: dict[str, Any] = {
            stdlib_import.binding_name: StdlibNamespaceType(stdlib_import.module_name)
            for stdlib_import in self.module.stdlib_imports
        }
        for stdlib_import in self.module.stdlib_imports:
            if stdlib_import.module_name == "symbolic" and stdlib_import.spill_exports:
                env.update(
                    {
                        name: StdlibFunctionType("symbolic", name)
                        for name in SYMBOLIC_STDLIB_EXPORTS
                    }
                )
        return env

    def analyze(self) -> TypedModuleInfo:
        env: dict[str, Any] = self._stdlib_env()
        module_slots: dict[str, int] = {}
        for stmt in self.module.statements:
            if isinstance(stmt, ir.FunctionDef):
                self._analyze_function(stmt)
            else:
                env = self._analyze_stmt(stmt, env, module_slots)
        self.info.module_slots = dict(module_slots)
        return self.info

    def _analyze_function(self, fn: ir.FunctionDef) -> None:
        env = self._stdlib_env()
        env.update({
            name: _normalize_type(ptype)
            for name, ptype in zip(fn.params, fn.param_types)
            if ptype is not None
        })
        slots = {name: idx for idx, name in enumerate(fn.params)}
        self.info.function_envs[fn.name] = dict(env)
        cur = dict(env)
        for stmt in fn.body.statements:
            cur = self._analyze_stmt(stmt, cur, slots)
        self.info.function_slots[fn.name] = dict(slots)

    def _record_stmt_env(self, stmt: Any, env: dict[str, Any], out_env: dict[str, Any]) -> None:
        self.info.stmt_input_envs[id(stmt)] = dict(env)
        self.info.stmt_output_envs[id(stmt)] = dict(out_env)

    def _analyze_block_result(self, block: ir.Block, env: dict[str, Any], slots: dict[str, int]) -> tuple[dict[str, Any], Any]:
        cur = dict(env)
        result_t: Any = ast.PrimTypeRef("any")
        for stmt in block.statements:
            result_t = self._infer_stmt_result(stmt, cur)
            cur = self._analyze_stmt(stmt, cur, slots)
        return cur, result_t

    def _infer_stmt_result(self, stmt: Any, env: dict[str, Any]) -> Any:
        if isinstance(stmt, ir.TypeDef):
            return ast.PrimTypeRef("any")
        if isinstance(stmt, (ir.StoreName, ir.StoreSlot)):
            expr_t = self._infer_expr(stmt.value, dict(env))
            return _normalize_type(stmt.declared_type) if stmt.declared_type is not None else expr_t
        if isinstance(stmt, ir.ExprStmt):
            return self._infer_expr(stmt.expr, dict(env))
        if isinstance(stmt, ir.SpillStmt):
            return self._infer_expr(stmt.value, dict(env))
        if isinstance(stmt, ir.ReturnStmt):
            return ast.PrimTypeRef("any") if stmt.value is None else self._infer_expr(stmt.value, dict(env))
        return ast.PrimTypeRef("any")

    def _analyze_stmt(self, stmt: Any, env: dict[str, Any], slots: dict[str, int]) -> dict[str, Any]:
        cur = dict(env)
        if isinstance(stmt, ir.TypeDef):
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.StoreName):
            expr_t = self._infer_expr(stmt.value, cur)
            final_t = _normalize_type(stmt.declared_type) if stmt.declared_type is not None else expr_t
            if stmt.name not in slots:
                slots[stmt.name] = len(slots)
            cur[stmt.name] = final_t
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.StoreSlot):
            expr_t = self._infer_expr(stmt.value, cur)
            final_t = _normalize_type(stmt.declared_type) if stmt.declared_type is not None else expr_t
            slots[stmt.name] = stmt.slot
            cur[stmt.name] = final_t
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.ModuleImportStmt):
            if stmt.alias is not None:
                cur[stmt.alias] = ImportedNamespaceType(".".join(stmt.path_segments))
                if stmt.alias not in slots:
                    slots[stmt.alias] = len(slots)
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.PrintStmt):
            self._infer_expr(stmt.value, cur)
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.LabelPrintStmt):
            self._infer_expr(stmt.value, cur)
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.SpillStmt):
            value_t = _normalize_type(self._infer_expr(stmt.value, cur))
            if isinstance(value_t, ast.TypeExpr):
                for name, inner in value_t.fields:
                    cur[name] = inner
            elif isinstance(value_t, ast.MapValueType):
                for name, inner in value_t.fields:
                    cur[name] = inner
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.ExprStmt):
            self._infer_expr(stmt.expr, cur)
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.IfStmt):
            self._infer_expr(stmt.condition, cur)
            nested = dict(cur)
            for sub in stmt.body.statements:
                nested = self._analyze_stmt(sub, nested, dict(slots))
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.WhileStmt):
            self._infer_expr(stmt.condition, cur)
            nested = dict(cur)
            for sub in stmt.body.statements:
                nested = self._analyze_stmt(sub, nested, dict(slots))
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.MatchStmt):
            self._infer_expr(stmt.discriminant, cur)
            for arm in stmt.arms:
                if arm.condition is not None:
                    self._infer_expr(arm.condition, cur)
                nested = dict(cur)
                for sub in arm.body.statements:
                    nested = self._analyze_stmt(sub, nested, dict(slots))
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, (ir.ContinueStmt, ir.BreakStmt)):
            self._record_stmt_env(stmt, env, cur)
            return cur
        if isinstance(stmt, ir.ReturnStmt):
            if stmt.value is not None:
                self._infer_expr(stmt.value, cur)
            self._record_stmt_env(stmt, env, cur)
            return cur
        raise TypedIRError(f"unsupported typed-IR stmt analysis for {type(stmt).__name__}")

    def _remember_expr(self, node: Any, typ: Any) -> Any:
        self.info.expr_types[id(node)] = _normalize_type(typ)
        return self.info.expr_types[id(node)]

    def _infer_expr(self, node: Any, env: dict[str, Any]) -> Any:
        if isinstance(node, ir.Const):
            if isinstance(node.value, bool):
                return self._remember_expr(node, ast.PrimTypeRef("bit"))
            if node.value is None:
                raise TypedIRError("null is not yet supported in typed IR analysis for native emission")
            if isinstance(node.value, (int, float)):
                return self._remember_expr(node, ast.PrimTypeRef("num"))
            if isinstance(node.value, str):
                return self._remember_expr(node, ast.PrimTypeRef("str"))
            raise TypedIRError(f"unsupported constant type {type(node.value).__name__}")
        if isinstance(node, ir.InterpolatedStringExpr):
            return self._remember_expr(node, ast.PrimTypeRef("str"))
        if isinstance(node, ir.LoadName):
            if node.name == "inf":
                return self._remember_expr(node, ast.PrimTypeRef("symbolic"))
            if node.name not in env:
                raise TypedIRError(f"unknown name in typed IR analysis: {node.name}")
            return self._remember_expr(node, env[node.name])
        if isinstance(node, ir.LoadSlot):
            if node.name not in env:
                raise TypedIRError(f"unknown slot-backed name in typed IR analysis: {node.name}")
            return self._remember_expr(node, env[node.name])
        if isinstance(node, ir.CoerceExpr):
            self._infer_expr(node.expr, env)
            return self._remember_expr(node, _normalize_type(node.target_type))
        if isinstance(node, ir.BindExpr):
            value_t = self._infer_expr(node.value, env)
            if isinstance(node.target, (ir.LoadName, ir.LoadSlot)):
                env[node.target.name] = value_t
            elif isinstance(node.target, ir.AttrExpr):
                self._infer_bind_target(node.target, env)
                self._try_update_attr_bind_env(node.target, value_t, env)
            elif isinstance(node.target, ir.IndexExpr):
                self._infer_bind_target(node.target, env)
            else:
                raise TypedIRError(f"unsupported bind expression target {type(node.target).__name__}")
            return self._remember_expr(node, value_t)
        if isinstance(node, ir.ListExpr):
            if len(node.elements) == 1 and isinstance(node.elements[0], ir.RangeExpr):
                return self._remember_expr(node, _normalize_type(self._infer_expr(node.elements[0], env)))
            if not node.elements:
                return self._remember_expr(
                    node,
                    ast.FixedVectorType(ast.PrimTypeRef("any"), ast.TypeSizeConst(0)),
                )
            elem_types: list[Any] = []
            for elem in node.elements:
                if isinstance(elem, ir.SpliceExpr):
                    spread_t = _normalize_type(self._infer_expr(elem.expr, env))
                    if isinstance(spread_t, ast.FixedVectorType):
                        size = spread_t.size.value if isinstance(spread_t.size, ast.TypeSizeConst) else None
                        if size is None:
                            raise TypedIRError("vector spread requires a resolved source size in typed IR analysis")
                        elem_types.extend([spread_t.element_type] * size)
                        continue
                    if isinstance(spread_t, ast.LinkedListValueType):
                        elem_types.extend(spread_t.elements)
                        continue
                    raise TypedIRError("vector spread requires a vector or linked-list source in typed IR analysis")
                elem_types.append(self._infer_expr(elem, env))
            if not elem_types:
                return self._remember_expr(
                    node,
                    ast.FixedVectorType(ast.PrimTypeRef("any"), ast.TypeSizeConst(0)),
                )
            cur = elem_types[0]
            for nxt in elem_types[1:]:
                try:
                    cur = _promote_value_type(cur, nxt)
                except TypedIRError:
                    cur = ast.PrimTypeRef("any")
            return self._remember_expr(node, ast.FixedVectorType(cur, ast.TypeSizeConst(len(elem_types))))
        if isinstance(node, ir.TupleExpr):
            elem_types: list[Any] = []
            for elem in node.elements:
                if isinstance(elem, ir.SpliceExpr):
                    spread_t = _normalize_type(self._infer_expr(elem.expr, env))
                    if isinstance(spread_t, ast.TupleTypeExpr):
                        elem_types.extend(spread_t.elements)
                        continue
                    if isinstance(spread_t, ast.FixedVectorType):
                        size = spread_t.size.value if isinstance(spread_t.size, ast.TypeSizeConst) else None
                        if size is None:
                            raise TypedIRError("tuple spread requires a resolved source size in typed IR analysis")
                        elem_types.extend([spread_t.element_type] * size)
                        continue
                    raise TypedIRError("tuple spread requires a tuple or vector source in typed IR analysis")
                elem_types.append(self._infer_expr(elem, env))
            return self._remember_expr(node, ast.TupleTypeExpr(elem_types))
        if isinstance(node, ir.RangeExpr):
            if node.start is not None:
                start_t = _normalize_type(self._infer_expr(node.start, env))
                if not _is_scalar_numeric_type(start_t):
                    raise TypedIRError("range start must be numeric in typed IR analysis")
            if node.end is None:
                return self._remember_expr(node, ast.LinkedListValueType([ast.PrimTypeRef("num")]))
            end_t = _normalize_type(self._infer_expr(node.end, env))
            if not _is_scalar_numeric_type(end_t):
                raise TypedIRError("range end must be numeric in typed IR analysis")
            if isinstance(node.start, ir.Const) or node.start is None:
                start_value = 0 if node.start is None else node.start.value
                end_value = node.end.value if isinstance(node.end, ir.Const) else None
                if isinstance(start_value, (int, float)) and isinstance(end_value, (int, float)):
                    size = abs(int(end_value) - int(start_value)) + 1
                    return self._remember_expr(
                        node,
                        ast.FixedVectorType(ast.PrimTypeRef("num"), ast.TypeSizeConst(size)),
                    )
            return self._remember_expr(node, ast.LinkedListValueType([ast.PrimTypeRef("num")]))
        if isinstance(node, ir.PipeChainExpr):
            current_t = _normalize_type(self._infer_expr(node.source, env))
            if isinstance(current_t, AxisTaggedType):
                value_t = _normalize_type(current_t.value_type)
                if isinstance(value_t, ast.FixedVectorType):
                    elem_t = _normalize_type(value_t.element_type)
                    for seg in node.segments:
                        seg_env = dict(env)
                        seg_env["$"] = elem_t
                        elem_t = self._infer_pipe_segment(seg, seg_env)
                    return self._remember_expr(node, AxisTaggedType(ast.FixedVectorType(elem_t, value_t.size), current_t.axis_key))
            if isinstance(current_t, ast.FixedVectorType):
                elem_t = _normalize_type(current_t.element_type)
                for seg in node.segments:
                    seg_env = dict(env)
                    seg_env["$"] = elem_t
                    elem_t = self._infer_pipe_segment(seg, seg_env)
                return self._remember_expr(node, ast.FixedVectorType(elem_t, current_t.size))
            if isinstance(current_t, ast.TupleTypeExpr):
                elem_t = ast.PrimTypeRef("any")
                if current_t.elements:
                    elem_t = current_t.elements[0]
                    for inner in current_t.elements[1:]:
                        try:
                            elem_t = _promote_value_type(elem_t, inner)
                        except TypedIRError:
                            elem_t = ast.PrimTypeRef("any")
                            break
                for seg in node.segments:
                    seg_env = dict(env)
                    seg_env["$"] = elem_t
                    elem_t = self._infer_pipe_segment(seg, seg_env)
                return self._remember_expr(node, ast.TupleTypeExpr([elem_t for _ in current_t.elements]))
            seg_t = ast.PrimTypeRef("any")
            for seg in node.segments:
                seg_env = dict(env)
                seg_env["$"] = current_t
                seg_t = self._infer_pipe_segment(seg, seg_env)
            return self._remember_expr(node, seg_t)
        if isinstance(node, ir.AbsExpr):
            inner_t = _normalize_type(self._infer_expr(node.inner, env))
            if _is_scalar_numeric_type(inner_t):
                return self._remember_expr(node, ast.PrimTypeRef("num"))
            if isinstance(inner_t, (ast.FixedVectorType, ast.TupleTypeExpr, ast.LinkedListValueType)):
                return self._remember_expr(node, ast.PrimTypeRef("num"))
            raise TypedIRError("abs/norm requires a numeric scalar or 1D vector in typed IR analysis")
        if isinstance(node, ir.TypeOfExpr):
            value_t = _normalize_type(self._infer_expr(node.value, env))
            return self._remember_expr(node, value_t)
        if isinstance(node, ir.ScopeExpr):
            _nested_env, result_t = self._analyze_block_result(node.body, env, {})
            return self._remember_expr(node, result_t)
        if isinstance(node, ir.ScopeIdentityExpr):
            return self._remember_expr(node, _scope_env_type(env))
        if isinstance(node, ir.SpillExpr):
            value_t = _normalize_type(self._infer_expr(node.value, env))
            if isinstance(value_t, ast.TypeExpr):
                return self._remember_expr(node, value_t)
            if isinstance(value_t, ast.MapValueType):
                return self._remember_expr(node, ast.TypeExpr(list(value_t.fields)))
            return self._remember_expr(node, ast.PrimTypeRef("any"))
        if isinstance(node, ir.AxisAlignExpr):
            value_t = _normalize_type(self._infer_expr(node.value, env))
            key_t = _normalize_type(self._infer_expr(node.key, env))
            if not (
                (isinstance(key_t, ast.PrimTypeRef) and key_t.name == "str")
                or _is_scalar_numeric_type(key_t)
            ):
                raise TypedIRError("axis alignment requires a string or numeric axis key in typed IR analysis")
            if not isinstance(value_t, (ast.FixedVectorType, ast.MultisetType)):
                raise TypedIRError("axis alignment currently requires a fixed vector or multiset in typed IR analysis")
            axis_key = _axis_key_from_const(node.key.value) if isinstance(node.key, ir.Const) else None
            return self._remember_expr(node, AxisTaggedType(value_t, axis_key))
        if isinstance(node, ir.MapExpr):
            return self._remember_expr(
                node,
                ast.MapValueType([(name, self._infer_expr(value, env)) for name, value in node.fields]),
            )
        if isinstance(node, ir.LinkedListExpr):
            if node.spread is not None:
                spread_t = _normalize_type(self._infer_expr(node.spread, env))
                if isinstance(spread_t, ast.FixedVectorType):
                    size = spread_t.size.value if isinstance(spread_t.size, ast.TypeSizeConst) else None
                    if size is None:
                        raise TypedIRError("linked-list spread requires a resolved source size in typed IR analysis")
                    return self._remember_expr(node, ast.LinkedListValueType([spread_t.element_type] * size))
                if isinstance(spread_t, ast.LinkedListValueType):
                    return self._remember_expr(node, spread_t)
                raise TypedIRError("linked-list spread requires a vector or linked-list source in typed IR analysis")
            return self._remember_expr(node, ast.LinkedListValueType([self._infer_expr(elem, env) for elem in node.elements]))
        if isinstance(node, ir.MultisetExpr):
            if not node.pairs:
                return self._remember_expr(node, ast.MultisetType(ast.PrimTypeRef("any")))
            elem_types: list[Any] = []
            for value, count in node.pairs:
                elem_types.append(self._infer_expr(value, env))
                count_t = _normalize_type(self._infer_expr(count, env))
                if not _is_scalar_numeric_type(count_t):
                    raise TypedIRError("multiset counts must be numeric in typed IR analysis")
            cur = elem_types[0]
            for nxt in elem_types[1:]:
                cur = _promote_value_type(cur, nxt)
            return self._remember_expr(node, ast.MultisetType(cur))
        if isinstance(node, ir.StructExpr):
            return self._remember_expr(node, ast.TypeExpr([(name, self._infer_expr(value, env)) for name, value in node.fields]))
        if isinstance(node, ir.AttrExpr):
            intrinsic = resolve_native_intrinsic(node)
            intrinsic_base_is_bound = not (
                isinstance(node.value, ir.LoadName)
                and node.value.name not in env
                and intrinsic is not None
                and intrinsic.module is not None
            )
            if intrinsic is not None and intrinsic_base_is_bound:
                if intrinsic.kind == "math_const":
                    try:
                        return self._remember_expr(node, infer_intrinsic_return_type(intrinsic, []))
                    except ValueError as exc:
                        raise TypedIRError(str(exc)) from exc
                return self._remember_expr(node, StdlibFunctionType(intrinsic.module or "", intrinsic.name))
            base_t = _normalize_type(self._infer_expr(node.value, env))
            stdlib_member = self._infer_stdlib_member_type(base_t, node.name)
            if stdlib_member is not None:
                return self._remember_expr(node, stdlib_member)
            if not isinstance(base_t, ast.TypeExpr):
                if isinstance(base_t, ast.MapValueType):
                    for name, inner in base_t.fields:
                        if name == node.name:
                            return self._remember_expr(node, inner)
                    raise TypedIRError(f"missing field {node.name!r} in map value")
                if isinstance(base_t, ImportedNamespaceType):
                    return self._remember_expr(node, ImportedFunctionType(base_t.path, node.name))
                raise TypedIRError("attribute access requires a struct or map type in typed IR analysis")
            for name, inner in base_t.fields:
                if name == node.name:
                    return self._remember_expr(node, inner)
            raise TypedIRError(f"missing field {node.name!r} in struct type")
        if isinstance(node, ir.IndexExpr):
            current_t = _normalize_type(self._infer_expr(node.value, env))
            if isinstance(current_t, AxisTaggedType):
                current_t = _normalize_type(current_t.value_type)
            for idx in node.indices:
                idx_t = _normalize_type(self._infer_expr(idx, env))
                if not _is_scalar_numeric_type(idx_t):
                    raise TypedIRError("index access requires a numeric index in typed IR analysis")
                if isinstance(current_t, ast.FixedVectorType):
                    current_t = _normalize_type(current_t.element_type)
                    continue
                if isinstance(current_t, ast.TupleTypeExpr):
                    if not isinstance(idx, ir.Const) or not isinstance(idx.value, (int, float)):
                        raise TypedIRError("tuple index access requires a constant numeric index in typed IR analysis")
                    index_value = int(idx.value)
                    if idx.value != index_value:
                        raise TypedIRError("tuple index access requires an integral index in typed IR analysis")
                    if index_value < 0 or index_value >= len(current_t.elements):
                        raise TypedIRError("tuple index access is out of bounds in typed IR analysis")
                    current_t = _normalize_type(current_t.elements[index_value])
                    continue
                raise TypedIRError("index access currently requires a fixed vector type in typed IR analysis")
            return self._remember_expr(node, current_t)
        if isinstance(node, ir.UnaryExpr):
            op_t = self._infer_expr(node.operand, env)
            if node.op == "NOT":
                return self._remember_expr(node, ast.PrimTypeRef("bit"))
            return self._remember_expr(node, op_t)
        if isinstance(node, ir.BinaryExpr):
            lt = self._infer_expr(node.left, env)
            rt = self._infer_expr(node.right, env)
            lt_n = _normalize_type(lt)
            rt_n = _normalize_type(rt)
            if isinstance(lt_n, AxisTaggedType) or isinstance(rt_n, AxisTaggedType):
                return self._remember_expr(node, self._infer_axis_tagged_binary(node.op, lt_n, rt_n))
            if node.op == "AMPERSAND":
                if _is_symbolic_type(lt_n) or _is_symbolic_type(rt_n):
                    return self._remember_expr(node, ast.PrimTypeRef("symbolic"))
                if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                    if not _same_primitive_name(lt_n.element_type, rt_n.element_type):
                        raise TypedIRError("vector concat requires matching element types")
                    return self._remember_expr(node, ast.FixedVectorType(lt_n.element_type, ast.TypeSizeBinOp("PLUS", lt_n.size, rt_n.size)))
                if isinstance(lt_n, ast.LinkedListValueType) and isinstance(rt_n, ast.LinkedListValueType):
                    return self._remember_expr(node, ast.LinkedListValueType(list(lt_n.elements) + list(rt_n.elements)))
                if isinstance(lt_n, ast.PrimTypeRef) and lt_n.name == "str":
                    return self._remember_expr(node, ast.PrimTypeRef("str"))
                if isinstance(rt_n, ast.PrimTypeRef) and rt_n.name == "str":
                    return self._remember_expr(node, ast.PrimTypeRef("str"))
            if node.op in ("PLUS", "MINUS", "STAR", "SLASH", "FLOORDIV", "PERCENT", "CARET"):
                lt_n = _normalize_type(lt)
                rt_n = _normalize_type(rt)
                if _is_symbolic_type(lt_n) or _is_symbolic_type(rt_n):
                    if node.op not in ("PLUS", "MINUS", "STAR", "SLASH", "CARET"):
                        raise TypedIRError("symbolic arithmetic supports +, -, *, /, and ^ in typed IR analysis")
                    return self._remember_expr(node, ast.PrimTypeRef("symbolic"))
                if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                    if node.op not in ("PLUS", "MINUS", "STAR", "SLASH", "CARET"):
                        raise TypedIRError(f"unsupported vector op for typed IR analysis: {node.op}")
                    if not _same_primitive_name(lt_n.element_type, rt_n.element_type):
                        raise TypedIRError("vector arithmetic requires matching element types")
                    return self._remember_expr(node, lt_n)
                if node.op == "STAR":
                    if isinstance(lt_n, ast.FixedVectorType) and _is_scalar_numeric_type(rt_n):
                        return self._remember_expr(node, lt_n)
                    if isinstance(rt_n, ast.FixedVectorType) and _is_scalar_numeric_type(lt_n):
                        return self._remember_expr(node, rt_n)
                if isinstance(lt_n, ast.MultisetType) and isinstance(rt_n, ast.MultisetType):
                    if node.op not in ("PLUS", "MINUS", "FLOORDIV", "PERCENT"):
                        raise TypedIRError("multisets support +, -, //, and % count operators")
                    if not _same_type(lt_n.element_type, rt_n.element_type):
                        raise TypedIRError("multiset arithmetic requires matching element types")
                    return self._remember_expr(node, lt_n)
                return self._remember_expr(node, _promote_numeric(lt, rt))
            if node.op in ("EQ", "NEQ") and (_is_symbolic_type(lt_n) or _is_symbolic_type(rt_n)):
                return self._remember_expr(node, ast.PrimTypeRef("symbolic"))
            if node.op in ("EQ", "NEQ", "LT", "LE", "GT", "GE", "AND", "OR", "XOR"):
                return self._remember_expr(node, ast.PrimTypeRef("bit"))
            raise TypedIRError(f"unsupported binary op for typed IR analysis: {node.op}")
        if isinstance(node, ir.CallExpr):
            arg_types = [self._infer_expr(arg, env) for arg in node.args]
            kwarg_types = [(name, self._infer_expr(value, env)) for name, value in node.kwargs]
            spread_types = [self._infer_expr(value, env) for value in node.spreads]
            if isinstance(node.func, ir.LoadName):
                fname = node.func.name
                if fname in ("bit", "int", "rational", "num", "symbolic", "chr", "str"):
                    return self._remember_expr(node, ast.PrimTypeRef(fname))
                if (
                    fname == "solve"
                    and isinstance(env.get(fname), StdlibFunctionType)
                    and env[fname].module_name == "symbolic"
                    and len(node.args) >= 3
                    and _is_symbolic_type(arg_types[0])
                ):
                    fields: list[tuple[str, Any]] = []
                    for arg in node.args[1:]:
                        if isinstance(arg, (ir.LoadName, ir.LoadSlot)) and _is_symbolic_type(self._infer_expr(arg, env)):
                            fields.append((arg.name, ast.PrimTypeRef("symbolic")))
                    if len(fields) == len(node.args) - 1:
                        return self._remember_expr(node, ast.TypeExpr(fields))
                if isinstance(env.get(fname), StdlibFunctionType) and env[fname].module_name == "symbolic":
                    symbolic_return = _infer_symbolic_builtin(fname, arg_types)
                    if symbolic_return is not None:
                        return self._remember_expr(node, symbolic_return)
                if fname in self.functions:
                    ret = self.functions[fname].return_type
                    if ret is None:
                        raise TypedIRError(f"function {fname} missing return type for typed IR analysis")
                    return self._remember_expr(node, ret)
            if isinstance(node.func, ir.AttrExpr) and node.func.name == "length" and not node.args and not node.kwargs and not node.spreads:
                base_t = _normalize_type(self._infer_expr(node.func.value, env))
                if isinstance(base_t, ast.PrimTypeRef) and base_t.name in {"str"}:
                    return self._remember_expr(node, ast.PrimTypeRef("int"))
                if isinstance(base_t, (ast.FixedVectorType, ast.LinkedListValueType)):
                    return self._remember_expr(node, ast.PrimTypeRef("int"))
            intrinsic = resolve_native_intrinsic(node.func)
            intrinsic_base_is_bound = not (
                isinstance(node.func, ir.AttrExpr)
                and isinstance(node.func.value, ir.LoadName)
                and node.func.value.name not in env
                and intrinsic is not None
                and intrinsic.module is not None
            )
            if intrinsic is not None and intrinsic_base_is_bound:
                if intrinsic.kind == "math":
                    symbolic_return = _infer_symbolic_builtin(intrinsic.name, arg_types)
                    if symbolic_return is not None:
                        return self._remember_expr(node, symbolic_return)
                if intrinsic.kind == "stat" and intrinsic.name in {"sum", "mean", "median"} and len(arg_types) == 4 and any(_is_symbolic_type(t) for t in arg_types):
                    return self._remember_expr(node, ast.PrimTypeRef("symbolic"))
                axis_intrinsic_t = self._infer_axis_tagged_intrinsic(intrinsic, arg_types)
                if axis_intrinsic_t is not None:
                    return self._remember_expr(node, axis_intrinsic_t)
                try:
                    return self._remember_expr(node, infer_intrinsic_return_type(intrinsic, arg_types))
                except ValueError as exc:
                    raise TypedIRError(str(exc)) from exc
            func_t = _normalize_type(self._infer_expr(node.func, env))
            if isinstance(func_t, StdlibFunctionType):
                return self._remember_expr(node, self._infer_stdlib_call(func_t, arg_types, kwarg_types, spread_types))
            if isinstance(func_t, ImportedFunctionType):
                return self._remember_expr(node, ast.PrimTypeRef("any"))
            raise TypedIRError("unsupported call target for typed IR analysis")
        raise TypedIRError(f"unsupported typed-IR expr analysis for {type(node).__name__}")

    def _infer_pipe_segment(self, segment: Any, env: dict[str, Any]) -> Any:
        if isinstance(segment, ir.Block):
            _out_env, result_t = self._analyze_block_result(segment, env, {})
            return result_t
        return self._infer_expr(segment, env)

    def _infer_bind_target(self, target: Any, env: dict[str, Any]) -> None:
        if isinstance(target, ir.AttrExpr):
            self._infer_expr(target.value, env)
            return
        if isinstance(target, ir.IndexExpr):
            self._infer_expr(target.value, env)
            for idx in target.indices:
                self._infer_expr(idx, env)
            return
        raise TypedIRError(f"unsupported bind target {type(target).__name__}")

    def _try_update_attr_bind_env(self, target: ir.AttrExpr, value_t: Any, env: dict[str, Any]) -> None:
        root_name, keys = _attr_target_chain(target)
        if root_name is None or root_name not in env:
            return
        env[root_name] = _assign_type_path(_normalize_type(env[root_name]), keys, _normalize_type(value_t))

    def _infer_stdlib_member_type(self, base_t: Any, name: str) -> Any | None:
        if not isinstance(base_t, StdlibNamespaceType):
            return None
        module_name = base_t.module_name
        if module_name == "math":
            if name in {"pi", "e", "tau"}:
                return ast.PrimTypeRef("num")
            return StdlibFunctionType(module_name, name)
        if module_name in {"stat", "io", "collections", "time", "capture", "errors", "ui"}:
            return StdlibFunctionType(module_name, name)
        if module_name == "symbolic" and name in SYMBOLIC_STDLIB_EXPORTS:
            return StdlibFunctionType(module_name, name)
        return None

    def _infer_stdlib_call(
        self,
        func_t: StdlibFunctionType,
        arg_types: list[Any],
        kwarg_types: list[tuple[str, Any]],
        spread_types: list[Any],
    ) -> Any:
        if func_t.module_name == "collections":
            if func_t.name == "map":
                if arg_types or spread_types:
                    raise TypedIRError("collections.map alias calls only support named fields in typed IR analysis")
                return ast.MapValueType([(name, value_type) for name, value_type in kwarg_types])
            if func_t.name == "list":
                if kwarg_types:
                    raise TypedIRError("collections.list alias calls do not support named fields in typed IR analysis")
                return self._infer_collections_list_type(arg_types, spread_types)
        if func_t.module_name == "io" and func_t.name == "print":
            return ast.PrimTypeRef("any")
        if func_t.module_name == "math":
            symbolic_return = _infer_symbolic_builtin(func_t.name, arg_types)
            if symbolic_return is not None:
                return symbolic_return
        if func_t.module_name == "symbolic":
            if func_t.name == "solve" and len(arg_types) >= 3 and _is_symbolic_type(arg_types[0]):
                fields: list[tuple[str, Any]] = []
                for arg_type_index, arg_type in enumerate(arg_types[1:], start=1):
                    if _is_symbolic_type(arg_type):
                        fields.append((f"_{arg_type_index}", ast.PrimTypeRef("symbolic")))
                if len(fields) == len(arg_types) - 1:
                    return ast.TypeExpr(fields)
            symbolic_return = _infer_symbolic_builtin(func_t.name, arg_types)
            if symbolic_return is not None:
                return symbolic_return
        if func_t.module_name == "stat" and func_t.name in {"sum", "mean", "median"}:
            if len(arg_types) == 4 and any(_is_symbolic_type(t) for t in arg_types):
                return ast.PrimTypeRef("symbolic")
        intrinsic = self._stdlib_function_intrinsic(func_t)
        if intrinsic is not None:
            flat_arg_types = [*arg_types, *[value_type for _, value_type in kwarg_types], *spread_types]
            try:
                return infer_intrinsic_return_type(intrinsic, flat_arg_types)
            except ValueError as exc:
                raise TypedIRError(str(exc)) from exc
        return ast.PrimTypeRef("any")

    def _infer_collections_list_type(self, arg_types: list[Any], spread_types: list[Any]) -> Any:
        elements: list[Any] = list(arg_types)
        for spread_t in spread_types:
            spread_n = _normalize_type(spread_t)
            if isinstance(spread_n, ast.FixedVectorType):
                size = spread_n.size.value if isinstance(spread_n.size, ast.TypeSizeConst) else None
                if size is None:
                    raise TypedIRError("collections.list spread requires a resolved source size in typed IR analysis")
                elements.extend([spread_n.element_type] * size)
                continue
            if isinstance(spread_n, ast.LinkedListValueType):
                elements.extend(spread_n.elements)
                continue
            raise TypedIRError("collections.list spread requires a vector or linked-list source in typed IR analysis")
        return ast.LinkedListValueType(elements)

    def _stdlib_function_intrinsic(self, func_t: StdlibFunctionType) -> NativeIntrinsic | None:
        if func_t.module_name == "math":
            if func_t.name in {"pi", "e", "tau"}:
                return NativeIntrinsic("math", func_t.name, "math_const")
            return NativeIntrinsic("math", func_t.name, "math")
        if func_t.module_name == "stat":
            return NativeIntrinsic("stat", func_t.name, "stat")
        return None

    def _infer_axis_tagged_binary(self, op: str, left_t: Any, right_t: Any) -> Any:
        if isinstance(left_t, AxisTaggedType) and isinstance(right_t, AxisTaggedType):
            left_inner = _normalize_type(left_t.value_type)
            right_inner = _normalize_type(right_t.value_type)
            if left_t.axis_key == right_t.axis_key:
                if isinstance(left_inner, ast.FixedVectorType) and isinstance(right_inner, ast.FixedVectorType):
                    if op not in ("PLUS", "MINUS", "STAR", "SLASH", "CARET"):
                        raise TypedIRError(f"unsupported vector op for axis-tagged typed IR analysis: {op}")
                    elem_t = _promote_numeric(left_inner.element_type, right_inner.element_type)
                    return AxisTaggedType(
                        ast.FixedVectorType(elem_t, left_inner.size),
                        left_t.axis_key,
                    )
                if isinstance(left_inner, ast.MultisetType) and isinstance(right_inner, ast.MultisetType):
                    if op not in ("PLUS", "MINUS", "FLOOR_DIV", "PERCENT"):
                        raise TypedIRError("axis-tagged multisets support +, -, //, and % count operators")
                    if not _same_type(left_inner.element_type, right_inner.element_type):
                        raise TypedIRError("axis-tagged multiset arithmetic requires matching element types")
                    return AxisTaggedType(left_inner, left_t.axis_key)
                raise TypedIRError("same-axis tagged arithmetic currently requires matching vectors or multisets in typed IR analysis")
            if isinstance(left_inner, ast.FixedVectorType) and isinstance(right_inner, ast.FixedVectorType):
                if op not in ("PLUS", "MINUS", "STAR", "SLASH", "CARET"):
                    raise TypedIRError(f"unsupported disjoint-axis vector op for typed IR analysis: {op}")
                elem_t = _promote_numeric(left_inner.element_type, right_inner.element_type)
                nested = ast.FixedVectorType(
                    ast.FixedVectorType(elem_t, right_inner.size),
                    left_inner.size,
                )
                return AxisTaggedType(nested, _axis_concat_key(left_t.axis_key, right_t.axis_key))
            raise TypedIRError("disjoint-axis tagged arithmetic currently requires fixed vectors in typed IR analysis")
        if isinstance(left_t, AxisTaggedType) and _is_scalar_numeric_type(right_t):
            left_inner = _normalize_type(left_t.value_type)
            if isinstance(left_inner, ast.FixedVectorType) and op in ("PLUS", "MINUS", "STAR", "SLASH", "FLOOR_DIV", "PERCENT", "CARET"):
                return AxisTaggedType(left_inner, left_t.axis_key)
            raise TypedIRError("axis-tagged scalar arithmetic currently requires a fixed vector in typed IR analysis")
        if isinstance(right_t, AxisTaggedType) and _is_scalar_numeric_type(left_t):
            right_inner = _normalize_type(right_t.value_type)
            if isinstance(right_inner, ast.FixedVectorType) and op in ("PLUS", "MINUS", "STAR", "SLASH", "FLOOR_DIV", "PERCENT", "CARET"):
                return AxisTaggedType(right_inner, right_t.axis_key)
            raise TypedIRError("axis-tagged scalar arithmetic currently requires a fixed vector in typed IR analysis")
        raise TypedIRError("cannot mix axis-tagged and untagged operands in typed IR analysis")

    def _infer_axis_tagged_intrinsic(self, intrinsic: NativeIntrinsic, arg_types: list[Any]) -> Any | None:
        intrinsic_label = f"{intrinsic.module}.{intrinsic.name}" if intrinsic.module else intrinsic.name
        if intrinsic.kind != "math":
            return None
        if intrinsic.name in {"atan2", "log"}:
            return None
        if len(arg_types) != 1:
            return None
        arg_t = _normalize_type(arg_types[0])
        if not isinstance(arg_t, AxisTaggedType):
            return None
        inner = _normalize_type(arg_t.value_type)
        if not isinstance(inner, ast.FixedVectorType):
            raise TypedIRError(f"{intrinsic_label} axis-tagged intrinsic currently requires a fixed vector")
        if not _is_scalar_numeric_type(inner.element_type):
            raise TypedIRError(f"{intrinsic_label} axis-tagged intrinsic currently requires numeric vector elements")
        return AxisTaggedType(ast.FixedVectorType(ast.PrimTypeRef("num"), inner.size), arg_t.axis_key)


def _attr_target_chain(target: ir.AttrExpr) -> tuple[str | None, list[str]]:
    keys: list[str] = []
    cur: Any = target
    while isinstance(cur, ir.AttrExpr):
        keys.append(cur.name)
        cur = cur.value
    if not isinstance(cur, (ir.LoadName, ir.LoadSlot)):
        return None, list(reversed(keys))
    keys.reverse()
    return cur.name, keys


def _assign_type_path(container_t: Any, keys: list[str], value_t: Any) -> Any:
    if not keys:
        return value_t
    if isinstance(container_t, ast.TypeExpr):
        fields = list(container_t.fields)
        head = keys[0]
        for idx, (name, child_t) in enumerate(fields):
            if name == head:
                fields[idx] = (name, _assign_type_path(_normalize_type(child_t), keys[1:], value_t))
                return ast.TypeExpr(fields)
        fields.append((head, _assign_type_path(ast.PrimTypeRef("any"), keys[1:], value_t)))
        return ast.TypeExpr(fields)
    if isinstance(container_t, ast.MapValueType):
        fields = list(container_t.fields)
        head = keys[0]
        for idx, (name, child_t) in enumerate(fields):
            if name == head:
                fields[idx] = (name, _assign_type_path(_normalize_type(child_t), keys[1:], value_t))
                return ast.MapValueType(fields)
        fields.append((head, _assign_type_path(ast.PrimTypeRef("any"), keys[1:], value_t)))
        return ast.MapValueType(fields)
    return container_t


def annotate_module(module: ir.Module) -> TypedModuleInfo:
    return IRTypeAnalyzer(module).analyze()
