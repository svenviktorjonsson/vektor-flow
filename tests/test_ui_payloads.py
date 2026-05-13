from __future__ import annotations

import json
from pathlib import Path

import pytest

import vektorflow.ui.payloads as payloads
from vektorflow.stdlib.screen import Screen
from vektorflow.stdlib.ui import Display
from vektorflow.ui.launch import reset_launch_state
from vektorflow.ui.payloads import (
    get_ui_payload_snapshot,
    publish_widget_append_patch,
    reset_ui_payload_snapshot,
    write_display_payload,
)
from vektorflow.ui.runtime_packet_transport import UIRuntimePacketPublishResult
from vektorflow.ui.runtime_packet_transport import UIRuntimePacketTransport
from vektorflow.ui.session import ensure_ui_session, get_ui_session


@pytest.fixture(autouse=True)
def _reset_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_launch_state()
    reset_ui_payload_snapshot()
    monkeypatch.setattr("vektorflow.ui.launch.maybe_launch_ui", lambda: None)


def test_scene_and_widget_state_snapshot_updates_without_repo_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("vektorflow.ui.launch.find_vektorflow_repo_root", lambda: None)

    screen = Screen()
    frame = screen.frame(title="Probe")
    screen.add_frame(frame, (0.1, 0.2, 0.3, 0.4))
    screen.widget_set(frame.id, "log", {"text": "hello"})

    snapshot = get_ui_payload_snapshot()
    scene = snapshot.scene
    assert len(scene) == 1
    assert scene[0]["kind"] == "frame_upsert"
    assert scene[0]["payload"]["spec"]["title"] == "Probe"
    assert snapshot.ui_state == {frame.id: {"log": {"text": "hello"}}}
    kinds = [packet.kind for packet in snapshot.packets]
    assert "scene.replace" in kinds
    assert kinds[-1] == "ui_state.replace"


def test_display_snapshot_updates_without_repo_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("vektorflow.ui.launch.find_vektorflow_repo_root", lambda: None)

    display = Display()
    frame = display.Frame()
    display.add_frame(frame, (0.1, 0.1, 0.3, 0.2))
    frame.draw_rect((0.0, 0.0, 0.5, 0.5), color="#ff0000")

    payload = get_ui_payload_snapshot().display
    assert frame.id in payload["frames"]
    assert payload["frames"][frame.id][0]["op"] == "rect"
    assert any(packet.kind == "display.replace" for packet in get_ui_payload_snapshot().packets)


def test_widget_append_text_emits_runtime_packet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("vektorflow.ui.launch.find_vektorflow_repo_root", lambda: None)

    screen = Screen()
    frame = screen.frame(title="Append")
    screen.add_frame(frame, (0.1, 0.2, 0.3, 0.4))
    screen.widget_append_text(frame.id, "log", "hello\n")

    snapshot = get_ui_payload_snapshot()
    assert snapshot.ui_state[frame.id]["log"]["text"] == "hello\n"
    assert snapshot.packets[-2].kind == "widget.append_text"
    assert snapshot.packets[-2].payload == {
        "frame_id": frame.id,
        "widget_id": "log",
        "text": "hello\n",
        "append_seq": 1,
    }
    assert snapshot.packets[-1].kind == "ui_state.replace"


