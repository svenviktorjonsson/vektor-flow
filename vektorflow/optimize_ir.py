from __future__ import annotations

import re
from typing import Any

from . import ast, ir
from .typed_ir import TypedModuleInfo
from .stdlib.events import event_match_specificity


def _load_name(node: Any) -> str | None:
    if isinstance(node, (ir.LoadName, ir.LoadSlot)):
        return node.name
    return None


def _store_name(node: Any) -> str | None:
    if isinstance(node, (ir.StoreName, ir.StoreSlot)):
        return node.name
    return None


def _const_binop(op: str, left: Any, right: Any) -> Any:
    if op == "PLUS":
        return left + right
    if op == "MINUS":
        return left - right
    if op == "STAR":
        return left * right
    if op == "SLASH":
        return left / right
    if op == "PERCENT":
        return left % right
    if op == "CARET":
        return left**right
    if op == "EQ":
        return left == right
    if op == "NEQ":
        return left != right
    if op == "LT":
        return left < right
    if op == "LE":
        return left <= right
    if op == "GT":
        return left > right
    if op == "GE":
        return left >= right
    if op == "AND":
        return bool(left) and bool(right)
    if op == "OR":
        return bool(left) or bool(right)
    if op == "XOR":
        return bool(left) != bool(right)
    if op == "AMPERSAND":
        return left + right
    raise ValueError(op)


def _const_cast(name: str, value: Any) -> Any:
    if name == "int":
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, (int, float)) and float(value).is_integer():
            return int(value)
        raise ValueError(name)
    if name == "num":
        if isinstance(value, bool):
            return 1.0 if value else 0.0
        if isinstance(value, (int, float)):
            return float(value)
        raise ValueError(name)
    if name == "str":
        if isinstance(value, str):
            return value
        raise ValueError(name)
    if name == "bool":
        if isinstance(value, bool):
            return value
        raise ValueError(name)
    raise ValueError(name)


def _match_specificity(a: Any, b: Any) -> int | None:
    if isinstance(a, int) and isinstance(b, int):
        s = event_match_specificity(a, b)
        if s is not None:
            return s
        s = event_match_specificity(b, a)
        if s is not None:
            return s
        return None
    return 0 if a == b else None


def _expr_is_pure(node: Any) -> bool:
    if isinstance(node, ir.Const) or _load_name(node) is not None:
        return True
    if isinstance(node, ir.InterpolatedStringExpr):
        return False
    if isinstance(node, ir.UnaryExpr):
        return _expr_is_pure(node.operand)
    if isinstance(node, ir.BinaryExpr):
        return _expr_is_pure(node.left) and _expr_is_pure(node.right)
    if isinstance(node, ir.ListExpr):
        return all(_expr_is_pure(e) for e in node.elements)
    if isinstance(node, ir.TupleExpr):
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
    if isinstance(node, ir.RangeExpr):
        return (node.start is None or _expr_is_pure(node.start)) and (node.end is None or _expr_is_pure(node.end))
    if isinstance(node, ir.PipeChainExpr):
        return False
    if isinstance(node, (ir.AbsExpr, ir.TypeOfExpr)):
        return _expr_is_pure(node.inner if isinstance(node, ir.AbsExpr) else node.value)
    if isinstance(node, (ir.ScopeExpr, ir.ScopeIdentityExpr, ir.SpillExpr)):
        return False
    if isinstance(node, ir.CoerceExpr):
        return _expr_is_pure(node.expr)
    if isinstance(node, ir.BindExpr):
        return False
    if isinstance(node, ir.CallExpr):
        return (
            isinstance(node.func, ir.LoadName)
            and node.func.name in {"int", "num", "bool", "str"}
            and all(_expr_is_pure(a) for a in node.args)
        )
    return False


