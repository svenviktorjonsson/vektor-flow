"""Stdlib ``ui`` — host UI: ``ui.display`` (``d.draw`` / ``f.draw`` = rects; stage vs frame), …

Implementation uses :mod:`vektorflow.stdlib.screen` (not a registered ``use`` name).
The ``bridge`` stdlib is also unregistered; see :mod:`vektorflow.stdlib.bridge` when needed.
"""

from __future__ import annotations

import json
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


def _rect_from_tuple(
    t: Any,
) -> tuple[float, float, float, float]:
    if isinstance(t, (list, tuple)) and len(t) == 4:
        return (float(t[0]), float(t[1]), float(t[2]), float(t[3]))
    raise TypeError("rect must be a 4-tuple (x, y, w, h) in normalized 0..1 coordinates")


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
    _pending_key: int = field(default=0, repr=False)  # id(self) before place

    def __post_init__(self) -> None:
        object.__setattr__(self, "_pending_key", id(self))

    @property
    def id(self) -> str:
        return self._pending.id

    def draw(
        self,
        rect: Any,
        *,
        color: str = "#888888",
    ) -> None:
        """Draw a filled rect in this frame (same as :meth:`draw_rect`)."""
        self.draw_rect(rect, color=color)

    def draw_rect(
        self,
        rect: Any,
        *,
        color: str = "#888888",
    ) -> None:
        z = _rect_from_tuple(rect)
        d = {
            "op": "rect",
            "rect": [z[0], z[1], z[2], z[3]],
            "color": str(color),
        }
        if self._placed and self._frame_id:
            self._display._append_frame_op(self._frame_id, d)
        else:
            self._display._append_pending_frame_op(self._pending_key, d)
        self._display._sync_all()


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
    """``ui.display`` — windowed frames; :meth:`draw` / :meth:`draw_rect` = frameless full surface; ``f.draw`` = in-frame."""

    __vf_py_attrs__ = True

    _screen: Screen = field(default_factory=Screen, repr=False)
    _w: _Widget = field(default_factory=_Widget, repr=False)
    _screen_ops: list[dict[str, Any]] = field(default_factory=list, repr=False)
    _frame_ops: dict[str, list[dict[str, Any]]] = field(default_factory=dict, repr=False)
    _pending_ops: dict[int, list[dict[str, Any]]] = field(default_factory=dict, repr=False)
    _last_frame: FrameRef | None = field(default=None, repr=False)

    @property
    def widget(self) -> _Widget:
        return self._w

    def dumps(self) -> str:
        """Host scene JSON (``frame_upsert`` log); same as the former ``s.dumps()`` on ``screen()``."""
        return self._screen.dumps()

    def widget_set(self, frame_id: str, widget_id: str, props: Any) -> None:
        """Live widget props (``vf-ui-state.json``); delegates to the internal :class:`~vektorflow.stdlib.screen.Screen`."""
        self._screen.widget_set(frame_id, widget_id, props)

    def frame(self, **kwargs: Any) -> FrameRef:
        """Create a pending panel. Pair with :meth:`add_frame` and :meth:`FrameRef.draw_rect`."""
        p = self._screen.frame(**kwargs)
        f = FrameRef(self, p)
        self._last_frame = f
        return f

    def draw(
        self,
        rect: Any,
        *,
        color: str = "#888888",
    ) -> None:
        """Fill a rect on the frameless full surface (under frames); same as :meth:`draw_rect`."""
        self.draw_rect(rect, color=color)

    def draw_rect(
        self,
        rect: Any,
        *,
        color: str = "#888888",
    ) -> None:
        """Fill a rect on the **frameless** stage (``vf-screen-canvas`` / ``screen`` in ``vf-display.json``)."""
        z = _rect_from_tuple(rect)
        self._screen_ops.append(
            {
                "op": "rect",
                "rect": [z[0], z[1], z[2], z[3]],
                "color": str(color),
            }
        )
        self._sync_all()

    def Frame(self) -> FrameRef:  # noqa: N802
        """Create a panel for ``d.add_frame((x,y,w,h))`` and :meth:`FrameRef.draw_rect` (default chrome)."""
        p = self._screen.frame(
            title="",
            draggable=True,
            dockable=True,
            resizable=True,
            closable=True,
            alpha=1.0,
            dock_loc="bl",
        )
        f = FrameRef(self, p)
        self._last_frame = f
        return f

    def add_frame(  # noqa: PLR0911
        self,
        first: Any,
        second: Any | None = None,
        **kwargs: Any,
    ) -> None:
        """
        * ``d.add_frame((x, y, w, h))`` — place the most recent :meth:`Frame` (or create one) at this rect.
        * ``d.add_frame(f, (x, y, w, h) | null, under: g, body: …, …)`` — same as the old
          ``s.add_frame`` (``f`` and layout refs can be :class:`FrameRef` or :class:`PendingFrame`).
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
                "add_frame: pass a rect or a layout option (e.g. under: other_frame), or use d.add_frame((x,y,w,h)) for the short form"
            )
        t = _rect_from_tuple(first)
        if self._last_frame is None or self._last_frame._placed:
            p = self._screen.frame(
                title="",
                draggable=True,
                dockable=True,
                resizable=True,
                closable=True,
                alpha=1.0,
                dock_loc="bl",
            )
            self._last_frame = FrameRef(self, p)
        f = self._last_frame
        r = (t[0], t[1], t[2], t[3])
        self._screen.add_frame(f._pending, r)
        self._mark_frame_ref_placed(f)
        self._sync_all()

    def _mark_frame_ref_placed(self, f: FrameRef) -> None:
        f._placed = True
        f._frame_id = str(f._pending.id)
        k = f._pending_key
        if k in self._pending_ops:
            ops = self._pending_ops.pop(k)
            self._frame_ops[f._frame_id] = self._frame_ops.get(f._frame_id, []) + ops
        self._last_frame = f

    def _append_frame_op(self, frame_id: str, op: dict[str, Any]) -> None:
        self._frame_ops.setdefault(frame_id, []).append(op)

    def _append_pending_frame_op(self, key: int, op: dict[str, Any]) -> None:
        self._pending_ops.setdefault(key, []).append(op)

    def _sync_all(self) -> None:
        _write_vkf_scene_to_vf_ui(self._screen._commands)
        _write_vf_display_json(
            {
                "screen": list(self._screen_ops),
                "frames": {k: list(v) for k, v in self._frame_ops.items()},
            }
        )
        if (
            self._screen._commands
            or self._screen_ops
            or self._frame_ops
            or self._pending_ops
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
    except (OSError, TypeError, ValueError):
        pass


def build_ui_namespace() -> dict[str, Any]:
    return {"ui": UIRoot()}
