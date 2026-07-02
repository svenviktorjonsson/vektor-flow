from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
STAGER_SOURCE = ROOT / "compiler" / "native" / "vkf_native_scene_artifact_stager.cpp"


def _compiler_command(source: Path, output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [path, "-std=c++17", str(source), "-o", str(output)]

    cl = shutil.which("cl")
    if cl is not None:
        return [cl, "/nologo", "/EHsc", "/std:c++17", str(source), f"/Fe:{output}"]

    return None


def _compile_or_skip(source: Path, output: Path) -> Path:
    command = _compiler_command(source, output)
    if command is None:
        import pytest

        pytest.skip("no C++ compiler found")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


def _fnv1a64_hex(data: bytes) -> str:
    value = 14695981039346656037
    for byte in data:
        value ^= byte
        value = (value * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def _native_scene_source_tree_hash(source: Path) -> str:
    chunks = [
        b"source\x00",
        source.resolve().as_posix().encode("utf-8"),
        b"\x00",
        source.read_bytes(),
    ]
    lib_dir = source.parent / "lib"
    if lib_dir.exists():
        for dependency in sorted(lib_dir.rglob("*.vkf"), key=lambda path: path.resolve().as_posix()):
            chunks.extend(
                [
                    b"\ndependency\x00",
                    dependency.resolve().as_posix().encode("utf-8"),
                    b"\x00",
                    dependency.read_bytes(),
                ]
            )
    return _fnv1a64_hex(b"".join(chunks))


def _write_generated_scene_config(source: Path, config_text: str) -> Path:
    cache_dir = source.parent / ".vkfbuild"
    cache_dir.mkdir(exist_ok=True)
    config_path = cache_dir / f"{source.stem}.native-scene-config.json"
    config_path.write_text(config_text, encoding="utf-8")
    config_path.with_name(config_path.name + ".source_hash").write_text(
        _native_scene_source_tree_hash(source) + "\n",
        encoding="utf-8",
    )
    return config_path


def test_native_scene_artifact_stager_writes_launcher_contract_without_python(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    source.write_text('native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")\n', encoding="utf-8")
    overlay_web = tmp_path / "web"
    scene_config = '{"kind":"scene_3d","frame_id":"vkf_chess_board"}'

    proc = subprocess.run(
        [
            str(exe),
            "--source",
            str(source),
            "--overlay-web",
            str(overlay_web),
            "--scene-config",
            scene_config,
            "--runtime-packets",
            '{"frames":[]}',
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    summary = json.loads(proc.stdout)
    expected_hash = _native_scene_source_tree_hash(source)
    manifest_path = source_dir / ".vkfbuild" / "main.manifest.json"
    session_dir = overlay_web / "sessions" / "main"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert summary["status"] == "compiled"
    assert summary["page_rel"] == "sessions/main/vkf-scene.html"
    assert summary["source_hash"] == expected_hash
    assert manifest["schema"] == "vektor-flow/native-scene-artifact"
    assert manifest["source_hash"] == expected_hash
    assert manifest["page_rel"] == "sessions/main/vkf-scene.html"
    html = (session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    assert "window.__vfRuntimeShellConfig=" in html
    assert '"geom/vf-geom-ledger.js"' in html
    assert '"geom/vf-geom-parametric-surface.js"' in html
    assert '"geom/vf-geom-wgpu.js"' in html
    assert '"vf-display.js"' in html
    assert "katex/katex.min.js" not in html
    assert "vf-widgets.js" not in html
    assert '<script src="../../vf-runtime-shell.js"></script>' in html
    assert "window.__vfNativeSceneConfig=" + scene_config in html
    assert (session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"frames":[]}'
    assert (session_dir / "vf-geom-ledger-transport.json").read_text(encoding="utf-8") == "{}"
    assert (session_dir / "vf-geom-ledger-state.json").read_text(encoding="utf-8") == "{}"
    assert (session_dir / "vf-event-program.json").read_text(encoding="utf-8") == "{}"


def test_native_scene_artifact_stager_lowers_native_scene_source_without_cache(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "grass.vkf"
    source.write_text(
        """
native_scene: (
    kind: "scene_3d",
    frame_id: "grass_texture_cube_frame",
    title: "Grass Texture Cube",
    rect: [0.08, 0.08, 0.78, 0.80],
    background: [0.36, 0.68, 1.0, 1.0],
    camera: (
        pos: [0.0, -7.2, 1.8],
        target: [0.0, -1.2, 2.25],
        fov: 64.0,
        controls_mode: "game"
    ),
    show_light_markers: true,
    light_flares: true,
    light_marker_size: 0.72,
    timing: (fps: 60, duration_seconds: 8.0, boundary: "repeat"),
    cubes: [
        (
            id: "grass_cube",
            center: [0.0, 0.0, -5.0],
            size: 10.0,
            texture: (kind: "grass", roughness: 0.92)
        )
    ],
    plane: (center: [0.0, 0.0], size: 0.01, z: -20.0, visible: false),
    lights: [
        (id: "sun", kind: "point", pos: [-2.8, 2.8, 5.8], intensity: 30.0)
    ],
    shadow: (enabled: true)
)
""".strip()
        + "\n",
        encoding="utf-8",
    )
    overlay_web = tmp_path / "web"

    proc = subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(overlay_web)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    summary = json.loads(proc.stdout)
    session_dir = overlay_web / "sessions" / "grass"
    manifest = json.loads((source_dir / ".vkfbuild" / "grass.manifest.json").read_text(encoding="utf-8"))
    html = (session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    packets = json.loads((session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8"))

    assert summary["scene_config_source"] == "vkf-native-scene-source-lowering"
    assert summary["runtime_packets_source"] == "vkf-native-scene-source-lowering"
    assert manifest["scene_config_source"] == "vkf-native-scene-source-lowering"
    assert manifest["runtime_packets_source"] == "vkf-native-scene-source-lowering"
    assert "native_scene_config_json is not allowed" not in html
    assert '"frame_id":"grass_texture_cube_frame"' in html
    assert '"id":"grass_cube"' in html
    assert '"kind":"grass"' in html
    assert packets[0]["payload"]["commands"][0]["payload"]["spec"]["id"] == "grass_texture_cube_frame"
    assert packets[0]["payload"]["commands"][0]["payload"]["spec"]["flags"]["use_browser"] is True


def test_native_scene_artifact_stager_hash_includes_program_libs(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    lib_dir = source_dir / "lib"
    lib_dir.mkdir()
    source = source_dir / "main.vkf"
    dependency = lib_dir / "native_scene.vkf"
    dependency.write_text('board: (texture: (kind: "checker"))\n', encoding="utf-8")
    source.write_text(
        "\n".join(
            [
                'native_scene_config_path: ".vkfbuild/main.native-scene-config.json"',
                'native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")',
                "",
            ]
        ),
        encoding="utf-8",
    )
    overlay_web = tmp_path / "web"

    def run_stager() -> str:
        _write_generated_scene_config(source, "{}")
        proc = subprocess.run(
            [str(exe), "--source", str(source), "--overlay-web", str(overlay_web)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(proc.stdout)["source_hash"]

    expected_first_hash = _native_scene_source_tree_hash(source)
    first_hash = run_stager()
    dependency.write_text('board: (texture: (kind: "chess_board"))\n', encoding="utf-8")
    expected_second_hash = _native_scene_source_tree_hash(source)
    second_hash = run_stager()

    assert first_hash == expected_first_hash
    assert second_hash == expected_second_hash
    assert second_hash != first_hash


def test_native_scene_artifact_stager_reads_vkf_scene_json_bindings(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    scene_config = '[{"scene_ir":{"frame":{"frame_id":"vkf_chess_board","title":"Board","rect":[0.1,0.2,0.3,0.4],"aspect":"equal","visible":true}}}]'
    source.write_text(
        "\n".join(
            [
                'native_scene_config_path: ".vkfbuild/main.native-scene-config.json"',
                "native_scene_runtime_packets_json: '{\"frames\":[{\"id\":\"vkf_chess_board\"}]}'",
                "native_scene: (kind:\"scene_3d\", frame_id:\"vkf_chess_board\")",
                "",
            ]
        ),
        encoding="utf-8",
    )
    _write_generated_scene_config(source, scene_config)
    overlay_web = tmp_path / "web"

    subprocess.run(
        [
            str(exe),
            "--source",
            str(source),
            "--overlay-web",
            str(overlay_web),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    session_dir = overlay_web / "sessions" / "main"
    html = (session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    assert '<script src="../../vf-runtime-shell.js"></script>' in html
    assert 'window.__vfNativeSceneConfigsUrl="vf-native-scene-configs-' in html
    assert "launchManifestUrl:\"vf-launch-manifest.json\"" in html
    assert "mountLaunchFramesFromUrl" in html
    launch_manifest = json.loads((session_dir / "vf-launch-manifest.json").read_text(encoding="utf-8"))
    assert launch_manifest["schema"] == "vektor-flow/launch-manifest"
    assert launch_manifest["frames"] == [
        {
            "id": "vkf_chess_board",
            "title": "Board",
            "rect": [0.1, 0.2, 0.3, 0.4],
            "aspect": "equal",
            "visible": True,
        }
    ]
    assert (session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"frames":[{"id":"vkf_chess_board"}]}'


def test_native_scene_artifact_stager_records_runtime_packet_path_provenance(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    packets_dir = source_dir / "runtime-packets"
    packets_dir.mkdir()
    packets = packets_dir / "main.vf-runtime-packets.json"
    packets.write_text('{"frames":[]}', encoding="utf-8")
    source = source_dir / "main.vkf"
    source.write_text(
        "\n".join(
            [
                'native_scene_runtime_packets_path: "runtime-packets/main.vf-runtime-packets.json"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    packets.with_name(packets.name + ".source_hash").write_text(
        _native_scene_source_tree_hash(source) + "\n",
        encoding="utf-8",
    )
    overlay_web = tmp_path / "web"

    proc = subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(overlay_web), "--scene-config", "{}"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    summary = json.loads(proc.stdout)
    manifest = json.loads((source_dir / ".vkfbuild" / "main.manifest.json").read_text(encoding="utf-8"))
    assert summary["runtime_packets_source"] == "path"
    assert manifest["runtime_packets_source"] == "path"
    assert manifest["runtime_packets_path"].endswith("runtime-packets/main.vf-runtime-packets.json")
    assert manifest["runtime_packets_source_hash_checked"] is True


def test_native_scene_artifact_stager_rejects_stale_runtime_packet_path_fingerprint(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    packets_dir = source_dir / "runtime-packets"
    packets_dir.mkdir()
    packets = packets_dir / "main.vf-runtime-packets.json"
    packets.write_text('{"frames":[]}', encoding="utf-8")
    source = source_dir / "main.vkf"
    source.write_text(
        "\n".join(
            [
                'native_scene_runtime_packets_path: "runtime-packets/main.vf-runtime-packets.json"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    packets.with_name(packets.name + ".source_hash").write_text("0000000000000000\n", encoding="utf-8")

    proc = subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(tmp_path / "web"), "--scene-config", "{}"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 1
    assert "native_scene_runtime_packets_path source fingerprint mismatch" in proc.stderr


def test_native_scene_artifact_stager_reads_vkf_scene_json_path(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    cache_dir = source_dir / ".vkfbuild"
    cache_dir.mkdir()
    scene_config = '[{"scene_ir":{"frame":{"frame_id":"vkf_chess_board","visible":true}}}]'
    (cache_dir / "main.native-scene-config.json").write_text(scene_config, encoding="utf-8")
    source = source_dir / "main.vkf"
    source.write_text(
        "\n".join(
            [
                'native_scene_config_path: ".vkfbuild/main.native-scene-config.json"',
                'native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")',
                "",
            ]
        ),
        encoding="utf-8",
    )
    (cache_dir / "main.native-scene-config.json.source_hash").write_text(
        _native_scene_source_tree_hash(source) + "\n",
        encoding="utf-8",
    )
    overlay_web = tmp_path / "web"

    subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(overlay_web)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    session_dir = overlay_web / "sessions" / "main"
    html = (session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    assert "window.__vfNativeSceneConfigs=null" in html
    config_files = list(session_dir.glob("vf-native-scene-configs-*.json"))
    assert len(config_files) == 1
    assert config_files[0].read_text(encoding="utf-8").strip() == scene_config


def test_native_scene_artifact_stager_refreshes_unchanged_artifact_mtime(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    scene_config = '{"kind":"scene_3d","frame_id":"vkf_chess_board"}'
    source.write_text(
        "\n".join(
            [
                'native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")',
                "",
            ]
        ),
        encoding="utf-8",
    )
    overlay_web = tmp_path / "web"

    command = [str(exe), "--source", str(source), "--overlay-web", str(overlay_web), "--scene-config", scene_config]
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    page = overlay_web / "sessions" / "main" / "vkf-scene.html"
    first_page_mtime = page.stat().st_mtime_ns

    time.sleep(0.05)
    source.write_text(source.read_text(encoding="utf-8") + "# same staged scene\n", encoding="utf-8")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)

    assert page.stat().st_mtime_ns > first_page_mtime
    assert page.stat().st_mtime_ns >= source.stat().st_mtime_ns


def test_native_scene_artifact_stager_externalizes_mesh_arrays_to_binary_arena(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    scene_config = (
        '[{"scene_ir":{"frame":{"frame_id":"vkf_chess_board","visible":true},'
        '"meshes":[{"kind":"field_mesh","properties":{"id":"piece","vertices":[1.0,2.0,3.0,0.0,0.0,1.0,1.0,0.8,0.6,1.0],'
        '"indices":[0,1,2]}}]}}]'
    )
    source = source_dir / "main.vkf"
    source.write_text('native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")\n', encoding="utf-8")
    overlay_web = tmp_path / "web"

    subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(overlay_web), "--scene-config", scene_config],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    session_dir = overlay_web / "sessions" / "main"
    html = (session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    config_files = list(session_dir.glob("vf-native-scene-configs-*.json"))
    arena_files = list(session_dir.glob("vf-native-scene-arena-*.bin"))
    assert len(config_files) == 1
    assert len(arena_files) == 1
    config_text = config_files[0].read_text(encoding="utf-8")
    assert "__vfNativeSceneArenaUrl" in html
    assert "indexedDB" not in html
    assert "data-vf-native-scene-error" in html
    assert "__vf_mesh_arena" in config_text
    assert '"vertices":[' not in config_text
    assert '"indices":[' not in config_text
    assert arena_files[0].stat().st_size == (10 * 4) + (3 * 4)


def test_native_scene_artifact_stager_hydrates_single_scene_binary_arena(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    scene_config = (
        '{"kind":"scene_3d","frame_id":"mirror_frame",'
        '"objects":[{"id":"piece","kind":"field_mesh",'
        '"vertices":[1.0,2.0,3.0,0.0,0.0,1.0,1.0,0.8,0.6,1.0],'
        '"indices":[0,1,2]}]}'
    )
    source = source_dir / "main.vkf"
    source.write_text('native_scene: (kind:"scene_3d", frame_id:"mirror_frame")\n', encoding="utf-8")
    overlay_web = tmp_path / "web"

    subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(overlay_web), "--scene-config", scene_config],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    session_dir = overlay_web / "sessions" / "main"
    html = (session_dir / "vkf-scene.html").read_text(encoding="utf-8")
    arena_files = list(session_dir.glob("vf-native-scene-arena-*.bin"))
    assert len(arena_files) == 1
    assert "__vfNativeSceneArenaUrl" in html
    assert "hydrateConfig(global.__vfNativeSceneConfig)" in html
    assert "assignArenaRef(holder,key,value,arena)" in html
    assert "__vf_mesh_arena" in html
    assert '"vertices":[' not in html
    assert '"indices":[' not in html
    assert arena_files[0].stat().st_size == (10 * 4) + (3 * 4)


def test_native_scene_artifact_stager_preserves_current_hashed_artifacts(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    scene_config = (
        '[{"scene_ir":{"frame":{"frame_id":"vkf_chess_board","visible":true},'
        '"meshes":[{"kind":"field_mesh","properties":{"id":"piece","vertices":[1.0,2.0,3.0,0.0,0.0,1.0,1.0,0.8,0.6,1.0],'
        '"indices":[0,1,2]}}]}}]'
    )
    source.write_text('native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")\n', encoding="utf-8")
    overlay_web = tmp_path / "web"

    command = [str(exe), "--source", str(source), "--overlay-web", str(overlay_web), "--scene-config", scene_config]
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)

    session_dir = overlay_web / "sessions" / "main"
    stale_config = session_dir / "vf-native-scene-configs-old.json"
    stale_config.write_text("stale", encoding="utf-8")
    config_file = next(session_dir.glob("vf-native-scene-configs-*.json"))
    arena_file = next(session_dir.glob("vf-native-scene-arena-*.bin"))
    html_file = session_dir / "vkf-scene.html"
    mtimes_before = {
        config_file: config_file.stat().st_mtime_ns,
        arena_file: arena_file.stat().st_mtime_ns,
        html_file: html_file.stat().st_mtime_ns,
    }

    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)

    assert not stale_config.exists()
    assert config_file.stat().st_mtime_ns == mtimes_before[config_file]
    assert arena_file.stat().st_mtime_ns == mtimes_before[arena_file]
    assert html_file.stat().st_mtime_ns >= mtimes_before[html_file]


def test_native_scene_artifact_stager_rejects_stale_generated_scene_config(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    lib_dir = source_dir / "lib"
    lib_dir.mkdir()
    config_path = source_dir / "native_scene_config.json"
    config_path.write_text("{}", encoding="utf-8")
    dependency = lib_dir / "native_scene.vkf"
    dependency.write_text('scene_speed: (piece_motion_units_per_second: 4.8)\n', encoding="utf-8")
    source = source_dir / "main.vkf"
    source.write_text(
        "\n".join(
            [
                'native_scene_config_path: "native_scene_config.json"',
                'native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")',
                "",
            ]
        ),
        encoding="utf-8",
    )
    (source_dir / "native_scene_config.json.source_hash").write_text("0000000000000000\n", encoding="utf-8")
    now = config_path.stat().st_mtime
    os.utime(config_path, (now, now))
    os.utime(dependency, (now + 10, now + 10))

    proc = subprocess.run(
        [str(exe), "--source", str(source), "--overlay-web", str(tmp_path / "web")],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 1
    assert "native_scene_config_path source fingerprint mismatch" in proc.stderr
    assert "rebuild the VKF scene config before staging" in proc.stderr


def test_native_scene_artifact_stager_rejects_inline_scene_config(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    source.write_text(
        "\n".join(
            [
                "native_scene_config_json: '{}'",
                "native_scene: (kind:\"scene_3d\", frame_id:\"vkf_chess_board\")",
                "",
            ]
        ),
        encoding="utf-8",
    )
    overlay_web = tmp_path / "web"

    proc = subprocess.run(
        [
            str(exe),
            "--source",
            str(source),
            "--overlay-web",
            str(overlay_web),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 1
    assert "native_scene_config_json is not allowed in VKF source" in proc.stderr


def test_native_scene_artifact_stager_writes_multi_view_scene_contract(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    source.write_text('native_scene: (kind:"scene_3d", frame_id:"vkf_chess_board")\n', encoding="utf-8")
    overlay_web = tmp_path / "web"
    scene_config = (
        '[{"scene_ir":{"frame":{"frame_id":"vkf_chess_board__surface_source_0","visible":false}}},'
        '{"scene_ir":{"frame":{"frame_id":"vkf_chess_board","visible":true}}}]'
    )

    subprocess.run(
        [
            str(exe),
            "--source",
            str(source),
            "--overlay-web",
            str(overlay_web),
            "--scene-config",
            scene_config,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    html = (overlay_web / "sessions" / "main" / "vkf-scene.html").read_text(encoding="utf-8")
    assert "window.__vfNativeSceneConfigs=null" in html
    config_files = list((overlay_web / "sessions" / "main").glob("vf-native-scene-configs-*.json"))
    assert len(config_files) == 1
    assert config_files[0].read_text(encoding="utf-8").strip() == scene_config
    assert "configs.sort(function(a,b){return (visible(b)?1:0)-(visible(a)?1:0);});" in html
    assert "function assignArenaRef(holder,key,value,arena)" in html
    assert "global.setTimeout(step,0)" in html
    assert "(nowMs()-start)<6.0" in html
    assert "global.__vfNativeSceneConfig=configs[index]" in html
    assert "var delay=index===0?200:0;global.setTimeout(function(){loadAt(index+1);},delay);" in html
    assert "vf-native-scene.js?view=" in html
    assert "loadAt(0)" in html


def test_native_scene_artifact_stager_axis_demo_uses_one_closable_frame(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    overlay_web = tmp_path / "web"

    subprocess.run(
        [
            str(exe),
            "--source",
            str(ROOT / "examples" / "100_axis_4_panel.vkf"),
            "--overlay-web",
            str(overlay_web),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    session_dir = overlay_web / "sessions" / "100-axis-4-panel"
    packets = json.loads((session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8"))
    commands = packets[0]["payload"]["commands"]
    frame_commands = [command for command in commands if command.get("kind") == "frame_upsert"]

    assert [command["id"] for command in frame_commands] == ["axis_deck"]
    deck_spec = frame_commands[0]["payload"]["spec"]
    assert deck_spec["flags"]["closable"] is True
    assert deck_spec["flags"]["draggable"] is True
    assert deck_spec["flags"]["resizable"] is True
    assert deck_spec["body_layout"] == {
        "type": "grid",
        "rows": 2,
        "cols": 12,
        "row_heights": "max-content minmax(0, 1fr)",
    }
    assert "axis_panel_" not in json.dumps(commands)
    options = deck_spec["body"][0]["options"]
    assert [option["value"] for option in options] == [
        "2d_crosshair",
        "2d_box",
        "2d_polar_crosshair",
        "3d_crosshair",
        "3d_box",
    ]
    assert {option["geom_frame"] for option in options} == {"axis_deck:axis_plot"}
    assert all("target_frame" not in option for option in options)
    assert deck_spec["body"][-1]["id"] == "axis_plot"
    assert deck_spec["body"][-1]["type"] == "plot_panel"
    assert deck_spec["body"][-1]["grid"] == [1, 0, 1, 12]
    assert deck_spec["body"][1]["axis_log_target_frames"] == ["axis_deck:axis_plot"]
    assert deck_spec["body"][2]["axis_log_target_frames"] == ["axis_deck:axis_plot"]
    assert deck_spec["body"][3]["axis_log_target_frames"] == ["axis_deck:axis_plot"]

    geom = packets[1]["payload"]["display"]["geom"]
    assert list(geom) == ["axis_deck:axis_plot"]
    assert geom["axis_deck:axis_plot"]["frame"] == "axis_deck:axis_plot"
    assert geom["axis_deck:axis_plot"]["active_geom_variant"] == "2d_crosshair"
    assert set(geom["axis_deck:axis_plot"]["geom_variants"]) == {
        "2d_crosshair",
        "2d_box",
        "2d_polar_crosshair",
        "3d_crosshair",
        "3d_box",
    }
    expected_formula_texts = {
        "2d_crosshair": "$y=\\sin(x)$",
        "2d_box": "$y=0.65\\cos(x)e^{-x^{2}}-0.25$",
        "2d_polar_crosshair": "$r=0.08+0.13\\phi$",
        "3d_crosshair": "$z=u^{2}-v^{2}$",
        "3d_box": "$z=\\sin(u)\\cos(v)$",
    }
    for mode, formula in expected_formula_texts.items():
        texts = geom["axis_deck:axis_plot"]["geom_variants"][mode]["texts"]
        assert texts[0]["text"] == formula
        assert texts[0]["pixel"] is True
    box_meshes = geom["axis_deck:axis_plot"]["geom_variants"]["2d_box"]["meshes"]
    box_curve = next(mesh for mesh in box_meshes if mesh.get("axis_plot2d"))
    box_x_values = box_curve["axis_plot2d"]["x_values"]
    box_y_values = box_curve["axis_plot2d"]["y_values"]
    assert len(box_x_values) == 65
    assert len(box_y_values) == 65
    assert len(box_curve["indices"]) == 128
    assert max(box_y_values) == 0.4
    assert min(box_y_values) < 0
    assert 1 not in box_y_values
    polar_meshes = geom["axis_deck:axis_plot"]["geom_variants"]["2d_polar_crosshair"]["meshes"]
    polar_curve = next(mesh for mesh in polar_meshes if mesh.get("axis_plot2d"))
    polar_x_values = polar_curve["axis_plot2d"]["x_values"]
    polar_y_values = polar_curve["axis_plot2d"]["y_values"]
    polar_r_values = polar_curve["axis_plot2d"]["r_values"]
    polar_phi_values = polar_curve["axis_plot2d"]["phi_values"]
    assert len(polar_x_values) == 129
    assert len(polar_y_values) == 129
    assert len(polar_r_values) == 129
    assert len(polar_phi_values) == 129
    assert len(polar_curve["indices"]) == 256
    assert polar_x_values[0] == 0.08
    assert polar_y_values[0] == 0
    assert polar_r_values[0] == 0.08
    assert polar_phi_values[0] == 0
    assert polar_x_values[64] == -0.48841
    assert polar_y_values[64] == 0
    assert polar_r_values[64] == pytest.approx(0.488407)
    assert polar_phi_values[64] == pytest.approx(3.14159265359)
    assert polar_x_values[-1] == 0.89681
    assert polar_y_values[-1] == 0
    assert polar_r_values[-1] == pytest.approx(0.896814)
    assert polar_phi_values[-1] == pytest.approx(6.28318530718)
    meshes = geom["axis_deck:axis_plot"]["meshes"]
    controller = next(mesh for mesh in meshes if mesh.get("axis_ticks"))
    ticks = controller["axis_ticks"]
    assert ticks["x_min"] == -1
    assert ticks["x_max"] == 1
    assert ticks["y_min"] == -1
    assert ticks["y_max"] == 1
    assert ticks["x_label"] == "x"
    assert ticks["y_label"] == "y"
    assert ticks["x_tick_label_placement"] == "below"
    assert ticks["y_tick_label_placement"] == "left"
    assert ticks["grid"] is True
    assert ticks["grid_alpha"] == 0.16


def test_axis_demo_controls_stay_above_geom_canvas() -> None:
    display_runtime = (ROOT / "web" / "vf-ui" / "vf-display.js").read_text(encoding="utf-8")
    frame_css = (ROOT / "web" / "vf-ui" / "vf-frame.css").read_text(encoding="utf-8")
    widgets_runtime = (ROOT / "web" / "vf-ui" / "vf-widgets.js").read_text(encoding="utf-8")

    assert "z-index:0;pointer-events:auto" in display_runtime
    assert "nextFrameGeom.active_geom_variant = prevFrameGeom.active_geom_variant" in display_runtime
    assert 'setAttribute("data-vf-active-geom-variant", requested)' in display_runtime
    assert "requestAnimationFrame(function ()" in widgets_runtime
    assert "global.setTimeout(function () { applyGeomVariant(geomFrame, geomValue); }, 50)" in widgets_runtime
    assert ".vf-frame__body.vf-w-grid > *:not(.vf-frame__draw-canvas):not(.vf-geom-canvas):not(.vf-frame__overlay)" in frame_css
    assert ".vf-frame__body.vf-w-stack > *:not(.vf-frame__draw-canvas):not(.vf-geom-canvas)" in frame_css
