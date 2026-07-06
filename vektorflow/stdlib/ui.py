"""Stdlib ``ui`` — host UI: ``ui.display`` (``d.draw`` / ``f.draw`` = rects; stage vs frame), …

Implementation uses :mod:`vektorflow.stdlib.screen` (not a registered ``use`` name).
The ``bridge`` stdlib is also unregistered; see :mod:`vektorflow.stdlib.bridge` when needed.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from itertools import product
from pathlib import Path
from typing import Any, Protocol

from ..runtime.axis_tagged import AxisTaggedValue
from ..runtime.vfvector import VFVector
from ..runtime.struct_value import VF_TYPE_KEY, public_struct_items
from ..ui.display_runtime import (
    build_display_payload,
    has_visible_display_content,
    publish_display_runtime_payload,
)
from ..ui.payloads import publish_geom_color_patch
from ..ui.event_ingress import get_ui_event_ingress
from ..ui.representation_runtime import (
    build_embedding_scope_draw_ops,
    build_field_mesh_from_kwargs as _build_field_mesh_from_kwargs,
    build_field_mesh_geometry as _build_field_mesh_geometry,
    normalize_field_mesh_time_boundary as _normalize_field_mesh_time_boundary,
    parse_field_mesh_channels_and_meta as _parse_field_mesh_channels_and_meta,
    refresh_all_representations,
    refresh_representation,
    refresh_representations_for_frame,
    resolve_field_mesh_time_index as _resolve_field_mesh_time_index,
)
from ..ui_display_ir import (
    build_host_event_dispatch_from_state,
    build_host_event_effects,
    enqueue_public_host_event_payload,
    ensure_host_event_poller_started,
    has_queued_host_events,
    materialize_queued_host_event,
    notify_host_frame_payload_event,
    pop_queued_host_event,
)
from .screen import (
    Screen,
    PendingFrame,
    _Widget,
    _write_vkf_scene_to_vf_ui,
)
from .events import (
    UIMouse, UIKeyboard,
    MouseEvent, MouseMove, MouseHover, MouseDown, MouseUp, MouseWheel, MouseDrag,
    FrameEvent, FrameClosed, FrameDocked, FrameDragged, FrameResized,
    WidgetEvent, ButtonPressedEvent, CheckboxToggledEvent, SliderValueChangedEvent,
    InputFieldTextChangedEvent, InputFieldTextEnteredEvent, DropdownItemChangedEvent,
    TextAreaTextChangedEvent, ComboboxTextChangedEvent, ComboboxTextEnteredEvent,
    ComboboxItemChangedEvent, ColorPickerValueChangedEvent,
    TouchEvent, KeyboardEvent, KeyEvent, KeyDown, KeyUp,
    EVENT_CONST_TO_NAME,
    encode_ui_pattern,
    encode_frame_pattern,
    start_event_poller,
)


def _ui_trace_enabled() -> bool:
    raw = str(os.environ.get("VF_UI_TRACE_EVENTS", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _ui_trace_line(msg: str) -> None:
    if not _ui_trace_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "")
        if not base:
            return
        p = Path(base) / "vektor-flow" / "vf-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} {msg}\n")
    except OSError:
        pass


class UISyncError(RuntimeError):
    """Raised when the UI runtime cannot publish scene/display state."""


def _plot_debug_enabled() -> bool:
    raw = str(os.environ.get("VF_PLOT_DEBUG", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _plot_debug_line(msg: str) -> None:
    if not _plot_debug_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "")
        if not base:
            return
        p = Path(base) / "vektor-flow" / "plot-debug.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} [plot-debug] {msg}\n")
    except OSError:
        pass

# ---------------------------------------------------------------------------
# The UI engine uses one renderer lighting path. Legacy names normalize into
# blinn_phong for compatibility.
# ---------------------------------------------------------------------------
LIGHT_MODELS = {"blinn_phong"}

# Animation tick rate (frames per second written to vf-display.json)
_ANIM_FPS = 60


class _UiTimerHost(Protocol):
    """Host callbacks used by UI animation loops."""

    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class _PythonUiTimerHost:
    """Default host adapter for UI timing operations."""

    def monotonic(self) -> float:
        import time

        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        import time

        time.sleep(float(seconds))


def _normalize_ui_timer_host(host: _UiTimerHost) -> _UiTimerHost:
    for name in ("monotonic", "sleep"):
        if not callable(getattr(host, name, None)):
            raise TypeError("ui timer host must define monotonic() and sleep(seconds)")
    return host


_ui_timer_host: _UiTimerHost = _PythonUiTimerHost()


def set_ui_timer_host(host: _UiTimerHost) -> None:
    """Install a custom UI timer host."""
    global _ui_timer_host
    _ui_timer_host = _normalize_ui_timer_host(host)


def reset_ui_timer_host() -> None:
    """Restore the default Python-backed UI timer host."""
    global _ui_timer_host
    _ui_timer_host = _PythonUiTimerHost()


def get_ui_timer_host() -> _UiTimerHost:
    """Return the currently installed UI timer host."""
    return _ui_timer_host


def _ui_monotonic() -> float:
    return _ui_timer_host.monotonic()


def _ui_sleep(seconds: float) -> None:
    _ui_timer_host.sleep(float(seconds))


_PLOT_PARAM_ORDER: tuple[str, ...] = ("u", "v", "w", "t", "i", "j", "k")
_PLOT_PARAM_TOKEN_RE = re.compile(r"\b([uvw tijk])\b".replace(" ", ""))
_PLOT_AXIS_ALIAS_RE = re.compile(r"^\s*([xyzXYZ])\s*:\s*(.+?)\s*$")
_PLOT_CARTESIAN_TOKEN_RE = re.compile(r"\b([xyzXYZ])\b")


def _mapping_like(value: Any, *, ctx: str) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "_d") and isinstance(getattr(value, "_d"), dict):
        return dict(getattr(value, "_d"))
    if isinstance(value, tuple) and hasattr(value, "__vf_py_attrs__"):
        return dict(vars(value))
    if hasattr(value, "__dict__"):
        raw = vars(value)
        if isinstance(raw, dict) and raw:
            return dict(raw)
    raise TypeError(f"{ctx} must be a map/dict-like value")


def _normalize_plot_param_specs(params: Any) -> dict[str, dict[str, float]]:
    raw = _mapping_like(params, ctx="params")
    out: dict[str, dict[str, float]] = {}
    for name in _PLOT_PARAM_ORDER:
        spec = _mapping_like(raw.get(name, {}), ctx=f"params.{name}")
        lo = float(spec.get("min", 0.0))
        hi = float(spec.get("max", lo))
        count = max(1, int(spec.get("count", 1)))
        out[name] = {"min": lo, "max": hi, "count": float(count)}
    return out


def _linspace(lo: float, hi: float, count: int) -> list[float]:
    n = max(1, int(count))
    if n <= 1:
        return [float(lo)]
    step = (float(hi) - float(lo)) / float(n - 1)
    return [float(lo) + (step * float(i)) for i in range(n)]


def _plot_scalar_sample(spec: dict[str, float]) -> float:
    lo = float(spec.get("min", 0.0))
    hi = float(spec.get("max", lo))
    count = max(1, int(spec.get("count", 1.0)))
    if count <= 1:
        return lo
    return lo + ((hi - lo) * 0.5)


def _parse_plot_expr_source(expr_source: Any) -> dict[str, Any]:
    text = str(expr_source or "")
    parts = [str(part).strip() for part in text.split(";")]
    aliases: dict[str, str] = {}
    body_parts: list[str] = []
    for part in parts:
        if not part:
            continue
        match = _PLOT_AXIS_ALIAS_RE.match(part)
        if match:
            aliases[str(match.group(1)).lower()] = str(match.group(2)).strip()
            continue
        body_parts.append(part)
    body = body_parts[-1] if body_parts else ""
    auto_aliases: dict[str, str] = {}
    used_cartesian = {str(m.group(1)).lower() for m in _PLOT_CARTESIAN_TOKEN_RE.finditer(body)}
    if "x" in used_cartesian and "x" not in aliases:
        auto_aliases["x"] = "u"
    if "y" in used_cartesian and "y" not in aliases:
        auto_aliases["y"] = "v" if "x" in used_cartesian else "u"
    if "z" in used_cartesian and "z" not in aliases:
        auto_aliases["z"] = "w" if "y" in used_cartesian else ("v" if "x" in used_cartesian else "u")
    merged_aliases = dict(auto_aliases)
    merged_aliases.update(aliases)
    return {
        "text": text,
        "aliases": merged_aliases,
        "body": body,
    }


def plot_expr_body(expr_source: Any) -> str:
    return str(_parse_plot_expr_source(expr_source).get("body", "") or "")


def plot_expr_axis(expr_source: Any, axis: Any) -> str:
    spec = _parse_plot_expr_source(expr_source)
    return str(spec.get("aliases", {}).get(str(axis or "").strip().lower(), "") or "")


def plot_compile_body(expr_source: Any) -> str:
    spec = _parse_plot_expr_source(expr_source)
    body = str(spec.get("body", "") or "")
    aliases = spec.get("aliases", {})
    for axis in ("x", "y", "z"):
        replacement = str(aliases.get(axis, "") or "")
        if not replacement:
            continue
        body = re.sub(rf"\b{axis}\b", f"({replacement})", body)
    return body


def plot_signature_label(expr_source: Any) -> str:
    spec = _parse_plot_expr_source(expr_source)
    body = str(spec.get("body", "") or "").strip()
    aliases = spec.get("aliases", {})
    active = _plot_active_params(expr_source)
    display_vars: list[str] = []
    if aliases.get("x"):
        display_vars.append("x")
    if aliases.get("y"):
        display_vars.append("y")
    if aliases.get("z"):
        display_vars.append("z")
    if not display_vars:
        display_vars = [str(name) for name in active]
    mode = plot_mode(expr_source)
    fname = "f"
    if body.startswith("[") and body.endswith("]"):
        fname = "c" if len(active) <= 1 else "s"
    args = ",".join(display_vars)
    if not args:
        return f"$${fname}$$"
    return f"$${fname}({args})$$"


def _coerce_plot_vector_sample(value: Any) -> tuple[float, ...] | None:
    if isinstance(value, VFVector):
        seq = list(value)
    elif isinstance(value, (list, tuple)):
        seq = list(value)
    else:
        return None
    if len(seq) not in (2, 3):
        return None
    try:
        return tuple(float(item) for item in seq)
    except (TypeError, ValueError):
        return None


def _build_function_curve_source_kwargs(
    fn: Any,
    params: Any,
    *,
    line_dim: str = "u",
    color: Any = None,
    interpolation: bool = True,
    depth_write: bool = True,
    id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    du = str(line_dim or "u").strip()
    if du not in _PLOT_PARAM_ORDER:
        raise ValueError(f"line_dim must be chosen from {_PLOT_PARAM_ORDER!r}")
    specs = _normalize_plot_param_specs(params)
    u_vals = _linspace(specs[du]["min"], specs[du]["max"], int(specs[du]["count"]))
    axis_values = {name: _plot_scalar_sample(spec) for name, spec in specs.items()}
    x_vals: list[float] = []
    y_vals: list[float] = []
    z_vals: list[float] = []
    for u_val in u_vals:
        axis_values[du] = float(u_val)
        sample = fn(*(axis_values[name] for name in _PLOT_PARAM_ORDER))
        vec = _coerce_plot_vector_sample(sample)
        if vec is None:
            x_vals.append(float(u_val))
            y_vals.append(float(sample))
            z_vals.append(0.0)
        elif len(vec) == 2:
            x_vals.append(float(vec[0]))
            y_vals.append(float(vec[1]))
            z_vals.append(0.0)
        else:
            x_vals.append(float(vec[0]))
            y_vals.append(float(vec[1]))
            z_vals.append(float(vec[2]))
    out: dict[str, Any] = {
        "x_u": x_vals,
        "y_u": y_vals,
        "z_u": z_vals,
        "interpolation": bool(interpolation),
        "depth_write": bool(depth_write),
    }
    if id is not None:
        out["id"] = str(id)
    if color is not None:
        out["color"] = color
    if extra:
        out.update(extra)
    return out


def _sample_plot_colormap(name: Any, value: float) -> list[float]:
    t = max(0.0, min(1.0, float(value)))
    cmap = str(name or "rgb").strip().lower()
    if cmap == "jet":
        r = max(0.0, min(1.0, 1.5 - abs(4.0 * t - 3.0)))
        g = max(0.0, min(1.0, 1.5 - abs(4.0 * t - 2.0)))
        b = max(0.0, min(1.0, 1.5 - abs(4.0 * t - 1.0)))
        return [r, g, b, 1.0]
    if t < 0.5:
        return [1.0 - (2.0 * t), 2.0 * t, 0.0, 1.0]
    return [0.0, 2.0 - (2.0 * t), (2.0 * t) - 1.0, 1.0]


def _nested_color_grid(dims: str, dim_sizes: dict[str, int], axis: str, colormap: Any) -> Any:
    if not dims:
        return _sample_plot_colormap(colormap, 0.0)
    axis = str(axis or "").strip()
    if axis not in dims:
        axis = dims[0]

    def build(depth: int, idxs: dict[str, int]) -> Any:
        if depth >= len(dims):
            count = max(1, int(dim_sizes.get(axis, 1)))
            raw = float(idxs.get(axis, 0))
            t = 0.0 if count <= 1 else raw / float(count - 1)
            return _sample_plot_colormap(colormap, t)
        dim = dims[depth]
        return [build(depth + 1, {**idxs, dim: i}) for i in range(max(1, int(dim_sizes.get(dim, 1))))]

    return build(0, {})


def _apply_plot_color_policy(
    out: dict[str, Any],
    *,
    color_mode: Any,
    color: Any,
    colormap: Any,
    color_axis: Any,
) -> dict[str, Any]:
    mode = str(color_mode or "constant").strip().lower()
    if mode in ("none", "hidden", "hide"):
        out["color"] = [0.0, 0.0, 0.0, 0.0]
        out["depth_write"] = False
        return out
    if mode not in ("distributed", "constant"):
        mode = "constant"
    if mode == "constant":
        if color is not None:
            out["color"] = color
        return out
    coord_keys = [k for k in out.keys() if isinstance(k, str) and re.match(r"^x_[uvwtijk]+$", k)]
    if not coord_keys:
        if color is not None:
            out["color"] = color
        return out
    from ..ui.representation_runtime import _shape_of_nested

    dims = str(coord_keys[0].split("_", 1)[1])
    values = out[coord_keys[0]]
    shape = _shape_of_nested(values)
    dim_sizes = {dim: int(shape[i]) for i, dim in enumerate(dims) if i < len(shape)}
    out[f"c_{dims}"] = _nested_color_grid(dims, dim_sizes, str(color_axis or ""), colormap)
    return out


def _nested_plot_values(dims: str, dim_sizes: dict[str, int], sample_fn: Any) -> tuple[Any, Any, Any]:
    def build(depth: int, idxs: dict[str, int], channel: int) -> Any:
        if depth >= len(dims):
            point = sample_fn(idxs)
            return float(point[channel])
        dim = dims[depth]
        return [build(depth + 1, {**idxs, dim: i}, channel) for i in range(max(1, int(dim_sizes[dim])))]

    return build(0, {}, 0), build(0, {}, 1), build(0, {}, 2)


def _build_function_surface_source_kwargs(
    fn: Any,
    params: Any,
    *,
    u_dim: str = "u",
    v_dim: str = "v",
    color: Any = None,
    interpolation: bool = True,
    depth_write: bool = True,
    id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ud = str(u_dim or "u").strip()
    vd = str(v_dim or "v").strip()
    if ud not in _PLOT_PARAM_ORDER or vd not in _PLOT_PARAM_ORDER:
        raise ValueError(f"u_dim and v_dim must be chosen from {_PLOT_PARAM_ORDER!r}")
    if ud == vd:
        raise ValueError("u_dim and v_dim must be different")
    specs = _normalize_plot_param_specs(params)
    u_vals = _linspace(specs[ud]["min"], specs[ud]["max"], int(specs[ud]["count"]))
    v_vals = _linspace(specs[vd]["min"], specs[vd]["max"], int(specs[vd]["count"]))
    axis_values = {name: _plot_scalar_sample(spec) for name, spec in specs.items()}
    x_rows: list[list[float]] = []
    y_rows: list[list[float]] = []
    z_rows: list[list[float]] = []
    for u_val in u_vals:
        x_row: list[float] = []
        y_row: list[float] = []
        z_row: list[float] = []
        for v_val in v_vals:
            axis_values[ud] = float(u_val)
            axis_values[vd] = float(v_val)
            sample = fn(*(axis_values[name] for name in _PLOT_PARAM_ORDER))
            z_val = float(sample)
            x_row.append(float(u_val))
            y_row.append(float(v_val))
            z_row.append(z_val)
        x_rows.append(x_row)
        y_rows.append(y_row)
        z_rows.append(z_row)
    dims = f"{ud}{vd}"
    out: dict[str, Any] = {
        f"x_{dims}": x_rows,
        f"y_{dims}": y_rows,
        f"z_{dims}": z_rows,
        "interpolation": bool(interpolation),
        "depth_write": bool(depth_write),
    }
    if id is not None:
        out["id"] = str(id)
    if color is not None:
        out["color"] = color
    if extra:
        out.update(extra)
    return out


def _plot_active_params(expr_source: Any) -> list[str]:
    spec = _parse_plot_expr_source(expr_source)
    text = " ".join(
        [str(spec.get("body", "") or "")]
        + [str(v or "") for v in spec.get("aliases", {}).values()]
    )
    seen: set[str] = set()
    ordered: list[str] = []
    for match in _PLOT_PARAM_TOKEN_RE.finditer(text):
        name = match.group(1)
        if name in seen:
            continue
        seen.add(name)
        ordered.append(name)
    return ordered


def plot_active_params(expr_source: Any) -> list[str]:
    return _plot_active_params(expr_source)


def plot_param_active(expr_source: Any, name: Any) -> bool:
    return str(name or "").strip() in _plot_active_params(expr_source)


def plot_param_label(expr_source: Any, name: Any) -> str:
    param = str(name or "").strip()
    spec = _parse_plot_expr_source(expr_source)
    aliases = spec.get("aliases", {})
    for axis in ("x", "y", "z"):
        if str(aliases.get(axis, "") or "").strip() == param:
            return axis
    return param


def plot_mode(expr_source: Any) -> str:
    spec = _parse_plot_expr_source(expr_source)
    aliases = spec.get("aliases", {})
    if aliases.get("x") and aliases.get("y"):
        return "3d"
    if aliases.get("x") or aliases.get("y"):
        return "2d"
    active = _plot_active_params(expr_source)
    return "2d" if len(active) <= 1 else "3d"


def _plot_spatial_params(expr_source: Any) -> list[str]:
    return [name for name in _plot_active_params(expr_source) if name != "t"]


def plot_time_active(expr_source: Any) -> bool:
    return "t" in _plot_active_params(expr_source)


def plot_faces_available(expr_source: Any) -> bool:
    return len(_plot_spatial_params(expr_source)) >= 2


def plot_axis_options(expr_source: Any) -> list[str]:
    opts = _plot_active_params(expr_source)
    return opts if opts else ["u"]


def plot_axis_option(expr_source: Any, index: Any) -> str:
    opts = plot_axis_options(expr_source)
    try:
        ix = int(index)
    except (TypeError, ValueError):
        ix = 0
    if ix < 0 or ix >= len(opts):
        ix = 0
    return opts[ix]


def plot_time_slider_count(expr_source: Any, params: Any) -> int:
    if not plot_time_active(expr_source):
        return 1
    specs = _normalize_plot_param_specs(params)
    return max(1, int(specs["t"]["count"]))


def plot_colormap_label(name: Any) -> str:
    cmap = str(name or "rgb").strip().lower()
    if cmap == "jet":
        return r"$\color{blue}{\rule{0.8em}{0.65em}}\color{cyan}{\rule{0.8em}{0.65em}}\color{yellow}{\rule{0.8em}{0.65em}}\color{red}{\rule{0.8em}{0.65em}}$"
    return r"$\color{red}{\rule{0.8em}{0.65em}}\color{green}{\rule{0.8em}{0.65em}}\color{blue}{\rule{0.8em}{0.65em}}$"


def plot_history_push(history: Any, text: Any, limit: Any = 16) -> list[str]:
    src: list[str] = []
    if isinstance(history, (VFVector, list, tuple)):
        src = [str(x) for x in history]
    elif history is not None:
        src = [str(history)]
    entry = str(text or "").strip()
    if not entry:
        return src
    out = [entry]
    for item in src:
        if item != entry:
            out.append(item)
    lim = max(1, int(limit))
    return out[:lim]


def _build_function_plot_source_kwargs(
    fn: Any,
    expr_source: Any,
    params: Any,
    *,
    x_fn: Any = None,
    y_fn: Any = None,
    z_fn: Any = None,
    color: Any = None,
    color_mode: Any = "constant",
    color_axis: Any = "",
    colormap: Any = "rgb",
    interpolation: bool = True,
    depth_write: bool = True,
    id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    del z_fn
    specs = _normalize_plot_param_specs(params)
    active = _plot_active_params(expr_source)
    spatial = [name for name in active if name != "t"]
    dims = spatial[:2] if spatial else ["u"]
    if "t" in active and "t" not in dims:
        dims = ["t"] + dims
    manifold_dims = [d for d in dims if d != "t"]
    axis_values = {name: _plot_scalar_sample(spec) for name, spec in specs.items()}
    sample = fn(*(axis_values[name] for name in _PLOT_PARAM_ORDER))
    sample_vec = _coerce_plot_vector_sample(sample)
    _plot_debug_line(
        "build_function_plot start "
        f"expr={str(expr_source)!r} active={active!r} dims={dims!r} "
        f"manifold={manifold_dims!r} sample={sample!r} sample_vec={sample_vec!r} "
        f"color_mode={str(color_mode)!r} color_axis={str(color_axis)!r} colormap={str(colormap)!r}"
    )
    dim_sizes = {d: max(1, int(specs[d]["count"])) for d in dims}
    dim_values = {d: _linspace(specs[d]["min"], specs[d]["max"], int(specs[d]["count"])) for d in dims}

    def sample_point(idxs: dict[str, int]) -> tuple[float, float, float]:
        for d in dims:
            axis_values[d] = float(dim_values[d][int(idxs.get(d, 0))])
        body_value = fn(*(axis_values[name] for name in _PLOT_PARAM_ORDER))
        point = _coerce_plot_vector_sample(body_value)
        if point is not None:
            return (
                float(point[0]),
                float(point[1]),
                float(point[2] if len(point) >= 3 else 0.0),
            )
        scalar_value = float(body_value)
        if x_fn is not None or y_fn is not None:
            x_value = float(x_fn(*(axis_values[name] for name in _PLOT_PARAM_ORDER))) if x_fn is not None else float(axis_values.get(manifold_dims[0] if manifold_dims else "u", 0.0))
            y_value = float(y_fn(*(axis_values[name] for name in _PLOT_PARAM_ORDER))) if y_fn is not None else float(axis_values.get(manifold_dims[1] if len(manifold_dims) > 1 else (manifold_dims[0] if manifold_dims else "u"), 0.0))
            if x_fn is not None and y_fn is None:
                return (x_value, scalar_value, 0.0)
            if x_fn is None and y_fn is not None:
                return (scalar_value, y_value, 0.0)
            return (x_value, y_value, scalar_value)
        if len(manifold_dims) <= 1:
            du = manifold_dims[0] if manifold_dims else "u"
            return (float(axis_values.get(du, 0.0)), scalar_value, 0.0)
        return (float(axis_values[manifold_dims[0]]), float(axis_values[manifold_dims[1]]), scalar_value)

    x_values, y_values, z_values = _nested_plot_values("".join(dims), dim_sizes, sample_point)
    dims_key = "".join(dims)
    out = {
        f"x_{dims_key}": x_values,
        f"y_{dims_key}": y_values,
        f"z_{dims_key}": z_values,
        "interpolation": bool(interpolation),
        "depth_write": bool(depth_write),
    }
    if len(manifold_dims) <= 1:
        # Plot curves should read as strokes.  The generic field-mesh line
        # default is intentionally overlay-oriented, so choose a small
        # world-space tube here to make function plots visible and stable.
        out["edge_width"] = 0.035
        out["edge_caps"] = True
        out["render_mode"] = "proxy_geometry"
        out["marker_space"] = "world"
        out["receives_lighting"] = False
        out["casts_shadow"] = False
    if id is not None:
        out["id"] = str(id)
    _apply_plot_color_policy(
        out,
        color_mode=color_mode,
        color=color,
        colormap=colormap,
        color_axis=color_axis,
    )
    if extra:
        out.update(extra)
    coord_keys = [k for k in out.keys() if isinstance(k, str) and re.match(r"^[xyzc]_[uvwtijk]+$", k)]
    shapes: dict[str, Any] = {}
    try:
        from ..ui.representation_runtime import _shape_of_nested

        shapes = {str(k): _shape_of_nested(out[k]) for k in coord_keys}
    except Exception as exc:
        shapes = {"shape_error": str(exc)}
    _plot_debug_line(
        "build_function_plot done "
        f"id={str(id)!r} keys={coord_keys!r} shapes={shapes!r} "
        f"color={out.get('color')!r} depth_write={out.get('depth_write')!r}"
    )
    return out


# ---------------------------------------------------------------------------
# Low-level math helpers
# ---------------------------------------------------------------------------

def _real_float(v: Any, name: str) -> float:
    if isinstance(v, complex):
        if abs(v.imag) > 1e-12:
            raise TypeError(f"{name} must be real, got complex value {v!r}")
        return float(v.real)
    return float(v)


def _vec3(v: Any, name: str = "vec") -> list[float]:
    if isinstance(v, (VFVector, list, tuple)) and len(v) >= 3:
        return [_real_float(v[0], name), _real_float(v[1], name), _real_float(v[2], name)]
    raise TypeError(f"{name} must be [x, y, z]")


def _rect_from_tuple(t: Any) -> tuple[float, float, float, float]:
    if isinstance(t, (VFVector, list, tuple)) and len(t) == 4:
        return (_real_float(t[0], "rect"), _real_float(t[1], "rect"), _real_float(t[2], "rect"), _real_float(t[3], "rect"))
    raise TypeError("rect must be a 4-tuple (x, y, w, h) in normalized 0..1 coordinates")


def _rotate_vec3_around_axis(v: list[float], axis: str, angle_deg: float) -> list[float]:
    """Rotate vector v by angle_deg degrees around the named world axis (x/y/z)."""
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    x, y, z = v[0], v[1], v[2]
    if axis == "z":
        return [x * c - y * s, x * s + y * c, z]
    elif axis == "x":
        return [x, y * c - z * s, y * s + z * c]
    elif axis == "y":
        return [x * c + z * s, y, -x * s + z * c]
    else:
        raise ValueError(f"axis must be 'x', 'y', or 'z', got {axis!r}")


def _coerce_frame_kw_for_screen(kwargs: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        if isinstance(v, FrameRef):
            out[k] = v._pending
        else:
            out[k] = v
    return out


_DIM_ORDER = "tijkuvw"
_MESH_CHANNEL_RE = re.compile(r"^(phi|[xyzcr])(?:_([tijkuvw]+))?$")
_COLOR_NAMES: dict[str, tuple[float, float, float, float]] = {
    "white": (1.0, 1.0, 1.0, 1.0),
    "black": (0.0, 0.0, 0.0, 1.0),
    "red": (1.0, 0.1, 0.1, 1.0),
    "green": (0.15, 0.85, 0.15, 1.0),
    "blue": (0.15, 0.35, 1.0, 1.0),
    "yellow": (1.0, 0.9, 0.1, 1.0),
    "cyan": (0.1, 0.9, 0.9, 1.0),
    "magenta": (0.9, 0.1, 0.9, 1.0),
    "orange": (1.0, 0.5, 0.05, 1.0),
    "gray": (0.5, 0.5, 0.5, 1.0),
    "grey": (0.5, 0.5, 0.5, 1.0),
}

_NO_VIEW = object()
_BASE_GRAPHICS_DEFAULTS: dict[str, Any] = {
    "vertex": {"color": "#222222", "scale": 0.015, "style": None},
    "edge": {"color": "#222222", "scale": 0.004, "style": None},
    "face": {"color": "#c8c8c8", "scale": 0.0, "style": None},
}

_PICK_REP_BITS = 16
_PICK_KIND_BITS = 4
_PICK_CARRIER_BITS = 20
_PICK_CONTENT_BITS = 16
_PICK_SUB_BITS = 8

_PICK_SUB_SHIFT = 0
_PICK_CONTENT_SHIFT = _PICK_SUB_SHIFT + _PICK_SUB_BITS
_PICK_CARRIER_SHIFT = _PICK_CONTENT_SHIFT + _PICK_CONTENT_BITS
_PICK_KIND_SHIFT = _PICK_CARRIER_SHIFT + _PICK_CARRIER_BITS
_PICK_REP_SHIFT = _PICK_KIND_SHIFT + _PICK_KIND_BITS

_PICK_SUB_MASK = ((1 << _PICK_SUB_BITS) - 1) << _PICK_SUB_SHIFT
_PICK_CONTENT_MASK = ((1 << _PICK_CONTENT_BITS) - 1) << _PICK_CONTENT_SHIFT
_PICK_CARRIER_MASK = ((1 << _PICK_CARRIER_BITS) - 1) << _PICK_CARRIER_SHIFT
_PICK_KIND_MASK = ((1 << _PICK_KIND_BITS) - 1) << _PICK_KIND_SHIFT
_PICK_REP_MASK = ((1 << _PICK_REP_BITS) - 1) << _PICK_REP_SHIFT
_PICK_CARRIER_MATCH_MASK = _PICK_KIND_MASK | _PICK_CARRIER_MASK
_PICK_CONTENT_MATCH_MASK = _PICK_CARRIER_MATCH_MASK | _PICK_CONTENT_MASK
_PICK_EXACT_MASK = _PICK_REP_MASK | _PICK_CONTENT_MATCH_MASK | _PICK_SUB_MASK

_PICK_KIND_VERTEX = 1
_PICK_KIND_EDGE = 2
_PICK_KIND_FACE = 3

_PICK_KIND_NAMES = {
    _PICK_KIND_VERTEX: "vertex",
    _PICK_KIND_EDGE: "edge",
    _PICK_KIND_FACE: "face",
}


def _is_sequence(value: Any) -> bool:
    return isinstance(value, (VFVector, list, tuple))


def _deep_copy_dict(value: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in value.items():
        if isinstance(v, dict):
            out[k] = _deep_copy_dict(v)
        else:
            out[k] = v
    return out


def _structural_merge_dict(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = _deep_copy_dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _structural_merge_dict(out[k], v)
        elif isinstance(v, dict):
            out[k] = _deep_copy_dict(v)
        else:
            out[k] = v
    return out


def _normalize_graphics_defaults_patch(patch: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    flat_map = {
        "vertex_color": ("vertex", "color"),
        "vertex_scale": ("vertex", "scale"),
        "vertex_style": ("vertex", "style"),
        "edge_color": ("edge", "color"),
        "edge_scale": ("edge", "scale"),
        "edge_style": ("edge", "style"),
        "face_color": ("face", "color"),
        "face_scale": ("face", "scale"),
        "face_style": ("face", "style"),
    }
    for k, v in patch.items():
        if k in flat_map:
            outer, inner = flat_map[k]
            out.setdefault(outer, {})[inner] = v
            continue
        if isinstance(v, dict):
            out[k] = _normalize_graphics_defaults_patch(v)
        else:
            out[k] = v
    return out


def _resolve_graphics_default(
    defaults: dict[str, Any],
    carrier: str,
    field: str,
) -> Any:
    carrier_defaults = defaults.get(carrier)
    if isinstance(carrier_defaults, dict) and field in carrier_defaults:
        return carrier_defaults[field]
    return _BASE_GRAPHICS_DEFAULTS[carrier][field]


def _is_numeric_color_vector(value: Any) -> bool:
    if not _is_sequence(value):
        return False
    if len(value) not in (3, 4):
        return False
    return all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in value)


def _color_to_css(color: Any) -> str:
    if isinstance(color, str):
        return color
    r, g, b, a = _parse_color_rgba(color)
    rr = int(max(0.0, min(1.0, r)) * 255.0)
    gg = int(max(0.0, min(1.0, g)) * 255.0)
    bb = int(max(0.0, min(1.0, b)) * 255.0)
    aa = max(0.0, min(1.0, a))
    return f"rgba({rr}, {gg}, {bb}, {aa:.6g})"


def _color_to_payload(color: Any) -> Any:
    if color is None:
        return None
    if _is_numeric_color_vector(color):
        r, g, b, a = _parse_color_rgba(color)
        return [r, g, b, a]
    return str(color)


def _paint_field_mesh_vertex_colors(data: dict[str, Any], color: Any) -> None:
    rgba = _parse_color_rgba(color)
    vertices = data.get("vertices")
    if not isinstance(vertices, list):
        return
    stride = 10
    if len(vertices) < stride:
        return
    for offset in range(6, len(vertices), stride):
        if offset + 3 >= len(vertices):
            break
        vertices[offset] = rgba[0]
        vertices[offset + 1] = rgba[1]
        vertices[offset + 2] = rgba[2]
        vertices[offset + 3] = rgba[3]


def _normalize_texture_spec(texture: Any) -> dict[str, Any] | None:
    if texture is None:
        return None
    if not isinstance(texture, dict):
        raise TypeError("texture must be a dict-like spec")
    kind = str(texture.get("kind", "") or "").strip().lower()
    if kind not in {"checker", "stripes", "dice", "face_cube"}:
        raise ValueError("texture kind must be 'checker', 'stripes', 'dice', or 'face_cube'")
    space = str(texture.get("space", "triplanar") or "triplanar").strip().lower()
    if space != "triplanar":
        raise ValueError("texture space must be 'triplanar'")
    default_scale = [1.0, 1.0] if kind == "face_cube" else [8.0, 8.0]
    raw_scale = texture.get("scale", default_scale)
    if not _is_sequence(raw_scale) or len(raw_scale) < 2:
        raise TypeError("texture scale must be a 2-element sequence")
    sx = float(raw_scale[0])
    sy = float(raw_scale[1])
    if not math.isfinite(sx) or sx <= 0.0:
        sx = default_scale[0]
    if not math.isfinite(sy) or sy <= 0.0:
        sy = default_scale[1]
    raw_rotation = texture.get("rotation", [0.0, 0.0, 0.0])
    if not _is_sequence(raw_rotation) or len(raw_rotation) < 3:
        raise TypeError("texture rotation must be a 3-element sequence")
    rotation = [
        float(raw_rotation[0]),
        float(raw_rotation[1]),
        float(raw_rotation[2]),
    ]
    return {
        "kind": kind,
        "space": "triplanar",
        "scale": [sx, sy],
        "color_a": list(_parse_color_rgba(texture.get("color_a", [0.18, 0.22, 0.30, 1.0]))),
        "color_b": list(_parse_color_rgba(texture.get("color_b", [0.90, 0.92, 0.98, 1.0]))),
        "rotation": rotation,
        "graph_test": bool(texture.get("graph_test", False)),
        "graph_width_px": max(0.0, float(texture.get("graph_width_px", 0.0) or 0.0)),
    }


def _coerce_vertices2(vertices: Any) -> list[list[float]]:
    if not _is_sequence(vertices):
        raise TypeError("embedding vertices must be a vector/list of points")
    out: list[list[float]] = []
    for i, point in enumerate(vertices):
        if not _is_sequence(point) or len(point) < 2:
            raise TypeError(f"embedding vertex {i} must be a 2D or 3D point")
        out.append([float(point[0]), float(point[1])])
    return out


def _coerce_index_pairs(indices: Any, name: str) -> list[list[int]]:
    if not _is_sequence(indices):
        raise TypeError(f"{name} must be a vector/list of index pairs")
    out: list[list[int]] = []
    for i, pair in enumerate(indices):
        if not _is_sequence(pair) or len(pair) != 2:
            raise TypeError(f"{name}[{i}] must contain exactly 2 vertex indices")
        out.append([int(pair[0]), int(pair[1])])
    return out


def _coerce_face_indices(indices: Any) -> list[list[int]]:
    if not _is_sequence(indices):
        raise TypeError("face_indices must be a vector/list of faces")
    out: list[list[int]] = []
    for i, face in enumerate(indices):
        if not _is_sequence(face) or len(face) < 3:
            raise TypeError(f"face_indices[{i}] must contain at least 3 vertex indices")
        out.append([int(v) for v in face])
    return out


def _vertex_value_ledger(value: Any, count: int, default: Any) -> list[Any]:
    if value is None:
        return [default for _ in range(count)]
    if _is_sequence(value) and len(value) == count and not _is_numeric_color_vector(value):
        return list(value)
    return [value for _ in range(count)]


def _vertex_scalar_ledger(value: Any, count: int, default: float) -> list[float]:
    if value is not None and _is_sequence(value) and len(value) == count:
        return [float(v) for v in value]
    raw = _vertex_value_ledger(value, count, default)
    return [float(v) for v in raw]


def _sample_continuous_property(value: Any, sample: Any, default: Any) -> Any:
    if value is None:
        return default
    if callable(value):
        return value(sample)
    return value


def _style_fields(value: Any, expected_kind: str) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, _GraphicsStyleValue):
        if value.kind != expected_kind:
            raise TypeError(f"expected {expected_kind} style, got {value.kind}")
        return dict(value.fields)
    if isinstance(value, dict):
        return {k: v for k, v in value.items() if k != VF_TYPE_KEY}
    raise TypeError(f"{expected_kind}_style must be a ui.graphics style value")


def _coerce_content_spec(spec: Any, default_value: Any) -> tuple[Any, Any, Any, dict[str, Any] | None] | None:
    if spec is None:
        return None
    if callable(spec):
        return default_value, spec, _NO_VIEW, None
    if isinstance(spec, dict):
        payload = {k: v for k, v in spec.items() if k != VF_TYPE_KEY}
        embedding = payload.get("embedding")
        if embedding is None or not callable(embedding):
            raise TypeError("style.content record must define callable embedding")
        value = payload.get("value", default_value)
        view = payload.get("view", _NO_VIEW)
        defaults = payload.get("defaults")
        if defaults is not None and not isinstance(defaults, dict):
            raise TypeError("style.content defaults must be a record/dict when provided")
        return value, embedding, view, defaults
    raise TypeError("style.content must be an embedding or a record with embedding/value/view")


def _transform_point_vertex(anchor: list[float], scale: float, point: list[float]) -> list[float]:
    return [anchor[0] + scale * float(point[0]), anchor[1] + scale * float(point[1])]


def _transform_point_edge(a: list[float], b: list[float], width: float, point: list[float]) -> list[float]:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = math.sqrt(dx * dx + dy * dy)
    if length <= 1e-12:
        tx, ty = 1.0, 0.0
        nx, ny = 0.0, 1.0
    else:
        tx, ty = dx / length, dy / length
        nx, ny = -ty, tx
    x = float(point[0])
    y = float(point[1]) if len(point) > 1 else 0.0
    return [
        a[0] + tx * (x * length) + nx * (y * width),
        a[1] + ty * (x * length) + ny * (y * width),
    ]


def _transform_point_face(points: list[list[float]], point: list[float]) -> list[float]:
    x = float(point[0])
    y = float(point[1]) if len(point) > 1 else 0.0
    if len(points) == 4:
        p0, p1, p2, p3 = points
        w0 = (1.0 - x) * (1.0 - y)
        w1 = x * (1.0 - y)
        w2 = x * y
        w3 = (1.0 - x) * y
        return [
            w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0],
            w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1],
        ]
    if len(points) == 3:
        p0, p1, p2 = points
        w0 = max(0.0, 1.0 - x - y)
        w1 = max(0.0, x)
        w2 = max(0.0, y)
        return [
            w0 * p0[0] + w1 * p1[0] + w2 * p2[0],
            w0 * p0[1] + w1 * p1[1] + w2 * p2[1],
        ]
    min_x = min(p[0] for p in points)
    max_x = max(p[0] for p in points)
    min_y = min(p[1] for p in points)
    max_y = max(p[1] for p in points)
    return [min_x + x * (max_x - min_x), min_y + y * (max_y - min_y)]


def _transform_ops(
    ops: list[dict[str, Any]],
    point_transform: Any,
    *,
    linear_scale: float,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for op in ops:
        op2 = dict(op)
        if op2.get("op") == "point":
            op2["point"] = point_transform(op2["point"])
            op2["radius"] = float(op2.get("radius", 0.0)) * linear_scale
        elif op2.get("op") in ("polyline", "polygon"):
            op2["points"] = [point_transform(p) for p in op2.get("points", [])]
            if "width" in op2:
                op2["width"] = float(op2.get("width", 0.0)) * linear_scale
            if op2.get("strokeWidth") is not None:
                op2["strokeWidth"] = float(op2.get("strokeWidth", 0.0)) * linear_scale
        out.append(op2)
    return out


def _pack_pick_id(
    rep_ordinal: int,
    carrier_kind: int,
    carrier_index: int,
    *,
    content_path: int = 0,
    sub_index: int = 0,
) -> int:
    if rep_ordinal < 0 or rep_ordinal >= (1 << _PICK_REP_BITS):
        raise ValueError(f"rep ordinal {rep_ordinal} is out of range")
    if carrier_kind < 0 or carrier_kind >= (1 << _PICK_KIND_BITS):
        raise ValueError(f"carrier kind {carrier_kind} is out of range")
    if carrier_index < 0 or carrier_index >= (1 << _PICK_CARRIER_BITS):
        raise ValueError(f"carrier index {carrier_index} is out of range")
    if content_path < 0 or content_path >= (1 << _PICK_CONTENT_BITS):
        raise ValueError(f"content path {content_path} is out of range")
    if sub_index < 0 or sub_index >= (1 << _PICK_SUB_BITS):
        raise ValueError(f"sub index {sub_index} is out of range")
    return (
        (int(rep_ordinal) << _PICK_REP_SHIFT)
        | (int(carrier_kind) << _PICK_KIND_SHIFT)
        | (int(carrier_index) << _PICK_CARRIER_SHIFT)
        | (int(content_path) << _PICK_CONTENT_SHIFT)
        | (int(sub_index) << _PICK_SUB_SHIFT)
    )


def _decode_pick_id(value: int) -> dict[str, int | str]:
    pick_id = int(value)
    kind = (pick_id & _PICK_KIND_MASK) >> _PICK_KIND_SHIFT
    return {
        "representation": (pick_id & _PICK_REP_MASK) >> _PICK_REP_SHIFT,
        "carrier_kind_code": kind,
        "carrier_kind": _PICK_KIND_NAMES.get(kind, "unknown"),
        "carrier_index": (pick_id & _PICK_CARRIER_MASK) >> _PICK_CARRIER_SHIFT,
        "content_path": (pick_id & _PICK_CONTENT_MASK) >> _PICK_CONTENT_SHIFT,
        "sub_index": (pick_id & _PICK_SUB_MASK) >> _PICK_SUB_SHIFT,
    }


def _match_pick_id(pick_id: int, target: int, mask: int) -> bool:
    return (int(pick_id) & int(mask)) == (int(target) & int(mask))


def _pick_kind_from_event(event: Any) -> str:
    try:
        pick_id = int(getattr(event, "pick_id", 0) if not isinstance(event, dict) else event.get("pick_id", 0))
    except Exception:
        return "none"
    if pick_id == 0:
        return "none"
    decoded = _decode_pick_id(pick_id)
    kind = decoded.get("carrier_kind", "unknown")
    return str(kind)


def _pick_index_from_event(event: Any) -> int:
    try:
        pick_id = int(getattr(event, "pick_id", 0) if not isinstance(event, dict) else event.get("pick_id", 0))
    except Exception:
        return -1
    if pick_id == 0:
        return -1
    decoded = _decode_pick_id(pick_id)
    try:
        return int(decoded.get("carrier_index", -1))
    except Exception:
        return -1


def _pick_hit(event: Any, target: dict[str, int], mode: str = "content") -> bool:
    if not isinstance(target, dict):
        return False
    if isinstance(event, dict):
        try:
            pick_id = int(event.get("pick_id", 0) or 0)
            object_id = int(event.get("object_id", 0) or 0)
        except Exception:
            return False
    else:
        try:
            pick_id = int(getattr(event, "pick_id", 0) or 0)
            object_id = int(getattr(event, "object_id", 0) or 0)
        except Exception:
            return False
    if pick_id == 0 or object_id == 0:
        return False
    try:
        target_id = int(target.get("pick_id", 0) or 0)
    except Exception:
        return False
    mask_key = {
        "representation": "pick_mask_representation",
        "carrier": "pick_mask_carrier",
        "content": "pick_mask_content",
        "exact": "pick_mask_exact",
    }.get(str(mode), "pick_mask_content")
    try:
        mask = int(target.get(mask_key, 0) or 0)
    except Exception:
        return False
    if mask == 0:
        return False
    return _match_pick_id(pick_id, target_id, mask)


def _next_content_path(parent_path: int, carrier_kind: int, carrier_index: int) -> int:
    mixed = (
        (int(parent_path) * 1315423911)
        ^ (int(carrier_kind) * 2654435761)
        ^ (int(carrier_index) + 1)
    )
    return mixed & ((1 << _PICK_CONTENT_BITS) - 1)


def _pick_meta(
    rep_ordinal: int,
    carrier_kind: int,
    carrier_index: int,
    *,
    content_path: int = 0,
    sub_index: int = 0,
) -> dict[str, int]:
    pick_id = _pack_pick_id(
        rep_ordinal,
        carrier_kind,
        carrier_index,
        content_path=content_path,
        sub_index=sub_index,
    )
    return {
        "pick_id": pick_id,
        "pick_mask_representation": _PICK_REP_MASK,
        "pick_mask_carrier": _PICK_CARRIER_MATCH_MASK,
        "pick_mask_content": _PICK_CONTENT_MATCH_MASK,
        "pick_mask_exact": _PICK_EXACT_MASK,
    }


@dataclass
class SceneRepresentation:
    """Handle for a frame/display-hosted graphics embedding."""

    __vf_py_attrs__ = True

    rep_id: str
    rep_ordinal: int
    source: Any
    embedding: Any
    view: Any
    _display: "Display" = field(repr=False)
    _frame_id: str | None = field(default=None, repr=False)

    def refresh(self) -> "SceneRepresentation":
        self._display._refresh_representation(self)
        return self

    def set_view(self, view: Any) -> "SceneRepresentation":
        self.view = view
        return self.refresh()

    def remove(self) -> None:
        self._display._remove_representation(self)

    def pick(self) -> dict[str, int]:
        """Representation-wide pick target for coarse matching."""
        return {
            "pick_id": _pack_pick_id(self.rep_ordinal, 0, 0),
            "pick_mask_representation": _PICK_REP_MASK,
            "pick_mask_carrier": _PICK_CARRIER_MATCH_MASK,
            "pick_mask_content": _PICK_CONTENT_MATCH_MASK,
            "pick_mask_exact": _PICK_EXACT_MASK,
        }

    def vertex(self, index: int) -> dict[str, int]:
        return _pick_meta(self.rep_ordinal, _PICK_KIND_VERTEX, int(index))

    def edge(self, index: int) -> dict[str, int]:
        return _pick_meta(self.rep_ordinal, _PICK_KIND_EDGE, int(index))

    def face(self, index: int) -> dict[str, int]:
        return _pick_meta(self.rep_ordinal, _PICK_KIND_FACE, int(index))


@dataclass
class _GraphicsStyleValue:
    __vf_py_attrs__ = True

    kind: str
    fields: dict[str, Any]


@dataclass
class UIGraphicsNamespace:
    """Built-in graphics namespace (styles first; embedding contract is user-defined)."""

    __vf_py_attrs__ = True

    def VertexStyle(self, **kwargs: Any) -> _GraphicsStyleValue:  # noqa: N802
        return _GraphicsStyleValue("vertex", dict(kwargs))

    def EdgeStyle(self, **kwargs: Any) -> _GraphicsStyleValue:  # noqa: N802
        return _GraphicsStyleValue("edge", dict(kwargs))

    def FaceStyle(self, **kwargs: Any) -> _GraphicsStyleValue:  # noqa: N802
        return _GraphicsStyleValue("face", dict(kwargs))


def _parse_mesh_channel(
    axis: str,
    dims: str,
    value: Any,
) -> dict[str, Any]:
    if len(set(dims)) != len(dims):
        raise ValueError(f"duplicate dimensions in {axis}_{dims!s}")
    for d in dims:
        if d not in _DIM_ORDER:
            raise ValueError(f"unsupported dimension {d!r}; use only {_DIM_ORDER!r}")
    from ..ui.representation_runtime import _shape_of_nested
    shape = _shape_of_nested(value)
    if len(shape) != len(dims):
        raise ValueError(
            f"{axis}_{dims}: rank mismatch; got array rank {len(shape)} for {len(dims)} dims"
        )
    return {"axis": axis, "dims": dims, "shape": shape, "data": value}


def _parse_color_rgba(color: Any) -> tuple[float, float, float, float]:
    if color is None:
        return (0.8, 0.8, 0.8, 1.0)
    if isinstance(color, (VFVector, list, tuple)) and len(color) >= 3:
        r = float(color[0]); g = float(color[1]); b = float(color[2])
        a = float(color[3]) if len(color) >= 4 else 1.0
        # Allow either 0..1 or 0..255 input.
        if max(abs(r), abs(g), abs(b), abs(a)) > 1.0:
            r /= 255.0; g /= 255.0; b /= 255.0
            if a > 1.0:
                a /= 255.0
        return (r, g, b, a)
    s = str(color).strip().lower()
    if s in _COLOR_NAMES:
        return _COLOR_NAMES[s]
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = f"{h[0]}{h[0]}{h[1]}{h[1]}{h[2]}{h[2]}"
        if len(h) == 6:
            n = int(h, 16)
            return (((n >> 16) & 255) / 255.0, ((n >> 8) & 255) / 255.0, (n & 255) / 255.0, 1.0)
    return (0.8, 0.8, 0.8, 1.0)


# ---------------------------------------------------------------------------
# Scene objects — returned by add_box / add_ellipsoid / add_torus / add_camera / add_light
# ---------------------------------------------------------------------------

class SceneBox:
    """A mutable box in a 3-D scene frame.

    Returned by ``d.add_box(…)`` / ``f.add_box(…)``.  Every mutation method
    immediately writes ``vf-display.json`` so the overlay refreshes live.

    Methods
    -------
    translate([dx, dy, dz])
        Shift the box center by (dx, dy, dz). Returns self.
    rotate_by(angle_deg, around="y")
        Rotate the box around its own center by *angle_deg* degrees about the
        named axis. Implemented as a rotation matrix applied to the vertex
        normal transform stored in the mesh spec. Returns self.
    set_color(color)
        Change the box color (CSS name or #rrggbb). Returns self.
    set_scale([sx, sy, sz])
        Resize the box. Returns self.
    """

    __vf_py_attrs__ = True

    def __init__(self, data: dict[str, Any], display: "Display", frame_id: str) -> None:
        self._data = data          # live dict inside display._geom[fid]["meshes"][i]
        self._display = display
        self._frame_id = frame_id
        # local rotation accumulator (axis-angle in degrees, stored as euler ZYX)
        self._rot: list[float] = [0.0, 0.0, 0.0]  # [rx, ry, rz] degrees

    def _object_id(self) -> int:
        meshes = self._display._geom.get(self._frame_id, {}).get("meshes", [])
        for index, mesh in enumerate(meshes):
            if mesh is self._data:
                return index + 1
        return 0

    def _publish_color_patch(self, color: Any) -> None:
        object_id = self._object_id()
        if object_id <= 0:
            return
        publish_geom_color_patch(self._frame_id, object_id, _color_to_payload(color))

    # -- mutations ------------------------------------------------------------

    def translate(self, delta: Any) -> "SceneBox":
        """Shift center by [dx, dy, dz]. Returns self."""
        d = _vec3(delta, "delta")
        c = self._data["center"]
        self._data["center"] = [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
        self._display._sync_all()
        return self

    def set_center(self, center: Any) -> "SceneBox":
        """Move center to [x, y, z]. Returns self."""
        self._data["center"] = _vec3(center, "center")
        self._display._sync_all()
        return self

    def rotate_by(self, angle_deg: float, around: str = "y") -> "SceneBox":
        """Rotate box around its center by *angle_deg* degrees about *around* axis.

        The rotation is accumulated in ``data['rotation']`` as ``[rx, ry, rz]``
        Euler angles (degrees, applied ZYX order) and passed through to the JS
        renderer which will apply it to the model matrix.
        Returns self.
        """
        ax = str(around).lower()
        if ax not in ("x", "y", "z"):
            raise ValueError(f"around must be 'x', 'y', or 'z', got {around!r}")
        idx = {"x": 0, "y": 1, "z": 2}[ax]
        self._rot[idx] = (self._rot[idx] + angle_deg) % 360.0
        self._data["rotation"] = list(self._rot)
        self._display._sync_all()
        return self

    def set_color(self, color: Any) -> "SceneBox":
        """Change the box color. Returns self."""
        self._data["color"] = _color_to_payload(color)
        self._publish_color_patch(color)
        self._display._dirty = True
        return self

    def set_scale(self, scale: Any) -> "SceneBox":
        """Resize the box. Returns self."""
        self._data["scale"] = _vec3(scale, "scale")
        self._display._sync_all()
        return self

    def set_texture(self, texture: Any) -> "SceneBox":
        """Change the procedural texture spec. Returns self."""
        normalized = _normalize_texture_spec(texture)
        if normalized is None:
            self._data.pop("texture", None)
        else:
            self._data["texture"] = normalized
        self._display._sync_all()
        return self

    def remove(self) -> None:
        """Remove this scene object from its frame."""
        meshes = self._display._geom.get(self._frame_id, {}).get("meshes", [])
        for index, mesh in enumerate(list(meshes)):
            if mesh is self._data:
                meshes.pop(index)
                for key in list(self._display._scene_objects.keys()):
                    if key[0] == self._frame_id:
                        self._display._scene_objects.pop(key, None)
                for i, item in enumerate(meshes):
                    self._display._scene_objects[(self._frame_id, i)] = SceneBox(
                        item, self._display, self._frame_id
                    )
                self._display._sync_all()
                return

    # -- convenience ----------------------------------------------------------

    @property
    def center(self) -> list[float]:
        return list(self._data["center"])

    @property
    def scale(self) -> list[float]:
        return list(self._data["scale"])

    def __repr__(self) -> str:
        return f"SceneBox(center={self._data['center']}, scale={self._data['scale']}, color={self._data['color']!r})"


class SceneFieldMesh(SceneBox):
    """A mutable field mesh in a 3-D scene frame.

    Returned by ``d.add(...)`` / ``f.add(...)``. Supports the same transform/style
    mutations as :class:`SceneBox`, plus time-slice control when the mesh was built
    with a ``t`` dimension.
    """

    __vf_py_attrs__ = True

    def __init__(
        self,
        data: dict[str, Any],
        display: "Display",
        frame_id: str,
        source_kwargs: dict[str, Any],
    ) -> None:
        super().__init__(data, display, frame_id)
        self._source_kwargs = dict(source_kwargs)

    @property
    def t(self) -> int:
        return int(self._data.get("time_index", 0))

    @property
    def t_count(self) -> int:
        return int(self._data.get("time_count", 1))

    @property
    def interpolation(self) -> bool:
        return bool(self._data.get("interpolation", False))

    @property
    def time_boundary(self) -> str:
        return str(self._data.get("time_boundary", "stop"))

    def _rebuild(self, *, time_value: Any | None = None) -> "SceneFieldMesh":
        count = max(1, self.t_count)
        raw_t = self._data.get("time_index", 0) if time_value is None else time_value
        boundary = self._source_kwargs.get(
            "time_boundary",
            self._source_kwargs.get(
                "t_boundary",
                self._source_kwargs.get(
                    "animation_finish",
                    self._source_kwargs.get("animation_end", self._source_kwargs.get("on_animation_finish", self._source_kwargs.get("on_finish", "stop"))),
                ),
            ),
        )
        idx = _resolve_field_mesh_time_index(raw_t, count, boundary=boundary)
        source = dict(self._source_kwargs)
        source["t"] = idx
        rebuilt = _build_field_mesh_from_kwargs(source)
        for key, value in rebuilt.items():
            self._data[key] = value
        self._display._sync_all()
        return self

    def set_t(self, value: Any) -> "SceneFieldMesh":
        return self._rebuild(time_value=value)

    def set_time(self, value: Any) -> "SceneFieldMesh":
        return self.set_t(value)

    def set_time_boundary(self, value: Any) -> "SceneFieldMesh":
        mode = _normalize_field_mesh_time_boundary(value)
        self._source_kwargs["time_boundary"] = mode
        self._source_kwargs.pop("t_boundary", None)
        return self._rebuild()

    def set_t_boundary(self, value: Any) -> "SceneFieldMesh":
        return self.set_time_boundary(value)

    def set_interpolation(self, value: Any) -> "SceneFieldMesh":
        self._source_kwargs["interpolation"] = bool(value)
        return self._rebuild()

    def set_color(self, color: Any) -> "SceneFieldMesh":
        """Change mesh color without rebuilding positions or indices. Returns self."""
        self._source_kwargs["color"] = color
        self._data["color"] = _color_to_payload(color)
        _paint_field_mesh_vertex_colors(self._data, color)
        self._publish_color_patch(color)
        self._display._dirty = True
        return self

    def set_source(self, props: Any | None = None, **kwargs: Any) -> "SceneFieldMesh":
        """Merge source kwargs and rebuild the mesh."""
        patch: dict[str, Any] = {}
        if props is not None:
            patch.update(_mapping_like(props, ctx="field mesh source props"))
        patch.update(kwargs)
        self._source_kwargs.update(patch)
        return self._rebuild()

    def set_function_surface(
        self,
        *,
        fn: Any,
        params: Any,
        u_dim: str = "u",
        v_dim: str = "v",
        color: Any = None,
        interpolation: Any | None = None,
        depth_write: Any | None = None,
    ) -> "SceneFieldMesh":
        """Rebuild this mesh from a sampled runtime function over two chosen dimensions."""
        extra: dict[str, Any] = {}
        for key, value in self._source_kwargs.items():
            if isinstance(key, str) and re.match(r"^[xyz]_[uvwtijk]+$", key):
                continue
            extra[key] = value
        source = _build_function_surface_source_kwargs(
            fn,
            params,
            u_dim=u_dim,
            v_dim=v_dim,
            color=self._source_kwargs.get("color") if color is None else color,
            interpolation=bool(self._source_kwargs.get("interpolation", True)) if interpolation is None else bool(interpolation),
            depth_write=bool(self._source_kwargs.get("depth_write", True)) if depth_write is None else bool(depth_write),
            id=str(self._source_kwargs.get("id", self._data.get("id", "field_mesh"))),
            extra=extra,
        )
        self._source_kwargs = source
        return self._rebuild()

    def set_function_plot(
        self,
        *,
        fn: Any,
        expr_source: Any,
        params: Any,
        x_fn: Any = None,
        y_fn: Any = None,
        z_fn: Any = None,
        color: Any = None,
        color_mode: Any = "constant",
        color_axis: Any = "",
        colormap: Any = "rgb",
        interpolation: Any | None = None,
        depth_write: Any | None = None,
    ) -> "SceneFieldMesh":
        extra: dict[str, Any] = {}
        for key, value in self._source_kwargs.items():
            if isinstance(key, str) and re.match(r"^[xyzc]_[uvwtijk]+$", key):
                continue
            extra[key] = value
        source = _build_function_plot_source_kwargs(
            fn,
            expr_source,
            params,
            x_fn=x_fn,
            y_fn=y_fn,
            z_fn=z_fn,
            color=self._source_kwargs.get("color") if color is None else color,
            color_mode=color_mode,
            color_axis=color_axis,
            colormap=colormap,
            interpolation=bool(self._source_kwargs.get("interpolation", True)) if interpolation is None else bool(interpolation),
            depth_write=bool(self._source_kwargs.get("depth_write", True)) if depth_write is None else bool(depth_write),
            id=str(self._source_kwargs.get("id", self._data.get("id", "field_mesh"))),
            extra=extra,
        )
        self._source_kwargs = source
        return self._rebuild()

    def __repr__(self) -> str:
        return (
            f"SceneFieldMesh(time_index={self._data.get('time_index', 0)}, "
            f"time_count={self._data.get('time_count', 1)}, "
            f"time_boundary={self._data.get('time_boundary', 'stop')!r}, "
            f"color={self._data.get('color')!r})"
        )


class ImpostorRenderer:
    """General-purpose mutable renderer for circular/spherical impostors."""

    __vf_py_attrs__ = True

    def __init__(
        self,
        frame: "FrameRef",
        *,
        width: Any = 1.0,
        height: Any = 1.0,
        z: Any = 0.0,
        depth: Any = 0.035,
        capture_path: Any = "",
        capture_size: Any = (720, 520),
        capture_margin: Any = 44,
        show_boundary: Any = True,
        capture_supersample: Any = 1,
        sync_display: Any = True,
    ) -> None:
        self.frame = frame
        self.width = float(width)
        self.height = float(height)
        self.z = float(z)
        self.depth = float(depth)
        self.capture_path = str(capture_path or "")
        self.capture_size = tuple(int(v) for v in capture_size) if isinstance(capture_size, (list, tuple)) else (720, 520)
        self.capture_margin = int(capture_margin)
        self.show_boundary = bool(show_boundary)
        self.capture_supersample = max(1, int(capture_supersample))
        self.capture_frame_duration_ms = 42
        self.sync_display = bool(sync_display)
        self._objects: list[SceneBox] = []
        self._bounds: list[SceneBox] = []
        self._capture_frames: list[Any] = []
        if self.show_boundary:
            self._ensure_bounds()

    def render(self, impostors: Any) -> "ImpostorRenderer":
        items = list(impostors)
        if self.capture_path and not self.sync_display:
            self._capture_frames.append(self._capture_image(items))
            return self
        while len(self._objects) < len(items):
            self._objects.append(
                self.frame.add_ellipsoid(center=[0.0, 0.0, self.z], scale=[0.01, 0.01, self.depth], color=[1, 1, 1, 1])
            )
        while len(self._objects) > len(items):
            self._objects.pop().remove()
        for obj, item in zip(self._objects, items, strict=True):
            x = float(_impostor_field(item, "x", 0.0))
            y = float(_impostor_field(item, "y", 0.0))
            z = float(_impostor_field(item, "z", self.z))
            radius = float(_impostor_field(item, "radius", _impostor_field(item, "r", 0.025)))
            color = _impostor_field(item, "color", [1.0, 1.0, 1.0, 1.0])
            obj._data["center"] = [x, y, z]
            obj._data["scale"] = [2.0 * radius, 2.0 * radius, self.depth]
            obj._data["color"] = _color_to_payload(color)
        display = getattr(self.frame, "_display", None)
        if self.sync_display and display is not None:
            display._sync_all()
        if self.capture_path:
            self._capture_frames.append(self._capture_image(items))
        return self

    def save_capture(self) -> str:
        if not self.capture_path or not self._capture_frames:
            return self.capture_path
        path = Path(self.capture_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        frames = self._capture_frames
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=max(1, int(round(self.capture_frame_duration_ms))), loop=0, optimize=False)
        return str(path)

    def _ensure_bounds(self) -> None:
        if self._bounds:
            return
        wall_color = [0.82, 0.88, 0.96, 1.0]
        thickness = min(self.width, self.height) * 0.018
        z = self.z - self.depth
        self._bounds = [
            self.frame.add_box(center=[0.0, self.height * 0.5, z], scale=[self.width, thickness, self.depth], color=wall_color),
            self.frame.add_box(center=[0.0, -self.height * 0.5, z], scale=[self.width, thickness, self.depth], color=wall_color),
            self.frame.add_box(center=[-self.width * 0.5, 0.0, z], scale=[thickness, self.height, self.depth], color=wall_color),
            self.frame.add_box(center=[self.width * 0.5, 0.0, z], scale=[thickness, self.height, self.depth], color=wall_color),
        ]

    def _capture_image(self, items: list[Any]) -> Any:
        try:
            from PIL import Image, ImageDraw
        except Exception as exc:  # pragma: no cover - optional proof dependency
            raise RuntimeError("impostor GIF capture requires Pillow") from exc
        output_width, output_height = self.capture_size
        supersample = self.capture_supersample
        width = output_width * supersample
        height = output_height * supersample
        margin = max(0, self.capture_margin) * supersample
        scale = min((width - 2 * margin) / self.width, (height - 2 * margin) / self.height)
        ox = width * 0.5
        oy = height * 0.5
        image = Image.new("RGB", (width, height), "#101822")
        draw = ImageDraw.Draw(image)
        left = ox - self.width * scale * 0.5
        right = ox + self.width * scale * 0.5
        top = oy - self.height * scale * 0.5
        bottom = oy + self.height * scale * 0.5
        if self.show_boundary:
            draw.rectangle((left, top, right, bottom), outline="#dce7f2", width=3)
        for item in items:
            x = float(_impostor_field(item, "x", 0.0))
            y = float(_impostor_field(item, "y", 0.0))
            radius = float(_impostor_field(item, "radius", _impostor_field(item, "r", 0.025)))
            color = _color_to_rgb(_impostor_field(item, "color", [1.0, 1.0, 1.0, 1.0]))
            cx = ox + x * scale
            cy = oy - y * scale
            rr = radius * scale
            draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=color)
        if supersample <= 1:
            return image
        return image.resize((output_width, output_height), Image.Resampling.LANCZOS)


class UIEventLoop:
    """Frame-clock event loop for VKF examples and simple simulations."""

    __vf_py_attrs__ = True

    def __init__(self, *, fps: Any = 24, frames: Any = 120, realtime: Any = True) -> None:
        self.fps = float(fps)
        self.frames = int(frames)
        self.realtime = bool(realtime)
        if self.fps <= 0.0:
            raise ValueError("event_loop fps must be positive")
        if self.frames < 0:
            raise ValueError("event_loop frames must be non-negative")

    def run(self, stepper: Any) -> Any:
        renderer = getattr(stepper, "renderer", None)
        if renderer is not None and hasattr(renderer, "capture_frame_duration_ms"):
            renderer.capture_frame_duration_ms = 1000.0 / self.fps
        for frame_index in range(self.frames):
            t = frame_index / self.fps
            if hasattr(stepper, "step"):
                stepper.step(t, frame_index)
            else:
                stepper(t, frame_index)
            if self.realtime:
                _ui_sleep(1.0 / self.fps)
        if hasattr(stepper, "finish"):
            return stepper.finish()
        return None


def _impostor_field(item: Any, name: str, default: Any) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _color_to_rgb(color: Any) -> tuple[int, int, int]:
    payload = _color_to_payload(color)
    if isinstance(payload, str):
        text = payload.lstrip("#")
        if len(text) == 6:
            return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))
        return (255, 255, 255)
    values = list(payload)
    return tuple(max(0, min(255, int(float(values[i]) * 255.0))) for i in range(3))  # type: ignore[return-value]


class SceneCamera:
    """A mutable camera in a 3-D scene frame.

    Returned by ``d.add_camera(…)`` / ``f.add_camera(…)``.

    Methods
    -------
    translate([dx, dy, dz])
        Move the camera position (keeps target fixed). Returns self.
    look_at([x, y, z])
        Change the target point. Returns self.
    set_fov(degrees)
        Change the field of view. Returns self.
    rotate_by(angle_deg, around="z")
        One-shot orbit around the target by *angle_deg* degrees.
        Returns self.
    zoom_log(step, speed=0.16, min_dist=0.2, max_dist=1e6)
        Logarithmic dolly toward/away from target. Useful for wheel events.
        Negative *step* zooms in; positive zooms out. Returns self.
    zoom_by_wheel(step, speed=0.16, min_dist=0.2, max_dist=1e6)
        Alias for :meth:`zoom_log`.
    rotate(around="z", omega=30.0)
        Start a continuous orbit at *omega* degrees/second around *around*
        axis, pivoting about the target point.  Runs in a background thread
        at 30 fps.  Call ``stop()`` to halt.  Returns self.
    stop()
        Stop any running animation. Returns self.
    """

    __vf_py_attrs__ = True

    def __init__(self, data: dict[str, Any], display: "Display", frame_id: str) -> None:
        self._data = data
        self._display = display
        self._frame_id = frame_id
        self._anim_thread: threading.Thread | None = None
        self._anim_stop = threading.Event()

    # -- one-shot mutations ---------------------------------------------------

    def translate(self, delta: Any) -> "SceneCamera":
        """Move the camera position by [dx, dy, dz] (target stays fixed). Returns self."""
        d = _vec3(delta, "delta")
        p = self._data["pos"]
        self._data["pos"] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
        self._display._sync_all()
        return self

    def look_at(self, target: Any) -> "SceneCamera":
        """Change the look-at target point. Returns self."""
        self._data["target"] = _vec3(target, "target")
        self._display._sync_all()
        return self

    def set_fov(self, degrees: float) -> "SceneCamera":
        """Change the field of view (degrees). Returns self."""
        self._data["fov"] = float(degrees)
        self._display._sync_all()
        return self

    def set_orthographic(self, scale: float | None = None) -> "SceneCamera":
        """Use an orthographic projection. ``scale`` is half the vertical view span."""
        self._data["projection"] = "orthographic"
        if scale is not None:
            self._data["ortho_scale"] = max(1e-6, float(scale))
        elif "ortho_scale" not in self._data:
            self._data["ortho_scale"] = 2.5
        self._display._sync_all()
        return self

    def set_perspective(self) -> "SceneCamera":
        """Use the perspective projection path."""
        self._data["projection"] = "perspective"
        self._display._sync_all()
        return self

    def rotate_by(self, angle_deg: float, around: str = "z") -> "SceneCamera":
        """Orbit the camera around the target point by *angle_deg* degrees (one-shot).

        *around* = 'z' keeps the camera at the same height and orbits in XY.
        *around* = 'x' or 'y' tilts the orbit plane accordingly.
        Returns self.
        """
        ax = str(around).lower()
        if ax not in ("x", "y", "z"):
            raise ValueError(f"around must be 'x', 'y', or 'z', got {around!r}")
        p = self._data["pos"]
        t = self._data["target"]
        # offset from target
        r = [p[0] - t[0], p[1] - t[1], p[2] - t[2]]
        r2 = _rotate_vec3_around_axis(r, ax, angle_deg)
        self._data["pos"] = [t[0] + r2[0], t[1] + r2[1], t[2] + r2[2]]
        self._display._sync_all()
        return self

    def zoom_log(
        self,
        step: float,
        speed: float = 0.16,
        min_dist: float = 0.2,
        max_dist: float = 1e6,
    ) -> "SceneCamera":
        """Logarithmic dolly along the target ray.

        Interprets ``step`` like mouse wheel notches:
        - ``step < 0``: zoom in (camera moves closer to target)
        - ``step > 0``: zoom out

        The camera-target distance is multiplied by ``exp(step * speed)`` and
        clamped to ``[min_dist, max_dist]``.
        """
        s = float(step)
        if s == 0.0:
            return self
        spd = max(0.0001, float(speed))
        mn = max(0.0001, float(min_dist))
        mx = max(mn, float(max_dist))

        p = self._data["pos"]
        t = self._data["target"]
        if str(self._data.get("projection", "")).lower() == "orthographic":
            scale = float(self._data.get("ortho_scale", 2.5))
            factor = math.exp(float(step) * float(speed))
            self._data["ortho_scale"] = max(1e-6, scale * factor)
            self._display._sync_all()
            return self

        vx = p[0] - t[0]
        vy = p[1] - t[1]
        vz = p[2] - t[2]
        dist = math.sqrt(vx * vx + vy * vy + vz * vz)
        if dist < 1e-9:
            # Degenerate: choose a stable default ray direction (+Z from target).
            vx, vy, vz = 0.0, 0.0, 1.0
            dist = 1.0
        inv = 1.0 / dist
        nx, ny, nz = vx * inv, vy * inv, vz * inv

        nd = dist * math.exp(s * spd)
        if nd < mn:
            nd = mn
        if nd > mx:
            nd = mx

        self._data["pos"] = [t[0] + nx * nd, t[1] + ny * nd, t[2] + nz * nd]
        self._display._sync_all()
        return self

    def zoom_by_wheel(
        self,
        step: float,
        speed: float = 0.16,
        min_dist: float = 0.2,
        max_dist: float = 1e6,
    ) -> "SceneCamera":
        """Alias for :meth:`zoom_log` for wheel handlers."""
        return self.zoom_log(step=step, speed=speed, min_dist=min_dist, max_dist=max_dist)

    def pan_pixels(
        self,
        dx: float,
        dy: float,
        *,
        width: float = 0.0,
        height: float = 0.0,
    ) -> "SceneCamera":
        """Translate camera and target in the camera plane by a pixel drag."""
        px_h = max(1.0, float(height or width or 1.0))
        p = self._data["pos"]
        t = self._data["target"]
        up_hint = _vec3(self._data.get("up", [0, 0, 1]), "up")
        bx = p[0] - t[0]
        by = p[1] - t[1]
        bz = p[2] - t[2]
        dist = math.sqrt(bx * bx + by * by + bz * bz)
        if dist < 1e-9:
            bx, by, bz = 0.0, 0.0, 1.0
            dist = 1.0
        bx, by, bz = bx / dist, by / dist, bz / dist

        rx = up_hint[1] * bz - up_hint[2] * by
        ry = up_hint[2] * bx - up_hint[0] * bz
        rz = up_hint[0] * by - up_hint[1] * bx
        rlen = math.sqrt(rx * rx + ry * ry + rz * rz)
        if rlen < 1e-9:
            rx, ry, rz = 1.0, 0.0, 0.0
            rlen = 1.0
        rx, ry, rz = rx / rlen, ry / rlen, rz / rlen
        ux = by * rz - bz * ry
        uy = bz * rx - bx * rz
        uz = bx * ry - by * rx

        if str(self._data.get("projection", "")).lower() == "orthographic":
            world_per_px = (2.0 * float(self._data.get("ortho_scale", 2.5))) / px_h
        else:
            fov = math.radians(float(self._data.get("fov", 45.0)))
            world_per_px = (2.0 * dist * math.tan(fov * 0.5)) / px_h
        tx = ((-float(dx) * rx) + (float(dy) * ux)) * world_per_px
        ty = ((-float(dx) * ry) + (float(dy) * uy)) * world_per_px
        tz = ((-float(dx) * rz) + (float(dy) * uz)) * world_per_px
        self._data["pos"] = [p[0] + tx, p[1] + ty, p[2] + tz]
        self._data["target"] = [t[0] + tx, t[1] + ty, t[2] + tz]
        self._display._sync_all()
        return self

    # -- continuous animation -------------------------------------------------

    def rotate(self, around: str = "z", omega: float = 30.0) -> "SceneCamera":
        """Start a continuous orbit at *omega* degrees/second around *around* axis.

        The camera orbits around its current target point.  The background
        thread writes ``vf-display.json`` at 30 fps for smooth motion.
        Call ``stop()`` to halt.  Returns self.

        Example::

            cam.rotate(around="z", omega=30)   # 30 °/s, full revolution in 12 s
            # ... allow the host-driven event loop to tick while rotating ...
            cam.stop()
        """
        self.stop()  # halt any existing animation
        self._anim_stop.clear()
        ax = str(around).lower()
        if ax not in ("x", "y", "z"):
            raise ValueError(f"around must be 'x', 'y', or 'z', got {around!r}")
        dt = 1.0 / _ANIM_FPS

        def _run() -> None:
            while not self._anim_stop.is_set():
                t0 = _ui_monotonic()
                self.rotate_by(omega * dt, ax)
                elapsed = _ui_monotonic() - t0
                sleep = max(0.0, dt - elapsed)
                self._anim_stop.wait(timeout=sleep)

        self._anim_thread = threading.Thread(target=_run, daemon=True, name="vf-cam-orbit")
        self._anim_thread.start()
        return self

    def stop(self) -> "SceneCamera":
        """Stop any running animation. Returns self."""
        self._anim_stop.set()
        if self._anim_thread is not None:
            self._anim_thread.join(timeout=0.5)
            self._anim_thread = None
        self._anim_stop.clear()
        return self

    # -- convenience ----------------------------------------------------------

    @property
    def pos(self) -> list[float]:
        return list(self._data["pos"])

    @property
    def target(self) -> list[float]:
        return list(self._data["target"])

    @property
    def fov(self) -> float:
        return float(self._data["fov"])

    def __repr__(self) -> str:
        return f"SceneCamera(pos={self._data['pos']}, target={self._data['target']}, fov={self._data['fov']})"


class SceneLight:
    """A mutable light in a 3-D scene frame.

    Returned by ``d.add_light(…)`` / ``f.add_light(…)``.

    Methods
    -------
    translate([dx, dy, dz])
        Move the light position. Returns self.
    set_color(color)
        Change the light color (CSS name or #rrggbb). Returns self.
    set_model(model)
        Change the lighting model ('flat', 'lambert', 'blinn_phong'). Returns self.
    rotate(around="z", omega=30.0)
        Orbit the light around the origin at *omega* degrees/second. Returns self.
    stop()
        Stop any running animation. Returns self.
    """

    __vf_py_attrs__ = True

    def __init__(self, data: dict[str, Any], display: "Display", frame_id: str) -> None:
        self._data = data
        self._display = display
        self._frame_id = frame_id
        self._anim_thread: threading.Thread | None = None
        self._anim_stop = threading.Event()

    # -- mutations ------------------------------------------------------------

    def translate(self, delta: Any) -> "SceneLight":
        """Move the light by [dx, dy, dz]. Returns self."""
        d = _vec3(delta, "delta")
        p = self._data["pos"]
        self._data["pos"] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
        self._display._sync_all()
        return self

    def set_pos(self, pos: Any) -> "SceneLight":
        """Set the light position to [x, y, z]. Returns self."""
        self._data["pos"] = _vec3(pos, "pos")
        self._display._sync_all()
        return self

    def set_color(self, color: Any) -> "SceneLight":
        """Change light color. Returns self."""
        self._data["color"] = color
        self._display._sync_all()
        return self

    def set_model(self, model: str) -> "SceneLight":
        """Change lighting model. Returns self."""
        m = str(model).lower().replace("-", "_")
        if m in {"flat", "lambert", "phong"}:
            m = "blinn_phong"
        if m not in LIGHT_MODELS:
            raise ValueError(f"model {model!r} unknown; use one of: {sorted(LIGHT_MODELS)}")
        self._data["model"] = m
        self._display._sync_all()
        return self

    def set_intensity(self, intensity: float) -> "SceneLight":
        self._data["intensity"] = max(0.0, float(intensity))
        self._display._sync_all()
        return self

    def set_power(self, power: float) -> "SceneLight":
        return self.set_intensity(power)

    def set_kind(self, kind: str) -> "SceneLight":
        normalized = str(kind).lower().strip()
        if normalized == "spotlight":
            normalized = "spot"
        if normalized not in {"point", "spot"}:
            raise ValueError("light kind must be 'point' or 'spot'")
        self._data["kind"] = normalized
        self._display._sync_all()
        return self

    def set_direction(self, direction: Any) -> "SceneLight":
        self._data["direction"] = _vec3(direction, "direction")
        self._display._sync_all()
        return self

    def set_target(self, target: Any) -> "SceneLight":
        self._data["target"] = _vec3(target, "target")
        self._display._sync_all()
        return self

    def set_range(self, distance: float) -> "SceneLight":
        self._data["range"] = max(0.0, float(distance))
        self._display._sync_all()
        return self

    def set_cone(self, inner_cone_deg: float, outer_cone_deg: float) -> "SceneLight":
        self._data["inner_cone_deg"] = float(inner_cone_deg)
        self._data["outer_cone_deg"] = float(outer_cone_deg)
        self._display._sync_all()
        return self

    # -- continuous animation -------------------------------------------------

    def rotate(self, around: str = "z", omega: float = 30.0) -> "SceneLight":
        """Orbit the light around the world origin at *omega* degrees/second. Returns self."""
        self.stop()
        self._anim_stop.clear()
        ax = str(around).lower()
        if ax not in ("x", "y", "z"):
            raise ValueError(f"around must be 'x', 'y', or 'z'")
        dt = 1.0 / _ANIM_FPS

        def _run() -> None:
            while not self._anim_stop.is_set():
                t0 = _ui_monotonic()
                p = self._data["pos"]
                p2 = _rotate_vec3_around_axis(p, ax, omega * dt)
                self._data["pos"] = p2
                self._display._sync_all()
                elapsed = _ui_monotonic() - t0
                self._anim_stop.wait(timeout=max(0.0, dt - elapsed))

        self._anim_thread = threading.Thread(target=_run, daemon=True, name="vf-light-orbit")
        self._anim_thread.start()
        return self

    def stop(self) -> "SceneLight":
        """Stop any running animation. Returns self."""
        self._anim_stop.set()
        if self._anim_thread is not None:
            self._anim_thread.join(timeout=0.5)
            self._anim_thread = None
        self._anim_stop.clear()
        return self

    # -- convenience ----------------------------------------------------------

    @property
    def pos(self) -> list[float]:
        return list(self._data["pos"])

    def __repr__(self) -> str:
        return (
            f"SceneLight(pos={self._data['pos']}, model={self._data['model']!r}, "
            f"color={self._data['color']!r}, intensity={self._data.get('intensity', 24.0)!r}, "
            f"kind={self._data.get('kind', 'point')!r})"
        )


# ---------------------------------------------------------------------------
# VKF-authored axis wrappers
# ---------------------------------------------------------------------------

@dataclass
class Axis2D:
    """Small VKF axis wrapper that emits ordinary frame geometry.

    The wrapper owns navigation/event state, but the visible axes and curves are
    plain ``field_mesh`` entries in the target frame.  That keeps mirrors,
    picking, and frame navigation on the same renderer path as any other VKF
    geometry.
    """

    __vf_py_attrs__ = True

    frame: "FrameRef"
    x_min: float = -1.0
    x_max: float = 1.0
    y_min: float = -1.0
    y_max: float = 1.0
    x_label: str = "$x$"
    y_label: str = "$y$"
    prefix: str = "axis2d"

    @property
    def _axis_bind_id(self) -> str:
        return f"{self.prefix}__axis2d_bind"

    def _series(self, values: Any, idx: str = "u") -> AxisTaggedValue:
        if isinstance(values, AxisTaggedValue):
            return values
        if isinstance(values, (VFVector, list, tuple)):
            return AxisTaggedValue(tuple(float(v) for v in values), idx)
        return AxisTaggedValue((float(values),), idx)

    def _map_x(self, value: float) -> float:
        span = self.x_max - self.x_min
        if span == 0.0:
            return 0.0
        return -1.0 + (2.0 * ((float(value) - self.x_min) / span))

    def _map_y(self, value: float) -> float:
        span = self.y_max - self.y_min
        if span == 0.0:
            return 0.0
        return -1.0 + (2.0 * ((float(value) - self.y_min) / span))

    def _map_series_x(self, values: Any) -> AxisTaggedValue:
        tagged = self._series(values)
        return AxisTaggedValue(tuple(self._map_x(float(v)) for v in tagged.data), tagged.idx)

    def _map_series_y(self, values: Any, idx: str = "u") -> AxisTaggedValue:
        tagged = self._series(values, idx)
        return AxisTaggedValue(tuple(self._map_y(float(v)) for v in tagged.data), tagged.idx)

    def _zeros_like(self, values: Any, idx: str = "u") -> AxisTaggedValue:
        tagged = self._series(values, idx)
        data = tagged.data
        if isinstance(data, tuple):
            return AxisTaggedValue(tuple(0.0 for _ in data), tagged.idx)
        return AxisTaggedValue((0.0,), tagged.idx)

    def _optional_tick_values(self, values: Any) -> list[float] | None:
        if values is None:
            return None
        return [float(v) for v in self._series(values).data]

    def _optional_tick_labels(self, labels: Any) -> list[str] | None:
        if labels is None:
            return None
        if isinstance(labels, AxisTaggedValue):
            labels = labels.data
        if isinstance(labels, (VFVector, list, tuple)):
            return [str(v) for v in labels]
        return [str(labels)]

    def _line(
        self,
        name: str,
        x0: float,
        y0: float,
        x1: float,
        y1: float,
        *,
        color: Any,
        width: float,
    ) -> SceneFieldMesh:
        ys = AxisTaggedValue((self._map_y(float(y0)), self._map_y(float(y1))), "u")
        xs = AxisTaggedValue((self._map_x(float(x0)), self._map_x(float(x1))), "u")
        zs = AxisTaggedValue((0.0, 0.0), "u")
        return self.frame.add(
            x=xs,
            y=ys,
            z=zs,
            id=f"{self.prefix}_{name}",
            color=color,
            representation="edges",
            edge_width=float(width),
            render_mode="marker_impostor",
            marker_space="pixel",
            aspect="equal",
            mode3d=False,
            receives_lighting=False,
            casts_shadow=False,
            depth_write=False,
        )

    def crosshair(
        self,
        *,
        color: Any = "white",
        width: float = 1.0,
        ticks: bool = True,
        x_tick_mode: str = "linear",
        y_tick_mode: str = "linear",
        tick_hints: Any = (1, 2, 5),
        tick_dist: float = 120.0,
        tick_len: float = 7.0,
        x_tick_alignment: str = "center",
        y_tick_alignment: str = "center",
        x_ticks: Any = None,
        x_tick_labels: Any = None,
        y_ticks: Any = None,
        y_tick_labels: Any = None,
        x_tick_label_placement: str = "below",
        y_tick_label_placement: str = "left",
        x_label_placement: str = "below",
        y_label_placement: str = "left",
        label_font_size: float = 13.0,
        tick_label_font_size: float = 11.0,
        label_frame_pad: float = 20.0,
        label_axis_pad: float = 34.0,
        grid: bool = False,
        grid_alpha: float = 0.18,
        grid_width: float = 1.0,
        interactive: bool = True,
        axis_lock_angle_deg: float = 5.0,
        axis_lock_sample_count: int = 3,
        rotation_deg: float = 0.0,
    ) -> "Axis2D":
        rows_x: list[tuple[float, float]] = []
        rows_y: list[tuple[float, float]] = []
        if self.y_min <= 0.0 <= self.y_max:
            rows_x.append((self._map_x(self.x_min), self._map_x(self.x_max)))
            rows_y.append((self._map_y(0.0), self._map_y(0.0)))
        if self.x_min <= 0.0 <= self.x_max:
            rows_x.append((self._map_x(0.0), self._map_x(0.0)))
            rows_y.append((self._map_y(self.y_min), self._map_y(self.y_max)))
        if rows_x:
            tagged_x = AxisTaggedValue(tuple(rows_x), "iu")
            tagged_y = AxisTaggedValue(tuple(rows_y), "iu")
            tagged_z = AxisTaggedValue(tuple((0.0, 0.0) for _ in rows_x), "iu")
            self.frame.add(
                x=tagged_x,
                y=tagged_y,
                z=tagged_z,
                id=f"{self.prefix}_crosshair",
                color=color,
                representation="edges",
                edge_width=float(width),
                render_mode="marker_impostor",
                marker_space="pixel",
                aspect="equal",
                axis_bind_id=self._axis_bind_id,
                axis_full_frame=True,
                axis_ticks={
                    "enabled": bool(ticks),
                    "x_mode": str(x_tick_mode),
                    "y_mode": str(y_tick_mode),
                    "x_min": float(self.x_min),
                    "x_max": float(self.x_max),
                    "y_min": float(self.y_min),
                    "y_max": float(self.y_max),
                    "hints": list(tick_hints),
                    "dist": float(tick_dist),
                    "len": float(tick_len),
                    "x_alignment": str(x_tick_alignment),
                    "y_alignment": str(y_tick_alignment),
                    "x_ticks": self._optional_tick_values(x_ticks),
                    "x_tick_labels": self._optional_tick_labels(x_tick_labels),
                    "y_ticks": self._optional_tick_values(y_ticks),
                    "y_tick_labels": self._optional_tick_labels(y_tick_labels),
                    "x_tick_label_placement": str(x_tick_label_placement),
                    "y_tick_label_placement": str(y_tick_label_placement),
                    "x_label_placement": str(x_label_placement),
                    "y_label_placement": str(y_label_placement),
                    "x_label": str(self.x_label),
                    "y_label": str(self.y_label),
                    "label_font_size": float(label_font_size),
                    "tick_label_font_size": float(tick_label_font_size),
                    "label_frame_pad": float(label_frame_pad),
                    "label_axis_pad": float(label_axis_pad),
                    "grid": bool(grid),
                    "grid_alpha": float(grid_alpha),
                    "grid_width": float(grid_width),
                    "axis_lock_angle_deg": float(axis_lock_angle_deg),
                    "axis_lock_sample_count": int(axis_lock_sample_count),
                    "rotation_deg": float(rotation_deg),
                },
                axis_interactive=bool(interactive),
                mode3d=False,
                receives_lighting=False,
                casts_shadow=False,
                depth_write=False,
            )
            self.frame.add_layer(
                "axis",
                id=f"{self.prefix}_crosshair_layer",
                dim=2,
                variant="crosshair",
                geometry_ids=[f"{self.prefix}_crosshair"],
                x_min=float(self.x_min),
                x_max=float(self.x_max),
                y_min=float(self.y_min),
                y_max=float(self.y_max),
                x_mode=str(x_tick_mode),
                y_mode=str(y_tick_mode),
                ticks=bool(ticks),
                tick_hints=list(tick_hints),
                tick_dist=float(tick_dist),
                tick_len=float(tick_len),
                grid=bool(grid),
                grid_alpha=float(grid_alpha),
                grid_width=float(grid_width),
                interactive=bool(interactive),
                rotation_deg=float(rotation_deg),
            )
            if interactive:
                self.frame.register_default_event_handler(f"axis2d:{self.prefix}", self.handle_events)
        return self

    def box(
        self,
        *,
        color: Any = "white",
        width: float = 1.0,
        ticks: bool = True,
        x_tick_mode: str = "linear",
        y_tick_mode: str = "linear",
        tick_hints: Any = (1, 2, 5),
        tick_dist: float = 120.0,
        tick_len: float = 7.0,
        x_tick_alignment: str = "center",
        y_tick_alignment: str = "center",
        x_ticks: Any = None,
        x_tick_labels: Any = None,
        y_ticks: Any = None,
        y_tick_labels: Any = None,
        x_tick_label_placement: str = "below",
        y_tick_label_placement: str = "left",
        x_label_placement: str = "below",
        y_label_placement: str = "left",
        label_font_size: float = 13.0,
        tick_label_font_size: float = 11.0,
        label_frame_pad: float = 20.0,
        label_axis_pad: float = 34.0,
        margin_px: float = 58.0,
        grid: bool = False,
        grid_alpha: float = 0.18,
        grid_width: float = 1.0,
        interactive: bool = True,
        axis_lock_angle_deg: float = 5.0,
        axis_lock_sample_count: int = 3,
        rotation_deg: float = 0.0,
    ) -> "Axis2D":
        rows_x = ((-1.0, 1.0), (1.0, 1.0), (1.0, -1.0), (-1.0, -1.0))
        rows_y = ((-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0))
        self.frame.add(
            x=AxisTaggedValue(rows_x, "iu"),
            y=AxisTaggedValue(rows_y, "iu"),
            z=AxisTaggedValue(tuple((0.0, 0.0) for _ in rows_x), "iu"),
            id=f"{self.prefix}_box",
            color=color,
            representation="edges",
            edge_width=float(width),
            render_mode="marker_impostor",
            marker_space="pixel",
            aspect="equal",
            axis_bind_id=self._axis_bind_id,
            axis_box=True,
            axis_margin_px=float(margin_px),
            axis_ticks={
                "enabled": bool(ticks),
                "x_mode": str(x_tick_mode),
                "y_mode": str(y_tick_mode),
                "x_min": float(self.x_min),
                "x_max": float(self.x_max),
                "y_min": float(self.y_min),
                "y_max": float(self.y_max),
                "hints": list(tick_hints),
                "dist": float(tick_dist),
                "len": float(tick_len),
                "x_alignment": str(x_tick_alignment),
                "y_alignment": str(y_tick_alignment),
                "x_ticks": self._optional_tick_values(x_ticks),
                "x_tick_labels": self._optional_tick_labels(x_tick_labels),
                "y_ticks": self._optional_tick_values(y_ticks),
                "y_tick_labels": self._optional_tick_labels(y_tick_labels),
                "x_tick_label_placement": str(x_tick_label_placement),
                "y_tick_label_placement": str(y_tick_label_placement),
                "x_label_placement": str(x_label_placement),
                "y_label_placement": str(y_label_placement),
                "x_label": str(self.x_label),
                "y_label": str(self.y_label),
                "label_font_size": float(label_font_size),
                "tick_label_font_size": float(tick_label_font_size),
                "label_frame_pad": float(label_frame_pad),
                "label_axis_pad": float(label_axis_pad),
                "grid": bool(grid),
                "grid_alpha": float(grid_alpha),
                "grid_width": float(grid_width),
                "axis_lock_angle_deg": float(axis_lock_angle_deg),
                "axis_lock_sample_count": int(axis_lock_sample_count),
                "rotation_deg": float(rotation_deg),
            },
            axis_interactive=bool(interactive),
            mode3d=False,
            receives_lighting=False,
            casts_shadow=False,
            depth_write=False,
        )
        self.frame.add_layer(
            "axis",
            id=f"{self.prefix}_box_layer",
            dim=2,
            variant="box",
            geometry_ids=[f"{self.prefix}_box"],
            x_min=float(self.x_min),
            x_max=float(self.x_max),
            y_min=float(self.y_min),
            y_max=float(self.y_max),
            x_mode=str(x_tick_mode),
            y_mode=str(y_tick_mode),
            ticks=bool(ticks),
            tick_hints=list(tick_hints),
            tick_dist=float(tick_dist),
            tick_len=float(tick_len),
            margin_px=float(margin_px),
            grid=bool(grid),
            grid_alpha=float(grid_alpha),
            grid_width=float(grid_width),
            interactive=bool(interactive),
            rotation_deg=float(rotation_deg),
        )
        if interactive:
            self.frame.register_default_event_handler(f"axis2d:{self.prefix}", self.handle_events)
        return self

    def _polar(
        self,
        variant: str,
        *,
        color: Any = "white",
        width: float = 1.0,
        ticks: bool = True,
        tick_hints: Any = (1, 2, 5),
        tick_dist: float = 120.0,
        tick_len: float = 7.0,
        margin_px: float = 58.0,
        rings: int = 5,
        spokes: int = 12,
        theta_label_step_deg: float = 30.0,
        r_min: float = 0.0,
        r_max: float | None = None,
        label_font_size: float = 13.0,
        tick_label_font_size: float = 11.0,
        grid: bool = True,
        grid_alpha: float = 0.18,
        grid_width: float = 1.0,
        interactive: bool = True,
        axis_lock_angle_deg: float = 5.0,
        axis_lock_sample_count: int = 3,
        rotation_deg: float = 0.0,
    ) -> "Axis2D":
        resolved_r_max = float(r_max) if r_max is not None else max(
            abs(float(self.x_min)),
            abs(float(self.x_max)),
            abs(float(self.y_min)),
            abs(float(self.y_max)),
            1.0,
        )
        resolved_r_min = max(0.0, float(r_min))
        if resolved_r_max <= resolved_r_min:
            resolved_r_max = resolved_r_min + 1.0

        rows_x: list[tuple[float, float]] = []
        rows_y: list[tuple[float, float]] = []
        segment_count = 72
        for i in range(segment_count):
            a0 = (math.tau * i) / segment_count
            a1 = (math.tau * (i + 1)) / segment_count
            rows_x.append((math.cos(a0), math.cos(a1)))
            rows_y.append((math.sin(a0), math.sin(a1)))
        for i in range(max(1, int(spokes))):
            a = (math.tau * i) / max(1, int(spokes))
            rows_x.append((0.0, math.cos(a)))
            rows_y.append((0.0, math.sin(a)))

        geometry_id = f"{self.prefix}_{variant}"
        axis_ticks = {
            "enabled": bool(ticks),
            "polar": True,
            "polar_variant": str(variant),
            "x_mode": "linear",
            "y_mode": "linear",
            "x_min": float(self.x_min),
            "x_max": float(self.x_max),
            "y_min": float(self.y_min),
            "y_max": float(self.y_max),
            "r_min": float(resolved_r_min),
            "r_max": float(resolved_r_max),
            "rings": int(rings),
            "spokes": int(spokes),
            "theta_label_step_deg": float(theta_label_step_deg),
            "hints": list(tick_hints),
            "dist": float(tick_dist),
            "len": float(tick_len),
            "x_label": str(self.x_label),
            "y_label": str(self.y_label),
            "label_font_size": float(label_font_size),
            "tick_label_font_size": float(tick_label_font_size),
            "grid": bool(grid),
            "grid_alpha": float(grid_alpha),
            "grid_width": float(grid_width),
            "axis_lock_angle_deg": float(axis_lock_angle_deg),
            "axis_lock_sample_count": int(axis_lock_sample_count),
            "rotation_deg": float(rotation_deg),
        }
        self.frame.add(
            x=AxisTaggedValue(tuple(rows_x), "iu"),
            y=AxisTaggedValue(tuple(rows_y), "iu"),
            z=AxisTaggedValue(tuple((0.0, 0.0) for _ in rows_x), "iu"),
            id=geometry_id,
            color=color,
            representation="edges",
            edge_width=float(width),
            render_mode="marker_impostor",
            marker_space="pixel",
            aspect="equal",
            axis_bind_id=self._axis_bind_id,
            axis_full_frame=False,
            axis_box=True,
            axis_polar=True,
            axis_margin_px=float(margin_px),
            axis_ticks=axis_ticks,
            axis_interactive=bool(interactive),
            mode3d=False,
            receives_lighting=False,
            casts_shadow=False,
            depth_write=False,
        )
        self.frame.add_layer(
            "axis",
            id=f"{self.prefix}_{variant}_layer",
            dim=2,
            variant=variant,
            geometry_ids=[geometry_id],
            x_min=float(self.x_min),
            x_max=float(self.x_max),
            y_min=float(self.y_min),
            y_max=float(self.y_max),
            r_min=float(resolved_r_min),
            r_max=float(resolved_r_max),
            rings=int(rings),
            spokes=int(spokes),
            ticks=bool(ticks),
            tick_hints=list(tick_hints),
            tick_dist=float(tick_dist),
            tick_len=float(tick_len),
            grid=bool(grid),
            grid_alpha=float(grid_alpha),
            grid_width=float(grid_width),
            interactive=bool(interactive),
            rotation_deg=float(rotation_deg),
        )
        if interactive:
            self.frame.register_default_event_handler(f"axis2d:{self.prefix}", self.handle_events)
        return self

    def polar_crosshair(self, **kwargs: Any) -> "Axis2D":
        return self._polar("polar_crosshair", **kwargs)

    def add_text(
        self,
        text: Any,
        *,
        x: Any,
        y: Any,
        font_size: float = 12.0,
        ha: str = "center",
        va: str = "center",
        color: Any = "white",
        id: str | None = None,
    ) -> "Axis2D":
        """Add KaTeX-capable overlay text in axis data coordinates."""

        def _map_values(values: Any, mapper: Any) -> Any:
            if isinstance(values, AxisTaggedValue):
                return AxisTaggedValue(tuple(mapper(float(v)) for v in values.data), values.idx)
            if isinstance(values, (VFVector, list, tuple)):
                return [mapper(float(v)) for v in values]
            return mapper(float(values))

        self.frame.add_text(
            text=text,
            x=_map_values(x, self._map_x),
            y=_map_values(y, self._map_y),
            font_size=font_size,
            ha=ha,
            va=va,
            color=color,
            id=id,
            aspect="equal",
        )
        return self

    def ticks(
        self,
        *,
        x: Any = None,
        y: Any = None,
        color: Any = [0.94, 0.94, 0.82, 0.82],
        width: float = 1.4,
        size: float = 0.035,
    ) -> "Axis2D":
        half = max(0.0, float(size))
        y0 = 0.0 if self.y_min <= 0.0 <= self.y_max else self.y_min
        x0 = 0.0 if self.x_min <= 0.0 <= self.x_max else self.x_min
        if x is not None:
            for n, xv in enumerate(self._series(x).data):
                self._line(
                    f"x_tick_{n}",
                    float(xv),
                    y0 - half * (self.y_max - self.y_min) * 0.5,
                    float(xv),
                    y0 + half * (self.y_max - self.y_min) * 0.5,
                    color=color,
                    width=width,
                )
        if y is not None:
            for n, yv in enumerate(self._series(y).data):
                self._line(
                    f"y_tick_{n}",
                    x0 - half * (self.x_max - self.x_min) * 0.5,
                    float(yv),
                    x0 + half * (self.x_max - self.x_min) * 0.5,
                    float(yv),
                    color=color,
                    width=width,
                )
        return self

    def plot(
        self,
        *,
        x: Any = None,
        y: Any = None,
        r: Any = None,
        phi: Any = None,
        color: Any = [1.0, 0.56, 0.08, 1.0],
        width: float = 2.4,
        id: str = "curve",
    ) -> SceneFieldMesh:
        cartesian = x is not None or y is not None
        polar = r is not None or phi is not None
        if cartesian and polar:
            raise ValueError("axis_2d.plot(...) accepts either x/y or r/phi, not both")
        if polar:
            if r is None or phi is None:
                raise ValueError("axis_2d.plot(...) polar form requires both r and phi")
            source_rs = self._series(r)
            source_phis = self._series(phi, source_rs.idx)
            if source_rs.idx != source_phis.idx:
                raise ValueError("axis_2d.plot(...) r and phi indices must match")
            source_xs = AxisTaggedValue(
                tuple(float(rv) * math.cos(float(pv)) for rv, pv in zip(source_rs.data, source_phis.data)),
                source_rs.idx,
            )
            source_ys = AxisTaggedValue(
                tuple(float(rv) * math.sin(float(pv)) for rv, pv in zip(source_rs.data, source_phis.data)),
                source_rs.idx,
            )
        else:
            if x is None or y is None:
                raise ValueError("axis_2d.plot(...) requires x/y or r/phi")
            source_xs = self._series(x)
            source_ys = self._series(y, source_xs.idx)
            if source_xs.idx != source_ys.idx:
                raise ValueError("axis_2d.plot(...) x and y indices must match")
        xs = self._map_series_x(source_xs)
        ys = self._map_series_y(source_ys, xs.idx)
        return self.frame.add(
            x=xs,
            y=ys,
            z=self._zeros_like(xs),
            id=f"{self.prefix}_{id}",
            color=color,
            representation="edges",
            edge_width=float(width),
            render_mode="marker_impostor",
            marker_space="pixel",
            axis_bind_id=self._axis_bind_id,
            axis_plot2d=(
                {
                    "x_values": [float(v) for v in source_xs.data],
                    "y_values": [float(v) for v in source_ys.data],
                    "r_values": [float(v) for v in source_rs.data],
                    "phi_values": [float(v) for v in source_phis.data],
                }
                if polar
                else {
                    "x_values": [float(v) for v in source_xs.data],
                    "y_values": [float(v) for v in source_ys.data],
                }
            ),
            mode3d=False,
            receives_lighting=False,
            casts_shadow=False,
            depth_write=False,
        )

    def handle_events(self, event: Any) -> bool:
        """Pan/zoom the axis viewport when VKF routes mouse events here."""
        name = str(getattr(event, "event", getattr(event, "name", "")) or "")
        if name == "wheel" or isinstance(event, MouseWheel):
            step = float(getattr(event, "step", 0.0) or 0.0)
            if step == 0.0:
                delta = float(getattr(event, "delta", 0.0) or 0.0)
                step = 1.0 if delta > 0.0 else -1.0
            self.zoom_by_wheel(step)
            return True
        if name == "drag" or isinstance(event, MouseDrag):
            dx = float(getattr(event, "dx", 0.0) or 0.0)
            dy = float(getattr(event, "dy", 0.0) or 0.0)
            width = float(getattr(event, "width", 0.0) or 0.0)
            height = float(getattr(event, "height", 0.0) or 0.0)
            self.pan_pixels(dx, dy, width=width, height=height)
            return True
        return False

    def pan_pixels(self, dx: float, dy: float, *, width: float = 0.0, height: float = 0.0) -> "Axis2D":
        px_w = max(1.0, float(width or 1.0))
        px_h = max(1.0, float(height or 1.0))
        sx = self.x_max - self.x_min
        sy = self.y_max - self.y_min
        tx = -float(dx) * sx / px_w
        ty = float(dy) * sy / px_h
        self.x_min += tx
        self.x_max += tx
        self.y_min += ty
        self.y_max += ty
        return self

    def zoom_by_wheel(self, step: float, *, speed: float = 0.12) -> "Axis2D":
        factor = math.exp(float(step) * float(speed))
        cx = (self.x_min + self.x_max) * 0.5
        cy = (self.y_min + self.y_max) * 0.5
        hx = (self.x_max - self.x_min) * 0.5 * factor
        hy = (self.y_max - self.y_min) * 0.5 * factor
        self.x_min = cx - hx
        self.x_max = cx + hx
        self.y_min = cy - hy
        self.y_max = cy + hy
        return self


class Axis3D:
    """3-D axis sugar that emits ordinary VKF geometry into a frame."""

    __vf_py_attrs__ = True

    def __init__(
        self,
        *,
        frame: "FrameRef",
        x_min: float = -1.0,
        x_max: float = 1.0,
        y_min: float = -1.0,
        y_max: float = 1.0,
        z_min: float = -1.0,
        z_max: float = 1.0,
        x_label: str = "$x$",
        y_label: str = "$y$",
        z_label: str = "$z$",
        prefix: str = "axis3d",
    ) -> None:
        self.frame = frame
        self.x_min = float(x_min)
        self.x_max = float(x_max)
        self.y_min = float(y_min)
        self.y_max = float(y_max)
        self.z_min = float(z_min)
        self.z_max = float(z_max)
        self.x_label = str(x_label)
        self.y_label = str(y_label)
        self.z_label = str(z_label)
        self.prefix = str(prefix)
        self._camera: SceneCamera | None = None

    @property
    def _axis_bind_id(self) -> str:
        return f"{self.prefix}__axis3d_bind"

    @staticmethod
    def _line_u(axis: str, lo: float, hi: float) -> tuple[AxisTaggedValue, AxisTaggedValue, AxisTaggedValue]:
        vals = (float(lo), float(hi))
        zeros = (0.0, 0.0)
        if axis == "x":
            return AxisTaggedValue(vals, "u"), AxisTaggedValue(zeros, "u"), AxisTaggedValue(zeros, "u")
        if axis == "y":
            return AxisTaggedValue(zeros, "u"), AxisTaggedValue(vals, "u"), AxisTaggedValue(zeros, "u")
        return AxisTaggedValue(zeros, "u"), AxisTaggedValue(zeros, "u"), AxisTaggedValue(vals, "u")

    def bind_camera(self, camera: SceneCamera) -> "Axis3D":
        self._camera = camera
        return self

    @staticmethod
    def _nice_ticks(lo: float, hi: float, *, target_count: int = 5) -> list[float]:
        span = float(hi) - float(lo)
        if not math.isfinite(span) or span <= 0.0:
            return []
        raw = span / max(1, int(target_count))
        step = Axis3D._nice_tick_step(raw)
        start = math.ceil(float(lo) / step) * step
        out: list[float] = []
        value = start
        guard = 0
        eps = abs(step) * 1e-8
        while value <= float(hi) + eps and guard < 1000:
            if abs(value) < eps:
                value = 0.0
            out.append(value)
            value += step
            guard += 1
        return out

    @staticmethod
    def _nice_tick_step(raw: float) -> float:
        raw = abs(float(raw))
        if not math.isfinite(raw) or raw <= 0.0:
            return 1.0
        power = 10.0 ** math.floor(math.log10(raw))
        for hint in (1.0, 2.0, 5.0, 10.0):
            candidate = hint * power
            if raw <= candidate:
                return candidate
        return 10.0 * power

    @staticmethod
    def _ticks_with_step(lo: float, hi: float, step: float) -> list[float]:
        step = abs(float(step))
        if not math.isfinite(step) or step <= 0.0:
            return []
        start = math.ceil(float(lo) / step) * step
        eps = abs(step) * 1e-8
        out: list[float] = []
        value = start
        guard = 0
        while value <= float(hi) + eps and guard < 1000:
            if abs(value) < eps:
                value = 0.0
            out.append(value)
            value += step
            guard += 1
        return out

    @staticmethod
    def _without_zero(values: list[float]) -> list[float]:
        return [float(v) for v in values if abs(float(v)) > 1e-10]

    @staticmethod
    def _alignment_span(alignment: str) -> tuple[float, float]:
        text = str(alignment or "center").strip().lower()
        if text in {"positive", "right", "top", "above"}:
            return 0.0, 1.0
        if text in {"negative", "left", "bottom", "below"}:
            return -1.0, 0.0
        return -0.5, 0.5

    @staticmethod
    def _tick_label(value: float) -> str:
        return f"${value:g}$"

    @staticmethod
    def _optional_tick_values(values: Any) -> list[float] | None:
        if values is None:
            return None
        if isinstance(values, AxisTaggedValue):
            values = values.data
        if isinstance(values, (VFVector, list, tuple)):
            return [float(v) for v in values]
        return [float(values)]

    def _tick_lines(
        self,
        axis: str,
        values: list[float],
        *,
        length: float,
        alignment: str,
    ) -> tuple[AxisTaggedValue, AxisTaggedValue, AxisTaggedValue]:
        a0, a1 = self._alignment_span(alignment)
        rows_x: list[tuple[float, float]] = []
        rows_y: list[tuple[float, float]] = []
        rows_z: list[tuple[float, float]] = []
        for value in values:
            if axis == "x":
                rows_x.append((float(value), float(value)))
                rows_y.append((0.0, 0.0))
                rows_z.append((a0 * length, a1 * length))
            elif axis == "y":
                rows_x.append((0.0, 0.0))
                rows_y.append((float(value), float(value)))
                rows_z.append((a0 * length, a1 * length))
            else:
                rows_x.append((0.0, 0.0))
                rows_y.append((a0 * length, a1 * length))
                rows_z.append((float(value), float(value)))
        return (
            AxisTaggedValue(tuple(rows_x), "iu"),
            AxisTaggedValue(tuple(rows_y), "iu"),
            AxisTaggedValue(tuple(rows_z), "iu"),
        )

    def _append_tick_line_rows(
        self,
        rows_x: list[tuple[float, float]],
        rows_y: list[tuple[float, float]],
        rows_z: list[tuple[float, float]],
        axis: str,
        values: list[float],
        *,
        length: float,
        alignment: str,
    ) -> None:
        a0, a1 = self._alignment_span(alignment)
        for value in values:
            if axis == "x":
                rows_x.append((float(value), float(value)))
                rows_y.append((0.0, 0.0))
                rows_z.append((a0 * length, a1 * length))
            elif axis == "y":
                rows_x.append((0.0, 0.0))
                rows_y.append((float(value), float(value)))
                rows_z.append((a0 * length, a1 * length))
            else:
                rows_x.append((0.0, 0.0))
                rows_y.append((a0 * length, a1 * length))
                rows_z.append((float(value), float(value)))

    def _add_tick_labels(
        self,
        axis: str,
        values: list[float],
        *,
        length: float,
        placement: str,
        font_size: float,
        color: Any,
    ) -> None:
        text = [self._tick_label(v) for v in values]
        pad = max(0.09, abs(length) * 2.25)
        place = str(placement or "").strip().lower()
        if axis in {"x", "y"}:
            sign = -1.0 if place in {"below", "bottom", "negative"} else 1.0
            x = values if axis == "x" else [0.0 for _ in values]
            y = values if axis == "y" else [0.0 for _ in values]
            z = [sign * (length + pad) for _ in values]
        else:
            sign = -1.0 if place in {"left", "below", "negative"} else 1.0
            x = [0.0 for _ in values]
            y = [sign * (length + pad) for _ in values]
            z = values
        self.frame.add_text(
            text,
            x=x,
            y=y,
            z=z,
            world=True,
            ha="center",
            va="center",
            color=color,
            font_size=float(font_size),
        )

    def crosshair(
        self,
        *,
        color: Any = "white",
        width: float = 1.0,
        ticks: bool = True,
        x_tick_mode: str = "linear",
        y_tick_mode: str = "linear",
        z_tick_mode: str = "linear",
        tick_len: float = 0.04,
        tick_extent: float | None = None,
        tick_hints: Any = (1, 2, 5),
        tick_dist: float = 120.0,
        min_tick_dist: float = 72.0,
        max_tick_dist: float = 180.0,
        x_tick_alignment: str = "negative",
        y_tick_alignment: str = "negative",
        z_tick_alignment: str = "negative",
        x_ticks: Any = None,
        y_ticks: Any = None,
        z_ticks: Any = None,
        x_tick_label_placement: str = "below",
        y_tick_label_placement: str = "below",
        z_tick_label_placement: str = "left",
        tick_label_font_size: float = 11.0,
        labels: bool = True,
        label_font_size: float = 14.0,
        label_inset_px: float = 28.0,
        label_offset_px: float = 28.0,
        axis_inset_px: float = 0.0,
        axis_lock_angle_deg: float = 5.0,
        axis_lock_sample_count: int = 3,
        grid: bool = False,
        grid_alpha: float = 0.16,
        grid_width: float = 1.0,
        radius: float | None = None,
        segments: int | None = None,
        receives_lighting: bool = False,
        casts_shadow: bool = False,
    ) -> "Axis3D":
        del radius, segments
        display = getattr(self.frame, "_display", None)
        restore_auto_render: bool | None = None
        if display is not None:
            restore_auto_render = bool(getattr(display, "_auto_render", True))
            display._auto_render = False
        try:
            self.frame.set_geom_options(axis3d_controls=True)
        except Exception:
            pass
        default_extent = max(
            abs(float(self.x_max) - float(self.x_min)),
            abs(float(self.y_max) - float(self.y_min)),
            abs(float(self.z_max) - float(self.z_min)),
            1.0,
        )
        try:
            camera_data = self.frame._display._geom_for(self.frame._frame_id).get("camera", {})  # type: ignore[attr-defined]
            if str(camera_data.get("projection", "")).lower() == "orthographic":
                default_extent = max(default_extent, 4.0 * float(camera_data.get("ortho_scale", 2.5)))
        except Exception:
            pass
        line_extent = abs(float(tick_extent)) if tick_extent is not None else default_extent
        try:
            geom = self.frame._display._geom_for(self.frame._frame_id)  # type: ignore[attr-defined]
            geom["axis3d_runtime"] = {
                "x_min": float(self.x_min),
                "x_max": float(self.x_max),
                "y_min": float(self.y_min),
                "y_max": float(self.y_max),
                "z_min": float(self.z_min),
                "z_max": float(self.z_max),
                "x_mode": str(x_tick_mode),
                "y_mode": str(y_tick_mode),
                "z_mode": str(z_tick_mode),
                "tick_extent": float(line_extent),
                "tick_len": float(tick_len),
                "tick_hints": list(tick_hints),
                "tick_dist": float(tick_dist),
                "min_tick_dist": float(min_tick_dist),
                "max_tick_dist": float(max_tick_dist),
                "width": float(width),
                "ticks": bool(ticks),
                "x_tick_alignment": str(x_tick_alignment),
                "y_tick_alignment": str(y_tick_alignment),
                "z_tick_alignment": str(z_tick_alignment),
                "x_tick_label_placement": str(x_tick_label_placement),
                "y_tick_label_placement": str(y_tick_label_placement),
                "z_tick_label_placement": str(z_tick_label_placement),
                "label_inset_px": float(label_inset_px),
                "label_offset_px": float(label_offset_px),
                "axis_lock_angle_deg": float(axis_lock_angle_deg),
                "axis_lock_sample_count": int(axis_lock_sample_count),
                "grid": bool(grid),
                "grid_alpha": float(grid_alpha),
                "grid_width": float(grid_width),
                "color": _color_to_payload(color),
                "tick_label_font_size": float(tick_label_font_size),
                "label_font_size": float(label_font_size),
                "x_label": self.x_label,
                "y_label": self.y_label,
                "z_label": self.z_label,
            }
        except Exception:
            pass
        specs = (
            ("x", -line_extent, line_extent),
            ("y", -line_extent, line_extent),
            ("z", -line_extent, line_extent),
        )
        axis_rows_x: list[tuple[float, float]] = []
        axis_rows_y: list[tuple[float, float]] = []
        axis_rows_z: list[tuple[float, float]] = []
        for axis, lo, hi in specs:
            x_line, y_line, z_line = self._line_u(axis, lo, hi)
            axis_rows_x.append(tuple(float(v) for v in x_line.data))
            axis_rows_y.append(tuple(float(v) for v in y_line.data))
            axis_rows_z.append(tuple(float(v) for v in z_line.data))
        if ticks:
            x_base = self._optional_tick_values(x_ticks) or self._nice_ticks(self.x_min, self.x_max)
            y_base = self._optional_tick_values(y_ticks) or self._nice_ticks(self.y_min, self.y_max)
            z_base = self._optional_tick_values(z_ticks) or self._nice_ticks(self.z_min, self.z_max)
            extent = line_extent
            x_step = self._nice_tick_step((self.x_max - self.x_min) / 5.0)
            y_step = self._nice_tick_step((self.y_max - self.y_min) / 5.0)
            z_step = self._nice_tick_step((self.z_max - self.z_min) / 5.0)
            x_line_values = self._ticks_with_step(-extent, extent, x_step)
            y_line_values = self._ticks_with_step(-extent, extent, y_step)
            z_line_values = self._ticks_with_step(-extent, extent, z_step)
            tick_specs = (
                ("x", self._without_zero(x_line_values), self._without_zero(x_line_values), str(x_tick_alignment), str(x_tick_label_placement)),
                ("y", self._without_zero(y_line_values), self._without_zero(y_line_values), str(y_tick_alignment), str(y_tick_label_placement)),
                ("z", self._without_zero(z_line_values), self._without_zero(z_line_values), str(z_tick_alignment), str(z_tick_label_placement)),
            )
            for axis, values, label_values, alignment, placement in tick_specs:
                if not values:
                    continue
                self._append_tick_line_rows(
                    axis_rows_x,
                    axis_rows_y,
                    axis_rows_z,
                    axis,
                    values,
                    length=float(tick_len),
                    alignment=alignment,
                )
                self._add_tick_labels(
                    axis,
                    label_values,
                    length=float(tick_len),
                    placement=placement,
                    font_size=float(tick_label_font_size),
                    color=color,
                )
        self.frame.add(
            x=AxisTaggedValue(tuple(axis_rows_x), "iu"),
            y=AxisTaggedValue(tuple(axis_rows_y), "iu"),
            z=AxisTaggedValue(tuple(axis_rows_z), "iu"),
            id=f"{self.prefix}_crosshair",
            color=color,
            representation="edges",
            render_mode="line",
            marker_space="pixel",
            edge_width=float(width),
            axis_bind_id=self._axis_bind_id,
            axis_screen_extend=False,
            axis_screen_inset_px=float(axis_inset_px),
            receives_lighting=bool(receives_lighting),
            casts_shadow=bool(casts_shadow),
            depth_write=True,
        )
        self.frame.add_layer(
            "axis",
            id=f"{self.prefix}_crosshair_layer",
            dim=3,
            variant="crosshair",
            geometry_ids=[f"{self.prefix}_crosshair"],
            x_min=float(self.x_min),
            x_max=float(self.x_max),
            y_min=float(self.y_min),
            y_max=float(self.y_max),
            z_min=float(self.z_min),
            z_max=float(self.z_max),
            x_mode=str(x_tick_mode),
            y_mode=str(y_tick_mode),
            z_mode=str(z_tick_mode),
            ticks=bool(ticks),
            tick_hints=list(tick_hints),
            tick_dist=float(tick_dist),
            min_tick_dist=float(min_tick_dist),
            max_tick_dist=float(max_tick_dist),
            tick_len=float(tick_len),
            tick_extent=float(line_extent),
            grid=bool(grid),
            grid_alpha=float(grid_alpha),
            grid_width=float(grid_width),
            interactive=True,
            axis_lock_angle_deg=float(axis_lock_angle_deg),
            axis_lock_sample_count=int(axis_lock_sample_count),
        )
        self.frame.register_default_event_handler(
            f"axis3d:{self.prefix}",
            lambda event, _self=self: _self.handle_events(event),
        )
        if labels:
            self.frame.add_text(
                self.x_label,
                x=self.x_max,
                y=0.0,
                z=0.0,
                world=True,
                edge_anchor=True,
                inset_px=float(label_inset_px),
                offset_px=float(label_offset_px),
                ha="center",
                va="center",
                color=color,
                font_size=float(label_font_size),
            )
            self.frame.add_text(
                self.y_label,
                x=0.0,
                y=self.y_max,
                z=0.0,
                world=True,
                edge_anchor=True,
                inset_px=float(label_inset_px),
                offset_px=float(label_offset_px),
                ha="center",
                va="center",
                color=color,
                font_size=float(label_font_size),
            )
            self.frame.add_text(
                self.z_label,
                x=0.0,
                y=0.0,
                z=self.z_max,
                world=True,
                edge_anchor=True,
                inset_px=float(label_inset_px),
                offset_px=float(label_offset_px),
                ha="center",
                va="center",
                color=color,
                font_size=float(label_font_size),
            )
        if display is not None and restore_auto_render is not None:
            display._auto_render = restore_auto_render
            if restore_auto_render:
                display.render()
        return self

    def box(
        self,
        *,
        color: Any = "white",
        width: float = 1.0,
        ticks: bool = True,
        x_tick_mode: str = "linear",
        y_tick_mode: str = "linear",
        z_tick_mode: str = "linear",
        tick_len_px: float = 7.0,
        tick_hints: Any = (1, 2, 5),
        tick_dist: float = 120.0,
        min_tick_dist: float = 72.0,
        max_tick_dist: float = 180.0,
        x_tick_alignment: str = "negative",
        y_tick_alignment: str = "negative",
        z_tick_alignment: str = "negative",
        x_tick_label_placement: str = "below",
        y_tick_label_placement: str = "left",
        z_tick_label_placement: str = "left",
        tick_label_font_size: float = 11.0,
        labels: bool = True,
        label_font_size: float = 14.0,
        label_offset_px: float = 28.0,
        aspect: str = "equal",
        equal_aspect: bool = True,
        axis_lock_angle_deg: float = 5.0,
        axis_lock_sample_count: int = 3,
        grid: bool = False,
        grid_alpha: float = 0.16,
        grid_width: float = 1.0,
        receives_lighting: bool = False,
        casts_shadow: bool = False,
    ) -> "Axis3D":
        display = getattr(self.frame, "_display", None)
        restore_auto_render: bool | None = None
        if display is not None:
            restore_auto_render = bool(getattr(display, "_auto_render", True))
            display._auto_render = False
        try:
            self.frame.set_geom_options(axis3d_controls=True)
        except Exception:
            pass
        try:
            geom = self.frame._display._geom_for(self.frame._frame_id)  # type: ignore[attr-defined]
            geom["axis3d_runtime"] = {
                "mode": "box",
                "x_min": float(self.x_min),
                "x_max": float(self.x_max),
                "y_min": float(self.y_min),
                "y_max": float(self.y_max),
                "z_min": float(self.z_min),
                "z_max": float(self.z_max),
                "x_mode": str(x_tick_mode),
                "y_mode": str(y_tick_mode),
                "z_mode": str(z_tick_mode),
                "tick_len_px": float(tick_len_px),
                "tick_hints": list(tick_hints),
                "tick_dist": float(tick_dist),
                "min_tick_dist": float(min_tick_dist),
                "max_tick_dist": float(max_tick_dist),
                "width": float(width),
                "ticks": bool(ticks),
                "x_tick_alignment": str(x_tick_alignment),
                "y_tick_alignment": str(y_tick_alignment),
                "z_tick_alignment": str(z_tick_alignment),
                "x_tick_label_placement": str(x_tick_label_placement),
                "y_tick_label_placement": str(y_tick_label_placement),
                "z_tick_label_placement": str(z_tick_label_placement),
                "label_offset_px": float(label_offset_px),
                "aspect": str(aspect),
                "equal_aspect": bool(equal_aspect),
                "axis_lock_angle_deg": float(axis_lock_angle_deg),
                "axis_lock_sample_count": int(axis_lock_sample_count),
                "grid": bool(grid),
                "grid_alpha": float(grid_alpha),
                "grid_width": float(grid_width),
                "color": _color_to_payload(color),
                "tick_label_font_size": float(tick_label_font_size),
                "label_font_size": float(label_font_size),
                "x_label": self.x_label if labels else "",
                "y_label": self.y_label if labels else "",
                "z_label": self.z_label if labels else "",
            }
        except Exception:
            pass

        xs = (float(self.x_min), float(self.x_max))
        ys = (float(self.y_min), float(self.y_max))
        zs = (float(self.z_min), float(self.z_max))
        x_uvw = tuple(tuple(tuple(x for _w in zs) for _v in ys) for x in xs)
        y_uvw = tuple(tuple(tuple(y for _w in zs) for y in ys) for _u in xs)
        z_uvw = tuple(tuple(tuple(z for z in zs) for _v in ys) for _u in xs)
        self.frame.add(
            x=AxisTaggedValue(x_uvw, "uvw"),
            y=AxisTaggedValue(y_uvw, "uvw"),
            z=AxisTaggedValue(z_uvw, "uvw"),
            id=f"{self.prefix}_box",
            color=color,
            representation="edges",
            render_mode="line",
            marker_space="pixel",
            edge_width=float(width),
            axis_bind_id=self._axis_bind_id,
            axis3d_helper_lines=True,
            axis_screen_extend=False,
            receives_lighting=bool(receives_lighting),
            casts_shadow=bool(casts_shadow),
            depth_write=True,
        )
        tick_slots = max(2, len(self._nice_ticks(self.x_min, self.x_max)), len(self._nice_ticks(self.y_min, self.y_max)), len(self._nice_ticks(self.z_min, self.z_max)))
        tick_x: list[list[tuple[float, float]]] = []
        tick_y: list[list[tuple[float, float]]] = []
        tick_z: list[list[tuple[float, float]]] = []
        for _axis_group in range(3):
            tick_x.append([(0.0, 0.0) for _j in range(tick_slots)])
            tick_y.append([(0.0, 0.0) for _j in range(tick_slots)])
            tick_z.append([(0.0, 0.0) for _j in range(tick_slots)])
        self.frame.add(
            x=AxisTaggedValue(tuple(tuple(row) for row in tick_x), "iju"),
            y=AxisTaggedValue(tuple(tuple(row) for row in tick_y), "iju"),
            z=AxisTaggedValue(tuple(tuple(row) for row in tick_z), "iju"),
            id=f"{self.prefix}_box_ticks",
            color=color,
            representation="edges",
            render_mode="line",
            marker_space="pixel",
            edge_width=float(width),
            axis_bind_id=self._axis_bind_id,
            axis3d_helper_lines=True,
            receives_lighting=bool(receives_lighting),
            casts_shadow=bool(casts_shadow),
            depth_write=True,
        )
        self.frame.add_layer(
            "axis",
            id=f"{self.prefix}_box_layer",
            dim=3,
            variant="box",
            geometry_ids=[f"{self.prefix}_box", f"{self.prefix}_box_ticks"],
            x_min=float(self.x_min),
            x_max=float(self.x_max),
            y_min=float(self.y_min),
            y_max=float(self.y_max),
            z_min=float(self.z_min),
            z_max=float(self.z_max),
            x_mode=str(x_tick_mode),
            y_mode=str(y_tick_mode),
            z_mode=str(z_tick_mode),
            ticks=bool(ticks),
            tick_hints=list(tick_hints),
            tick_dist=float(tick_dist),
            min_tick_dist=float(min_tick_dist),
            max_tick_dist=float(max_tick_dist),
            tick_len_px=float(tick_len_px),
            aspect=str(aspect),
            equal_aspect=bool(equal_aspect),
            grid=bool(grid),
            grid_alpha=float(grid_alpha),
            grid_width=float(grid_width),
            interactive=True,
            axis_lock_angle_deg=float(axis_lock_angle_deg),
            axis_lock_sample_count=int(axis_lock_sample_count),
        )
        self.frame.register_default_event_handler(
            f"axis3d:{self.prefix}",
            lambda event, _self=self: _self.handle_events(event),
        )
        if display is not None and restore_auto_render is not None:
            display._auto_render = restore_auto_render
            if restore_auto_render:
                display.render()
        return self

    def handle_events(
        self,
        event: Any,
        *,
        camera: SceneCamera | None = None,
        zoom_speed: float = 0.16,
        rotate_speed: float = 0.35,
    ) -> bool:
        del rotate_speed
        cam = camera if camera is not None else self._camera
        if cam is None:
            return False
        name = str(getattr(event, "event", getattr(event, "name", "")) or "")
        if name == "wheel" or isinstance(event, MouseWheel):
            step = float(getattr(event, "step", 0.0) or 0.0)
            if step == 0.0:
                delta = float(getattr(event, "delta", 0.0) or 0.0)
                step = 1.0 if delta > 0.0 else (-1.0 if delta < 0.0 else 0.0)
            if step == 0.0:
                return False
            cam.zoom_by_wheel(step, speed=float(zoom_speed))
            return True
        if name == "drag" or isinstance(event, MouseDrag):
            dx = float(getattr(event, "dx", 0.0) or 0.0)
            dy = float(getattr(event, "dy", 0.0) or 0.0)
            width = float(getattr(event, "width", 0.0) or 0.0)
            height = float(getattr(event, "height", 0.0) or 0.0)
            cam.pan_pixels(dx, dy, width=width, height=height)
            return bool(dx or dy)
        return False


def axis_2d(frame: "FrameRef", **kwargs: Any) -> Axis2D:
    allowed = {"x_min", "x_max", "y_min", "y_max", "x_label", "y_label", "prefix"}
    bad = sorted(k for k in kwargs if k not in allowed)
    if bad:
        joined = ", ".join(repr(k) for k in bad)
        raise TypeError(f"axis_2d() got unexpected keyword argument(s): {joined}")
    return Axis2D(
        frame=frame,
        x_min=float(kwargs.get("x_min", -1.0)),
        x_max=float(kwargs.get("x_max", 1.0)),
        y_min=float(kwargs.get("y_min", -1.0)),
        y_max=float(kwargs.get("y_max", 1.0)),
        x_label=str(kwargs.get("x_label", "$x$")),
        y_label=str(kwargs.get("y_label", "$y$")),
        prefix=str(kwargs.get("prefix", "axis2d")),
    )


def axis_3d(frame: "FrameRef", **kwargs: Any) -> Axis3D:
    allowed = {
        "x_min", "x_max", "y_min", "y_max", "z_min", "z_max",
        "x_label", "y_label", "z_label", "prefix",
    }
    bad = sorted(k for k in kwargs if k not in allowed)
    if bad:
        joined = ", ".join(repr(k) for k in bad)
        raise TypeError(f"axis_3d() got unexpected keyword argument(s): {joined}")
    return Axis3D(
        frame=frame,
        x_min=float(kwargs.get("x_min", -1.0)),
        x_max=float(kwargs.get("x_max", 1.0)),
        y_min=float(kwargs.get("y_min", -1.0)),
        y_max=float(kwargs.get("y_max", 1.0)),
        z_min=float(kwargs.get("z_min", -1.0)),
        z_max=float(kwargs.get("z_max", 1.0)),
        x_label=str(kwargs.get("x_label", "$x$")),
        y_label=str(kwargs.get("y_label", "$y$")),
        z_label=str(kwargs.get("z_label", "$z$")),
        prefix=str(kwargs.get("prefix", "axis3d")),
    )


def _tick_label_text(value: Any) -> str:
    x = float(value)
    if abs(x) < 1e-12:
        x = 0.0
    if abs(x - round(x)) < 1e-12:
        body = str(int(round(x)))
    else:
        body = f"{x:.3g}"
    return f"${body}$"


def axis_2d_tick_labels(widgets: Any, **kwargs: Any) -> list[dict[str, Any]]:
    allowed = {"x_ticks", "y_ticks", "x_min", "x_max", "y_min", "y_max", "rows", "cols", "x_label", "y_label"}
    bad = sorted(k for k in kwargs if k not in allowed)
    if bad:
        joined = ", ".join(repr(k) for k in bad)
        raise TypeError(f"axis_2d_tick_labels() got unexpected keyword argument(s): {joined}")
    rows = max(3, int(kwargs.get("rows", 15)))
    cols = max(3, int(kwargs.get("cols", 15)))
    x_min = float(kwargs.get("x_min", -1.0))
    x_max = float(kwargs.get("x_max", 1.0))
    y_min = float(kwargs.get("y_min", -1.0))
    y_max = float(kwargs.get("y_max", 1.0))
    x_ticks = kwargs.get("x_ticks", [])
    y_ticks = kwargs.get("y_ticks", [])

    def col_for(x: float) -> int:
        span = x_max - x_min
        a = 0.5 if span == 0.0 else (float(x) - x_min) / span
        return max(0, min(cols - 1, int(round(a * (cols - 1)))))

    def row_for(y: float) -> int:
        span = y_max - y_min
        a = 0.5 if span == 0.0 else (float(y) - y_min) / span
        return max(0, min(rows - 1, int(round((1.0 - a) * (rows - 1)))))

    out: list[dict[str, Any]] = []
    x_axis_row = min(rows - 1, row_for(0.0 if y_min <= 0.0 <= y_max else y_min) + 1)
    y_axis_col = max(0, col_for(0.0 if x_min <= 0.0 <= x_max else x_min) - 1)
    for n, xv in enumerate(x_ticks.data if isinstance(x_ticks, AxisTaggedValue) else list(x_ticks or [])):
        out.append(widgets.label(f"x_tick_label_{n}", text=_tick_label_text(xv), grid=(x_axis_row, col_for(float(xv)), 1, 1), align="center", compact=True))
    for n, yv in enumerate(y_ticks.data if isinstance(y_ticks, AxisTaggedValue) else list(y_ticks or [])):
        out.append(widgets.label(f"y_tick_label_{n}", text=_tick_label_text(yv), grid=(row_for(float(yv)), y_axis_col, 1, 1), align="right", compact=True))
    x_label = kwargs.get("x_label")
    y_label = kwargs.get("y_label")
    if x_label is not None:
        out.append(widgets.label("x_axis_label", text=str(x_label), grid=(x_axis_row, cols - 1, 1, 1), align="right", compact=True))
    if y_label is not None:
        out.append(widgets.label("y_axis_label", text=str(y_label), grid=(0, y_axis_col, 1, 1), align="right", compact=True))
    return out


# ---------------------------------------------------------------------------
# Placeholder dataclasses
# ---------------------------------------------------------------------------

# UIMouse and UIKeyboard are now imported from .events


# ---------------------------------------------------------------------------
# FrameRef
# ---------------------------------------------------------------------------

@dataclass
class FrameRef:
    """A panel from ``d.frame`` / :meth:`Display.Frame`; use :meth:`add_frame`, then draw commands."""

    __vf_py_attrs__ = True

    _display: "Display"
    _pending: PendingFrame
    _placed: bool = field(default=False, repr=False)
    _frame_id: str = field(default="", repr=False)
    _pending_key: int = field(default=0, repr=False)
    _graphics_defaults: dict[str, Any] = field(default_factory=dict, repr=False)
    _default_event_handlers: dict[str, Callable[[Any], bool]] = field(default_factory=dict, repr=False)
    _event_observers: list[Callable[[Any], Any]] = field(default_factory=list, repr=False)
    _event_override: Callable[[Any], Any] | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_pending_key", id(self))

    @property
    def id(self) -> str:
        return self._pending.id

    @property
    def graphics_defaults(self) -> dict[str, Any]:
        return self._graphics_defaults

    def set_graphics_defaults(self, defaults: dict[str, Any] | None = None, **kwargs: Any) -> "FrameRef":
        patch: dict[str, Any] = {}
        if defaults is not None:
            patch.update(defaults)
        patch.update(kwargs)
        normalized = _normalize_graphics_defaults_patch(patch)
        self._graphics_defaults = _structural_merge_dict(self._graphics_defaults, normalized)
        self._display._refresh_representations_for_frame(self._frame_id if self._placed else None)
        return self

    def __getattr__(self, name: str) -> Any:
        """Frame-scoped event constants, e.g. ``frame.BUTTON_PRESSED``."""
        ev = EVENT_CONST_TO_NAME.get(str(name))
        if ev is None:
            raise AttributeError(f"FrameRef has no attribute {name!r}")
        fid = self.id
        if not fid:
            return encode_ui_pattern(ev)
        return encode_frame_pattern(ev, fid)

    def register_default_event_handler(self, key: str, fn: Callable[[Any], bool]) -> "FrameRef":
        """Register a built-in frame handler used by sugar helpers."""
        self._default_event_handlers[str(key)] = fn
        return self

    def on_event(self, fn: Callable[[Any], Any]) -> "FrameRef":
        """Observe host events for this frame without replacing built-in handling."""
        self._event_observers.append(fn)
        return self

    def set_event_handler(self, fn: Callable[[Any], Any] | None) -> "FrameRef":
        """Override built-in frame handling; return ``None`` from ``fn`` to fall through."""
        self._event_override = fn
        return self

    def handle_events(self, event: Any) -> bool:
        """Dispatch one event through observers, override, then built-in sugar handlers."""
        handled = False
        for cb in list(self._event_observers):
            cb(event)
        if self._event_override is not None:
            override_result = self._event_override(event)
            if override_result is not None:
                return bool(override_result)
        for cb in list(self._default_event_handlers.values()):
            handled = bool(cb(event)) or handled
        return handled

    # -- 2-D ------------------------------------------------------------------

    def draw(self, rect: Any, *, color: str = "#888888") -> None:
        self.draw_rect(rect, color=color)

    def draw_rect(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        d = {"op": "rect", "rect": [z[0], z[1], z[2], z[3]], "color": str(color)}
        if self._placed and self._frame_id:
            self._display._append_frame_op(self._frame_id, d)
        else:
            self._display._append_pending_frame_op(self._pending_key, d)
        self._display._sync_all()

    def add_oval(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        d = {"op": "oval", "rect": [z[0], z[1], z[2], z[3]], "color": str(color)}
        if self._placed and self._frame_id:
            self._display._append_frame_op(self._frame_id, d)
        else:
            self._display._append_pending_frame_op(self._pending_key, d)
        self._display._sync_all()

    # -- 3-D ------------------------------------------------------------------

    def add_text(
        self,
        text: Any,
        *,
        x: Any,
        y: Any,
        z: Any = 0.0,
        font_size: float = 12.0,
        ha: str = "center",
        va: str = "center",
        color: Any = "white",
        id: str | None = None,
        aspect: str = "",
        pixel: bool = False,
        world: bool = False,
        edge_anchor: bool = False,
        inset_px: float = 20.0,
        offset_px: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Add overlay text to this frame's geometry/text layer."""
        fid = self._get_placed_id()
        return self._display._add_text(
            fid,
            text=text,
            x=x,
            y=y,
            z=z,
            font_size=font_size,
            ha=ha,
            va=va,
            color=color,
            id=id,
            aspect=aspect,
            pixel=pixel,
            world=world,
            edge_anchor=edge_anchor,
            inset_px=inset_px,
            offset_px=offset_px,
        )

    def add_box(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        texture: Any = None,
    ) -> SceneBox:
        """Add a 3-D box. Returns a :class:`SceneBox` you can mutate live."""
        fid = self._get_placed_id()
        return self._display._add_box(fid, center=center, scale=scale, color=color, texture=texture)

    # legacy alias
    def draw_box(self, *, center: Any = None, scale: Any = None, color: Any = None, texture: Any = None) -> SceneBox:
        return self.add_box(center=center, scale=scale, color=color, texture=texture)

    def add_ellipsoid(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        texture: Any = None,
    ) -> SceneBox:
        fid = self._get_placed_id()
        return self._display._add_ellipsoid(fid, center=center, scale=scale, color=color, texture=texture)

    def draw_ellipsoid(self, *, center: Any = None, scale: Any = None, color: Any = None, texture: Any = None) -> SceneBox:
        return self.add_ellipsoid(center=center, scale=scale, color=color, texture=texture)

    def impostor_renderer(
        self,
        *,
        width: Any = 1.0,
        height: Any = 1.0,
        z: Any = 0.0,
        depth: Any = 0.035,
        capture_path: Any = "",
        capture_size: Any = (720, 520),
        capture_margin: Any = 44,
        show_boundary: Any = True,
        capture_supersample: Any = 1,
        sync_display: Any = True,
    ) -> ImpostorRenderer:
        return ImpostorRenderer(
            self,
            width=width,
            height=height,
            z=z,
            depth=depth,
            capture_path=capture_path,
            capture_size=capture_size,
            capture_margin=capture_margin,
            show_boundary=show_boundary,
            capture_supersample=capture_supersample,
            sync_display=sync_display,
        )

    def add_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
        texture: Any = None,
    ) -> SceneBox:
        fid = self._get_placed_id()
        return self._display._add_torus(
            fid,
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
            texture=texture,
        )

    def draw_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
        texture: Any = None,
    ) -> SceneBox:
        return self.add_torus(
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
            texture=texture,
        )

    def add(self, *args: Any, **kwargs: Any) -> Any:
        """Add a graphics embedding or a generic field mesh to this frame."""
        fid = self._get_placed_id()
        if args:
            if kwargs:
                raise TypeError("frame.add(value, embedding[, view]) does not accept keyword arguments")
            if len(args) not in (2, 3):
                raise TypeError("frame.add(...) expects (value, embedding) or (value, embedding, view)")
            value = args[0]
            embedding = args[1]
            view = args[2] if len(args) == 3 else _NO_VIEW
            return self._display._add_graphics_representation(fid, value, embedding, view=view)
        return self._display._add_field_mesh(fid, **kwargs)

    def add_function_surface(
        self,
        *,
        fn: Any,
        params: Any,
        u_dim: str = "u",
        v_dim: str = "v",
        color: Any = None,
        interpolation: bool = True,
        depth_write: bool = True,
        id: str | None = None,
        **kwargs: Any,
    ) -> SceneFieldMesh:
        fid = self._get_placed_id()
        return self._display._add_function_surface(
            fid,
            fn=fn,
            params=params,
            u_dim=u_dim,
            v_dim=v_dim,
            color=color,
            interpolation=interpolation,
            depth_write=depth_write,
            id=id,
            **kwargs,
        )

    def add_function_plot(
        self,
        *,
        fn: Any,
        expr_source: Any,
        params: Any,
        x_fn: Any = None,
        y_fn: Any = None,
        z_fn: Any = None,
        color: Any = None,
        color_mode: Any = "constant",
        color_axis: Any = "",
        colormap: Any = "rgb",
        interpolation: bool = True,
        depth_write: bool = True,
        id: str | None = None,
        **kwargs: Any,
    ) -> SceneFieldMesh:
        fid = self._get_placed_id()
        return self._display._add_function_plot(
            fid,
            fn=fn,
            expr_source=expr_source,
            params=params,
            x_fn=x_fn,
            y_fn=y_fn,
            z_fn=z_fn,
            color=color,
            color_mode=color_mode,
            color_axis=color_axis,
            colormap=colormap,
            interpolation=interpolation,
            depth_write=depth_write,
            id=id,
            **kwargs,
        )

    def add_camera(
        self,
        *,
        pos: Any,
        target: Any = None,
        fov: float = 45.0,
        up: Any = None,
        projection: str = "perspective",
        ortho_scale: float | None = None,
    ) -> SceneCamera:
        """Set the camera. Returns a :class:`SceneCamera` you can mutate live."""
        fid = self._get_placed_id()
        return self._display._add_camera(fid, pos=pos, target=target, fov=fov, up=up, projection=projection, ortho_scale=ortho_scale)

    def add_light(
        self,
        *,
        pos: Any,
        model: str = "blinn_phong",
        color: Any = "white",
        intensity: float = 24.0,
        kind: str = "point",
        direction: Any = None,
        target: Any = None,
        inner_cone_deg: float = 14.0,
        outer_cone_deg: float = 22.0,
        range: float = 0.0,
    ) -> SceneLight:
        """Add a light. Returns a :class:`SceneLight` you can mutate live."""
        fid = self._get_placed_id()
        return self._display._add_light(
            fid,
            pos=pos,
            model=model,
            color=color,
            intensity=intensity,
            kind=kind,
            direction=direction,
            target=target,
            inner_cone_deg=inner_cone_deg,
            outer_cone_deg=outer_cone_deg,
            range=range,
        )

    def set_geom_options(self, **kwargs: Any) -> "FrameRef":
        """Set GPU geometry renderer options for this frame."""
        fid = self._get_placed_id()
        self._display._set_geom_options(fid, **kwargs)
        return self

    def add_layer(self, kind: str, **config: Any) -> "FrameRef":
        """Attach a language-neutral UI-engine layer record to this frame."""
        fid = self._get_placed_id()
        self._display._add_frame_layer(fid, kind, **config)
        return self

    def _get_placed_id(self) -> str:
        if self._placed and self._frame_id:
            return self._frame_id
        return f"__pending_{self._pending_key}"


