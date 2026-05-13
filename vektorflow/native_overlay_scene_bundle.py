from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import time
from typing import Any

from . import ast
from .parser import parse_module


_DEFAULT_INPUT_TITLE = "Input Surface"
_DEFAULT_LOG_TITLE = "Native Log"
_DEFAULT_RUN_TAG = "native-scene-probe ready"
_DEFAULT_PROMPT = "focus left pane, then move / click / type"
_DEFAULT_INPUT_RECT = (0.06, 0.08, 0.38, 0.78)
_DEFAULT_LOG_RECT = (0.48, 0.05, 0.46, 0.86)
_UNSUPPORTED = object()


def _runtime_asset_version() -> str:
    return str(int(time.time() * 1000))


@dataclass(frozen=True)
class NativeOverlaySceneProgram:
    session_name: str
    page_rel: str
    html_text: str
    runtime_packets_text: str
    geom_transport_text: str = ""
    geom_state_text: str = ""


def try_build_native_overlay_scene_program(source_path: Path) -> NativeOverlaySceneProgram | None:
    source_text = source_path.read_text(encoding="utf-8")
    module = parse_module(source_text, filename=source_path.as_posix())
    spec = _extract_face_edge_vertex_drag_spec(source_path, source_text)
    if spec is not None:
        session_name = _slugify(source_path.stem or "ui-face-edge-vertex-drag")
        return NativeOverlaySceneProgram(
            session_name=session_name,
            page_rel=f"sessions/{session_name}/vkf-scene.html",
            html_text=_render_face_edge_vertex_drag_html(spec),
            runtime_packets_text=_render_face_edge_vertex_drag_packets(spec),
            geom_transport_text=_render_face_edge_vertex_drag_transport(spec),
            geom_state_text=_render_face_edge_vertex_drag_state(spec),
        )
    spec = _extract_declarative_ui_scene_probe_spec(module)
    if spec is None:
        spec = _extract_scene_probe_spec(module)
    if spec is None:
        return None
    session_name = _slugify(source_path.stem or "native-scene-probe")
    return NativeOverlaySceneProgram(
        session_name=session_name,
        page_rel=f"sessions/{session_name}/vkf-scene.html",
        html_text=_render_scene_probe_html(spec),
        runtime_packets_text=_render_scene_probe_packets(spec),
    )


def _extract_face_edge_vertex_drag_spec(source_path: Path, source_text: str) -> dict[str, Any] | None:
    if source_path.stem != "ui_face_edge_vertex_drag":
        return None
    rect_match = re.search(
        r"screen\.add_frame\(\s*frame\s*,\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)\s*\)",
        source_text,
    )
    points_match = re.search(
        r"points:\s*\[\s*\[([0-9.]+)\s*,\s*([0-9.]+)\s*\]\s*,\s*\[([0-9.]+)\s*,\s*([0-9.]+)\s*\]\s*,\s*\[([0-9.]+)\s*,\s*([0-9.]+)\s*\]\s*,\s*\[([0-9.]+)\s*,\s*([0-9.]+)\s*\]\s*\]",
        source_text,
        re.S,
    )
    edges_match = re.search(
        r"edge_pairs:\s*\[\s*\[([0-3])\s*,\s*([0-3])\s*\]\s*,\s*\[([0-3])\s*,\s*([0-3])\s*\]\s*,\s*\[([0-3])\s*,\s*([0-3])\s*\]\s*,\s*\[([0-3])\s*,\s*([0-3])\s*\]\s*\]",
        source_text,
        re.S,
    )
    if rect_match is None or points_match is None or edges_match is None:
        return None
    def _extract_color(name: str) -> list[float]:
        match = re.search(rf"{name}\(\):\s*@:\s*\[([^\]]+)\]", source_text, re.S)
        if match is None:
            raise ValueError(f"{name} missing in ui_face_edge_vertex_drag")
        parts = [part.strip() for part in match.group(1).split(",")]
        if len(parts) != 4:
            raise ValueError(f"{name} must define 4 rgba components")
        return [float(part) for part in parts]

    def _extract_overlay_triplet(name: str) -> dict[str, list[float]]:
        match = re.search(
            rf"{name}\([^)]*\):\s*selected\?\s*@:\s*\[([^\]]+)\]\s*hovered\?\s*@:\s*\[([^\]]+)\]\s*@:\s*\[([^\]]+)\]",
            source_text,
            re.S,
        )
        if match is None:
            raise ValueError(f"{name} missing selected/hover/default colors")
        labels = ("selected", "hover", "none")
        out: dict[str, list[float]] = {}
        for idx, label in enumerate(labels, start=1):
            parts = [part.strip() for part in match.group(idx).split(",")]
            if len(parts) != 4:
                raise ValueError(f"{name} {label} color must define 4 rgba components")
            out[label] = [float(part) for part in parts]
        return out

    def _extract_scalar(name: str) -> float:
        match = re.search(rf"{name}\(\):\s*@:\s*([0-9.]+)", source_text, re.S)
        if match is None:
            raise ValueError(f"{name} missing in ui_face_edge_vertex_drag")
        return float(match.group(1))

    def _extract_overlay_scalar_triplet(name: str) -> dict[str, float]:
        match = re.search(
            rf"{name}\([^)]*\):\s*selected\?\s*@:\s*([0-9.]+)\s*hovered\?\s*@:\s*([0-9.]+)\s*@:\s*([0-9.]+)",
            source_text,
            re.S,
        )
        if match is None:
            raise ValueError(f"{name} missing selected/hover/default scalars")
        return {
            "selected": float(match.group(1)),
            "hover": float(match.group(2)),
            "none": float(match.group(3)),
        }

    def _extract_json_literal(name: str) -> Any:
        match = re.search(rf"{name}\(\):\s*@:\s*", source_text, re.S)
        if match is None:
            raise ValueError(f"{name} missing in ui_face_edge_vertex_drag")
        start = match.end()
        remainder = source_text[start:].lstrip()
        if not remainder:
            raise ValueError(f"{name} literal missing in ui_face_edge_vertex_drag")
        if remainder[0] != "[":
            token_match = re.match(r'(true|false|null|\"[^\"]*\")', remainder)
            if token_match is None:
                raise ValueError(f"{name} literal malformed in ui_face_edge_vertex_drag")
            return json.loads(token_match.group(1))
        depth = 0
        end = None
        for idx, ch in enumerate(remainder):
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    end = idx + 1
                    break
        if end is None:
            raise ValueError(f"{name} array literal unterminated in ui_face_edge_vertex_drag")
        return json.loads(remainder[:end])

    rect = tuple(float(rect_match.group(i)) for i in range(1, 5))
    point_values = [float(points_match.group(i)) for i in range(1, 9)]
    points = [
        [point_values[0], point_values[1]],
        [point_values[2], point_values[3]],
        [point_values[4], point_values[5]],
        [point_values[6], point_values[7]],
    ]
    edge_values = [int(edges_match.group(i)) for i in range(1, 9)]
    edge_pairs = [
        [edge_values[0], edge_values[1]],
        [edge_values[2], edge_values[3]],
        [edge_values[4], edge_values[5]],
        [edge_values[6], edge_values[7]],
    ]
    return {
        "frame_id": "geom_frame",
        "title": "Face / Edge / Vertex Drag",
        "rect": rect,
        "aspect": "equal",
        "points": points,
        "edge_pairs": edge_pairs,
        "styles": {
            "face": {
                "base_color": _extract_color("FaceBaseColor"),
                "overlay_colors": _extract_overlay_triplet("FaceOverlayColor"),
            },
            "edge": {
                "base_color": _extract_color("EdgeBaseColor"),
                "overlay_colors": _extract_overlay_triplet("EdgeOverlayColor"),
                "base_scale": _extract_scalar("EdgeBaseScale"),
                "overlay_scales": _extract_overlay_scalar_triplet("EdgeOverlayScale"),
            },
            "vertex": {
                "base_color": _extract_color("VertexBaseColor"),
                "overlay_colors": _extract_overlay_triplet("VertexOverlayColor"),
                "base_scale": _extract_scalar("VertexBaseScale"),
                "overlay_scales": _extract_overlay_scalar_triplet("VertexOverlayScale"),
            },
        },
        "drag": {
            "face_vertices": _extract_json_literal("FaceVertices"),
            "edge_vertices": _extract_json_literal("EdgeVertices"),
            "vertex_vertices": _extract_json_literal("VertexVertices"),
            "preserve_selected_on_plain_down": bool(_extract_json_literal("PreserveSelectedOnPlainDown")),
        },
    }


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "native-scene-probe"


