from __future__ import annotations

import contextlib
from io import StringIO
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

from vektorflow.cli import main
from vektorflow.cpp_backend import discover_cpp_compiler
from vektorflow.native_overlay_scene_bundle import try_build_native_overlay_scene_program


ROOT = Path(__file__).resolve().parent.parent
VF_CORE_EXE = ROOT / "native" / "build" / "VfCore" / "Release" / "vf-core.exe"
NATIVE_CORE = ROOT / "examples" / "native_core"
HELLO_NATIVE = NATIVE_CORE / "hello_native.vkf"
NATIVE_SCENE_PROBE = ROOT / "examples" / "ui_event_probe.vkf"
FACE_EDGE_VERTEX_DRAG = ROOT / "examples" / "ui_face_edge_vertex_drag.vkf"


def _run_cli_stdout(args: list[str]) -> tuple[int, str]:
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        rc = main(args)
    return rc, buf.getvalue()


def _native_core_build_args(path: Path, exe: Path) -> list[str]:
    rc, out = _run_cli_stdout(["--help"])
    assert rc == 0
    if "build-native-core" in out:
        return ["build-native-core", str(path), "-o", str(exe)]
    return ["build", str(path), "-o", str(exe)]


def _sanitized_runtime_env() -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith("PYTHON")
        and key.upper() not in {"VIRTUAL_ENV", "PYTEST_CURRENT_TEST", "VF_UI_REPO_ROOT"}
    }
    path_entries: list[str] = []
    for entry in env.get("PATH", "").split(os.pathsep):
        lowered = entry.lower()
        if "python" in lowered or ".venv" in lowered:
            continue
        if lowered.endswith("\\scripts") or lowered.endswith("/scripts"):
            continue
        path_entries.append(entry)
    env["PATH"] = os.pathsep.join(path_entries)
    return env


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_vf_core_artifact_emits_native_runtime_program_json(tmp_path: Path) -> None:
    source = tmp_path / "runtime_smoke.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    proc = subprocess.run(
        [str(VF_CORE_EXE), "artifact", str(source)],
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert '"schema": "vektorflow.native_runtime_program"' in proc.stdout
    assert '"kind": "BindStep"' in proc.stdout
    assert '"kind": "EmitStep"' in proc.stdout
    assert "python" not in proc.stdout.lower()
    assert ".py" not in proc.stdout


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_vf_core_run_executes_runtime_program(tmp_path: Path) -> None:
    source = tmp_path / "runtime_execute.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    proc = subprocess.run(
        [str(VF_CORE_EXE), "run", str(source)],
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "42\n"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_vf_core_run_artifact_executes_runtime_program(tmp_path: Path) -> None:
    artifact = tmp_path / "runtime_program.json"
    artifact.write_text(
        """{
  "schema": "vektorflow.native_runtime_program",
  "version": 1,
  "origin": "smoke",
  "initial_snapshot": {
    "revision": 0,
    "source": "",
    "error": "",
    "packets": [],
    "packet_count": 0
  },
  "steps": [
    {
      "kind": "BindStep",
      "target_name": "x",
      "type_expr": null,
      "value": { "kind": "NumberConstant", "text": "42" }
    },
    {
      "kind": "EmitStep",
      "value": { "kind": "BindingRef", "name": "x" }
    }
  ]
}
""",
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(VF_CORE_EXE), "run-artifact", str(artifact)],
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "42\n"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_build_native_core_artifact_runs_outside_repo_without_python_runtime_env(tmp_path: Path) -> None:
    build_dir = tmp_path / "build"
    artifact_dir = tmp_path / "artifact"
    exe = build_dir / "hello_native.exe"

    assert main(_native_core_build_args(HELLO_NATIVE, exe)) == 0
    assert exe.is_file()

    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_exe = artifact_dir / exe.name
    shutil.copy2(exe, artifact_exe)

    proc = subprocess.run(
        [str(artifact_exe)],
        cwd=artifact_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "42"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_build_runtime_bundle_runs_outside_repo_without_python_runtime_env(tmp_path: Path) -> None:
    build_dir = tmp_path / "build"
    exe = build_dir / "runtime_bundle.exe"
    source = tmp_path / "runtime_bundle.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["build-runtime", str(source), "-o", str(exe)]) == 0
    assert exe.is_file()
    artifact = exe.with_suffix(".vfprog.json")
    assert artifact.is_file()

    proc = subprocess.run(
        [str(exe)],
        cwd=build_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip() == "42"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_build_runtime_bundle_runs_after_relocation_with_sibling_artifact(tmp_path: Path) -> None:
    build_dir = tmp_path / "build"
    shipped_dir = tmp_path / "shipped"
    exe = build_dir / "runtime_bundle.exe"
    source = tmp_path / "runtime_bundle.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["build-runtime", str(source), "-o", str(exe)]) == 0
    artifact = exe.with_suffix(".vfprog.json")
    assert artifact.is_file()

    shipped_dir.mkdir(parents=True, exist_ok=True)
    shipped_exe = shipped_dir / exe.name
    shipped_artifact = shipped_dir / artifact.name
    shutil.copy2(exe, shipped_exe)
    shutil.copy2(artifact, shipped_artifact)

    proc = subprocess.run(
        [str(shipped_exe)],
        cwd=shipped_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "42\n"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_build_runtime_bundle_requires_sibling_artifact_at_runtime(tmp_path: Path) -> None:
    build_dir = tmp_path / "build"
    shipped_dir = tmp_path / "shipped"
    exe = build_dir / "runtime_bundle.exe"
    source = tmp_path / "runtime_bundle.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["build-runtime", str(source), "-o", str(exe)]) == 0
    artifact = exe.with_suffix(".vfprog.json")
    assert artifact.is_file()

    shipped_dir.mkdir(parents=True, exist_ok=True)
    shipped_exe = shipped_dir / exe.name
    shutil.copy2(exe, shipped_exe)

    proc = subprocess.run(
        [str(shipped_exe)],
        cwd=shipped_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode != 0
    assert proc.stdout == ""
    assert ".vfprog.json" in proc.stderr
    assert "python" not in proc.stderr.lower()


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_build_runtime_bundle_executes_sibling_artifact_not_original_source(tmp_path: Path) -> None:
    build_dir = tmp_path / "build"
    exe = build_dir / "runtime_bundle.exe"
    source = tmp_path / "runtime_bundle.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["build-runtime", str(source), "-o", str(exe)]) == 0
    artifact = exe.with_suffix(".vfprog.json")
    assert artifact.is_file()

    source.write_text("x: 0\n:: x\n", encoding="utf-8")

    proc = subprocess.run(
        [str(exe)],
        cwd=build_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "42\n"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_package_runtime_creates_self_describing_bundle_without_python_target_dependency(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "bundle"
    source = tmp_path / "runtime_package.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["package-runtime", str(source), "-o", str(bundle_dir)]) == 0
    exe = bundle_dir / "runtime_package.exe"
    artifact = bundle_dir / "runtime_package.vfprog.json"
    launcher = bundle_dir / "launch.cmd"
    manifest = bundle_dir / "runtime-bundle-manifest.json"

    assert exe.is_file()
    assert artifact.is_file()
    assert launcher.is_file()
    assert manifest.is_file()

    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["schema"] == "vf-native-runtime-bundle"
    assert payload["python_required_on_target"] is False
    assert payload["entry_exe"] == exe.name
    assert payload["artifact"] == artifact.name
    assert payload["launcher"] == launcher.name

    proc = subprocess.run(
        [str(exe)],
        cwd=bundle_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "42\n"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_package_runtime_bundle_runs_after_relocation_without_source_tree(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "bundle"
    shipped_dir = tmp_path / "shipped"
    source = tmp_path / "runtime_package.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    assert main(["package-runtime", str(source), "-o", str(bundle_dir)]) == 0
    exe = bundle_dir / "runtime_package.exe"
    artifact = bundle_dir / "runtime_package.vfprog.json"
    assert exe.is_file()
    assert artifact.is_file()

    shipped_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exe, shipped_dir / exe.name)
    shutil.copy2(artifact, shipped_dir / artifact.name)
    source.unlink()
    shutil.rmtree(bundle_dir)

    proc = subprocess.run(
        [str(shipped_dir / exe.name)],
        cwd=shipped_dir,
        env=_sanitized_runtime_env(),
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "42\n"


@pytest.mark.skipif(not VF_CORE_EXE.is_file(), reason="native vf-core build not available")
def test_package_runtime_can_embed_overlay_bundle_when_explicitly_requested(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "bundle"
    source = tmp_path / "runtime_package.vkf"
    source.write_text("x: 42\n:: x\n", encoding="utf-8")

    fake_overlay = tmp_path / "vf-overlay-win64"
    (fake_overlay / "web").mkdir(parents=True, exist_ok=True)
    (fake_overlay / "vf-overlay.exe").write_text("fake-exe", encoding="utf-8")
    (fake_overlay / "web" / "index.html").write_text("<html></html>\n", encoding="utf-8")

    assert (
        main(
            [
                "package-runtime",
                str(source),
                "-o",
                str(bundle_dir),
                "--overlay-bundle",
                str(fake_overlay),
            ]
        )
        == 0
    )

    exe = bundle_dir / "runtime_package.exe"
    artifact = bundle_dir / "runtime_package.vfprog.json"
    manifest = bundle_dir / "runtime-bundle-manifest.json"
    overlay_exe = bundle_dir / "overlay" / "vf-overlay.exe"
    overlay_index = bundle_dir / "overlay" / "web" / "index.html"
    overlay_launcher = bundle_dir / "launch-ui.cmd"

    assert exe.is_file()
    assert artifact.is_file()
    assert overlay_exe.is_file()
    assert overlay_index.is_file()
    assert overlay_launcher.is_file()

    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["overlay"]["bundle_dir"] == "overlay"
    assert payload["overlay"]["entry_exe"] == "overlay/vf-overlay.exe"
    assert payload["overlay"]["launcher"] == "launch-ui.cmd"


def test_native_scene_probe_source_compiles_to_overlay_scene_program() -> None:
    program = try_build_native_overlay_scene_program(NATIVE_SCENE_PROBE)

    assert program is not None
    assert program.page_rel == "sessions/ui-event-probe/vkf-scene.html"
    assert "MouseDown" in program.html_text
    assert '"kind": "scene.replace"' in program.runtime_packets_text
    assert '"title": "Input Surface"' in program.runtime_packets_text
    assert '"title": "Native Log"' in program.runtime_packets_text
    assert '"text": "ui_event_probe 2026-05-07 19:00 latest\\nwaiting for events...\\n"' in program.runtime_packets_text


def test_face_edge_vertex_drag_source_compiles_to_overlay_scene_program() -> None:
    program = try_build_native_overlay_scene_program(FACE_EDGE_VERTEX_DRAG)

    assert program is not None
    assert program.page_rel == "sessions/ui-face-edge-vertex-drag/vkf-scene.html"
    assert '"title": "Face / Edge / Vertex Drag"' in program.runtime_packets_text
    assert '"kind": "frame_upsert"' in program.runtime_packets_text
    assert '"aspect": "equal"' in program.runtime_packets_text
    assert '"id": "sentinel_frame"' in program.runtime_packets_text
    assert '"exit_counted": false' in program.runtime_packets_text
    assert '"id": "geom_frame"' in program.runtime_packets_text
    assert '"exit_counted": true' in program.runtime_packets_text
    assert '"edge_pairs": [[0, 1], [1, 2], [2, 3], [3, 0]]' in program.html_text
    assert "VfGeomLedger.createStore" in program.html_text
    assert "VfGeomLedger.createTransportStore" in program.html_text
    assert "VfGeomLedger.createRafPresenter" in program.html_text
    assert "VfGeomLedgerTransport.createSharedBufferTransport" in program.html_text
    assert "VfGeomLedger.createFaceEdgeVertexSharedStore" in program.html_text
    assert "VfGeomLedgerLayout.FACE_EDGE_VERTEX_STATE_FORMAT" in program.html_text
    assert 'fetch(TRANSPORT_PATH' in program.html_text
    assert 'shell.requestSharedBuffers("scene", config.frame_id);' in program.html_text
    assert 'shell.waitForSharedBuffers("scene", config.frame_id);' in program.html_text
    assert 'global.VfDisplay.mountLedgerGeomFrame' in program.html_text
    assert 'global.VfGeomLedger.createStore' in program.html_text
    assert 'global.VfGeomLedger.createTransportStore' in program.html_text
    assert 'global.VfGeomLedger.createRafPresenter' in program.html_text
    assert 'global.VfGeomLedger.createFaceEdgeVertexController' in program.html_text
    assert 'global.VfGeomLedger.createFaceEdgeVertexSharedStore' in program.html_text
    assert 'global.VfGeomLedgerTransport.createSharedBufferTransport' in program.html_text
    assert '"kind": "shared-buffer"' in program.geom_transport_text
    assert '"stateFormat": 1001' in program.geom_transport_text
    assert '"channel": "scene"' in program.geom_state_text
    assert '"name": "geom_frame"' in program.geom_state_text
    assert 'global.addEventListener("vf_event", handleVfEvent);' in program.html_text
    assert 'global.__vfLocalOnlyFrameEvents[config.frame_id] = true;' in program.html_text
    assert 'new global.ResizeObserver(function () {' in program.html_text
    assert 'body.querySelector("canvas.vf-geom-canvas")' in program.html_text
    assert "Number(canvas.width)" in program.html_text
    assert 'return controller.applyEvent(state, payload);' in program.html_text
    assert 'type: "field_mesh"' in program.html_text
    assert 'mode3d: false' in program.html_text
    assert 'transparent: !!transparent' in program.html_text
    assert 'pickable: !transparent' in program.html_text
    assert '"styles": {"face": {"base_color": [1.0, 0.0, 0.0, 1.0]' in program.html_text
    assert '"drag": {"face_vertices": [0, 1, 2, 3], "edge_vertices": [[0, 1], [1, 2], [2, 3], [3, 0]], "vertex_vertices": [[0], [1], [2], [3]], "preserve_selected_on_plain_down": true}' in program.html_text
    assert '"overlay_colors": {"selected": [1.0, 1.0, 0.2, 0.72], "hover": [1.0, 0.95, 0.35, 0.48], "none": [1.0, 0.0, 0.0, 0.0]}' in program.html_text
    assert '"overlay_colors": {"selected": [1.0, 1.0, 0.2, 0.78], "hover": [0.35, 1.0, 0.35, 0.54], "none": [0.0, 0.8, 0.0, 0.0]}' in program.html_text
    assert '"overlay_colors": {"selected": [1.0, 1.0, 0.2, 0.82], "hover": [1.0, 1.0, 1.0, 0.62], "none": [0.0, 0.4, 1.0, 0.0]}' in program.html_text
    assert '"base_scale": 0.01' in program.html_text
    assert '"overlay_scales": {"selected": 0.01, "hover": 0.01, "none": 0.01}' in program.html_text
    assert 'function styleState(kind, index) {' in program.html_text
    assert 'function styleColor(kind, layer, index) {' in program.html_text
    assert 'function styleScale(kind, layer, index) {' in program.html_text
    assert 'styleColor("face", "base", 0)' in program.html_text
    assert 'styleColor("face", "overlay", 0)' in program.html_text
    assert 'styleScale("edge", "base", edgeIndex)' in program.html_text
    assert 'styleScale("edge", "overlay", edgeIndex)' in program.html_text
    assert 'styleScale("vertex", "base", vertexIndex)' in program.html_text
    assert 'styleScale("vertex", "overlay", vertexIndex)' in program.html_text
    assert 'dragConfig: config.drag || {}' in program.html_text
    assert 'depth_write: true' in program.html_text
    assert 'alpha_provider: null' in program.html_text
    assert 'var UNIT_CIRCLE = makeUnitCircle(VERTEX_SEGMENTS);' in program.html_text
    assert 'function makeUnitCircle(segments) {' in program.html_text
    assert 'function writeCircleMesh(mesh, centerNorm, radius, segments, z, color) {' in program.html_text
    assert 'function writeCapsuleMesh(mesh, aNorm, bNorm, radiusNorm, z, color) {' in program.html_text
    assert 'function pushCircle(' not in program.html_text
    assert 'function pushCapsule(' not in program.html_text
    assert 'primitiveMeta.push({ kind: kind, index: index });' in program.html_text
    assert 'unified_renderer: true' in program.html_text
    assert '"geom": {}' in program.runtime_packets_text
    assert 'op: "polygon"' not in program.html_text
    assert 'op: "polyline"' not in program.html_text
    assert 'op: "point"' not in program.html_text


def test_package_runtime_can_package_supported_native_scene_probe_as_overlay_bundle(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "bundle"

    fake_overlay = tmp_path / "vf-overlay-win64"
    (fake_overlay / "web" / "sessions" / "old-run").mkdir(parents=True, exist_ok=True)
    (fake_overlay / "vf-overlay.exe").write_text("fake-exe", encoding="utf-8")
    (fake_overlay / "web" / "index.html").write_text("<html></html>\n", encoding="utf-8")
    (fake_overlay / "web" / "vf-runtime-packets.json").write_text('[{"seq":99,"kind":"stale"}]\n', encoding="utf-8")
    (fake_overlay / "web" / "vf-display.json").write_text('{"screen":[{"stale":true}]}\n', encoding="utf-8")
    (fake_overlay / "web" / "vkf-scene.json").write_text('[{"kind":"frame_upsert","id":"stale"}]\n', encoding="utf-8")
    (fake_overlay / "web" / "vf-ui-state.json").write_text('{"stale":true}\n', encoding="utf-8")
    (fake_overlay / "web" / "sessions" / "old-run" / "vkf-scene.html").write_text("<html>old</html>\n", encoding="utf-8")

    assert (
        main(
            [
                "package-runtime",
                str(NATIVE_SCENE_PROBE),
                "-o",
                str(bundle_dir),
                "--overlay-bundle",
                str(fake_overlay),
            ]
        )
        == 0
    )

    manifest = bundle_dir / "runtime-bundle-manifest.json"
    overlay_launcher = bundle_dir / "launch-ui.cmd"
    overlay_page = bundle_dir / "overlay" / "web" / "sessions" / "ui-event-probe" / "vkf-scene.html"
    overlay_packets = bundle_dir / "overlay" / "web" / "sessions" / "ui-event-probe" / "vf-runtime-packets.json"
    stale_session = bundle_dir / "overlay" / "web" / "sessions" / "old-run"
    root_packets = bundle_dir / "overlay" / "web" / "vf-runtime-packets.json"
    root_display = bundle_dir / "overlay" / "web" / "vf-display.json"
    display_js = bundle_dir / "overlay" / "web" / "vf-display.js"
    geom_ledger_js = bundle_dir / "overlay" / "web" / "geom" / "vf-geom-ledger.js"
    geom_ledger_transport_js = bundle_dir / "overlay" / "web" / "geom" / "vf-geom-ledger-transport.js"
    session_transport = bundle_dir / "overlay" / "web" / "sessions" / "ui-event-probe" / "vf-geom-ledger-transport.json"
    runtime_shell_js = bundle_dir / "overlay" / "web" / "vf-runtime-shell.js"

    assert manifest.is_file()
    assert overlay_launcher.is_file()
    assert overlay_page.is_file()
    assert overlay_packets.is_file()
    assert display_js.is_file()
    assert geom_ledger_js.is_file()
    assert geom_ledger_transport_js.is_file()
    assert runtime_shell_js.is_file()
    assert not session_transport.exists()
    assert not stale_session.exists()
    assert json.loads(root_packets.read_text(encoding="utf-8")) == []
    assert json.loads(root_display.read_text(encoding="utf-8")) == {"screen": [], "frames": {}, "geom": {}}

    payload = json.loads(manifest.read_text(encoding="utf-8"))
    assert payload["target_runtime"] == "native-vf-overlay-scene"
    assert payload["python_required_on_target"] is False
    assert payload["overlay"]["page"] == "sessions/ui-event-probe/vkf-scene.html"
    assert '"title": "Input Surface"' in overlay_packets.read_text(encoding="utf-8")
    assert "vf-runtime-shell.js" in overlay_page.read_text(encoding="utf-8")
    assert 'geom/vf-geom-ledger.js' in runtime_shell_js.read_text(encoding="utf-8")
    assert 'geom/vf-geom-ledger-transport.js' in runtime_shell_js.read_text(encoding="utf-8")


def test_package_runtime_packages_face_edge_vertex_transport_descriptor(tmp_path: Path) -> None:
    bundle_dir = tmp_path / "bundle"

    fake_overlay = tmp_path / "vf-overlay-win64"
    (fake_overlay / "web").mkdir(parents=True, exist_ok=True)
    (fake_overlay / "vf-overlay.exe").write_text("fake-exe", encoding="utf-8")
    (fake_overlay / "web" / "index.html").write_text("<html></html>\n", encoding="utf-8")

    assert (
        main(
            [
                "package-runtime",
                str(FACE_EDGE_VERTEX_DRAG),
                "-o",
                str(bundle_dir),
                "--overlay-bundle",
                str(fake_overlay),
            ]
        )
        == 0
    )

    session_transport = (
        bundle_dir / "overlay" / "web" / "sessions" / "ui-face-edge-vertex-drag" / "vf-geom-ledger-transport.json"
    )
    session_state = (
        bundle_dir / "overlay" / "web" / "sessions" / "ui-face-edge-vertex-drag" / "vf-geom-ledger-state.json"
    )
    assert session_transport.is_file()
    assert session_state.is_file()
    payload = json.loads(session_transport.read_text(encoding="utf-8"))
    assert payload["kind"] == "shared-buffer"
    assert payload["source"] == "session:geom_frame"
    state_payload = json.loads(session_state.read_text(encoding="utf-8"))
    assert state_payload["channel"] == "scene"
    assert state_payload["name"] == "geom_frame"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_cpp_native_core_emits_self_contained_runtime_source() -> None:
    rc, cpp_source = _run_cli_stdout(["cpp-native-core", str(HELLO_NATIVE)])

    assert rc == 0
    assert "#include <iostream>" in cpp_source
    assert "int main()" in cpp_source
    assert "vf_format_num" in cpp_source
    assert "vektorflow" not in cpp_source
    assert "python" not in cpp_source.lower()
    assert ".py" not in cpp_source
    assert "parse_token_stream_json" not in cpp_source
    assert "run_file" not in cpp_source
