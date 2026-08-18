from __future__ import annotations

import hashlib
from pathlib import Path

from vektorflow import native_parser_proto


def test_native_parser_prototype_reuses_the_backend_planned_executable(
    monkeypatch, tmp_path: Path
) -> None:
    compile_calls = 0

    def fake_planned_cpp_artifacts(out_dir: Path, exe_name: str):
        out_dir.mkdir(parents=True, exist_ok=True)
        return object(), out_dir / f"{exe_name}.cpp", out_dir / exe_name

    def fake_compile_cpp_source(source: str, out_dir: Path, exe_name: str) -> Path:
        nonlocal compile_calls
        compile_calls += 1
        cpp_path = out_dir / f"{exe_name}.cpp"
        exe_path = out_dir / exe_name
        cpp_path.write_text(source, encoding="utf-8")
        exe_path.write_text("compiled", encoding="utf-8")
        return exe_path

    monkeypatch.setattr(native_parser_proto, "_native_parser_proto_cpp_source", lambda: "source")
    monkeypatch.setattr(native_parser_proto, "_native_parser_proto_cache_dirs", lambda: [tmp_path])
    monkeypatch.setattr(native_parser_proto, "planned_cpp_artifacts", fake_planned_cpp_artifacts)
    monkeypatch.setattr(native_parser_proto, "compile_cpp_source", fake_compile_cpp_source)

    first = native_parser_proto.build_native_parser_proto()
    second = native_parser_proto.build_native_parser_proto()

    digest = hashlib.sha1(b"source").hexdigest()[:12]
    assert first == second == tmp_path / f"vf_native_parser_proto_{digest}"
    assert compile_calls == 1
