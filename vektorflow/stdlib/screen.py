"""Host scene / frame model. Not a registered stdlib (no ``use(\\\"screen\\\")``) — use ``ui.display``."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from vektorflow.ui.ir import (
    DockLocation,
    FrameFlags,
    FrameSpec,
    NormRect,
    TitleAlign,
    UiCommand,
    dumps_scene,
    parse_dock_location,
)
from vektorflow.ui.payloads import (
    publish_widget_append_patch,
)
from vektorflow.ui.scene_runtime import (
    append_frame_upsert,
    dump_scene_commands,
    sync_scene_commands,
    sync_ui_state,
)
from vektorflow.runtime.vflist import VFLinkedList
from vektorflow.runtime.vfvector import VFVector
from .events import (
    EVENT_CONST_TO_NAME,
    WIDGET_TYPE_EVENT_CONSTS,
    encode_widget_pattern,
)


def _resolve_title_and_align(
    *,
    title: str,
    name: str,
    title__: str | None,
    __title: str | None,
) -> tuple[str, TitleAlign]:
    """
    Title alignment: ``title`` = center, ``__title`` = right, ``title__`` = left.
    A single ``_`` can appear in the string at the start/end; use the double-underscore
    *parameter* names to choose alignment. If only ``name`` is set (no ``title``), text is
    left-aligned.
    """
    if title__ is not None:
        return str(title__), "left"
    if __title is not None:
        return str(__title), "right"
    cap = str(title).strip()
    if cap:
        return cap, "center"
    cap = str(name).strip()
    if cap:
        return cap, "left"
    return "", "left"


def _coerce_body(body: Any) -> list[dict[str, Any]] | None:
    """Normalize ``body`` to a list of widget dicts for :class:`FrameSpec`."""
    if body is None:
        return None
    if isinstance(body, (VFVector, list, tuple)):
        return [_as_widget_node(x) for x in body]
    if isinstance(body, VFLinkedList):
        return [_as_widget_node(x) for x in body]
    if isinstance(body, dict):
        return [_as_widget_node(body)]
    raise TypeError("body must be a vector, tuple, collections list, or a single widget dict")


def _as_widget_node(x: Any) -> dict[str, Any]:
    if not isinstance(x, dict):
        raise TypeError("each body node must be a map/dict of widget properties")
    if "id" not in x or "type" not in x:
        raise ValueError("each widget must have 'id' and 'type'")
    return dict(x)


def _attach_widget_event_consts(node: dict[str, Any]) -> dict[str, Any]:
    """Attach widget-scoped integer constants, e.g. ``btn.BUTTON_PRESSED``."""
    wid = str(node.get("id", ""))
    typ = str(node.get("type", ""))
    for const_name in WIDGET_TYPE_EVENT_CONSTS.get(typ, ()):
        ev_name = EVENT_CONST_TO_NAME.get(const_name)
        if ev_name is None:
            continue
        node[const_name] = encode_widget_pattern(ev_name, wid)
    return node


def _widget_props(x: Any) -> dict[str, Any]:
    if isinstance(x, dict):
        return dict(x)
    from vektorflow.runtime.vmap import VMap

    if isinstance(x, VMap):
        return dict(x._d)
    raise TypeError("widget props must be a map or struct dict")


def _normalize_grid_slot(slot: Any) -> list[int]:
    if not isinstance(slot, (VFVector, list, tuple)) or len(slot) != 4:
        raise TypeError("grid must be a 4-tuple (row, col, row_span, col_span)")
    vals = [int(slot[0]), int(slot[1]), int(slot[2]), int(slot[3])]
    if vals[0] < 0 or vals[1] < 0:
        raise ValueError("grid row and col must be >= 0")
    if vals[2] <= 0 or vals[3] <= 0:
        raise ValueError("grid row_span and col_span must be > 0")
    return vals


def _apply_widget_meta(node: dict[str, Any], *, grid: Any = None) -> dict[str, Any]:
    out = dict(node)
    if grid is not None:
        out["grid"] = _normalize_grid_slot(grid)
    return out


def _normalize_grid_layout(value: Any) -> dict[str, Any]:
    if not isinstance(value, (VFVector, list, tuple)) or len(value) != 2:
        raise TypeError("gridlayout must be a 2-tuple (rows, cols)")
    rows = int(value[0])
    cols = int(value[1])
    if rows <= 0 or cols <= 0:
        raise ValueError("gridlayout rows and cols must be > 0")
    return {"type": "grid", "rows": rows, "cols": cols}


@dataclass
class _Widget:
    __vf_py_attrs__ = True

    def label(self, id: str, text: str = "", **kwargs: Any) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"label() got unexpected keyword argument(s): {bad}")
        return _attach_widget_event_consts(
            _apply_widget_meta({"id": str(id), "type": "label", "text": str(text)}, grid=grid)
        )

    def button(self, id: str, label: str = "", **kwargs: Any) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"button() got unexpected keyword argument(s): {bad}")
        return _attach_widget_event_consts(
            _apply_widget_meta({"id": str(id), "type": "button", "label": str(label)}, grid=grid)
        )

    def checkbox(
        self, id: str, checked: bool = False, label: str = "", **kwargs: Any
    ) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"checkbox() got unexpected keyword argument(s): {bad}")
        return _attach_widget_event_consts(
            _apply_widget_meta({
                "id": str(id),
                "type": "checkbox",
                "checked": bool(checked),
                "label": str(label),
            }, grid=grid)
        )

    def slider(
        self,
        id: str,
        *,
        value: float = 0.0,
        vmin: float = 0.0,
        vmax: float = 1.0,
        step: float = 0.01,
        **kwargs: Any,
    ) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"slider() got unexpected keyword argument(s): {bad}")
        return _attach_widget_event_consts(
            _apply_widget_meta({
                "id": str(id),
                "type": "slider",
                "value": float(value),
                "min": float(vmin),
                "max": float(vmax),
                "step": float(step),
            }, grid=grid)
        )

    def input_field(self, id: str, text: str = "", placeholder: str = "", **kwargs: Any) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"input_field() got unexpected keyword argument(s): {bad}")
        return _attach_widget_event_consts(
            _apply_widget_meta({
                "id": str(id),
                "type": "input",
                "text": str(text),
                "placeholder": str(placeholder),
            }, grid=grid)
        )

    def text_area(
        self,
        id: str,
        text: str = "",
        *,
        rows: int | None = None,
        readonly: bool = False,
        **kwargs: Any,
    ) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"text_area() got unexpected keyword argument(s): {bad}")
        spec: dict[str, Any] = {"id": str(id), "type": "textarea", "text": str(text)}
        if rows is not None:
            spec["rows"] = int(rows)
        if readonly:
            spec["readonly"] = True
        return _attach_widget_event_consts(
            _apply_widget_meta(spec, grid=grid)
        )

    def dropdown(
        self, id: str, options: Any | None = None, *, value: int = 0, **kwargs: Any
    ) -> dict[str, Any]:
        grid = kwargs.pop("grid", None)
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"dropdown() got unexpected keyword argument(s): {bad}")
        opts: list[str] = []
        if options is not None:
            if isinstance(options, (VFVector, list, tuple)):
                opts = [str(x) for x in options]
            elif isinstance(options, VFLinkedList):
                opts = [str(x) for x in options]
            else:
                raise TypeError("dropdown options must be a vector, tuple, or collections.list")
        return _attach_widget_event_consts(
            _apply_widget_meta({"id": str(id), "type": "dropdown", "options": opts, "value": int(value)}, grid=grid)
        )


@dataclass
class PendingFrame:
    """Frame chrome and style before placement on a :class:`Screen`."""

    __vf_py_attrs__ = True

    title: str = ""
    title_align: TitleAlign = "left"
    alpha: float = 1.0
    master: bool = False
    dock_location: DockLocation = "bl"
    anchor: DockLocation = "tl"
    flags: FrameFlags = field(default_factory=FrameFlags)
    body_layout: dict[str, Any] | None = None
    # Set by :meth:`Screen.add_frame` after a frame is placed (for relative layout).
    _placed_id: str | None = field(default=None, repr=False, compare=False)
    _placed_rect: NormRect | None = field(default=None, repr=False, compare=False)

    @property
    def id(self) -> str:
        """Host frame id (e.g. ``f1``) after :meth:`Screen.add_frame`; empty before placement."""
        return self._placed_id or ""


class Screen:
    """Collects :class:`UiCommand` values (e.g. ``frame_upsert``) for a host."""

    __vf_py_attrs__ = True

    def __init__(self) -> None:
        self._commands: list[UiCommand] = []
        self._next_id = 0
        # ``frame_id`` -> ``widget_id`` -> props — merged in ``web/vf-ui/vf-ui-state.json`` for live updates.
        self._ui_state: dict[str, dict[str, dict[str, Any]]] = {}
        self._widget_append_seq = 0

    def _alloc_id(self) -> str:
        self._next_id += 1
        return f"f{self._next_id}"

    def frame(
        self,
        *,
        title: str = "",
        name: str = "",
        title__: str | None = None,
        draggable: bool = True,
        dockable: bool = True,
        resizable: bool = True,
        closable: bool = True,
        use_browser: bool = True,
        alpha: float = 1.0,
        master: bool = False,
        dock_location: str = "bl",
        dock_loc: str | None = None,
        anchor: str = "tl",
        gridlayout: Any = None,
        grid_layout: Any = None,
        **kwargs: Any,
    ) -> PendingFrame:
        """``__title=...`` (right-aligned) is taken from ``**kwargs`` (valid Python keyword at call site). ``dock_loc`` overrides ``dock_location`` when set."""
        r_title = kwargs.pop("__title", None)  # type: ignore[misc]
        if kwargs:
            bad = ", ".join(sorted(repr(k) for k in kwargs))
            raise TypeError(f"frame() got unexpected keyword argument(s): {bad}")
        loc_str = str(dock_loc) if dock_loc is not None else str(dock_location)
        cap, align = _resolve_title_and_align(
            title=title,
            name=name,
            title__=title__,
            __title=r_title if r_title is not None else None,
        )
        return PendingFrame(
            title=cap,
            title_align=align,
            alpha=float(alpha),
            master=bool(master),
            dock_location=parse_dock_location(loc_str),
            anchor=parse_dock_location(str(anchor)),
            body_layout=(
                _normalize_grid_layout(gridlayout if gridlayout is not None else grid_layout)
                if (gridlayout is not None or grid_layout is not None)
                else None
            ),
            flags=FrameFlags(
                draggable=bool(draggable),
                dockable=bool(dockable),
                resizable=bool(resizable),
                closable=bool(closable),
                use_browser=bool(use_browser),
            ),
        )

    def add_frame(
        self,
        pending: PendingFrame,
        rect: Any | None = None,
        *,
        write_files: bool = True,
        body: Any = None,
        in_frame: PendingFrame | None = None,
        under: PendingFrame | None = None,
        over: PendingFrame | None = None,
        right_of: PendingFrame | None = None,
        left_of: PendingFrame | None = None,
        after: PendingFrame | None = None,
        before: PendingFrame | None = None,
        gap: float = 0.01,
    ) -> None:
        """Place *pending* in normalized coordinates (initial layout only; each frame
        is moved and docked independently at runtime, except the ``master`` rule below).

        *body* is an optional list of widget maps (``widget.label``, ``widget.button``,
        …) rendered inside the frame. Live updates: :meth:`widget_set` writes
        ``vf-ui-state.json`` for the WebView to merge.
        Set ``in_frame`` to place this frame inside another frame's body; then ``rect``
        is normalized to that parent frame's local coordinates.

        When several frames share a dock corner (e.g. ``bl``), minimized strips stack
        on that edge as separate bars — they are not laid out as one horizontal row.

        Pass ``rect`` as ``(x, y, w, h)`` **or** exactly one of ``under`` / ``over`` /
        ``right_of`` / ``left_of`` (``after`` = ``right_of``, ``before`` = ``left_of``)
        to position relative to a frame that was already added with :meth:`add_frame`.
        Relative placement uses the **same** ``w`` and ``h`` as the reference (only
        position changes, never size). How ``under`` / ``over`` / ``right_of`` /
        ``left_of`` map to the plane depends on the **new** frame’s
        ``dock_location`` / ``dock_loc`` (each frame is separately dockable):

        * **Top** (``tl``, ``tc``, ``tr``): ``under`` = below (+y), ``over`` = above.
        * **Bottom** (``bl``, ``bc``, ``br``): ``under`` = toward the bottom edge, i.e.
          the new frame is **above** the reference (-y); ``over`` the opposite.
        * **Left strip** (``cl``): ``under`` / ``right_of`` = to the right (+x);
          ``over`` / ``left_of`` = to the left.
        * **Right strip** (``cr``): ``under`` / ``left_of`` = to the left (-x, toward
          center); ``over`` / ``right_of`` = to the right.

        For ``bc``, ``tc``, ``cl``, ``cr`` the new rect is also aligned on the **center
        line** in the orthogonal direction (x centered for ``bc``/``tc``, y centered
        for ``cl``/``cr``).

        **Master:** if ``pending.master`` is true, closing that frame in the host UI
        closes every other frame first, then exits; non-master frames close only
        themselves.
        """
        if pending._placed_id is not None:
            raise RuntimeError("add_frame: this frame was already placed; create a new s.frame()")
        r_ref = right_of
        l_ref = left_of
        if after is not None and right_of is not None and after is not right_of:
            raise TypeError("add_frame: specify at most one of right_of and after")
        if after is not None:
            r_ref = after
        if before is not None and left_of is not None and before is not left_of:
            raise TypeError("add_frame: specify at most one of left_of and before")
        if before is not None:
            l_ref = before

        layout = [
            n
            for n, v in (
                ("under", under),
                ("over", over),
                ("right_of", r_ref),
                ("left_of", l_ref),
            )
            if v is not None
        ]
        if rect is not None and layout:
            raise TypeError("add_frame: pass either a rect (x, y, w, h) or a layout keyword, not both")
        if rect is None and len(layout) != 1:
            if len(layout) == 0:
                raise TypeError(
                    "add_frame: pass rect (x, y, w, h) or one of under, over, right_of, left_of, after, before"
                )
            raise TypeError(
                f"add_frame: at most one layout keyword allowed; got {', '.join(layout)}"
            )
        if rect is not None:
            xs = _coerce_norm_rect(rect)
        else:
            if under is not None:
                ref, kind = under, "under"
            elif over is not None:
                ref, kind = over, "over"
            elif r_ref is not None:
                ref, kind = r_ref, "right"
            else:
                ref, kind = l_ref, "left"
            xs = _rect_beside(ref, kind, float(gap), pending)

        xs.validate()
        parent_id: str | None = None
        if in_frame is not None:
            if not isinstance(in_frame, PendingFrame):
                raise TypeError("add_frame: in_frame must be a frame returned by s.frame()")
            if in_frame._placed_id is None:
                raise RuntimeError("add_frame: in_frame must already be placed via add_frame")
            parent_id = in_frame._placed_id
        body_list = _coerce_body(body)
        body_tuple = tuple(body_list) if body_list is not None else None
        fid = self._alloc_id()
        spec = FrameSpec(
            id=fid,
            title=pending.title,
            title_align=pending.title_align,
            rect=xs,
            flags=pending.flags,
            alpha=pending.alpha,
            master=pending.master,
            dock_location=pending.dock_location,
            anchor=pending.anchor,
            body=body_tuple,
            body_layout=dict(pending.body_layout) if pending.body_layout is not None else None,
            parent_id=parent_id,
        )
        append_frame_upsert(self._commands, frame_id=fid, spec=spec)
        pending._placed_id = fid
        pending._placed_rect = xs
        if write_files:
            _write_vkf_scene_to_vf_ui(self._commands)
            _write_vf_ui_state_to_vf_ui(self._ui_state)

    def dumps(self) -> str:
        """JSON scene log for debugging / host bridge."""
        return dump_scene_commands(self._commands)

    def widget_set(self, frame_id: str, widget_id: str, props: Any) -> None:
        """Merge *props* into the live UI state (``web/vf-ui/vf-ui-state.json``) for one widget."""
        d = _widget_props(props)
        by_f = self._ui_state.get(str(frame_id))
        if by_f is None:
            by_f = {}
            self._ui_state[str(frame_id)] = by_f
        cur = by_f.get(str(widget_id), {})
        merged = {**cur, **d}
        by_f[str(widget_id)] = merged
        _write_vf_ui_state_to_vf_ui(self._ui_state)

    def widget_set_text(self, frame_id: str, widget_id: str, text: Any) -> None:
        """Set the live text value for one widget without requiring a map literal."""
        self.widget_set(frame_id, widget_id, {"text": str(text)})

    def widget_append_text(self, frame_id: str, widget_id: str, text: Any) -> None:
        """Append text to a live text widget once, without replaying it on every state poll."""
        frame_key = str(frame_id)
        widget_key = str(widget_id)
        by_f = self._ui_state.get(frame_key)
        if by_f is None:
            by_f = {}
            self._ui_state[frame_key] = by_f
        cur = dict(by_f.get(widget_key, {}))
        cur_text = str(cur.get("text", ""))
        append_text = str(text)
        self._widget_append_seq += 1
        publish_widget_append_patch(
            frame_key,
            widget_key,
            append_text,
            append_seq=int(self._widget_append_seq),
        )
        self.widget_set(
            frame_key,
            widget_key,
            {
                "text": cur_text + append_text,
                "append_text": append_text,
                "append_seq": int(self._widget_append_seq),
            },
        )


def _sync_json_to_all_built_webs(root: Path, filename: str, text: str) -> None:
    """Write ``filename`` into each ``.../VfOverlay/build/**/web/`` that has ``vkf-scene.html`` (Release/Debug)."""
    for rel in (
        Path("native") / "VfOverlay" / "build" / "Release" / "web",
        Path("native") / "VfOverlay" / "build" / "Debug" / "web",
        Path("native") / "VfOverlay" / "build" / "x64" / "Release" / "web",
        Path("native") / "VfOverlay" / "build" / "x64" / "Debug" / "web",
    ):
        d = (root / rel).resolve()
        if d.is_dir() and (d / "vkf-scene.html").is_file():
            try:
                (d / filename).write_text(text, encoding="utf-8")
            except OSError:
                pass


def _copy_vf_ui_file_to_built_web(root: Path, src_rel: str) -> None:
    """Copy one file from ``web/vf-ui/`` to ``<vf-overlay.exe>/web/`` so a stale build still loads widgets.

    CMake copies ``web/vf-ui`` at link time; if ``vf-widgets.js`` was added later or the tree was
    not rebuilt, the WebView 404s the script, ``VfWidgets`` is undefined, and only frame chrome
    appears (no body controls).

    For ``vkf-scene.html`` the version stamps on all ``<script src="...?v=NNN">`` tags are
    rewritten to the current Unix timestamp so WebView2 never serves stale cached JS.
    """
    import shutil
    import re as _re
    import time as _time

    from vektorflow.ui.launch import find_vf_overlay_exe

    src = root / "web" / "vf-ui" / src_rel
    if not src.is_file():
        return
    exe = find_vf_overlay_exe(root)
    if exe is None:
        return
    dest = exe.parent / "web" / src_rel
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if src_rel == "vkf-scene.html":
            # Stamp a fresh version so WebView2 cache-busts all JS on each launch
            v = str(int(_time.time()))
            text = src.read_text(encoding="utf-8", errors="replace")
            text = _re.sub(r'\?v=\d+', '?v=' + v, text)
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dest)
    except OSError:
        pass


def _write_vkf_scene_to_vf_ui(commands: list[UiCommand]) -> None:
    """Write scene JSON for the active UI session (and mirror latest to root for compatibility)."""
    try:
        root = None
        text = sync_scene_commands(commands)
        from vektorflow.ui.launch import find_vektorflow_repo_root

        root = find_vektorflow_repo_root()
        if root is None:
            return
        _copy_vf_ui_file_to_built_web(root, "vf-widgets.js")
    except OSError:
        pass


def _write_vf_ui_state_to_vf_ui(state: dict[str, dict[str, dict[str, Any]]]) -> None:
    """Per-widget props overlay for ``vf-widgets.js`` (sliders, labels, text fields)."""
    try:
        sync_ui_state(state)
    except (OSError, TypeError, ValueError):
        pass


def _coerce_norm_rect(rect: Any) -> NormRect:
    if isinstance(rect, (VFVector, list, tuple)) and len(rect) == 4:
        x, y, w, h = (float(rect[i]) for i in range(4))
        r = NormRect(x=x, y=y, w=w, h=h)
        r.validate()
        return r
    raise TypeError(
        "rect must be a 4-tuple or vector of numbers (x, y, w, h) in normalized coords"
    )


def _rel_step(
    dock: DockLocation, kind: str
) -> tuple[int, int]:
    """Unit direction for one stack step. ``kind``: ``under``|``over``|``right``|``left``."""
    if kind not in ("under", "over", "right", "left"):
        raise ValueError(f"invalid layout kind: {kind!r}")
    if kind == "right":
        return (1, 0)
    if kind == "left":
        return (-1, 0)
    if kind == "over":
        ux, uy = _rel_step(dock, "under")
        return (-ux, -uy)
    # under
    if dock in ("tl", "tc", "tr"):
        return (0, 1)
    if dock in ("bl", "bc", "br"):
        return (0, -1)
    if dock == "cl":
        return (1, 0)
    if dock == "cr":
        return (-1, 0)
    raise ValueError(f"invalid dock: {dock!r}")


def _apply_dock_edge_center(pending: PendingFrame, r: NormRect) -> NormRect:
    """``bc``/``tc``: center in x; ``cl``/``cr``: center in y (orthogonal to dock bar)."""
    d = pending.dock_location
    w, h = r.w, r.h
    if d in ("bc", "tc"):
        return NormRect(x=0.5 * (1.0 - w), y=r.y, w=w, h=h)
    if d in ("cl", "cr"):
        return NormRect(x=r.x, y=0.5 * (1.0 - h), w=w, h=h)
    return r


def _rect_beside(
    ref: PendingFrame, kind: str, gap: float, pending: PendingFrame
) -> NormRect:
    """Place *pending* with same *w*/*h* as *ref*; position from *ref* and *pending*'s dock."""
    pr = ref._placed_rect
    if pr is None:
        raise RuntimeError(
            "add_frame: reference frame was not placed yet; call add_frame on it first"
        )
    x, y, w, h = pr.x, pr.y, pr.w, pr.h
    sx, sy = _rel_step(pending.dock_location, kind)
    nx = x + sx * (w + gap)
    ny = y + sy * (h + gap)
    r = NormRect(x=nx, y=ny, w=w, h=h)
    return _apply_dock_edge_center(pending, r)


def build_screen_namespace() -> dict[str, Any]:
    def screen() -> Screen:
        return Screen()

    return {"screen": screen, "widget": _Widget()}