def _expr_loads(node: Any) -> set[str]:
    if isinstance(node, ir.Const):
        return set()
    if isinstance(node, ir.InterpolatedStringExpr):
        return _interpolated_string_loads(node.template)
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
        return used
    if isinstance(node, ir.ListExpr):
        used: set[str] = set()
        for e in node.elements:
            if isinstance(e, ir.SpliceExpr):
                used |= _expr_loads(e.expr)
                continue
            used |= _expr_loads(e)
        return used
    if isinstance(node, ir.TupleExpr):
        used: set[str] = set()
        for e in node.elements:
            if isinstance(e, ir.SpliceExpr):
                used |= _expr_loads(e.expr)
                continue
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
    if isinstance(node, ir.RangeExpr):
        used: set[str] = set()
        if node.start is not None:
            used |= _expr_loads(node.start)
        if node.end is not None:
            used |= _expr_loads(node.end)
        return used
    if isinstance(node, ir.PipeChainExpr):
        used = _expr_loads(node.source)
        for seg in node.segments:
            if isinstance(seg, ir.Block):
                for stmt in seg.statements:
                    used |= _stmt_loads(stmt)
            else:
                used |= _expr_loads(seg)
        return used
    if isinstance(node, ir.AbsExpr):
        return _expr_loads(node.inner)
    if isinstance(node, ir.TypeOfExpr):
        return _expr_loads(node.value)
    if isinstance(node, ir.ScopeExpr):
        used: set[str] = set()
        for stmt in node.body.statements:
            used |= _stmt_loads(stmt)
        return used
    if isinstance(node, ir.ScopeIdentityExpr):
        return set()
    if isinstance(node, ir.SpillExpr):
        return _expr_loads(node.value)
    if isinstance(node, ir.CoerceExpr):
        return _expr_loads(node.expr)
    if isinstance(node, ir.BindExpr):
        return _expr_loads(node.target) | _expr_loads(node.value)
    return set()


def _interpolated_string_loads(template: str) -> set[str]:
    from .parser import parse_expression

    used: set[str] = set()
    i = 0
    n = len(template)
    while i < n:
        if template[i] == "\\" and i + 1 < n and template[i + 1] == "$":
            i += 2
            continue
        if template[i] != "$":
            i += 1
            continue
        if i + 1 < n and template[i + 1] == "(":
            depth = 1
            j = i + 2
            start = j
            while j < n and depth:
                if template[j] == "(":
                    depth += 1
                elif template[j] == ")":
                    depth -= 1
                j += 1
            if depth != 0:
                return used
            inner = template[start : j - 1].strip()
            if inner:
                try:
                    used |= _expr_loads(ir.lower_expr(parse_expression(inner, filename="<opt-ir-interp>")))
                except Exception:
                    return used
            i = j
            if i < n and template[i] == ".":
                fmt = re.match(r"(\d*[a-zA-Z]+)", template[i + 1 :])
                if fmt:
                    i += 1 + len(fmt.group(1))
            continue
        j = i + 1
        if j >= n or not (template[j].isalpha() or template[j] == "_"):
            i += 1
            continue
        j += 1
        while j < n and (template[j].isalnum() or template[j] == "_"):
            j += 1
        expr = template[i + 1 : j]
        while j < n and template[j] == ".":
            rest = template[j + 1 :]
            field = re.match(r"^([a-zA-Z_][\w]*)", rest)
            fmt = re.match(r"^(\d*[a-zA-Z]+)", rest)
            if field:
                expr += "." + field.group(1)
                j += 1 + field.end()
                continue
            if fmt:
                j += 1 + fmt.end()
                break
            break
        try:
            used |= _expr_loads(ir.lower_expr(parse_expression(expr, filename="<opt-ir-interp>")))
        except Exception:
            return used
        i = j
    return used