def test_payload_contract_still_mirrors_into_active_session(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    ui_dir = tmp_path / "web" / "vf-ui"
    ui_dir.mkdir(parents=True)
    (ui_dir / "index.html").write_text("<html></html>", encoding="utf-8")
    (ui_dir / "vkf-scene.html").write_text("<html><script src=\"vf-display.js?v=1\"></script></html>", encoding="utf-8")
    (ui_dir / "vf-display.js").write_text("// stub", encoding="utf-8")
    (ui_dir / "vf-frame.js").write_text("// stub", encoding="utf-8")
    (ui_dir / "vf-frame.css").write_text("/* stub */", encoding="utf-8")
    (ui_dir / "vf-widgets.js").write_text("// stub", encoding="utf-8")
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))
    session = ensure_ui_session(tmp_path)

    screen = Screen()
    frame = screen.frame(title="Mirror")
    screen.add_frame(frame, (0.0, 0.0, 0.4, 0.4))

    session = get_ui_session() or session
    assert session is not None
    snapshot = get_ui_payload_snapshot()

    assert (session.repo_session_dir / "vkf-scene.json").read_text(encoding="utf-8") == snapshot.scene_text
    assert not (session.repo_web_dir / "vkf-scene.json").exists()
    assert (session.repo_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == snapshot.packets_text

    screen.widget_set(frame.id, "log", {"text": "payload"})
    snapshot = get_ui_payload_snapshot()
    assert json.loads((session.repo_session_dir / "vf-ui-state.json").read_text(encoding="utf-8")) == snapshot.ui_state
    assert json.loads((session.repo_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8"))[-1]["kind"] == "ui_state.replace"


def test_runtime_payload_fallback_keeps_session_authoritative_without_root_mirror(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    ui_dir = tmp_path / "web" / "vf-ui"
    ui_dir.mkdir(parents=True)
    (ui_dir / "index.html").write_text("<html></html>", encoding="utf-8")
    (ui_dir / "vkf-scene.html").write_text("<html></html>", encoding="utf-8")
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))

    monkeypatch.setattr(
        payloads,
        "publish_runtime_packets",
        lambda *args, **kwargs: UIRuntimePacketPublishResult(
            packet_count=1,
            direct_published=False,
            mirrored=False,
            endpoint=None,
            error="transport down",
        ),
    )

    screen = Screen()
    frame = screen.frame(title="SessionOnly")
    screen.add_frame(frame, (0.0, 0.0, 0.4, 0.4))

    session = get_ui_session()
    assert session is not None
    snapshot = get_ui_payload_snapshot()

    assert (session.repo_session_dir / "vkf-scene.json").read_text(encoding="utf-8") == snapshot.scene_text
    assert not (session.repo_web_dir / "vkf-scene.json").exists()
    assert (session.repo_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == snapshot.packets_text


def test_packet_contract_sequence_is_monotonic_across_updates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("vektorflow.ui.launch.find_vektorflow_repo_root", lambda: None)

    screen = Screen()
    frame = screen.frame(title="Seq")
    screen.add_frame(frame, (0.1, 0.2, 0.3, 0.4))
    screen.widget_set(frame.id, "log", {"text": "a"})
    publish_widget_append_patch(frame.id, "log", "b", append_seq=2)

    display = Display()
    frame_ref = display.Frame()
    display.add_frame(frame_ref, (0.2, 0.2, 0.2, 0.2))
    frame_ref.draw_rect((0.0, 0.0, 0.5, 0.5), color="#00ff00")

    packets = get_ui_payload_snapshot().packets
    seqs = [packet.seq for packet in packets]
    kinds = [packet.kind for packet in packets]

    assert seqs == list(range(1, len(seqs) + 1))
    assert kinds[0] == "scene.replace"
    assert "widget.append_text" in kinds
    assert kinds.index("widget.append_text") > kinds.index("ui_state.replace")
    assert kinds.count("scene.replace") >= 2
    assert kinds[-1] == "display.replace"


def test_display_payload_snapshot_remains_authoritative_when_file_mirror_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    ui_dir = tmp_path / "web" / "vf-ui"
    ui_dir.mkdir(parents=True)
    (ui_dir / "index.html").write_text("<html></html>", encoding="utf-8")
    (ui_dir / "vkf-scene.html").write_text("<html></html>", encoding="utf-8")
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))

    def _boom(*args: object, **kwargs: object) -> None:
        raise OSError("mirror failed")

    monkeypatch.setattr("vektorflow.ui.session.write_session_file", _boom)

    text, wrote_files = write_display_payload({"screen": [{"op": "rect"}], "frames": {}, "geom": {}})
    snapshot = get_ui_payload_snapshot()

    assert wrote_files is False
    assert json.loads(text) == snapshot.display
    assert snapshot.packets[-1].kind == "display.replace"
    assert snapshot.packets[-1].payload == {"display": snapshot.display}
    assert json.loads(snapshot.packets_text)[-1]["kind"] == "display.replace"


def test_packet_history_snapshot_survives_packet_file_write_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        payloads,
        "publish_runtime_packets",
        lambda *args, **kwargs: UIRuntimePacketPublishResult(
            packet_count=1,
            direct_published=False,
            mirrored=False,
            endpoint=None,
            error="transport down",
        ),
    )

    packet = publish_widget_append_patch("f1", "log", "line\n", append_seq=7)
    snapshot = get_ui_payload_snapshot()

    assert packet.seq == 1
    assert snapshot.packets == (packet,)
    assert json.loads(snapshot.packets_text) == [
        {
            "seq": 1,
            "kind": "widget.append_text",
            "payload": {
                "frame_id": "f1",
                "widget_id": "log",
                "text": "line\n",
                "append_seq": 7,
            },
        }
    ]


