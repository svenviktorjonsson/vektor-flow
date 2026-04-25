"""vektorflow.stdlib.events — input event bus.

Polls the vf-overlay HTTP server for ``vf_event`` messages posted by the
JS front-end (mouse / keyboard).  Events are dispatched to registered
Python callbacks.

Usage (VKF):
    :.ui
    cam : d.add_camera(pos:[4,3,5])

    ui.mouse.on_event( fn(e) => ... )
    ui.keyboard.on_down( fn(e) => ... )

    loop:
        ui.poll()   # drain the event queue, fire callbacks

The event dict ``e`` has:
    type        "vf_event"
    event       "move" | "hover" | "down" | "up" | "wheel" | "key_down" | "key_up"
    x, y        canvas-relative float coords (for mouse events)
    frame_id    str
    object_id   int (0 = no object; 1..N = scene object index)
    simplex_id  int (face / prim index in that object; 0 = not available)
    button      int (0=left 1=mid 2=right, for down/up)
    step        int (-1 / +1, for wheel)
    key         str (key name, for keyboard events)
"""

from __future__ import annotations

import json
import threading
import time
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Event code system (integers only)
# ---------------------------------------------------------------------------

# Low 12 bits: base event kind id.
_BASE_MASK = 0xFFF
# Next 10 bits: frame index.
_FRAME_SHIFT = 12
_FRAME_MASK = 0x3FF
# Next 8 bits: widget index (derived from widget id).
_WIDGET_SHIFT = 22
_WIDGET_MASK = 0xFF
# Top 2 bits: pattern mode.
_MODE_SHIFT = 30
_MODE_MASK = 0x3

_MODE_EXACT = 0
_MODE_UI = 1
_MODE_FRAME = 2
_MODE_WIDGET = 3


EVENT_NAME_TO_BASE: dict[str, int] = {
    "move": 1,
    "hover": 2,
    "down": 3,
    "up": 4,
    "wheel": 5,
    "drag": 6,
    "key_down": 7,
    "key_up": 8,
    "frame.closed": 20,
    "button.pressed": 21,
    "checkbox.toggled": 22,
    "slider.value_changed": 23,
    "input_field.text_changed": 24,
    "input_field.text_entered": 25,
    "dropdown.item_changed": 26,
    "text_area.text_changed": 27,
}

EVENT_CONST_TO_NAME: dict[str, str] = {
    "MOUSE_MOVE": "move",
    "MOUSE_HOVER": "hover",
    "MOUSE_DOWN": "down",
    "MOUSE_UP": "up",
    "MOUSE_WHEEL": "wheel",
    "MOUSE_DRAG": "drag",
    "KEY_DOWN": "key_down",
    "KEY_UP": "key_up",
    "FRAME_CLOSED": "frame.closed",
    "BUTTON_PRESSED": "button.pressed",
    "CHECKBOX_TOGGLED": "checkbox.toggled",
    "SLIDER_VALUE_CHANGED": "slider.value_changed",
    "INPUT_FIELD_TEXT_CHANGED": "input_field.text_changed",
    "INPUT_FIELD_TEXT_ENTERED": "input_field.text_entered",
    "DROPDOWN_ITEM_CHANGED": "dropdown.item_changed",
    "TEXT_AREA_TEXT_CHANGED": "text_area.text_changed",
}

WIDGET_TYPE_EVENT_CONSTS: dict[str, tuple[str, ...]] = {
    "button": ("BUTTON_PRESSED",),
    "checkbox": ("CHECKBOX_TOGGLED",),
    "slider": ("SLIDER_VALUE_CHANGED",),
    "input": ("INPUT_FIELD_TEXT_CHANGED", "INPUT_FIELD_TEXT_ENTERED"),
    "dropdown": ("DROPDOWN_ITEM_CHANGED",),
    "textarea": ("TEXT_AREA_TEXT_CHANGED",),
}


def _frame_index(frame_id: str) -> int:
    s = str(frame_id or "").strip()
    if len(s) >= 2 and s[0] == "f" and s[1:].isdigit():
        i = int(s[1:])
        if i < 0:
            return 0
        return i & _FRAME_MASK
    return 0


def _widget_index(widget_id: str) -> int:
    s = str(widget_id or "")
    if not s:
        return 0
    acc = 0
    for i, ch in enumerate(s):
        acc += (i + 1) * ord(ch)
    return (acc % _WIDGET_MASK) + 1


def _base_code(event_name: str) -> int:
    return int(EVENT_NAME_TO_BASE.get(str(event_name), 0))


