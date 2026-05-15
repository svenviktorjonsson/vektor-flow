from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import time
from typing import Any, Callable

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


@dataclass(frozen=True)
class _NativeSceneCompiler:
    default_session_name: str
    normalize_spec: Callable[[dict[str, Any]], dict[str, Any]]
    render_html: Callable[[dict[str, Any]], str]
    render_runtime_packets: Callable[[dict[str, Any]], str]
    render_geom_transport: Callable[[dict[str, Any]], str] | None = None
    render_geom_state: Callable[[dict[str, Any]], str] | None = None


def try_build_native_overlay_scene_program(source_path: Path) -> NativeOverlaySceneProgram | None:
    source_text = source_path.read_text(encoding="utf-8")
    module = parse_module(source_text, filename=source_path.as_posix())
    declared = _find_top_level_struct_binding(module, "native_scene")
    if declared is not None:
        return _compile_native_scene_program(source_path, declared)
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


def _compile_native_scene_program(source_path: Path, declared: dict[str, Any]) -> NativeOverlaySceneProgram:
    kind = _require_string_value(declared, "kind")
    compiler = _NATIVE_SCENE_COMPILERS.get(kind)
    if compiler is None:
        supported = ", ".join(sorted(_NATIVE_SCENE_COMPILERS))
        raise ValueError(f"unsupported native_scene.kind {kind!r}; expected one of: {supported}")
    spec = compiler.normalize_spec(declared)
    session_name = _slugify(source_path.stem or compiler.default_session_name)
    return NativeOverlaySceneProgram(
        session_name=session_name,
        page_rel=f"sessions/{session_name}/vkf-scene.html",
        html_text=compiler.render_html(spec),
        runtime_packets_text=compiler.render_runtime_packets(spec),
        geom_transport_text="" if compiler.render_geom_transport is None else compiler.render_geom_transport(spec),
        geom_state_text="" if compiler.render_geom_state is None else compiler.render_geom_state(spec),
    )


def _normalize_face_edge_vertex_drag_spec(declared: dict[str, Any]) -> dict[str, Any]:
    styles = _require_struct_value(declared, "styles")
    face_style = _require_struct_value(styles, "face")
    edge_style = _require_struct_value(styles, "edge")
    vertex_style = _require_struct_value(styles, "vertex")
    drag = _require_struct_value(declared, "drag")
    return {
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "aspect": _require_string_value(declared, "aspect"),
        "points": _require_point_list(declared, "points"),
        "edge_pairs": _require_index_pairs(declared, "edge_pairs"),
        "styles": {
            "face": {
                "base_color": _require_rgba(face_style, "base_color"),
                "overlay_colors": _require_overlay_colors(face_style, "overlay_colors"),
            },
            "edge": {
                "base_color": _require_rgba(edge_style, "base_color"),
                "overlay_colors": _require_overlay_colors(edge_style, "overlay_colors"),
                "base_scale": _require_number_value(edge_style, "base_scale"),
                "overlay_scales": _require_overlay_scales(edge_style, "overlay_scales"),
            },
            "vertex": {
                "base_color": _require_rgba(vertex_style, "base_color"),
                "overlay_colors": _require_overlay_colors(vertex_style, "overlay_colors"),
                "base_scale": _require_number_value(vertex_style, "base_scale"),
                "overlay_scales": _require_overlay_scales(vertex_style, "overlay_scales"),
            },
        },
        "drag": {
            "face_vertices": _require_int_list(drag, "face_vertices"),
            "edge_vertices": _require_index_pairs(drag, "edge_vertices"),
            "vertex_vertices": _require_nested_int_list(drag, "vertex_vertices"),
            "preserve_selected_on_plain_down": _require_bool_value(drag, "preserve_selected_on_plain_down"),
        },
    }