def test_direct_runtime_packet_publish_takes_precedence_over_display_file_mirror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    direct_calls: list[dict[str, object]] = []
    mirror_calls: list[tuple[object, ...]] = []

    def _publish_runtime_packets(*args: object, **kwargs: object) -> UIRuntimePacketPublishResult:
        direct_calls.append({"args": args, "kwargs": kwargs})
        return UIRuntimePacketPublishResult(
            packet_count=1,
            direct_published=True,
            mirrored=True,
            endpoint="http://127.0.0.1:43124/api/runtime-packets",
            error=None,
        )

    monkeypatch.setattr(payloads, "publish_runtime_packets", _publish_runtime_packets)
    monkeypatch.setattr(payloads, "mirror_payload_file", lambda *args, **kwargs: mirror_calls.append(args) or True)

    text, wrote_files = write_display_payload({"screen": [], "frames": {}, "geom": {}})

    assert wrote_files is False
    assert json.loads(text) == get_ui_payload_snapshot().display
    assert len(direct_calls) == 1
    assert mirror_calls == []
    assert get_ui_payload_snapshot().packets[-1].kind == "display.replace"


def test_direct_runtime_packet_publish_avoids_broken_display_file_mirror(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    direct_calls: list[dict[str, object]] = []

    def _publish_runtime_packets(*args: object, **kwargs: object) -> UIRuntimePacketPublishResult:
        direct_calls.append({"args": args, "kwargs": kwargs})
        return UIRuntimePacketPublishResult(
            packet_count=1,
            direct_published=True,
            mirrored=False,
            endpoint="http://127.0.0.1:43124/api/runtime-packets",
            error=None,
        )

    monkeypatch.setattr(payloads, "publish_runtime_packets", _publish_runtime_packets)
    monkeypatch.setattr(
        payloads,
        "mirror_payload_file",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("display file mirror should not be touched")),
    )

    text, wrote_files = write_display_payload({"screen": [], "frames": {}, "geom": {}})

    assert wrote_files is False
    assert json.loads(text) == get_ui_payload_snapshot().display
    assert len(direct_calls) == 1
    assert get_ui_payload_snapshot().packets[-1].kind == "display.replace"


def test_runtime_packet_transport_skips_packet_mirror_after_direct_publish_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mirror_calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(
        "vektorflow.ui.runtime_packet_transport.mirror_payload_file",
        lambda filename, text, *, mirror_root=True, warn_missing_root=None: mirror_calls.append(
            (filename, text, mirror_root)
        ) or True,
    )

    transport = UIRuntimePacketTransport(
        direct_publisher=lambda packets: (True, "http://127.0.0.1:43124/api/runtime-packets", None)
    )
    result = transport.publish_packets(
        [{"seq": 1, "kind": "display.replace", "payload": {"display": {}}}],
        packets_text='[{"seq":1}]\n',
    )

    assert result.direct_published is True
    assert result.mirrored is False
    assert mirror_calls == []


