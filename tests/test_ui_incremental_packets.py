import pytest

from vektorflow.ui.payloads import (
    get_ui_payload_snapshot,
    publish_geom_color_patch,
    publish_widget_append_patch,
    reset_ui_payload_snapshot,
)
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketTransport,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)


def _install_failed_strict_publish(monkeypatch) -> None:
    reset_ui_payload_snapshot()
    reset_ui_runtime_packet_transport()
    monkeypatch.setenv("VF_UI_PACKET_ONLY_STRICT", "1")
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(direct_publisher=lambda _packets: (False, "direct://fail", "offline"))
    )


def test_geom_color_patch_hard_errors_on_failed_strict_direct_publish(monkeypatch) -> None:
    _install_failed_strict_publish(monkeypatch)
    try:
        with pytest.raises(RuntimeError, match="strict packet-only geom-color patch publish failed"):
            publish_geom_color_patch("frame-1", 7, [1, 0, 0, 1])
        publish_result = get_ui_payload_snapshot().last_publish_result
        assert publish_result is not None
        assert publish_result.direct_published is False
        assert publish_result.mirrored is False
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_payload_snapshot()


def test_widget_append_patch_hard_errors_on_failed_strict_direct_publish(monkeypatch) -> None:
    _install_failed_strict_publish(monkeypatch)
    try:
        with pytest.raises(RuntimeError, match="strict packet-only widget append-text patch publish failed"):
            publish_widget_append_patch("frame-1", "widget-1", "hello", append_seq=1)
        publish_result = get_ui_payload_snapshot().last_publish_result
        assert publish_result is not None
        assert publish_result.direct_published is False
        assert publish_result.mirrored is False
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_payload_snapshot()