def _forward_name_into_stmt(stmt: Any, name: str, value: Any) -> Any | None:
    if isinstance(stmt, ir.ExprStmt) and _load_name(stmt.expr) == name:
        return ir.ExprStmt(value)
    if isinstance(stmt, ir.PrintStmt) and _load_name(stmt.value) == name:
        return ir.PrintStmt(value)
    if isinstance(stmt, ir.LabelPrintStmt) and _load_name(stmt.value) == name:
        return ir.LabelPrintStmt(stmt.expr_text, value)
    if isinstance(stmt, ir.ReturnStmt) and stmt.value is not None and _load_name(stmt.value) == name:
        return ir.ReturnStmt(value)
    return None


def _stmt_loads(node: Any) -> set[str]:
    if isinstance(node, ir.ModuleImportStmt):
        return set()
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
            if node.op == "MINUS":
                return ir.Const(-operand.value)
            if node.op == "NOT":
                return ir.Const(not bool(operand.value))
        return ir.UnaryExpr(node.op, operand)
    if isinstance(node, ir.BinaryExpr):
        left = fold_expr(node.left)
        right = fold_expr(node.right)
        if isinstance(left, ir.Const) and isinstance(right, ir.Const):
            return ir.Const(_const_binop(node.op, left.value, right.value))
        return ir.BinaryExpr(node.op, left, right)
    if isinstance(node, ir.CallExpr):
        func = fold_expr(node.func)
        args = [fold_expr(a) for a in node.args]
        if (
            isinstance(func, ir.LoadName)
            and len(args) == 1
            and isinstance(args[0], ir.Const)
            and func.name in {"int", "num", "bool", "str"}
        ):
            try:
                return ir.Const(_const_cast(func.name, args[0].value))
            except ValueError:
                pass
        return ir.CallExpr(func, args)
    if isinstance(node, ir.ListExpr):
        folded: list[Any] = []
        for e in node.elements:
            if isinstance(e, ir.SpliceExpr):
                folded.append(ir.SpliceExpr(fold_expr(e.expr)))
                continue
            folded.append(fold_expr(e))
        return ir.ListExpr(folded)
    if isinstance(node, ir.TupleExpr):
        folded: list[Any] = []
        for e in node.elements:
            if isinstance(e, ir.SpliceExpr):
                folded.append(ir.SpliceExpr(fold_expr(e.expr)))
                continue
            folded.append(fold_expr(e))
        return ir.TupleExpr(folded)
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
        if isinstance(value, ir.StructExpr):
            for name, inner in value.fields:
                if name == node.name:
                    return inner
        return ir.AttrExpr(value, node.name)
    if isinstance(node, ir.IndexExpr):
        return ir.IndexExpr(fold_expr(node.value), [fold_expr(idx) for idx in node.indices])
    if isinstance(node, ir.RangeExpr):
        return ir.RangeExpr(
            None if node.start is None else fold_expr(node.start),
            None if node.end is None else fold_expr(node.end),
        )
    if isinstance(node, ir.PipeChainExpr):
        folded_segments: list[Any] = []
        for seg in node.segments:
            if isinstance(seg, ir.Block):
                folded_segments.append(optimize_block(seg, allow_dead_store_elimination=False))
            else:
                folded_segments.append(fold_expr(seg))
        return ir.PipeChainExpr(fold_expr(node.source), folded_segments)
    if isinstance(node, ir.AbsExpr):
        return ir.AbsExpr(fold_expr(node.inner))
    if isinstance(node, ir.TypeOfExpr):
        return ir.TypeOfExpr(fold_expr(node.value))
    if isinstance(node, ir.ScopeExpr):
        return ir.ScopeExpr(optimize_block(node.body, allow_dead_store_elimination=False))
    if isinstance(node, ir.ScopeIdentityExpr):
        return node
    if isinstance(node, ir.SpillExpr):
        return ir.SpillExpr(fold_expr(node.value))
    if isinstance(node, ir.CoerceExpr):
        expr = fold_expr(node.expr)
        if isinstance(expr, ir.CoerceExpr) and expr.target_type == node.target_type:
            return expr
        if isinstance(node.target_type, ast.PrimTypeRef) and isinstance(expr, ir.Const):
            try:
                return ir.Const(_const_cast(node.target_type.name, expr.value))
            except ValueError:
                pass
        return ir.CoerceExpr(expr, node.target_type)
    if isinstance(node, ir.BindExpr):
        return ir.BindExpr(fold_expr(node.target), fold_expr(node.value))
    return node