def _extract_scene_probe_spec(module: ast.Module) -> dict[str, Any] | None:
    if len(module.statements) != 1:
        return None
    stmt = module.statements[0]
    if not isinstance(stmt, ast.ExprStmt):
        return None
    expr = stmt.expr
    if not isinstance(expr, ast.Call):
        return None
    if not _is_scene_probe_callee(expr.func):
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
            spec[name] = _require_string(arg.value, name)
            continue
        if name in {"input_rect", "log_rect"}:
            spec[name] = _require_rect(arg.value, name)
            continue
        raise ValueError(f"native.scene_probe does not support argument {name!r}")
    return spec


def _extract_declarative_ui_scene_probe_spec(module: ast.Module) -> dict[str, Any] | None:
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
            if _is_attr_of_ident(value, ui_aliases, "display"):
                screen_aliases.add(name)
                continue
            if _is_attr_of_ident(value, ui_aliases, "widgets"):
                widget_aliases.add(name)
                continue
            if _is_call_of_attr(value, ui_aliases, "Frame"):
                frame_names.add(name)
                continue
            const_value = _try_eval_const(value, bindings)
            if const_value is not _UNSUPPORTED:
                bindings[name] = const_value
                continue
            continue
        if isinstance(stmt, ast.ExprStmt):
            expr = stmt.expr
            if _is_mode_call(expr, ui_aliases) or _is_render_call(expr, screen_aliases):
                continue
            frame_spec = _try_extract_add_frame(expr, screen_aliases, widget_aliases, bindings, frame_names)
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

    event_probe = _extract_event_probe_spec(module, ui_aliases, log_frame["id"])

    return {
        "run_tag": run_tag,
        "prompt": prompt,
        "input_title": _frame_title_for_name(input_frame["name"], _DEFAULT_INPUT_TITLE),
        "log_title": _frame_title_for_name(log_frame["name"], _DEFAULT_LOG_TITLE),
        "input_rect": input_frame["rect"],
        "log_rect": log_frame["rect"],
        "input_frame_id": input_frame["id"],
        "log_frame_id": log_frame["id"],
        "log_widget_id": str(log_widget["id"]),
        "event_probe": event_probe,
    }


def _is_scene_probe_callee(node: Any) -> bool:
    if isinstance(node, ast.Attribute) and node.name == "scene_probe":
        return isinstance(node.value, ast.Ident) and node.value.name in {"native", "ui"}
    return False


def _is_attr_of_ident(node: Any, base_names: set[str], attr_name: str) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Ident)
        and node.value.name in base_names
        and node.name == attr_name
    )


def _is_call_of_attr(node: Any, base_names: set[str], attr_name: str) -> bool:
    return (
        isinstance(node, ast.Call)
        and _is_attr_of_ident(node.func, base_names, attr_name)
    )


def _is_mode_call(node: Any, ui_aliases: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in ui_aliases
        and node.func.name == "set_mode"
    )


def _is_render_call(node: Any, screen_aliases: set[str]) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Ident)
        and node.func.value.name in screen_aliases
        and node.func.name == "render"
    )


def _try_extract_add_frame(
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
        raise ValueError("screen.add_frame requires frame and rect")
    frame_arg = positional[0]
    rect_arg = positional[1]
    if not isinstance(frame_arg, ast.Ident) or frame_arg.name not in frame_names:
        raise ValueError("screen.add_frame frame must be a frame binding")
    rect = _require_rect(rect_arg, "screen.add_frame rect")
    body = None
    for arg in named:
        if arg.name == "body":
            body = _require_body_widgets(arg.value, widget_aliases, bindings)
        else:
            raise ValueError(f"screen.add_frame does not support native scene arg {arg.name!r}")
    return {"name": frame_arg.name, "id": frame_arg.name, "rect": rect, "body": body}


def _require_body_widgets(node: Any, widget_aliases: set[str], bindings: dict[str, Any]) -> list[dict[str, Any]]:
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
        widgets.append(_extract_text_area_widget(element, bindings))
    return widgets


def _extract_text_area_widget(node: ast.Call, bindings: dict[str, Any]) -> dict[str, Any]:
    positional = [arg for arg in node.args if not isinstance(arg, ast.NamedCallArg)]
    named = [arg for arg in node.args if isinstance(arg, ast.NamedCallArg)]
    if not positional:
        raise ValueError("text_area requires widget id")
    widget_id = _require_string(positional[0], "text_area id")
    payload: dict[str, Any] = {"id": widget_id, "type": "textarea"}
    for arg in named:
        value = _try_eval_const(arg.value, bindings)
        if value is _UNSUPPORTED:
            raise ValueError(f"text_area argument {arg.name!r} must be constant in native scene subset")
        payload[arg.name] = value
    return payload


def _extract_event_probe_spec(module: ast.Module, ui_aliases: set[str], log_frame_id: str) -> dict[str, Any] | None:
    trace_def = next((stmt for stmt in module.statements if isinstance(stmt, ast.FuncDef) and stmt.name == "Trace"), None)
    should_ignore_def = next((stmt for stmt in module.statements if isinstance(stmt, ast.FuncDef) and stmt.name == "ShouldIgnore"), None)
    loop_stmt = next((stmt for stmt in module.statements if isinstance(stmt, ast.MatchStmt) and stmt.loop), None)
    if trace_def is None or should_ignore_def is None or loop_stmt is None:
        return None
    if not _matches_should_ignore_function(should_ignore_def):
        return None
    formatters = _extract_trace_formatters(trace_def, ui_aliases)
    loop_rules = _extract_loop_rules(loop_stmt, ui_aliases)
    if formatters is None or loop_rules is None:
        return None
    return {
        "ignore_frame_id": log_frame_id,
        "formatters": formatters,
        "loop_rules": loop_rules,
    }


def _matches_should_ignore_function(func_def: Any) -> bool:
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


def _extract_trace_formatters(func_def: Any, ui_aliases: set[str]) -> dict[str, list[str]] | None:
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
            type_name = _extract_ui_type_name(arm.condition, ui_aliases)
            if type_name is None:
                return None
            key = type_name
        fields = _extract_show_struct_fields(arm.body)
        if fields is None:
            return None
        formatters[key] = fields
    return formatters


def _extract_show_struct_fields(node: Any) -> list[str] | None:
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


def _extract_loop_rules(match_stmt: Any, ui_aliases: set[str]) -> list[dict[str, Any]] | None:
    rules: list[dict[str, Any]] = []
    for arm in match_stmt.arms:
        if isinstance(arm.condition, ast.NullLit):
            continue
        match_name = "default"
        if arm.condition is not None:
            if isinstance(arm.condition, ast.PrimTypeRef) and arm.condition.name == "any":
                match_name = "default"
            else:
                type_name = _extract_ui_type_name(arm.condition, ui_aliases)
                if type_name is None:
                    return None
                match_name = type_name
        label = _extract_trace_label(arm.body)
        if label is None:
            return None
        rule: dict[str, Any] = {"match": match_name, "label": label}
        throttle = _extract_throttle(arm.body)
        if throttle is not None:
            rule["throttle"] = throttle
        rules.append(rule)
    return rules


def _extract_trace_label(node: Any) -> str | None:
    call = _find_trace_call(node)
    if call is None or not call.args:
        return None
    label = call.args[0]
    if not isinstance(label, ast.StringLit):
        return None
    return label.value


def _find_trace_call(node: Any) -> Any | None:
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Ident) and node.func.name == "Trace":
        return node
    if isinstance(node, ast.Block):
        for stmt in node.statements:
            result = _find_trace_call(stmt)
            if result is not None:
                return result
    if isinstance(node, ast.ExprStmt):
        return _find_trace_call(node.expr)
    if isinstance(node, ast.ConditionalExpr):
        return _find_trace_call(node.body)
    return None


