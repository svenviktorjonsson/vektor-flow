from __future__ import annotations

from pathlib import Path
from typing import Any

from . import ast
from .runtime.axis_tagged import axis_tagged_data, axis_tagged_idx, axis_tagged_wrap, is_axis_tagged_value

_DEFAULT_INPUT_TITLE = "Input Surface"
_DEFAULT_LOG_TITLE = "Native Log"
_DEFAULT_RUN_TAG = "native-scene-probe ready"
_DEFAULT_PROMPT = "focus left pane, then move / click / type"
_DEFAULT_INPUT_RECT = (0.06, 0.08, 0.38, 0.78)
_DEFAULT_LOG_RECT = (0.48, 0.05, 0.46, 0.86)
_UNSUPPORTED = object()


def _materialize_interpreter_value(value: Any) -> Any:
    if is_axis_tagged_value(value):
        return axis_tagged_wrap(_materialize_interpreter_value(axis_tagged_data(value)), axis_tagged_idx(value))
    if isinstance(value, dict):
        return {key: _materialize_interpreter_value(item) for key, item in value.items()}
    if isinstance(value, (str, bytes)) or value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return [_materialize_interpreter_value(item) for item in value]
    if isinstance(value, tuple):
        return [_materialize_interpreter_value(item) for item in value]
    try:
        return [_materialize_interpreter_value(item) for item in value]
    except TypeError:
        return value


def find_top_level_struct_binding(module: ast.Module, name: str, *, source_path: Path | None = None) -> dict[str, Any] | None:
    from .interpreter import Interpreter

    interpreter = Interpreter(source_path or Path("."))
    env = interpreter.globals
    for stmt in module.statements:
        if isinstance(stmt, ast.Bind) and isinstance(stmt.target, ast.Ident) and stmt.target.name == name:
            try:
                value = interpreter.eval_expr(stmt.value, env)
                value = _materialize_interpreter_value(value)
            except Exception:
                value = eval_native_scene_literal(stmt.value, f"{name}")
            if not isinstance(value, dict):
                raise ValueError(f"{name} must be a struct value")
            return value
        interpreter.eval_stmt(stmt, env)
    return None


def eval_native_scene_literal(expr: Any, path: str) -> Any:
    if isinstance(expr, ast.AxisAlign):
        value = eval_native_scene_literal(expr.value, f"{path}.value")
        if expr.label is not None:
            axis_key = "i" if expr.label == "_" else expr.label
        else:
            evaluated = [eval_native_scene_literal(item, f"{path}.axis") for item in (expr.indices or [])]
            if len(evaluated) != 1:
                raise ValueError(f"{path} axis access expects exactly one key")
            raw = evaluated[0]
            if isinstance(raw, bool):
                raise ValueError(f"{path} axis key cannot be bool")
            if isinstance(raw, str):
                axis_key = raw
            elif isinstance(raw, (int, float)):
                axis_key = str(int(raw)) if isinstance(raw, float) and raw == int(raw) else str(raw)
            else:
                raise ValueError(f"{path} axis key must be string or number")
        return axis_tagged_wrap(value, axis_key)
    if isinstance(expr, ast.StructLit):
        return {key: eval_native_scene_literal(value, f"{path}.{key}") for key, value in expr.fields}
    if isinstance(expr, ast.ListLit):
        return [eval_native_scene_literal(value, f"{path}[]") for value in expr.elements]
    if isinstance(expr, ast.TupleLit):
        return [eval_native_scene_literal(value, f"{path}[]") for value in expr.elements]
    if isinstance(expr, ast.StringLit):
        return expr.value
    if isinstance(expr, ast.NumberLit):
        return expr.value
    if isinstance(expr, ast.BoolLit):
        return expr.value
    if isinstance(expr, ast.NullLit):
        return None
    if isinstance(expr, ast.UnaryOp):
        operand = eval_native_scene_literal(expr.operand, f"{path}.operand")
        if not isinstance(operand, (int, float)) or isinstance(operand, bool):
            raise ValueError(f"{path} unary operand must be numeric")
        if expr.op == "MINUS":
            return -float(operand)
        if expr.op == "PLUS":
            return float(operand)
    raise ValueError(f"{path} must be a literal value; got {type(expr).__name__}")