# ---------------------------------------------------------------------------
# UIEventQueue
# ---------------------------------------------------------------------------

@dataclass
class UIEventQueue:
    """Authoritative event queue API for host interaction loops."""

    __vf_py_attrs__ = True
    _ui: "UIRoot"

    def poll(self) -> bool:
        """Return ``True`` when at least one event is queued."""
        self._ui._ensure_poller()
        return bool(self._ui._event_queue)

    def get(self) -> MouseEvent | KeyboardEvent | FrameEvent | WidgetEvent | dict[str, Any] | None:
        """Pop one normalized host event, or ``None`` when the queue is empty."""
        return self._ui.next_event()


# ---------------------------------------------------------------------------
# UIRoot
# ---------------------------------------------------------------------------

@dataclass
class UIRoot:
    """``use("ui")`` / ``:.ui`` — use UI bindings such as ``display``, ``Frame``, ``set_mode()``, or alias with ``ui:.ui``.

    Events
    ------
    ``ui.events.get()`` / ``ui.next_event()`` is the authoritative interaction
    seam. Callbacks such as ``cursor.on_down(...)`` are compatibility helpers on
    top of the same queue. The event poller background thread starts
    automatically when the first frame is placed.

    Example::

        :.ui
        d : display
        f : Frame((0.1, 0.1, 0.8, 0.8))
        cam : d.add_camera(pos:[4,3,5])

        loop:
            e : events.get()
            e ? handle(e)
    """

    __vf_py_attrs__ = True
    # Global event constants (integer patterns)
    MOUSE_MOVE: int = encode_ui_pattern("move")
    MOUSE_HOVER: int = encode_ui_pattern("hover")
    MOUSE_DOWN: int = encode_ui_pattern("down")
    MOUSE_UP: int = encode_ui_pattern("up")
    MOUSE_WHEEL: int = encode_ui_pattern("wheel")
    MOUSE_DRAG: int = encode_ui_pattern("drag")
    KEY_DOWN: int = encode_ui_pattern("key_down")
    KEY_UP: int = encode_ui_pattern("key_up")
    FRAME_CLOSED: int = encode_ui_pattern("frame.closed")
    FRAME_DOCKED: int = encode_ui_pattern("frame.docked")
    FRAME_DRAGGED: int = encode_ui_pattern("frame.dragged")
    FRAME_RESIZED: int = encode_ui_pattern("frame.resized")
    BUTTON_PRESSED: int = encode_ui_pattern("button.pressed")
    CHECKBOX_TOGGLED: int = encode_ui_pattern("checkbox.toggled")
    SLIDER_VALUE_CHANGED: int = encode_ui_pattern("slider.value_changed")
    INPUT_FIELD_TEXT_CHANGED: int = encode_ui_pattern("input_field.text_changed")
    INPUT_FIELD_TEXT_ENTERED: int = encode_ui_pattern("input_field.text_entered")
    DROPDOWN_ITEM_CHANGED: int = encode_ui_pattern("dropdown.item_changed")
    TEXT_AREA_TEXT_CHANGED: int = encode_ui_pattern("text_area.text_changed")
    COMBOBOX_TEXT_CHANGED: int = encode_ui_pattern("combobox.text_changed")
    COMBOBOX_TEXT_ENTERED: int = encode_ui_pattern("combobox.text_entered")
    COMBOBOX_ITEM_CHANGED: int = encode_ui_pattern("combobox.item_changed")
    COLOR_PICKER_VALUE_CHANGED: int = encode_ui_pattern("color_picker.value_changed")
    cursor:   UIMouse    = field(default_factory=UIMouse)
    keyboard: UIKeyboard = field(default_factory=UIKeyboard)
    display:  "Display"  = field(default_factory=lambda: Display())
    events: UIEventQueue = field(init=False, repr=False)
    _poller_started: bool = field(default=False, repr=False, init=False)
    _event_queue: deque[Any] = field(
        default_factory=lambda: deque(maxlen=2048), repr=False, init=False
    )
    _event_kind_count: dict[int, int] = field(default_factory=dict, repr=False, init=False)

    def __post_init__(self) -> None:
        q = UIEventQueue(self)
        object.__setattr__(self, "events", q)
        try:
            object.__setattr__(self.display, "_ui_root", self)
        except Exception:
            pass
        # Subscribe to the canonical ingress bus. Overlay polling/browser posts
        # are transport adapters that publish payloads into this queue-first seam.
        def _dispatch(evt: dict) -> None:
            dispatch = build_host_event_dispatch_from_state(
                evt,
                event_kind_count=self._event_kind_count,
            )
            payload = dispatch.payload
            ev_name = str(payload.get("event", ""))
            frame_id = str(payload.get("frame_id", ""))
            widget_id = str(payload.get("widget_id", ""))
            _ui_trace_line(f"dispatch raw type={evt.get('type')} event={ev_name} frame={frame_id} widget={widget_id}")
            if dispatch.base:
                self._event_kind_count[dispatch.base] = int(dispatch.next_kind_count)
            notify_host_frame_payload_event(
                frame_id,
                payload,
                resolve_frame=lambda fid: self.display.get_frame(fid),
            )

            if dispatch.route == "host":
                # Non-vf_event host events (frame lifecycle, widget payloads, etc.).
                self._queue_event(payload)
                return
            if dispatch.route == "ignored":
                return

            is_modifier = False
            if dispatch.route == "keyboard":
                ke = KeyboardEvent.from_dict(payload)
                is_modifier = self.keyboard._modifier_name(ke) is not None
            effects = build_host_event_effects(
                dispatch,
                is_modifier_key=is_modifier,
            )
            if effects.should_observe_modifiers:
                self.keyboard._observe_modifiers(payload)
            if effects.should_push_cursor:
                self.cursor._push(payload)
            if effects.should_push_keyboard:
                self.keyboard._push(payload)
            if not effects.suppress_queue and dispatch.should_queue:
                self._queue_event(payload)
        get_ui_event_ingress().subscribe(_dispatch)

    def _queue_event(self, evt: Any) -> None:
        before_len = len(self._event_queue)
        handled = enqueue_public_host_event_payload(self._event_queue, evt)
        if not handled:
            return
        if len(self._event_queue) == before_len:
            if isinstance(evt, (MouseHover, MouseMove)):
                _ui_trace_line(
                    "queue coalesced pointer "
                    f"event={evt.event} frame={getattr(evt, 'frame_id', '')} object_id={getattr(evt, 'object_id', 0)}"
                )
            elif isinstance(evt, MouseDrag):
                _ui_trace_line(
                    f"queue coalesced drag frame={getattr(evt, 'frame_id', '')} object_id={getattr(evt, 'object_id', 0)}"
                )

    def _ensure_poller(self) -> None:
        if ensure_host_event_poller_started(
            self._poller_started,
            start_poller=(lambda: None) if self.mode == "test" else start_event_poller,
        ):
            object.__setattr__(self, "_poller_started", True)

    def next_event(self) -> MouseEvent | KeyboardEvent | FrameEvent | WidgetEvent | dict[str, Any] | None:
        """Return one pending queued event, or ``None`` when no event is queued."""
        self._ensure_poller()
        if has_queued_host_events(self._event_queue):
            evt = pop_queued_host_event(self._event_queue)
            public_evt = materialize_queued_host_event(evt)
            _ui_trace_line(
                f"next_event cls={type(public_evt).__name__} "
                f"event={getattr(public_evt, 'event', '')} "
                f"frame={getattr(public_evt, 'frame_id', '')} "
                f"object_id={getattr(public_evt, 'object_id', '')} "
                f"simplex_id={getattr(public_evt, 'simplex_id', '')}"
            )
            return public_evt
        return None

    def poll(self) -> None:
        """Drain queued events and fire registered mouse/keyboard callbacks."""
        self._ensure_poller()
        self.cursor.poll()
        self.keyboard.poll()

    def sleep(self, seconds: float) -> None:
        """Host-backed sleep for vkf event loops."""
        _ui_sleep(float(seconds))

    def Frame(self, rect: Any | None = None) -> "FrameRef":  # noqa: N802
        """Create a frame from the root namespace; optionally place it immediately."""
        frame = self.display.Frame()
        if rect is not None:
            self.display.add_frame(frame, rect)
        return frame

    @property
    def widgets(self) -> _Widget:
        """Widget factory namespace (preferred over ``d.widget``): ``ui.widgets.button(...)``."""
        return self.display.widget

    @property
    def graphics(self) -> UIGraphicsNamespace:
        """Built-in graphics helpers and style constructors."""
        return UIGraphicsNamespace()


    def set_mode(self, mode: str) -> None:
        """Set the UI target: ``"overlay"``, ``"browser"``, ``"headless"``, or ``"test"``.

        Call this **before** ``d.add_frame(...)`` so the right host is started.

        * ``"overlay"``  — native Windows host (WebView2 + DirectComposition).
        * ``"browser"``  — built-in HTTP server + open default browser.
        * ``"headless"`` — write ``vf-display.json`` only; no process spawned.
        * ``"test"``     — use only the in-memory UI payload and event seams.

        You can also set the ``VF_UI_MODE`` environment variable to the same
        values instead of calling ``set_mode`` in code.

        To point the runtime at a checkout when the current working directory
        is not inside the repo, set ``VF_UI_REPO_ROOT`` to the repository root
        (the directory that contains ``web/vf-ui/``).

        Example (vkf)::

            :.ui
            set_mode("browser")
            d : display
            d.add_frame((0.05, 0.05, 0.9, 0.9))

        Example (Python)::

            from vektorflow.stdlib.ui import UIRoot
            ui = UIRoot()
            ui.set_mode("browser")
        """
        from vektorflow.ui.launch import set_ui_mode
        set_ui_mode(mode)

    def event_loop(self, *, fps: Any = 24, frames: Any = 120, realtime: Any = True) -> UIEventLoop:
        return UIEventLoop(fps=fps, frames=frames, realtime=realtime)

    @property
    def mode(self) -> str:
        """Return the effective UI mode (``"overlay"``, ``"browser"``, ``"headless"``, or ``"test"``)."""
        from vektorflow.ui.launch import get_ui_mode
        return get_ui_mode()

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(
            f"ui has no attribute {name!r} "
            f"(use ui.cursor, ui.keyboard, ui.display, ui.widgets, ui.poll())"
        )


