"""Small IR executor used to validate lowered semantics against the AST interpreter."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import EvalError
from .interpreter import _binop, _stringify
from .runtime import make_multiset, make_vflist, make_vmap
from .runtime.type_values import PrimType, coerce_typed_value, is_type_value, resolve_return_type
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
            return None
        if isinstance(node, ir.StoreSlot):
            val = self.eval_expr(node.value, env)
            if node.declared_type is not None:
                val, _ = coerce_typed_value(val, node.declared_type, self.types)
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
                list(node.param_types),
                node.return_type,
            )
            fn.closure[node.name] = fn
            env[node.name] = fn
            return None
        if isinstance(node, ir.ExprStmt):
            return self.eval_expr(node.expr, env)
        if isinstance(node, ir.PrintStmt):
            value = self.eval_expr(node.value, env)
            print(_stringify(value, self.types))
            return None
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
        if isinstance(node, ir.LoadName):
            return self._resolve(node.name, env)
        if isinstance(node, ir.LoadSlot):
            return self._resolve(node.name, env)
        if isinstance(node, ir.CallExpr):
            fn = self.eval_expr(node.func, env)
            args = [self.eval_expr(a, env) for a in node.args]
            return self._call(fn, args)
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
            if isinstance(base, dict):
                if node.name not in base:
                    raise EvalError(f"missing field {node.name!r}")
                return base[node.name]
            if hasattr(base, "items") and hasattr(base, "get") and hasattr(base, "__contains__"):
                if node.name not in base:
                    raise EvalError(f"missing field {node.name!r}")
                return base.get(node.name)
            raise EvalError("attribute access on non-struct")
        if isinstance(node, ir.IndexExpr):
            base = self.eval_expr(node.value, env)
            for idx in node.indices:
                key = self.eval_expr(idx, env)
                if isinstance(base, (list, tuple, str)):
                    base = base[int(key)]
                    continue
                raise EvalError("index access on unsupported IR value")
            return base
        if isinstance(node, ir.CoerceExpr):
            value = self.eval_expr(node.expr, env)
            value, _ = coerce_typed_value(value, node.target_type, self.types)
            return value
        if isinstance(node, ir.UnaryExpr):
            operand = self.eval_expr(node.operand, env)
            if node.op == "MINUS":
                return -operand
            if node.op == "NOT":
                return not bool(operand)
            raise EvalError(f"unsupported IR unary op: {node.op}")
        if isinstance(node, ir.BinaryExpr):
            left = self.eval_expr(node.left, env)
            right = self.eval_expr(node.right, env)
            return _binop(node.op, left, right)
        raise EvalError(f"unknown IR expr {type(node).__name__}")

    def _call(self, fn: Any, args: list[Any]) -> Any:
        if isinstance(fn, IRFunctionValue):
            loc = dict(fn.closure)
            size_bindings: dict[str, int] = {}
            for name, arg, declared_type in zip(fn.params, args, fn.param_types):
                if declared_type is not None:
                    arg, size_bindings = coerce_typed_value(arg, declared_type, self.types, size_bindings)
                loc[name] = arg
            try:
                result = self.eval_block_result(fn.body, loc)
            except IRReturnSignal as r:
                result = r.value
            if fn.return_type is not None:
                resolved_return = resolve_return_type(fn.return_type, size_bindings)
                result, _ = coerce_typed_value(result, resolved_return, self.types, size_bindings)
            return result
        if callable(fn):
            return fn(*args)
        raise EvalError(f"not callable: {type(fn).__name__}")

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