def _normalize_cube_hover_spec(declared: dict[str, Any]) -> dict[str, Any]:
    kind = _require_string_value(declared, "kind")
    styles = _require_struct_value(declared, "styles")
    camera = _optional_camera_value(declared)
    light = _optional_light_value(declared)
    return {
        "kind": str(kind),
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "debug_frame_id": _require_string_value(declared, "debug_frame_id"),
        "debug_title": _require_string_value(declared, "debug_title"),
        "debug_rect": tuple(_require_number_list(declared, "debug_rect", length=4)),
        "edge_radius": _require_number_value(declared, "edge_radius"),
        "vertex_radius": _require_number_value(declared, "vertex_radius"),
        "styles": {
            "face_base": _require_rgba(styles, "face_base"),
            "face_hover": _require_rgba(styles, "face_hover"),
            "edge_base": _require_rgba(styles, "edge_base"),
            "edge_hover": _require_rgba(styles, "edge_hover"),
            "vertex_base": _require_rgba(styles, "vertex_base"),
            "vertex_hover": _require_rgba(styles, "vertex_hover"),
        },
        "camera": camera,
        "light": light,
    }


def _normalize_ocean_wave_spec(declared: dict[str, Any]) -> dict[str, Any]:
    surface = _require_struct_value(declared, "surface")
    styles = _require_struct_value(declared, "styles")
    timing = _optional_ocean_timing_value(declared)
    return {
        "kind": "ocean_wave",
        "frame_id": _require_string_value(declared, "frame_id"),
        "title": _require_string_value(declared, "title"),
        "rect": tuple(_require_number_list(declared, "rect", length=4)),
        "surface": {
            "u_min": _require_number_value(surface, "u_min"),
            "u_max": _require_number_value(surface, "u_max"),
            "u_steps": _require_positive_int_value(surface, "u_steps", minimum=2),
            "v_min": _require_number_value(surface, "v_min"),
            "v_max": _require_number_value(surface, "v_max"),
            "v_steps": _require_positive_int_value(surface, "v_steps", minimum=2),
            "face_subdivisions": _optional_positive_int_value(surface, "face_subdivisions", default=4, minimum=1),
        },
        "styles": {
            "face_color": _require_rgba(styles, "face_color"),
            "edge_color": _require_rgba(styles, "edge_color"),
            "vertex_color": _optional_number_list(styles, "vertex_color", [1.0, 0.45, 0.18, 1.0], length=4),
            "edge_width": _optional_number_value(styles, "edge_width", 1.0),
            "vertex_size": _optional_number_value(styles, "vertex_size", 0.12),
            "show_edges": _optional_bool_value(styles, "show_edges", True),
            "show_vertices": _optional_bool_value(styles, "show_vertices", False),
            "edge_caps": _optional_bool_value(styles, "edge_caps", False),
            "face_light_model": _optional_string_value(styles, "face_light_model", "blinn_phong"),
        },
        "camera": _optional_ocean_camera_value(declared),
        "light": _optional_ocean_light_value(declared),
        "timing": timing,
        "waves": _require_wave_specs(declared, "waves"),
    }


def _find_top_level_struct_binding(module: ast.Module, name: str) -> dict[str, Any] | None:
    for stmt in module.statements:
        if isinstance(stmt, ast.Bind) and isinstance(stmt.target, ast.Ident) and stmt.target.name == name:
            value = _eval_native_scene_literal(stmt.value, f"{name}")
            if not isinstance(value, dict):
                raise ValueError(f"{name} must be a struct literal")
            return value
    return None


def _eval_native_scene_literal(expr: Any, path: str) -> Any:
    if isinstance(expr, ast.StructLit):
        return {key: _eval_native_scene_literal(value, f"{path}.{key}") for key, value in expr.fields}
    if isinstance(expr, ast.ListLit):
        return [_eval_native_scene_literal(value, f"{path}[]") for value in expr.elements]
    if isinstance(expr, ast.TupleLit):
        return [_eval_native_scene_literal(value, f"{path}[]") for value in expr.elements]
    if isinstance(expr, ast.StringLit):
        return expr.value
    if isinstance(expr, ast.NumberLit):
        return expr.value
    if isinstance(expr, ast.BoolLit):
        return expr.value
    if isinstance(expr, ast.NullLit):
        return None
    if isinstance(expr, ast.UnaryOp):
        operand = _eval_native_scene_literal(expr.operand, f"{path}.operand")
        if not isinstance(operand, (int, float)) or isinstance(operand, bool):
            raise ValueError(f"{path} unary operand must be numeric")
        if expr.op == "MINUS":
            return -float(operand)
        if expr.op == "PLUS":
            return float(operand)
    raise ValueError(f"{path} must be a literal value; got {type(expr).__name__}")


