from __future__ import annotations

import json
from collections import deque
from typing import Any

from vektorflow.stdlib.events import MouseDrag, MouseHover, OverlayPoller
from vektorflow.ui import event_ingress
from vektorflow.ui.runtime_packet_transport import OverlayPortResolver
from vektorflow.ui.runtime_packet_transport import OverlayRuntimeEventService, RuntimePayloadIngress
from vektorflow.ui_display_ir import (
    UiHostTransportEvent,
    build_browser_host_event_dispatch,
    classify_browser_widget_dispatch,
    build_host_event_dispatch,
    coalesce_host_event_queue,
    decode_browser_enqueue_body,
    dispatch_browser_host_event,
    dispatch_host_event,
    enqueue_public_host_event,
    enqueue_public_host_event_payload,
    ensure_host_event_poller_started,
    has_queued_host_events,
    materialize_host_ui_event,
    notify_host_frame_event,
    notify_host_frame_payload_event,
    normalize_host_transport_event,
    pop_queued_host_event,
)


def test_overlay_port_resolver_caches_then_resets(monkeypatch) -> None:
    resolver = OverlayPortResolver()
    seen: list[str] = []
    values = iter([43125, 0, 43126])

    monkeypatch.setattr(
        resolver,
        "_read_overlay_port_file",
        lambda: (seen.append("read") or next(values)),
    )

    assert resolver.get_overlay_port() == 43125
    assert resolver.get_overlay_port() == 43125
    assert seen == ["read"]

    resolver.reset_overlay_port()
    assert resolver.get_overlay_port() == 0
    assert seen == ["read", "read"]


def test_runtime_payload_ingress_dedupes_repeated_payloads_and_keeps_snapshot() -> None:
    ingress = RuntimePayloadIngress()
    received: list[dict[str, Any]] = []
    payload = {"type": "vf_event", "event": "hover", "frame_id": "f1"}

    ingress.subscribe(lambda evt: received.append(evt))
    ingress.publish(payload)
    ingress.publish(payload)

    assert received == [payload]
    assert ingress.snapshot().published_payloads == (payload,)


def test_runtime_payload_ingress_reports_subscriber_errors_and_keeps_fanout() -> None:
    errors: list[str] = []
    received: list[dict[str, Any]] = []
    ingress = RuntimePayloadIngress(error_reporter=lambda exc: errors.append(type(exc).__name__))

    ingress.subscribe(lambda _evt: (_ for _ in ()).throw(RuntimeError("boom")))
    ingress.subscribe(lambda evt: received.append(evt))
    ingress.publish({"type": "vf_event", "event": "down"})

    assert errors == ["RuntimeError"]
    assert received == [{"type": "vf_event", "event": "down"}]


def test_runtime_payload_ingress_before_publish_runs_once_for_new_payload() -> None:
    seen: list[dict[str, Any]] = []
    ingress = RuntimePayloadIngress(before_publish=lambda evt: seen.append(evt))

    ingress.publish({"event": "hover"})
    ingress.publish({"event": "hover"})
    ingress.publish({"event": "down"})

    assert seen == [{"event": "hover"}, {"event": "down"}]


def test_overlay_runtime_event_service_resets_global_poller_and_ingress() -> None:
    created: list[object] = []
    ingresses: list[RuntimePayloadIngress] = []

    class _FakePoller:
        def __init__(self) -> None:
            self.stopped = False
            self.started = False

        def start(self) -> None:
            self.started = True

        def stop(self) -> None:
            self.stopped = True

    def _make_ingress() -> RuntimePayloadIngress:
        ingress = RuntimePayloadIngress()
        ingresses.append(ingress)
        return ingress

    service = OverlayRuntimeEventService(
        ingress_factory=_make_ingress,
        error_reporter=lambda _exc: None,
        poller_factory=lambda: (created.append(_FakePoller()) or created[-1]),  # type: ignore[return-value]
    )

    first_ingress = service.get_ingress()
    service.publish_payload({"event": "hover"})
    assert service.snapshot().published_payloads == ({"event": "hover"},)

    poller = service.start_event_poller()
    assert poller.started is True
    service.reset_global_poller()

    assert poller.stopped is True
    assert service.get_ingress() is not first_ingress
    assert service.snapshot().published_payloads == ()


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
            "x": 11,
            "y": 22,
            "dx": 3,
            "dy": 4,
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
    assert dispatch.payload["pos"] == [11.0, 22.0]
    assert dispatch.payload["pixel"] == [11.0, 22.0]
    assert dispatch.payload["trans"] == [3.0, 4.0]


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


