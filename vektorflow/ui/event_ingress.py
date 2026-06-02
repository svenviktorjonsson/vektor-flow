"""Authoritative UI event ingress contract.

The live host may deliver events through HTTP polling, but that transport is an
adapter. The authoritative seam is publish/subscribe over raw event payloads so
tests can inject and inspect payloads without a browser or overlay.
"""

from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Any, Callable

from vektorflow.ui.runtime_packet_transport import (
    build_overlay_runtime_event_poller,
    OverlayRuntimeEventService,
    RuntimePayloadIngress,
    RuntimePayloadIngressSnapshot,
    OverlayRuntimeEventPoller,
    OverlayRuntimePollTransport,
)

UIEventIngressSnapshot = RuntimePayloadIngressSnapshot
UIEventIngress = RuntimePayloadIngress


def get_ui_event_ingress() -> UIEventIngress:
    return _event_service.get_ingress()  # type: ignore[return-value]


def publish_ui_event_payload(payload: dict[str, Any]) -> None:
    _event_service.publish_payload(payload)


def get_ui_event_snapshot() -> UIEventIngressSnapshot:
    return _event_service.snapshot()


def reset_ui_event_ingress() -> None:
    _event_service.reset_ingress()

def get_overlay_port() -> int:
    """Return the HTTP port of the running vf-overlay, or 0 if not found."""
    return _event_service.get_overlay_port()


def reset_overlay_port() -> None:
    _event_service.reset_overlay_port()


def OverlayPoller(*, transport: OverlayRuntimePollTransport | None = None) -> OverlayRuntimeEventPoller:
    """Background thread that drains runtime packet snapshots into UI ingress."""
    return build_overlay_runtime_event_poller(
        port_provider=lambda: get_overlay_port(),
        port_reset=lambda: reset_overlay_port(),
        publish_event_payload=lambda payload: publish_ui_event_payload(payload),
        error_reporter=_trace_ingress_error,
        transport=transport,
    )


def get_global_poller() -> OverlayRuntimeEventPoller:
    return _event_service.get_global_poller()  # type: ignore[return-value]


def reset_global_poller() -> None:
    _event_service.reset_global_poller()


def start_event_poller() -> OverlayRuntimeEventPoller:
    return _event_service.start_event_poller()  # type: ignore[return-value]


def _trace_enabled() -> bool:
    raw = str(os.environ.get("VF_UI_TRACE_EVENTS", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _trace_ingress(evt: dict[str, Any]) -> None:
    if not _trace_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "") or ""
        if not base:
            return
        p = Path(base) / "vektor-flow" / "vf-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        event = str(evt.get("event", ""))
        frame = str(evt.get("frame_id", evt.get("frameId", "")) or "")
        widget = str(evt.get("widget_id", evt.get("widgetId", "")) or "")
        object_id = evt.get("object_id", "")
        simplex_id = evt.get("simplex_id", "")
        with p.open("a", encoding="utf-8") as f:
            f.write(
                f"{ts} ingress event={event} frame={frame} widget={widget} "
                f"object_id={object_id} simplex_id={simplex_id}\n"
            )
    except OSError:
        pass


def _trace_ingress_error(exc: Exception) -> None:
    if not _trace_enabled():
        return
    try:
        base = os.environ.get("LOCALAPPDATA", "") or ""
        if not base:
            return
        p = Path(base) / "vektor-flow" / "vf-ui-events.log"
        p.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"{ts} ingress subscriber error={type(exc).__name__}: {exc}\n")
    except OSError:
        pass


_event_service = OverlayRuntimeEventService(
    ingress_factory=lambda: RuntimePayloadIngress(
        before_publish=_trace_ingress,
        error_reporter=_trace_ingress_error,
    ),
    error_reporter=_trace_ingress_error,
    poller_factory=lambda: OverlayPoller(),
)
