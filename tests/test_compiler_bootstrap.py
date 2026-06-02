from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from vektorflow.compiler_bootstrap import (
    COMPILER_BOOTSTRAP_FILENAME,
    COMPILER_BOOTSTRAP_SCHEMA,
    COMPILER_BOOTSTRAP_VERSION,
    build_compiler_bootstrap_manifest,
    compiler_bootstrap_sources,
    write_compiler_bootstrap_manifest,
    write_compiler_bootstrap_manifest_text,
)


ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_bootstrap_manifest_smoke.cpp"
BOOTSTRAP_BUNDLE_LEXER_SOURCE = ROOT / "compiler" / "native" / "vkf_bootstrap_bundle_lexer_smoke.cpp"
BOOTSTRAP_BUNDLE_PARSER_SOURCE = ROOT / "compiler" / "native" / "vkf_bootstrap_bundle_parser_smoke.cpp"
BOOTSTRAP_BUNDLE_ARTIFACT_SOURCE = ROOT / "compiler" / "native" / "vkf_bootstrap_bundle_artifact_smoke.cpp"
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"


def _compiler_command(sources: list[Path], output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-I",
                str(ROOT),
                "-I",
                str(ROOT / "native" / "VfOverlay"),
                *[str(source) for source in sources],
                "-o",
                str(output),
            ]

    cl = shutil.which("cl")
    if cl is not None:
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{ROOT}",
            f"/I{ROOT / 'native' / 'VfOverlay'}",
            *[str(source) for source in sources],
            f"/Fe:{output}",
        ]

    return None


def _compile_or_skip(sources: list[Path], output: Path) -> Path:
    command = _compiler_command(sources, output)
    if command is None:
        import pytest

        pytest.skip("no C++ compiler found")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


def test_compiler_bootstrap_sources_follow_declared_handoff_order() -> None:
    assert [path.relative_to(ROOT).as_posix() for path in compiler_bootstrap_sources(ROOT)] == [
        "compiler/self_hosted/lexer.vkf",
        "compiler/self_hosted/parser.vkf",
        "compiler/self_hosted/typed_ir.vkf",
        "compiler/self_hosted/compiler.vkf",
        "compiler/self_hosted/stdlib.vkf",
        "compiler/self_hosted/stdlib/math.vkf",
        "compiler/self_hosted/stdlib/io.vkf",
    ]


def test_compiler_bootstrap_manifest_declares_native_parser_handoff() -> None:
    manifest = build_compiler_bootstrap_manifest(ROOT)

    assert manifest["schema"] == COMPILER_BOOTSTRAP_SCHEMA
    assert manifest["version"] == COMPILER_BOOTSTRAP_VERSION
    assert manifest["bootstrap_boundary"] == {
        "parser": "native-bootstrap",
        "scope": "self-hosted compiler source set",
        "handoff_goal": "next compiler change parsed by VKF-owned native compiler path",
    }
    assert manifest["source_count"] == 7
    assert manifest["source_order"] == [entry["path"] for entry in manifest["sources"]]
    assert len(manifest["bundle_sha256"]) == 64

    for entry in manifest["sources"]:
        assert entry["parsed_with_native_parser"] is True
        assert len(entry["source_sha256"]) == 64
        assert "ast_repr_sha256" not in entry
        assert "parsed_with_bootstrap_parser" not in entry
        assert (ROOT / entry["path"]).is_file()


def test_compiler_bootstrap_manifest_writer_round_trips_json_text(tmp_path: Path) -> None:
    manifest = build_compiler_bootstrap_manifest(ROOT)

    text = write_compiler_bootstrap_manifest_text(manifest)
    payload = json.loads(text)
    assert payload == manifest

    out = write_compiler_bootstrap_manifest(tmp_path, manifest)
    assert out.name == COMPILER_BOOTSTRAP_FILENAME
    assert out == tmp_path / "compiler" / "self_hosted" / COMPILER_BOOTSTRAP_FILENAME
    assert json.loads(out.read_text(encoding="utf-8")) == manifest


