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
    step:       int    = 0      # ±1 for wheel
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
            step       = int(d.get("step", 0)),
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
        """Most recent (x, y) position. Returns (0, 0) until first hover."""
        if self._queue:
            last = self._queue[-1]
            return (last.x, last.y)
        return (0.0, 0.0)

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

    def __init__(self) -> None:
        self._down_cbs: list[Callable] = []
        self._up_cbs:   list[Callable] = []
        self._queue: deque[KeyEvent]   = deque()

    def on_down(self, fn: Callable[[KeyEvent], None]) -> None:
        """Register a callback for key down events."""
        self._down_cbs.append(fn)

    def on_up(self, fn: Callable[[KeyEvent], None]) -> None:
        """Register a callback for key up events."""
        self._up_cbs.append(fn)

    def _push(self, evt: dict[str, Any]) -> None:
        self._queue.append(KeyEvent.from_dict(evt))

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
        return f"UIKeyboard(down={len(self._down_cbs)} cbs, up={len(self._up_cbs)} cbs)"
