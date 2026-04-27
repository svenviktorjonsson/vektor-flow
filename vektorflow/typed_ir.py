from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import ast, ir
from .native_intrinsics import infer_intrinsic_return_type, resolve_native_intrinsic


class TypedIRError(Exception):
    pass


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
    if a.name == "num" or b.name == "num":
        return ast.PrimTypeRef("num")
    if a.name == "int" and b.name == "int":
        return ast.PrimTypeRef("int")
    if a.name == "bool" and b.name == "bool":
        return ast.PrimTypeRef("bool")
    if {a.name, b.name} <= {"bool", "int"}:
        return ast.PrimTypeRef("int")
    raise TypedIRError(f"unsupported numeric promotion {a.name} vs {b.name}")


def _same_primitive_name(a: Any, b: Any) -> bool:
    a = _normalize_type(a)
    b = _normalize_type(b)
    return isinstance(a, ast.PrimTypeRef) and isinstance(b, ast.PrimTypeRef) and a.name == b.name


def _is_scalar_numeric_type(t: Any) -> bool:
    t = _normalize_type(t)
    return isinstance(t, ast.PrimTypeRef) and t.name in {"bool", "int", "num"}


def _same_type(a: Any, b: Any) -> bool:
    return _normalize_type(a) == _normalize_type(b)


def _promote_value_type(a: Any, b: Any) -> Any:
    a_n = _normalize_type(a)
    b_n = _normalize_type(b)
    if isinstance(a_n, ast.PrimTypeRef) and isinstance(b_n, ast.PrimTypeRef):
        return _promote_numeric(a_n, b_n)
    if _same_type(a_n, b_n):
        return a_n
    raise TypedIRError(f"unsupported value-type promotion {type(a_n).__name__} vs {type(b_n).__name__}")


