"""Stdlib ``ui`` — host UI: ``ui.display`` (``d.draw`` / ``f.draw`` = rects; stage vs frame), …

Implementation uses :mod:`vektorflow.stdlib.screen` (not a registered ``use`` name).
The ``bridge`` stdlib is also unregistered; see :mod:`vektorflow.stdlib.bridge` when needed.
"""

from __future__ import annotations

import json
import math
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
    EVENT_NAME_TO_BASE,
    EVENT_CONST_TO_NAME,
    encode_event_code,
    encode_ui_pattern,
    encode_frame_pattern,
    encode_widget_pattern,
    start_event_poller, get_global_poller,
)

# ---------------------------------------------------------------------------
# Lighting models supported by vf-geom-wgpu.js
# ---------------------------------------------------------------------------
LIGHT_MODELS = {"flat", "lambert", "blinn_phong", "phong"}

# Animation tick rate (frames per second written to vf-display.json)
_ANIM_FPS = 60


# ---------------------------------------------------------------------------
# Low-level math helpers
# ---------------------------------------------------------------------------

def _vec3(v: Any, name: str = "vec") -> list[float]:
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return [float(v[0]), float(v[1]), float(v[2])]
    raise TypeError(f"{name} must be [x, y, z]")


def _rect_from_tuple(t: Any) -> tuple[float, float, float, float]:
    if isinstance(t, (list, tuple)) and len(t) == 4:
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
                self.rotate_by(omega * dt, ax)
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
        d = _vec3(delta, "delta")
        p = self._data["pos"]
        self._data["pos"] = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
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
                t0 = time.monotonic()
                p = self._data["pos"]
                p2 = _rotate_vec3_around_axis(p, ax, omega * dt)
                self._data["pos"] = p2
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
class FrameRef:
    """A panel from ``d.frame`` / :meth:`Display.Frame`; use :meth:`add_frame`, then draw commands."""

    __vf_py_attrs__ = True

    _display: "Display"
    _pending: PendingFrame
    _placed: bool = field(default=False, repr=False)
    _frame_id: str = field(default="", repr=False)
    _pending_key: int = field(default=0, repr=False)

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
            payload["code"] = code
            payload["ui_code"] = ui_code
            payload["frame_code"] = frame_code
            payload["widget_code"] = widget_code
            payload["index"] = idx

            t = evt.get("type")
            if t != "vf_event":
                # Non-vf_event UI host events (e.g. frame.closed, widget events)
                self._event_queue.append(payload)
                return
            if ev_name in ("move", "hover", "down", "up", "wheel", "drag"):
                self.keyboard._observe_modifiers(evt)
                self.cursor._push(evt)
                self._event_queue.append(payload)
            elif ev_name in ("key_down", "key_up"):
                ke = KeyEvent.from_dict(evt)
                is_modifier = self.keyboard._modifier_name(ke) is not None
                self.keyboard._push(evt)
                if not is_modifier:
                    self._event_queue.append(payload)
        p = get_global_poller()
        p.subscribe(_dispatch)

    def _ensure_poller(self) -> None:
        if not self._poller_started:
            object.__setattr__(self, "_poller_started", True)
            start_event_poller()

    def next_event(self) -> Any:
        """Return one pending queued event, or ``None`` when no event is queued."""
        self._ensure_poller()
        if self._event_queue:
            return self._event_queue.popleft()
        return None

    def poll(self) -> None:
        """Drain queued events and fire registered mouse/keyboard callbacks."""
        self._ensure_poller()
        self.cursor.poll()
        self.keyboard.poll()

    @property
    def widgets(self) -> _Widget:
        """Widget factory namespace (preferred over ``d.widget``): ``ui.widgets.button(...)``."""
        return self.display.widget


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
    _screen_ops: list[dict[str, Any]] = field(default_factory=list, repr=False)
    _frame_ops: dict[str, list[dict[str, Any]]] = field(default_factory=dict, repr=False)
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

    # ---- properties -------------------------------------------------------

    @property
    def widget(self) -> _Widget:
        return self._w

    def dumps(self) -> str:
        return self._screen.dumps()

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
                self._screen.add_frame(pending, second, **skw)
                if fr is not None:
                    self._mark_frame_ref_placed(fr)
                self._sync_all()
                if fr is not None:
                    return fr
                out = FrameRef(self, pending)
                self._mark_frame_ref_placed(out)
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
        self._screen.add_frame(f._pending, (t[0], t[1], t[2], t[3]))
        self._mark_frame_ref_placed(f)
        self._sync_all()
        return f

    def _mark_frame_ref_placed(self, f: FrameRef) -> None:
        old_key = f._pending_key
        f._placed = True
        f._frame_id = str(f._pending.id)
        # migrate pending 2-D ops
        if old_key in self._pending_ops:
            ops = self._pending_ops.pop(old_key)
            self._frame_ops[f._frame_id] = self._frame_ops.get(f._frame_id, []) + ops
        # migrate pending geom ops
        pending_geom_key = f"__pending_{old_key}"
        if pending_geom_key in self._geom:
            geom_data = self._geom.pop(pending_geom_key)
            existing = self._geom.get(f._frame_id, {"meshes": [], "camera": None, "lights": []})
            existing["meshes"].extend(geom_data["meshes"])
            if geom_data["camera"] is not None:
                existing["camera"] = geom_data["camera"]
            existing["lights"].extend(geom_data["lights"])
            self._geom[f._frame_id] = existing
        self._last_frame = f
        if f not in self._frame_refs:
            self._frame_refs.append(f)

    def _append_frame_op(self, frame_id: str, op: dict[str, Any]) -> None:
        self._frame_ops.setdefault(frame_id, []).append(op)

    def _append_pending_frame_op(self, key: int, op: dict[str, Any]) -> None:
        self._pending_ops.setdefault(key, []).append(op)

    # ---- sync -------------------------------------------------------------

    def _sync_all(self) -> None:
        cmd_count = len(self._screen._commands)
        if cmd_count != self._last_scene_cmd_count:
            _write_vkf_scene_to_vf_ui(self._screen._commands)
            self._last_scene_cmd_count = cmd_count
        placed_geom = {
            fid: g for fid, g in self._geom.items()
            if not fid.startswith("__pending_")
        }
        _write_vf_display_json(
            {
                "screen": list(self._screen_ops),
                "frames": {k: list(v) for k, v in self._frame_ops.items()},
                "geom":   placed_geom,
            }
        )
        # Launch UI only when there is placed/visible content.
        # Pending frame ops/geom should not auto-open the host.
        if self._screen._commands or self._screen_ops or self._frame_ops or placed_geom:
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


