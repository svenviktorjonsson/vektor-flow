"""Stdlib ``ui`` — host UI: ``ui.display`` (``d.draw`` / ``f.draw`` = rects; stage vs frame), …

Implementation uses :mod:`vektorflow.stdlib.screen` (not a registered ``use`` name).
The ``bridge`` stdlib is also unregistered; see :mod:`vektorflow.stdlib.bridge` when needed.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .screen import (
    Screen,
    PendingFrame,
    _Widget,
    _write_vkf_scene_to_vf_ui,
)
from .screen import _copy_vf_ui_file_to_built_web
from .screen import _sync_json_to_all_built_webs
from .events import (
    UIMouse, UIKeyboard,
    MouseEvent, KeyEvent,
    EVENT_CONST_TO_NAME,
    HIT_EDGE,
    HIT_FACE,
    HIT_FRAME,
    HIT_MASK,
    HIT_OBJECT,
    HIT_VERTEX,
    encode_event_code,
    encode_ui_pattern,
    encode_frame_pattern,
    encode_widget_pattern,
    start_event_poller, get_global_poller,
)
from vektorflow.ui_display_ir import (
    apply_field_mesh_geometry_update,
    append_frame_paint_op,
    append_pending_frame_paint_op,
    append_screen_paint_op,
    dispatch_host_event,
    build_display_sync_plan,
    build_display_write_plan,
    build_frame_add_plan,
    build_scene_camera_payload,
    build_scene_light_payload,
    build_scene_mesh_payload,
    default_display_frame_kwargs,
    ensure_runtime_frame_scene,
    field_mesh_payload_from_geometry,
    has_queued_host_events,
    install_scene_camera_payload,
    install_scene_light_payload,
    install_scene_mesh_object,
    migrate_pending_display_state,
    normalize_scene_light_model,
    orbit_camera_payload,
    orbit_light_payload,
    place_frame_ref,
    pop_queued_host_event,
    register_frame_ref,
    resolve_frame_ref,
    resolve_active_frame_target,
    resolve_scene_object_for_pick,
    route_frame_paint_op,
    UiDisplayPayload,
    UiPaintOp,
    dumps_vf_display,
    rotate_scene_mesh_payload,
    set_light_model,
    set_scene_color,
    set_scene_fov,
    set_scene_vec3,
    translate_scene_payload,
    ensure_host_event_poller_started,
    zoom_camera_payload,
)
from vektorflow.ui_field_geometry import (
    build_field_mesh_geometry,
    parse_field_channels_and_meta,
)
from vektorflow.ui_scene_graph_math import (
    IDENTITY_AFFINE_2D,
    IDENTITY_MATRIX_4X4,
    resolve_affine_2d_from_scene_fields,
    resolve_model_matrix_3d_from_scene_fields,
)
from vektorflow.ui_scene_model import DisplaySceneState
from vektorflow.ui.host_bootstrap import (
    HOST_MANIFEST_FILENAME,
    build_host_bootstrap_manifest,
    write_host_bootstrap_manifest,
    write_host_manifest_text,
)

# ---------------------------------------------------------------------------
# Lighting models supported by vf-geom-wgpu.js
# ---------------------------------------------------------------------------
LIGHT_MODELS = {"flat", "lambert", "blinn_phong", "phong"}

# Animation tick rate (frames per second written to vf-display.json)
_ANIM_FPS = 60


def _vec3(v: Any, name: str = "vec") -> list[float]:
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return [float(v[0]), float(v[1]), float(v[2])]
    raise TypeError(f"{name} must be [x, y, z]")


def _rect_from_tuple(t: Any) -> tuple[float, float, float, float]:
    if isinstance(t, (list, tuple)) and len(t) == 4:
        return (float(t[0]), float(t[1]), float(t[2]), float(t[3]))
    raise TypeError("rect must be a 4-tuple (x, y, w, h) in normalized 0..1 coordinates")


def _points_from_seq(points: Any) -> tuple[tuple[float, float], ...]:
    try:
        seq = list(points)
    except TypeError as exc:
        raise TypeError("points must be a sequence of (x, y) pairs") from exc
    if len(seq) < 3:
        raise ValueError("polygon requires at least 3 points")
    out: list[tuple[float, float]] = []
    for p in seq:
        pair = list(p)
        if len(pair) != 2:
            raise ValueError("polygon points must be (x, y) pairs")
        out.append((float(pair[0]), float(pair[1])))
    return tuple(out)


def _coerce_frame_kw_for_screen(kwargs: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        if isinstance(v, FrameRef):
            out[k] = v._pending
        else:
            out[k] = v
    return out


def _make_paint_op(kind: str, rect: tuple[float, float, float, float], color: Any) -> UiPaintOp:
    return UiPaintOp(
        op=kind,  # type: ignore[arg-type]
        rect=(float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3])),
        color=color,
    )


def _make_transformed_paint_op(
    kind: str,
    rect: tuple[float, float, float, float],
    color: Any,
    transform: tuple[float, float, float, float, float, float],
    points: tuple[tuple[float, float], ...] | None = None,
    interaction: dict[str, Any] | None = None,
) -> UiPaintOp:
    return UiPaintOp(
        op=kind,  # type: ignore[arg-type]
        rect=(float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3])),
        color=color,
        transform=transform,
        points=points,
        interaction=interaction,
    )


def _default_polygon_interaction(
    display: "Display",
    *,
    shape_id: str | None = None,
    parent_shape_id: str = "",
) -> dict[str, Any]:
    sid = shape_id or display._next_shape_id("poly")
    return {
        "mode": "pick_2d",
        "shape_id": sid,
        "parent_shape_id": str(parent_shape_id),
        "cursor": "open_hand",
        "pressed_cursor": "closed_hand",
        "border": 0.035,
    }


def _hover_value(hover: Any, key: str, default: Any = None) -> Any:
    if isinstance(hover, dict):
        return hover.get(key, default)
    return getattr(hover, key, default)


def _hover_object_id(hover_or_id: Any) -> Any:
    if isinstance(hover_or_id, dict) or hasattr(hover_or_id, "object_id") or hasattr(hover_or_id, "shape_id"):
        return _hover_value(hover_or_id, "object_id", _hover_value(hover_or_id, "shape_id", ""))
    return hover_or_id


def _vec2_delta(trans: Any = None, *, dx: float = 0.0, dy: float = 0.0) -> tuple[float, float]:
    if trans is None:
        return float(dx), float(dy)
    try:
        return float(trans[0]), float(trans[1])
    except Exception as exc:
        raise TypeError("trans must be a vector with at least two numeric entries") from exc


def _vec2_apply(op: str, point: Any, value: Any) -> tuple[float, float]:
    x, y = float(point[0]), float(point[1])
    if isinstance(value, (int, float)):
        vx = vy = float(value)
    else:
        vx, vy = _vec2_delta(value)
    if op == "PLUS":
        return x + vx, y + vy
    if op == "MINUS":
        return x - vx, y - vy
    if op == "STAR":
        return x * vx, y * vy
    if op == "SLASH":
        return x / vx, y / vy
    raise TypeError(f"unsupported geometry update operator {op!r}")


def _make_scene_mesh(
    kind: str,
    *,
    center: Any,
    scale: Any,
    color: Any,
    rotation: Any = None,
    major_radius: float | None = None,
    minor_radius: float | None = None,
) -> dict[str, Any]:
    return build_scene_mesh_payload(
        kind,
        center=tuple(_vec3(center or [0, 0, 0], "center")),
        scale=tuple(_vec3(scale or [1, 1, 1], "scale")),
        color=str(color) if color is not None else None,
        rotation=tuple(_vec3(rotation or [0.0, 0.0, 0.0], "rotation")),
        major_radius=float(major_radius) if major_radius is not None else None,
        minor_radius=float(minor_radius) if minor_radius is not None else None,
    )


def _make_scene_camera(*, pos: Any, target: Any, fov: float, up: Any) -> dict[str, Any]:
    return build_scene_camera_payload(
        pos=tuple(_vec3(pos, "pos")),
        target=tuple(_vec3(target or [0, 0, 0], "target")),
        fov=float(fov),
        up=tuple(_vec3(up or [0, 1, 0], "up")),
    )


def _make_scene_light(*, pos: Any, model: str, color: Any) -> dict[str, Any]:
    return build_scene_light_payload(
        pos=tuple(_vec3(pos, "pos")),
        model=str(model),
        color=str(color),
    )


def _build_field_mesh_from_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    channels, meta = parse_field_channels_and_meta(kwargs)
    geom = build_field_mesh_geometry(
        channels,
        meta,
        time_index=int(meta.get("t", 0)),
    )

    return field_mesh_payload_from_geometry(
        geom=geom,
        mesh_id=str(meta.get("id", "field_mesh")),
        center=tuple(_vec3(meta.get("center", [0, 0, 0]), "center")),
        scale=tuple(_vec3(meta.get("scale", [1, 1, 1]), "scale")),
        rotation=tuple(_vec3(meta.get("rotation", [0, 0, 0]), "rotation")),
        color=meta.get("color"),
    )


@dataclass
class VertexRef:
    """A single polygon vertex, addressed from hover context or explicit ids."""

    __vf_py_attrs__ = True

    _shape: "RectRef"
    _index: int

    @property
    def id(self) -> int:
        return self._index

    def _checked_points(self) -> list[list[float]]:
        if self._shape._points is None:
            raise TypeError("vertex refs require a polygon parent.")
        if self._index < 0 or self._index >= len(self._shape._points):
            raise IndexError(f"vertex index {self._index} is outside polygon with {len(self._shape._points)} vertices")
        return [list(p) for p in self._shape._points]

    def translate(self, trans: Any = None, *, dx: float = 0.0, dy: float = 0.0) -> "VertexRef":
        tx, ty = _vec2_delta(trans, dx=dx, dy=dy)
        pts = self._checked_points()
        pts[self._index][0] += tx
        pts[self._index][1] += ty
        self._shape._points = tuple((float(x), float(y)) for x, y in pts)
        self._shape._display._sync_all()
        return self

    def __vf_update__(self, op: str, value: Any) -> "VertexRef":
        pts = self._checked_points()
        pts[self._index][0], pts[self._index][1] = _vec2_apply(op, pts[self._index], value)
        self._shape._points = tuple((float(x), float(y)) for x, y in pts)
        self._shape._display._sync_all()
        return self


@dataclass
class EdgeRef:
    """A polygon edge between vertex ``id`` and ``id + 1`` modulo vertex count."""

    __vf_py_attrs__ = True

    _shape: "RectRef"
    _index: int

    @property
    def id(self) -> int:
        return self._index

    def _checked_points(self) -> list[list[float]]:
        if self._shape._points is None:
            raise TypeError("edge refs require a polygon parent.")
        if self._index < 0 or self._index >= len(self._shape._points):
            raise IndexError(f"edge index {self._index} is outside polygon with {len(self._shape._points)} edges")
        return [list(p) for p in self._shape._points]

    def translate(self, trans: Any = None, *, dx: float = 0.0, dy: float = 0.0) -> "EdgeRef":
        delta = _vec2_delta(trans, dx=dx, dy=dy)
        VertexRef(self._shape, self._index).translate(delta)
        VertexRef(self._shape, (self._index + 1) % len(self._shape._points)).translate(delta)
        return self

    def __vf_update__(self, op: str, value: Any) -> "EdgeRef":
        pts = self._checked_points()
        next_index = (self._index + 1) % len(pts)
        pts[self._index][0], pts[self._index][1] = _vec2_apply(op, pts[self._index], value)
        pts[next_index][0], pts[next_index][1] = _vec2_apply(op, pts[next_index], value)
        self._shape._points = tuple((float(x), float(y)) for x, y in pts)
        self._shape._display._sync_all()
        return self


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

    def __init__(
        self,
        data: dict[str, Any],
        display: "Display",
        frame_id: str,
        parent: "SceneBox | None" = None,
    ) -> None:
        self._data = data          # live dict inside display._geom[fid]["meshes"][i]
        self._display = display
        self._frame_id = frame_id
        self._parent = parent
        self._children: list[SceneBox] = []
        if parent is not None:
            parent._children.append(self)
        self._local_center = tuple(float(v) for v in self._data.get("center", [0.0, 0.0, 0.0]))
        self._local_scale = tuple(float(v) for v in self._data.get("scale", [1.0, 1.0, 1.0]))
        self._local_rotation = tuple(float(v) for v in self._data.get("rotation", [0.0, 0.0, 0.0]))
        self._apply_world_model_recursive()

    # -- mutations ------------------------------------------------------------

    def translate(self, delta: Any) -> "SceneBox":
        """Shift center by [dx, dy, dz]. Returns self."""
        raw = _vec3(delta, "delta")
        self._local_center = (
            self._local_center[0] + raw[0],
            self._local_center[1] + raw[1],
            self._local_center[2] + raw[2],
        )
        set_scene_vec3(self._data, key="center", value=self._local_center)
        self._apply_world_model_recursive()
        self._display._sync_all()
        return self

    def rotate_by(self, angle_deg: float, around: str = "y") -> "SceneBox":
        """Rotate box around its center by *angle_deg* degrees about *around* axis.

        The rotation is accumulated in ``data['rotation']`` as ``[rx, ry, rz]``
        Euler angles (degrees, applied ZYX order) and passed through to the JS
        renderer which will apply it to the model matrix.
        Returns self.
        """
        self._local_rotation = tuple(rotate_scene_mesh_payload(self._data, angle_deg=angle_deg, around=around))
        self._apply_world_model_recursive()
        self._display._sync_all()
        return self

    def set_color(self, color: Any) -> "SceneBox":
        """Change the box color. Returns self."""
        set_scene_color(self._data, color)
        self._display._sync_all()
        return self

    def set_scale(self, scale: Any) -> "SceneBox":
        """Resize the box. Returns self."""
        self._local_scale = tuple(_vec3(scale, "scale"))
        set_scene_vec3(self._data, key="scale", value=self._local_scale)
        self._apply_world_model_recursive()
        self._display._sync_all()
        return self

    def add_box(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> "SceneBox":
        return self._display._add_box(
            self._frame_id,
            center=center,
            scale=scale,
            color=color,
            parent=self,
        )

    def add_ellipsoid(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> "SceneBox":
        return self._display._add_ellipsoid(
            self._frame_id,
            center=center,
            scale=scale,
            color=color,
            parent=self,
        )

    def add_torus(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
        major_radius: float = 0.65,
        minor_radius: float = 0.22,
    ) -> "SceneBox":
        return self._display._add_torus(
            self._frame_id,
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
            parent=self,
        )

    def add_rect(self, rect: Any, *, color: str = "#888888") -> Any:
        raise TypeError("3-D nodes cannot parent 2-D nodes.")

    def add_oval(self, rect: Any, *, color: str = "#888888") -> Any:
        raise TypeError("3-D nodes cannot parent 2-D nodes.")

    def add(self, **kwargs: Any) -> "SceneFieldMesh":
        return self._display._add_field_mesh(
            self._frame_id,
            parent=self,
            **kwargs,
        )

    @property
    def world_center(self) -> list[float]:
        parent_matrix = self._parent._world_model_matrix() if self._parent is not None else None
        return list(
            resolve_model_matrix_3d_from_scene_fields(
                center=self._local_center,
                rotation=self._local_rotation,
                scale=self._local_scale,
                parent_world=parent_matrix,
            ).world_translation
        )

    @property
    def world_matrix(self) -> list[float]:
        return list(self._world_model_matrix())

    # -- convenience ----------------------------------------------------------

    @property
    def center(self) -> list[float]:
        return [self._local_center[0], self._local_center[1], self._local_center[2]]

    @property
    def scale(self) -> list[float]:
        return [self._local_scale[0], self._local_scale[1], self._local_scale[2]]

    def __repr__(self) -> str:
        return f"SceneBox(center={self._data['center']}, scale={self._data['scale']}, color={self._data['color']!r})"

    def _local_model_matrix(self) -> tuple[float, ...]:
        return resolve_model_matrix_3d_from_scene_fields(
            center=self._local_center,
            rotation=self._local_rotation,
            scale=self._local_scale,
        ).local

    def _world_model_matrix(self) -> tuple[float, ...]:
        return tuple(float(v) for v in self._data.get("model_matrix", IDENTITY_MATRIX_4X4))

    def _apply_world_model_recursive(self) -> None:
        parent_matrix = self._parent._world_model_matrix() if self._parent is not None else None
        resolved = resolve_model_matrix_3d_from_scene_fields(
            center=self._local_center,
            rotation=self._local_rotation,
            scale=self._local_scale,
            parent_world=parent_matrix,
        )
        self._data["model_matrix"] = [float(v) for v in resolved.world]
        for child in self._children:
            child._apply_world_model_recursive()


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
        parent: SceneBox | None = None,
    ) -> None:
        super().__init__(data, display, frame_id, parent=parent)
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
        channels, meta = parse_field_channels_and_meta(self._source_kwargs)
        geom = build_field_mesh_geometry(channels, meta, time_index=idx)
        apply_field_mesh_geometry_update(self._data, geom)
        self._apply_world_model_recursive()
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
        translate_scene_payload(self._data, key="pos", delta=tuple(_vec3(delta, "delta")))
        self._display._sync_all()
        return self

    def look_at(self, target: Any) -> "SceneCamera":
        """Change the look-at target point. Returns self."""
        set_scene_vec3(self._data, key="target", value=tuple(_vec3(target, "target")))
        self._display._sync_all()
        return self

    def set_fov(self, degrees: float) -> "SceneCamera":
        """Change the field of view (degrees). Returns self."""
        set_scene_fov(self._data, degrees)
        self._display._sync_all()
        return self

    def set_mode(
        self,
        mode: str,
        *,
        cursor: str = "default",
        speed: float = 3.0,
        sensitivity: float = 0.0025,
    ) -> "SceneCamera":
        """Set browser-side camera controls. ``mode='game'`` enables WASD + mouse-look."""
        self._data["controls"] = {
            "mode": str(mode),
            "cursor": str(cursor),
            "speed": float(speed),
            "sensitivity": float(sensitivity),
        }
        self._display._sync_all()
        return self

    def rotate_by(self, angle_deg: float, around: str = "z") -> "SceneCamera":
        """Orbit the camera around the target point by *angle_deg* degrees (one-shot).

        *around* = 'z' keeps the camera at the same height and orbits in XY.
        *around* = 'x' or 'y' tilts the orbit plane accordingly.
        Returns self.
        """
        orbit_camera_payload(self._data, angle_deg=angle_deg, around=around)
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
        zoom_camera_payload(
            self._data,
            step=step,
            speed=speed,
            min_dist=min_dist,
            max_dist=max_dist,
        )
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
            time.sleep(5)
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
                t0 = time.monotonic()
                orbit_camera_payload(self._data, angle_deg=omega * dt, around=ax)
                self._display._sync_all()
                elapsed = time.monotonic() - t0
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
        translate_scene_payload(self._data, key="pos", delta=tuple(_vec3(delta, "delta")))
        self._display._sync_all()
        return self

    def set_pos(self, pos: Any) -> "SceneLight":
        """Set the light position to [x, y, z]. Returns self."""
        set_scene_vec3(self._data, key="pos", value=tuple(_vec3(pos, "pos")))
        self._display._sync_all()
        return self

    def set_color(self, color: Any) -> "SceneLight":
        """Change light color. Returns self."""
        set_scene_color(self._data, color)
        self._display._sync_all()
        return self

    def set_model(self, model: str) -> "SceneLight":
        """Change lighting model. Returns self."""
        set_light_model(self._data, model, allowed_models=LIGHT_MODELS)
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
                t0 = time.monotonic()
                orbit_light_payload(self._data, angle_deg=omega * dt, around=ax)
                self._display._sync_all()
                elapsed = time.monotonic() - t0
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
class RectRef:
    """A 2-D rect or oval with parent-relative transforms."""

    __vf_py_attrs__ = True

    _display: "Display"
    _kind: str
    _rect: tuple[float, float, float, float]
    _color: Any
    _points: tuple[tuple[float, float], ...] | None = None
    _interaction: dict[str, Any] | None = None
    _shape_id: str = ""
    _children: list["RectRef"] = field(default_factory=list, repr=False)
    _tx: float = 0.0
    _ty: float = 0.0
    _sx: float = 1.0
    _sy: float = 1.0
    _rotation_deg: float = 0.0

    @property
    def id(self) -> str:
        return self._shape_id

    def add_rect(self, rect: Any, *, color: Any = "#888888") -> "RectRef":
        child = RectRef(
            self._display,
            "rect",
            _rect_from_tuple(rect),
            color,
        )
        self._children.append(child)
        self._display._sync_all()
        return child

    def add_polygon(self, points: Any, *, color: Any = "#888888") -> "RectRef":
        interaction = _default_polygon_interaction(self._display, parent_shape_id=self._shape_id)
        child = RectRef(
            self._display,
            "polygon",
            (0.0, 0.0, 1.0, 1.0),
            color,
            _points_from_seq(points),
            interaction,
            str(interaction["shape_id"]),
        )
        self._children.append(child)
        self._display._sync_all()
        return child

    def add_oval(self, rect: Any, *, color: Any = "#888888") -> "RectRef":
        child = RectRef(
            self._display,
            "oval",
            _rect_from_tuple(rect),
            color,
        )
        self._children.append(child)
        self._display._sync_all()
        return child

    def add_box(self, **kwargs: Any) -> Any:
        raise TypeError("2-D nodes cannot parent 3-D nodes.")

    def add_ellipsoid(self, **kwargs: Any) -> Any:
        raise TypeError("2-D nodes cannot parent 3-D nodes.")

    def add_torus(self, **kwargs: Any) -> Any:
        raise TypeError("2-D nodes cannot parent 3-D nodes.")

    def add(self, **kwargs: Any) -> Any:
        raise TypeError("2-D nodes cannot parent 3-D nodes.")

    def translate(self, trans: Any = None, *, dx: float = 0.0, dy: float = 0.0) -> "RectRef":
        tx, ty = _vec2_delta(trans, dx=dx, dy=dy)
        self._tx += tx
        self._ty += ty
        self._display._sync_all()
        return self

    def __vf_update__(self, op: str, value: Any) -> "RectRef":
        if op == "PLUS":
            return self.translate(value)
        if op == "MINUS":
            tx, ty = _vec2_delta(value)
            return self.translate([-tx, -ty])
        if isinstance(value, (int, float)):
            vx = vy = float(value)
        else:
            vx, vy = _vec2_delta(value)
        if op == "STAR":
            return self.scale_by(sx=vx, sy=vy)
        if op == "SLASH":
            return self.scale_by(sx=1.0 / vx, sy=1.0 / vy)
        raise TypeError(f"unsupported geometry update operator {op!r}")

    def set_scale(self, *, sx: float | None = None, sy: float | None = None) -> "RectRef":
        if sx is not None:
            self._sx = float(sx)
        if sy is not None:
            self._sy = float(sy)
        self._display._sync_all()
        return self

    def scale_by(self, *, sx: float = 1.0, sy: float = 1.0) -> "RectRef":
        self._sx *= float(sx)
        self._sy *= float(sy)
        self._display._sync_all()
        return self

    def rotate_by(self, *, angle_deg: float) -> "RectRef":
        self._rotation_deg += float(angle_deg)
        self._display._sync_all()
        return self

    def vertex(self, vertex_id: int) -> VertexRef:
        return VertexRef(self, int(vertex_id))

    def edge(self, edge_id: int) -> EdgeRef:
        return EdgeRef(self, int(edge_id))

    def get_rect(self, shape_id: Any) -> "RectRef | None":
        wanted = str(_hover_object_id(shape_id))
        if self._shape_id == wanted:
            return self
        for child in self._children:
            hit = child.get_rect(wanted)
            if hit is not None:
                return hit
        return None

    def get_vertex(self, hover: Any) -> VertexRef | None:
        shape = self.get_rect(hover)
        if shape is None:
            return None
        vertex_id = _hover_value(hover, "vertex_id", -1)
        if vertex_id is None or int(vertex_id) < 0:
            return None
        return shape.vertex(int(vertex_id))

    def get_edge(self, hover: Any) -> EdgeRef | None:
        shape = self.get_rect(hover)
        if shape is None:
            return None
        edge_id = _hover_value(hover, "edge_id", -1)
        if edge_id is None or int(edge_id) < 0:
            return None
        return shape.edge(int(edge_id))

    def get(self, hover: Any) -> Any:
        vertex = self.get_vertex(hover)
        if vertex is not None:
            return vertex
        edge = self.get_edge(hover)
        if edge is not None:
            return edge
        return self.get_rect(hover)

    def set_interaction(
        self,
        *,
        cursor: str = "open_hand",
        pressed_cursor: str = "closed_hand",
        border: float = 0.08,
        shape_id: str | None = None,
    ) -> "RectRef":
        self._interaction = {
            "mode": "transform_2d",
            "shape_id": shape_id or self._shape_id or self._display._next_shape_id("poly"),
            "cursor": str(cursor),
            "pressed_cursor": str(pressed_cursor),
            "border": float(border),
        }
        self._shape_id = str(self._interaction["shape_id"])
        self._display._sync_all()
        return self

    def _local_transform(self) -> tuple[float, float, float, float, float, float]:
        x, y, w, h = self._rect
        return resolve_affine_2d_from_scene_fields(
            translation=(x + self._tx, y + self._ty),
            rotation_degrees=self._rotation_deg,
            scale=(w * self._sx, h * self._sy),
        ).local

    def _collect_paint_ops(
        self,
        parent_transform: tuple[float, float, float, float, float, float],
        out: list[UiPaintOp],
    ) -> None:
        x, y, w, h = self._rect
        world_transform = resolve_affine_2d_from_scene_fields(
            translation=(x + self._tx, y + self._ty),
            rotation_degrees=self._rotation_deg,
            scale=(w * self._sx, h * self._sy),
            parent_world=parent_transform,
        ).world
        out.append(
            _make_transformed_paint_op(
                self._kind,
                (0.0, 0.0, 1.0, 1.0),
                self._color,
                world_transform,
                self._points,
                self._interaction,
            )
        )
        for child in self._children:
            child._collect_paint_ops(world_transform, out)


@dataclass
class FrameRef:
    """A panel from ``d.frame`` / :meth:`Display.Frame`; use :meth:`add_frame`, then draw commands."""

    __vf_py_attrs__ = True

    _display: "Display"
    _pending: PendingFrame
    _placed: bool = field(default=False, repr=False)
    _frame_id: str = field(default="", repr=False)
    _pending_key: int = field(default=0, repr=False)
    _shape_roots: list[RectRef] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_pending_key", id(self))

    @property
    def id(self) -> str:
        return self._pending.id

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

    def add_rect(self, rect: Any, *, color: Any = "#888888") -> RectRef:
        ref = RectRef(self._display, "rect", _rect_from_tuple(rect), color)
        self._shape_roots.append(ref)
        self._display._sync_all()
        return ref

    def add_polygon(self, points: Any, *, color: Any = "#888888") -> RectRef:
        interaction = _default_polygon_interaction(self._display)
        ref = RectRef(
            self._display,
            "polygon",
            (0.0, 0.0, 1.0, 1.0),
            color,
            _points_from_seq(points),
            interaction,
            str(interaction["shape_id"]),
        )
        self._shape_roots.append(ref)
        self._display._sync_all()
        return ref

    def get_rect(self, shape_id: Any) -> RectRef | None:
        wanted = str(_hover_object_id(shape_id))
        for shape in self._shape_roots:
            hit = shape.get_rect(wanted)
            if hit is not None:
                return hit
        return None

    def get_vertex(self, hover: Any) -> VertexRef | None:
        shape = self.get_rect(hover)
        if shape is None:
            return None
        vertex_id = _hover_value(hover, "vertex_id", -1)
        if vertex_id is None or int(vertex_id) < 0:
            return None
        return shape.vertex(int(vertex_id))

    def get_edge(self, hover: Any) -> EdgeRef | None:
        shape = self.get_rect(hover)
        if shape is None:
            return None
        edge_id = _hover_value(hover, "edge_id", -1)
        if edge_id is None or int(edge_id) < 0:
            return None
        return shape.edge(int(edge_id))

    def get(self, hover: Any) -> Any:
        vertex = self.get_vertex(hover)
        if vertex is not None:
            return vertex
        edge = self.get_edge(hover)
        if edge is not None:
            return edge
        return self.get_rect(hover)

    def draw_rect(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        d = _make_paint_op("rect", z, color)
        route_frame_paint_op(
            frame_ops=self._display._frame_ops,
            pending_ops=self._display._pending_ops,
            frame_id=self._frame_id,
            placed=self._placed,
            pending_key=self._pending_key,
            op=d,
        )
        self._display._sync_all()

    def add_oval(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        d = _make_paint_op("oval", z, color)
        route_frame_paint_op(
            frame_ops=self._display._frame_ops,
            pending_ops=self._display._pending_ops,
            frame_id=self._frame_id,
            placed=self._placed,
            pending_key=self._pending_key,
            op=d,
        )
        self._display._sync_all()

    def _collect_shape_ops(self) -> list[UiPaintOp]:
        out: list[UiPaintOp] = []
        for shape in self._shape_roots:
            shape._collect_paint_ops(IDENTITY_AFFINE_2D, out)
        return out

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

    def add(self, **kwargs: Any) -> SceneFieldMesh:
        """Generic field mesh add using x_*/y_*/z_* channels over tijkuvw dims."""
        fid = self._get_placed_id()
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
        return has_queued_host_events(self._ui._event_queue)

    def get(self) -> MouseEvent | KeyEvent | None:
        """Pop one pending event (mouse first), or ``None``."""
        return self._ui.next_event()


# ---------------------------------------------------------------------------
# UIRoot
# ---------------------------------------------------------------------------

@dataclass
class UIRoot:
    """``use("ui")`` / ``:.ui`` — use ``ui.cursor``, ``ui.keyboard``, ``ui.display``, ``ui.widgets``, ``ui.poll()``.

    Events
    ------
    Call ``ui.poll()`` from your loop to drain incoming mouse/keyboard events
    and fire registered callbacks.  The event poller background thread starts
    automatically when the first frame is placed.

    Example::

        :.ui
        d : ui.display
        f : d.Frame()
        d.add_frame((0.1, 0.1, 0.8, 0.8))
        cam : d.add_camera(pos:[4,3,5])

        ui.cursor.on_wheel(fn(e) => cam.translate([0, 0, e.step * 0.3]))
        ui.cursor.on_down( fn(e) => print("click", e.object_id))

        loop:
            ui.poll()
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
    BUTTON_PRESSED: int = encode_ui_pattern("button.pressed")
    CHECKBOX_TOGGLED: int = encode_ui_pattern("checkbox.toggled")
    SLIDER_VALUE_CHANGED: int = encode_ui_pattern("slider.value_changed")
    INPUT_FIELD_TEXT_CHANGED: int = encode_ui_pattern("input_field.text_changed")
    INPUT_FIELD_TEXT_ENTERED: int = encode_ui_pattern("input_field.text_entered")
    DROPDOWN_ITEM_CHANGED: int = encode_ui_pattern("dropdown.item_changed")
    TEXT_AREA_TEXT_CHANGED: int = encode_ui_pattern("text_area.text_changed")
    FRAME: int = HIT_FRAME
    OBJECT: int = HIT_OBJECT
    FACE: int = HIT_FACE
    EDGE: int = HIT_EDGE
    VERTEX: int = HIT_VERTEX
    HIT_MASK: dict[str, int] = field(default_factory=lambda: dict(HIT_MASK))
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
            dispatch_host_event(
                evt,
                cursor=self.cursor,
                keyboard=self.keyboard,
                event_queue=self._event_queue,
                event_kind_count=self._event_kind_count,
            )
        p = get_global_poller()
        p.subscribe(_dispatch)

    def _ensure_poller(self) -> None:
        if ensure_host_event_poller_started(
            self._poller_started,
            start_poller=start_event_poller,
        ):
            object.__setattr__(self, "_poller_started", True)

    def next_event(self) -> Any:
        """Return one pending queued event, or ``None`` when no event is queued."""
        self._ensure_poller()
        return pop_queued_host_event(self._event_queue)

    def poll(self) -> None:
        """Drain queued events and fire registered mouse/keyboard callbacks."""
        self._ensure_poller()
        self.cursor.poll()
        self.keyboard.poll()

    @property
    def widgets(self) -> _Widget:
        """Widget factory namespace (preferred over ``d.widget``): ``ui.widgets.button(...)``."""
        return self.display.widget

    @property
    def mouse(self) -> UIMouse:
        """Backward-compatible alias for ``ui.cursor``."""
        return self.cursor


    def set_mode(self, mode: str) -> None:
        """Set the UI target: ``"overlay"``, ``"browser"``, or ``"headless"``.

        Call this **before** ``d.add_frame(...)`` so the right host is started.

        * ``"overlay"``  — native Windows host (WebView2 + DirectComposition).
        * ``"browser"``  — built-in HTTP server + open default browser.
        * ``"headless"`` — write ``vf-display.json`` only; no process spawned.

        You can also set the ``VF_UI_MODE`` environment variable to the same
        values instead of calling ``set_mode`` in code.

        Example (vkf)::

            :.ui
            ui.set_mode("browser")
            d : ui.display
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
        """Return the effective UI mode (``"overlay"``, ``"browser"``, or ``"headless"``)."""
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
    _scene_state: DisplaySceneState = field(default_factory=DisplaySceneState, repr=False)
    _shape_id_counter: int = field(default=0, repr=False)

    # ---- properties -------------------------------------------------------

    @property
    def widget(self) -> _Widget:
        return self._w

    def _next_shape_id(self, prefix: str = "shape") -> str:
        self._shape_id_counter += 1
        return f"{prefix}{self._shape_id_counter}"

    @property
    def _screen_ops(self) -> list[UiPaintOp]:
        return self._scene_state.screen_ops

    @property
    def _frame_ops(self) -> dict[str, list[UiPaintOp]]:
        return self._scene_state.frame_ops

    @property
    def _pending_ops(self) -> dict[int, list[UiPaintOp]]:
        return self._scene_state.pending_ops

    @property
    def _geom(self) -> dict[str, dict[str, Any]]:
        return self._scene_state.runtime_geom

    @property
    def _scene_objects(self) -> dict[tuple, Any]:
        return self._scene_state.scene_objects

    @property
    def _frame_refs(self) -> list[Any]:
        return self._scene_state.frame_refs

    @property
    def _screen_shape_roots(self) -> list[RectRef]:
        return self._scene_state.screen_shape_roots

    @property
    def _last_scene_cmd_count(self) -> int:
        return self._scene_state.last_scene_cmd_count

    @_last_scene_cmd_count.setter
    def _last_scene_cmd_count(self, value: int) -> None:
        self._scene_state.last_scene_cmd_count = int(value)

    @property
    def _last_frame(self) -> FrameRef | None:
        return self._scene_state.last_frame

    @_last_frame.setter
    def _last_frame(self, value: FrameRef | None) -> None:
        self._scene_state.last_frame = value

    def dumps(self) -> str:
        return self._screen.dumps()

    def display_payload(self) -> UiDisplayPayload:
        """Return the current browser/native display payload for this display."""
        plan = self._scene_state.build_sync_plan(
            command_count=len(self._screen._commands),
            has_scene_commands=bool(self._screen._commands),
        )
        return plan.payload

    def display_json(self) -> str:
        """Return the current ``vf-display.json`` body for this display."""
        return dumps_vf_display(self.display_payload())

    def widget_set(self, frame_id: str, widget_id: str, props: Any) -> None:
        self._screen.widget_set(frame_id, widget_id, props)

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

    def add_rect(self, rect: Any, *, color: Any = "#888888") -> RectRef:
        ref = RectRef(self, "rect", _rect_from_tuple(rect), color)
        self._scene_state.add_screen_shape_root(ref)
        self._sync_all()
        return ref

    def add_polygon(self, points: Any, *, color: Any = "#888888") -> RectRef:
        interaction = _default_polygon_interaction(self)
        ref = RectRef(
            self,
            "polygon",
            (0.0, 0.0, 1.0, 1.0),
            color,
            _points_from_seq(points),
            interaction,
            str(interaction["shape_id"]),
        )
        self._scene_state.add_screen_shape_root(ref)
        self._sync_all()
        return ref

    def get_rect(self, shape_id: Any) -> RectRef | None:
        wanted = str(_hover_object_id(shape_id))
        for shape in self._scene_state.screen_shape_roots:
            hit = shape.get_rect(wanted)
            if hit is not None:
                return hit
        frame = self._last_frame
        if frame is not None:
            return frame.get_rect(wanted)
        return None

    def get_vertex(self, hover: Any) -> VertexRef | None:
        frame = self._last_frame
        if frame is not None:
            return frame.get_vertex(hover)
        shape = self.get_rect(hover)
        if shape is None:
            return None
        vertex_id = _hover_value(hover, "vertex_id", -1)
        if vertex_id is None or int(vertex_id) < 0:
            return None
        return shape.vertex(int(vertex_id))

    def get_edge(self, hover: Any) -> EdgeRef | None:
        frame = self._last_frame
        if frame is not None:
            return frame.get_edge(hover)
        shape = self.get_rect(hover)
        if shape is None:
            return None
        edge_id = _hover_value(hover, "edge_id", -1)
        if edge_id is None or int(edge_id) < 0:
            return None
        return shape.edge(int(edge_id))

    def get(self, hover: Any) -> Any:
        frame = self._last_frame
        if frame is not None:
            return frame.get(hover)
        vertex = self.get_vertex(hover)
        if vertex is not None:
            return vertex
        edge = self.get_edge(hover)
        if edge is not None:
            return edge
        return self.get_rect(hover)

    def draw_rect(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        append_screen_paint_op(self._screen_ops, _make_paint_op("rect", z, color))
        self._sync_all()

    def add_oval(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        append_screen_paint_op(self._screen_ops, _make_paint_op("oval", z, color))
        self._sync_all()

    def add_oval_ref(self, rect: Any, *, color: str = "#888888") -> RectRef:
        ref = RectRef(self, "oval", _rect_from_tuple(rect), str(color))
        self._scene_state.add_screen_shape_root(ref)
        self._sync_all()
        return ref

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

    def add(self, **kwargs: Any) -> SceneFieldMesh:
        """Generic field mesh add using x_*/y_*/z_* channels over tijkuvw dims."""
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
        parent: SceneBox | None = None,
    ) -> SceneBox:
        data = _make_scene_mesh("box", center=center, scale=scale, color=color)
        obj = SceneBox(data, self, fid, parent=parent)
        install_scene_mesh_object(
            self._geom,
            self._scene_objects,
            frame_id=fid,
            mesh_payload=data,
            obj=obj,
        )
        self._sync_all()
        return obj

    def _add_ellipsoid(
        self,
        fid: str,
        *,
        center: Any,
        scale: Any,
        color: Any,
        parent: SceneBox | None = None,
    ) -> SceneBox:
        data = _make_scene_mesh("ellipsoid", center=center, scale=scale, color=color)
        obj = SceneBox(data, self, fid, parent=parent)
        install_scene_mesh_object(
            self._geom,
            self._scene_objects,
            frame_id=fid,
            mesh_payload=data,
            obj=obj,
        )
        self._sync_all()
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
        parent: SceneBox | None = None,
    ) -> SceneBox:
        data = _make_scene_mesh(
            "torus",
            center=center,
            scale=scale,
            color=color,
            major_radius=major_radius,
            minor_radius=minor_radius,
        )
        obj = SceneBox(data, self, fid, parent=parent)
        install_scene_mesh_object(
            self._geom,
            self._scene_objects,
            frame_id=fid,
            mesh_payload=data,
            obj=obj,
        )
        self._sync_all()
        return obj

    def _add_field_mesh(self, fid: str, *, parent: SceneBox | None = None, **kwargs: Any) -> SceneFieldMesh:
        data = _build_field_mesh_from_kwargs(kwargs)
        obj = SceneFieldMesh(data, self, fid, kwargs, parent=parent)
        install_scene_mesh_object(
            self._geom,
            self._scene_objects,
            frame_id=fid,
            mesh_payload=data,
            obj=obj,
        )
        self._sync_all()
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
        data = _make_scene_camera(pos=pos, target=target, fov=fov, up=up)
        install_scene_camera_payload(self._geom, frame_id=fid, camera_payload=data)
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
        m = normalize_scene_light_model(model, allowed_models=LIGHT_MODELS)
        data = _make_scene_light(pos=pos, model=m, color=color)
        install_scene_light_payload(self._geom, frame_id=fid, light_payload=data)
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
        return self._scene_state.resolve_scene_object(object_id)

    def get_frame(self, frame_id: str) -> Any:
        """Return the :class:`FrameRef` for a given ``frame_id``.

        Returns ``None`` if not found.
        """
        return self._scene_state.resolve_frame(frame_id)

    def _geom_for(self, fid: str) -> dict[str, Any]:
        return self._scene_state.ensure_runtime_scene(fid)

    def _last_placed_id(self, op: str) -> str:
        return self._scene_state.resolve_active_frame(op)

    # ---- add_frame --------------------------------------------------------

    def add_frame(
        self,
        first: Any,
        second: Any | None = None,
        **kwargs: Any,
    ) -> FrameRef:
        fr, pending = _unwrap_frame_ref(first)
        rect = None if pending is not None else _rect_from_tuple(first)
        plan = build_frame_add_plan(
            has_pending_ref=pending is not None,
            second=second,
            screen_kwargs=_coerce_frame_kw_for_screen(dict(kwargs)),
            rect=rect,
            has_last_frame=self._last_frame is not None,
            last_frame_placed=bool(self._last_frame is not None and self._last_frame._placed),
        )
        if plan.route == "pending_existing":
            assert pending is not None
            self._screen.add_frame(pending, plan.rect, **plan.screen_kwargs)
            if fr is not None:
                self._mark_frame_ref_placed(fr)
                self._sync_all()
                return fr
            out = FrameRef(self, pending)
            self._mark_frame_ref_placed(out)
            self._sync_all()
            return out

        if plan.should_create_pending_frame:
            frame_kwargs = plan.screen_kwargs or default_display_frame_kwargs()
            p = self._screen.frame(**frame_kwargs)
            self._last_frame = FrameRef(self, p)
        f = self._last_frame
        assert f is not None
        self._screen.add_frame(f._pending, plan.rect)
        self._mark_frame_ref_placed(f)
        self._sync_all()
        return f

    def _mark_frame_ref_placed(self, f: FrameRef) -> None:
        self._scene_state.mark_frame_ref_placed(f)

    def _append_frame_op(self, frame_id: str, op: UiPaintOp) -> None:
        self._scene_state.append_frame_op(frame_id, op)

    def _append_pending_frame_op(self, key: int, op: UiPaintOp) -> None:
        self._scene_state.append_pending_frame_op(key, op)

    # ---- sync -------------------------------------------------------------

    def _sync_all(self) -> None:
        cmd_count = len(self._screen._commands)
        plan = self._scene_state.build_sync_plan(
            command_count=cmd_count,
            has_scene_commands=bool(self._screen._commands),
            identity_transform=IDENTITY_AFFINE_2D,
        )
        if plan.should_write_scene_commands:
            _write_vkf_scene_to_vf_ui(self._screen._commands)
            self._scene_state.record_scene_command_sync(plan.next_scene_cmd_count)
        _write_vf_display_json(plan.payload)
        if plan.should_launch:
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


_display_assets_synced_once = False


class UISyncError(RuntimeError):
    """Raised when UI payload sync fails."""


def _write_vf_display_json(payload: UiDisplayPayload) -> None:
    global _display_assets_synced_once
    try:
        from vektorflow.ui.launch import find_vektorflow_repo_root
        from vektorflow.ui.launch import get_ui_mode
        root = find_vektorflow_repo_root()
        if root is None:
            raise UISyncError("Unable to locate the Vektor Flow repo root for UI sync.")
        plan = build_display_write_plan(
            payload,
            root=root,
            assets_synced_once=_display_assets_synced_once,
        )
        out = plan.display_output_path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(plan.display_text, encoding="utf-8")
        _sync_json_to_all_built_webs(root, plan.sync_filename, plan.display_text)
        # Static JS/CSS assets are large; syncing them every camera tick is costly.
        # Sync once per process (fresh process after code edits will resync).
        if plan.should_sync_assets:
            for f in plan.ui_asset_files:
                _copy_vf_ui_file_to_built_web(root, f)
            for geom_plan in plan.geom_asset_copy_plans:
                for dst in geom_plan.destination_paths:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    dst.write_bytes(geom_plan.source_path.read_bytes())
            _display_assets_synced_once = True

        manifest = build_host_bootstrap_manifest(launch_mode=get_ui_mode())
        manifest_text = write_host_manifest_text(manifest)
        write_host_bootstrap_manifest(root, manifest)
        _sync_json_to_all_built_webs(root, HOST_MANIFEST_FILENAME, manifest_text)
    except UISyncError:
        raise
    except (OSError, TypeError, ValueError) as exc:
        raise UISyncError(f"UI sync failed: {exc}") from exc


def build_ui_namespace() -> dict[str, Any]:
    return {"ui": UIRoot()}
