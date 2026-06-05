from __future__ import annotations

import json
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
    expected_hash = _fnv1a64_hex(source.read_bytes())
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
    assert "window.__vfNativeSceneConfigs=[{\"scene_ir\"" in html
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
    assert "window.__vfNativeSceneConfigs=" + scene_config in html
    assert "configs.sort(function(a,b){return (visible(b)?1:0)-(visible(a)?1:0);});" in html
    assert "global.__vfNativeSceneConfig=configs[index]" in html
    assert "var delay=index===0?200:0;global.setTimeout(function(){loadAt(index+1);},delay);" in html
    assert "vf-native-scene.js?view=" in html
    assert "loadAt(0)" in html