def _require_field(scope: dict[str, Any], name: str) -> Any:
    if name not in scope:
        raise ValueError(f"native_scene missing field {name!r}")
    return scope[name]


def _require_struct_value(scope: dict[str, Any], name: str) -> dict[str, Any]:
    value = _require_field(scope, name)
    if not isinstance(value, dict):
        raise ValueError(f"native_scene.{name} must be a struct")
    return value


def _require_string_value(scope: dict[str, Any], name: str) -> str:
    value = _require_field(scope, name)
    if not isinstance(value, str):
        raise ValueError(f"native_scene.{name} must be a string")
    return value


def _require_bool_value(scope: dict[str, Any], name: str) -> bool:
    value = _require_field(scope, name)
    if not isinstance(value, bool):
        raise ValueError(f"native_scene.{name} must be a bool")
    return value


def _require_number_value(scope: dict[str, Any], name: str) -> float:
    value = _require_field(scope, name)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"native_scene.{name} must be a number")
    return float(value)


def _require_number_list(scope: dict[str, Any], name: str, *, length: int | None = None) -> list[float]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[float] = []
    for item in value:
        if not isinstance(item, (int, float)) or isinstance(item, bool):
            raise ValueError(f"native_scene.{name} must contain only numbers")
        out.append(float(item))
    if length is not None and len(out) != length:
        raise ValueError(f"native_scene.{name} must contain exactly {length} numbers")
    return out


def _require_int_list(scope: dict[str, Any], name: str) -> list[int]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[int] = []
    for item in value:
        if not isinstance(item, (int, float)) or isinstance(item, bool) or int(item) != float(item):
            raise ValueError(f"native_scene.{name} must contain only integers")
        out.append(int(item))
    return out


def _require_nested_int_list(scope: dict[str, Any], name: str) -> list[list[int]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[int]] = []
    for row in value:
        if not isinstance(row, list):
            raise ValueError(f"native_scene.{name} must contain integer lists")
        inner: list[int] = []
        for item in row:
            if not isinstance(item, (int, float)) or isinstance(item, bool) or int(item) != float(item):
                raise ValueError(f"native_scene.{name} must contain only integers")
            inner.append(int(item))
        out.append(inner)
    return out


def _require_point_list(scope: dict[str, Any], name: str) -> list[list[float]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[float]] = []
    for point in value:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError(f"native_scene.{name} must contain [x, y] points")
        out.append([float(point[0]), float(point[1])])
    return out


def _require_index_pairs(scope: dict[str, Any], name: str) -> list[list[int]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[list[int]] = []
    for pair in value:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"native_scene.{name} must contain [a, b] pairs")
        out.append([int(pair[0]), int(pair[1])])
    return out


def _require_rgba(scope: dict[str, Any], name: str) -> list[float]:
    return _require_number_list(scope, name, length=4)


def _require_positive_int_value(scope: dict[str, Any], name: str, *, minimum: int = 0) -> int:
    value = _require_number_value(scope, name)
    if int(value) != value:
        raise ValueError(f"native_scene.{name} must be an integer")
    out = int(value)
    if out < minimum:
        raise ValueError(f"native_scene.{name} must be >= {minimum}")
    return out


def _optional_number_value(scope: dict[str, Any], name: str, default: float) -> float:
    if name not in scope:
        return default
    return _require_number_value(scope, name)


