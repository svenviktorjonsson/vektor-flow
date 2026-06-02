from __future__ import annotations

from pathlib import Path
import json

from vektorflow.ui.payloads import get_ui_payload_snapshot, reset_ui_payload_snapshot, write_display_payload, write_scene_payload
from vektorflow.ui.runtime_packet_transport import (
    UIRuntimePacketTransport,
    reset_ui_runtime_packet_transport,
    set_ui_runtime_packet_transport,
)
from vektorflow.ui.session import ensure_ui_session, reset_ui_session, write_session_file


def _write_minimal_web_tree(root: Path) -> Path:
    repo_web_dir = root / "web" / "vf-ui"
    repo_web_dir.mkdir(parents=True)
    (repo_web_dir / "index.html").write_text("<!doctype html>", encoding="utf-8")
    (repo_web_dir / "vkf-scene.html").write_text(
        "\n".join(
            [
                '<link rel="stylesheet" href="vf-frame.css" />',
                '<script src="vf-runtime-shell.js"></script>',
                '<script src="vf-frame.js?v=1"></script>',
                '<script src="vf-browser-transport.js?v=1"></script>',
                '<script src="vf-game-camera.js?v=1"></script>',
                '<script src="vf-display.js?v=1"></script>',
                '<script src="geom/vf-geom-core.js?v=1"></script>',
            ]
        ),
        encoding="utf-8",
    )
    built_web_dir = root / "native" / "VfOverlay" / "build" / "Release" / "web"
    built_web_dir.mkdir(parents=True)
    (built_web_dir / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")
    return built_web_dir


def test_overlay_session_contains_seed_payloads_and_root_asset_links(tmp_path) -> None:
    reset_ui_session()
    built_web_dir = _write_minimal_web_tree(tmp_path)

    try:
        session = ensure_ui_session(tmp_path)

        built_session_dir = built_web_dir / "sessions" / session.session_id
        assert (built_session_dir / "vf-display.json").is_file()
        assert (built_session_dir / "vf-runtime-packets.json").is_file()
        assert (built_session_dir / "vf-ui-state.json").is_file()
        assert (built_session_dir / "vkf-scene.json").is_file()

        html = (built_session_dir / "vkf-scene.html").read_text(encoding="utf-8")
        assert 'href="../../vf-frame.css?v=' in html
        assert 'src="../../vf-runtime-shell.js?v=' in html
        assert 'src="../../vf-browser-transport.js?v=' in html
        assert 'src="../../vf-game-camera.js?v=' in html
        assert 'src="../../vf-display.js?v=' in html
        assert 'src="../../geom/vf-geom-core.js?v=' in html
    finally:
        reset_ui_session()


def test_write_session_file_mirrors_runtime_payloads_to_overlay_session(tmp_path) -> None:
    reset_ui_session()
    built_web_dir = _write_minimal_web_tree(tmp_path)

    try:
        session = ensure_ui_session(tmp_path)

        write_session_file(session, "vf-display.json", '{"frames":{"f1":{}}}\n')

        assert (session.repo_session_dir / "vf-display.json").read_text(encoding="utf-8") == '{"frames":{"f1":{}}}\n'
        built_display = built_web_dir / "sessions" / session.session_id / "vf-display.json"
        assert built_display.read_text(encoding="utf-8") == '{"frames":{"f1":{}}}\n'
    finally:
        reset_ui_session()


def test_runtime_packet_history_is_mirrored_after_session_creation(tmp_path, monkeypatch) -> None:
    reset_ui_session()
    reset_ui_payload_snapshot()
    built_web_dir = _write_minimal_web_tree(tmp_path)
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))

    try:
        session = ensure_ui_session(tmp_path)

        write_scene_payload([])
        write_display_payload({"screen": [], "frames": {}, "geom": {"f1": {"meshes": [{"type": "box"}]}}})

        packet_path = built_web_dir / "sessions" / session.session_id / "vf-runtime-packets.json"
        packets = json.loads(packet_path.read_text(encoding="utf-8"))
        assert [packet["kind"] for packet in packets] == ["scene.replace", "display.replace"]
        assert packets[-1]["payload"]["display"]["geom"]["f1"]["meshes"][0]["type"] == "box"
    finally:
        reset_ui_session()
        reset_ui_payload_snapshot()