def encode_event_code(event_name: str, frame_id: str = "", widget_id: str = "") -> int:
    """Exact event code: includes kind + frame index + widget index."""
    b = _base_code(event_name) & _BASE_MASK
    f = _frame_index(frame_id) & _FRAME_MASK
    w = _widget_index(widget_id) & _WIDGET_MASK
    return (_MODE_EXACT << _MODE_SHIFT) | b | (f << _FRAME_SHIFT) | (w << _WIDGET_SHIFT)


def encode_ui_pattern(event_name: str) -> int:
    """Pattern matching any frame/widget for this event kind."""
    b = _base_code(event_name) & _BASE_MASK
    return (_MODE_UI << _MODE_SHIFT) | b


def encode_frame_pattern(event_name: str, frame_id: str) -> int:
    """Pattern matching this event kind in one frame (any widget in that frame)."""
    b = _base_code(event_name) & _BASE_MASK
    f = _frame_index(frame_id) & _FRAME_MASK
    return (_MODE_FRAME << _MODE_SHIFT) | b | (f << _FRAME_SHIFT)


def encode_widget_pattern(event_name: str, widget_id: str) -> int:
    """Pattern matching this event kind for one widget id (across frames)."""
    b = _base_code(event_name) & _BASE_MASK
    w = _widget_index(widget_id) & _WIDGET_MASK
    return (_MODE_WIDGET << _MODE_SHIFT) | b | (w << _WIDGET_SHIFT)


def matches_event_code(exact_code: int, pattern_code: int) -> bool:
    """Compare an exact event code against a pattern or exact code (both integers)."""
    if not isinstance(exact_code, int) or not isinstance(pattern_code, int):
        return False
    pmode = (pattern_code >> _MODE_SHIFT) & _MODE_MASK
    if pmode == _MODE_EXACT:
        return exact_code == pattern_code
    if pmode == _MODE_UI:
        return (exact_code & _BASE_MASK) == (pattern_code & _BASE_MASK)
    if pmode == _MODE_FRAME:
        em = exact_code & (_BASE_MASK | (_FRAME_MASK << _FRAME_SHIFT))
        pm = pattern_code & (_BASE_MASK | (_FRAME_MASK << _FRAME_SHIFT))
        return em == pm
    if pmode == _MODE_WIDGET:
        em = exact_code & (_BASE_MASK | (_WIDGET_MASK << _WIDGET_SHIFT))
        pm = pattern_code & (_BASE_MASK | (_WIDGET_MASK << _WIDGET_SHIFT))
        return em == pm
    return False


def event_match_specificity(exact_code: int, pattern_code: int) -> int | None:
    """Return match specificity (0..3) for event-code matching, or ``None`` if no match.

    Specificity order:
      3: exact
      2: widget-pattern
      1: frame-pattern
      0: ui-pattern
    """
    if not isinstance(exact_code, int) or not isinstance(pattern_code, int):
        return None
    pmode = (pattern_code >> _MODE_SHIFT) & _MODE_MASK
    if pmode == _MODE_EXACT:
        return 3 if exact_code == pattern_code else None
    if pmode == _MODE_UI:
        return 0 if ((exact_code & _BASE_MASK) == (pattern_code & _BASE_MASK)) else None
    if pmode == _MODE_FRAME:
        em = exact_code & (_BASE_MASK | (_FRAME_MASK << _FRAME_SHIFT))
        pm = pattern_code & (_BASE_MASK | (_FRAME_MASK << _FRAME_SHIFT))
        return 1 if em == pm else None
    if pmode == _MODE_WIDGET:
        em = exact_code & (_BASE_MASK | (_WIDGET_MASK << _WIDGET_SHIFT))
        pm = pattern_code & (_BASE_MASK | (_WIDGET_MASK << _WIDGET_SHIFT))
        return 2 if em == pm else None
    return None


# ---------------------------------------------------------------------------
# Port discovery
# ---------------------------------------------------------------------------

def _read_port_file() -> int:
    """Read vf-api-port.txt written by vf-overlay.exe next to the executable."""
    try:
        from vektorflow.ui.launch import find_vektorflow_repo_root, find_vf_overlay_exe
        root = find_vektorflow_repo_root()
        if root is None:
            return 0
        exe = find_vf_overlay_exe(root)
        if exe is None:
            return 0
        port_file = exe.parent / "web" / "vf-api-port.txt"
        if port_file.is_file():
            txt = port_file.read_text(encoding="utf-8").strip()
            return int(txt) if txt.isdigit() else 0
    except Exception:
        pass
    return 0