def _optional_positive_int_value(scope: dict[str, Any], name: str, default: int, *, minimum: int = 0) -> int:
    if name not in scope:
        return default
    return _require_positive_int_value(scope, name, minimum=minimum)


def _optional_string_value(scope: dict[str, Any], name: str, default: str) -> str:
    if name not in scope:
        return default
    return _require_string_value(scope, name)


def _optional_bool_value(scope: dict[str, Any], name: str, default: bool) -> bool:
    if name not in scope:
        return default
    return _require_bool_value(scope, name)


def _optional_number_list(
    scope: dict[str, Any], name: str, default: list[float], *, length: int | None = None
) -> list[float]:
    if name not in scope:
        return list(default)
    return _require_number_list(scope, name, length=length)


def _optional_struct_value(scope: dict[str, Any], name: str) -> dict[str, Any] | None:
    if name not in scope:
        return None
    return _require_struct_value(scope, name)


def _require_struct_list(scope: dict[str, Any], name: str) -> list[dict[str, Any]]:
    value = _require_field(scope, name)
    if not isinstance(value, list):
        raise ValueError(f"native_scene.{name} must be a list")
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError(f"native_scene.{name} must contain struct values")
        out.append(item)
    return out


def _optional_camera_value(scope: dict[str, Any]) -> dict[str, Any]:
    camera = _optional_struct_value(scope, "camera")
    if camera is None:
        return {
            "pos": [3.2, 2.4, 4.0],
            "target": [0.0, 0.0, 0.0],
            "fov": 42.0,
            "up": [0.0, 1.0, 0.0],
        }
    return {
        "pos": _optional_number_list(camera, "pos", [3.2, 2.4, 4.0], length=3),
        "target": _optional_number_list(camera, "target", [0.0, 0.0, 0.0], length=3),
        "fov": _optional_number_value(camera, "fov", 42.0),
        "up": _optional_number_list(camera, "up", [0.0, 1.0, 0.0], length=3),
    }


def _optional_light_value(scope: dict[str, Any]) -> dict[str, Any]:
    light = _optional_struct_value(scope, "light")
    if light is None:
        return {
            "pos": [4.0, 5.0, 6.0],
            "target": [0.0, 0.0, 0.0],
            "orbit": False,
            "orbit_radius": 4.5,
            "height": 3.2,
            "theta": 0.0,
            "angular_velocity": 0.0,
            "model": "flat",
            "color": "white",
        }
    color = light.get("color", "white")
    if not isinstance(color, str) and not isinstance(color, list):
        raise ValueError("native_scene.light.color must be a string or rgba list")
    if isinstance(color, list):
        color = _require_number_list(light, "color", length=4)
    return {
        "pos": _optional_number_list(light, "pos", [4.0, 5.0, 6.0], length=3),
        "target": _optional_number_list(light, "target", [0.0, 0.0, 0.0], length=3),
        "orbit": _optional_bool_value(light, "orbit", False),
        "orbit_radius": _optional_number_value(light, "orbit_radius", 4.5),
        "height": _optional_number_value(light, "height", 3.2),
        "theta": _optional_number_value(light, "theta", 0.0),
        "angular_velocity": _optional_number_value(light, "angular_velocity", 0.0),
        "model": _optional_string_value(light, "model", "flat"),
        "color": color,
    }


def _optional_ocean_camera_value(scope: dict[str, Any]) -> dict[str, Any]:
    camera = _optional_struct_value(scope, "camera")
    if camera is None:
        return {
            "target": [0.0, 0.0, 0.0],
            "radius": 9.6,
            "height": 3.2,
            "theta": 0.1,
            "turns_per_cycle": 1.0,
            "fov": 42.0,
            "up": [0.0, 0.0, 1.0],
        }
    return {
        "target": _optional_number_list(camera, "target", [0.0, 0.0, 0.0], length=3),
        "radius": _optional_number_value(camera, "radius", 9.6),
        "height": _optional_number_value(camera, "height", 3.2),
        "theta": _optional_number_value(camera, "theta", 0.1),
        "turns_per_cycle": _optional_number_value(camera, "turns_per_cycle", 1.0),
        "fov": _optional_number_value(camera, "fov", 42.0),
        "up": _optional_number_list(camera, "up", [0.0, 0.0, 1.0], length=3),
    }