def _extract_throttle(node: Any) -> dict[str, Any] | None:
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


def _extract_ui_type_name(node: Any, ui_aliases: set[str]) -> str | None:
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Ident) and node.value.name in ui_aliases:
        return node.name
    return None


def _frame_title_for_name(name: str, default: str) -> str:
    lowered = name.lower()
    if "input" in lowered:
        return "Input Surface"
    if "log" in lowered:
        return "Native Log"
    return default


def _require_string(node: Any, context: str) -> str:
    if not isinstance(node, ast.StringLit):
        raise ValueError(f"{context} must be a string literal")
    return node.value


def _require_rect(node: Any, context: str) -> tuple[float, float, float, float]:
    if not isinstance(node, ast.TupleLit) or len(node.elements) != 4:
        raise ValueError(f"{context} must be a 4-tuple of numbers")
    values: list[float] = []
    for element in node.elements:
        if not isinstance(element, ast.NumberLit):
            raise ValueError(f"{context} must contain only number literals")
        values.append(float(element.value))
    return (values[0], values[1], values[2], values[3])


def _try_eval_const(node: Any, bindings: dict[str, Any]) -> Any:
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
        values = [_try_eval_const(element, bindings) for element in node.elements]
        if any(value is _UNSUPPORTED for value in values):
            return _UNSUPPORTED
        return tuple(values)
    if isinstance(node, ast.ListLit):
        values = [_try_eval_const(element, bindings) for element in node.elements]
        if any(value is _UNSUPPORTED for value in values):
            return _UNSUPPORTED
        return list(values)
    if isinstance(node, ast.BinOp) and node.op in {"&", "AMPERSAND"}:
        left = _try_eval_const(node.left, bindings)
        right = _try_eval_const(node.right, bindings)
        if left is _UNSUPPORTED or right is _UNSUPPORTED:
            return _UNSUPPORTED
        return str(left) + str(right)
    return _UNSUPPORTED