def test_runtime_packet_transport_can_still_mirror_after_direct_publish_when_explicitly_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mirror_calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(
        "vektorflow.ui.runtime_packet_transport.mirror_payload_file",
        lambda filename, text, *, mirror_root=True, warn_missing_root=None: mirror_calls.append(
            (filename, text, mirror_root)
        ) or True,
    )

    transport = UIRuntimePacketTransport(
        direct_publisher=lambda packets: (True, "http://127.0.0.1:43124/api/runtime-packets", None)
    )
    result = transport.publish_packets(
        [{"seq": 1, "kind": "display.replace", "payload": {"display": {}}}],
        packets_text='[{"seq":1}]\n',
        keep_packet_mirror=True,
    )

    assert result.direct_published is True
    assert result.mirrored is True
    assert mirror_calls == [("vf-runtime-packets.json", '[{"seq":1}]\n', True)]


def test_runtime_packet_transport_can_disable_packet_history_mirror_when_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mirror_calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(
        "vektorflow.ui.runtime_packet_transport.mirror_payload_file",
        lambda filename, text, *, mirror_root=True, warn_missing_root=None: mirror_calls.append(
            (filename, text, mirror_root)
        ) or True,
    )

    transport = UIRuntimePacketTransport(
        direct_publisher=lambda packets: (False, None, "offline")
    )
    result = transport.publish_packets(
        [{"seq": 1, "kind": "display.replace", "payload": {"display": {}}}],
        packets_text='[{"seq":1}]\n',
        keep_packet_mirror=False,
    )

    assert result.direct_published is False
    assert result.mirrored is False
    assert mirror_calls == []


def test_runtime_packet_transport_can_skip_packet_history_mirror_when_direct_publish_is_healthy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mirror_calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(
        "vektorflow.ui.runtime_packet_transport.mirror_payload_file",
        lambda filename, text, *, mirror_root=True, warn_missing_root=None: mirror_calls.append(
            (filename, text, mirror_root)
        ) or True,
    )

    transport = UIRuntimePacketTransport(
        direct_publisher=lambda packets: (True, "http://127.0.0.1:43124/api/runtime-packets", None)
    )
    result = transport.publish_packets(
        [{"seq": 1, "kind": "display.replace", "payload": {"display": {}}}],
        packets_text='[{"seq":1}]\n',
        keep_packet_mirror=False,
    )

    assert result.direct_published is True
    assert result.mirrored is False
    assert result.endpoint == "http://127.0.0.1:43124/api/runtime-packets"
    assert mirror_calls == []


def test_runtime_packet_transport_direct_publish_with_keep_false_never_touches_mirror_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "vektorflow.ui.runtime_packet_transport.mirror_payload_file",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("packet-file mirror should not be touched")),
    )

    transport = UIRuntimePacketTransport(
        direct_publisher=lambda packets: (True, "http://127.0.0.1:43124/api/runtime-packets", None)
    )
    result = transport.publish_packets(
        [{"seq": 1, "kind": "display.replace", "payload": {"display": {}}}],
        packets_text='[{"seq":1}]\n',
        keep_packet_mirror=False,
    )

    assert result.direct_published is True
    assert result.mirrored is False
    assert result.endpoint == "http://127.0.0.1:43124/api/runtime-packets"
    assert result.error is None


def test_runtime_packet_transport_direct_publish_stays_authoritative_when_packet_mirror_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mirror_calls: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(
        "vektorflow.ui.runtime_packet_transport.mirror_payload_file",
        lambda filename, text, *, mirror_root=True, warn_missing_root=None: mirror_calls.append(
            (filename, text, mirror_root)
        ) or False,
    )

    transport = UIRuntimePacketTransport(
        direct_publisher=lambda packets: (True, "http://127.0.0.1:43124/api/runtime-packets", None)
    )
    result = transport.publish_packets(
        [{"seq": 1, "kind": "display.replace", "payload": {"display": {}}}],
        packets_text='[{"seq":1}]\n',
    )

    assert result.direct_published is True
    assert result.mirrored is False
    assert result.endpoint == "http://127.0.0.1:43124/api/runtime-packets"
    assert result.error is None
    assert mirror_calls == []