def test_drag_events_coalesce_by_target_and_accumulate_delta() -> None:
    queue: deque[object] = deque()
    first = {
        "type": "vf_event",
        "event": "drag",
        "frame_id": "f1",
        "dx": 0.1,
        "dy": 0.2,
        "client_dx": 10,
        "client_dy": 20,
        "hover": {"frame_id": "f1", "object_id": "rect1", "kind": "face", "face_id": 0},
    }
    second = {
        "type": "vf_event",
        "event": "drag",
        "frame_id": "f1",
        "x": 40,
        "y": 50,
        "dx": 0.3,
        "dy": -0.05,
        "client_dx": 30,
        "client_dy": -5,
        "hover": {"frame_id": "f1", "object_id": "rect1", "kind": "face", "face_id": 0},
    }

    queue.append(first)
    assert coalesce_host_event_queue(queue, second) is True

    assert len(queue) == 1
    merged = queue[0]
    assert isinstance(merged, dict)
    assert merged["x"] == 40
    assert merged["y"] == 50
    assert merged["dx"] == 0.4
    assert merged["dy"] == 0.15000000000000002
    assert merged["trans"] == [0.4, 0.15000000000000002]
    assert merged["client_dx"] == 40.0
    assert merged["client_dy"] == 15.0


def test_drag_events_do_not_coalesce_across_targets() -> None:
    queue: deque[object] = deque([
        {
            "event": "drag",
            "frame_id": "f1",
            "dx": 0.1,
            "dy": 0.2,
            "hover": {"frame_id": "f1", "object_id": "rect1", "kind": "face", "face_id": 0},
        }
    ])
    payload = {
        "event": "drag",
        "frame_id": "f1",
        "dx": 0.3,
        "dy": 0.4,
        "hover": {"frame_id": "f1", "object_id": "rect2", "kind": "face", "face_id": 0},
    }

    assert coalesce_host_event_queue(queue, payload) is False


def test_host_event_queue_helpers_cover_poller_start_and_pop() -> None:
    started: list[str] = []
    queue: deque[object] = deque(["a", "b"])

    assert ensure_host_event_poller_started(False, start_poller=lambda: started.append("go")) is True
    assert ensure_host_event_poller_started(True, start_poller=lambda: started.append("nope")) is False
    assert started == ["go"]

    assert has_queued_host_events(queue) is True
    assert pop_queued_host_event(queue) == "a"
    assert pop_queued_host_event(queue) == "b"
    assert has_queued_host_events(queue) is False
    assert pop_queued_host_event(queue) is None


def test_materialize_host_ui_event_builds_public_event_object() -> None:
    dispatch = build_host_event_dispatch(
        {
            "type": "vf_event",
            "event": "hover",
            "frameId": "f8",
            "widgetId": "btn.help",
            "x": 1,
            "y": 2,
        },
        next_index=7,
    )

    event = materialize_host_ui_event(dispatch)

    assert event.event == "hover"
    assert event.frame_id == "f8"
    assert event.widget_id == "btn.help"
    assert event.index == 7


def test_notify_host_frame_event_routes_to_frame_handler() -> None:
    calls: list[object] = []

    class _Frame:
        def handle_events(self, event: object) -> None:
            calls.append(event)

    event = object()

    assert notify_host_frame_event(
        "f9",
        event,
        resolve_frame=lambda frame_id: _Frame() if frame_id == "f9" else None,
    ) is True
    assert calls == [event]


