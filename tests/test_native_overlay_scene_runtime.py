from __future__ import annotations

from pathlib import Path

from vektorflow.native_overlay_scene_bundle import NativeOverlaySceneProgram
from vektorflow.native_overlay_scene_contract import NativeOverlaySceneContract
from vektorflow.native_overlay_scene_contract_io import write_native_overlay_scene_contract
from vektorflow.native_overlay_scene_runtime import (
    launch_native_overlay_scene_program,
    try_run_native_overlay_scene_contract,
)
from vektorflow.ui.runtime_packet_transport import resequence_runtime_packets


def test_overlay_static_server_uses_stable_origin_and_cacheable_scene_assets() -> None:
    source = (Path(__file__).resolve().parent.parent / "native" / "VfOverlay" / "main.cpp").read_text(
        encoding="utf-8"
    )

    assert "const int preferredPort = g_port > 0 ? g_port : 58461;" in source
    assert "public, max-age=31536000, immutable" in source
    assert 'rel.find("\\\\vf-native-scene-configs-")' in source
    assert 'rel.find("\\\\vf-native-scene-arena-")' in source
    assert 'rel == "vf-runtime-packets.json"' in source
    assert "no-store, no-cache, must-revalidate" in source


def test_vkf_launcher_does_not_invalidate_scene_cache_on_stager_mtime() -> None:
    source = (Path(__file__).resolve().parent.parent / "native" / "VfOverlay" / "vkf_launcher.cpp").read_text(
        encoding="utf-8"
    )

    assert "bool SessionBundleCurrent(const fs::path& source, const fs::path& page, const fs::path& stager)" in source
    assert "NewerThan(stager, page)" not in source
    assert "(void)stager;" in source


class _FakeProc:
    def __init__(self, pid: int) -> None:
        self.pid = pid

    def poll(self) -> None:
        return None


