"""UI runtime scene command helpers.

This module owns the scene-command seam for packet-first UI runtime work.
`vektorflow.stdlib.screen` should orchestrate frame placement and widget state,
but scene command authorship and syncing live here.
"""

from __future__ import annotations

from typing import Any

from vektorflow.ui.ir import FrameSpec, UiCommand, dumps_scene
from vektorflow.ui.payloads import (
    get_ui_payload_snapshot,
    raise_on_failed_strict_packet_publish,
    write_scene_payload,
    write_ui_state_payload,
)


def _raise_on_failed_strict_publish(kind: str) -> None:
    raise_on_failed_strict_packet_publish(kind, get_ui_payload_snapshot().last_publish_result)


def append_frame_upsert(
    commands: list[UiCommand],
    *,
    frame_id: str,
    spec: FrameSpec,
) -> UiCommand:
    """Append a frame-upsert command and return it."""
    cmd = UiCommand("frame_upsert", frame_id, {"spec": spec.to_json_obj()})
    commands.append(cmd)
    return cmd


def dump_scene_commands(commands: list[UiCommand]) -> str:
    """Serialize the authoritative scene command log."""
    return dumps_scene(commands)


def sync_scene_commands(commands: list[UiCommand]) -> str:
    """Publish the authoritative scene command log through the UI payload seam."""
    text = write_scene_payload(commands)
    _raise_on_failed_strict_publish("scene")
    return text


def sync_ui_state(state: dict[str, dict[str, dict[str, Any]]]) -> str:
    """Publish widget state through the UI payload seam."""
    text = write_ui_state_payload(state)
    _raise_on_failed_strict_publish("ui-state")
    return text
