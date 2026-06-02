"""Authoritative UI payload contract.

This module concentrates the payload seam for the native frontend host:

- ``vkf-scene.json`` command stream
- ``vf-ui-state.json`` widget state overlay
- ``vf-display.json`` render payload

The authoritative interface is an in-memory snapshot so tests can inspect
payloads without depending on the live browser/overlay adapter. File mirroring
into per-run UI sessions remains an adapter behind the seam.
"""

from __future__ import annotations

from dataclasses import dataclass
from collections import deque
import json
import os
from typing import Any, Callable

from vektorflow.ui.ir import UiCommand, dumps_scene
from vektorflow.ui.runtime_packet_transport import (
    EMPTY_DISPLAY_TEXT as _EMPTY_DISPLAY_TEXT,
    EMPTY_SCENE_TEXT as _EMPTY_SCENE_TEXT,
    EMPTY_STATE_TEXT as _EMPTY_STATE_TEXT,
    UIRuntimePacketPublishResult,
    mirror_payload_file,
    publish_runtime_packets,
)


@dataclass(frozen=True)
class UIRuntimePacket:
    seq: int
    kind: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class UIPayloadSnapshot:
    scene_text: str = _EMPTY_SCENE_TEXT
    ui_state_text: str = _EMPTY_STATE_TEXT
    display_text: str = _EMPTY_DISPLAY_TEXT
    packets: tuple[UIRuntimePacket, ...] = ()
    last_publish_result: UIRuntimePacketPublishResult | None = None

    @property
    def packets_text(self) -> str:
        data = [
            {"seq": packet.seq, "kind": packet.kind, "payload": packet.payload}
            for packet in self.packets
        ]
        return json.dumps(data, indent=2) + "\n"

    @property
    def scene(self) -> list[dict[str, Any]]:
        return json.loads(self.scene_text)

    @property
    def ui_state(self) -> dict[str, Any]:
        return json.loads(self.ui_state_text)

    @property
    def display(self) -> dict[str, Any]:
        return json.loads(self.display_text)


_current_snapshot = UIPayloadSnapshot()
_packet_seq = 0
_packet_history: deque[UIRuntimePacket] = deque(maxlen=2048)