def _write_vf_display_json(payload: dict[str, Any]) -> None:
    global _display_assets_synced_once
    try:
        from vektorflow.ui.launch import find_vektorflow_repo_root
        root = find_vektorflow_repo_root()
        if root is None:
            return
        text = json.dumps(payload, indent=2) + "\n"
        out = root / "web" / "vf-ui" / "vf-display.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        _sync_json_to_all_built_webs(root, "vf-display.json", text)
        # Static JS/CSS assets are large; syncing them every camera tick is costly.
        # Sync once per process (fresh process after code edits will resync).
        if not _display_assets_synced_once:
            for f in ("vf-display.js", "vkf-scene.html", "vf-frame.js", "vf-frame.css", "vf-widgets.js"):
                _copy_vf_ui_file_to_built_web(root, f)
            for js in ("vf-geom-core.js", "vf-geom-wgpu.js", "vf-geom-math.js", "vf-geom-mount.js"):
                _copy_geom_file_to_built_web(root, js)
            _display_assets_synced_once = True
    except (OSError, TypeError, ValueError):
        pass


def _copy_geom_file_to_built_web(root: Any, filename: str) -> None:
    try:
        src = root / "web" / "vf-ui" / "geom" / filename
        if not src.is_file():
            return
        for built in (root / "native" / "VfOverlay").rglob("vf-ui"):
            dst = built / "geom" / filename
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(src.read_bytes())
            except OSError:
                pass
    except Exception:
        pass


def build_ui_namespace() -> dict[str, Any]:
    return {"ui": UIRoot()}