def optimize_stmt(node: Any) -> list[Any]:
    if isinstance(node, ir.TypeDef):
        return [node]
    if isinstance(node, ir.ModuleImportStmt):
        return [node]
    if isinstance(node, ir.StoreName):
        return [ir.StoreName(node.name, fold_expr(node.value), node.declared_type)]
    if isinstance(node, ir.StoreSlot):
        return [ir.StoreSlot(node.slot, node.name, fold_expr(node.value), node.declared_type)]
    if isinstance(node, ir.PrintStmt):
        return [ir.PrintStmt(fold_expr(node.value))]
    if isinstance(node, ir.LabelPrintStmt):
        return [ir.LabelPrintStmt(node.expr_text, fold_expr(node.value))]
    if isinstance(node, ir.SpillStmt):
        return [ir.SpillStmt(fold_expr(node.value))]
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
            return body.statements if bool(cond.value) else []
        return [ir.IfStmt(cond, body)]
    if isinstance(node, ir.WhileStmt):
        cond = fold_expr(node.condition)
        body = optimize_block(node.body, allow_dead_store_elimination=False)
        if isinstance(cond, ir.Const) and not bool(cond.value):
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
            best_arm: ir.MatchArm | None = None
            best_spec = -1
            default_arm: ir.MatchArm | None = None
            for arm in arms:
                if arm.condition is None:
                    if default_arm is None:
                        default_arm = arm
                    continue
                if isinstance(arm.condition, ir.Const):
                    spec = _match_specificity(disc.value, arm.condition.value)
                    if spec is not None and spec > best_spec:
                        best_spec = spec
                        best_arm = arm
            chosen = best_arm if best_arm is not None else default_arm
            if chosen is None:
                return []
            return chosen.body.statements
        return [ir.MatchStmt(disc, arms, loop=node.loop)]
    if isinstance(node, ir.FunctionDef):
        return [ir.FunctionDef(node.name, list(node.params), optimize_block(node.body), list(node.param_types), node.return_type)]
    raise TypeError(type(node).__name__)


def _has_dynamic_scope_dependency_expr(node: Any) -> bool:
    if isinstance(node, (ir.ScopeIdentityExpr, ir.ScopeExpr)):
        return True
    if isinstance(node, ir.SpillExpr):
        return _has_dynamic_scope_dependency_expr(node.value)
    if isinstance(node, ir.PipeChainExpr):
        return True
    if isinstance(node, ir.UnaryExpr):
        return _has_dynamic_scope_dependency_expr(node.operand)
    if isinstance(node, ir.BinaryExpr):
        return _has_dynamic_scope_dependency_expr(node.left) or _has_dynamic_scope_dependency_expr(node.right)
    if isinstance(node, ir.CallExpr):
        return (
            _has_dynamic_scope_dependency_expr(node.func)
            or any(_has_dynamic_scope_dependency_expr(arg) for arg in node.args)
            or any(_has_dynamic_scope_dependency_expr(value) for _, value in node.kwargs)
            or any(_has_dynamic_scope_dependency_expr(spread) for spread in node.spreads)
        )
    if isinstance(node, (ir.ListExpr, ir.TupleExpr)):
        return any(
            _has_dynamic_scope_dependency_expr(e.expr) if isinstance(e, ir.SpliceExpr) else _has_dynamic_scope_dependency_expr(e)
            for e in node.elements
        )
    if isinstance(node, ir.MultisetExpr):
        return any(_has_dynamic_scope_dependency_expr(value) or _has_dynamic_scope_dependency_expr(count) for value, count in node.pairs)
    if isinstance(node, (ir.MapExpr, ir.StructExpr)):
        return any(_has_dynamic_scope_dependency_expr(value) for _, value in node.fields)
    if isinstance(node, ir.LinkedListExpr):
        return any(_has_dynamic_scope_dependency_expr(e) for e in node.elements) or (
            node.spread is not None and _has_dynamic_scope_dependency_expr(node.spread)
        )
    if isinstance(node, ir.AttrExpr):
        return _has_dynamic_scope_dependency_expr(node.value)
    if isinstance(node, ir.IndexExpr):
        return _has_dynamic_scope_dependency_expr(node.value) or any(_has_dynamic_scope_dependency_expr(idx) for idx in node.indices)
    if isinstance(node, ir.RangeExpr):
        return (node.start is not None and _has_dynamic_scope_dependency_expr(node.start)) or (
            node.end is not None and _has_dynamic_scope_dependency_expr(node.end)
        )
    if isinstance(node, ir.AbsExpr):
        return _has_dynamic_scope_dependency_expr(node.inner)
    if isinstance(node, ir.TypeOfExpr):
        return _has_dynamic_scope_dependency_expr(node.value)
    if isinstance(node, ir.CoerceExpr):
        return _has_dynamic_scope_dependency_expr(node.expr)
    if isinstance(node, ir.BindExpr):
        return _has_dynamic_scope_dependency_expr(node.target) or _has_dynamic_scope_dependency_expr(node.value)
    return False


