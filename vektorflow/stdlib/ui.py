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
from typing import Any, Protocol

from ..runtime.vfvector import VFVector
from ..runtime.struct_value import VF_TYPE_KEY, public_struct_items
from ..ui.display_runtime import (
    build_display_payload,
    has_visible_display_content,
    publish_display_runtime_payload,
)
from ..ui.representation_runtime import (
    build_embedding_scope_draw_ops,
    build_field_mesh_from_kwargs,
    build_field_mesh_geometry,
    refresh_all_representations,
    refresh_representation,
    refresh_representations_for_frame,
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
    TouchEvent, KeyboardEvent, KeyEvent, KeyDown, KeyUp,
    EVENT_NAME_TO_BASE,
    EVENT_CONST_TO_NAME,
    encode_event_code,
    encode_ui_pattern,
    encode_frame_pattern,
    encode_widget_pattern,
    ui_event_from_payload,
    start_event_poller, get_global_poller,
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
        p = Path(base) / "vektor-flow" / "python-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} {msg}\n")
    except OSError:
        pass

# ---------------------------------------------------------------------------
# Lighting models supported by vf-geom-wgpu.js
# ---------------------------------------------------------------------------
LIGHT_MODELS = {"flat", "lambert", "blinn_phong", "phong"}

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


# ---------------------------------------------------------------------------
# Low-level math helpers
# ---------------------------------------------------------------------------

def _vec3(v: Any, name: str = "vec") -> list[float]:
    if isinstance(v, (VFVector, list, tuple)) and len(v) >= 3:
        return [float(v[0]), float(v[1]), float(v[2])]
    raise TypeError(f"{name} must be [x, y, z]")


