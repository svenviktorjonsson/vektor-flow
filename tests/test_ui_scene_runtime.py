from __future__ import annotations

import pytest

from vektorflow.ui.payloads import reset_ui_payload_snapshot
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketTransport,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)
from vektorflow.ui.scene_runtime import sync_scene_commands, sync_ui_state


def _install_failed_strict_publish(monkeypatch) -> None:
    reset_ui_payload_snapshot()
    reset_ui_runtime_packet_transport()
    monkeypatch.setenv("VF_UI_PACKET_ONLY_STRICT", "1")
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(direct_publisher=lambda _packets: (False, "direct://fail", "offline"))
    )


def test_sync_scene_commands_hard_errors_on_failed_strict_direct_publish(monkeypatch) -> None:
    _install_failed_strict_publish(monkeypatch)
    try:
        with pytest.raises(RuntimeError, match="strict packet-only scene publish failed"):
            sync_scene_commands([])
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_payload_snapshot()


def test_sync_ui_state_hard_errors_on_failed_strict_direct_publish(monkeypatch) -> None:
    _install_failed_strict_publish(monkeypatch)
    try:
        with pytest.raises(RuntimeError, match="strict packet-only ui-state publish failed"):
            sync_ui_state({"f1": {"w1": {"text": "Hello"}}})
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_payload_snapshot()