def extract_scene_probe_spec(module: ast.Module) -> dict[str, Any] | None:
    if len(module.statements) != 1:
        return None
    stmt = module.statements[0]
    if not isinstance(stmt, ast.ExprStmt):
        return None
    expr = stmt.expr
    if not isinstance(expr, ast.Call):
        return None
    if not is_scene_probe_callee(expr.func):
        return None

    spec: dict[str, Any] = {
        "run_tag": _DEFAULT_RUN_TAG,
        "prompt": _DEFAULT_PROMPT,
        "input_title": _DEFAULT_INPUT_TITLE,
        "log_title": _DEFAULT_LOG_TITLE,
        "input_rect": _DEFAULT_INPUT_RECT,
        "log_rect": _DEFAULT_LOG_RECT,
        "input_frame_id": "f1",
        "log_frame_id": "f2",
        "log_widget_id": "log",
        "event_probe": None,
    }
    for arg in expr.args:
        if not isinstance(arg, ast.NamedCallArg):
            raise ValueError("native.scene_probe only supports named arguments")
        name = arg.name
        if name in {"run_tag", "prompt", "input_title", "log_title"}:
            spec[name] = require_string(arg.value, name)
            continue
        if name in {"input_rect", "log_rect"}:
            spec[name] = require_rect(arg.value, name)
            continue
        raise ValueError(f"native.scene_probe does not support argument {name!r}")
    return spec


def extract_declarative_ui_scene_probe_spec(module: ast.Module) -> dict[str, Any] | None:
    ui_aliases = {"ui"}
    screen_aliases: set[str] = set()
    widget_aliases: set[str] = set()
    frame_names: set[str] = set()
    bindings: dict[str, Any] = {}
    frames: list[dict[str, Any]] = []

    for stmt in module.statements:
        if isinstance(stmt, ast.SpillImport):
            if isinstance(stmt.path, ast.DotModulePath) and stmt.path.segments == ["ui"] and stmt.alias:
                ui_aliases.add(stmt.alias)
                continue
            return None
        if isinstance(stmt, ast.Bind):
            target = stmt.target
            if not isinstance(target, ast.Ident):
                return None
            name = target.name
            value = stmt.value
            if isinstance(value, ast.DotModulePath) and value.segments == ["ui"]:
                ui_aliases.add(name)
                continue
            if is_attr_of_ident(value, ui_aliases, "display"):
                screen_aliases.add(name)
                continue
            if is_attr_of_ident(value, ui_aliases, "widgets"):
                widget_aliases.add(name)
                continue
            if is_call_of_attr(value, ui_aliases | screen_aliases, "Frame"):
                frame_names.add(name)
                continue
            const_value = try_eval_const(value, bindings)
            if const_value is not _UNSUPPORTED:
                bindings[name] = const_value
                continue
            continue
        if isinstance(stmt, ast.ExprStmt):
            expr = stmt.expr
            if is_mode_call(expr, ui_aliases) or is_render_call(expr, screen_aliases):
                continue
            frame_spec = try_extract_add_frame(expr, screen_aliases, widget_aliases, bindings, frame_names)
            if frame_spec is not None:
                frames.append(frame_spec)
                continue
            continue

    if len(frames) < 2:
        return None

    input_frame = next((frame for frame in frames if frame["body"] is None), None)
    log_frame = next((frame for frame in frames if frame["body"] is not None), None)
    if input_frame is None or log_frame is None:
        return None

    log_widget = log_frame["body"][0]
    log_text = str(log_widget.get("text", "")).rstrip("\n")
    prompt = _DEFAULT_PROMPT
    run_tag = _DEFAULT_RUN_TAG
    if log_text:
        lines = log_text.splitlines()
        if lines:
            run_tag = lines[0]
        if len(lines) > 1:
            prompt = lines[1]

    event_probe = extract_event_probe_spec(module, ui_aliases, log_frame["id"])

    return {
        "run_tag": run_tag,
        "prompt": prompt,
        "input_title": frame_title_for_name(input_frame["name"], _DEFAULT_INPUT_TITLE),
        "log_title": frame_title_for_name(log_frame["name"], _DEFAULT_LOG_TITLE),
        "input_rect": input_frame["rect"],
        "log_rect": log_frame["rect"],
        "input_frame_id": input_frame["id"],
        "log_frame_id": log_frame["id"],
        "log_widget_id": str(log_widget["id"]),
        "event_probe": event_probe,
    }