def test_native_bootstrap_manifest_smoke_consumes_declared_compiler_bundle(tmp_path: Path) -> None:
    exe = _compile_or_skip([BOOTSTRAP_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_bootstrap_manifest_smoke.exe")
    manifest = build_compiler_bootstrap_manifest(ROOT)
    manifest_path = write_compiler_bootstrap_manifest(ROOT, manifest)

    proc = subprocess.run(
        [str(exe), str(manifest_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    payload = json.loads(proc.stdout)
    assert payload["schema"] == COMPILER_BOOTSTRAP_SCHEMA
    assert payload["version"] == COMPILER_BOOTSTRAP_VERSION
    assert payload["bootstrap_parser"] == "native-bootstrap"
    assert payload["handoff_goal"] == "next compiler change parsed by VKF-owned native compiler path"
    assert payload["source_count"] == 7
    assert len(payload["bundle_sha256"]) == 64
    assert [entry["path"] for entry in payload["sources"]] == manifest["source_order"]
    assert all(entry["parsed_with_native_parser"] is True for entry in payload["sources"])


def test_native_bootstrap_manifest_smoke_emits_compiler_bundle_in_declared_order(tmp_path: Path) -> None:
    exe = _compile_or_skip([BOOTSTRAP_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_bootstrap_manifest_bundle.exe")
    manifest = build_compiler_bootstrap_manifest(ROOT)
    manifest_path = write_compiler_bootstrap_manifest(ROOT, manifest)

    proc = subprocess.run(
        [str(exe), "--emit-bundle", str(manifest_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    payload = json.loads(proc.stdout)
    bundle_units = payload["bundle_units"]
    assert [unit["path"] for unit in bundle_units] == manifest["source_order"]
    assert all(unit["source_text"] == (ROOT / unit["path"]).read_text(encoding="utf-8").replace("\r\n", "\n") for unit in bundle_units)


def test_native_bootstrap_bundle_lexer_smoke_tokenizes_declared_compiler_bundle(tmp_path: Path) -> None:
    bundle_lexer_exe = _compile_or_skip(
        [BOOTSTRAP_BUNDLE_LEXER_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_bootstrap_bundle_lexer_smoke.exe",
    )
    lexer_exe = _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe")
    manifest = build_compiler_bootstrap_manifest(ROOT)
    manifest_path = write_compiler_bootstrap_manifest(ROOT, manifest)

    proc = subprocess.run(
        [str(bundle_lexer_exe), "--manifest", str(manifest_path), "--lexer", str(lexer_exe)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    payload = json.loads(proc.stdout)
    assert payload["schema"] == COMPILER_BOOTSTRAP_SCHEMA
    assert payload["version"] == COMPILER_BOOTSTRAP_VERSION
    assert payload["source_count"] == 7
    assert [unit["path"] for unit in payload["units"]] == manifest["source_order"]
    for unit in payload["units"]:
        token_path = Path(unit["token_path"])
        assert token_path.is_file()
        token_payload = json.loads(token_path.read_text(encoding="utf-8"))
        assert token_payload["schema"] == "vektorflow.token_stream"
        assert token_payload["version"] == 1
        assert token_payload["tokens"][-1]["kind"] == "EOF"


def test_native_bootstrap_bundle_parser_smoke_parses_declared_compiler_bundle(tmp_path: Path) -> None:
    bundle_parser_exe = _compile_or_skip(
        [BOOTSTRAP_BUNDLE_PARSER_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_bootstrap_bundle_parser_smoke.exe",
    )
    lexer_exe = _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe")
    parser_exe = _compile_or_skip([PARSER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_parser_token_stream_smoke.exe")
    manifest = build_compiler_bootstrap_manifest(ROOT)
    manifest_path = write_compiler_bootstrap_manifest(ROOT, manifest)

    proc = subprocess.run(
        [
            str(bundle_parser_exe),
            "--manifest",
            str(manifest_path),
            "--lexer",
            str(lexer_exe),
            "--parser",
            str(parser_exe),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    payload = json.loads(proc.stdout)
    assert payload["schema"] == COMPILER_BOOTSTRAP_SCHEMA
    assert payload["version"] == COMPILER_BOOTSTRAP_VERSION
    assert payload["source_count"] == 7
    assert payload["status"] == "ok"
    assert payload["parsed_count"] == payload["source_count"]
    assert [unit["path"] for unit in payload["units"]] == manifest["source_order"]
    assert payload.get("failure") is None
    for unit in payload["units"]:
        assert Path(unit["token_path"]).is_file()
        assert Path(unit["ast_path"]).is_file()


def test_native_bootstrap_bundle_artifact_smoke_emits_placeholder_artifacts_for_declared_compiler_bundle(tmp_path: Path) -> None:
    bundle_artifact_exe = _compile_or_skip(
        [BOOTSTRAP_BUNDLE_ARTIFACT_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_bootstrap_bundle_artifact_smoke.exe",
    )
    lexer_exe = _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe")
    parser_exe = _compile_or_skip([PARSER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_parser_token_stream_smoke.exe")
    ir_exe = _compile_or_skip([AST_TO_IR_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_ast_to_ir_smoke.exe")
    manifest = build_compiler_bootstrap_manifest(ROOT)
    manifest_path = write_compiler_bootstrap_manifest(ROOT, manifest)

    proc = subprocess.run(
        [
            str(bundle_artifact_exe),
            "--manifest",
            str(manifest_path),
            "--lexer",
            str(lexer_exe),
            "--parser",
            str(parser_exe),
            "--ir",
            str(ir_exe),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    payload = json.loads(proc.stdout)
    assert payload["schema"] == COMPILER_BOOTSTRAP_SCHEMA
    assert payload["version"] == COMPILER_BOOTSTRAP_VERSION
    assert payload["status"] == "ok"
    assert payload["artifact_count"] == payload["source_count"] == 7
    assert [unit["path"] for unit in payload["units"]] == manifest["source_order"]
    for unit in payload["units"]:
        assert Path(unit["token_path"]).is_file()
        assert Path(unit["ast_path"]).is_file()
        assert Path(unit["typed_ir_path"]).is_file()
        artifact_path = Path(unit["artifact_path"])
        manifest_path = Path(unit["manifest_path"])
        assert artifact_path.is_file()
        assert manifest_path.is_file()
        assert "bootstrap compiler bundle artifact placeholder" in artifact_path.read_text(encoding="utf-8")