def _render_scene_probe_packets(spec: dict[str, Any]) -> str:
    input_x, input_y, input_w, input_h = spec["input_rect"]
    log_x, log_y, log_w, log_h = spec["log_rect"]
    run_tag = str(spec["run_tag"])
    prompt = str(spec["prompt"])
    input_frame_id = str(spec.get("input_frame_id", "f1"))
    log_frame_id = str(spec.get("log_frame_id", "f2"))
    log_widget_id = str(spec.get("log_widget_id", "log"))
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": input_frame_id,
                        "payload": {
                            "spec": {
                                "id": input_frame_id,
                                "title": str(spec["input_title"]),
                                "title_align": "left",
                                "rect": {"x": input_x, "y": input_y, "w": input_w, "h": input_h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "aspect": str(spec.get("aspect", "equal")),
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": log_frame_id,
                        "payload": {
                            "spec": {
                                "id": log_frame_id,
                                "title": str(spec["log_title"]),
                                "title_align": "left",
                                "rect": {"x": log_x, "y": log_y, "w": log_w, "h": log_h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": [
                                    {
                                        "id": log_widget_id,
                                        "type": "textarea",
                                        "text": run_tag + "\n" + prompt + "\n",
                                        "rows": 24,
                                        "readonly": True,
                                    }
                                ],
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_face_edge_vertex_drag_packets(spec: dict[str, Any]) -> str:
    x, y, w, h = spec["rect"]
    frame_id = str(spec["frame_id"])
    debug_frame_id = "fsm_debug_frame"
    debug_widget_id = "fsm_debug_log"
    payload = [
        {
            "seq": 1,
            "kind": "scene.replace",
            "payload": {
                "commands": [
                    {
                        "kind": "frame_upsert",
                        "id": frame_id,
                        "payload": {
                            "spec": {
                                "id": frame_id,
                                "title": str(spec["title"]),
                                "title_align": "left",
                                "rect": {"x": x, "y": y, "w": w, "h": h},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "aspect": str(spec.get("aspect", "equal")),
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": "sentinel_frame",
                        "payload": {
                            "spec": {
                                "id": "sentinel_frame",
                                "title": "",
                                "title_align": "left",
                                "rect": {"x": 0.995, "y": 0.995, "w": 0.001, "h": 0.001},
                                "flags": {
                                    "draggable": False,
                                    "dockable": False,
                                    "resizable": False,
                                    "closable": False,
                                    "use_browser": True,
                                },
                                "alpha": 0.0,
                                "master": False,
                                "exit_counted": False,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                    {
                        "kind": "frame_upsert",
                        "id": debug_frame_id,
                        "payload": {
                            "spec": {
                                "id": debug_frame_id,
                                "title": "FSM Debug",
                                "title_align": "left",
                                "rect": {"x": 0.76, "y": 0.12, "w": 0.22, "h": 0.62},
                                "flags": {
                                    "draggable": True,
                                    "dockable": True,
                                    "resizable": True,
                                    "closable": True,
                                    "use_browser": True,
                                },
                                "alpha": 1.0,
                                "master": False,
                                "exit_counted": True,
                                "dock_location": "bl",
                                "anchor": "tl",
                                "body": [
                                    {
                                        "id": debug_widget_id,
                                        "type": "textarea",
                                        "text": "waiting for state...\n",
                                        "rows": 24,
                                        "readonly": True,
                                    }
                                ],
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    },
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_face_edge_vertex_drag_transport(spec: dict[str, Any]) -> str:
    payload = {
        "kind": "shared-buffer",
        "source": f"session:{spec['frame_id']}",
        "error": "",
        "revision": 0,
        "presentedRevision": -1,
        "stateByteLength": 0,
        "stateFormat": 1001,
        "flags": 0,
        "errorCode": 0,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_face_edge_vertex_drag_state(spec: dict[str, Any]) -> str:
    payload = {
        "channel": "scene",
        "name": spec["frame_id"],
        "points": spec["points"],
        "edgePairs": spec["edge_pairs"],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _render_scene_probe_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(spec.get("event_probe") or {}, ensure_ascii=False)
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      (function (global) {{
        "use strict";

        var config = {config_json};
        function hostLog(level, message) {{
          try {{ console.log(message); }} catch (_) {{}}
          try {{
            if (global.chrome && global.chrome.webview && global.chrome.webview.postMessage) {{
              global.chrome.webview.postMessage({{ type: "vf_log", level: level, message: message }});
            }}
          }} catch (_) {{}}
        }}

        hostLog("info", "[native-scene-probe] inline boot");

        function boot() {{
          var frames = Array.prototype.slice.call(document.querySelectorAll(".vf-frame"));
          var textarea = document.querySelector("textarea");
          hostLog("info", "[native-scene-probe] probe frames=" + frames.length + " textarea=" + (!!textarea));
          if (frames.length < 2 || !textarea) {{
            return false;
          }}

          frames.sort(function (a, b) {{
            return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
          }});

          var leftFrame = frames[0];
          var rightFrame = frames[1];
          var leftBody = leftFrame.querySelector(".vf-frame__body");
          if (!leftBody) {{
            hostLog("warn", "[native-scene-probe] left body missing");
            return false;
          }}

          var seq = 0;
          var counters = Object.create(null);
          var ruleByMatch = Object.create(null);
          var rules = Array.isArray(config.loop_rules) ? config.loop_rules : [];
          for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {{
            var rule = rules[ruleIndex];
            if (rule && typeof rule.match === "string") {{
              ruleByMatch[rule.match] = rule;
            }}
          }}
          var hasHoverRule = !!ruleByMatch.MouseHover;
          var hasMoveRule = !!ruleByMatch.MouseMove;

          function append(line) {{
            seq += 1;
            textarea.value += "[" + seq + "] " + line + "\\n";
            textarea.scrollTop = textarea.scrollHeight;
          }}

          function fmt(n) {{
            return Number(n).toFixed(3);
          }}

          function pos(ev) {{
            var r = leftBody.getBoundingClientRect();
            return {{ x: Math.round(ev.clientX - r.left), y: Math.round(ev.clientY - r.top) }};
          }}

          function formatStruct(fields, data) {{
            var parts = [];
            for (var i = 0; i < fields.length; i++) {{
              var key = fields[i];
              var value = data[key];
              if (value === undefined || value === null) {{
                value = "";
              }}
              parts.push(key + "=" + String(value));
            }}
            return parts.join(" ");
          }}

          function formatterFor(kind) {{
            var formatters = config.formatters || {{}};
            if (formatters[kind]) return formatters[kind];
            if (kind === "MouseHover" || kind === "MouseMove" || kind === "MouseDown" || kind === "MouseUp" || kind === "MouseDrag" || kind === "MouseWheel") {{
              return formatters.MouseEvent || formatters.default || [];
            }}
            if (kind === "KeyDown" || kind === "KeyUp") {{
              return formatters.KeyboardEvent || formatters.default || [];
            }}
            if (kind.indexOf("Frame") === 0) {{
              return formatters.FrameEvent || formatters.default || [];
            }}
            return formatters.default || [];
          }}

          function logKind(kind, data) {{
            var fields = formatterFor(kind);
            append(kind + " | " + formatStruct(fields, data));
          }}

          function shouldLogRule(rule) {{
            if (!rule.throttle) return true;
            var counter = String(rule.throttle.counter || "");
            counters[counter] = Number(counters[counter] || 0) + 1;
            return counters[counter] === Number(rule.throttle.first || 1) || (Number(rule.throttle.every || 0) > 0 && counters[counter] % Number(rule.throttle.every) === 0);
          }}

          function dispatchKind(kind, data) {{
            var rule = ruleByMatch[kind];
            if (rule) {{
              if (shouldLogRule(rule)) {{
                logKind(rule.label || kind, data);
              }}
              return;
            }}
            var fallbackRule = ruleByMatch["default"];
            if (fallbackRule) {{
              logKind(fallbackRule.label || "Other", data);
            }}
          }}

          function mouseEventData(eventName, ev, extra) {{
            var p = pos(ev);
            return Object.assign({{
              event: eventName,
              frame_id: "input_frame",
              widget_id: "",
              x: p.x,
              y: p.y,
              pick_id: 0,
              button: Number(ev.button || 0),
              buttons: Number(ev.buttons || 0)
            }}, extra || {{}});
          }}

          function keyEventData(eventName, ev) {{
            return {{
              event: eventName,
              frame_id: "input_frame",
              widget_id: "",
              key: String(ev.key || ""),
              code: String(ev.code || ""),
              ctrl: !!ev.ctrlKey,
              shift: !!ev.shiftKey,
              alt: !!ev.altKey
            }};
          }}

          function frameEventData(eventName, frameEl) {{
            var rect = frameEl.getBoundingClientRect();
            var dock = frameEl.classList.contains("vf-frame--minimized") ? "bl" : "";
            return {{
              event: eventName,
              frame_id: frameEl === rightFrame ? "log_frame" : "input_frame",
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              dock: dock
            }};
          }}

          var lastHeaderRect = null;
          var lastResizeRect = null;
          var header = leftFrame.querySelector(".vf-frame__header");
          var resizeGrip = leftFrame.querySelector(".vf-frame__resize-grip");
          var closeBtn = leftFrame.querySelector(".vf-close-btn");
          var minBtn = leftFrame.querySelector(".vf-min-btn, .vf-minimize-btn, button[aria-label='Minimize']");

          leftBody.tabIndex = 0;
          leftBody.addEventListener("pointerenter", function (ev) {{
            if (hasHoverRule) {{
              dispatchKind("MouseHover", mouseEventData("hover", ev));
            }}
          }});
          leftBody.addEventListener("pointermove", function (ev) {{
            if (ev.buttons) {{
              dispatchKind("MouseDrag", mouseEventData("drag", ev));
            }} else if (hasHoverRule) {{
              dispatchKind("MouseHover", mouseEventData("hover", ev));
            }} else if (hasMoveRule) {{
              dispatchKind("MouseMove", mouseEventData("move", ev));
            }}
          }});
          leftBody.addEventListener("pointerdown", function (ev) {{
            try {{ leftBody.setPointerCapture(ev.pointerId); }} catch (_) {{}}
            dispatchKind("MouseDown", mouseEventData("down", ev));
            leftBody.focus();
          }});
          leftBody.addEventListener("pointerup", function (ev) {{
            dispatchKind("MouseUp", mouseEventData("up", ev));
            try {{ leftBody.releasePointerCapture(ev.pointerId); }} catch (_) {{}}
          }});
          leftBody.addEventListener("wheel", function (ev) {{
            var p = pos(ev);
            dispatchKind("MouseWheel", {{
              event: "wheel",
              frame_id: "input_frame",
              widget_id: "",
              x: p.x,
              y: p.y,
              pick_id: 0,
              button: 0,
              buttons: Number(ev.buttons || 0)
            }});
          }}, {{ passive: true }});
          leftBody.addEventListener("keydown", function (ev) {{
            dispatchKind("KeyDown", keyEventData("keydown", ev));
          }});
          leftBody.addEventListener("keyup", function (ev) {{
            dispatchKind("KeyUp", keyEventData("keyup", ev));
          }});

          if (header) {{
            header.addEventListener("pointerdown", function () {{
              lastHeaderRect = leftFrame.getBoundingClientRect();
            }});
            header.addEventListener("pointerup", function () {{
              if (!lastHeaderRect) return;
              var nextRect = leftFrame.getBoundingClientRect();
              if (Math.round(nextRect.left) !== Math.round(lastHeaderRect.left) || Math.round(nextRect.top) !== Math.round(lastHeaderRect.top)) {{
                dispatchKind("FrameDragged", frameEventData("frame.dragged", leftFrame));
              }}
              lastHeaderRect = null;
            }});
          }}
          if (resizeGrip) {{
            resizeGrip.addEventListener("pointerdown", function () {{
              lastResizeRect = leftFrame.getBoundingClientRect();
            }});
            resizeGrip.addEventListener("pointerup", function () {{
              if (!lastResizeRect) return;
              var nextRect = leftFrame.getBoundingClientRect();
              if (Math.round(nextRect.width) !== Math.round(lastResizeRect.width) || Math.round(nextRect.height) !== Math.round(lastResizeRect.height)) {{
                dispatchKind("FrameResized", frameEventData("frame.resized", leftFrame));
              }}
              lastResizeRect = null;
            }});
          }}
          if (closeBtn) {{
            closeBtn.addEventListener("click", function () {{
              dispatchKind("FrameClosed", frameEventData("frame.closed", leftFrame));
            }});
          }}
          if (minBtn) {{
            minBtn.addEventListener("click", function () {{
              global.setTimeout(function () {{
                dispatchKind("FrameDocked", frameEventData("frame.docked", leftFrame));
              }}, 0);
            }});
          }}

          leftBody.focus();
          hostLog("info", "[native-scene-probe] ready");
          return true;
        }}

        var attempts = 0;
        function waitForFrames() {{
          attempts += 1;
          try {{
            if (boot()) {{
              return;
            }}
          }} catch (err) {{
            hostLog("error", "[native-scene-probe] crash " + (err && err.message ? err.message : String(err)));
            throw err;
          }}
          if (attempts < 240) {{
            global.setTimeout(waitForFrames, 16);
          }} else {{
            hostLog("error", "[native-scene-probe] timed out waiting for frames");
          }}
        }}

        if (document.readyState === "loading") {{
          document.addEventListener("DOMContentLoaded", waitForFrames, {{ once: true }});
        }} else {{
          waitForFrames();
        }}
      }})(typeof window !== "undefined" ? window : this);
    </script>
  </body>
</html>
"""


def _render_face_edge_vertex_drag_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(
        {
            "frame_id": spec["frame_id"],
            "points": spec["points"],
            "edge_pairs": spec["edge_pairs"],
            "aspect": str(spec.get("aspect", "equal")),
            "styles": spec.get("styles", {}),
            "drag": spec.get("drag", {}),
            "debug_frame_id": "fsm_debug_frame",
            "debug_widget_id": "fsm_debug_log",
        },
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      (function (global) {{
        "use strict";

        var config = {config_json};
        if (!global.__vfGeomFrameIds) {{
          global.__vfGeomFrameIds = Object.create(null);
        }}
        global.__vfGeomFrameIds[String(config.frame_id)] = true;
        // WebGPU 2-D ortho in vf-geom-wgpu maps negative world-z into visible
        // depth in [0,1]. Keep the face furthest back, then edges, then
        // vertices nearest the viewer.
        var FACE_BASE_Z = -0.030;
        var FACE_OVERLAY_Z = -0.029;
        var EDGE_BASE_Z = -0.020;
        var EDGE_OVERLAY_Z = -0.019;
        var VERTEX_BASE_Z = -0.010;
        var VERTEX_OVERLAY_Z = -0.009;
        var VERTEX_SEGMENTS = 16;
        var FACE_TRIANGLE_COUNT = 2;
        var EDGE_TRIANGLE_COUNT = 2 + (VERTEX_SEGMENTS * 2);
        var VERTEX_TRIANGLE_COUNT = VERTEX_SEGMENTS;
        var UNIT_CIRCLE = makeUnitCircle(VERTEX_SEGMENTS);
        var MAX_BOOT_ATTEMPTS = 240;
        var TRANSPORT_PATH = "./vf-geom-ledger-transport.json";

        function pageLog(level, message) {{
          var text = "ui_face_edge_vertex_drag: " + String(message);
          try {{
            if (global.console) {{
              if (level === "error" && global.console.error) {{
                global.console.error(text);
              }} else if (level === "warn" && global.console.warn) {{
                global.console.warn(text);
              }} else if (global.console.log) {{
                global.console.log(text);
              }}
            }}
          }} catch (_) {{}}
          try {{
            if (global.chrome && global.chrome.webview && global.chrome.webview.postMessage) {{
              global.chrome.webview.postMessage({{ type: "vf_log", level: level, message: text }});
            }}
          }} catch (_) {{}}
        }}

        function failFast(message, error) {{
          var text = String(message);
          if (error) {{
            var extra = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
            text += "\\n" + extra;
          }}
          pageLog("error", text);
          throw new Error(text);
        }}

        function requireDisplay() {{
          if (!global.VfDisplay || typeof global.VfDisplay.renderFromJson !== "function") {{
            failFast("VfDisplay.renderFromJson is unavailable; GPU display runtime not loaded");
          }}
        }}

        function requireGeomLedger() {{
          if (!global.VfGeomLedger || typeof global.VfGeomLedger.createStore !== "function") {{
            failFast("VfGeomLedger.createStore is unavailable; geometry ledger runtime not loaded");
          }}
          if (typeof global.VfGeomLedger.createTransportStore !== "function") {{
            failFast("VfGeomLedger.createTransportStore is unavailable; transport-backed ledger runtime not loaded");
          }}
          if (typeof global.VfGeomLedger.createRafPresenter !== "function") {{
            failFast("VfGeomLedger.createRafPresenter is unavailable; geometry ledger runtime not loaded");
          }}
          if (typeof global.VfGeomLedger.createFaceEdgeVertexController !== "function") {{
            failFast("VfGeomLedger.createFaceEdgeVertexController is unavailable; geometry ledger runtime not loaded");
          }}
          if (typeof global.VfGeomLedger.createFaceEdgeVertexSharedStore !== "function") {{
            failFast("VfGeomLedger.createFaceEdgeVertexSharedStore is unavailable; shared geometry ledger runtime not loaded");
          }}
          if (!global.VfGeomLedgerLayout || !global.VfGeomLedgerLayout.FACE_EDGE_VERTEX_STATE_FORMAT) {{
            failFast("VfGeomLedgerLayout is unavailable; shared geometry layout runtime not loaded");
          }}
          if (!global.VfGeomLedgerTransport || typeof global.VfGeomLedgerTransport.createSharedBufferTransport !== "function") {{
            failFast("VfGeomLedgerTransport.createSharedBufferTransport is unavailable; geometry ledger transport runtime not loaded");
          }}
        }}

        function loadGeomTransportDescriptor() {{
          return fetch(TRANSPORT_PATH, {{ cache: "no-store" }})
            .then(function (response) {{
              if (!response.ok) {{
                throw new Error("HTTP " + String(response.status) + " while loading " + TRANSPORT_PATH);
              }}
              return response.json();
            }})
            .then(function (descriptor) {{
              if (!descriptor || typeof descriptor !== "object") {{
                throw new Error("geometry transport descriptor is not an object");
              }}
              if (String(descriptor.kind || "") !== "shared-buffer") {{
                throw new Error("geometry transport kind must be shared-buffer for this example");
              }}
              return descriptor;
            }});
        }}

        function sceneWindow() {{
          var frame = document.querySelector('.vf-frame[data-vf-frame-id="' + config.frame_id + '"]');
          var body = frame ? (frame.querySelector(".vf-frame__body") || frame) : null;
          var canvas = body ? body.querySelector("canvas.vf-geom-canvas") : null;
          var rect = canvas && typeof canvas.getBoundingClientRect === "function"
            ? canvas.getBoundingClientRect()
            : (body && typeof body.getBoundingClientRect === "function" ? body.getBoundingClientRect() : null);
          var w = canvas && Number(canvas.width) > 0
            ? Number(canvas.width)
            : (rect ? Math.max(1, Math.round(Number(rect.width) || 1)) : (body ? Math.max(1, Number(body.clientWidth) || 1) : 1));
          var h = canvas && Number(canvas.height) > 0
            ? Number(canvas.height)
            : (rect ? Math.max(1, Math.round(Number(rect.height) || 1)) : (body ? Math.max(1, Number(body.clientHeight) || 1) : 1));
          var aspect = "";
          if (frame && frame.dataset && frame.dataset.vfAspect) {{
            aspect = String(frame.dataset.vfAspect || "").trim().toLowerCase();
          }} else {{
            aspect = String(config.aspect || "").trim().toLowerCase();
          }}
          if (aspect !== "equal") {{
            return {{
              width: w,
              height: h,
              fitSize: Math.min(w, h),
              left: 0,
              top: 0,
              sx: 1.0,
              sy: 1.0
            }};
          }}
          var fitSize = Math.max(1, Math.min(w, h));
          var left = (w - fitSize) * 0.5;
          var top = (h - fitSize) * 0.5;
          return {{
            width: w,
            height: h,
            fitSize: fitSize,
            left: left,
            top: top,
            sx: fitSize / w,
            sy: fitSize / h
          }};
        }}

        function clipPoint(p) {{
          var view = sceneWindow();
          return [
            (((view.left + Number(p[0]) * view.fitSize) / view.width) * 2) - 1,
            1 - (((view.top + Number(p[1]) * view.fitSize) / view.height) * 2)
          ];
        }}

        function makeUnitCircle(segments) {{
          var count = Math.max(3, Number(segments) | 0);
          var table = new Array(count);
          for (var i = 0; i < count; i += 1) {{
            var angle = (i / count) * Math.PI * 2;
            table[i] = [Math.cos(angle), Math.sin(angle)];
          }}
          return table;
        }}

        function pushVertex(vertices, point, z, color) {{
          vertices.push(
            Number(point[0]),
            Number(point[1]),
            Number(z),
            0.0, 0.0, 1.0,
            Number(color[0]),
            Number(color[1]),
            Number(color[2]),
            Number(color[3])
          );
          return (vertices.length / 10) - 1;
        }}

        function pushTriangle(vertices, indices, primitiveMeta, a, b, c, z, color, kind, index) {{
          var base = vertices.length / 10;
          pushVertex(vertices, a, z, color);
          pushVertex(vertices, b, z, color);
          pushVertex(vertices, c, z, color);
          indices.push(base, base + 1, base + 2);
          primitiveMeta.push({{ kind: kind, index: index }});
        }}

        function pushQuad(vertices, indices, primitiveMeta, a, b, c, d, z, color, kind, index) {{
          pushTriangle(vertices, indices, primitiveMeta, a, b, c, z, color, kind, index);
          pushTriangle(vertices, indices, primitiveMeta, a, c, d, z, color, kind, index);
        }}

        function polygonArea2(points) {{
          var sum = 0.0;
          for (var i = 0; i < points.length; i += 1) {{
            var p = points[i];
            var q = points[(i + 1) % points.length];
            sum += (Number(p[0]) * Number(q[1])) - (Number(q[0]) * Number(p[1]));
          }}
          return sum;
        }}

        function cross2(a, b, c) {{
          return (Number(b[0]) - Number(a[0])) * (Number(c[1]) - Number(a[1])) -
            (Number(b[1]) - Number(a[1])) * (Number(c[0]) - Number(a[0]));
        }}

        function pointInTriangle2(p, a, b, c) {{
          var c1 = cross2(a, b, p);
          var c2 = cross2(b, c, p);
          var c3 = cross2(c, a, p);
          var hasNeg = (c1 < 0) || (c2 < 0) || (c3 < 0);
          var hasPos = (c1 > 0) || (c2 > 0) || (c3 > 0);
          return !(hasNeg && hasPos);
        }}

        function pushFacePolygon(vertices, indices, primitiveMeta, points, z, color, kind, index) {{
          if (!Array.isArray(points) || points.length < 3) {{
            return;
          }}
          if (points.length === 3) {{
            pushTriangle(vertices, indices, primitiveMeta, points[0], points[1], points[2], z, color, kind, index);
            return;
          }}
          var winding = polygonArea2(points) >= 0 ? 1 : -1;
          var remaining = [];
          for (var i = 0; i < points.length; i += 1) {{
            remaining.push(i);
          }}
          var guard = 0;
          while (remaining.length > 3 && guard < 32) {{
            guard += 1;
            var earClipped = false;
            for (var r = 0; r < remaining.length; r += 1) {{
              var ia = remaining[(r + remaining.length - 1) % remaining.length];
              var ib = remaining[r];
              var ic = remaining[(r + 1) % remaining.length];
              var a = points[ia];
              var b = points[ib];
              var c = points[ic];
              var turn = cross2(a, b, c);
              if ((winding > 0 && turn <= 1e-9) || (winding < 0 && turn >= -1e-9)) {{
                continue;
              }}
              var containsOther = false;
              for (var t = 0; t < remaining.length; t += 1) {{
                var ip = remaining[t];
                if (ip === ia || ip === ib || ip === ic) {{
                  continue;
                }}
                if (pointInTriangle2(points[ip], a, b, c)) {{
                  containsOther = true;
                  break;
                }}
              }}
              if (containsOther) {{
                continue;
              }}
              pushTriangle(vertices, indices, primitiveMeta, a, b, c, z, color, kind, index);
              remaining.splice(r, 1);
              earClipped = true;
              break;
            }}
            if (!earClipped) {{
              break;
            }}
          }}
          if (remaining.length === 3) {{
            pushTriangle(
              vertices,
              indices,
              primitiveMeta,
              points[remaining[0]],
              points[remaining[1]],
              points[remaining[2]],
              z,
              color,
              kind,
              index
            );
            return;
          }}
          for (var fallback = 1; fallback + 1 < points.length; fallback += 1) {{
            pushTriangle(vertices, indices, primitiveMeta, points[0], points[fallback], points[fallback + 1], z, color, kind, index);
          }}
        }}

        function createFieldMeshBuffer(id, objectId, triangleCount, transparent) {{
          var vertexCount = triangleCount * 3;
          var indices = new Uint32Array(vertexCount);
          for (var i = 0; i < vertexCount; i += 1) {{
            indices[i] = i;
          }}
          return {{
            type: "field_mesh",
            id: id,
            object_id: objectId,
            mode3d: false,
            topology: "triangle-list",
            vertices: new Float32Array(vertexCount * 10),
            indices: indices,
            transparent: !!transparent,
            pickable: !transparent,
            depth_write: true,
            alpha: 1.0,
            alpha_mul: 1.0,
            alpha_provider: null,
            _vfTriangleCount: triangleCount,
            _vfTriangleCursor: 0
          }};
        }}

        function resetFieldMesh(mesh) {{
          mesh._vfTriangleCursor = 0;
        }}

        function writeMeshVertex(dst, vertexIndex, point, z, color) {{
          var offset = vertexIndex * 10;
          dst[offset + 0] = Number(point[0]);
          dst[offset + 1] = Number(point[1]);
          dst[offset + 2] = Number(z);
          dst[offset + 3] = 0.0;
          dst[offset + 4] = 0.0;
          dst[offset + 5] = 1.0;
          dst[offset + 6] = Number(color[0]);
          dst[offset + 7] = Number(color[1]);
          dst[offset + 8] = Number(color[2]);
          dst[offset + 9] = Number(color[3]);
        }}

        function writeMeshTriangle(mesh, a, b, c, z, color) {{
          var triIndex = mesh._vfTriangleCursor || 0;
          if (triIndex >= mesh._vfTriangleCount) {{
            return;
          }}
          var baseVertex = triIndex * 3;
          writeMeshVertex(mesh.vertices, baseVertex + 0, a, z, color);
          writeMeshVertex(mesh.vertices, baseVertex + 1, b, z, color);
          writeMeshVertex(mesh.vertices, baseVertex + 2, c, z, color);
          mesh._vfTriangleCursor = triIndex + 1;
        }}

        function zeroRemainingMeshTriangles(mesh) {{
          var triIndex = mesh._vfTriangleCursor || 0;
          while (triIndex < mesh._vfTriangleCount) {{
            var baseVertex = triIndex * 3;
            writeMeshVertex(mesh.vertices, baseVertex + 0, [0, 0], 0, [0, 0, 0, 0]);
            writeMeshVertex(mesh.vertices, baseVertex + 1, [0, 0], 0, [0, 0, 0, 0]);
            writeMeshVertex(mesh.vertices, baseVertex + 2, [0, 0], 0, [0, 0, 0, 0]);
            triIndex += 1;
          }}
          mesh._vfTriangleCursor = mesh._vfTriangleCount;
        }}

        function segmentIntersection2(a, b, c, d) {{
          var ax = Number(a[0]); var ay = Number(a[1]);
          var bx = Number(b[0]); var by = Number(b[1]);
          var cx = Number(c[0]); var cy = Number(c[1]);
          var dx = Number(d[0]); var dy = Number(d[1]);
          var rX = bx - ax;
          var rY = by - ay;
          var sX = dx - cx;
          var sY = dy - cy;
          var denom = (rX * sY) - (rY * sX);
          if (Math.abs(denom) < 1e-9) {{
            return null;
          }}
          var qpx = cx - ax;
          var qpy = cy - ay;
          var t = ((qpx * sY) - (qpy * sX)) / denom;
          var u = ((qpx * rY) - (qpy * rX)) / denom;
          if (t <= 1e-6 || t >= (1 - 1e-6) || u <= 1e-6 || u >= (1 - 1e-6)) {{
            return null;
          }}
          return [ax + (t * rX), ay + (t * rY)];
        }}

        function triangulateQuad(points) {{
          var hitABCD = segmentIntersection2(points[0], points[1], points[2], points[3]);
          if (hitABCD) {{
            return [
              [points[0], points[3], hitABCD],
              [points[1], points[2], hitABCD]
            ];
          }}
          var hitBCDA = segmentIntersection2(points[1], points[2], points[3], points[0]);
          if (hitBCDA) {{
            return [
              [points[1], points[0], hitBCDA],
              [points[2], points[3], hitBCDA]
            ];
          }}
          var winding = polygonArea2(points) >= 0 ? 1 : -1;
          for (var i = 0; i < 4; i += 1) {{
            var ia = (i + 3) % 4;
            var ib = i;
            var ic = (i + 1) % 4;
            var id = (i + 2) % 4;
            var a = points[ia];
            var b = points[ib];
            var c = points[ic];
            var d = points[id];
            var turn = cross2(a, b, c);
            if ((winding > 0 && turn <= 1e-9) || (winding < 0 && turn >= -1e-9)) {{
              continue;
            }}
            if (pointInTriangle2(d, a, b, c)) {{
              continue;
            }}
            return [
              [a, b, c],
              [a, c, d]
            ];
          }}
          return [
            [points[0], points[1], points[2]],
            [points[0], points[2], points[3]]
          ];
        }}

        function writeFaceMesh(mesh, faceClip, z, color) {{
          resetFieldMesh(mesh);
          var triangles = triangulateQuad(faceClip);
          for (var i = 0; i < triangles.length; i += 1) {{
            writeMeshTriangle(mesh, triangles[i][0], triangles[i][1], triangles[i][2], z, color);
          }}
          zeroRemainingMeshTriangles(mesh);
        }}

        function writeCircleMesh(mesh, centerNorm, radius, segments, z, color) {{
          resetFieldMesh(mesh);
          var center = clipPoint(centerNorm);
          var cx = Number(centerNorm[0]);
          var cy = Number(centerNorm[1]);
          var unitCircle = Number(segments) === VERTEX_SEGMENTS ? UNIT_CIRCLE : makeUnitCircle(segments);
          for (var i = 0; i < unitCircle.length; i += 1) {{
            var p0u = unitCircle[i];
            var p1u = unitCircle[(i + 1) % unitCircle.length];
            var p0 = clipPoint([
              cx + p0u[0] * Number(radius),
              cy + p0u[1] * Number(radius)
            ]);
            var p1 = clipPoint([
              cx + p1u[0] * Number(radius),
              cy + p1u[1] * Number(radius)
            ]);
            writeMeshTriangle(mesh, center, p0, p1, z, color);
          }}
          zeroRemainingMeshTriangles(mesh);
        }}

        function writeCapsuleMesh(mesh, aNorm, bNorm, radiusNorm, z, color) {{
          resetFieldMesh(mesh);
          var ax = Number(aNorm[0]);
          var ay = Number(aNorm[1]);
          var bx = Number(bNorm[0]);
          var by = Number(bNorm[1]);
          var dx = bx - ax;
          var dy = by - ay;
          var len = Math.sqrt(dx * dx + dy * dy);
          var px;
          var py;
          if (!(len > 0)) {{
            px = Number(radiusNorm);
            py = 0;
          }} else {{
            var ux = dx / len;
            var uy = dy / len;
            px = -uy * Number(radiusNorm);
            py = ux * Number(radiusNorm);
          }}
          var q0 = clipPoint([ax + px, ay + py]);
          var q1 = clipPoint([bx + px, by + py]);
          var q2 = clipPoint([bx - px, by - py]);
          var q3 = clipPoint([ax - px, ay - py]);
          writeMeshTriangle(mesh, q0, q1, q2, z, color);
          writeMeshTriangle(mesh, q0, q2, q3, z, color);
          var circleCenters = [aNorm, bNorm];
          for (var ci = 0; ci < circleCenters.length; ci += 1) {{
            var centerNorm = circleCenters[ci];
            var center = clipPoint(centerNorm);
            var ccx = Number(centerNorm[0]);
            var ccy = Number(centerNorm[1]);
            for (var seg = 0; seg < UNIT_CIRCLE.length; seg += 1) {{
              var p0u = UNIT_CIRCLE[seg];
              var p1u = UNIT_CIRCLE[(seg + 1) % UNIT_CIRCLE.length];
              var p0 = clipPoint([
                ccx + p0u[0] * Number(radiusNorm),
                ccy + p0u[1] * Number(radiusNorm)
              ]);
              var p1 = clipPoint([
                ccx + p1u[0] * Number(radiusNorm),
                ccy + p1u[1] * Number(radiusNorm)
              ]);
              writeMeshTriangle(mesh, center, p0, p1, z, color);
            }}
          }}
          zeroRemainingMeshTriangles(mesh);
        }}

        function boot(sharedBuffers) {{
          requireDisplay();
          requireGeomLedger();
          pageLog("info", "boot: checking frames");
          if (!global.__vfLocalOnlyFrameEvents) {{
            global.__vfLocalOnlyFrameEvents = Object.create(null);
          }}
          global.__vfLocalOnlyFrameEvents[config.frame_id] = true;
          var frame = document.querySelector('.vf-frame[data-vf-frame-id="' + config.frame_id + '"]');
          var debugFrame = document.querySelector('.vf-frame[data-vf-frame-id="' + config.debug_frame_id + '"]');
          var debugArea = debugFrame ? debugFrame.querySelector("textarea") : document.querySelector("textarea");
          if (!frame || !debugArea) {{
            return false;
          }}

          var geomBody = frame.querySelector(".vf-frame__body") || frame;
          var resizeObserver = null;
          var resizeRaf = 0;
          var controller = global.VfGeomLedger.createFaceEdgeVertexController({{
            points: config.points,
            edgePairs: config.edge_pairs,
            dragConfig: config.drag || {{}}
          }});

          if (!sharedBuffers || !sharedBuffers.headerBuffer || !sharedBuffers.stateBuffer) {{
            failFast("shared geometry buffers not available from host");
          }}

          if (!global.__vfGeomTransportDescriptor || String(global.__vfGeomTransportDescriptor.kind || "") !== "shared-buffer") {{
            failFast("geometry transport descriptor must require shared-buffer for this example");
          }}

          var ledger = global.VfGeomLedger.createFaceEdgeVertexSharedStore({{
            headerBuffer: sharedBuffers.headerBuffer,
            stateBuffer: sharedBuffers.stateBuffer,
            points: config.points,
            edgePairs: config.edge_pairs,
            buildSnapshot: function (state) {{
              return {{
                geomSpec: currentGeomSpec()
              }};
            }}
          }});
          var state = ledger.readState();
          var lastDebugText = "";
          var lastDebugPaintTs = -1;
          var presenter = global.VfGeomLedger.createRafPresenter(ledger, function (snapshot) {{
            var now = (global.performance && typeof global.performance.now === "function")
              ? global.performance.now()
              : Date.now();
            var dragging = !!(state && state.drag && state.drag.active);
            var nextDebugText = null;
            var debugChanged = false;
            if (!dragging || lastDebugPaintTs < 0 || (now - lastDebugPaintTs) >= 80) {{
              nextDebugText = controller.buildDebugText(state);
              debugChanged = nextDebugText !== lastDebugText;
            }}
            if (debugChanged && (!dragging || lastDebugPaintTs < 0 || (now - lastDebugPaintTs) >= 80)) {{
              debugArea.value = nextDebugText;
              debugArea.scrollTop = 0;
              lastDebugText = nextDebugText;
              lastDebugPaintTs = now;
            }}
          }});

          function requestRenderForResize() {{
            if (resizeRaf) {{
              return;
            }}
            resizeRaf = global.requestAnimationFrame(function () {{
              resizeRaf = 0;
              ledger.touch();
            }});
          }}

          function styleState(kind, index) {{
            var hovered = state.hover && state.hover.kind === kind && Number(state.hover.index) === Number(index);
            var selected = false;
            if (kind === "face") {{
              selected = !!(state.selection && state.selection.faceSelected);
            }} else if (kind === "edge") {{
              selected = !!(state.selection && state.selection.edgeSelected && state.selection.edgeSelected[index]);
            }} else if (kind === "vertex") {{
              selected = !!(state.selection && state.selection.vertexSelected && state.selection.vertexSelected[index]);
            }}
            if (selected) {{
              return "selected";
            }}
            if (hovered) {{
              return "hover";
            }}
            return "none";
          }}

          function styleConfig(kind) {{
            var styles = config.styles || {{}};
            var style = styles[kind];
            if (!style) {{
              failFast("missing VKF style config for kind " + String(kind));
            }}
            return style;
          }}

          function styleColor(kind, layer, index) {{
            var style = styleConfig(kind);
            if (layer === "base") {{
              return style.base_color;
            }}
            var stateKey = styleState(kind, index);
            var overlayColors = style.overlay_colors || {{}};
            var color = overlayColors[stateKey];
            if (!Array.isArray(color) || color.length !== 4) {{
              failFast("missing overlay color for " + String(kind) + " state " + String(stateKey));
            }}
            return color;
          }}

          function styleScale(kind, layer, index) {{
            var style = styleConfig(kind);
            if (kind === "face") {{
              return 0.0;
            }}
            if (layer === "base") {{
              return Number(style.base_scale);
            }}
            var stateKey = styleState(kind, index);
            var overlayScales = style.overlay_scales || {{}};
            var value = Number(overlayScales[stateKey]);
            if (!(value > 0)) {{
              failFast("missing overlay scale for " + String(kind) + " state " + String(stateKey));
            }}
            return value;
          }}

          function meshObjectId(kind, index) {{
            if (kind === "face") {{ return 1; }}
            if (kind === "edge") {{ return index + 2; }}
            if (kind === "vertex") {{ return index + 6; }}
            failFast("unknown object id mesh kind " + String(kind));
          }}

          function createSceneCache() {{
            var meshes = [
              createFieldMeshBuffer("face_edge_vertex_drag_face_0_base", meshObjectId("face", 0), FACE_TRIANGLE_COUNT, false),
              createFieldMeshBuffer("face_edge_vertex_drag_face_0_overlay", meshObjectId("face", 0), FACE_TRIANGLE_COUNT, true)
            ];
            for (var edgeIndex = 0; edgeIndex < 4; edgeIndex += 1) {{
              meshes.push(createFieldMeshBuffer("face_edge_vertex_drag_edge_" + String(edgeIndex) + "_base", meshObjectId("edge", edgeIndex), EDGE_TRIANGLE_COUNT, false));
              meshes.push(createFieldMeshBuffer("face_edge_vertex_drag_edge_" + String(edgeIndex) + "_overlay", meshObjectId("edge", edgeIndex), EDGE_TRIANGLE_COUNT, true));
            }}
            for (var vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {{
              meshes.push(createFieldMeshBuffer("face_edge_vertex_drag_vertex_" + String(vertexIndex) + "_base", meshObjectId("vertex", vertexIndex), VERTEX_TRIANGLE_COUNT, false));
              meshes.push(createFieldMeshBuffer("face_edge_vertex_drag_vertex_" + String(vertexIndex) + "_overlay", meshObjectId("vertex", vertexIndex), VERTEX_TRIANGLE_COUNT, true));
            }}
            return {{
              unified_renderer: true,
              meshes: meshes
            }};
          }}

          var sceneCache = createSceneCache();

          function currentGeomSpec() {{
            var faceClip = state.points.map(clipPoint);
            writeFaceMesh(sceneCache.meshes[0], faceClip, FACE_BASE_Z, styleColor("face", "base", 0));
            writeFaceMesh(sceneCache.meshes[1], faceClip, FACE_OVERLAY_Z, styleColor("face", "overlay", 0));
            var meshIndex = 2;
            for (var edgeIndex = 0; edgeIndex < 4; edgeIndex += 1) {{
              var pair = state.edgePairs[edgeIndex];
              writeCapsuleMesh(
                sceneCache.meshes[meshIndex],
                state.points[pair[0]],
                state.points[pair[1]],
                styleScale("edge", "base", edgeIndex),
                EDGE_BASE_Z,
                styleColor("edge", "base", edgeIndex)
              );
              meshIndex += 1;
              writeCapsuleMesh(
                sceneCache.meshes[meshIndex],
                state.points[pair[0]],
                state.points[pair[1]],
                styleScale("edge", "overlay", edgeIndex),
                EDGE_OVERLAY_Z,
                styleColor("edge", "overlay", edgeIndex)
              );
              meshIndex += 1;
            }}
            for (var vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {{
              writeCircleMesh(
                sceneCache.meshes[meshIndex],
                state.points[vertexIndex],
                styleScale("vertex", "base", vertexIndex),
                VERTEX_SEGMENTS,
                VERTEX_BASE_Z,
                styleColor("vertex", "base", vertexIndex)
              );
              meshIndex += 1;
              writeCircleMesh(
                sceneCache.meshes[meshIndex],
                state.points[vertexIndex],
                styleScale("vertex", "overlay", vertexIndex),
                VERTEX_SEGMENTS,
                VERTEX_OVERLAY_Z,
                styleColor("vertex", "overlay", vertexIndex)
              );
              meshIndex += 1;
            }}
            return sceneCache;
          }}

          function handleVfEvent(ev) {{
            var payload = ev && ev.detail ? ev.detail : null;
            if (!payload || String(payload.frame_id || "") !== config.frame_id) {{
              return;
            }}
            ledger.mutate(function () {{
              return controller.applyEvent(state, payload);
            }});
          }}

          global.addEventListener("vf_event", handleVfEvent);
          if (!global.VfDisplay || typeof global.VfDisplay.mountLedgerGeomFrame !== "function") {{
            failFast("VfDisplay.mountLedgerGeomFrame is missing");
          }}
          global.VfDisplay.mountLedgerGeomFrame(config.frame_id, ledger, function (snapshot) {{
            return snapshot.geomSpec;
          }});
          if (typeof global.ResizeObserver === "function" && geomBody) {{
            resizeObserver = new global.ResizeObserver(function () {{
              requestRenderForResize();
            }});
            resizeObserver.observe(geomBody);
          }}
          global.addEventListener("beforeunload", function () {{
            try {{
              if (global.__vfLocalOnlyFrameEvents) {{
                delete global.__vfLocalOnlyFrameEvents[config.frame_id];
              }}
            }} catch (_) {{}}
            if (presenter) {{
              try {{ presenter.dispose(); }} catch (_) {{}}
            }}
            if (resizeObserver) {{
              try {{ resizeObserver.disconnect(); }} catch (_) {{}}
              resizeObserver = null;
            }}
          }}, {{ once: true }});
          presenter.request();
          pageLog("info", "boot: complete");
          return true;
        }}

        function waitForFrame(sharedBuffers, attempt) {{
          pageLog("info", "waitForFrame attempt=" + String(attempt));
          if (!global.VfDisplay || typeof global.VfDisplay.renderFromJson !== "function") {{
            if (Number(attempt) >= MAX_BOOT_ATTEMPTS) {{
              failFast("VfDisplay.renderFromJson never became available");
            }}
            global.setTimeout(function () {{ waitForFrame(sharedBuffers, Number(attempt) + 1); }}, 16);
            return;
          }}
          if (boot(sharedBuffers)) return;
          if (Number(attempt) >= MAX_BOOT_ATTEMPTS) {{
            failFast("expected frames " + config.frame_id + " and " + config.debug_frame_id + " were not created");
          }}
          global.setTimeout(function () {{ waitForFrame(sharedBuffers, Number(attempt) + 1); }}, 16);
        }}

        function startWhenReady() {{
          pageLog("info", "startWhenReady");
          var shell = global.VfRuntimeShell || null;
          if (shell && typeof shell.ensureSceneDependencies === "function") {{
            shell.ensureSceneDependencies().then(function () {{
              pageLog("info", "scene dependencies ready");
              return loadGeomTransportDescriptor();
            }}).then(function (descriptor) {{
              global.__vfGeomTransportDescriptor = descriptor;
              if (typeof shell.requestSharedBuffers !== "function" || typeof shell.waitForSharedBuffers !== "function") {{
                failFast("VfRuntimeShell shared buffer bridge unavailable");
              }}
              shell.requestSharedBuffers("scene", config.frame_id);
              return shell.waitForSharedBuffers("scene", config.frame_id);
            }}).then(function (sharedBuffers) {{
              pageLog("info", "shared buffers resolved");
              waitForFrame(sharedBuffers, 0);
            }}).catch(function (error) {{
              failFast("scene dependency bootstrap failed", error);
            }});
            return;
          }}
          loadGeomTransportDescriptor().then(function (descriptor) {{
            global.__vfGeomTransportDescriptor = descriptor;
            if (!global.VfRuntimeShell || typeof global.VfRuntimeShell.requestSharedBuffers !== "function" || typeof global.VfRuntimeShell.waitForSharedBuffers !== "function") {{
              failFast("VfRuntimeShell shared buffer bridge unavailable");
            }}
            global.VfRuntimeShell.requestSharedBuffers("scene", config.frame_id);
            return global.VfRuntimeShell.waitForSharedBuffers("scene", config.frame_id);
          }}).then(function (sharedBuffers) {{
            pageLog("info", "shared buffers resolved");
            waitForFrame(sharedBuffers, 0);
          }}).catch(function (error) {{
            failFast("geometry transport bootstrap failed", error);
          }});
        }}

        if (document.readyState === "loading") {{
          document.addEventListener("DOMContentLoaded", startWhenReady, {{ once: true }});
        }} else {{
          startWhenReady();
        }}
      }})(typeof window !== "undefined" ? window : this);
    </script>
  </body>
</html>
"""