def is_scene_probe_callee(node: Any) -> bool:
    if isinstance(node, ast.Attribute) and node.name == "scene_probe":
        return isinstance(node.value, ast.Ident) and node.value.name in {"native", "ui"}
    return False


def is_attr_of_ident(node: Any, base_names: set[str], attr_name: str) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Ident)
        and node.value.name in base_names
        and node.name == attr_name
    )


def is_call_of_attr(node: Any, base_names: set[str], attr_name: str) -> bool:
    return (
        isinstance(node, ast.Call)
        and is_attr_of_ident(node.func, base_names, attr_name)
    )


def is_mode_call(node: Any, ui_aliases: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in ui_aliases
        and node.func.name == "set_mode"
    )


def is_render_call(node: Any, screen_aliases: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in screen_aliases
        and node.func.name == "render"
    )


def try_extract_add_frame(
    node: Any,
    screen_aliases: set[str],
    widget_aliases: set[str],
    bindings: dict[str, Any],
    frame_names: set[str],
) -> dict[str, Any] | None:
    if not (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in screen_aliases
        and node.func.name == "add_frame"
    ):
        return None
    positional = [arg for arg in node.args if not isinstance(arg, ast.NamedCallArg)]
    named = [arg for arg in node.args if isinstance(arg, ast.NamedCallArg)]
    if len(positional) < 2:
        return None
    frame_arg = positional[0]
    rect_arg = positional[1]
    if not isinstance(frame_arg, ast.Ident) or frame_arg.name not in frame_names:
        return None
    rect = require_rect(rect_arg, "screen.add_frame rect")
    body = None
    for arg in named:
        if arg.name == "body":
            body = require_body_widgets(arg.value, widget_aliases, bindings)
        else:
            return None
    return {"name": frame_arg.name, "id": frame_arg.name, "rect": rect, "body": body}


