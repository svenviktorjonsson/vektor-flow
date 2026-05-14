"""UI / host bridge types (frames, rects, command stream)."""

from __future__ import annotations

from vektorflow.ui.ir import (
    DockLocation,
    FrameFlags,
    FrameSpec,
    NormRect,
    UiCommand,
    UiCommandKind,
    dumps_scene,
    parse_dock_location,
)
from vektorflow.ui.payloads import (
    UIPayloadSnapshot,
    UIRuntimePacket,
    get_ui_payload_snapshot,
    reset_ui_payload_snapshot,
)
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketPublishResult,
    get_ui_runtime_packet_transport,
    publish_runtime_packets,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)
from vektorflow.ui.event_ingress import (
    UIEventIngressSnapshot,
    get_ui_event_ingress,
    get_ui_event_snapshot,
    publish_ui_event_payload,
    reset_ui_event_ingress,
)
from vektorflow.ui.display_runtime import (
    build_display_payload,
    build_frame_payload,
    build_screen_payload,
    filter_placed_geom,
    has_visible_display_content,
    publish_display_runtime_payload,
)
from vektorflow.ui.scene_runtime import (
    append_frame_upsert,
    dump_scene_commands,
    sync_scene_commands,
    sync_ui_state,
)

__all__ = [
    "DockLocation",
    "FrameFlags",
    "FrameSpec",
    "NormRect",
    "UiCommand",
    "UiCommandKind",
    "dumps_scene",
    "parse_dock_location",
    "UIPayloadSnapshot",
    "UIRuntimePacket",
    "UIRuntimePacketPublishResult",
    "get_ui_payload_snapshot",
    "reset_ui_payload_snapshot",
    "get_ui_runtime_packet_transport",
    "set_ui_runtime_packet_transport",
    "reset_ui_runtime_packet_transport",
    "publish_runtime_packets",
    "UIEventIngressSnapshot",
    "get_ui_event_ingress",
    "get_ui_event_snapshot",
    "publish_ui_event_payload",
    "reset_ui_event_ingress",
    "build_display_payload",
    "build_frame_payload",
    "build_screen_payload",
    "filter_placed_geom",
    "has_visible_display_content",
    "publish_display_runtime_payload",
    "append_frame_upsert",
    "dump_scene_commands",
    "sync_scene_commands",
    "sync_ui_state",
]
