"""vektorflow.stdlib.events — input event types plus callback compatibility helpers.

Polls the vf-overlay runtime packet API for ``input.event`` payloads posted by
the JS/native front-end. The authoritative interaction seam is the normalized
event queue exposed by ``ui.events.get()`` / ``ui.next_event()``. Mouse and
keyboard callback helpers remain available as compatibility adapters on top of
that queue.

Usage (VKF):
    :.ui
    cam : d.add_camera(pos:[4,3,5])

    ui.mouse.on_event( fn(e) => ... )
    ui.keyboard.on_down( fn(e) => ... )

    loop:
        e : ui.events.get()
        e ? handle(e)

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

from collections import deque
from dataclasses import dataclass
from typing import Any, Callable
from vektorflow.ui.event_ingress import (
    OverlayPoller,
    get_global_poller,
    get_overlay_port,
    publish_ui_event_payload,
    reset_global_poller,
    reset_overlay_port,
    start_event_poller as _start_event_poller,
)

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
    "frame.docked": 28,
    "frame.dragged": 29,
    "frame.resized": 30,
    "button.pressed": 21,
    "checkbox.toggled": 22,
    "slider.value_changed": 23,
    "input_field.text_changed": 24,
    "input_field.text_entered": 25,
    "dropdown.item_changed": 26,
    "text_area.text_changed": 27,
    "combobox.text_changed": 28,
    "combobox.text_entered": 29,
    "combobox.item_changed": 30,
    "color_picker.value_changed": 31,
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
    "FRAME_DOCKED": "frame.docked",
    "FRAME_DRAGGED": "frame.dragged",
    "FRAME_RESIZED": "frame.resized",
    "BUTTON_PRESSED": "button.pressed",
    "CHECKBOX_TOGGLED": "checkbox.toggled",
    "SLIDER_VALUE_CHANGED": "slider.value_changed",
    "INPUT_FIELD_TEXT_CHANGED": "input_field.text_changed",
    "INPUT_FIELD_TEXT_ENTERED": "input_field.text_entered",
    "DROPDOWN_ITEM_CHANGED": "dropdown.item_changed",
    "TEXT_AREA_TEXT_CHANGED": "text_area.text_changed",
    "COMBOBOX_TEXT_CHANGED": "combobox.text_changed",
    "COMBOBOX_TEXT_ENTERED": "combobox.text_entered",
    "COMBOBOX_ITEM_CHANGED": "combobox.item_changed",
    "COLOR_PICKER_VALUE_CHANGED": "color_picker.value_changed",
}

WIDGET_TYPE_EVENT_CONSTS: dict[str, tuple[str, ...]] = {
    "button": ("BUTTON_PRESSED",),
    "checkbox": ("CHECKBOX_TOGGLED",),
    "slider": ("SLIDER_VALUE_CHANGED",),
    "input": ("INPUT_FIELD_TEXT_CHANGED", "INPUT_FIELD_TEXT_ENTERED"),
    "dropdown": ("DROPDOWN_ITEM_CHANGED",),
    "textarea": ("TEXT_AREA_TEXT_CHANGED",),
    "combobox": ("COMBOBOX_TEXT_CHANGED", "COMBOBOX_TEXT_ENTERED", "COMBOBOX_ITEM_CHANGED"),
    "color_picker": ("COLOR_PICKER_VALUE_CHANGED",),
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


def _event_codes_from_payload(d: dict[str, Any]) -> tuple[int, int, int, int]:
    """Return exact/ui/frame/widget codes, synthesizing them when omitted."""
    ev_name = str(d.get("event", ""))
    frame_id = str(d.get("frame_id", d.get("frameId", "")) or "")
    widget_id = str(d.get("widget_id", d.get("widgetId", "")) or "")
    base = _base_code(ev_name)
    exact = int(d.get("event_code", 0) or 0)
    ui = int(d.get("ui_code", 0) or 0)
    frame = int(d.get("frame_code", 0) or 0)
    widget = int(d.get("widget_code", 0) or 0)
    if base:
        if exact == 0:
            exact = encode_event_code(ev_name, frame_id=frame_id, widget_id=widget_id)
        if ui == 0:
            ui = encode_ui_pattern(ev_name)
        if frame == 0 and frame_id:
            frame = encode_frame_pattern(ev_name, frame_id)
        if widget == 0 and widget_id:
            widget = encode_widget_pattern(ev_name, widget_id)
    return exact, ui, frame, widget


def drain_overlay_events(max_events: int = 512) -> int:
    """Compatibility no-op retained while old startup call sites disappear."""
    _ = max_events
    return 0

def start_event_poller() -> OverlayPoller:
    drain_overlay_events()
    return _start_event_poller()


# ---------------------------------------------------------------------------
# Event descriptors
# ---------------------------------------------------------------------------

@dataclass
class MouseEvent:
    """A mouse event received from the overlay."""

    __vf_py_attrs__ = True
    __vf_event_type_name__ = "MouseEvent"

    event:      str             # "move" | "hover" | "down" | "up" | "wheel"
    x:          float           # canvas CSS pixels, left=0
    y:          float           # canvas CSS pixels, top=0
    frame_id:   str    = ""
    widget_id:  str    = ""
    object_id:  int    = 0      # 0 = no object
    simplex_id: int    = 0      # primitive index (face/edge/vert)
    event_code: int    = 0
    ui_code:    int    = 0
    frame_code: int    = 0
    widget_code:int    = 0
    index:      int    = 0
    pick_id:    int    = 0
    pick_mask_representation: int = 0
    pick_mask_carrier: int = 0
    pick_mask_content: int = 0
    pick_mask_exact: int = 0
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
    dx_norm:    float  = 0.0    # drag delta x normalized to the frame width
    dy_norm:    float  = 0.0    # drag delta y normalized to the frame height
    width:      float  = 0.0
    height:     float  = 0.0
    key:        str    = ""
    code:       str    = ""
    dock:       str    = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MouseEvent":
        ev = str(d.get("event", ""))
        event_code, ui_code, frame_code, widget_code = _event_codes_from_payload(d)
        event_cls = cls if cls is not MouseEvent else _MOUSE_EVENT_CLASS_BY_NAME.get(ev, MouseEvent)
        return event_cls(
            event      = ev,
            x          = float(d.get("x", 0)),
            y          = float(d.get("y", 0)),
            frame_id   = str(d.get("frame_id", d.get("frameId", "")) or ""),
            widget_id  = str(d.get("widget_id", d.get("widgetId", "")) or ""),
            object_id  = int(d.get("object_id", 0)),
            simplex_id = int(d.get("simplex_id", 0)),
            event_code = event_code,
            ui_code    = ui_code,
            frame_code = frame_code,
            widget_code= widget_code,
            index      = int(d.get("index", 0)),
            pick_id    = int(d.get("pick_id", 0)),
            pick_mask_representation = int(d.get("pick_mask_representation", 0)),
            pick_mask_carrier = int(d.get("pick_mask_carrier", 0)),
            pick_mask_content = int(d.get("pick_mask_content", 0)),
            pick_mask_exact = int(d.get("pick_mask_exact", 0)),
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
            dx_norm    = float(d.get("dx_norm", 0.0)),
            dy_norm    = float(d.get("dy_norm", 0.0)),
            width      = float(d.get("width", 0.0)),
            height     = float(d.get("height", 0.0)),
            key        = str(d.get("key", "")),
            code       = str(d.get("code", "")),
            dock       = str(d.get("dock", d.get("dock_location", "")) or ""),
        )

    def __repr__(self) -> str:
        parts = [f"event={self.event!r}", f"x={self.x:.1f}", f"y={self.y:.1f}"]
        if self.frame_id:   parts.append(f"frame={self.frame_id!r}")
        if self.object_id:  parts.append(f"obj={self.object_id}")
        if self.pick_id:    parts.append(f"pick={self.pick_id}")
        if self.button >= 0: parts.append(f"btn={self.button}")
        if self.step:       parts.append(f"step={self.step:+d}")
        return "MouseEvent(" + ", ".join(parts) + ")"

    @property
    def type(self) -> str:
        """Alias for event kind (dispatch-friendly)."""
        return self.event


class MouseMove(MouseEvent):
    __vf_event_type_name__ = "MouseMove"


class MouseHover(MouseEvent):
    __vf_event_type_name__ = "MouseHover"


class MouseDown(MouseEvent):
    __vf_event_type_name__ = "MouseDown"


class MouseUp(MouseEvent):
    __vf_event_type_name__ = "MouseUp"


class MouseWheel(MouseEvent):
    __vf_event_type_name__ = "MouseWheel"


class MouseDrag(MouseEvent):
    __vf_event_type_name__ = "MouseDrag"


@dataclass
class TouchEvent(MouseEvent):
    __vf_event_type_name__ = "TouchEvent"


@dataclass
class FrameEvent:
    """A host frame lifecycle/layout event."""

    __vf_py_attrs__ = True
    __vf_event_type_name__ = "FrameEvent"

    event: str
    frame_id: str = ""
    widget_id: str = ""
    event_code: int = 0
    ui_code: int = 0
    frame_code: int = 0
    widget_code: int = 0
    index: int = 0
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0
    button: int = -1
    key: str = ""
    code: str = ""
    pick_id: int = 0
    object_id: int = 0
    simplex_id: int = 0
    dock: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "FrameEvent":
        ev = str(d.get("event", ""))
        event_code, ui_code, frame_code, widget_code = _event_codes_from_payload(d)
        event_cls = cls if cls is not FrameEvent else _FRAME_EVENT_CLASS_BY_NAME.get(ev, FrameEvent)
        return event_cls(
            event=ev,
            frame_id=str(d.get("frame_id", d.get("frameId", "")) or ""),
            widget_id=str(d.get("widget_id", d.get("widgetId", "")) or ""),
            event_code=event_code,
            ui_code=ui_code,
            frame_code=frame_code,
            widget_code=widget_code,
            index=int(d.get("index", 0)),
            x=float(d.get("x", 0.0)),
            y=float(d.get("y", 0.0)),
            width=float(d.get("width", 0.0)),
            height=float(d.get("height", 0.0)),
            button=int(d.get("button", -1)),
            key=str(d.get("key", "")),
            code=str(d.get("code", "")),
            pick_id=int(d.get("pick_id", 0)),
            object_id=int(d.get("object_id", 0)),
            simplex_id=int(d.get("simplex_id", 0)),
            dock=str(d.get("dock", d.get("dock_location", "")) or ""),
        )

    def __repr__(self) -> str:
        parts = [f"event={self.event!r}"]
        if self.frame_id:
            parts.append(f"frame={self.frame_id!r}")
        if self.width or self.height:
            parts.append(f"size=({self.width:.1f}, {self.height:.1f})")
        if self.dock:
            parts.append(f"dock={self.dock!r}")
        if self.x or self.y:
            parts.append(f"pos=({self.x:.1f}, {self.y:.1f})")
        return "FrameEvent(" + ", ".join(parts) + ")"

    @property
    def type(self) -> str:
        return self.event


class FrameClosed(FrameEvent):
    __vf_event_type_name__ = "FrameClosed"


class FrameDocked(FrameEvent):
    __vf_event_type_name__ = "FrameDocked"


class FrameDragged(FrameEvent):
    __vf_event_type_name__ = "FrameDragged"


class FrameResized(FrameEvent):
    __vf_event_type_name__ = "FrameResized"


@dataclass
class WidgetEvent:
    __vf_py_attrs__ = True
    __vf_event_type_name__ = "WidgetEvent"

    event: str
    frame_id: str = ""
    widget_id: str = ""
    event_code: int = 0
    ui_code: int = 0
    frame_code: int = 0
    widget_code: int = 0
    index: int = 0
    text: str = ""
    value: str = ""
    checked: bool = False
    selected_index: int = -1

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "WidgetEvent":
        ev = str(d.get("event", ""))
        event_code, ui_code, frame_code, widget_code = _event_codes_from_payload(d)
        event_cls = cls if cls is not WidgetEvent else _WIDGET_EVENT_CLASS_BY_NAME.get(ev, WidgetEvent)
        data = d.get("data")
        if not isinstance(data, dict):
            data = {}
        return event_cls(
            event=ev,
            frame_id=str(d.get("frame_id", d.get("frameId", "")) or ""),
            widget_id=str(d.get("widget_id", d.get("widgetId", "")) or ""),
            event_code=event_code,
            ui_code=ui_code,
            frame_code=frame_code,
            widget_code=widget_code,
            index=int(d.get("index", 0)),
            text=str(data.get("text", d.get("text", "")) or ""),
            value=str(data.get("value", d.get("value", "")) or ""),
            checked=bool(data.get("checked", d.get("checked", False))),
            selected_index=int(data.get("index", d.get("index", -1)) or -1),
        )

    @property
    def type(self) -> str:
        return self.event


class ButtonPressedEvent(WidgetEvent):
    __vf_event_type_name__ = "ButtonPressedEvent"


class CheckboxToggledEvent(WidgetEvent):
    __vf_event_type_name__ = "CheckboxToggledEvent"


class SliderValueChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "SliderValueChangedEvent"


class InputFieldTextChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "InputFieldTextChangedEvent"


class InputFieldTextEnteredEvent(WidgetEvent):
    __vf_event_type_name__ = "InputFieldTextEnteredEvent"


class DropdownItemChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "DropdownItemChangedEvent"


class TextAreaTextChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "TextAreaTextChangedEvent"


class ComboboxTextChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "ComboboxTextChangedEvent"


class ComboboxTextEnteredEvent(WidgetEvent):
    __vf_event_type_name__ = "ComboboxTextEnteredEvent"


class ComboboxItemChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "ComboboxItemChangedEvent"


class ColorPickerValueChangedEvent(WidgetEvent):
    __vf_event_type_name__ = "ColorPickerValueChangedEvent"


@dataclass
class KeyboardEvent:
    """A keyboard event received from the overlay."""

    __vf_py_attrs__ = True
    __vf_event_type_name__ = "KeyboardEvent"

    event:    str   # "key_down" | "key_up"
    key:      str   # key name (e.g. "ArrowLeft", "a", "Enter")
    code:     str = ""
    event_code: int = 0
    ui_code:    int = 0
    frame_code: int = 0
    widget_code:int = 0
    index:      int = 0
    widget_id:  str = ""
    ctrl:     bool = False
    shift:    bool = False
    alt:      bool = False
    frame_id: str  = ""
    x:        float = 0.0
    y:        float = 0.0
    width:    float = 0.0
    height:   float = 0.0
    pick_id:  int = 0
    button:   int = -1
    dock:     str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "KeyboardEvent":
        ev = str(d.get("event", ""))
        event_code, ui_code, frame_code, widget_code = _event_codes_from_payload(d)
        event_cls = cls if cls not in (KeyboardEvent, KeyEvent) else _KEYBOARD_EVENT_CLASS_BY_NAME.get(ev, KeyboardEvent)
        return event_cls(
            event    = ev,
            key      = str(d.get("key", "")),
            code     = str(d.get("code", "")),
            event_code = event_code,
            ui_code    = ui_code,
            frame_code = frame_code,
            widget_code= widget_code,
            index      = int(d.get("index", 0)),
            widget_id  = str(d.get("widget_id", d.get("widgetId", "")) or ""),
            ctrl     = bool(d.get("ctrl", False)),
            shift    = bool(d.get("shift", False)),
            alt      = bool(d.get("alt", False)),
            frame_id = str(d.get("frame_id", d.get("frameId", "")) or ""),
            x        = float(d.get("x", 0.0)),
            y        = float(d.get("y", 0.0)),
            width    = float(d.get("width", 0.0)),
            height   = float(d.get("height", 0.0)),
            pick_id  = int(d.get("pick_id", 0)),
            button   = int(d.get("button", -1)),
            dock     = str(d.get("dock", d.get("dock_location", "")) or ""),
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


class KeyEvent(KeyboardEvent):
    __vf_event_type_name__ = "KeyEvent"


class KeyDown(KeyboardEvent):
    __vf_event_type_name__ = "KeyDown"


class KeyUp(KeyboardEvent):
    __vf_event_type_name__ = "KeyUp"


_MOUSE_EVENT_CLASS_BY_NAME: dict[str, type[MouseEvent]] = {
    "move": MouseMove,
    "hover": MouseHover,
    "down": MouseDown,
    "up": MouseUp,
    "wheel": MouseWheel,
    "drag": MouseDrag,
}


_KEYBOARD_EVENT_CLASS_BY_NAME: dict[str, type[KeyboardEvent]] = {
    "key_down": KeyDown,
    "key_up": KeyUp,
}


_FRAME_EVENT_CLASS_BY_NAME: dict[str, type[FrameEvent]] = {
    "frame.closed": FrameClosed,
    "frame.docked": FrameDocked,
    "frame.dragged": FrameDragged,
    "frame.resized": FrameResized,
}


_WIDGET_EVENT_CLASS_BY_NAME: dict[str, type[WidgetEvent]] = {
    "button.pressed": ButtonPressedEvent,
    "checkbox.toggled": CheckboxToggledEvent,
    "slider.value_changed": SliderValueChangedEvent,
    "input_field.text_changed": InputFieldTextChangedEvent,
    "input_field.text_entered": InputFieldTextEnteredEvent,
    "dropdown.item_changed": DropdownItemChangedEvent,
    "text_area.text_changed": TextAreaTextChangedEvent,
    "combobox.text_changed": ComboboxTextChangedEvent,
    "combobox.text_entered": ComboboxTextEnteredEvent,
    "combobox.item_changed": ComboboxItemChangedEvent,
    "color_picker.value_changed": ColorPickerValueChangedEvent,
}


def ui_event_from_payload(d: dict[str, Any]) -> MouseEvent | KeyboardEvent | FrameEvent | WidgetEvent | dict[str, Any]:
    """Normalize a raw host payload into the most specific typed UI event."""
    payload = dict(d)
    ev = str(payload.get("event", ""))
    kind = str(payload.get("type", ""))
    if kind == "vf_event":
        if ev in _MOUSE_EVENT_CLASS_BY_NAME:
            return MouseEvent.from_dict(payload)
        if ev in _KEYBOARD_EVENT_CLASS_BY_NAME:
            return KeyboardEvent.from_dict(payload)
    if ev in _FRAME_EVENT_CLASS_BY_NAME:
        return FrameEvent.from_dict(payload)
    if ev in _WIDGET_EVENT_CLASS_BY_NAME:
        return WidgetEvent.from_dict(payload)
    return payload


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