def _optional_ocean_light_value(scope: dict[str, Any]) -> dict[str, Any]:
    light = _optional_struct_value(scope, "light")
    if light is None:
        return {
            "target": [0.0, 0.0, 0.0],
            "radius": 7.1,
            "height": 4.6,
            "theta": 0.45,
            "turns_per_cycle": 2.0,
            "model": "blinn_phong",
            "color": [1.0, 0.93, 0.78, 1.0],
        }
    return {
        "target": _optional_number_list(light, "target", [0.0, 0.0, 0.0], length=3),
        "radius": _optional_number_value(light, "radius", 7.1),
        "height": _optional_number_value(light, "height", 4.6),
        "theta": _optional_number_value(light, "theta", 0.45),
        "turns_per_cycle": _optional_number_value(light, "turns_per_cycle", 2.0),
        "model": _optional_string_value(light, "model", "blinn_phong"),
        "color": _optional_number_list(light, "color", [1.0, 0.93, 0.78, 1.0], length=4),
    }


def _optional_ocean_timing_value(scope: dict[str, Any]) -> dict[str, Any]:
    timing = _optional_struct_value(scope, "timing")
    if timing is None:
        return {
            "fps": 30,
            "duration_seconds": 10.0,
            "boundary": "repeat",
        }
    boundary = _optional_string_value(timing, "boundary", "repeat")
    if boundary not in {"repeat", "mirror", "stop", "reset"}:
        raise ValueError("native_scene.timing.boundary must be repeat, mirror, stop, or reset")
    return {
        "fps": _require_positive_int_value(timing, "fps", minimum=1),
        "duration_seconds": _optional_number_value(timing, "duration_seconds", 10.0),
        "boundary": boundary,
    }


def _require_wave_specs(scope: dict[str, Any], name: str) -> list[dict[str, Any]]:
    waves = _require_struct_list(scope, name)
    if not waves:
        raise ValueError("native_scene.waves must contain at least one wave component")
    out: list[dict[str, Any]] = []
    for index, wave in enumerate(waves):
        kind = _optional_string_value(wave, "kind", "linear")
        fn_name = _optional_string_value(wave, "fn", "sin")
        if kind not in {"linear", "radial2"}:
            raise ValueError(f"native_scene.waves[{index}].kind must be linear or radial2")
        if fn_name not in {"sin", "cos"}:
            raise ValueError(f"native_scene.waves[{index}].fn must be sin or cos")
        out.append(
            {
                "kind": kind,
                "fn": fn_name,
                "amplitude": _optional_number_value(wave, "amplitude", 0.0),
                "ux": _optional_number_value(wave, "ux", 0.0),
                "uy": _optional_number_value(wave, "uy", 0.0),
                "radial2": _optional_number_value(wave, "radial2", 0.0),
                "time_freq": _optional_number_value(wave, "time_freq", 0.0),
            }
        )
    return out


def _require_overlay_colors(scope: dict[str, Any], name: str) -> dict[str, list[float]]:
    value = _require_struct_value(scope, name)
    return {
        "selected": _require_rgba(value, "selected"),
        "hover": _require_rgba(value, "hover"),
        "none": _require_rgba(value, "none"),
    }