def test_packet_only_mode_skips_scene_display_and_ui_state_file_mirrors_after_direct_publish(tmp_path, monkeypatch) -> None:
    reset_ui_session()
    reset_ui_payload_snapshot()
    reset_ui_runtime_packet_transport()
    built_web_dir = _write_minimal_web_tree(tmp_path)
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))
    monkeypatch.setenv("VF_UI_PACKET_ONLY", "1")
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(direct_publisher=lambda _packets: (True, "direct://ok", None))
    )

    try:
        session = ensure_ui_session(tmp_path)
        built_session_dir = built_web_dir / "sessions" / session.session_id
        initial_scene = (built_session_dir / "vkf-scene.json").read_text(encoding="utf-8")
        initial_display = (built_session_dir / "vf-display.json").read_text(encoding="utf-8")
        initial_ui_state = (built_session_dir / "vf-ui-state.json").read_text(encoding="utf-8")

        scene_text = write_scene_payload([])
        display_text, wrote_display = write_display_payload({"screen": [{"op": "rect"}], "frames": {}, "geom": {}})
        from vektorflow.ui.payloads import write_ui_state_payload

        ui_state_text = write_ui_state_payload({"f1": {"w1": {"text": "Hello"}}})

        assert wrote_display is False
        assert (built_session_dir / "vkf-scene.json").read_text(encoding="utf-8") == initial_scene
        assert (built_session_dir / "vf-display.json").read_text(encoding="utf-8") == initial_display
        assert (built_session_dir / "vf-ui-state.json").read_text(encoding="utf-8") == initial_ui_state
        assert json.loads(scene_text) == []
        assert json.loads(display_text)["screen"][0]["op"] == "rect"
        assert json.loads(ui_state_text)["f1"]["w1"]["text"] == "Hello"

        packet_path = built_web_dir / "sessions" / session.session_id / "vf-runtime-packets.json"
        packets = json.loads(packet_path.read_text(encoding="utf-8"))
        assert [packet["kind"] for packet in packets] == ["scene.replace", "display.replace", "ui_state.replace"]
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_session()
        reset_ui_payload_snapshot()


def test_strict_packet_only_mode_skips_runtime_packet_file_mirror_after_direct_publish(tmp_path, monkeypatch) -> None:
    reset_ui_session()
    reset_ui_payload_snapshot()
    reset_ui_runtime_packet_transport()
    built_web_dir = _write_minimal_web_tree(tmp_path)
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))
    monkeypatch.setenv("VF_UI_PACKET_ONLY_STRICT", "1")
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(direct_publisher=lambda _packets: (True, "direct://ok", None))
    )

    try:
        session = ensure_ui_session(tmp_path)
        built_session_dir = built_web_dir / "sessions" / session.session_id
        initial_packets = (built_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8")

        scene_text = write_scene_payload([])
        display_text, wrote_display = write_display_payload({"screen": [{"op": "rect"}], "frames": {}, "geom": {}})
        from vektorflow.ui.payloads import write_ui_state_payload

        ui_state_text = write_ui_state_payload({"f1": {"w1": {"text": "Hello"}}})

        assert wrote_display is False
        assert (built_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == initial_packets
        assert json.loads(scene_text) == []
        assert json.loads(display_text)["screen"][0]["op"] == "rect"
        assert json.loads(ui_state_text)["f1"]["w1"]["text"] == "Hello"
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_session()
        reset_ui_payload_snapshot()


def test_strict_packet_only_mode_never_falls_back_to_file_mirrors_when_direct_publish_fails(
    tmp_path,
    monkeypatch,
) -> None:
    reset_ui_session()
    reset_ui_payload_snapshot()
    reset_ui_runtime_packet_transport()
    built_web_dir = _write_minimal_web_tree(tmp_path)
    monkeypatch.setenv("VF_UI_REPO_ROOT", str(tmp_path))
    monkeypatch.setenv("VF_UI_PACKET_ONLY_STRICT", "1")
    set_ui_runtime_packet_transport(
        UIRuntimePacketTransport(direct_publisher=lambda _packets: (False, "direct://fail", "offline"))
    )

    try:
        session = ensure_ui_session(tmp_path)
        built_session_dir = built_web_dir / "sessions" / session.session_id
        initial_packets = (built_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8")

        scene_text = write_scene_payload([])
        display_text, wrote_display = write_display_payload({"screen": [{"op": "rect"}], "frames": {}, "geom": {}})
        from vektorflow.ui.payloads import write_ui_state_payload

        ui_state_text = write_ui_state_payload({"f1": {"w1": {"text": "Hello"}}})

        assert wrote_display is False
        assert (built_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == initial_packets
        assert not (built_session_dir / "vkf-scene.json").exists()
        assert not (built_session_dir / "vf-display.json").exists()
        assert not (built_session_dir / "vf-ui-state.json").exists()
        publish_result = get_ui_payload_snapshot().last_publish_result
        assert publish_result is not None
        assert publish_result.direct_published is False
        assert publish_result.mirrored is False
        assert publish_result.endpoint == "direct://fail"
        assert publish_result.error == "offline"
        assert json.loads(scene_text) == []
        assert json.loads(display_text)["screen"][0]["op"] == "rect"
        assert json.loads(ui_state_text)["f1"]["w1"]["text"] == "Hello"
    finally:
        reset_ui_runtime_packet_transport()
        reset_ui_session()
        reset_ui_payload_snapshot()
