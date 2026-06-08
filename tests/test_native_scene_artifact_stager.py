from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path


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
    assert '<script src="../../vf-runtime-shell.js"></script>' in html
    assert "window.__vfNativeSceneConfig=" + scene_config in html
    assert (session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"frames":[]}'
    assert (session_dir / "vf-geom-ledger-transport.json").read_text(encoding="utf-8") == "{}"
    assert (session_dir / "vf-geom-ledger-state.json").read_text(encoding="utf-8") == "{}"
    assert (session_dir / "vf-event-program.json").read_text(encoding="utf-8") == "{}"


def test_native_scene_artifact_stager_hash_includes_program_libs(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    lib_dir = source_dir / "lib"
    lib_dir.mkdir()
    source = source_dir / "main.vkf"
    source.write_text('native_scene_config_json: "{}"\n', encoding="utf-8")
    dependency = lib_dir / "native_scene.vkf"
    dependency.write_text('board: (texture: (kind: "checker"))\n', encoding="utf-8")
    overlay_web = tmp_path / "web"

    def run_stager() -> str:
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
    source.write_text(
        "\n".join(
            [
                "native_scene_config_json: '{\"kind\":\"scene_3d\",\"frame_id\":\"vkf_chess_board\"}'",
                "native_scene_runtime_packets_json: '{\"frames\":[{\"id\":\"vkf_chess_board\"}]}'",
                "native_scene: (kind:\"scene_3d\", frame_id:\"vkf_chess_board\")",
                "",
            ]
        ),
        encoding="utf-8",
    )
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
    assert 'window.__vfNativeSceneConfig={"kind":"scene_3d","frame_id":"vkf_chess_board"};' in html
    assert (session_dir / "vf-runtime-packets.json").read_text(encoding="utf-8") == '{"frames":[{"id":"vkf_chess_board"}]}'


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
    source.write_text(f"native_scene_config_json: '{scene_config}'\n", encoding="utf-8")
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
    source.write_text(f"native_scene_config_json: '{scene_config}'\n", encoding="utf-8")
    overlay_web = tmp_path / "web"

    command = [str(exe), "--source", str(source), "--overlay-web", str(overlay_web)]
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
    assert html_file.stat().st_mtime_ns == mtimes_before[html_file]


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


def test_native_scene_artifact_stager_recovers_json_from_cached_scene_html(tmp_path: Path) -> None:
    exe = _compile_or_skip(STAGER_SOURCE, tmp_path / "vkf_native_scene_artifact_stager.exe")
    source_dir = tmp_path / "program"
    source_dir.mkdir()
    source = source_dir / "main.vkf"
    cached_html = (
        '<!DOCTYPE html>\n'
        '<html><body><script>window.__vfNativeSceneConfigs = '
        '[{"scene_ir":{"frame":{"frame_id":"hidden","visible":false}}},'
        '{"scene_ir":{"frame":{"frame_id":"vkf_chess_board","visible":true}}}]'
        ';</script></body></html>'
    )
    source.write_text(
        "\n".join(
            [
                f"native_scene_config_json: '{cached_html}'",
                "native_scene: (kind:\"scene_3d\", frame_id:\"vkf_chess_board\")",
                "",
            ]
        ),
        encoding="utf-8",
    )
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

    html = (overlay_web / "sessions" / "main" / "vkf-scene.html").read_text(encoding="utf-8")
    assert "window.__vfNativeSceneConfigs=null" in html
    assert "window.__vfNativeSceneConfigsUrl=\"vf-native-scene-configs-" in html
    config_files = list((overlay_web / "sessions" / "main").glob("vf-native-scene-configs-*.json"))
    assert len(config_files) == 1
    assert config_files[0].read_text(encoding="utf-8").startswith("[{\"scene_ir\"")
    assert "window.__vfNativeSceneConfig=<!DOCTYPE html>" not in html
    assert html.count("<!DOCTYPE html>") == 1


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