def _has_dynamic_scope_dependency_stmt(stmt: Any) -> bool:
    if isinstance(stmt, ir.SpillStmt):
        return True
    if isinstance(stmt, (ir.StoreName, ir.StoreSlot)):
        return _has_dynamic_scope_dependency_expr(stmt.value)
    if isinstance(stmt, ir.PrintStmt):
        return _has_dynamic_scope_dependency_expr(stmt.value)
    if isinstance(stmt, ir.LabelPrintStmt):
        return _has_dynamic_scope_dependency_expr(stmt.value)
    if isinstance(stmt, ir.ExprStmt):
        return _has_dynamic_scope_dependency_expr(stmt.expr)
    if isinstance(stmt, ir.ReturnStmt):
        return stmt.value is not None and _has_dynamic_scope_dependency_expr(stmt.value)
    if isinstance(stmt, ir.IfStmt):
        return _has_dynamic_scope_dependency_expr(stmt.condition) or any(
            _has_dynamic_scope_dependency_stmt(sub) for sub in stmt.body.statements
        )
    if isinstance(stmt, ir.WhileStmt):
        return _has_dynamic_scope_dependency_expr(stmt.condition) or any(
            _has_dynamic_scope_dependency_stmt(sub) for sub in stmt.body.statements
        )
    if isinstance(stmt, ir.MatchStmt):
        return _has_dynamic_scope_dependency_expr(stmt.discriminant) or any(
            (arm.condition is not None and _has_dynamic_scope_dependency_expr(arm.condition))
            or any(_has_dynamic_scope_dependency_stmt(sub) for sub in arm.body.statements)
            for arm in stmt.arms
        )
    if isinstance(stmt, ir.FunctionDef):
        return any(_has_dynamic_scope_dependency_stmt(sub) for sub in stmt.body.statements)
    return False


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
    if not allow_dead_store_elimination or any(_has_dynamic_scope_dependency_stmt(stmt) for stmt in forwarded):
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
    return ir.Module(out)


def eliminate_noop_coercions(module: ir.Module, typed: TypedModuleInfo) -> ir.Module:
    return ir.Module([_strip_stmt(stmt, typed) for stmt in module.statements])