_discovered_port: int = 0
_port_lock = threading.Lock()


def get_overlay_port() -> int:
    """Return the HTTP port of the running vf-overlay, or 0 if not found."""
    global _discovered_port
    with _port_lock:
        if _discovered_port:
            return _discovered_port
        p = _read_port_file()
        if p:
            _discovered_port = p
        return _discovered_port


def reset_overlay_port() -> None:
    """Force re-discovery of the port (e.g. after restarting the overlay)."""
    global _discovered_port
    with _port_lock:
        _discovered_port = 0


# ---------------------------------------------------------------------------
# Low-level HTTP poller
# ---------------------------------------------------------------------------

_POP_URL_TEMPLATE = "http://127.0.0.1:{port}/api/pop"
_POLL_INTERVAL    = 0.01   # 10 ms between polls (lower input latency)
_MAX_DRAIN        = 80     # drain bursts faster (touchpad/wheel can spike)


class OverlayPoller:
    """Background thread that drains ``/api/pop`` and routes events by type.

    ``on_event`` subscribers receive every parsed JSON dict.
    """

    def __init__(self) -> None:
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> None:
        self._subs.append(fn)

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="vf-event-poller"
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(timeout=_POLL_INTERVAL)
            if self._stop.is_set():
                break
            self._drain_once()

    def _drain_once(self) -> None:
        port = get_overlay_port()
        if not port:
            return
        url = _POP_URL_TEMPLATE.format(port=port)
        for _ in range(_MAX_DRAIN):
            try:
                with urllib.request.urlopen(url, timeout=0.12) as resp:
                    raw = resp.read()
                outer = json.loads(raw)
                line = outer.get("line")
                if line is None:
                    break  # queue empty
                # line is a JSON string inside
                if isinstance(line, str):
                    try:
                        evt = json.loads(line)
                    except Exception:
                        evt = {"type": "raw", "raw": line}
                elif isinstance(line, dict):
                    evt = line
                else:
                    continue
                for sub in self._subs:
                    try:
                        sub(evt)
                    except Exception:
                        pass
            except Exception:
                break


# Process-global poller (started lazily)
_global_poller: OverlayPoller | None = None
_poller_lock = threading.Lock()


def get_global_poller() -> OverlayPoller:
    global _global_poller
    with _poller_lock:
        if _global_poller is None:
            _global_poller = OverlayPoller()
        return _global_poller


def start_event_poller() -> OverlayPoller:
    p = get_global_poller()
    p.start()
    return p


# ---------------------------------------------------------------------------
# Event descriptors
# ---------------------------------------------------------------------------

@dataclass
class MouseEvent:
    """A mouse event received from the overlay."""

    __vf_py_attrs__ = True

    event:      str             # "move" | "hover" | "down" | "up" | "wheel"
    x:          float           # canvas CSS pixels, left=0
    y:          float           # canvas CSS pixels, top=0
    frame_id:   str    = ""
    object_id:  int    = 0      # 0 = no object
    simplex_id: int    = 0      # primitive index (face/edge/vert)
    button:     int    = -1     # 0=left 1=mid 2=right (-1 = N/A)
    buttons:    int    = 0      # bitmask from MouseEvent.buttons (for hover/drag state)
    ctrl:       bool   = False
    shift:      bool   = False
    alt:        bool   = False
    meta:       bool   = False
    step:       int    = 0      # ±1 for wheel
    delta:      float  = 0.0    # raw wheel deltaY (platform/browser units)
    dx:         float  = 0.0    # drag delta x (for synthetic "drag" events)
    dy:         float  = 0.0    # drag delta y (for synthetic "drag" events)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MouseEvent":
        ev = str(d.get("event", ""))
        return cls(
            event      = ev,
            x          = float(d.get("x", 0)),
            y          = float(d.get("y", 0)),
            frame_id   = str(d.get("frame_id", "")),
            object_id  = int(d.get("object_id", 0)),
            simplex_id = int(d.get("simplex_id", 0)),
            button     = int(d.get("button", -1)),
            buttons    = int(d.get("buttons", 0)),
            ctrl       = bool(d.get("ctrl", False)),
            shift      = bool(d.get("shift", False)),
            alt        = bool(d.get("alt", False)),
            meta       = bool(d.get("meta", False)),
            step       = int(d.get("step", 0)),
            delta      = float(d.get("delta", 0.0)),
            dx         = float(d.get("dx", 0.0)),
            dy         = float(d.get("dy", 0.0)),
        )

    def __repr__(self) -> str:
        parts = [f"event={self.event!r}", f"x={self.x:.1f}", f"y={self.y:.1f}"]
        if self.frame_id:   parts.append(f"frame={self.frame_id!r}")
        if self.object_id:  parts.append(f"obj={self.object_id}")
        if self.button >= 0: parts.append(f"btn={self.button}")
        if self.step:       parts.append(f"step={self.step:+d}")
        return "MouseEvent(" + ", ".join(parts) + ")"

    @property
    def type(self) -> str:
        """Alias for event kind (dispatch-friendly)."""
        return self.event