def test_notify_host_frame_payload_event_materializes_only_after_frame_resolves() -> None:
    calls: list[object] = []

    class _Frame:
        def handle_events(self, event: object) -> None:
            calls.append(event)

    assert notify_host_frame_payload_event(
        "missing",
        {"type": "vf_event", "event": "hover", "frame_id": "missing"},
        resolve_frame=lambda _frame_id: None,
    ) is False
    assert calls == []

    assert notify_host_frame_payload_event(
        "f1",
        {"type": "vf_event", "event": "hover", "frame_id": "f1", "x": 2, "y": 3},
        resolve_frame=lambda _frame_id: _Frame(),
    ) is True
    assert calls
    assert getattr(calls[0], "event", "") == "hover"
    assert getattr(calls[0], "frame_id", "") == "f1"


def test_notify_host_frame_event_absorbs_lookup_and_handler_failures() -> None:
    class _Frame:
        def handle_events(self, _event: object) -> None:
            raise RuntimeError("boom")

    assert notify_host_frame_event(
        "f10",
        object(),
        resolve_frame=lambda _frame_id: _Frame(),
    ) is False
    assert notify_host_frame_event(
        "f10",
        object(),
        resolve_frame=lambda _frame_id: (_ for _ in ()).throw(RuntimeError("lookup")),
    ) is False


def test_overlay_poller_emits_canonical_transport_payloads_from_pop_stream(monkeypatch) -> None:
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
    monkeypatch.setattr(event_ingress, "get_overlay_port", lambda: 9999)
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
        }
    ]


