"""Tests for the event system: OverlayPoller, UIMouse, UIKeyboard,
MouseEvent, KeyEvent, and Display.get_object / Display.get_frame.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import pytest

from vektorflow.ui.event_ingress import (
    get_ui_event_ingress,
    publish_ui_event_payload,
    reset_ui_event_ingress,
)
from vektorflow.stdlib.events import (
    MouseEvent, KeyEvent,
    UIMouse, UIKeyboard,
    OverlayPoller, get_global_poller,
    reset_overlay_port,
)
from vektorflow.stdlib.ui import Display, SceneBox, FrameRef


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _placed() -> tuple[Display, str]:
    d = Display()
    f = d.Frame()
    d.add_frame((0.1, 0.1, 0.5, 0.5))
    return d, f._frame_id


def _push_mouse(mouse: UIMouse, event: str, **kw: Any) -> None:
    """Directly push a raw event dict into UIMouse (bypass poller)."""
    base = dict(type="vf_event", event=event, x=10.0, y=20.0,
                frame_id="f1", object_id=0, simplex_id=0, button=-1, step=0)
    base.update(kw)
    mouse._push(base)


def _push_key(kbd: UIKeyboard, event: str, key: str = "a", **kw: Any) -> None:
    base = dict(type="vf_event", event=event, key=key, code=key,
                ctrl=False, shift=False, alt=False, frame_id="f1")
    base.update(kw)
    kbd._push(base)


# ---------------------------------------------------------------------------
# MouseEvent
# ---------------------------------------------------------------------------

class TestMouseEvent:
    def test_from_dict_hover(self) -> None:
        d = dict(event="hover", x=5.0, y=10.0, frame_id="f1",
                 object_id=2, simplex_id=7)
        me = MouseEvent.from_dict(d)
        assert me.event      == "hover"
        assert me.x          == pytest.approx(5.0)
        assert me.y          == pytest.approx(10.0)
        assert me.frame_id   == "f1"
        assert me.object_id  == 2
        assert me.simplex_id == 7

    def test_from_dict_down(self) -> None:
        d = dict(event="down", x=1.0, y=2.0, button=0)
        me = MouseEvent.from_dict(d)
        assert me.button == 0

    def test_from_dict_wheel(self) -> None:
        d = dict(event="wheel", x=0.0, y=0.0, step=-1)
        me = MouseEvent.from_dict(d)
        assert me.step == -1

    def test_from_dict_defaults(self) -> None:
        me = MouseEvent.from_dict(dict(event="hover", x=0, y=0))
        assert me.object_id  == 0
        assert me.simplex_id == 0
        assert me.button     == -1
        assert me.step       == 0
        assert me.frame_id   == ""

    def test_repr_contains_event(self) -> None:
        me = MouseEvent.from_dict(dict(event="down", x=3.0, y=4.0, button=1))
        assert "MouseEvent" in repr(me)
        assert "down" in repr(me)

    def test_vf_py_attrs(self) -> None:
        assert hasattr(MouseEvent, "__vf_py_attrs__")


# ---------------------------------------------------------------------------
# KeyEvent
# ---------------------------------------------------------------------------

class TestKeyEvent:
    def test_from_dict(self) -> None:
        d = dict(event="key_down", key="ArrowLeft", code="ArrowLeft",
                 ctrl=False, shift=True, alt=False)
        ke = KeyEvent.from_dict(d)
        assert ke.event == "key_down"
        assert ke.key   == "ArrowLeft"
        assert ke.shift is True
        assert ke.ctrl  is False

    def test_repr(self) -> None:
        ke = KeyEvent.from_dict(dict(event="key_up", key="Enter"))
        assert "KeyEvent" in repr(ke)
        assert "Enter" in repr(ke)


# ---------------------------------------------------------------------------
# UIMouse
# ---------------------------------------------------------------------------

class TestUIMouse:
    def test_on_hover_fires(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_hover(lambda e: received.append(e))
        _push_mouse(mouse, "hover", x=1.0, y=2.0)
        mouse.poll()
        assert len(received) == 1
        assert received[0].event == "hover"
        assert received[0].x == pytest.approx(1.0)

    def test_on_down_fires(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_down(lambda e: received.append(e))
        _push_mouse(mouse, "down", button=0)
        mouse.poll()
        assert len(received) == 1
        assert received[0].button == 0

    def test_on_up_fires(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_up(lambda e: received.append(e))
        _push_mouse(mouse, "up", button=2)
        mouse.poll()
        assert received[0].button == 2

    def test_on_wheel_fires(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_wheel(lambda e: received.append(e))
        _push_mouse(mouse, "wheel", step=1)
        mouse.poll()
        assert received[0].step == 1

    def test_wrong_event_type_not_dispatched_to_down(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_down(lambda e: received.append(e))
        _push_mouse(mouse, "hover")   # should not fire on_down
        mouse.poll()
        assert received == []

    def test_multiple_cbs(self) -> None:
        mouse = UIMouse()
        a, b = [], []
        mouse.on_hover(lambda e: a.append(e))
        mouse.on_hover(lambda e: b.append(e))
        _push_mouse(mouse, "hover")
        mouse.poll()
        assert len(a) == 1 and len(b) == 1

    def test_poll_drains_queue(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_hover(lambda e: received.append(e))
        for _ in range(5):
            _push_mouse(mouse, "hover")
        mouse.poll()
        assert len(received) == 5
        # Second poll does nothing
        mouse.poll()
        assert len(received) == 5

    def test_cb_exception_doesnt_kill_loop(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_hover(lambda e: (_ for _ in ()).throw(RuntimeError("oops")))  # always raises
        mouse.on_hover(lambda e: received.append(e))
        _push_mouse(mouse, "hover")
        mouse.poll()  # must not raise
        assert len(received) == 1

    def test_object_id_propagated(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_down(lambda e: received.append(e))
        _push_mouse(mouse, "down", object_id=3, simplex_id=5)
        mouse.poll()
        assert received[0].object_id  == 3
        assert received[0].simplex_id == 5

    def test_repr(self) -> None:
        mouse = UIMouse()
        mouse.on_hover(lambda e: None)
        assert "UIMouse" in repr(mouse)
        assert "1 cbs" in repr(mouse)

    def test_push_ignores_non_mouse_events(self) -> None:
        mouse = UIMouse()
        received = []
        mouse.on_hover(lambda e: received.append(e))
        # Push a keyboard event to mouse — should be ignored
        mouse._push(dict(type="vf_event", event="key_down", key="a"))
        mouse.poll()
        # key_down goes to "wheel/hover/down/up" path — none match, so zero callbacks
        assert len(received) == 0


# ---------------------------------------------------------------------------
# UIKeyboard
# ---------------------------------------------------------------------------

class TestUIKeyboard:
    def test_on_down_fires(self) -> None:
        kbd = UIKeyboard()
        received = []
        kbd.on_down(lambda e: received.append(e))
        _push_key(kbd, "key_down", "Space")
        kbd.poll()
        assert len(received) == 1
        assert received[0].key == "Space"

    def test_on_up_fires(self) -> None:
        kbd = UIKeyboard()
        received = []
        kbd.on_up(lambda e: received.append(e))
        _push_key(kbd, "key_up", "Escape")
        kbd.poll()
        assert received[0].key == "Escape"

    def test_modifiers_propagated(self) -> None:
        kbd = UIKeyboard()
        received = []
        kbd.on_down(lambda e: received.append(e))
        kbd._push(dict(type="vf_event", event="key_down", key="z",
                       code="KeyZ", ctrl=True, shift=False, alt=False))
        kbd.poll()
        assert received[0].ctrl  is True
        assert received[0].shift is False

    def test_held_key_state_tracks_down_and_up(self) -> None:
        kbd = UIKeyboard()
        kbd._push(dict(type="vf_event", event="key_down", key="w", code="KeyW"))
        assert kbd.is_down("w") is True
        assert kbd.is_down("KeyW") is True
        assert kbd.down["w"] is True
        kbd._push(dict(type="vf_event", event="key_up", key="w", code="KeyW"))
        assert kbd.is_down("w") is False
        assert kbd.is_down("KeyW") is False

    def test_repr(self) -> None:
        kbd = UIKeyboard()
        kbd.on_down(lambda e: None)
        assert "UIKeyboard" in repr(kbd)

    def test_poll_drains(self) -> None:
        kbd = UIKeyboard()
        received = []
        kbd.on_down(lambda e: received.append(e))
        for i in range(3):
            _push_key(kbd, "key_down", str(i))
        kbd.poll()
        assert len(received) == 3


# ---------------------------------------------------------------------------
# OverlayPoller (unit test without real HTTP)
# ---------------------------------------------------------------------------

class TestOverlayPoller:
    def test_subscribe_and_dispatch(self) -> None:
        received = []
        p = OverlayPoller()
        p.subscribe(lambda e: received.append(e))
        # Manually invoke _drain_once without a real server (port=0 → returns immediately)
        reset_overlay_port()
        p._drain_once()   # port not found → should not crash
        assert received == []

    def test_start_stop(self) -> None:
        p = OverlayPoller()
        p.start()
        assert p._thread is not None and p._thread.is_alive()
        p.stop()
        assert p._thread is None

    def test_double_start_safe(self) -> None:
        p = OverlayPoller()
        p.start()
        p.start()  # should not crash or spawn a second thread
        t = p._thread
        p.stop()
        assert t is not None


# ---------------------------------------------------------------------------
# Display.get_object / Display.get_frame
# ---------------------------------------------------------------------------

class TestDisplayGetObject:
    def test_get_object_after_add_box(self) -> None:
        d, fid = _placed()
        box = d.add_box(center=[0,0,0], color="red")
        obj = d.get_object(1)   # object_id=1 (1-based)
        assert obj is box

    def test_get_object_two_boxes(self) -> None:
        d, fid = _placed()
        b1 = d.add_box(center=[0,0,0], color="red")
        b2 = d.add_box(center=[1,0,0], color="blue")
        assert d.get_object(1) is b1
        assert d.get_object(2) is b2

    def test_get_object_zero_returns_none(self) -> None:
        d, _ = _placed()
        d.add_box(center=[0,0,0])
        assert d.get_object(0) is None

    def test_get_object_out_of_range_returns_none(self) -> None:
        d, _ = _placed()
        d.add_box(center=[0,0,0])
        assert d.get_object(99) is None

    def test_get_object_negative_returns_none(self) -> None:
        d, _ = _placed()
        assert d.get_object(-1) is None

    def test_get_frame_returns_frameref(self) -> None:
        d = Display()
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        fid = f._frame_id
        result = d.get_frame(fid)
        assert result is f

    def test_get_frame_unknown_returns_none(self) -> None:
        d, _ = _placed()
        assert d.get_frame("nonexistent_id") is None

    def test_get_frame_two_frames(self) -> None:
        d = Display()
        f1 = d.Frame(); d.add_frame((0.0, 0.0, 0.5, 1.0))
        f2 = d.Frame(); d.add_frame((0.5, 0.0, 0.5, 1.0))
        assert d.get_frame(f1._frame_id) is f1
        assert d.get_frame(f2._frame_id) is f2

    def test_scene_objects_dict_populated(self) -> None:
        d, fid = _placed()
        b = d.add_box(center=[0,0,0])
        assert (fid, 0) in d._scene_objects
        assert d._scene_objects[(fid, 0)] is b

    def test_frame_refs_populated(self) -> None:
        d = Display()
        f = d.Frame()
        d.add_frame((0.1, 0.1, 0.5, 0.5))
        assert f in d._frame_refs


# ---------------------------------------------------------------------------
# UIRoot integration
# ---------------------------------------------------------------------------

class TestUIRoot:
    def setup_method(self) -> None:
        reset_ui_event_ingress()

    def test_poll_calls_mouse_and_keyboard(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received_m, received_k = [], []
        root.cursor.on_hover(lambda e: received_m.append(e))
        root.keyboard.on_down(lambda e: received_k.append(e))
        root.cursor._push(dict(type="vf_event", event="hover", x=0, y=0))
        root.keyboard._push(dict(type="vf_event", event="key_down", key="a"))
        root.poll()
        assert len(received_m) == 1
        assert len(received_k) == 1

    def test_poller_subscription_wired(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        ingress = get_ui_event_ingress()
        initial_count = len(ingress.subscribers)
        poller_count = len(get_global_poller()._subs)
        root = UIRoot()
        assert len(ingress.subscribers) == initial_count + 1
        assert len(get_global_poller()._subs) == poller_count

    def test_dispatch_routes_to_mouse(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received = []
        root.cursor.on_down(lambda e: received.append(e))
        publish_ui_event_payload(dict(type="vf_event", event="down", x=5, y=5, button=0,
                                      object_id=1, simplex_id=0, frame_id="f1"))
        root.poll()
        assert len(received) == 1 and received[0].button == 0

    def test_dispatch_routes_to_keyboard(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received = []
        root.keyboard.on_down(lambda e: received.append(e))
        publish_ui_event_payload(dict(type="vf_event", event="key_down", key="Enter",
                                      code="Enter", ctrl=False, shift=False, alt=False))
        root.poll()
        assert len(received) == 1 and received[0].key == "Enter"

    def test_dispatch_queues_normalized_host_event_payload(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        publish_ui_event_payload(dict(type="vf_event", event="hover", x=5, y=6, frameId="f1", widgetId="btn.save"))
        assert root._event_queue
        assert isinstance(root._event_queue[0], dict)
        assert root._event_queue[0]["event"] == "hover"
        event = root.next_event()
        assert event is not None
        assert event.event == "hover"
        assert event.frame_id == "f1"
        assert event.widget_id == "btn.save"
        assert event.ui_code != 0
        assert event.frame_code != 0
        assert event.widget_code != 0
        assert event.index == 1

    def test_dispatch_delays_event_object_materialization_until_next_event(self, monkeypatch) -> None:
        from vektorflow.stdlib import events
        from vektorflow.stdlib.ui import UIRoot

        calls: list[dict[str, object]] = []
        real_materialize = events.ui_event_from_payload

        def _counting_materialize(payload: dict[str, object]) -> object:
            calls.append(dict(payload))
            return real_materialize(payload)

        monkeypatch.setattr(events, "ui_event_from_payload", _counting_materialize)
        root = UIRoot()

        publish_ui_event_payload(dict(type="vf_event", event="hover", x=5, y=6, frameId="missing"))

        assert calls == []
        assert root._event_queue
        assert isinstance(root._event_queue[0], dict)

        event = root.next_event()

        assert event is not None
        assert event.event == "hover"
        assert len(calls) == 1

    def test_non_vf_event_ignored(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received = []
        root.cursor.on_hover(lambda e: received.append(e))
        publish_ui_event_payload(dict(type="print", line="hello"))   # not a vf_event
        root.poll()
        assert received == []
