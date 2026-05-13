from __future__ import annotations

from vektorflow.native_program_artifact import (
    NATIVE_PROGRAM_ARTIFACT_SCHEMA,
    NATIVE_PROGRAM_ARTIFACT_VERSION,
    emit_native_program_artifact_from_source_file,
    native_program_artifact_from_json,
)


def test_native_program_artifact_roundtrip_from_source_file(tmp_path) -> None:
    source = tmp_path / "hello_native_artifact.vkf"
    source.write_text(':: "hello, world"\n', encoding="utf-8")
    payload = emit_native_program_artifact_from_source_file(source)
    artifact = native_program_artifact_from_json(payload)

    assert artifact.origin == source.as_posix()
    assert len(artifact.module.statements) == 1
    stmt = artifact.module.statements[0]
    assert type(stmt).__name__ == "PrintStmt"
    assert getattr(stmt.value, "value", None) == "hello, world"


def test_native_program_artifact_envelope_is_versioned_json(tmp_path) -> None:
    source = tmp_path / "hello_native_artifact.vkf"
    source.write_text(':: "hello, world"\n', encoding="utf-8")
    payload = emit_native_program_artifact_from_source_file(source)

    assert f'"schema": "{NATIVE_PROGRAM_ARTIFACT_SCHEMA}"' in payload
    assert f'"version": {NATIVE_PROGRAM_ARTIFACT_VERSION}' in payload
    assert '"kind": "Module"' in payload