# ---------------------------------------------------------------------------
# Display
# ---------------------------------------------------------------------------

@dataclass
class Display:
    """``ui.display`` — windowed frames with 2-D rects and 3-D WebGPU geometry.

    2-D
    ---
    ``d.draw_rect(rect, color)``          filled rect on the stage canvas.
    ``d.add_oval(rect, color)``           filled oval on the stage canvas.
    ``f.draw_rect(rect, color)``          filled rect inside a frame.
    ``f.add_oval(rect, color)``           filled oval inside a frame.

    3-D — all return a mutable scene object for live updates
    --------------------------------------------------------
    ``box   = d.add_box(center, scale, color)``         → :class:`SceneBox`
    ``ell   = d.add_ellipsoid(center, scale, color)``   → :class:`SceneBox`
    ``tor   = d.add_torus(center, scale, color, ...)``  → :class:`SceneBox`
    ``cam   = d.add_camera(pos, target, fov)``          → :class:`SceneCamera`
    ``light = d.add_light(pos, model, color)``          → :class:`SceneLight`

    Mutations trigger an immediate refresh::

        box.translate([1, 0, 0])
        box.rotate_by(45, around="y")
        cam.rotate(around="z", omega=30)   # continuous, 30 °/s
        cam.stop()
        light.translate([0, 2, 0])

    Lighting model: ``"blinn_phong"``. Legacy names normalize to this.
    """

    __vf_py_attrs__ = True

    _screen: Screen = field(default_factory=Screen, repr=False)
    _w: _Widget = field(default_factory=_Widget, repr=False)
    _graphics_defaults: dict[str, Any] = field(default_factory=lambda: _deep_copy_dict(_BASE_GRAPHICS_DEFAULTS), repr=False)
    _screen_ops: list[dict[str, Any]] = field(default_factory=list, repr=False)
    _screen_repr_ops: dict[str, list[dict[str, Any]]] = field(default_factory=dict, repr=False)
    _frame_ops: dict[str, list[dict[str, Any]]] = field(default_factory=dict, repr=False)
    _frame_repr_ops: dict[str, dict[str, list[dict[str, Any]]]] = field(default_factory=dict, repr=False)
    _pending_ops: dict[int, list[dict[str, Any]]] = field(default_factory=dict, repr=False)
    _last_frame: FrameRef | None = field(default=None, repr=False)
    # geom: frame_id -> { meshes: [...], camera: {...}|None, lights: [...] }
    _geom: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)
    # (fid, mesh_index) -> SceneBox/SceneCamera/SceneLight (for get_object)
    _scene_objects: dict[tuple, Any] = field(default_factory=dict, repr=False)
    # All FrameRefs ever placed (for get_frame)
    _frame_refs: list[Any] = field(default_factory=list, repr=False)
    _ui_root: Any = field(default=None, repr=False)
    # Scene command file (vkf-scene.json) changes only when command count changes.
    _last_scene_cmd_count: int = field(default=-1, repr=False)
    _next_representation_id: int = field(default=0, repr=False)
    _representations: dict[str, SceneRepresentation] = field(default_factory=dict, repr=False)
    _frame_parent: dict[str, str | None] = field(default_factory=dict, repr=False)
    _auto_render: bool = field(default=True, repr=False)
    _dirty: bool = field(default=False, repr=False)

    def __post_init__(self) -> None:
        try:
            from vektorflow.ui.launch import find_vektorflow_repo_root
            from vektorflow.ui.session import ensure_ui_session

            root = find_vektorflow_repo_root()
            if root is not None:
                ensure_ui_session(root)
        except Exception:
            pass

    # ---- properties -------------------------------------------------------

    @property
    def widget(self) -> _Widget:
        return self._w

    @property
    def graphics_defaults(self) -> dict[str, Any]:
        return self._graphics_defaults

    def set_graphics_defaults(self, defaults: dict[str, Any] | None = None, **kwargs: Any) -> "Display":
        patch: dict[str, Any] = {}
        if defaults is not None:
            patch.update(defaults)
        patch.update(kwargs)
        normalized = _normalize_graphics_defaults_patch(patch)
        self._graphics_defaults = _structural_merge_dict(self._graphics_defaults, normalized)
        self._refresh_all_representations()
        return self

    def dumps(self) -> str:
        return self._screen.dumps()

    def widget_set(self, frame_id: str, widget_id: str, props: Any) -> None:
        self._screen.widget_set(frame_id, widget_id, props)

    def widget_set_text(self, frame_id: str, widget_id: str, text: Any) -> None:
        self._screen.widget_set_text(frame_id, widget_id, text)

    def widget_set_visible(self, frame_id: str, widget_id: str, visible: Any) -> None:
        self._screen.widget_set_visible(frame_id, widget_id, visible)

    def widget_set_options(self, frame_id: str, widget_id: str, options: Any) -> None:
        self._screen.widget_set_options(frame_id, widget_id, options)

    def widget_set_value(self, frame_id: str, widget_id: str, value: Any) -> None:
        self._screen.widget_set_value(frame_id, widget_id, value)

    def widget_append_text(self, frame_id: str, widget_id: str, text: Any) -> None:
        self._screen.widget_append_text(frame_id, widget_id, text)

    @property
    def auto_render(self) -> bool:
        return self._auto_render

    def set_auto_render(self, enabled: Any = True) -> "Display":
        self._auto_render = bool(enabled)
        if self._auto_render and self._dirty:
            self.render()
        return self

    def render(self) -> "Display":
        self._sync_all(force=True)
        return self

    # ---- frame creation ---------------------------------------------------

    def frame(self, **kwargs: Any) -> FrameRef:
        p = self._screen.frame(**kwargs)
        f = FrameRef(self, p)
        self._last_frame = f
        return f

    def Frame(self) -> FrameRef:  # noqa: N802
        p = self._screen.frame(
            title="", draggable=True, dockable=True,
            resizable=True, closable=True, alpha=1.0, dock_loc="bl",
        )
        f = FrameRef(self, p)
        self._last_frame = f
        return f

    # ---- 2-D drawing ------------------------------------------------------

    def draw(self, rect: Any, *, color: str = "#888888") -> None:
        self.draw_rect(rect, color=color)

    def draw_rect(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        self._screen_ops.append(
            {"op": "rect", "rect": [z[0], z[1], z[2], z[3]], "color": str(color)}
        )
        self._sync_all()

    def add_oval(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        self._screen_ops.append(
            {"op": "oval", "rect": [z[0], z[1], z[2], z[3]], "color": str(color)}
        )
        self._sync_all()

    # ---- 3-D commands (operate on last placed frame) ----------------------

    def add_box(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        texture: Any = None,
    ) -> SceneBox:
        """Add a box to the last placed frame. Returns :class:`SceneBox`."""
        fid = self._last_placed_id("add_box")
        return self._add_box(fid, center=center, scale=scale, color=color, texture=texture)

    # legacy alias
    def draw_box(self, *, center: Any = None, scale: Any = None, color: Any = None, texture: Any = None) -> SceneBox:
        """Alias for :meth:`add_box`."""
        return self.add_box(center=center, scale=scale, color=color, texture=texture)

    def add_ellipsoid(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        texture: Any = None,
    ) -> SceneBox:
        fid = self._last_placed_id("add_ellipsoid")
        return self._add_ellipsoid(fid, center=center, scale=scale, color=color, texture=texture)

    def draw_ellipsoid(self, *, center: Any = None, scale: Any = None, color: Any = None, texture: Any = None) -> SceneBox:
        return self.add_ellipsoid(center=center, scale=scale, color=color, texture=texture)

    def add_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
        texture: Any = None,
    ) -> SceneBox:
        fid = self._last_placed_id("add_torus")
        return self._add_torus(
            fid,
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
            texture=texture,
        )

    def draw_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
        texture: Any = None,
    ) -> SceneBox:
        return self.add_torus(
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
            texture=texture,
        )

    def add(self, *args: Any, **kwargs: Any) -> Any:
        """Add a graphics embedding to the display or a generic field mesh to the last frame."""
        if args:
            if kwargs:
                raise TypeError("display.add(value, embedding[, view]) does not accept keyword arguments")
            if len(args) not in (2, 3):
                raise TypeError("display.add(...) expects (value, embedding) or (value, embedding, view)")
            value = args[0]
            embedding = args[1]
            view = args[2] if len(args) == 3 else _NO_VIEW
            return self._add_graphics_representation(None, value, embedding, view=view)
        fid = self._last_placed_id("add")
        return self._add_field_mesh(fid, **kwargs)

    def add_function_surface(
        self,
        *,
        fn: Any,
        params: Any,
        u_dim: str = "u",
        v_dim: str = "v",
        color: Any = None,
        interpolation: bool = True,
        depth_write: bool = True,
        id: str | None = None,
        **kwargs: Any,
    ) -> SceneFieldMesh:
        fid = self._last_placed_id("add_function_surface")
        return self._add_function_surface(
            fid,
            fn=fn,
            params=params,
            u_dim=u_dim,
            v_dim=v_dim,
            color=color,
            interpolation=interpolation,
            depth_write=depth_write,
            id=id,
            **kwargs,
        )

    def add_function_plot(
        self,
        *,
        fn: Any,
        expr_source: Any,
        params: Any,
        x_fn: Any = None,
        y_fn: Any = None,
        z_fn: Any = None,
        color: Any = None,
        color_mode: Any = "constant",
        color_axis: Any = "",
        colormap: Any = "rgb",
        interpolation: bool = True,
        depth_write: bool = True,
        id: str | None = None,
        **kwargs: Any,
    ) -> SceneFieldMesh:
        fid = self._last_placed_id("add_function_plot")
        return self._add_function_plot(
            fid,
            fn=fn,
            expr_source=expr_source,
            params=params,
            x_fn=x_fn,
            y_fn=y_fn,
            z_fn=z_fn,
            color=color,
            color_mode=color_mode,
            color_axis=color_axis,
            colormap=colormap,
            interpolation=interpolation,
            depth_write=depth_write,
            id=id,
            **kwargs,
        )

    def add_camera(
        self,
        *,
        pos: Any,
        target: Any = None,
        fov: float = 45.0,
        up: Any = None,
        projection: str = "perspective",
        ortho_scale: float | None = None,
    ) -> SceneCamera:
        """Set camera for last placed frame. Returns :class:`SceneCamera`."""
        fid = self._last_placed_id("add_camera")
        return self._add_camera(fid, pos=pos, target=target, fov=fov, up=up, projection=projection, ortho_scale=ortho_scale)

    def add_light(
        self,
        *,
        pos: Any,
        model: str = "blinn_phong",
        color: Any = "white",
        intensity: float = 24.0,
        kind: str = "point",
        direction: Any = None,
        target: Any = None,
        inner_cone_deg: float = 14.0,
        outer_cone_deg: float = 22.0,
        range: float = 0.0,
    ) -> SceneLight:
        """Add a light to last placed frame. Returns :class:`SceneLight`."""
        fid = self._last_placed_id("add_light")
        return self._add_light(
            fid,
            pos=pos,
            model=model,
            color=color,
            intensity=intensity,
            kind=kind,
            direction=direction,
            target=target,
            inner_cone_deg=inner_cone_deg,
            outer_cone_deg=outer_cone_deg,
            range=range,
        )

    def set_geom_options(self, **kwargs: Any) -> "Display":
        """Set GPU geometry renderer options for the last placed frame."""
        fid = self._last_placed_id("set_geom_options")
        self._set_geom_options(fid, **kwargs)
        return self

    def add_text(
        self,
        text: Any,
        *,
        x: Any,
        y: Any,
        z: Any = 0.0,
        font_size: float = 12.0,
        ha: str = "center",
        va: str = "center",
        color: Any = "white",
        id: str | None = None,
        aspect: str = "",
        pixel: bool = False,
        world: bool = False,
        edge_anchor: bool = False,
        inset_px: float = 20.0,
        offset_px: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Add overlay text to the last placed frame."""
        fid = self._last_placed_id("add_text")
        return self._add_text(
            fid,
            text=text,
            x=x,
            y=y,
            z=z,
            font_size=font_size,
            ha=ha,
            va=va,
            color=color,
            id=id,
            aspect=aspect,
            pixel=pixel,
            world=world,
            edge_anchor=edge_anchor,
            inset_px=inset_px,
            offset_px=offset_px,
        )

    # ---- internal 3-D builders (used by both Display and FrameRef) --------

    def _add_text(
        self,
        fid: str,
        *,
        text: Any,
        x: Any,
        y: Any,
        z: Any,
        font_size: float,
        ha: str,
        va: str,
        color: Any,
        id: str | None,
        aspect: str,
        pixel: bool,
        world: bool,
        edge_anchor: bool,
        inset_px: float,
        offset_px: float,
    ) -> list[dict[str, Any]]:
        def _seq(value: Any) -> list[Any]:
            if isinstance(value, AxisTaggedValue):
                value = value.data
            if isinstance(value, (VFVector, list, tuple)):
                return list(value)
            return [value]

        ha_norm = str(ha or "center").lower()
        va_norm = str(va or "center").lower()
        if ha_norm not in {"left", "center", "right"}:
            raise ValueError("add_text ha must be 'left', 'center', or 'right'")
        if va_norm not in {"bottom", "center", "top"}:
            raise ValueError("add_text va must be 'bottom', 'center', or 'top'")

        texts = _seq(text)
        xs = _seq(x)
        ys = _seq(y)
        zs = _seq(z)
        n = max(len(texts), len(xs), len(ys), len(zs))

        def _pick(values: list[Any], i: int) -> Any:
            if len(values) == 1:
                return values[0]
            if i >= len(values):
                raise ValueError("add_text vector arguments must have equal length or length 1")
            return values[i]

        specs: list[dict[str, Any]] = []
        for i in range(n):
            suffix = f"_{i}" if n > 1 and id is not None else ""
            specs.append(
                {
                    "id": f"{id}{suffix}" if id is not None else "",
                    "text": str(_pick(texts, i)),
                    "x": float(_pick(xs, i)),
                    "y": float(_pick(ys, i)),
                    "z": float(_pick(zs, i)),
                    "font_size": float(font_size),
                    "ha": ha_norm,
                    "va": va_norm,
                    "color": _color_to_payload(color),
                    "aspect": str(aspect or ""),
                    "pixel": bool(pixel),
                    "world": bool(world),
                    "edge_anchor": bool(edge_anchor),
                    "inset_px": float(inset_px),
                    "offset_px": float(offset_px),
                }
            )
        self._geom_for(fid).setdefault("texts", []).extend(specs)
        self._sync_all()
        return specs

    def _set_geom_options(self, fid: str, **kwargs: Any) -> None:
        allowed = {"unified_renderer", "combine_transparent", "axis3d_controls"}
        bad = sorted(k for k in kwargs if k not in allowed)
        if bad:
            joined = ", ".join(repr(k) for k in bad)
            raise TypeError(f"set_geom_options() got unexpected keyword argument(s): {joined}")
        geom = self._geom_for(fid)
        if "unified_renderer" in kwargs:
            geom["unified_renderer"] = bool(kwargs["unified_renderer"])
        if "combine_transparent" in kwargs:
            geom["combine_transparent"] = bool(kwargs["combine_transparent"])
        if "axis3d_controls" in kwargs:
            geom["axis3d_controls"] = bool(kwargs["axis3d_controls"])
        self._sync_all()

    def _add_frame_layer(self, fid: str, kind: str, **config: Any) -> None:
        layer = {"kind": str(kind)}
        layer.update(config)
        self._geom_for(fid).setdefault("frame_layers", []).append(layer)
        self._sync_all()

    def _add_box(
        self,
        fid: str,
        *,
        center: Any,
        scale: Any,
        color: Any,
        texture: Any = None,
    ) -> SceneBox:
        data: dict[str, Any] = {
            "type":     "box",
            "center":   _vec3(center or [0, 0, 0], "center"),
            "scale":    _vec3(scale  or [1, 1, 1], "scale"),
            "color":    _color_to_payload(color),
            "rotation": [0.0, 0.0, 0.0],
        }
        normalized_texture = _normalize_texture_spec(texture)
        if normalized_texture is not None:
            data["texture"] = normalized_texture
        self._geom_for(fid)["meshes"].append(data)
        self._sync_all()
        obj = SceneBox(data, self, fid)
        idx = len(self._geom_for(fid)["meshes"]) - 1
        self._scene_objects[(fid, idx)] = obj
        return obj

    def _add_ellipsoid(
        self,
        fid: str,
        *,
        center: Any,
        scale: Any,
        color: Any,
        texture: Any = None,
    ) -> SceneBox:
        data: dict[str, Any] = {
            "type":     "ellipsoid",
            "center":   _vec3(center or [0, 0, 0], "center"),
            "scale":    _vec3(scale  or [1, 1, 1], "scale"),
            "color":    _color_to_payload(color),
            "rotation": [0.0, 0.0, 0.0],
        }
        normalized_texture = _normalize_texture_spec(texture)
        if normalized_texture is not None:
            data["texture"] = normalized_texture
        self._geom_for(fid)["meshes"].append(data)
        self._sync_all()
        obj = SceneBox(data, self, fid)
        idx = len(self._geom_for(fid)["meshes"]) - 1
        self._scene_objects[(fid, idx)] = obj
        return obj

    def _add_torus(
        self,
        fid: str,
        *,
        center: Any,
        scale: Any,
        color: Any,
        major_radius: float,
        minor_radius: float,
        texture: Any = None,
    ) -> SceneBox:
        data: dict[str, Any] = {
            "type":         "torus",
            "center":       _vec3(center or [0, 0, 0], "center"),
            "scale":        _vec3(scale  or [1, 1, 1], "scale"),
            "color":        _color_to_payload(color),
            "major_radius": float(major_radius),
            "minor_radius": float(minor_radius),
            "rotation":     [0.0, 0.0, 0.0],
        }
        normalized_texture = _normalize_texture_spec(texture)
        if normalized_texture is not None:
            data["texture"] = normalized_texture
        self._geom_for(fid)["meshes"].append(data)
        self._sync_all()
        obj = SceneBox(data, self, fid)
        idx = len(self._geom_for(fid)["meshes"]) - 1
        self._scene_objects[(fid, idx)] = obj
        return obj

    def _add_field_mesh(self, fid: str, **kwargs: Any) -> SceneFieldMesh:
        data = _build_field_mesh_from_kwargs(kwargs)
        self._geom_for(fid)["meshes"].append(data)
        try:
            verts = data.get("vertices")
            indices = data.get("indices")
            _plot_debug_line(
                "_add_field_mesh "
                f"fid={fid!r} id={data.get('id')!r} type={data.get('type')!r} "
                f"vertex_floats={len(verts) if hasattr(verts, '__len__') else 'n/a'} "
                f"indices={len(indices) if hasattr(indices, '__len__') else 'n/a'} "
                f"topology={data.get('topology')!r} edge_width={data.get('edge_width')!r} "
                f"render_mode={data.get('render_mode')!r} marker_space={data.get('marker_space')!r} "
                f"meshes={len(self._geom_for(fid).get('meshes', []))}"
            )
        except Exception as exc:
            _plot_debug_line(f"_add_field_mesh log_error={exc!r}")
        self._sync_all()
        obj = SceneFieldMesh(data, self, fid, kwargs)
        idx = len(self._geom_for(fid)["meshes"]) - 1
        self._scene_objects[(fid, idx)] = obj
        return obj

    def _add_function_surface(
        self,
        fid: str,
        *,
        fn: Any,
        params: Any,
        u_dim: str,
        v_dim: str,
        color: Any,
        interpolation: bool,
        depth_write: bool,
        id: str | None = None,
        **kwargs: Any,
    ) -> SceneFieldMesh:
        source = _build_function_surface_source_kwargs(
            fn,
            params,
            u_dim=u_dim,
            v_dim=v_dim,
            color=color,
            interpolation=interpolation,
            depth_write=depth_write,
            id=id,
            extra=dict(kwargs),
        )
        return self._add_field_mesh(fid, **source)

    def _add_function_plot(
        self,
        fid: str,
        *,
        fn: Any,
        expr_source: Any,
        params: Any,
        x_fn: Any,
        y_fn: Any,
        z_fn: Any,
        color: Any,
        color_mode: Any,
        color_axis: Any,
        colormap: Any,
        interpolation: bool,
        depth_write: bool,
        id: str | None = None,
        **kwargs: Any,
    ) -> SceneFieldMesh:
        _plot_debug_line(
            "_add_function_plot "
            f"fid={fid!r} expr={str(expr_source)!r} id={str(id)!r} "
            f"x_fn={x_fn is not None} y_fn={y_fn is not None} color_mode={str(color_mode)!r}"
        )
        source = _build_function_plot_source_kwargs(
            fn,
            expr_source,
            params,
            x_fn=x_fn,
            y_fn=y_fn,
            z_fn=z_fn,
            color=color,
            color_mode=color_mode,
            color_axis=color_axis,
            colormap=colormap,
            interpolation=interpolation,
            depth_write=depth_write,
            id=id,
            extra=dict(kwargs),
        )
        _plot_debug_line(f"_add_function_plot source_keys={sorted(str(k) for k in source.keys())!r}")
        return self._add_field_mesh(fid, **source)

    def _add_camera(
        self,
        fid: str,
        *,
        pos: Any,
        target: Any,
        fov: float,
        up: Any,
        projection: str,
        ortho_scale: float | None,
    ) -> SceneCamera:
        projection_name = str(projection or "perspective").strip().lower()
        if projection_name not in {"perspective", "orthographic"}:
            raise ValueError("camera projection must be 'perspective' or 'orthographic'")
        data: dict[str, Any] = {
            "pos":    _vec3(pos, "pos"),
            "target": _vec3(target or [0, 0, 0], "target"),
            "fov":    float(fov),
            "up":     _vec3(up or [0, 0, 1], "up"),
            "projection": projection_name,
        }
        if projection_name == "orthographic" or ortho_scale is not None:
            data["ortho_scale"] = max(1e-6, float(ortho_scale if ortho_scale is not None else 2.5))
        self._geom_for(fid)["camera"] = data
        self._sync_all()
        return SceneCamera(data, self, fid)

    def _add_light(
        self,
        fid: str,
        *,
        pos: Any,
        model: str,
        color: Any,
        intensity: float,
        kind: str,
        direction: Any,
        target: Any,
        inner_cone_deg: float,
        outer_cone_deg: float,
        range: float,
    ) -> SceneLight:
        m = str(model).lower().replace("-", "_")
        if m in {"flat", "lambert", "phong"}:
            m = "blinn_phong"
        if m not in LIGHT_MODELS:
            raise ValueError(f"model {model!r} unknown; use one of: {sorted(LIGHT_MODELS)}")
        k = str(kind).lower().strip()
        if k == "spotlight":
            k = "spot"
        if k not in {"point", "spot"}:
            raise ValueError("light kind must be 'point' or 'spot'")
        data: dict[str, Any] = {
            "pos":   _vec3(pos, "pos"),
            "model": m,
            "color": color,
            "intensity": max(0.0, float(intensity)),
            "kind": k,
            "inner_cone_deg": float(inner_cone_deg),
            "outer_cone_deg": float(outer_cone_deg),
            "range": max(0.0, float(range)),
        }
        if direction is not None:
            data["direction"] = _vec3(direction, "direction")
        if target is not None:
            data["target"] = _vec3(target, "target")
        self._geom_for(fid)["lights"].append(data)
        self._sync_all()
        return SceneLight(data, self, fid)

    # ---- geom helpers -----------------------------------------------------

    # ---- object / frame lookup -------------------------------------------

    def get_object(self, object_id: int) -> Any:
        """Return the scene object (SceneBox/SceneCamera/SceneLight) for a given object_id.

        ``object_id`` is 1-based (0 = no object). The id is the 1-based index of
        the mesh in the frame's mesh list (matches the ``object_id`` sent by the JS
        picking pass).

        Returns ``None`` if not found.
        """
        if object_id <= 0:
            return None
        # Walk all frames, look at stored SceneBox references
        idx = object_id - 1  # 0-based index
        for fid, entries in self._geom.items():
            if fid.startswith("__pending_"):
                continue
            meshes = entries.get("meshes", [])
            if idx < len(meshes):
                return self._scene_objects.get((fid, idx))
        return None

    def get_frame(self, frame_id: str) -> Any:
        """Return the :class:`FrameRef` for a given ``frame_id``.

        Returns ``None`` if not found.
        """
        for fr in self._frame_refs:
            if fr._frame_id == frame_id:
                return fr
        return None

    def _geom_for(self, fid: str) -> dict[str, Any]:
        if fid not in self._geom:
            self._geom[fid] = {"meshes": [], "camera": None, "lights": [], "texts": [], "frame_layers": []}
        return self._geom[fid]

    def _last_placed_id(self, op: str) -> str:
        if self._last_frame is not None and self._last_frame._placed:
            return self._last_frame._frame_id
        if self._last_frame is not None:
            return f"__pending_{self._last_frame._pending_key}"
        raise RuntimeError(
            f"d.{op}(): no frame has been placed yet — call d.add_frame(…) first"
        )

    # ---- add_frame --------------------------------------------------------

    def add_frame(
        self,
        first: Any,
        second: Any | None = None,
        **kwargs: Any,
    ) -> FrameRef:
        fr, pending = _unwrap_frame_ref(first)
        if pending is not None:
            if second is not None or bool(kwargs):
                skw = _coerce_frame_kw_for_screen(dict(kwargs))
                parent_pending = skw.get("in_frame")
                self._screen.add_frame(pending, second, write_files=self._auto_render, **skw)
                if fr is not None:
                    self._mark_frame_ref_placed(fr)
                    self._frame_parent[fr._frame_id] = (
                        parent_pending._placed_id if isinstance(parent_pending, PendingFrame) else None
                    )
                self._sync_all()
                if fr is not None:
                    return fr
                out = FrameRef(self, pending)
                self._mark_frame_ref_placed(out)
                self._frame_parent[out._frame_id] = (
                    parent_pending._placed_id if isinstance(parent_pending, PendingFrame) else None
                )
                return out
            raise TypeError(
                "add_frame: pass a rect or a layout option, "
                "or use d.add_frame((x,y,w,h)) for the short form"
            )
        t = _rect_from_tuple(first)
        if self._last_frame is None or self._last_frame._placed:
            if kwargs:
                p = self._screen.frame(**kwargs)
            else:
                p = self._screen.frame(
                    title="", draggable=True, dockable=True,
                    resizable=True, closable=True, alpha=1.0, dock_loc="bl",
                )
            self._last_frame = FrameRef(self, p)
        f = self._last_frame
        self._screen.add_frame(f._pending, (t[0], t[1], t[2], t[3]), write_files=self._auto_render)
        self._mark_frame_ref_placed(f)
        self._frame_parent[f._frame_id] = None
        self._sync_all()
        return f

    def _mark_frame_ref_placed(self, f: FrameRef) -> None:
        old_key = f._pending_key
        pending_frame_id = f"__pending_{old_key}"
        f._placed = True
        f._frame_id = str(f._pending.id)
        self._frame_parent.setdefault(f._frame_id, None)
        # migrate pending 2-D ops
        if old_key in self._pending_ops:
            ops = self._pending_ops.pop(old_key)
            self._frame_ops[f._frame_id] = self._frame_ops.get(f._frame_id, []) + ops
        # migrate pending geom ops
        if pending_frame_id in self._geom:
            geom_data = self._geom.pop(pending_frame_id)
            existing = self._geom.get(f._frame_id, {"meshes": [], "camera": None, "lights": [], "texts": []})
            existing.setdefault("meshes", []).extend(geom_data.get("meshes", []))
            if geom_data.get("camera") is not None:
                existing["camera"] = geom_data["camera"]
            existing.setdefault("lights", []).extend(geom_data.get("lights", []))
            existing.setdefault("texts", []).extend(geom_data.get("texts", []))
            self._geom[f._frame_id] = existing
        # migrate pending representation ops + ownership
        pending_rep_ops = self._frame_repr_ops.pop(pending_frame_id, None)
        if pending_rep_ops:
            placed_rep_ops = self._frame_repr_ops.setdefault(f._frame_id, {})
            placed_rep_ops.update(pending_rep_ops)
        for rep in self._representations.values():
            if rep._frame_id == pending_frame_id:
                rep._frame_id = f._frame_id
        self._last_frame = f
        if f not in self._frame_refs:
            self._frame_refs.append(f)

    def _append_frame_op(self, frame_id: str, op: dict[str, Any]) -> None:
        self._frame_ops.setdefault(frame_id, []).append(op)

    def _append_pending_frame_op(self, key: int, op: dict[str, Any]) -> None:
        self._pending_ops.setdefault(key, []).append(op)

    def _next_rep_id(self) -> str:
        self._next_representation_id += 1
        return f"rep_{self._next_representation_id}"

    def _effective_graphics_defaults(self, frame_id: str | None) -> dict[str, Any]:
        defaults = _deep_copy_dict(self._graphics_defaults)
        cur = frame_id
        seen: set[str] = set()
        chain_ids: list[str] = []
        while cur is not None and cur not in seen:
            seen.add(cur)
            chain_ids.append(cur)
            cur = self._frame_parent.get(cur)
        for fid in reversed(chain_ids):
            frame = self.get_frame(fid)
            if frame is not None and frame.graphics_defaults:
                defaults = _structural_merge_dict(defaults, frame.graphics_defaults)
        return defaults

    def _evaluate_embedding_scope(self, value: Any, embedding: Any, view: Any = _NO_VIEW) -> dict[str, Any]:
        if not callable(embedding):
            raise TypeError("embedding must be callable")
        scope = embedding(value) if view is _NO_VIEW else embedding(value, view)
        if not isinstance(scope, dict):
            raise TypeError("embedding must return local scope via `:`")
        if VF_TYPE_KEY in scope:
            return public_struct_items(scope)
        return scope

    def _set_representation_ops(
        self,
        frame_id: str | None,
        rep_id: str,
        ops: list[dict[str, Any]],
    ) -> None:
        if frame_id is None:
            self._screen_repr_ops[rep_id] = ops
            return
        self._frame_repr_ops.setdefault(frame_id, {})[rep_id] = ops

    def _add_graphics_representation(
        self,
        frame_id: str | None,
        value: Any,
        embedding: Any,
        *,
        view: Any = _NO_VIEW,
    ) -> SceneRepresentation:
        rep = SceneRepresentation(
            rep_id=self._next_rep_id(),
            rep_ordinal=self._next_representation_id,
            source=value,
            embedding=embedding,
            view=view,
            _display=self,
            _frame_id=frame_id,
        )
        self._representations[rep.rep_id] = rep
        self._refresh_representation(rep)
        return rep

    def _refresh_representation(self, rep: SceneRepresentation) -> None:
        refresh_representation(self, rep)
        self._sync_all()

    def _refresh_representations_for_frame(self, frame_id: str | None) -> None:
        if frame_id is None:
            return
        descendants = {frame_id}
        changed = True
        while changed:
            changed = False
            for child, parent in list(self._frame_parent.items()):
                if parent in descendants and child not in descendants:
                    descendants.add(child)
                    changed = True
        for rep in list(self._representations.values()):
            if rep._frame_id in descendants:
                refresh_representation(self, rep)
        self._sync_all()

    def _refresh_all_representations(self) -> None:
        refresh_all_representations(self)
        self._sync_all()

    def _remove_representation(self, rep: SceneRepresentation) -> None:
        self._representations.pop(rep.rep_id, None)
        if rep._frame_id is None:
            self._screen_repr_ops.pop(rep.rep_id, None)
        else:
            per_frame = self._frame_repr_ops.get(rep._frame_id)
            if per_frame is not None:
                per_frame.pop(rep.rep_id, None)
                if not per_frame:
                    self._frame_repr_ops.pop(rep._frame_id, None)
        self._sync_all()

    # ---- sync -------------------------------------------------------------

    def _sync_all(self, *, force: bool = False) -> None:
        if not force and not self._auto_render:
            self._dirty = True
            return
        self._dirty = False
        cmd_count = len(self._screen._commands)
        if cmd_count != self._last_scene_cmd_count:
            _write_vkf_scene_to_vf_ui(self._screen._commands)
            self._last_scene_cmd_count = cmd_count
        payload = build_display_payload(
            screen_ops=self._screen_ops,
            screen_repr_ops=self._screen_repr_ops,
            frame_ops=self._frame_ops,
            frame_repr_ops=self._frame_repr_ops,
            geom=self._geom,
        )
        _write_vf_display_json(payload)
        # Launch UI only when there is placed/visible content.
        # Pending frame ops/geom should not auto-open the host.
        if has_visible_display_content(commands=self._screen._commands, payload=payload):
            from vektorflow.ui.launch import maybe_launch_ui
            maybe_launch_ui()
            ui_root = getattr(self, "_ui_root", None)
            if ui_root is not None:
                try:
                    ui_root._ensure_poller()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _unwrap_frame_ref(a: Any) -> tuple[FrameRef | None, PendingFrame | None]:
    if isinstance(a, FrameRef):
        return a, a._pending
    if isinstance(a, PendingFrame):
        return None, a
    return None, None


def _sync_json_to_all_built_webs(payload: dict[str, Any]) -> None:
    publish_display_runtime_payload(payload)


def _write_vf_display_json(payload: dict[str, Any]) -> None:
    try:
        _sync_json_to_all_built_webs(payload)
    except OSError as exc:
        raise UISyncError(str(exc)) from exc


def build_ui_namespace() -> dict[str, Any]:
    root = UIRoot()
    return {
        "ui": root,
        "display": root.display,
        "cursor": root.cursor,
        "keyboard": root.keyboard,
        "events": root.events,
        "widgets": root.widgets,
        "graphics": root.graphics,
        "axis_2d": axis_2d,
        "axis_3d": axis_3d,
        "axis_2d_tick_labels": axis_2d_tick_labels,
        "Axis2D": Axis2D,
        "Axis3D": Axis3D,
        "poll": root.poll,
        "sleep": root.sleep,
        "event_loop": root.event_loop,
        "next_event": root.next_event,
        "set_mode": root.set_mode,
        "hit": _pick_hit,
        "pick_kind": _pick_kind_from_event,
        "pick_index": _pick_index_from_event,
        "Frame": root.Frame,
        "MouseEvent": MouseEvent,
        "MouseMove": MouseMove,
        "MouseHover": MouseHover,
        "MouseDown": MouseDown,
        "MouseUp": MouseUp,
        "MouseWheel": MouseWheel,
        "MouseDrag": MouseDrag,
        "FrameEvent": FrameEvent,
        "FrameClosed": FrameClosed,
        "FrameDocked": FrameDocked,
        "FrameDragged": FrameDragged,
        "FrameResized": FrameResized,
        "WidgetEvent": WidgetEvent,
        "ButtonPressedEvent": ButtonPressedEvent,
        "CheckboxToggledEvent": CheckboxToggledEvent,
        "SliderValueChangedEvent": SliderValueChangedEvent,
        "InputFieldTextChangedEvent": InputFieldTextChangedEvent,
        "InputFieldTextEnteredEvent": InputFieldTextEnteredEvent,
        "DropdownItemChangedEvent": DropdownItemChangedEvent,
        "TextAreaTextChangedEvent": TextAreaTextChangedEvent,
        "ComboboxTextChangedEvent": ComboboxTextChangedEvent,
        "ComboboxTextEnteredEvent": ComboboxTextEnteredEvent,
        "ComboboxItemChangedEvent": ComboboxItemChangedEvent,
        "ColorPickerValueChangedEvent": ColorPickerValueChangedEvent,
        "TouchEvent": TouchEvent,
        "KeyboardEvent": KeyboardEvent,
        "KeyEvent": KeyEvent,
        "KeyDown": KeyDown,
        "KeyUp": KeyUp,
        "MOUSE_MOVE": root.MOUSE_MOVE,
        "MOUSE_HOVER": root.MOUSE_HOVER,
        "MOUSE_DOWN": root.MOUSE_DOWN,
        "MOUSE_UP": root.MOUSE_UP,
        "MOUSE_WHEEL": root.MOUSE_WHEEL,
        "MOUSE_DRAG": root.MOUSE_DRAG,
        "KEY_DOWN": root.KEY_DOWN,
        "KEY_UP": root.KEY_UP,
        "FRAME_CLOSED": root.FRAME_CLOSED,
        "FRAME_DOCKED": root.FRAME_DOCKED,
        "FRAME_DRAGGED": root.FRAME_DRAGGED,
        "FRAME_RESIZED": root.FRAME_RESIZED,
        "BUTTON_PRESSED": root.BUTTON_PRESSED,
        "CHECKBOX_TOGGLED": root.CHECKBOX_TOGGLED,
        "SLIDER_VALUE_CHANGED": root.SLIDER_VALUE_CHANGED,
        "INPUT_FIELD_TEXT_CHANGED": root.INPUT_FIELD_TEXT_CHANGED,
        "INPUT_FIELD_TEXT_ENTERED": root.INPUT_FIELD_TEXT_ENTERED,
        "DROPDOWN_ITEM_CHANGED": root.DROPDOWN_ITEM_CHANGED,
        "TEXT_AREA_TEXT_CHANGED": root.TEXT_AREA_TEXT_CHANGED,
        "COMBOBOX_TEXT_CHANGED": root.COMBOBOX_TEXT_CHANGED,
        "COMBOBOX_TEXT_ENTERED": root.COMBOBOX_TEXT_ENTERED,
        "COMBOBOX_ITEM_CHANGED": root.COMBOBOX_ITEM_CHANGED,
        "COLOR_PICKER_VALUE_CHANGED": root.COLOR_PICKER_VALUE_CHANGED,
        "ButtonPressed": root.BUTTON_PRESSED,
        "CheckboxToggled": root.CHECKBOX_TOGGLED,
        "SliderValueChanged": root.SLIDER_VALUE_CHANGED,
        "InputFieldTextChanged": root.INPUT_FIELD_TEXT_CHANGED,
        "InputFieldTextEntered": root.INPUT_FIELD_TEXT_ENTERED,
        "DropdownItemChanged": root.DROPDOWN_ITEM_CHANGED,
        "TextAreaTextChanged": root.TEXT_AREA_TEXT_CHANGED,
        "ComboboxTextChanged": root.COMBOBOX_TEXT_CHANGED,
        "ComboboxTextEntered": root.COMBOBOX_TEXT_ENTERED,
        "ComboboxItemChanged": root.COMBOBOX_ITEM_CHANGED,
        "ColorPickerValueChanged": root.COLOR_PICKER_VALUE_CHANGED,
        "plot_active_params": plot_active_params,
        "plot_param_active": plot_param_active,
        "plot_param_label": plot_param_label,
        "plot_expr_body": plot_expr_body,
        "plot_expr_axis": plot_expr_axis,
        "plot_compile_body": plot_compile_body,
        "plot_signature_label": plot_signature_label,
        "plot_time_active": plot_time_active,
        "plot_faces_available": plot_faces_available,
        "plot_axis_options": plot_axis_options,
        "plot_axis_option": plot_axis_option,
        "plot_time_slider_count": plot_time_slider_count,
        "plot_colormap_label": plot_colormap_label,
        "plot_mode": plot_mode,
        "plot_history_push": plot_history_push,
    }