def _require_overlay_scales(scope: dict[str, Any], name: str) -> dict[str, float]:
    value = _require_struct_value(scope, name)
    return {
        "selected": _require_number_value(value, "selected"),
        "hover": _require_number_value(value, "hover"),
        "none": _require_number_value(value, "none"),
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
            if _is_call_of_attr(value, ui_aliases | screen_aliases, "Frame"):
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


def _render_cube_hover_packets(spec: dict[str, Any]) -> str:
    x, y, w, h = spec["rect"]
    dx, dy, dw, dh = spec["debug_rect"]
    frame_id = str(spec["frame_id"])
    debug_frame_id = str(spec["debug_frame_id"])
    debug_widget_id = "hover"
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
                                "title": str(spec["debug_title"]),
                                "title_align": "left",
                                "rect": {"x": dx, "y": dy, "w": dw, "h": dh},
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
                                "dock_location": "br",
                                "anchor": "tl",
                                "body": [
                                    {
                                        "id": debug_widget_id,
                                        "type": "textarea",
                                        "text": "waiting for native hover...\n",
                                        "rows": 10,
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


def _render_ocean_wave_packets(spec: dict[str, Any]) -> str:
    x, y, w, h = spec["rect"]
    frame_id = str(spec["frame_id"])
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
                                "body": None,
                                "body_layout": None,
                                "parent_id": None,
                            }
                        },
                    }
                ]
            },
        },
        {"seq": 2, "kind": "ui_state.replace", "payload": {"state": {}}},
        {"seq": 3, "kind": "display.replace", "payload": {"display": {"screen": [], "frames": {}, "geom": {}}}},
    ]
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
      window.__vfNativeFaceEdgeVertexConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-face-edge-vertex.js?v={asset_version}"></script>
  </body>
</html>
"""


def _render_cube_hover_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(
        {
            "kind": spec.get("kind", "cube_hover"),
            "frame_id": spec["frame_id"],
            "debug_frame_id": spec["debug_frame_id"],
            "debug_widget_id": "hover",
            "edge_radius": spec["edge_radius"],
            "vertex_radius": spec["vertex_radius"],
            "styles": spec["styles"],
            "camera": spec.get("camera", {}),
            "light": spec.get("light", {}),
        },
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeCubeHoverConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-cube-hover.js?v={asset_version}"></script>
  </body>
</html>
"""


def _render_ocean_wave_html(spec: dict[str, Any]) -> str:
    config_json = json.dumps(
        {
            "kind": "ocean_wave",
            "frame_id": spec["frame_id"],
            "surface": spec["surface"],
            "styles": spec["styles"],
            "camera": spec["camera"],
            "light": spec["light"],
            "timing": spec["timing"],
            "waves": spec["waves"],
        },
        ensure_ascii=False,
    )
    asset_version = _runtime_asset_version()
    return f"""<!DOCTYPE html>
<html>
  <body>
    <script src="../../vf-runtime-shell.js?v={asset_version}"></script>
    <script>
      window.__vfNativeOceanConfig = {config_json};
    </script>
    <script src="../../vf-native-scene-ocean.js?v={asset_version}"></script>
  </body>
</html>
"""


_NATIVE_SCENE_COMPILERS: dict[str, _NativeSceneCompiler] = {
    "face_edge_vertex_drag": _NativeSceneCompiler(
        default_session_name="ui-face-edge-vertex-drag",
        normalize_spec=_normalize_face_edge_vertex_drag_spec,
        render_html=_render_face_edge_vertex_drag_html,
        render_runtime_packets=_render_face_edge_vertex_drag_packets,
        render_geom_transport=_render_face_edge_vertex_drag_transport,
        render_geom_state=_render_face_edge_vertex_drag_state,
    ),
    "cube_hover": _NativeSceneCompiler(
        default_session_name="ui-cube-hover",
        normalize_spec=_normalize_cube_hover_spec,
        render_html=_render_cube_hover_html,
        render_runtime_packets=_render_cube_hover_packets,
    ),
    "cube_lighting_camera": _NativeSceneCompiler(
        default_session_name="ui-cube-lighting-camera",
        normalize_spec=_normalize_cube_hover_spec,
        render_html=_render_cube_hover_html,
        render_runtime_packets=_render_cube_hover_packets,
    ),
    "ocean_wave": _NativeSceneCompiler(
        default_session_name="ui-ocean-wave",
        normalize_spec=_normalize_ocean_wave_spec,
        render_html=_render_ocean_wave_html,
        render_runtime_packets=_render_ocean_wave_packets,
    ),
}