def _rect_from_tuple(t: Any) -> tuple[float, float, float, float]:
    if isinstance(t, (VFVector, list, tuple)) and len(t) == 4:
        return (float(t[0]), float(t[1]), float(t[2]), float(t[3]))
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
_MESH_CHANNEL_RE = re.compile(r"^([xyz])(?:_([tijkuvw]+))?$")
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
_PICK_SEMANTIC_MASK = _PICK_REP_MASK | _PICK_KIND_MASK | _PICK_CARRIER_MASK
_PICK_CONTENT_MATCH_MASK = _PICK_SEMANTIC_MASK | _PICK_CONTENT_MASK
_PICK_EXACT_MASK = _PICK_CONTENT_MATCH_MASK | _PICK_SUB_MASK

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
        "pick_mask_carrier": _PICK_SEMANTIC_MASK,
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
            "pick_mask_carrier": _PICK_SEMANTIC_MASK,
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

    # -- mutations ------------------------------------------------------------

    def translate(self, delta: Any) -> "SceneBox":
        """Shift center by [dx, dy, dz]. Returns self."""
        d = _vec3(delta, "delta")
        c = self._data["center"]
        self._data["center"] = [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
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
        self._data["color"] = str(color)
        self._display._sync_all()
        return self

    def set_scale(self, scale: Any) -> "SceneBox":
        """Resize the box. Returns self."""
        self._data["scale"] = _vec3(scale, "scale")
        self._display._sync_all()
        return self

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

    def _rebuild(self, *, time_value: Any | None = None) -> "SceneFieldMesh":
        count = max(1, self.t_count)
        raw_t = self._data.get("time_index", 0) if time_value is None else time_value
        idx = max(0, min(int(round(float(raw_t))), count - 1))
        channels: dict[str, dict[str, Any]] = {}
        meta: dict[str, Any] = {}
        for key, raw in self._source_kwargs.items():
            m = _MESH_CHANNEL_RE.match(str(key))
            if m:
                axis = m.group(1)
                dims = str(m.group(2) or "")
                channels[axis] = _parse_mesh_channel(axis, dims, raw)
            else:
                meta[str(key)] = raw
        geom = _build_field_mesh_geometry(channels, meta, time_index=idx)
        self._data["vertices"] = geom["vertices"]
        self._data["indices"] = geom["indices"]
        self._data["topology"] = geom["topology"]
        self._data["interpolation"] = geom["interpolation"]
        self._data["alpha"] = geom["alpha"]
        self._data["time_count"] = geom["time_count"]
        self._data["time_index"] = geom["time_index"]
        self._display._sync_all()
        return self

    def set_t(self, value: Any) -> "SceneFieldMesh":
        return self._rebuild(time_value=value)

    def set_time(self, value: Any) -> "SceneFieldMesh":
        return self.set_t(value)

    def set_interpolation(self, value: Any) -> "SceneFieldMesh":
        self._source_kwargs["interpolation"] = bool(value)
        return self._rebuild()

    def set_color(self, color: Any) -> "SceneFieldMesh":
        """Change mesh color and rebuild vertex colors. Returns self."""
        self._source_kwargs["color"] = color
        self._data["color"] = color
        return self._rebuild()

    def __repr__(self) -> str:
        return (
            f"SceneFieldMesh(time_index={self._data.get('time_index', 0)}, "
            f"time_count={self._data.get('time_count', 1)}, "
            f"color={self._data.get('color')!r})"
        )


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
        self._data["color"] = str(color)
        self._display._sync_all()
        return self

    def set_model(self, model: str) -> "SceneLight":
        """Change lighting model. Returns self."""
        m = str(model).lower().replace("-", "_")
        if m not in LIGHT_MODELS:
            raise ValueError(f"model {model!r} unknown; use one of: {sorted(LIGHT_MODELS)}")
        self._data["model"] = m
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
        return f"SceneLight(pos={self._data['pos']}, model={self._data['model']!r}, color={self._data['color']!r})"


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

    def add_box(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> SceneBox:
        """Add a 3-D box. Returns a :class:`SceneBox` you can mutate live."""
        fid = self._get_placed_id()
        return self._display._add_box(fid, center=center, scale=scale, color=color)

    # legacy alias
    def draw_box(self, *, center: Any = None, scale: Any = None, color: Any = None) -> SceneBox:
        return self.add_box(center=center, scale=scale, color=color)

    def add_ellipsoid(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> SceneBox:
        fid = self._get_placed_id()
        return self._display._add_ellipsoid(fid, center=center, scale=scale, color=color)

    def draw_ellipsoid(self, *, center: Any = None, scale: Any = None, color: Any = None) -> SceneBox:
        return self.add_ellipsoid(center=center, scale=scale, color=color)

    def add_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
    ) -> SceneBox:
        fid = self._get_placed_id()
        return self._display._add_torus(
            fid,
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
        )

    def draw_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
    ) -> SceneBox:
        return self.add_torus(
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
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

    def add_camera(
        self,
        *,
        pos: Any,
        target: Any = None,
        fov: float = 45.0,
        up: Any = None,
    ) -> SceneCamera:
        """Set the camera. Returns a :class:`SceneCamera` you can mutate live."""
        fid = self._get_placed_id()
        return self._display._add_camera(fid, pos=pos, target=target, fov=fov, up=up)

    def add_light(
        self,
        *,
        pos: Any,
        model: str = "blinn_phong",
        color: Any = "white",
    ) -> SceneLight:
        """Add a light. Returns a :class:`SceneLight` you can mutate live."""
        fid = self._get_placed_id()
        return self._display._add_light(fid, pos=pos, model=model, color=color)

    def _get_placed_id(self) -> str:
        if self._placed and self._frame_id:
            return self._frame_id
        return f"__pending_{self._pending_key}"


# ---------------------------------------------------------------------------
# UIEventQueue
# ---------------------------------------------------------------------------

@dataclass
class UIEventQueue:
    """Explicit event queue API for dispatch-style loops."""

    __vf_py_attrs__ = True
    _ui: "UIRoot"

    def poll(self) -> bool:
        """Return ``True`` when at least one event is queued."""
        self._ui._ensure_poller()
        return bool(self._ui._event_queue)

    def get(self) -> MouseEvent | KeyboardEvent | FrameEvent | dict[str, Any] | None:
        """Pop one pending event (mouse first), or ``None``."""
        return self._ui.next_event()


# ---------------------------------------------------------------------------
# UIRoot
# ---------------------------------------------------------------------------

@dataclass
class UIRoot:
    """``use("ui")`` / ``:.ui`` — use UI bindings such as ``display``, ``Frame``, ``set_mode()``, or alias with ``ui:.ui``.

    Events
    ------
    Call ``ui.poll()`` from your loop to drain incoming mouse/keyboard events
    and fire registered callbacks.  The event poller background thread starts
    automatically when the first frame is placed.

    Example::

        :.ui
        d : display
        f : Frame((0.1, 0.1, 0.8, 0.8))
        cam : d.add_camera(pos:[4,3,5])

        cursor.on_wheel(fn(e) => cam.translate([0, 0, e.step * 0.3]))
        cursor.on_down( fn(e) => print("click", e.object_id))

        loop:
            poll()
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
        # Wire the global poller to push events into our mouse/keyboard queues
        def _dispatch(evt: dict) -> None:
            ev_name = str(evt.get("event", ""))
            frame_id = str(evt.get("frame_id", evt.get("frameId", "")) or "")
            widget_id = str(evt.get("widget_id", evt.get("widgetId", "")) or "")
            _ui_trace_line(f"dispatch raw type={evt.get('type')} event={ev_name} frame={frame_id} widget={widget_id}")
            base = int(EVENT_NAME_TO_BASE.get(ev_name, 0))
            code = encode_event_code(ev_name, frame_id=frame_id, widget_id=widget_id)
            ui_code = encode_ui_pattern(ev_name) if base else 0
            frame_code = encode_frame_pattern(ev_name, frame_id) if (base and frame_id) else 0
            widget_code = encode_widget_pattern(ev_name, widget_id) if (base and widget_id) else 0
            idx = 0
            if base:
                idx = int(self._event_kind_count.get(base, 0)) + 1
                self._event_kind_count[base] = idx

            payload = dict(evt)
            payload["event"] = ev_name
            payload["frame_id"] = frame_id
            payload["widget_id"] = widget_id
            payload["event_code"] = code
            payload["ui_code"] = ui_code
            payload["frame_code"] = frame_code
            payload["widget_code"] = widget_code
            payload["index"] = idx
            normalized = ui_event_from_payload(payload)
            _ui_trace_line(f"dispatch normalized cls={type(normalized).__name__} event={getattr(normalized, 'event', '')} frame={getattr(normalized, 'frame_id', '')}")

            t = evt.get("type")
            if t != "vf_event":
                # Non-vf_event host events (frame lifecycle, widget payloads, etc.).
                self._event_queue.append(normalized)
                return
            if ev_name in ("move", "hover", "down", "up", "wheel", "drag"):
                self.keyboard._observe_modifiers(evt)
                self.cursor._push(payload)
                self._event_queue.append(normalized)
            elif ev_name in ("key_down", "key_up"):
                ke = KeyboardEvent.from_dict(payload)
                is_modifier = self.keyboard._modifier_name(ke) is not None
                self.keyboard._push(payload)
                if not is_modifier:
                    self._event_queue.append(normalized)
        p = get_global_poller()
        p.subscribe(_dispatch)

    def _ensure_poller(self) -> None:
        if not self._poller_started:
            object.__setattr__(self, "_poller_started", True)
            if self.mode != "test":
                start_event_poller()

    def next_event(self) -> Any:
        """Return one pending queued event, or ``None`` when no event is queued."""
        self._ensure_poller()
        if self._event_queue:
            evt = self._event_queue.popleft()
            _ui_trace_line(f"next_event cls={type(evt).__name__} event={getattr(evt, 'event', '')} frame={getattr(evt, 'frame_id', '')}")
            return evt
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

    Lighting models: ``"flat"`` · ``"lambert"`` · ``"blinn_phong"``
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
    ) -> SceneBox:
        """Add a box to the last placed frame. Returns :class:`SceneBox`."""
        fid = self._last_placed_id("add_box")
        return self._add_box(fid, center=center, scale=scale, color=color)

    # legacy alias
    def draw_box(self, *, center: Any = None, scale: Any = None, color: Any = None) -> SceneBox:
        """Alias for :meth:`add_box`."""
        return self.add_box(center=center, scale=scale, color=color)

    def add_ellipsoid(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> SceneBox:
        fid = self._last_placed_id("add_ellipsoid")
        return self._add_ellipsoid(fid, center=center, scale=scale, color=color)

    def draw_ellipsoid(self, *, center: Any = None, scale: Any = None, color: Any = None) -> SceneBox:
        return self.add_ellipsoid(center=center, scale=scale, color=color)

    def add_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
    ) -> SceneBox:
        fid = self._last_placed_id("add_torus")
        return self._add_torus(
            fid,
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
        )

    def draw_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
    ) -> SceneBox:
        return self.add_torus(
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
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

    def add_camera(
        self,
        *,
        pos: Any,
        target: Any = None,
        fov: float = 45.0,
        up: Any = None,
    ) -> SceneCamera:
        """Set camera for last placed frame. Returns :class:`SceneCamera`."""
        fid = self._last_placed_id("add_camera")
        return self._add_camera(fid, pos=pos, target=target, fov=fov, up=up)

    def add_light(
        self,
        *,
        pos: Any,
        model: str = "blinn_phong",
        color: Any = "white",
    ) -> SceneLight:
        """Add a light to last placed frame. Returns :class:`SceneLight`."""
        fid = self._last_placed_id("add_light")
        return self._add_light(fid, pos=pos, model=model, color=color)

    # ---- internal 3-D builders (used by both Display and FrameRef) --------

    def _add_box(
        self,
        fid: str,
        *,
        center: Any,
        scale: Any,
        color: Any,
    ) -> SceneBox:
        data: dict[str, Any] = {
            "type":     "box",
            "center":   _vec3(center or [0, 0, 0], "center"),
            "scale":    _vec3(scale  or [1, 1, 1], "scale"),
            "color":    str(color) if color is not None else None,
            "rotation": [0.0, 0.0, 0.0],
        }
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
    ) -> SceneBox:
        data: dict[str, Any] = {
            "type":     "ellipsoid",
            "center":   _vec3(center or [0, 0, 0], "center"),
            "scale":    _vec3(scale  or [1, 1, 1], "scale"),
            "color":    str(color) if color is not None else None,
            "rotation": [0.0, 0.0, 0.0],
        }
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
    ) -> SceneBox:
        data: dict[str, Any] = {
            "type":         "torus",
            "center":       _vec3(center or [0, 0, 0], "center"),
            "scale":        _vec3(scale  or [1, 1, 1], "scale"),
            "color":        str(color) if color is not None else None,
            "major_radius": float(major_radius),
            "minor_radius": float(minor_radius),
            "rotation":     [0.0, 0.0, 0.0],
        }
        self._geom_for(fid)["meshes"].append(data)
        self._sync_all()
        obj = SceneBox(data, self, fid)
        idx = len(self._geom_for(fid)["meshes"]) - 1
        self._scene_objects[(fid, idx)] = obj
        return obj

    def _add_field_mesh(self, fid: str, **kwargs: Any) -> SceneFieldMesh:
        data = _build_field_mesh_from_kwargs(kwargs)
        self._geom_for(fid)["meshes"].append(data)
        self._sync_all()
        obj = SceneFieldMesh(data, self, fid, kwargs)
        idx = len(self._geom_for(fid)["meshes"]) - 1
        self._scene_objects[(fid, idx)] = obj
        return obj

    def _add_camera(
        self,
        fid: str,
        *,
        pos: Any,
        target: Any,
        fov: float,
        up: Any,
    ) -> SceneCamera:
        data: dict[str, Any] = {
            "pos":    _vec3(pos, "pos"),
            "target": _vec3(target or [0, 0, 0], "target"),
            "fov":    float(fov),
            "up":     _vec3(up or [0, 1, 0], "up"),
        }
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
    ) -> SceneLight:
        m = str(model).lower().replace("-", "_")
        if m not in LIGHT_MODELS:
            raise ValueError(f"model {model!r} unknown; use one of: {sorted(LIGHT_MODELS)}")
        data: dict[str, Any] = {
            "pos":   _vec3(pos, "pos"),
            "model": m,
            "color": str(color),
        }
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
            self._geom[fid] = {"meshes": [], "camera": None, "lights": []}
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
            existing = self._geom.get(f._frame_id, {"meshes": [], "camera": None, "lights": []})
            existing["meshes"].extend(geom_data["meshes"])
            if geom_data["camera"] is not None:
                existing["camera"] = geom_data["camera"]
            existing["lights"].extend(geom_data["lights"])
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _unwrap_frame_ref(a: Any) -> tuple[FrameRef | None, PendingFrame | None]:
    if isinstance(a, FrameRef):
        return a, a._pending
    if isinstance(a, PendingFrame):
        return None, a
    return None, None


def _write_vf_display_json(payload: dict[str, Any]) -> None:
    publish_display_runtime_payload(payload)


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
        "poll": root.poll,
        "sleep": root.sleep,
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
        "ButtonPressed": root.BUTTON_PRESSED,
        "CheckboxToggled": root.CHECKBOX_TOGGLED,
        "SliderValueChanged": root.SLIDER_VALUE_CHANGED,
        "InputFieldTextChanged": root.INPUT_FIELD_TEXT_CHANGED,
        "InputFieldTextEntered": root.INPUT_FIELD_TEXT_ENTERED,
        "DropdownItemChanged": root.DROPDOWN_ITEM_CHANGED,
        "TextAreaTextChanged": root.TEXT_AREA_TEXT_CHANGED,
    }
