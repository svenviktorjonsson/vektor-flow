from __future__ import annotations

import json
from collections import deque
from typing import Any

from vektorflow.stdlib.events import OverlayPoller
from vektorflow.ui_display_ir import (
    UiHostTransportEvent,
    build_browser_host_event_dispatch,
    classify_browser_widget_dispatch,
    build_host_event_dispatch,
    decode_browser_enqueue_body,
    dispatch_browser_host_event,
    dispatch_host_event,
    normalize_host_transport_event,
)


class _FakeCursor:
    def __init__(self) -> None:
        self.pushed: list[dict[str, Any]] = []

    def _push(self, evt: dict[str, Any]) -> None:
        self.pushed.append(evt)


class _FakeKeyboard:
    def __init__(self) -> None:
        self.pushed: list[dict[str, Any]] = []
        self.observed: list[dict[str, Any]] = []

    def _observe_modifiers(self, evt: dict[str, Any]) -> None:
        self.observed.append(evt)

    def _push(self, evt: dict[str, Any]) -> None:
        self.pushed.append(evt)

    def _modifier_name(self, _ke: Any) -> str | None:
        return None


def test_normalize_host_transport_event_canonicalizes_aliases_and_data_shape() -> None:
    transport = normalize_host_transport_event(
        {
            "type": "vf_event",
            "event": "button.pressed",
            "frameId": "tools",
            "widgetId": "btn.ok",
            "data": ["not", "a", "mapping"],
            "extra": 7,
        }
    )
    assert isinstance(transport, UiHostTransportEvent)
    assert transport.type == "vf_event"
    assert transport.event == "button.pressed"
    assert transport.frame_id == "tools"
    assert transport.widget_id == "btn.ok"
    assert transport.data == {}
    assert transport.payload["frame_id"] == "tools"
    assert transport.payload["widget_id"] == "btn.ok"
    assert transport.payload["data"] == {}
    assert transport.payload["extra"] == 7


def test_build_host_event_dispatch_accepts_transport_events() -> None:
    transport = normalize_host_transport_event(
        {
            "type": "vf_event",
            "event": "hover",
            "frameId": "f1",
            "widgetId": "btn.save",
            "data": {"hovered": True},
        }
    )
    dispatch = build_host_event_dispatch(transport, next_index=2)
    assert dispatch.route == "mouse"
    assert dispatch.should_queue is True
    assert dispatch.payload["frame_id"] == "f1"
    assert dispatch.payload["widget_id"] == "btn.save"
    assert dispatch.payload["data"] == {"hovered": True}
    assert dispatch.payload["index"] == 2


def test_dispatch_host_event_queues_canonical_payload_from_transport_event() -> None:
    cursor = _FakeCursor()
    keyboard = _FakeKeyboard()
    queue: deque[object] = deque()
    counts: dict[int, int] = {}
    transport = normalize_host_transport_event(
        {
            "type": "vf_event",
            "event": "hover",
            "frameId": "f2",
            "widgetId": "mesh.palette",
            "data": {"tone": "cyan"},
        }
    )

    dispatch = dispatch_host_event(
        transport,
        cursor=cursor,
        keyboard=keyboard,
        event_queue=queue,
        event_kind_count=counts,
    )

    assert dispatch.route == "mouse"
    assert len(queue) == 1
    queued = queue[0]
    assert isinstance(queued, dict)
    assert queued["frame_id"] == "f2"
    assert queued["widget_id"] == "mesh.palette"
    assert queued["data"] == {"tone": "cyan"}
    assert cursor.pushed == [transport.payload]
    assert keyboard.observed == [transport.payload]
    assert keyboard.pushed == []


def test_overlay_poller_emits_canonical_transport_payloads(monkeypatch) -> None:
    responses = [
        {
            "line": json.dumps(
                {
                    "type": "vf_event",
                    "event": "slider.value_changed",
                    "frameId": "controls",
                    "widgetId": "time",
                    "data": {"value": 12},
                }
            )
        },
        {"line": None},
    ]

    class _FakeResponse:
        def __init__(self, payload: dict[str, Any]) -> None:
            self._payload = payload

        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def read(self) -> bytes:
            return json.dumps(self._payload).encode("utf-8")

    def _fake_urlopen(_url: str, timeout: float = 0.0) -> _FakeResponse:
        if responses:
            return _FakeResponse(responses.pop(0))
        return _FakeResponse({"line": None})

    received: list[dict[str, Any]] = []
    monkeypatch.setattr("vektorflow.stdlib.events.get_overlay_port", lambda: 9999)
    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    poller = OverlayPoller()
    poller.subscribe(lambda evt: received.append(evt))

    poller._drain_once()

    assert received == [
        {
            "type": "vf_event",
            "event": "slider.value_changed",
            "frameId": "controls",
            "widgetId": "time",
            "data": {"value": 12},
            "frame_id": "controls",
            "widget_id": "time",
        }
    ]


def test_decode_browser_enqueue_body_unwraps_playwright_widget_post_shape() -> None:
    decoded = decode_browser_enqueue_body(
        {
            "line": json.dumps(
                {
                    "event": "button.pressed",
                    "frameId": "f1",
                    "widgetId": "btn.save",
                    "data": {},
                }
            )
        }
    )
    assert decoded == {
        "type": "vf_event",
        "event": "button.pressed",
        "frameId": "f1",
        "widgetId": "btn.save",
        "data": {},
    }


