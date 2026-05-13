"""Tests for the event system: OverlayPoller, UIMouse, UIKeyboard,
MouseEvent, KeyEvent, and Display.get_object / Display.get_frame.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from vektorflow.stdlib.events import (
    MouseEvent, MouseHover, MouseDown, MouseDrag,
    FrameEvent, FrameClosed, FrameDocked, FrameDragged, FrameResized,
    KeyboardEvent, KeyEvent, KeyDown, KeyUp, TouchEvent,
    UIMouse, UIKeyboard,
    OverlayPoller, get_global_poller, reset_global_poller,
    encode_event_code, encode_frame_pattern, encode_ui_pattern, encode_widget_pattern,
    event_match_specificity,
    reset_overlay_port,
)
from vektorflow.stdlib.ui import Display, SceneBox, FrameRef, set_ui_timer_host, reset_ui_timer_host
from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module
from vektorflow.ui.bridge import clear_base_cache
from vektorflow.ui.event_ingress import get_ui_event_snapshot, publish_ui_event_payload, reset_ui_event_ingress
import vektorflow.ui.event_ingress as event_ingress_mod
import vektorflow.ui.launch as launch_mod
from vektorflow.ui.launch import reset_launch_state
from vektorflow.ui.payloads import get_ui_payload_snapshot, reset_ui_payload_snapshot
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketTransport,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)


@pytest.fixture(autouse=True)
def _reset_event_contract() -> None:
    reset_launch_state()
    launch_mod._forced_mode = None
    clear_base_cache()
    reset_ui_payload_snapshot()
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(
            direct_publisher=lambda packets: (False, None, "disabled in event tests")
        )
    )
    reset_global_poller()
    reset_ui_event_ingress()
    reset_ui_timer_host()
    yield
    reset_ui_runtime_packet_transport()


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


def test_overlay_port_prefers_tracked_launched_exe(monkeypatch, tmp_path: Path) -> None:
    launched_exe = tmp_path / "native" / "build" / "VfOverlay" / "Release" / "vf-overlay.exe"
    launched_port_file = launched_exe.parent / "web" / "vf-api-port.txt"
    launched_port_file.parent.mkdir(parents=True)
    launched_port_file.write_text("43111", encoding="utf-8")

    wrong_exe = tmp_path / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    wrong_port_file = wrong_exe.parent / "web" / "vf-api-port.txt"
    wrong_port_file.parent.mkdir(parents=True)
    wrong_port_file.write_text("49999", encoding="utf-8")

    monkeypatch.setattr(
        launch_mod,
        "_read_overlay_state",
        lambda: {"pid": 1, "exe": str(launched_exe)},
    )
    monkeypatch.setattr(launch_mod, "find_vektorflow_repo_root", lambda: tmp_path)
    monkeypatch.setattr(launch_mod, "find_vf_overlay_exe", lambda root: wrong_exe)

    assert event_ingress_mod._read_overlay_port_file() == 43111


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
        assert isinstance(me, MouseHover)

    def test_from_dict_preserves_pick_fields(self) -> None:
        d = dict(
            event="down",
            x=5.0,
            y=10.0,
            frame_id="f1",
            pick_id=1234,
            pick_mask_representation=11,
            pick_mask_carrier=22,
            pick_mask_content=33,
            pick_mask_exact=44,
        )
        me = MouseEvent.from_dict(d)
        assert me.pick_id == 1234
        assert me.pick_mask_representation == 11
        assert me.pick_mask_carrier == 22
        assert me.pick_mask_content == 33
        assert me.pick_mask_exact == 44

    def test_from_dict_synthesizes_event_codes(self) -> None:
        d = dict(event="hover", x=5.0, y=10.0, frame_id="f1", widget_id="btn.ok")
        me = MouseEvent.from_dict(d)
        assert me.event_code == encode_event_code("hover", frame_id="f1", widget_id="btn.ok")
        assert me.ui_code == encode_ui_pattern("hover")
        assert me.frame_code == encode_frame_pattern("hover", "f1")
        assert me.widget_code == encode_widget_pattern("hover", "btn.ok")

    def test_from_dict_preserves_explicit_codes_over_synthesized(self) -> None:
        me = MouseEvent.from_dict(
            dict(
                event="hover",
                x=0.0,
                y=0.0,
                frame_id="f1",
                event_code=99,
                ui_code=88,
                frame_code=77,
                widget_code=66,
            )
        )
        assert (me.event_code, me.ui_code, me.frame_code, me.widget_code) == (99, 88, 77, 66)

    def test_from_dict_down(self) -> None:
        d = dict(event="down", x=1.0, y=2.0, button=0)
        me = MouseEvent.from_dict(d)
        assert me.button == 0
        assert isinstance(me, MouseDown)

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
        assert isinstance(ke, KeyDown)

    def test_repr(self) -> None:
        ke = KeyEvent.from_dict(dict(event="key_up", key="Enter"))
        assert "KeyEvent" in repr(ke)
        assert "Enter" in repr(ke)

    def test_keyboard_event_base_factory_uses_specific_subtypes(self) -> None:
        down = KeyboardEvent.from_dict(dict(event="key_down", key="A"))
        up = KeyboardEvent.from_dict(dict(event="key_up", key="A"))
        assert isinstance(down, KeyDown)
        assert isinstance(up, KeyUp)

    def test_from_dict_synthesizes_event_codes(self) -> None:
        ke = KeyEvent.from_dict(dict(event="key_down", key="Enter", frame_id="f2", widget_id="input.main"))
        assert ke.event_code == encode_event_code("key_down", frame_id="f2", widget_id="input.main")
        assert ke.ui_code == encode_ui_pattern("key_down")
        assert ke.frame_code == encode_frame_pattern("key_down", "f2")
        assert ke.widget_code == encode_widget_pattern("key_down", "input.main")


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

    def test_subscribe_routes_through_event_ingress_contract(self) -> None:
        received = []
        p = OverlayPoller()
        p.subscribe(lambda e: received.append(e))
        publish_ui_event_payload({"type": "vf_event", "event": "hover", "x": 1, "y": 2})
        assert received == [{"type": "vf_event", "event": "hover", "x": 1, "y": 2}]
        snapshot = get_ui_event_snapshot()
        assert snapshot.published_payloads[-1]["event"] == "hover"

    def test_drain_once_prefers_runtime_packet_ingress_over_pop_fallback(self, monkeypatch) -> None:
        p = OverlayPoller()
        calls: list[str] = []

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(p, "_drain_runtime_packets_once", lambda port: calls.append(f"runtime:{port}") or True)

        p._drain_once()

        assert calls == ["runtime:43124"]

    def test_drain_once_stops_when_runtime_packet_ingress_unavailable(self, monkeypatch) -> None:
        p = OverlayPoller()
        calls: list[str] = []

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(p, "_drain_runtime_packets_once", lambda port: calls.append(f"runtime:{port}") or False)

        p._drain_once()

        assert calls == ["runtime:43124"]

    def test_runtime_packet_ingress_tries_input_endpoint_then_general_endpoint(self, monkeypatch) -> None:
        p = OverlayPoller()
        fetched: list[str] = []
        published: list[dict[str, Any]] = []

        def _fetch(url: str) -> dict[str, Any] | None:
            fetched.append(url)
            if url.endswith("/api/runtime-packets/input"):
                return None
            return {
                "revision": 1,
                "packets": [
                    {"seq": 1, "kind": "display.replace", "payload": {"display": {}}},
                    {
                        "seq": 2,
                        "kind": "input.event",
                        "payload": {
                            "event": {"type": "vf_event", "event": "hover", "frame_id": "f1"},
                        },
                    },
                ],
            }

        monkeypatch.setattr(p, "_fetch_runtime_packet_snapshot", _fetch)
        monkeypatch.setattr("vektorflow.ui.event_ingress.publish_ui_event_payload", lambda payload: published.append(payload))

        handled = p._drain_runtime_packets_once(43124)

        assert handled is True
        assert fetched == [
            "http://127.0.0.1:43124/api/runtime-packets/input",
            "http://127.0.0.1:43124/api/runtime-packets",
        ]
        assert published == [{"type": "vf_event", "event": "hover", "frame_id": "f1"}]

    def test_runtime_packet_input_snapshot_is_authoritative_without_general_or_pop_fallback(self, monkeypatch) -> None:
        p = OverlayPoller()
        fetched: list[str] = []

        def _fetch(url: str) -> dict[str, Any] | None:
            fetched.append(url)
            return {"revision": 2, "packets": []}

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(p, "_fetch_runtime_packet_snapshot", _fetch)

        p._drain_once()

        assert fetched == ["http://127.0.0.1:43124/api/runtime-packets/input"]

    def test_runtime_packet_input_snapshot_dispatches_without_touching_broken_legacy_paths(self, monkeypatch) -> None:
        p = OverlayPoller()
        fetched: list[str] = []
        published: list[dict[str, Any]] = []

        def _fetch(url: str) -> dict[str, Any] | None:
            fetched.append(url)
            if url.endswith("/api/runtime-packets/input"):
                return {
                    "revision": 4,
                    "packets": [
                        {
                            "seq": 7,
                            "kind": "input.event",
                            "payload": {
                                "event": {"type": "vf_event", "event": "hover", "frame_id": "f7"},
                            },
                        },
                    ],
                }
            raise AssertionError("general runtime-packet fallback should not be touched")

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(p, "_fetch_runtime_packet_snapshot", _fetch)
        monkeypatch.setattr(
            "vektorflow.ui.event_ingress.publish_ui_event_payload",
            lambda payload: published.append(payload),
        )

        p._drain_once()

        assert fetched == ["http://127.0.0.1:43124/api/runtime-packets/input"]
        assert published == [{"type": "vf_event", "event": "hover", "frame_id": "f7"}]

    def test_runtime_packet_general_snapshot_is_compatibility_path_without_pop_fallback(self, monkeypatch) -> None:
        p = OverlayPoller()
        fetched: list[str] = []

        def _fetch(url: str) -> dict[str, Any] | None:
            fetched.append(url)
            if url.endswith("/api/runtime-packets/input"):
                return None
            return {
                "revision": 3,
                "packets": [
                    {"seq": 1, "kind": "display.replace", "payload": {"display": {}}},
                ],
            }

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(p, "_fetch_runtime_packet_snapshot", _fetch)

        p._drain_once()

        assert fetched == [
            "http://127.0.0.1:43124/api/runtime-packets/input",
            "http://127.0.0.1:43124/api/runtime-packets",
        ]

    def test_runtime_packet_general_snapshot_dispatches_without_touching_pop_fallback(self, monkeypatch) -> None:
        p = OverlayPoller()
        fetched: list[str] = []
        published: list[dict[str, Any]] = []

        def _fetch(url: str) -> dict[str, Any] | None:
            fetched.append(url)
            if url.endswith("/api/runtime-packets/input"):
                return None
            return {
                "revision": 5,
                "packets": [
                    {
                        "seq": 8,
                        "kind": "input.event",
                        "payload": {
                            "event": {"type": "vf_event", "event": "down", "frame_id": "f8"},
                        },
                    },
                ],
            }

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(p, "_fetch_runtime_packet_snapshot", _fetch)
        monkeypatch.setattr(
            "vektorflow.ui.event_ingress.publish_ui_event_payload",
            lambda payload: published.append(payload),
        )

        p._drain_once()

        assert fetched == [
            "http://127.0.0.1:43124/api/runtime-packets/input",
            "http://127.0.0.1:43124/api/runtime-packets",
        ]
        assert published == [{"type": "vf_event", "event": "down", "frame_id": "f8"}]

    def test_runtime_packet_input_snapshot_keeps_raw_payload_compatibility(self, monkeypatch) -> None:
        p = OverlayPoller()
        published: list[dict[str, Any]] = []

        monkeypatch.setattr(
            p,
            "_fetch_runtime_packet_snapshot",
            lambda url: {
                "revision": 6,
                "packets": [
                    {
                        "seq": 9,
                        "kind": "input.event",
                        "payload": {"type": "vf_event", "event": "up", "frame_id": "f9"},
                    },
                ],
            },
        )
        monkeypatch.setattr(
            "vektorflow.ui.event_ingress.publish_ui_event_payload",
            lambda payload: published.append(payload),
        )

        handled = p._drain_runtime_packets_once(43124)

        assert handled is True
        assert published == [{"type": "vf_event", "event": "up", "frame_id": "f9"}]

    def test_runtime_packet_snapshot_suppresses_pop_fallback_even_without_input_events(self, monkeypatch) -> None:
        p = OverlayPoller()
        calls: list[str] = []

        monkeypatch.setattr("vektorflow.ui.event_ingress.get_overlay_port", lambda: 43124)
        monkeypatch.setattr(
            p,
            "_drain_runtime_packets_once",
            lambda port: calls.append(f"runtime:{port}") or True,
        )

        p._drain_once()

        assert calls == ["runtime:43124"]


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
        # Creating UIRoot subscribes to the global poller
        p = get_global_poller()
        initial_count = len(p._subs)
        root = UIRoot()
        assert len(p._subs) == initial_count + 1

    def test_dispatch_routes_to_mouse(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received = []
        root.cursor.on_down(lambda e: received.append(e))
        # Manually call the poller subscription we just registered
        sub = get_global_poller()._subs[-1]  # last subscriber = this UIRoot
        sub(dict(type="vf_event", event="down", x=5, y=5, button=0,
                 object_id=1, simplex_id=0, frame_id="f1"))
        root.poll()
        assert len(received) == 1 and received[0].button == 0

    def test_dispatch_routes_to_keyboard(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received = []
        root.keyboard.on_down(lambda e: received.append(e))
        sub = get_global_poller()._subs[-1]
        sub(dict(type="vf_event", event="key_down", key="Enter",
                 code="Enter", ctrl=False, shift=False, alt=False))
        root.poll()
        assert len(received) == 1 and received[0].key == "Enter"

    def test_non_vf_event_ignored(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        received = []
        root.cursor.on_hover(lambda e: received.append(e))
        sub = get_global_poller()._subs[-1]
        sub(dict(type="print", line="hello"))   # not a vf_event
        root.poll()
        assert received == []

    def test_next_event_returns_mouse_event_object_with_event_codes(self) -> None:
        from vektorflow.stdlib.ui import UIRoot
        root = UIRoot()
        sub = get_global_poller()._subs[-1]
        sub(dict(type="vf_event", event="hover", x=5, y=5, button=-1, object_id=1, simplex_id=0, frame_id="f1"))
        e = root.next_event()
        assert isinstance(e, MouseEvent)
        assert e.event == "hover"
        assert e.event_code != 0
        assert e.ui_code != 0
        assert e.frame_code != 0

    def test_published_mouse_payload_reaches_uiroot_without_overlay(self) -> None:
        from vektorflow.stdlib.ui import UIRoot

        root = UIRoot()
        publish_ui_event_payload(
            dict(type="vf_event", event="down", x=5, y=6, button=0, object_id=1, simplex_id=2, frame_id="f1")
        )
        e = root.next_event()
        assert isinstance(e, MouseDown)
        assert e.frame_id == "f1"
        assert e.button == 0

    def test_published_frame_payload_reaches_uiroot_as_raw_payload(self) -> None:
        from vektorflow.stdlib.ui import UIRoot

        root = UIRoot()
        publish_ui_event_payload(
            dict(type="frame_event", event="frame.resized", frameId="f1", width=640, height=480)
        )
        e = root.next_event()
        assert isinstance(e, FrameResized)
        assert e.event == "frame.resized"
        assert e.frame_id == "f1"
        assert e.frame_code != 0
        assert e.width == 640
        assert e.height == 480

    def test_duplicate_published_payload_is_deduped_before_uiroot_queueing(self) -> None:
        from vektorflow.stdlib.ui import UIRoot

        root = UIRoot()
        root.set_mode("test")

        payload = dict(type="vf_event", event="hover", x=9, y=8, frame_id="f1")
        publish_ui_event_payload(payload)
        publish_ui_event_payload(payload)

        first = root.next_event()
        second = root.next_event()

        assert isinstance(first, MouseHover)
        assert first.frame_id == "f1"
        assert second is None


def test_interpreter_event_object_matches_ui_event_type_pattern() -> None:
    from vektorflow.stdlib.ui import UIRoot
    root = UIRoot()
    me = MouseEvent(
        event="hover",
        x=1.0,
        y=2.0,
        frame_id="f1",
        event_code=root.MOUSE_HOVER,
        ui_code=root.MOUSE_HOVER,
    )
    ip = Interpreter(Path(__file__))
    assert ip._match_specificity(me, root.MOUSE_HOVER) is not None


def test_interpreter_event_object_matches_event_type_hierarchy() -> None:
    from vektorflow.stdlib.ui import build_ui_namespace

    ns = build_ui_namespace()
    ip = Interpreter(Path(__file__))
    hover = MouseEvent.from_dict(dict(event="hover", x=1.0, y=2.0))
    key_down = KeyboardEvent.from_dict(dict(event="key_down", key="A"))
    frame_resized = FrameEvent.from_dict(dict(event="frame.resized", frame_id="f1", width=320, height=240))

    assert ip._match_specificity(hover, ns["MouseHover"]) is not None
    assert ip._match_specificity(hover, ns["MouseEvent"]) is not None
    assert ip._match_specificity(key_down, ns["KeyDown"]) is not None
    assert ip._match_specificity(key_down, ns["KeyboardEvent"]) is not None
    assert ip._match_specificity(frame_resized, ns["FrameResized"]) is not None
    assert ip._match_specificity(frame_resized, ns["FrameEvent"]) is not None


def test_interpreter_event_object_uses_synthesized_exact_first_codes() -> None:
    from vektorflow.stdlib.ui import UIRoot

    root = UIRoot()
    me = MouseEvent.from_dict(dict(event="hover", x=1.0, y=2.0, frame_id="f1", widget_id="btn.ok"))
    ip = Interpreter(Path(__file__))

    assert ip._match_specificity(me, me.event_code) is not None
    assert ip._match_specificity(me, root.MOUSE_HOVER) is not None
    assert event_match_specificity(me.event_code, me.event_code) > event_match_specificity(me.event_code, root.MOUSE_HOVER)


def test_build_ui_namespace_exposes_camel_case_event_aliases() -> None:
    from vektorflow.stdlib.ui import build_ui_namespace

    ns = build_ui_namespace()
    assert ns["MouseHover"] is MouseHover
    assert ns["MouseDown"] is MouseDown
    assert ns["MouseDrag"] is MouseDrag
    assert ns["MouseEvent"] is MouseEvent
    assert ns["FrameEvent"] is FrameEvent
    assert ns["FrameClosed"] is FrameClosed
    assert ns["FrameDocked"] is FrameDocked
    assert ns["FrameDragged"] is FrameDragged
    assert ns["FrameResized"] is FrameResized
    assert ns["KeyboardEvent"] is KeyboardEvent
    assert ns["TouchEvent"] is TouchEvent


class _ProbeTimerHost:
    def __init__(self) -> None:
        self.stop = threading.Event()

    def monotonic(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        if self.stop.is_set():
            raise SystemExit()
        time.sleep(min(max(float(seconds), 0.0), 0.001))
        if self.stop.is_set():
            raise SystemExit()


def _wait_until(predicate: Any, timeout: float = 1.5) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


def _probe_log_text() -> str:
    state = get_ui_payload_snapshot().ui_state
    for frame_state in state.values():
        if not isinstance(frame_state, dict):
            continue
        widget_state = frame_state.get("log")
        if isinstance(widget_state, dict):
            text = widget_state.get("text")
            if isinstance(text, str):
                return text
    return ""


def _frame_display_ops(frame_id: str) -> list[dict[str, Any]]:
    return list((get_ui_payload_snapshot().display.get("frames") or {}).get(frame_id, []))


def _run_example_in_test_mode(example_name: str) -> tuple[Interpreter, _ProbeTimerHost, threading.Thread, list[BaseException]]:
    example = Path(__file__).resolve().parents[1] / "examples" / example_name
    source = example.read_text(encoding="utf-8").replace('ui.set_mode("overlay")', 'ui.set_mode("test")', 1)
    mod = parse_module(source, filename=str(example))
    ip = Interpreter(example)
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(
            direct_publisher=lambda packets: (False, None, "disabled in example test mode")
        )
    )
    timer_host = _ProbeTimerHost()
    set_ui_timer_host(timer_host)
    failures: list[BaseException] = []

    def _run() -> None:
        try:
            ip.run_module(mod)
        except SystemExit:
            pass
        except BaseException as exc:  # pragma: no cover - failure path captured by assertions
            failures.append(exc)

    worker = threading.Thread(target=_run, daemon=True)
    worker.start()
    return ip, timer_host, worker, failures


def test_ui_event_probe_runs_under_test_mode_with_injected_payloads() -> None:
    ip, timer_host, worker, failures = _run_example_in_test_mode("ui_event_probe.vkf")

    try:
        assert _wait_until(
            lambda: len([entry for entry in get_ui_payload_snapshot().scene if entry.get("kind") == "frame_upsert"]) >= 2
        ), "probe did not publish its frames"

        publish_ui_event_payload({"type": "vf_event", "event": "hover", "x": 12, "y": 34, "frame_id": "f1"})
        assert _wait_until(
            lambda: "MouseHover | (" in _probe_log_text()
            and "event:hover" in _probe_log_text()
            and "frame_id:f1" in _probe_log_text()
            and "button:-1" in _probe_log_text()
            and "buttons:0" in _probe_log_text()
        ), _probe_log_text()

        publish_ui_event_payload({"type": "vf_event", "event": "key_down", "key": "A", "frame_id": "f1"})
        assert _wait_until(
            lambda: "KeyDown | (" in _probe_log_text()
            and "event:key_down" in _probe_log_text()
            and "frame_id:f1" in _probe_log_text()
            and "alt:false" in _probe_log_text()
            and "ctrl:false" in _probe_log_text()
        ), _probe_log_text()

        publish_ui_event_payload({"type": "frame_event", "event": "frame.resized", "frame_id": "f1", "width": 640, "height": 480})
        assert _wait_until(
            lambda: "FrameResized | (" in _probe_log_text()
            and "event:frame.resized" in _probe_log_text()
            and "frame_id:f1" in _probe_log_text()
            and "dock:" in _probe_log_text()
        ), _probe_log_text()

        log_text = _probe_log_text()
        assert "width:640" in log_text
        assert "height:480" in log_text
    finally:
        timer_host.stop.set()
        worker.join(timeout=1.0)

    assert failures == []


def test_ui_event_ingress_dedupes_identical_back_to_back_payloads() -> None:
    reset_ui_event_ingress()
    publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": "f1", "x": 10, "y": 20, "button": 0})
    publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": "f1", "x": 10, "y": 20, "button": 0})
    snap = get_ui_event_snapshot()
    assert len(snap.published_payloads) == 1
    assert snap.published_payloads[0]["event"] == "up"


def test_ui_minimal_interactive_runs_under_test_mode_with_injected_payloads() -> None:
    ip, timer_host, worker, failures = _run_example_in_test_mode("ui_minimal_interactive.vkf")

    try:
        assert _wait_until(lambda: "rep" in ip.globals and "frame" in ip.globals), sorted(ip.globals.keys())
        frame = ip.globals["frame"]
        rep = ip.globals["rep"]
        frame_id = frame.id
        assert _wait_until(lambda: len(_frame_display_ops(frame_id)) >= 9), _frame_display_ops(frame_id)

        def face_color() -> str:
            return str(_frame_display_ops(frame_id)[0]["color"])

        def edge_color() -> str:
            return str(_frame_display_ops(frame_id)[1]["color"])

        def vertex_color() -> str:
            return str(_frame_display_ops(frame_id)[5]["color"])

        def first_face_point() -> list[float]:
            return list(_frame_display_ops(frame_id)[0]["points"][0])

        assert face_color() == "#d9e5ff"
        assert edge_color() == "#4264b0"
        assert vertex_color() == "#4264b0"

        publish_ui_event_payload({"type": "vf_event", "event": "hover", "frame_id": frame_id, "object_id": 1, "pick_id": rep.face(0)["pick_id"]})
        assert _wait_until(lambda: face_color() == "#9cc0ff"), face_color()
        assert edge_color() == "#4264b0"
        assert vertex_color() == "#4264b0"

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 1, "pick_id": rep.edge(0)["pick_id"]})
        assert _wait_until(lambda: edge_color() == "#274ea3"), edge_color()
        assert face_color() == "#d9e5ff"
        assert vertex_color() == "#4264b0"

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 1, "pick_id": rep.vertex(0)["pick_id"]})
        assert _wait_until(lambda: vertex_color() == "#274ea3"), vertex_color()
        assert face_color() == "#d9e5ff"
        assert edge_color() == "#4264b0"

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 0, "pick_id": 0})
        assert _wait_until(lambda: face_color() == "#d9e5ff" and edge_color() == "#4264b0" and vertex_color() == "#4264b0")

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": rep.face(0)["pick_id"]})
        assert _wait_until(lambda: face_color() == "#ffcf8a"), face_color()
        assert ip.globals["dragging"] is True

        before = first_face_point()
        publish_ui_event_payload(
            {
                "type": "vf_event",
                "event": "drag",
                "frame_id": frame_id,
                "object_id": 1,
                "pick_id": rep.face(0)["pick_id"],
                "dx_norm": 0.1,
                "dy_norm": 0.05,
            }
        )
        assert _wait_until(lambda: first_face_point() != before), first_face_point()
        assert first_face_point() == pytest.approx([before[0] + 0.1, before[1] + 0.05])

        publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": frame_id, "object_id": 1, "pick_id": rep.face(0)["pick_id"]})
        assert _wait_until(lambda: ip.globals["dragging"] is False)
        assert face_color() == "#ffcf8a"
    finally:
        timer_host.stop.set()
        worker.join(timeout=1.0)

    assert failures == []


def test_ui_minimal_interactive_selection_is_stable_and_carrier_specific() -> None:
    ip, timer_host, worker, failures = _run_example_in_test_mode("ui_minimal_interactive.vkf")

    try:
        assert _wait_until(lambda: "rep" in ip.globals and "frame" in ip.globals), sorted(ip.globals.keys())
        frame = ip.globals["frame"]
        rep = ip.globals["rep"]
        frame_id = frame.id
        assert _wait_until(lambda: len(_frame_display_ops(frame_id)) >= 9), _frame_display_ops(frame_id)

        def ops() -> list[dict[str, Any]]:
            return _frame_display_ops(frame_id)

        def face_color() -> str:
            return str(ops()[0]["color"])

        def edge_color() -> str:
            return str(ops()[1]["color"])

        def vertex_color() -> str:
            return str(ops()[5]["color"])

        def first_face_point() -> list[float]:
            return list(ops()[0]["points"][0])

        edge_pick = rep.edge(0)["pick_id"]
        face_pick = rep.face(0)["pick_id"]
        vertex_pick = rep.vertex(0)["pick_id"]

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": edge_pick})
        assert _wait_until(lambda: edge_color() == "#ff8f66"), edge_color()
        assert face_color() == "#d9e5ff"
        assert vertex_color() == "#4264b0"

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 1, "pick_id": face_pick})
        assert _wait_until(lambda: face_color() == "#9cc0ff"), face_color()
        assert edge_color() == "#ff8f66"
        assert vertex_color() == "#4264b0"
        assert ip.globals["dragging"] is True

        before = first_face_point()
        publish_ui_event_payload(
            {
                "type": "vf_event",
                "event": "drag",
                "frame_id": frame_id,
                "object_id": 1,
                "pick_id": edge_pick,
                "dx_norm": 0.05,
                "dy_norm": 0.02,
            }
        )
        assert _wait_until(lambda: first_face_point() != before), first_face_point()
        assert first_face_point() == pytest.approx([before[0] + 0.05, before[1] + 0.02])

        publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": frame_id, "object_id": 1, "pick_id": edge_pick})
        assert _wait_until(lambda: ip.globals["dragging"] is False)
        assert edge_color() == "#ff8f66"

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": vertex_pick})
        assert _wait_until(lambda: vertex_color() == "#ff5e8a"), vertex_color()
        assert face_color() == "#d9e5ff"
        assert edge_color() == "#4264b0"

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 1, "pick_id": face_pick})
        assert _wait_until(lambda: face_color() == "#9cc0ff"), face_color()
        assert vertex_color() == "#ff5e8a"
        assert edge_color() == "#4264b0"
    finally:
        timer_host.stop.set()
        worker.join(timeout=1.0)

    assert failures == []


def test_ui_interactive_projection_runs_under_test_mode_with_injected_payloads() -> None:
    ip, timer_host, worker, failures = _run_example_in_test_mode("ui_interactive_projection.vkf")

    try:
        assert _wait_until(lambda: "rep" in ip.globals and "frame" in ip.globals), sorted(ip.globals.keys())
        frame = ip.globals["frame"]
        rep = ip.globals["rep"]
        frame_id = frame.id
        assert _wait_until(lambda: len(_frame_display_ops(frame_id)) >= 10), _frame_display_ops(frame_id)

        def ops() -> list[dict[str, Any]]:
            return _frame_display_ops(frame_id)

        def outer_face_color() -> str:
            return str(ops()[0]["color"])

        def inner_face_color() -> str:
            return str(ops()[1]["color"])

        def outer_first_point() -> list[float]:
            return list(ops()[0]["points"][0])

        rep_pick = rep.pick()["pick_id"]

        assert outer_face_color() == "#dbe7ff"
        assert inner_face_color() == "#8fb0ff"

        publish_ui_event_payload({"type": "vf_event", "event": "hover", "frame_id": frame_id, "object_id": 1, "pick_id": rep_pick})
        assert _wait_until(lambda: outer_face_color() == "#c8d8ff"), outer_face_color()
        assert inner_face_color() == "#79a2ff"

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": rep_pick})
        assert _wait_until(lambda: outer_face_color() == "#ffe6a6"), outer_face_color()
        assert inner_face_color() == "#ffb55c"
        assert ip.globals["dragging"] is True

        before = outer_first_point()
        publish_ui_event_payload(
            {
                "type": "vf_event",
                "event": "drag",
                "frame_id": frame_id,
                "object_id": 1,
                "pick_id": rep_pick,
                "dx_norm": 0.08,
                "dy_norm": 0.04,
            }
        )
        assert _wait_until(lambda: outer_first_point() != before), outer_first_point()
        assert outer_first_point() == pytest.approx([before[0] + 0.08, before[1] + 0.04])

        publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": frame_id, "object_id": 1, "pick_id": rep_pick})
        assert _wait_until(lambda: ip.globals["dragging"] is False)
        assert outer_face_color() == "#ffe6a6"

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 0, "pick_id": 0})
        assert _wait_until(lambda: outer_face_color() == "#ffe6a6"), outer_face_color()
        assert inner_face_color() == "#ffb55c"
    finally:
        timer_host.stop.set()
        worker.join(timeout=1.0)

    assert failures == []


def test_ui_face_edge_vertex_drag_runs_under_test_mode_with_expected_pick_and_drag_semantics() -> None:
    ip, timer_host, worker, failures = _run_example_in_test_mode("ui_face_edge_vertex_drag.vkf")

    try:
        assert _wait_until(
            lambda: all(
                key in ip.globals
                for key in (
                    "frame",
                    "face_base_rep",
                    "edge_base_reps",
                    "vertex_base_reps",
                )
            )
        ), sorted(ip.globals.keys())
        frame = ip.globals["frame"]
        assert _wait_until(lambda: bool(frame.id)), frame.id
        frame_id = frame.id
        time.sleep(2.0)
        assert len(_frame_display_ops(frame_id)) >= 18, _frame_display_ops(frame_id)

        def ops() -> list[dict[str, Any]]:
            return _frame_display_ops(frame_id)

        def face_base_op() -> dict[str, Any]:
            return ops()[0]

        def face_overlay_op() -> dict[str, Any]:
            return ops()[1]

        def edge_base_op(index: int) -> dict[str, Any]:
            return ops()[2 + index]

        def edge_overlay_op(index: int) -> dict[str, Any]:
            return ops()[6 + index]

        def vertex_base_op(index: int) -> dict[str, Any]:
            return ops()[10 + index]

        def vertex_overlay_op(index: int) -> dict[str, Any]:
            return ops()[14 + index]

        def op_pick(op: dict[str, Any]) -> int:
            return int(op["pick_id"])

        def face_first_point() -> list[float]:
            return list(face_base_op()["points"][0])

        def vertex_point(index: int) -> list[float]:
            return list(vertex_base_op(index)["point"])

        assert face_base_op()["color"] == "rgba(255, 0, 0, 1)"
        assert face_overlay_op()["color"] == "rgba(255, 0, 0, 0)"
        assert edge_base_op(1)["color"] == "rgba(0, 204, 0, 1)"
        assert edge_overlay_op(1)["color"] == "rgba(0, 204, 0, 0)"
        assert vertex_base_op(0)["color"] == "rgba(0, 102, 255, 1)"
        assert vertex_overlay_op(0)["color"] == "rgba(0, 102, 255, 0)"

        publish_ui_event_payload({"type": "vf_event", "event": "hover", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(face_base_op())})
        assert _wait_until(lambda: face_overlay_op()["color"] == "rgba(255, 0, 0, 0.4)"), face_overlay_op()["color"]

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(edge_base_op(2))})
        assert _wait_until(lambda: edge_overlay_op(2)["color"] == "rgba(0, 204, 0, 0.4)"), edge_overlay_op(2)["color"]

        publish_ui_event_payload({"type": "vf_event", "event": "move", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(vertex_base_op(3))})
        assert _wait_until(lambda: vertex_overlay_op(3)["color"] == "rgba(0, 102, 255, 0.4)"), vertex_overlay_op(3)["color"]

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(edge_base_op(1))})
        assert _wait_until(lambda: edge_overlay_op(1)["color"] == "rgba(0, 204, 0, 0.6)"), edge_overlay_op(1)["color"]
        assert _wait_until(
            lambda: ip.globals["selection"]["dragging"] is True
            and ip.globals["selection"]["drag_kind"] == "edge"
            and ip.globals["selection"]["drag_index"] == 1
        ), ip.globals["selection"]
        before_v0 = vertex_point(0)
        before_v1 = vertex_point(1)
        before_v2 = vertex_point(2)
        before_v3 = vertex_point(3)
        publish_ui_event_payload(
            {
                "type": "vf_event",
                "event": "drag",
                "frame_id": frame_id,
                "object_id": 1,
                "pick_id": op_pick(edge_base_op(1)),
                "dx_norm": 0.05,
                "dy_norm": 0.02,
            }
        )
        assert _wait_until(
            lambda: vertex_point(1) == pytest.approx([before_v1[0] + 0.05, before_v1[1] + 0.02])
            and vertex_point(2) == pytest.approx([before_v2[0] + 0.05, before_v2[1] + 0.02])
        ), (vertex_point(1), vertex_point(2))
        assert vertex_point(0) == pytest.approx(before_v0)
        assert vertex_point(1) == pytest.approx([before_v1[0] + 0.05, before_v1[1] + 0.02])
        assert vertex_point(2) == pytest.approx([before_v2[0] + 0.05, before_v2[1] + 0.02])
        assert vertex_point(3) == pytest.approx(before_v3)

        publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(edge_base_op(1))})
        assert _wait_until(lambda: ip.globals["selection"]["dragging"] is False)

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 0, "pick_id": 0})
        assert _wait_until(
            lambda: not any(ip.globals["selection"]["edge_selected"])
            and not any(ip.globals["selection"]["vertex_selected"])
            and ip.globals["selection"]["face_selected"] is False
        )
        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(face_base_op())})
        assert _wait_until(lambda: face_overlay_op()["color"] == "rgba(255, 0, 0, 0.6)"), face_overlay_op()["color"]
        assert _wait_until(
            lambda: ip.globals["selection"]["face_selected"] is True
            and ip.globals["selection"]["dragging"] is True
        )
        before_face = [
            vertex_point(0),
            vertex_point(1),
            vertex_point(2),
            vertex_point(3),
        ]
        publish_ui_event_payload(
            {
                "type": "vf_event",
                "event": "drag",
                "frame_id": frame_id,
                "object_id": 1,
                "pick_id": op_pick(face_base_op()),
                "dx_norm": 0.02,
                "dy_norm": -0.01,
            }
        )
        assert _wait_until(
            lambda: vertex_point(0) == pytest.approx([before_face[0][0] + 0.02, before_face[0][1] - 0.01])
            and vertex_point(1) == pytest.approx([before_face[1][0] + 0.02, before_face[1][1] - 0.01])
            and vertex_point(2) == pytest.approx([before_face[2][0] + 0.02, before_face[2][1] - 0.01])
            and vertex_point(3) == pytest.approx([before_face[3][0] + 0.02, before_face[3][1] - 0.01])
        , timeout=3.0), (vertex_point(0), vertex_point(1), vertex_point(2), vertex_point(3))
        assert vertex_point(0) == pytest.approx([before_face[0][0] + 0.02, before_face[0][1] - 0.01])
        assert vertex_point(1) == pytest.approx([before_face[1][0] + 0.02, before_face[1][1] - 0.01])
        assert vertex_point(2) == pytest.approx([before_face[2][0] + 0.02, before_face[2][1] - 0.01])
        assert vertex_point(3) == pytest.approx([before_face[3][0] + 0.02, before_face[3][1] - 0.01])
    finally:
        timer_host.stop.set()
        worker.join(timeout=1.0)

    assert failures == []


def test_ui_face_edge_vertex_drag_multi_select_drag_moves_union_of_selected_vertices() -> None:
    ip, timer_host, worker, failures = _run_example_in_test_mode("ui_face_edge_vertex_drag.vkf")

    try:
        assert _wait_until(
            lambda: all(
                key in ip.globals
                for key in (
                    "frame",
                    "edge_base_reps",
                    "vertex_base_reps",
                    "selection",
                )
            )
        ), sorted(ip.globals.keys())
        frame = ip.globals["frame"]
        assert _wait_until(lambda: bool(frame.id)), frame.id
        frame_id = frame.id
        time.sleep(2.0)
        assert len(_frame_display_ops(frame_id)) >= 18, _frame_display_ops(frame_id)

        def ops() -> list[dict[str, Any]]:
            return _frame_display_ops(frame_id)

        def edge_base_op(index: int) -> dict[str, Any]:
            return ops()[2 + index]

        def vertex_base_op(index: int) -> dict[str, Any]:
            return ops()[10 + index]

        def op_pick(op: dict[str, Any]) -> int:
            return int(op["pick_id"])

        def vertex_point(index: int) -> list[float]:
            return list(vertex_base_op(index)["point"])

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 0, "pick_id": 0})
        assert _wait_until(
            lambda: not any(ip.globals["selection"]["edge_selected"])
            and not any(ip.globals["selection"]["vertex_selected"])
            and ip.globals["selection"]["face_selected"] is False
        )
        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(vertex_base_op(0))})
        publish_ui_event_payload({"type": "vf_event", "event": "up", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(vertex_base_op(0))})
        assert _wait_until(lambda: ip.globals["selection"]["vertex_selected"][0] is True)

        publish_ui_event_payload({"type": "vf_event", "event": "down", "frame_id": frame_id, "object_id": 1, "pick_id": op_pick(edge_base_op(1))})
        assert _wait_until(
            lambda: ip.globals["selection"]["vertex_selected"][0] is True
            and ip.globals["selection"]["edge_selected"][1] is True
            and ip.globals["selection"]["dragging"] is True
        )

        before_v0 = vertex_point(0)
        before_v1 = vertex_point(1)
        before_v2 = vertex_point(2)
        before_v3 = vertex_point(3)
        publish_ui_event_payload(
            {
                "type": "vf_event",
                "event": "drag",
                "frame_id": frame_id,
                "object_id": 1,
                "pick_id": op_pick(edge_base_op(1)),
                "dx_norm": -0.03,
                "dy_norm": 0.04,
            }
        )
        assert _wait_until(
            lambda: vertex_point(0) == pytest.approx([before_v0[0] - 0.03, before_v0[1] + 0.04])
            and vertex_point(1) == pytest.approx([before_v1[0] - 0.03, before_v1[1] + 0.04])
            and vertex_point(2) == pytest.approx([before_v2[0] - 0.03, before_v2[1] + 0.04])
        ), (vertex_point(0), vertex_point(1), vertex_point(2))
        assert vertex_point(0) == pytest.approx([before_v0[0] - 0.03, before_v0[1] + 0.04])
        assert vertex_point(1) == pytest.approx([before_v1[0] - 0.03, before_v1[1] + 0.04])
        assert vertex_point(2) == pytest.approx([before_v2[0] - 0.03, before_v2[1] + 0.04])
        assert vertex_point(3) == pytest.approx(before_v3)
    finally:
        timer_host.stop.set()
        worker.join(timeout=1.0)

    assert failures == []