def require_body_widgets(node: Any, widget_aliases: set[str], bindings: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(node, ast.ListLit):
        raise ValueError("frame body must be a widget list")
    widgets: list[dict[str, Any]] = []
    for element in node.elements:
        if not (
            isinstance(element, ast.Call)
            and isinstance(element.func, ast.Attribute)
            and isinstance(element.func.value, ast.Ident)
            and element.func.value.name in widget_aliases
            and element.func.name == "text_area"
        ):
            raise ValueError("native scene body only supports widgets.text_area")
        widgets.append(extract_text_area_widget(element, bindings))
    return widgets


def extract_text_area_widget(node: ast.Call, bindings: dict[str, Any]) -> dict[str, Any]:
    positional = [arg for arg in node.args if not isinstance(arg, ast.NamedCallArg)]
    named = [arg for arg in node.args if isinstance(arg, ast.NamedCallArg)]
    if not positional:
        raise ValueError("text_area requires widget id")
    widget_id = require_string(positional[0], "text_area id")
    payload: dict[str, Any] = {"id": widget_id, "type": "textarea"}
    for arg in named:
        value = try_eval_const(arg.value, bindings)
        if value is _UNSUPPORTED:
            raise ValueError(f"text_area argument {arg.name!r} must be constant in native scene subset")
        payload[arg.name] = value
    return payload


def extract_event_probe_spec(module: ast.Module, ui_aliases: set[str], log_frame_id: str) -> dict[str, Any] | None:
    trace_def = next((stmt for stmt in module.statements if isinstance(stmt, ast.FuncDef) and stmt.name == "Trace"), None)
    should_ignore_def = next((stmt for stmt in module.statements if isinstance(stmt, ast.FuncDef) and stmt.name == "ShouldIgnore"), None)
    loop_stmt = next((stmt for stmt in module.statements if isinstance(stmt, ast.MatchStmt) and stmt.loop), None)
    if trace_def is None or should_ignore_def is None or loop_stmt is None:
        return None
    if not matches_should_ignore_function(should_ignore_def):
        return None
    formatters = extract_trace_formatters(trace_def, ui_aliases)
    loop_rules = extract_loop_rules(loop_stmt, ui_aliases)
    if formatters is None or loop_rules is None:
        return None
    return {
        "ignore_frame_id": log_frame_id,
        "formatters": formatters,
        "loop_rules": loop_rules,
    }


def matches_should_ignore_function(func_def: Any) -> bool:
    body = getattr(func_def, "body", None)
    stmts = getattr(body, "statements", None)
    if not isinstance(stmts, list) or len(stmts) != 1:
        return False
    stmt = stmts[0]
    if not isinstance(stmt, ast.ReturnStmt):
        return False
    expr = stmt.value
    return (
        isinstance(expr, ast.BinOp)
        and expr.op == "EQ"
        and isinstance(expr.left, ast.Attribute)
        and isinstance(expr.left.value, ast.Ident)
        and expr.left.value.name == "e"
        and expr.left.name == "frame_id"
        and isinstance(expr.right, ast.Attribute)
        and isinstance(expr.right.value, ast.Ident)
        and expr.right.value.name == "log_frame"
        and expr.right.name == "id"
    )


def extract_trace_formatters(func_def: Any, ui_aliases: set[str]) -> dict[str, list[str]] | None:
    body = getattr(func_def, "body", None)
    stmts = getattr(body, "statements", None)
    if not isinstance(stmts, list):
        return None
    match_stmt = next((stmt for stmt in stmts if isinstance(stmt, ast.MatchStmt)), None)
    if match_stmt is None:
        return None
    formatters: dict[str, list[str]] = {}
    for arm in match_stmt.arms:
        key = "default"
        if arm.condition is not None:
            type_name = extract_ui_type_name(arm.condition, ui_aliases)
            if type_name is None:
                return None
            key = type_name
        fields = extract_show_struct_fields(arm.body)
        if fields is None:
            return None
        formatters[key] = fields
    return formatters


def extract_show_struct_fields(node: Any) -> list[str] | None:
    if not isinstance(node, ast.Call):
        return None
    if not isinstance(node.func, ast.Ident) or node.func.name != "Show":
        return None
    if len(node.args) != 1:
        return None
    current = node.args[0]
    while isinstance(current, ast.BinOp) and current.op == "AMPERSAND":
        current = current.right
    if not isinstance(current, ast.StructLit):
        return None
    return [name for name, _ in current.fields]


def extract_loop_rules(match_stmt: Any, ui_aliases: set[str]) -> list[dict[str, Any]] | None:
    rules: list[dict[str, Any]] = []
    for arm in match_stmt.arms:
        if isinstance(arm.condition, ast.NullLit):
            continue
        match_name = "default"
        if arm.condition is not None:
            if isinstance(arm.condition, ast.PrimTypeRef) and arm.condition.name == "any":
                match_name = "default"
            else:
                type_name = extract_ui_type_name(arm.condition, ui_aliases)
                if type_name is None:
                    return None
                match_name = type_name
        label = extract_trace_label(arm.body)
        if label is None:
            return None
        rule: dict[str, Any] = {"match": match_name, "label": label}
        throttle = extract_throttle(arm.body)
        if throttle is not None:
            rule["throttle"] = throttle
        rules.append(rule)
    return rules


def extract_trace_label(node: Any) -> str | None:
    call = find_trace_call(node)
    if call is None or not call.args:
        return None
    label = call.args[0]
    if not isinstance(label, ast.StringLit):
        return None
    return label.value


def find_trace_call(node: Any) -> Any | None:
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Ident) and node.func.name == "Trace":
        return node
    if isinstance(node, ast.Block):
        for stmt in node.statements:
            result = find_trace_call(stmt)
            if result is not None:
                return result
    if isinstance(node, ast.ExprStmt):
        return find_trace_call(node.expr)
    if isinstance(node, ast.ConditionalExpr):
        return find_trace_call(node.body)
    return None