def test_build_browser_host_event_dispatch_accepts_captured_browser_post_body() -> None:
    counts: dict[int, int] = {}
    dispatch = build_browser_host_event_dispatch(
        {
            "line": json.dumps(
                {
                    "event": "button.pressed",
                    "frameId": "f1",
                    "widgetId": "btn.save",
                    "data": {},
                }
            )
        },
        event_kind_count=counts,
    )
    assert dispatch.route == "host"
    assert dispatch.should_queue is True
    assert dispatch.payload["type"] == "vf_event"
    assert dispatch.payload["frame_id"] == "f1"
    assert dispatch.payload["widget_id"] == "btn.save"
    assert dispatch.payload["index"] == 1


def test_classify_browser_widget_dispatch_matches_supported_families() -> None:
    cases = [
        ("button.pressed", "button."),
        ("checkbox.toggled", "checkbox."),
        ("input_field.text_changed", "input_field."),
        ("slider.value_changed", "slider."),
        ("dropdown.item_changed", "dropdown."),
    ]
    for event_name, family in cases:
        policy = classify_browser_widget_dispatch(
            {
                "type": "vf_event",
                "event": event_name,
                "widgetId": "w1",
            }
        )
        assert policy is not None
        assert policy.family == family
        assert policy.route == "host"
        assert policy.should_queue is True


def test_classify_browser_widget_dispatch_rejects_unknown_or_incomplete_widget_events() -> None:
    assert classify_browser_widget_dispatch(
        {
            "type": "vf_event",
            "event": "text_area.text_changed",
            "widgetId": "notes",
        }
    ) is None
    assert classify_browser_widget_dispatch(
        {
            "type": "vf_event",
            "event": "button.pressed",
        }
    ) is None
    assert classify_browser_widget_dispatch(
        {
            "type": "print",
            "event": "button.pressed",
            "widgetId": "btn.save",
        }
    ) is None


def test_build_host_event_dispatch_routes_typed_button_widget_event_to_host() -> None:
    dispatch = build_host_event_dispatch(
        {
            "type": "vf_event",
            "event": "button.pressed",
            "frameId": "f3",
            "widgetId": "btn.launch",
            "data": {},
        },
        next_index=4,
    )
    assert dispatch.route == "host"
    assert dispatch.should_queue is True
    assert dispatch.payload["type"] == "vf_event"
    assert dispatch.payload["widget_id"] == "btn.launch"
    assert dispatch.payload["index"] == 4


def test_build_host_event_dispatch_routes_typed_input_field_widget_event_to_host() -> None:
    dispatch = build_host_event_dispatch(
        {
            "type": "vf_event",
            "event": "input_field.text_changed",
            "frameId": "f4",
            "widgetId": "name",
            "data": {"text": "Ada"},
        },
        next_index=3,
    )
    assert dispatch.route == "host"
    assert dispatch.should_queue is True
    assert dispatch.payload["type"] == "vf_event"
    assert dispatch.payload["widget_id"] == "name"
    assert dispatch.payload["data"] == {"text": "Ada"}
    assert dispatch.payload["index"] == 3


def test_build_host_event_dispatch_routes_typed_slider_widget_event_to_host() -> None:
    dispatch = build_host_event_dispatch(
        {
            "type": "vf_event",
            "event": "slider.value_changed",
            "frameId": "f5",
            "widgetId": "alpha",
            "data": {"value": 0.3},
        },
        next_index=2,
    )
    assert dispatch.route == "host"
    assert dispatch.should_queue is True
    assert dispatch.payload["type"] == "vf_event"
    assert dispatch.payload["widget_id"] == "alpha"
    assert dispatch.payload["data"] == {"value": 0.3}
    assert dispatch.payload["index"] == 2


def test_build_host_event_dispatch_routes_typed_dropdown_widget_event_to_host() -> None:
    dispatch = build_host_event_dispatch(
        {
            "type": "vf_event",
            "event": "dropdown.item_changed",
            "frameId": "f6",
            "widgetId": "mode",
            "data": {"index": 1, "text": "Beta"},
        },
        next_index=5,
    )
    assert dispatch.route == "host"
    assert dispatch.should_queue is True
    assert dispatch.payload["type"] == "vf_event"
    assert dispatch.payload["widget_id"] == "mode"
    assert dispatch.payload["data"] == {"index": 1, "text": "Beta"}
    assert dispatch.payload["index"] == 5


def test_build_host_event_dispatch_routes_typed_checkbox_widget_event_to_host() -> None:
    dispatch = build_host_event_dispatch(
        {
            "type": "vf_event",
            "event": "checkbox.toggled",
            "frameId": "f7",
            "widgetId": "confirm",
            "data": {"checked": False},
        },
        next_index=2,
    )
    assert dispatch.route == "host"
    assert dispatch.should_queue is True
    assert dispatch.payload["type"] == "vf_event"
    assert dispatch.payload["widget_id"] == "confirm"
    assert dispatch.payload["data"] == {"checked": False}
    assert dispatch.payload["index"] == 2


def test_dispatch_browser_host_event_updates_kind_count_without_queueing_widget_event() -> None:
    cursor = _FakeCursor()
    keyboard = _FakeKeyboard()
    queue: deque[object] = deque()
    counts: dict[int, int] = {}

    dispatch = dispatch_browser_host_event(
        {
            "line": json.dumps(
                {
                    "event": "button.pressed",
                    "frameId": "f2",
                    "widgetId": "btn.ok",
                    "data": {},
                }
            )
        },
        cursor=cursor,
        keyboard=keyboard,
        event_queue=queue,
        event_kind_count=counts,
    )

    assert dispatch.route == "host"
    assert len(queue) == 1
    queued = queue[0]
    assert isinstance(queued, dict)
    assert queued["type"] == "vf_event"
    assert queued["event"] == "button.pressed"
    assert queued["widget_id"] == "btn.ok"
    assert cursor.pushed == []
    assert keyboard.pushed == []
    assert keyboard.observed == []
    assert dispatch.base in counts
    assert counts[dispatch.base] == 1