def test_overlay_poller_treats_empty_pop_timeout_as_complete_tick(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(event_ingress, "get_overlay_port", lambda: 9999)

    def _fake_urlopen(url: str, timeout: float = 0.0) -> object:
        calls.append(url)
        raise TimeoutError("empty pop tick")

    def _no_runtime_fallback(_port: int) -> bool:
        raise AssertionError("empty /api/pop tick must not fall back to slow runtime snapshots")

    monkeypatch.setattr("urllib.request.urlopen", _fake_urlopen)
    poller = OverlayPoller()
    monkeypatch.setattr(poller, "_drain_runtime_packets_once", _no_runtime_fallback)

    poller._drain_once()

    assert calls == ["http://127.0.0.1:9999/api/pop"]


def test_overlay_poller_emits_input_runtime_packet_payloads(monkeypatch) -> None:
    response = {
        "revision": 1,
        "packets": [
            {
                "seq": 1,
                "kind": "input.event",
                "payload": {
                    "event": {
                        "type": "vf_event",
                        "event": "hover",
                        "frame_id": "scene",
                        "object_id": 5,
                    }
                },
            }
        ],
    }

    class _FakeResponse:
        def __enter__(self) -> "_FakeResponse":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def read(self) -> bytes:
            return json.dumps(response).encode("utf-8")

    received: list[dict[str, Any]] = []
    monkeypatch.setattr("urllib.request.urlopen", lambda _url, timeout=0.0: _FakeResponse())
    poller = OverlayPoller()
    poller.subscribe(lambda evt: received.append(evt))

    assert poller._drain_runtime_packets_once(9999) is True
    assert received == [{"type": "vf_event", "event": "hover", "frame_id": "scene", "object_id": 5}]


def test_overlay_poller_rediscovers_port_after_failed_poll(monkeypatch) -> None:
    ports = iter([1111, 2222])
    resets: list[bool] = []
    calls: list[tuple[int, int]] = []
    poller = OverlayPoller()
    poller._last_packet_seq = 99
    poller._last_packet_revision = 7

    monkeypatch.setattr(event_ingress, "get_overlay_port", lambda: next(ports))
    monkeypatch.setattr(event_ingress, "reset_overlay_port", lambda: resets.append(True))

    def _fake_drain(port: int) -> bool:
        calls.append((port, poller._last_packet_seq))
        return port == 2222

    monkeypatch.setattr(poller, "_drain_pop_events_once", lambda _port: False)
    monkeypatch.setattr(poller, "_drain_runtime_packets_once", _fake_drain)

    poller._drain_once()

    assert resets == [True]
    assert calls == [(1111, 0), (2222, 0)]


def test_overlay_poller_subscriber_survives_ingress_reset() -> None:
    received: list[dict[str, Any]] = []
    poller = OverlayPoller()
    poller.subscribe(lambda evt: received.append(evt))

    event_ingress.reset_ui_event_ingress()
    poller._publish_event_payload({"type": "vf_event", "event": "hover", "frame_id": "f1"})

    assert received == [{"type": "vf_event", "event": "hover", "frame_id": "f1"}]


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


def test_enqueue_public_host_event_coalesces_pointer_samples_by_frame() -> None:
    queue: deque[object] = deque()
    first = MouseHover.from_dict({"type": "vf_event", "event": "hover", "frame_id": "f1", "x": 1, "y": 2})
    second = MouseHover.from_dict({"type": "vf_event", "event": "hover", "frame_id": "f1", "x": 3, "y": 4})

    assert enqueue_public_host_event(queue, first) is True
    assert enqueue_public_host_event(queue, second) is True
    assert len(queue) == 1
    assert queue[0] is second


def test_enqueue_public_host_event_coalesces_drag_samples_by_target() -> None:
    queue: deque[object] = deque()
    first = MouseDrag.from_dict(
        {
            "type": "vf_event",
            "event": "drag",
            "frame_id": "f2",
            "object_id": 9,
            "dx": 1.0,
            "dy": 2.0,
            "dx_norm": 0.1,
            "dy_norm": 0.2,
            "x": 5.0,
            "y": 6.0,
            "buttons": 1,
        }
    )
    second = MouseDrag.from_dict(
        {
            "type": "vf_event",
            "event": "drag",
            "frame_id": "f2",
            "object_id": 9,
            "dx": 3.0,
            "dy": -1.0,
            "dx_norm": 0.3,
            "dy_norm": -0.1,
            "x": 8.0,
            "y": 9.0,
            "buttons": 1,
        }
    )

    assert enqueue_public_host_event(queue, first) is True
    assert enqueue_public_host_event(queue, second) is True
    assert len(queue) == 1
    merged = queue[0]
    assert isinstance(merged, MouseDrag)
    assert merged.dx == 4.0
    assert merged.dy == 1.0
    assert merged.dx_norm == 0.4
    assert merged.dy_norm == 0.1
    assert merged.x == 8.0
    assert merged.y == 9.0


def test_enqueue_public_host_event_payload_queues_plain_hover_mapping() -> None:
    queue: deque[object] = deque()
    event = MouseHover.from_dict({"type": "vf_event", "event": "hover", "frame_id": "f1", "x": 1, "y": 2})

    assert enqueue_public_host_event_payload(queue, event) is True

    assert list(queue) == [
        {
            "event": "hover",
            "frame_id": "f1",
            "object_id": 0,
            "simplex_id": 0,
            "x": 1.0,
            "y": 2.0,
            "dx": 0.0,
            "dy": 0.0,
            "dx_norm": 0.0,
            "dy_norm": 0.0,
            "button": -1,
            "buttons": 0,
            "width": 0.0,
            "height": 0.0,
            "index": 0,
            "type": "vf_event",
        }
    ]


def test_enqueue_public_host_event_payload_coalesces_drag_mappings() -> None:
    queue: deque[object] = deque()
    first = MouseDrag.from_dict(
        {
            "type": "vf_event",
            "event": "drag",
            "frame_id": "f2",
            "object_id": 9,
            "dx": 1.0,
            "dy": 2.0,
            "x": 5.0,
            "y": 6.0,
            "buttons": 1,
        }
    )
    second = MouseDrag.from_dict(
        {
            "type": "vf_event",
            "event": "drag",
            "frame_id": "f2",
            "object_id": 9,
            "dx": 3.0,
            "dy": -1.0,
            "x": 8.0,
            "y": 9.0,
            "buttons": 1,
        }
    )

    assert enqueue_public_host_event_payload(queue, first) is True
    assert enqueue_public_host_event_payload(queue, second) is True

    assert len(queue) == 1
    merged = queue[0]
    assert isinstance(merged, dict)
    assert merged["event"] == "drag"
    assert merged["frame_id"] == "f2"
    assert merged["object_id"] == 9
    assert merged["dx"] == 4.0
    assert merged["dy"] == 1.0
    assert merged["trans"] == [4.0, 1.0]
    assert merged["x"] == 8.0
    assert merged["y"] == 9.0