def _strip_stmt(stmt: Any, typed: TypedModuleInfo) -> Any:
    if isinstance(stmt, ir.TypeDef):
        return stmt
    if isinstance(stmt, ir.ModuleImportStmt):
        return stmt
    if isinstance(stmt, ir.FunctionDef):
        return ir.FunctionDef(
            stmt.name,
            list(stmt.params),
            ir.Block([_strip_stmt(sub, typed) for sub in stmt.body.statements]),
            list(stmt.param_types),
            stmt.return_type,
        )
    if isinstance(stmt, ir.StoreName):
        return ir.StoreName(stmt.name, _strip_expr(stmt.value, typed), stmt.declared_type)
    if isinstance(stmt, ir.StoreSlot):
        return ir.StoreSlot(stmt.slot, stmt.name, _strip_expr(stmt.value, typed), stmt.declared_type)
    if isinstance(stmt, ir.PrintStmt):
        return ir.PrintStmt(_strip_expr(stmt.value, typed))
    if isinstance(stmt, ir.LabelPrintStmt):
        return ir.LabelPrintStmt(stmt.expr_text, _strip_expr(stmt.value, typed))
    if isinstance(stmt, ir.SpillStmt):
        return ir.SpillStmt(_strip_expr(stmt.value, typed))
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
        return ir.CallExpr(_strip_expr(node.func, typed), [_strip_expr(arg, typed) for arg in node.args])
    if isinstance(node, ir.ListExpr):
        stripped: list[Any] = []
        for e in node.elements:
            if isinstance(e, ir.SpliceExpr):
                stripped.append(ir.SpliceExpr(_strip_expr(e.expr, typed)))
                continue
            stripped.append(_strip_expr(e, typed))
        return ir.ListExpr(stripped)
    if isinstance(node, ir.TupleExpr):
        stripped: list[Any] = []
        for e in node.elements:
            if isinstance(e, ir.SpliceExpr):
                stripped.append(ir.SpliceExpr(_strip_expr(e.expr, typed)))
                continue
            stripped.append(_strip_expr(e, typed))
        return ir.TupleExpr(stripped)
    if isinstance(node, ir.MultisetExpr):
        return ir.MultisetExpr([(_strip_expr(value, typed), _strip_expr(count, typed)) for value, count in node.pairs])
    if isinstance(node, ir.StructExpr):
        return ir.StructExpr([(name, _strip_expr(val, typed)) for name, val in node.fields])
    if isinstance(node, ir.AttrExpr):
        return ir.AttrExpr(_strip_expr(node.value, typed), node.name)
    if isinstance(node, ir.IndexExpr):
        return ir.IndexExpr(_strip_expr(node.value, typed), [_strip_expr(idx, typed) for idx in node.indices])
    if isinstance(node, ir.RangeExpr):
        return ir.RangeExpr(
            None if node.start is None else _strip_expr(node.start, typed),
            None if node.end is None else _strip_expr(node.end, typed),
        )
    if isinstance(node, ir.PipeChainExpr):
        stripped_segments: list[Any] = []
        for seg in node.segments:
            if isinstance(seg, ir.Block):
                stripped_segments.append(ir.Block([_strip_stmt(sub, typed) for sub in seg.statements]))
            else:
                stripped_segments.append(_strip_expr(seg, typed))
        return ir.PipeChainExpr(_strip_expr(node.source, typed), stripped_segments)
    if isinstance(node, ir.AbsExpr):
        return ir.AbsExpr(_strip_expr(node.inner, typed))
    if isinstance(node, ir.TypeOfExpr):
        return ir.TypeOfExpr(_strip_expr(node.value, typed))
    if isinstance(node, ir.ScopeExpr):
        return ir.ScopeExpr(ir.Block([_strip_stmt(sub, typed) for sub in node.body.statements]))
    if isinstance(node, ir.ScopeIdentityExpr):
        return node
    if isinstance(node, ir.SpillExpr):
        return ir.SpillExpr(_strip_expr(node.value, typed))
    if isinstance(node, ir.BindExpr):
        return ir.BindExpr(_strip_expr(node.target, typed), _strip_expr(node.value, typed))
    return node