class IRTypeAnalyzer:
    def __init__(self, module: ir.Module) -> None:
        self.module = module
        self.functions = {stmt.name: stmt for stmt in module.statements if isinstance(stmt, ir.FunctionDef)}
        self.info = TypedModuleInfo()

    def analyze(self) -> TypedModuleInfo:
        env: dict[str, Any] = {}
        module_slots: dict[str, int] = {}
        for stmt in self.module.statements:
            if isinstance(stmt, ir.FunctionDef):
                self._analyze_function(stmt)
            else:
                env = self._analyze_stmt(stmt, env, module_slots)
        self.info.module_slots = dict(module_slots)
        return self.info

    def _analyze_function(self, fn: ir.FunctionDef) -> None:
        env = {
            name: _normalize_type(ptype)
            for name, ptype in zip(fn.params, fn.param_types)
            if ptype is not None
        }
        slots = {name: idx for idx, name in enumerate(fn.params)}
        self.info.function_envs[fn.name] = dict(env)
        cur = dict(env)
        for stmt in fn.body.statements:
            cur = self._analyze_stmt(stmt, cur, slots)
        self.info.function_slots[fn.name] = dict(slots)

    def _record_stmt_env(self, stmt: Any, env: dict[str, Any], out_env: dict[str, Any]) -> None:
        self.info.stmt_input_envs[id(stmt)] = dict(env)
        self.info.stmt_output_envs[id(stmt)] = dict(out_env)

    def _analyze_stmt(self, stmt: Any, env: dict[str, Any], slots: dict[str, int]) -> dict[str, Any]:
        cur = dict(env)
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
        if isinstance(stmt, ir.PrintStmt):
            self._infer_expr(stmt.value, cur)
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
                return self._remember_expr(node, ast.PrimTypeRef("bool"))
            if node.value is None:
                raise TypedIRError("null is not yet supported in typed IR analysis for native emission")
            if isinstance(node.value, (int, float)):
                return self._remember_expr(node, ast.PrimTypeRef("num"))
            if isinstance(node.value, str):
                return self._remember_expr(node, ast.PrimTypeRef("str"))
            raise TypedIRError(f"unsupported constant type {type(node.value).__name__}")
        if isinstance(node, ir.LoadName):
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
        if isinstance(node, ir.ListExpr):
            if not node.elements:
                raise TypedIRError("empty list literals are not yet supported in typed IR analysis")
            elem_types = [self._infer_expr(elem, env) for elem in node.elements]
            cur = elem_types[0]
            for nxt in elem_types[1:]:
                cur = _promote_numeric(cur, nxt)
            return self._remember_expr(node, ast.FixedVectorType(cur, ast.TypeSizeConst(len(node.elements))))
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
                raise TypedIRError("empty multiset literals are not yet supported in typed IR analysis")
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
            if intrinsic is not None:
                try:
                    return self._remember_expr(node, infer_intrinsic_return_type(intrinsic, []))
                except ValueError as exc:
                    raise TypedIRError(str(exc)) from exc
            base_t = _normalize_type(self._infer_expr(node.value, env))
            if not isinstance(base_t, ast.TypeExpr):
                if isinstance(base_t, ast.MapValueType):
                    for name, inner in base_t.fields:
                        if name == node.name:
                            return self._remember_expr(node, inner)
                    raise TypedIRError(f"missing field {node.name!r} in map value")
                raise TypedIRError("attribute access requires a struct or map type in typed IR analysis")
            for name, inner in base_t.fields:
                if name == node.name:
                    return self._remember_expr(node, inner)
            raise TypedIRError(f"missing field {node.name!r} in struct type")
        if isinstance(node, ir.IndexExpr):
            current_t = _normalize_type(self._infer_expr(node.value, env))
            for idx in node.indices:
                idx_t = _normalize_type(self._infer_expr(idx, env))
                if not _is_scalar_numeric_type(idx_t):
                    raise TypedIRError("index access requires a numeric index in typed IR analysis")
                if isinstance(current_t, ast.FixedVectorType):
                    current_t = _normalize_type(current_t.element_type)
                    continue
                raise TypedIRError("index access currently requires a fixed vector type in typed IR analysis")
            return self._remember_expr(node, current_t)
        if isinstance(node, ir.UnaryExpr):
            op_t = self._infer_expr(node.operand, env)
            if node.op == "NOT":
                return self._remember_expr(node, ast.PrimTypeRef("bool"))
            return self._remember_expr(node, op_t)
        if isinstance(node, ir.BinaryExpr):
            lt = self._infer_expr(node.left, env)
            rt = self._infer_expr(node.right, env)
            if node.op == "AMPERSAND":
                lt_n = _normalize_type(lt)
                rt_n = _normalize_type(rt)
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
            if node.op in ("PLUS", "MINUS", "STAR", "SLASH", "PERCENT", "CARET"):
                lt_n = _normalize_type(lt)
                rt_n = _normalize_type(rt)
                if isinstance(lt_n, ast.FixedVectorType) and isinstance(rt_n, ast.FixedVectorType):
                    if node.op not in ("PLUS", "MINUS", "STAR", "SLASH"):
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
                    if node.op not in ("PLUS", "MINUS", "STAR", "SLASH"):
                        raise TypedIRError(f"unsupported multiset op for typed IR analysis: {node.op}")
                    if not _same_type(lt_n.element_type, rt_n.element_type):
                        raise TypedIRError("multiset arithmetic requires matching element types")
                    return self._remember_expr(node, lt_n)
                return self._remember_expr(node, _promote_numeric(lt, rt))
            if node.op in ("EQ", "NEQ", "LT", "LE", "GT", "GE", "AND", "OR", "XOR"):
                return self._remember_expr(node, ast.PrimTypeRef("bool"))
            raise TypedIRError(f"unsupported binary op for typed IR analysis: {node.op}")
        if isinstance(node, ir.CallExpr):
            arg_types = [self._infer_expr(arg, env) for arg in node.args]
            if isinstance(node.func, ir.LoadName):
                fname = node.func.name
                if fname in ("int", "num", "bool", "str"):
                    return self._remember_expr(node, ast.PrimTypeRef(fname))
                if fname in self.functions:
                    ret = self.functions[fname].return_type
                    if ret is None:
                        raise TypedIRError(f"function {fname} missing return type for typed IR analysis")
                    return self._remember_expr(node, ret)
            intrinsic = resolve_native_intrinsic(node.func)
            if intrinsic is not None:
                try:
                    return self._remember_expr(node, infer_intrinsic_return_type(intrinsic, arg_types))
                except ValueError as exc:
                    raise TypedIRError(str(exc)) from exc
            raise TypedIRError("unsupported call target for typed IR analysis")
        raise TypedIRError(f"unsupported typed-IR expr analysis for {type(node).__name__}")


def annotate_module(module: ir.Module) -> TypedModuleInfo:
    return IRTypeAnalyzer(module).analyze()