def extract_throttle(node: Any) -> dict[str, Any] | None:
    if not isinstance(node, ast.Block):
        return None
    conditional = next(
        (
            stmt.expr
            for stmt in node.statements
            if isinstance(stmt, ast.ExprStmt) and isinstance(stmt.expr, ast.ConditionalExpr)
        ),
        None,
    )
    if conditional is None:
        return None
    cond = conditional.condition
    if not (isinstance(cond, ast.BinOp) and cond.op == "OR"):
        return None
    left = cond.left
    right = cond.right
    if not (
        isinstance(left, ast.BinOp)
        and left.op == "EXACT_EQ"
        and isinstance(left.right, ast.NumberLit)
        and left.right.value == 1
        and isinstance(right, ast.BinOp)
        and right.op == "EQ"
        and isinstance(right.left, ast.BinOp)
        and right.left.op == "PERCENT"
        and isinstance(right.left.left, ast.Ident)
        and isinstance(right.left.right, ast.NumberLit)
        and isinstance(right.right, ast.NumberLit)
        and right.right.value == 0
    ):
        return None
    return {"counter": right.left.left.name, "first": 1, "every": int(right.left.right.value)}


def extract_ui_type_name(node: Any, ui_aliases: set[str]) -> str | None:
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Ident) and node.value.name in ui_aliases:
        return node.name
    return None


def frame_title_for_name(name: str, default: str) -> str:
    lowered = name.lower()
    if "input" in lowered:
        return "Input Surface"
    if "log" in lowered:
        return "Native Log"
    return default


def require_string(node: Any, context: str) -> str:
    if not isinstance(node, ast.StringLit):
        raise ValueError(f"{context} must be a string literal")
    return node.value


def require_rect(node: Any, context: str) -> tuple[float, float, float, float]:
    if not isinstance(node, ast.TupleLit) or len(node.elements) != 4:
        raise ValueError(f"{context} must be a 4-tuple of numbers")
    values: list[float] = []
    for element in node.elements:
        if not isinstance(element, ast.NumberLit):
            raise ValueError(f"{context} must contain only number literals")
        values.append(float(element.value))
    return (values[0], values[1], values[2], values[3])


def try_eval_const(node: Any, bindings: dict[str, Any]) -> Any:
    if isinstance(node, ast.StringLit):
        return node.value
    if isinstance(node, ast.NumberLit):
        return float(node.value)
    if isinstance(node, ast.BoolLit):
        return bool(node.value)
    if isinstance(node, ast.NullLit):
        return None
    if isinstance(node, ast.Ident):
        return bindings.get(node.name, _UNSUPPORTED)
    if isinstance(node, ast.TupleLit):
        values = [try_eval_const(element, bindings) for element in node.elements]
        if any(value is _UNSUPPORTED for value in values):
            return _UNSUPPORTED
        return tuple(values)
    if isinstance(node, ast.ListLit):
        values = [try_eval_const(element, bindings) for element in node.elements]
        if any(value is _UNSUPPORTED for value in values):
            return _UNSUPPORTED
        return list(values)
    if isinstance(node, ast.BinOp) and node.op in {"&", "AMPERSAND"}:
        left = try_eval_const(node.left, bindings)
        right = try_eval_const(node.right, bindings)
        if left is _UNSUPPORTED or right is _UNSUPPORTED:
            return _UNSUPPORTED
        return str(left) + str(right)
    return _UNSUPPORTED


__all__ = [
    "eval_native_scene_literal",
    "extract_declarative_ui_scene_probe_spec",
    "extract_scene_probe_spec",
    "find_top_level_struct_binding",
]
