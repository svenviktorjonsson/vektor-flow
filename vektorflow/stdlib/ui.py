"""Stdlib ``ui`` — host UI: ``ui.display`` (``d.draw`` / ``f.draw`` = rects; stage vs frame), …

Implementation uses :mod:`vektorflow.stdlib.screen` (not a registered ``use`` name).
The ``bridge`` stdlib is also unregistered; see :mod:`vektorflow.stdlib.bridge` when needed.
"""

from __future__ import annotations

import json
import math
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

# ---------------------------------------------------------------------------
# Lighting models supported by vf-geom-wgpu.js
# ---------------------------------------------------------------------------
LIGHT_MODELS = {"flat", "lambert", "blinn_phong", "phong"}


def _rect_from_tuple(
    t: Any,
) -> tuple[float, float, float, float]:
    if isinstance(t, (list, tuple)) and len(t) == 4:
        return (float(t[0]), float(t[1]), float(t[2]), float(t[3]))
    raise TypeError("rect must be a 4-tuple (x, y, w, h) in normalized 0..1 coordinates")


def _vec3(v: Any, name: str = "vec") -> list[float]:
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        return [float(v[0]), float(v[1]), float(v[2])]
    raise TypeError(f"{name} must be [x, y, z]")


def _coerce_frame_kw_for_screen(kwargs: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        if isinstance(v, FrameRef):
            out[k] = v._pending
        else:
            out[k] = v
    return out


@dataclass
class UIMouse:
    """Input from the host pointer (active frame in host; events wired later). Placeholder."""

    __vf_py_attrs__ = True
    _doc = "ui.mouse (pointer); events use a visible frame in the host."


@dataclass
class UIKeyboard:
    """Keyboard from the host. Placeholder."""

    __vf_py_attrs__ = True
    _doc = "ui.keyboard; events use a visible frame in the host."


@dataclass
class FrameRef:
    """A panel from ``d.frame`` / :meth:`Display.Frame`; use :meth:`add_frame`, then :meth:`draw` or :meth:`draw_rect`."""

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

    def draw(self, rect: Any, *, color: str = "#888888") -> None:
        """Draw a filled rect in this frame (same as :meth:`draw_rect`)."""
        self.draw_rect(rect, color=color)

    def draw_rect(self, rect: Any, *, color: str = "#888888") -> None:
        z = _rect_from_tuple(rect)
        d = {"op": "rect", "rect": [z[0], z[1], z[2], z[3]], "color": str(color)}
        if self._placed and self._frame_id:
            self._display._append_frame_op(self._frame_id, d)
        else:
            self._display._append_pending_frame_op(self._pending_key, d)
        self._display._sync_all()

    # ------------------------------------------------------------------
    # 3-D drawing commands attached to a specific frame
    # ------------------------------------------------------------------

    def draw_box(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> None:
        """Draw a 3-D box (axis-aligned) inside this frame via WebGPU."""
        self._display._add_geom_drawable(
            self._get_placed_id(),
            {"type": "box",
             "center": _vec3(center or [0, 0, 0], "center"),
             "scale":  _vec3(scale  or [1, 1, 1], "scale"),
             "color":  str(color) if color is not None else None},
        )

    def add_camera(
        self,
        *,
        pos: Any,
        target: Any = None,
        fov: float = 45.0,
        up: Any = None,
    ) -> None:
        """Set the camera for this frame's 3-D scene."""
        self._display._set_geom_camera(
            self._get_placed_id(),
            {"pos":    _vec3(pos, "pos"),
             "target": _vec3(target or [0, 0, 0], "target"),
             "fov":    float(fov),
             "up":     _vec3(up or [0, 1, 0], "up")},
        )

    def add_light(
        self,
        *,
        pos: Any,
        model: str = "blinn_phong",
        color: Any = "white",
    ) -> None:
        """Add a light to this frame's 3-D scene."""
        m = str(model).lower().replace("-", "_")
        if m not in LIGHT_MODELS:
            raise ValueError(
                f"lighting model {model!r} unknown; use one of: {sorted(LIGHT_MODELS)}"
            )
        self._display._add_geom_light(
            self._get_placed_id(),
            {"pos": _vec3(pos, "pos"), "model": m, "color": str(color)},
        )

    def _get_placed_id(self) -> str:
        if self._placed and self._frame_id:
            return self._frame_id
        # not yet placed — use pending key as a temp id; resolved on place
        return f"__pending_{self._pending_key}"


@dataclass
class UIRoot:
    """``use(\\\"ui\\\")`` / ``:.ui`` — use ``ui.mouse``, ``ui.keyboard``, ``ui.display``."""

    __vf_py_attrs__ = True
    mouse: UIMouse = field(default_factory=UIMouse)
    keyboard: UIKeyboard = field(default_factory=UIKeyboard)
    display: "Display" = field(default_factory=lambda: Display())

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(
            f"ui has no attribute {name!r} (use ui.mouse, ui.keyboard, ui.display)"
        )


@dataclass
class Display:
    """``ui.display`` — windowed frames with 2-D rects and 3-D WebGPU geometry.

    2-D:
        ``d.draw_rect(rect, color=…)``  — filled rect on the frameless stage canvas.
        ``f.draw_rect(rect, color=…)``  — filled rect inside a frame.

    3-D (WebGPU, per-frame):
        ``d.draw_box(center, scale, color)``        — box attached to the *last placed* frame.
        ``d.add_camera(pos, target, fov, up)``      — camera for last placed frame.
        ``d.add_light(pos, model, color)``          — light  for last placed frame.
        ``f.draw_box(…) / f.add_camera(…) / f.add_light(…)``  — same, on a specific FrameRef.

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

    @property
    def widget(self) -> _Widget:
        return self._w

    def dumps(self) -> str:
        """Host scene JSON (``frame_upsert`` log)."""
        return self._screen.dumps()

    def widget_set(self, frame_id: str, widget_id: str, props: Any) -> None:
        self._screen.widget_set(frame_id, widget_id, props)

    def frame(self, **kwargs: Any) -> FrameRef:
        p = self._screen.frame(**kwargs)
        f = FrameRef(self, p)
        self._last_frame = f
        return f

    def draw(self, rect: Any, *, color: str = "#888888") -> None:
        self.draw_rect(rect, color=color)

    def draw_rect(self, rect: Any, *, color: str = "#888888") -> None:
        """Fill a rect on the frameless stage."""
        z = _rect_from_tuple(rect)
        self._screen_ops.append(
            {"op": "rect", "rect": [z[0], z[1], z[2], z[3]], "color": str(color)}
        )
        self._sync_all()

    def Frame(self) -> FrameRef:  # noqa: N802
        p = self._screen.frame(
            title="", draggable=True, dockable=True,
            resizable=True, closable=True, alpha=1.0, dock_loc="bl",
        )
        f = FrameRef(self, p)
        self._last_frame = f
        return f

    # ------------------------------------------------------------------
    # 3-D commands (convenience — operate on the *last placed* frame)
    # ------------------------------------------------------------------

    def draw_box(
        self,
        *,
        center: Any = None,
        scale: Any = None,
        color: Any = None,
    ) -> None:
        """Add a box drawable to the last placed frame."""
        fid = self._last_placed_id("draw_box")
        self._add_geom_drawable(
            fid,
            {"type": "box",
             "center": _vec3(center or [0, 0, 0], "center"),
             "scale":  _vec3(scale  or [1, 1, 1], "scale"),
             "color":  str(color) if color is not None else None},
        )

    def add_camera(
        self,
        *,
        pos: Any,
        target: Any = None,
        fov: float = 45.0,
        up: Any = None,
    ) -> None:
        """Set camera for the last placed frame.

        ``target`` overrides ``dir`` — pass the *look-at point*, not a direction vector.
        ``fov`` is in degrees (45° is a natural default; 30° is a tighter telephoto view).
        """
        fid = self._last_placed_id("add_camera")
        self._set_geom_camera(
            fid,
            {"pos":    _vec3(pos, "pos"),
             "target": _vec3(target or [0, 0, 0], "target"),
             "fov":    float(fov),
             "up":     _vec3(up or [0, 1, 0], "up")},
        )

    def add_light(
        self,
        *,
        pos: Any,
        model: str = "blinn_phong",
        color: Any = "white",
    ) -> None:
        """Add a light to the last placed frame.

        ``model`` must be one of: ``"flat"``, ``"lambert"``, ``"blinn_phong"``.
        """
        fid = self._last_placed_id("add_light")
        m = str(model).lower().replace("-", "_")
        if m not in LIGHT_MODELS:
            raise ValueError(
                f"lighting model {model!r} unknown; use one of: {sorted(LIGHT_MODELS)}"
            )
        self._add_geom_light(
            fid,
            {"pos": _vec3(pos, "pos"), "model": m, "color": str(color)},
        )

    # ------------------------------------------------------------------
    # Internal geom helpers
    # ------------------------------------------------------------------

    def _geom_for(self, fid: str) -> dict[str, Any]:
        if fid not in self._geom:
            self._geom[fid] = {"meshes": [], "camera": None, "lights": []}
        return self._geom[fid]

    def _add_geom_drawable(self, fid: str, drawable: dict[str, Any]) -> None:
        self._geom_for(fid)["meshes"].append(drawable)
        self._sync_all()

    def _set_geom_camera(self, fid: str, cam: dict[str, Any]) -> None:
        self._geom_for(fid)["camera"] = cam
        self._sync_all()

    def _add_geom_light(self, fid: str, light: dict[str, Any]) -> None:
        self._geom_for(fid)["lights"].append(light)
        self._sync_all()

    def _last_placed_id(self, op: str) -> str:
        if self._last_frame is not None and self._last_frame._placed:
            return self._last_frame._frame_id
        if self._last_frame is not None:
            return f"__pending_{self._last_frame._pending_key}"
        raise RuntimeError(
            f"d.{op}(): no frame has been placed yet — call d.add_frame(…) first"
        )

    # ------------------------------------------------------------------
    # add_frame
    # ------------------------------------------------------------------

    def add_frame(
        self,
        first: Any,
        second: Any | None = None,
        **kwargs: Any,
    ) -> None:
        """
        * ``d.add_frame((x, y, w, h))`` — place the most recent Frame (or create one) at this rect.
        * ``d.add_frame(f, (x, y, w, h) | null, under: g, …)`` — explicit FrameRef form.
        """
        fr, pending = _unwrap_frame_ref(first)
        if pending is not None:
            if second is not None or bool(kwargs):
                skw = _coerce_frame_kw_for_screen(dict(kwargs))
                self._screen.add_frame(pending, second, **skw)
                if fr is not None:
                    self._mark_frame_ref_placed(fr)
                self._sync_all()
                return
            raise TypeError(
                "add_frame: pass a rect or a layout option, "
                "or use d.add_frame((x,y,w,h)) for the short form"
            )
        t = _rect_from_tuple(first)
        if self._last_frame is None or self._last_frame._placed:
            p = self._screen.frame(
                title="", draggable=True, dockable=True,
                resizable=True, closable=True, alpha=1.0, dock_loc="bl",
            )
            self._last_frame = FrameRef(self, p)
        f = self._last_frame
        self._screen.add_frame(f._pending, (t[0], t[1], t[2], t[3]))
        self._mark_frame_ref_placed(f)
        self._sync_all()

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

    def _append_frame_op(self, frame_id: str, op: dict[str, Any]) -> None:
        self._frame_ops.setdefault(frame_id, []).append(op)

    def _append_pending_frame_op(self, key: int, op: dict[str, Any]) -> None:
        self._pending_ops.setdefault(key, []).append(op)

    def _sync_all(self) -> None:
        _write_vkf_scene_to_vf_ui(self._screen._commands)
        # filter out __pending_ keys from geom — only write placed frames
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
        if (
            self._screen._commands
            or self._screen_ops
            or self._frame_ops
            or self._pending_ops
            or self._geom
        ):
            from vektorflow.ui.launch import maybe_launch_vf_overlay

            maybe_launch_vf_overlay()


def _unwrap_frame_ref(
    a: Any,
) -> tuple[FrameRef | None, PendingFrame | None]:
    if isinstance(a, FrameRef):
        return a, a._pending
    if isinstance(a, PendingFrame):
        return None, a
    return None, None


def _write_vf_display_json(payload: dict[str, Any]) -> None:
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
        _copy_vf_ui_file_to_built_web(root, "vf-display.js")
        # also sync the geom JS files
        for js in ("vf-geom-core.js", "vf-geom-wgpu.js", "vf-geom-math.js", "vf-geom-mount.js"):
            _copy_geom_file_to_built_web(root, js)
    except (OSError, TypeError, ValueError):
        pass


def _copy_geom_file_to_built_web(root: Any, filename: str) -> None:
    """Sync a geom JS file from web/vf-ui/geom/ into any built web directories."""
    try:
        from vektorflow.stdlib.screen import _copy_vf_ui_file_to_built_web as _copy
        src = root / "web" / "vf-ui" / "geom" / filename
        if not src.is_file():
            return
        # sync to built web locations (same pattern as _copy_vf_ui_file_to_built_web)
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