def _packet_only_payload_mode_enabled() -> bool:
    if _strict_packet_only_payload_mode_enabled():
        return True
    raw = str(os.environ.get("VF_UI_PACKET_ONLY", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _strict_packet_only_payload_mode_enabled() -> bool:
    raw = str(os.environ.get("VF_UI_PACKET_ONLY_STRICT", "") or "").strip().lower()
    return raw not in ("", "0", "false", "off", "no")


def _should_mirror_compatibility_payload(publish_result: UIRuntimePacketPublishResult) -> bool:
    if _strict_packet_only_payload_mode_enabled():
        return False
    return not (_packet_only_payload_mode_enabled() and publish_result.direct_published)


def strict_packet_only_publish_failed(result: UIRuntimePacketPublishResult | None) -> bool:
    return bool(
        _strict_packet_only_payload_mode_enabled()
        and result is not None
        and result.packet_count > 0
        and not result.direct_published
    )


def describe_publish_result_failure(result: UIRuntimePacketPublishResult | None) -> str:
    if result is None:
        return "no runtime packet publish result was recorded"
    details = []
    if result.endpoint:
        details.append(f"endpoint={result.endpoint}")
    if result.error:
        details.append(f"error={result.error}")
    suffix = "; ".join(details)
    return "runtime packet direct publish failed" + (f" ({suffix})" if suffix else "")


def raise_on_failed_strict_packet_publish(
    kind: str,
    result: UIRuntimePacketPublishResult | None,
) -> None:
    if strict_packet_only_publish_failed(result):
        raise RuntimeError(
            f"vektorflow: UI strict packet-only {kind} publish failed: "
            + describe_publish_result_failure(result)
        )


def reset_ui_payload_snapshot() -> None:
    global _current_snapshot, _packet_seq, _packet_history
    _current_snapshot = UIPayloadSnapshot()
    _packet_seq = 0
    _packet_history = deque(maxlen=2048)


def get_ui_payload_snapshot() -> UIPayloadSnapshot:
    return _current_snapshot


def _set_snapshot(
    *,
    scene_text: str | None = None,
    ui_state_text: str | None = None,
    display_text: str | None = None,
    last_publish_result: UIRuntimePacketPublishResult | None = None,
) -> None:
    global _current_snapshot
    _current_snapshot = UIPayloadSnapshot(
        scene_text=_current_snapshot.scene_text if scene_text is None else scene_text,
        ui_state_text=_current_snapshot.ui_state_text if ui_state_text is None else ui_state_text,
        display_text=_current_snapshot.display_text if display_text is None else display_text,
        packets=tuple(_packet_history),
        last_publish_result=(
            _current_snapshot.last_publish_result
            if last_publish_result is None
            else last_publish_result
        ),
    )


def _packet_json(packet: UIRuntimePacket) -> dict[str, Any]:
    return {"seq": packet.seq, "kind": packet.kind, "payload": dict(packet.payload)}


def _push_packet(
    kind: str,
    payload: dict[str, Any],
    *,
    warn_missing_root: Callable[[], None] | None = None,
) -> tuple[UIRuntimePacket, UIRuntimePacketPublishResult]:
    global _packet_seq
    _packet_seq += 1
    packet = UIRuntimePacket(seq=_packet_seq, kind=str(kind), payload=dict(payload))
    _packet_history.append(packet)
    _set_snapshot()
    packet_json = _packet_json(packet)
    strict_packet_only = _strict_packet_only_payload_mode_enabled()
    publish_result = publish_runtime_packets(
        [packet_json],
        packets_text=get_ui_payload_snapshot().packets_text,
        warn_missing_root=warn_missing_root,
        keep_packet_mirror=not strict_packet_only,
    )
    _set_snapshot(last_publish_result=publish_result)
    if not publish_result.mirrored and not strict_packet_only:
        mirror_payload_file(
            "vf-runtime-packets.json",
            get_ui_payload_snapshot().packets_text,
            warn_missing_root=warn_missing_root,
        )
    return packet, publish_result


def write_scene_payload(commands: list[UiCommand]) -> str:
    text = dumps_scene(commands)
    scene = json.loads(text)
    _set_snapshot(scene_text=text)
    _, publish_result = _push_packet("scene.replace", {"commands": scene})
    if _should_mirror_compatibility_payload(publish_result):
        mirror_payload_file("vkf-scene.json", text)
    return text


def write_ui_state_payload(state: dict[str, dict[str, dict[str, Any]]]) -> str:
    text = json.dumps(state, indent=2) + "\n"
    _set_snapshot(ui_state_text=text)
    _, publish_result = _push_packet("ui_state.replace", {"state": json.loads(text)})
    if _should_mirror_compatibility_payload(publish_result):
        mirror_payload_file("vf-ui-state.json", text)
    return text


def write_display_payload(
    payload: dict[str, Any],
    *,
    warn_missing_root: Callable[[], None] | None = None,
) -> tuple[str, bool]:
    text = json.dumps(payload, indent=2) + "\n"
    _set_snapshot(display_text=text)
    _, publish_result = _push_packet(
        "display.replace",
        {"display": json.loads(text)},
        warn_missing_root=warn_missing_root,
    )
    wrote_files = False
    if _should_mirror_compatibility_payload(publish_result):
        wrote_files = mirror_payload_file(
            "vf-display.json",
            text,
            warn_missing_root=warn_missing_root,
        )
    return text, wrote_files


def publish_geom_color_patch(frame_id: str, object_id: int, color: Any) -> UIRuntimePacket:
    packet, publish_result = _push_packet(
        "geom.color.patch",
        {
            "frame_id": str(frame_id),
            "object_id": int(object_id),
            "color": color,
        },
    )
    raise_on_failed_strict_packet_publish("geom-color patch", publish_result)
    return packet


def publish_widget_append_patch(frame_id: str, widget_id: str, text: str, *, append_seq: int) -> UIRuntimePacket:
    packet, publish_result = _push_packet(
        "widget.append_text",
        {
            "frame_id": str(frame_id),
            "widget_id": str(widget_id),
            "text": str(text),
            "append_seq": int(append_seq),
        },
    )
    raise_on_failed_strict_packet_publish("widget append-text patch", publish_result)
    return packet