def test_launch_native_overlay_scene_program_stages_and_launches(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    repo_web_dir = root / "web" / "vf-ui"
    overlay_web_dir = root / "native" / "VfOverlay" / "build" / "Release" / "web"
    exe = root / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    repo_web_dir.mkdir(parents=True, exist_ok=True)
    overlay_web_dir.mkdir(parents=True, exist_ok=True)
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")
    (overlay_web_dir / "vf-runtime-shell.js").write_text("// shell", encoding="utf-8")
    (overlay_web_dir / "vkf-scene.html").write_text("<!doctype html>", encoding="utf-8")
    (overlay_web_dir / "vf-runtime-shell.js").write_text("// shell", encoding="utf-8")

    program = NativeOverlaySceneProgram(
        session_name="native-scene-test",
        page_rel="sessions/native-scene-test/vkf-scene.html",
        html_text="<html>scene</html>",
        runtime_packets_text='{"packets":[]}\n',
        geom_transport_text='{"transport":true}\n',
        geom_state_text='{"state":true}\n',
    )

    calls: list[tuple[str, object]] = []

    def fake_sync_assets(_root: Path) -> None:
        calls.append(("sync", _root))

    def fake_reset_overlay_port() -> None:
        calls.append(("reset_overlay_port", None))

    def fake_read_overlay_pid() -> int | None:
        return 777

    def fake_terminate_previous_overlay(pid: int) -> None:
        calls.append(("terminate", pid))

    def fake_clear_overlay_port_file(path: Path) -> None:
        calls.append(("clear_port", path))

    def fake_write_overlay_state(*, pid: int, exe: Path) -> None:
        calls.append(("write_state", (pid, exe)))

    def fake_wait_for_overlay_ready(*, exe: Path, proc: object, page_rel: str) -> int:
        calls.append(("wait_ready", (exe, page_rel, getattr(proc, "pid", None))))
        return 43125

    def fake_popen(argv: list[str], **kwargs: object) -> _FakeProc:
        calls.append(("popen", (argv, kwargs)))
        return _FakeProc(24680)

    rc = launch_native_overlay_scene_program(
        program,
        root=root,
        exe=exe,
        sync_display_runtime_assets=fake_sync_assets,
        required_assets=("vf-runtime-shell.js",),
        reset_overlay_port=fake_reset_overlay_port,
        read_overlay_pid=fake_read_overlay_pid,
        terminate_previous_overlay=fake_terminate_previous_overlay,
        clear_overlay_port_file=fake_clear_overlay_port_file,
        write_overlay_state=fake_write_overlay_state,
        wait_for_overlay_ready=fake_wait_for_overlay_ready,
        popen=fake_popen,
        trace_enabled=True,
        use_terminal=False,
    )

    assert rc == 0
    repo_session_dir = repo_web_dir / "sessions" / "native-scene-test"
    overlay_session_dir = overlay_web_dir / "sessions" / "native-scene-test"
    assert (repo_session_dir / "vkf-scene.html").read_text(encoding="utf-8") == "<html>scene</html>"
    assert (repo_session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"packets":[]}\n'
    assert (repo_session_dir / "vf-geom-ledger-transport.json").read_text(encoding="utf-8") == '{"transport":true}\n'
    assert (repo_session_dir / "vf-geom-ledger-state.json").read_text(encoding="utf-8") == '{"state":true}\n'
    assert (overlay_session_dir / "vkf-scene.html").read_text(encoding="utf-8") == "<html>scene</html>"
    assert (repo_web_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"packets":[]}\n'
    assert (overlay_web_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"packets":[]}\n'
    assert (repo_web_dir / "vf-display.json").read_text(encoding="utf-8") == '{\n  "screen": [],\n  "frames": {},\n  "geom": {}\n}\n'
    assert ("sync", root) in calls
    assert ("terminate", 777) in calls
    assert ("reset_overlay_port", None) in calls
    assert any(
        name == "popen" and payload[0] == [str(exe), "sessions/native-scene-test/vkf-scene.html"]
        for name, payload in calls
    )
    assert ("write_state", (24680, exe)) in calls
    assert ("wait_ready", (exe, "sessions/native-scene-test/vkf-scene.html", 24680)) in calls


def test_launch_native_overlay_scene_program_hot_publishes_without_relaunch(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    repo_web_dir = root / "web" / "vf-ui"
    overlay_web_dir = root / "native" / "VfOverlay" / "build" / "Release" / "web"
    exe = root / "native" / "VfOverlay" / "build" / "Release" / "vf-overlay.exe"
    repo_web_dir.mkdir(parents=True, exist_ok=True)
    overlay_web_dir.mkdir(parents=True, exist_ok=True)
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")
    (overlay_web_dir / "vf-runtime-shell.js").write_text("// shell", encoding="utf-8")

    program = NativeOverlaySceneProgram(
        session_name="native-scene-hot",
        page_rel="sessions/native-scene-hot/vkf-scene.html",
        html_text="<html>hot</html>",
        runtime_packets_text=(
            "["
            '{"seq":1,"kind":"scene.replace","payload":{"commands":[]}},'
            '{"seq":2,"kind":"display.replace","payload":{"display":{"screen":[],"frames":{},"geom":{}}}}'
            "]\n"
        ),
    )

    calls: list[str] = []
    published: list[object] = []

    def fail_sync_assets(_root: Path) -> None:
        calls.append("sync")

    def fail_reset_overlay_port() -> None:
        calls.append("reset")

    def fake_read_overlay_pid() -> int | None:
        calls.append("read_pid")
        return 777

    def fail_terminate_previous_overlay(_pid: int) -> None:
        calls.append("terminate")

    def fail_clear_overlay_port_file(_path: Path) -> None:
        calls.append("clear_port")

    def fail_write_overlay_state(**_: object) -> None:
        calls.append("write_state")

    def fail_wait_for_overlay_ready(**_: object) -> int:
        calls.append("wait_ready")
        return 0

    def fail_popen(*_: object, **__: object) -> _FakeProc:
        calls.append("popen")
        return _FakeProc(1)

    def fake_hot_publish(packets: object, **kwargs: object) -> bool:
        published.append((packets, kwargs))
        return True

    navigated: list[str] = []

    def fake_hot_navigate(page_rel: str) -> bool:
        navigated.append(page_rel)
        return True

    rc = launch_native_overlay_scene_program(
        program,
        root=root,
        exe=exe,
        sync_display_runtime_assets=fail_sync_assets,
        required_assets=("vf-runtime-shell.js",),
        reset_overlay_port=fail_reset_overlay_port,
        read_overlay_pid=fake_read_overlay_pid,
        terminate_previous_overlay=fail_terminate_previous_overlay,
        clear_overlay_port_file=fail_clear_overlay_port_file,
        write_overlay_state=fail_write_overlay_state,
        wait_for_overlay_ready=fail_wait_for_overlay_ready,
        overlay_web_dir_for_exe=lambda _exe: overlay_web_dir,
        hot_publish_runtime_packets=fake_hot_publish,
        hot_navigate_overlay_page=fake_hot_navigate,
        popen=fail_popen,
    )

    assert rc == 0
    assert calls == ["sync", "read_pid"]
    assert len(published) == 1
    assert navigated == ["sessions/native-scene-hot/vkf-scene.html"]
    assert (repo_web_dir / "sessions" / "native-scene-hot" / "vkf-scene.html").read_text(encoding="utf-8") == "<html>hot</html>"
    assert (overlay_web_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == program.runtime_packets_text


def test_resequence_runtime_packets_keeps_payloads_and_assigns_fresh_seq() -> None:
    packets = [
        {"seq": 1, "kind": "scene.replace", "payload": {"commands": []}},
        {"seq": 2, "kind": "display.replace", "payload": {"display": {"frames": {}}}},
    ]

    assert resequence_runtime_packets(packets, first_seq=8) == [
        {"seq": 8, "kind": "scene.replace", "payload": {"commands": []}},
        {"seq": 9, "kind": "display.replace", "payload": {"display": {"frames": {}}}},
    ]


def test_try_run_native_overlay_scene_contract_builds_and_launches_contract_path(
    tmp_path: Path,
) -> None:
    path = tmp_path / "scene.contract.json"
    write_native_overlay_scene_contract(
        path,
        NativeOverlaySceneContract(
            session_stem="memory-scene",
            kind="native_scene",
            payload={
                "kind": "scene_3d",
                "frame_id": "scene_3d_frame",
                "title": "Cube + Plane + Hard Shadow",
                "rect": [0.08, 0.08, 0.72, 0.78],
                "cube": {
                    "center": [0.0, 0.0, 1.15],
                    "size": 1.6,
                    "face_color": [0.96, 0.22, 0.16, 1.0],
                },
                "plane": {
                    "center": [0.0, 0.0],
                    "size": 7.0,
                    "z": 0.0,
                    "color": [0.20, 0.22, 0.26, 1.0],
                },
                "camera": {
                    "pos": [3.9, -5.6, 3.2],
                    "target": [0.0, 0.0, 0.9],
                    "fov": 34.0,
                    "up": [0.0, 0.0, 1.0],
                },
                "lights": [
                    {
                        "kind": "point",
                        "pos": [0.0, 4.8, 4.8],
                        "power": 24000.0,
                        "range": 18.0,
                        "casts_shadow": False,
                    }
                ],
                "shadow": {
                    "enabled": False,
                    "color": [0.0, 0.0, 0.0, 1.0],
                    "lift": 0.002,
                },
            },
        ),
    )
    built_from: list[Path] = []

    def fake_build_program(contract_path: Path):
        built_from.append(contract_path.resolve())
        return NativeOverlaySceneProgram(
            session_name="memory-scene",
            page_rel="sessions/memory-scene/vkf-scene.html",
            html_text="<html>scene</html>",
            runtime_packets_text='{"packets":[]}\n',
        )

    launched: list[str] = []

    def fake_launch_program(program: NativeOverlaySceneProgram, **_: object) -> int:
        launched.append(program.session_name)
        return 0

    rc = try_run_native_overlay_scene_contract(
        path,
        build_program=fake_build_program,
        launch_program=fake_launch_program,
    )
    assert rc == 0
    assert built_from == [path.resolve()]
    assert launched == ["memory-scene"]