@dataclass
class KeyEvent:
    """A keyboard event received from the overlay."""

    __vf_py_attrs__ = True

    event:    str   # "key_down" | "key_up"
    key:      str   # key name (e.g. "ArrowLeft", "a", "Enter")
    code:     str = ""
    ctrl:     bool = False
    shift:    bool = False
    alt:      bool = False
    frame_id: str  = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "KeyEvent":
        ev = str(d.get("event", ""))
        return cls(
            event    = ev,
            key      = str(d.get("key", "")),
            code     = str(d.get("code", "")),
            ctrl     = bool(d.get("ctrl", False)),
            shift    = bool(d.get("shift", False)),
            alt      = bool(d.get("alt", False)),
            frame_id = str(d.get("frame_id", "")),
        )

    def __repr__(self) -> str:
        mods = "".join(
            k for k, v in [("C-", self.ctrl), ("S-", self.shift), ("A-", self.alt)] if v
        )
        return f"KeyEvent(event={self.event!r}, key={mods + self.key!r})"

    @property
    def type(self) -> str:
        """Alias for event kind (dispatch-friendly)."""
        return self.event


# ---------------------------------------------------------------------------
# UIMouse / UIKeyboard
# ---------------------------------------------------------------------------

class UIMouse:
    """``ui.mouse`` — register callbacks for mouse events; call ``ui.poll()`` to fire them.

    Callbacks receive a :class:`MouseEvent`.

    Example::

        ui.mouse.on_hover(lambda e: print("hover", e.x, e.y, e.object_id))
        ui.mouse.on_down(lambda e: print("click", e.button, e.object_id))
        ui.mouse.on_wheel(lambda e: cam.translate([0, 0, e.step * 0.5]))

    All callbacks are fired from ``ui.poll()`` on the calling thread (never from a background thread).
    """

    __vf_py_attrs__ = True

    def __init__(self) -> None:
        self._event_cbs: list[Callable]  = []
        self._hover_cbs: list[Callable]  = []
        self._move_cbs:  list[Callable]  = []
        self._down_cbs:  list[Callable]  = []
        self._up_cbs:    list[Callable]  = []
        self._wheel_cbs: list[Callable]  = []
        self._drag_cbs:  list[Callable]  = []
        self._queue: deque[MouseEvent]   = deque()
        self._last_x: float = 0.0
        self._last_y: float = 0.0

    # -- registration ---------------------------------------------------------

    def on_hover(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for mouse move / hover events."""
        self._hover_cbs.append(fn)

    def on_event(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for all mouse events."""
        self._event_cbs.append(fn)

    def on_move(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for mouse move events."""
        self._move_cbs.append(fn)

    def on_down(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for mouse button down events."""
        self._down_cbs.append(fn)

    def on_up(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for mouse button up events."""
        self._up_cbs.append(fn)

    def on_wheel(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for scroll wheel events."""
        self._wheel_cbs.append(fn)

    def on_drag(self, fn: Callable[[MouseEvent], None]) -> None:
        """Register a callback for drag events (event='drag', with dx/dy)."""
        self._drag_cbs.append(fn)

    # -- dispatch (called by OverlayPoller background thread) ----------------

    def _push(self, evt: dict[str, Any]) -> None:
        """Called from the poller thread; thread-safe enqueue."""
        me = MouseEvent.from_dict(evt)
        self._last_x = me.x
        self._last_y = me.y
        self._queue.append(me)

    def pop(self) -> MouseEvent | None:
        """Pop one queued mouse event, or ``None`` when queue is empty."""
        if self._queue:
            return self._queue.popleft()
        return None

    # -- poll (called from VKF loop) -----------------------------------------

    def poll(self) -> None:
        """Drain queued events and fire registered callbacks. Call this from your loop."""
        while self._queue:
            me = self._queue.popleft()
            for cb in self._event_cbs:
                try:
                    cb(me)
                except Exception:
                    pass
            if me.event in ("hover", "move"):
                cbs = self._hover_cbs + self._move_cbs
            else:
                cbs = {
                    "down":  self._down_cbs,
                    "up":    self._up_cbs,
                    "wheel": self._wheel_cbs,
                    "drag":  self._drag_cbs,
                }.get(me.event, [])
            for cb in cbs:
                try:
                    cb(me)
                except Exception:
                    pass

    # -- latest state (convenience) ------------------------------------------

    @property
    def pos(self) -> tuple[float, float]:
        """Most recent (x, y) position. Returns (0, 0) until first mouse event."""
        return (self._last_x, self._last_y)

    @property
    def position(self) -> dict[str, float]:
        """Most recent mouse position as a record ``(x:..., y:...)``."""
        return {"x": self._last_x, "y": self._last_y}

    def __repr__(self) -> str:
        return (f"UIMouse(event={len(self._event_cbs)} cbs, "
                f"hover={len(self._hover_cbs)} cbs, "
                f"down={len(self._down_cbs)} cbs, "
                f"up={len(self._up_cbs)} cbs, "
                f"wheel={len(self._wheel_cbs)} cbs, "
                f"drag={len(self._drag_cbs)} cbs, "
                f"move={len(self._move_cbs)} cbs)")


class UIKeyboard:
    """``ui.keyboard`` — register callbacks for keyboard events; call ``ui.poll()`` to fire them.

    Callbacks receive a :class:`KeyEvent`.

    Example::

        ui.keyboard.on_down(lambda e: print("key", e.key))
    """

    __vf_py_attrs__ = True

    _KEY_TO_MOD = {
        "Control": "ctrl",
        "Shift": "shift",
        "Alt": "alt",
        "Meta": "meta",
    }
    _CODE_TO_MOD = {
        "ControlLeft": "ctrl",
        "ControlRight": "ctrl",
        "ShiftLeft": "shift",
        "ShiftRight": "shift",
        "AltLeft": "alt",
        "AltRight": "alt",
        "MetaLeft": "meta",
        "MetaRight": "meta",
        "OSLeft": "meta",
        "OSRight": "meta",
    }

    def __init__(self) -> None:
        self._down_cbs: list[Callable] = []
        self._up_cbs:   list[Callable] = []
        self._queue: deque[KeyEvent]   = deque()
        self._modifiers: dict[str, bool] = {
            "ctrl": False,
            "shift": False,
            "alt": False,
            "meta": False,
        }

    def on_down(self, fn: Callable[[KeyEvent], None]) -> None:
        """Register a callback for key down events."""
        self._down_cbs.append(fn)

    def on_up(self, fn: Callable[[KeyEvent], None]) -> None:
        """Register a callback for key up events."""
        self._up_cbs.append(fn)

    @property
    def modifiers(self) -> dict[str, bool]:
        """Current modifier-key state snapshot."""
        return dict(self._modifiers)

    def _observe_modifiers(self, evt: dict[str, Any]) -> None:
        """Update modifier snapshot from any incoming event payload."""
        for k in ("ctrl", "shift", "alt", "meta"):
            if k in evt:
                self._modifiers[k] = bool(evt.get(k, False))

    def _modifier_name(self, ke: KeyEvent) -> str | None:
        m = self._KEY_TO_MOD.get(ke.key)
        if m is not None:
            return m
        return self._CODE_TO_MOD.get(ke.code)

    def _push(self, evt: dict[str, Any]) -> None:
        self._observe_modifiers(evt)
        ke = KeyEvent.from_dict(evt)
        mod = self._modifier_name(ke)
        if mod is not None:
            # Keep state up-to-date, but do not emit standalone modifier events.
            self._modifiers[mod] = (ke.event == "key_down")
            return
        self._queue.append(ke)

    def pop(self) -> KeyEvent | None:
        """Pop one queued keyboard event, or ``None`` when queue is empty."""
        if self._queue:
            return self._queue.popleft()
        return None

    def poll(self) -> None:
        """Drain queued events and fire registered callbacks."""
        while self._queue:
            ke = self._queue.popleft()
            cbs = self._down_cbs if ke.event == "key_down" else self._up_cbs
            for cb in cbs:
                try:
                    cb(ke)
                except Exception:
                    pass

    def __repr__(self) -> str:
        return (
            "UIKeyboard("
            f"down={len(self._down_cbs)} cbs, "
            f"up={len(self._up_cbs)} cbs, "
            f"modifiers={self._modifiers})"
        )
