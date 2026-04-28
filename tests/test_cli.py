"""Tests for the ``vkf`` CLI."""

from __future__ import annotations

from pathlib import Path
import subprocess
import json

import pytest

from vektorflow.cli import main, resolve_vkf_path
from vektorflow.cpp_backend import (
    compile_cpp_source,
    discover_cpp_compiler,
    emit_cpp_from_source_file,
    run_cpp_executable,
)
from vektorflow.lexer import tokenize
from vektorflow.parser import parse_module
from vektorflow.token_stream import token_stream_to_json, tokens_to_json
from tests.token_stream_fixture_helper import (
    BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
    INVALID_TOKEN_STREAM_ENVELOPE_CASES,
    MALFORMED_TOKEN_ENTRY_CASES,
    assert_cli_rejects_token_stream_object,
    assert_cli_rejects_token_stream,
    assert_cli_parse_tokens_output_matches_source,
    assert_fixture_boundary_parity,
    native_core_fixture_cases,
    token_fixture_case,
)

ROOT = Path(__file__).resolve().parent.parent
HELLO = ROOT / "examples" / "hello.vkf"
FOLDER_REPO_MAIN = ROOT / "examples" / "folder_repo" / "main.vkf"
NATIVE_CORE = ROOT / "examples" / "native_core"
NATIVE_CORE_EXAMPLES = [
    "hello_native.vkf",
    "vectors_native.vkf",
    "records_native.vkf",
    "numeric_native.vkf",
    "named_record_native.vkf",
    "named_record_nested_native.vkf",
    "named_record_collections_native.vkf",
    "named_record_scene_native.vkf",
]
EXPANDED_NATIVE_FRONTEND_PARSE_EXAMPLES = [
    ROOT / "examples" / "benchmarks" / "bitmask_match.vkf",
    ROOT / "examples" / "benchmarks" / "multisets_records.vkf",
    ROOT / "examples" / "benchmarks" / "stdlib_numeric.vkf",
    ROOT / "examples" / "benchmarks" / "records_dynamic.vkf",
    ROOT / "examples" / "benchmarks" / "custom_overloads.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_elementwise.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf",
    ROOT / "examples" / "benchmarks" / "vectors_shapes.vkf",
    ROOT / "examples" / "nested" / "app.vkf",
    ROOT / "examples" / "folder_repo" / "main.vkf",
]
EXPANDED_NATIVE_FRONTEND_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "benchmarks" / "bitmask_match.vkf",
    ROOT / "examples" / "benchmarks" / "multisets_records.vkf",
    ROOT / "examples" / "benchmarks" / "stdlib_numeric.vkf",
    ROOT / "examples" / "benchmarks" / "records_dynamic.vkf",
    ROOT / "examples" / "benchmarks" / "custom_overloads.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_elementwise.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf",
    ROOT / "examples" / "benchmarks" / "vectors_shapes.vkf",
]
EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES = [
    ROOT / "examples" / "benchmarks" / "bitmask_match.vkf",
    ROOT / "examples" / "benchmarks" / "multisets_records.vkf",
    ROOT / "examples" / "benchmarks" / "stdlib_numeric.vkf",
    ROOT / "examples" / "benchmarks" / "records_dynamic.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_elementwise.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf",
    ROOT / "examples" / "benchmarks" / "vectors_shapes.vkf",
]


def _short_artifact_stem(name: str, prefix: str) -> str:
    stem = Path(name).stem
    compact = (
        stem.replace("named_record", "nr")
        .replace("vector", "vec")
        .replace("scalar", "sca")
        .replace("collections", "cols")
        .replace("native", "n")
    )
    compact = "".join(ch for ch in compact if ch.isalnum() or ch == "_")
    return f"{prefix}_{compact[:20]}"


class TestResolveVkfPath:
    def test_explicit_vkf(self) -> None:
        assert resolve_vkf_path(str(HELLO)) == HELLO.resolve()

    def test_basename_without_extension(self) -> None:
        # examples/hello resolves to examples/hello.vkf
        assert resolve_vkf_path(str(ROOT / "examples" / "hello")) == HELLO.resolve()

    def test_missing_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            resolve_vkf_path("definitely_missing_file_xyz")


class TestMain:
    def test_run_hello(self) -> None:
        assert main([str(HELLO)]) == 0

    def test_run_short_name(self) -> None:
        assert main([str(ROOT / "examples" / "hello")]) == 0

    def test_run_folder_repo_main(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Regression: bind + emit on the next line must not join across newlines."""
        assert main([str(FOLDER_REPO_MAIN)]) == 0
        assert capsys.readouterr().out.strip() == "42"

    def test_tokens_subcommand(self) -> None:
        rc = main(["tokens", str(HELLO)])
        assert rc == 0

    def test_tokens_subcommand_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["tokens", str(HELLO), "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        assert "tokens" in payload
        assert payload["tokens"][0]["kind"] == "EMIT"
        assert payload["tokens"][1]["kind"] == "STRING"

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_subcommand_json_matches_python(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "hello_native.vkf"
        assert main(["tokens-native-core", str(path), "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        expected = json.loads(
            token_stream_to_json(tokenize(path.read_text(encoding="utf-8"), filename=path.as_posix()))
        )
        assert payload == expected

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_subcommand_stdin_matches_python(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        src = ":: 6 * 7\n"
        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["tokens-native-core", "-", "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        expected = json.loads(token_stream_to_json(tokenize(src, filename="<stdin>")))
        assert payload == expected

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_subcommand_file_and_stdin_match_same_payload(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "hello_native.vkf"
        src = path.read_text(encoding="utf-8")

        assert main(["tokens-native-core", str(path), "--json"]) == 0
        file_payload = json.loads(capsys.readouterr().out)

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["tokens-native-core", "-", "--json"]) == 0
        stdin_payload = json.loads(capsys.readouterr().out)

        for payload in (file_payload, stdin_payload):
            for token in payload["tokens"]:
                token["location"]["file"] = "<normalized>"

        assert stdin_payload == file_payload

    def test_tokens_unknown_file(self) -> None:
        assert main(["tokens", "nope_not_a_file"]) == 1

    def test_parse_tokens_subcommand_file(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path
    ) -> None:
        src = ":: 3 + 4\n"
        payload_path = tmp_path / "tokens.json"
        payload_path.write_text(tokens_to_json(tokenize(src, filename="<test>")), encoding="utf-8")

        assert main(["parse-tokens", str(payload_path)]) == 0
        assert capsys.readouterr().out.strip() == repr(parse_module(src, filename="<test>"))

    def test_parse_tokens_subcommand_stdin(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        src = "x: 2\n:: x\n"
        payload = tokens_to_json(tokenize(src, filename="<stdin-tokens>"))
        monkeypatch.setattr("sys.stdin.read", lambda: payload)

        assert main(["parse-tokens", "-"]) == 0
        assert capsys.readouterr().out.strip() == repr(parse_module(src, filename="<stdin-tokens>"))

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_parse_native_core_subcommand_file(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "hello_native.vkf"
        assert main(["parse-native-core", str(path)]) == 0
        assert capsys.readouterr().out.strip() == repr(
            parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_parse_native_core_subcommand_stdin(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        src = ":: 6 * 7\n"
        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["parse-native-core", "-"]) == 0
        assert capsys.readouterr().out.strip() == repr(parse_module(src, filename="<stdin>"))

    @pytest.mark.parametrize("payload, expected", INVALID_TOKEN_STREAM_ENVELOPE_CASES)
    def test_parse_tokens_subcommand_invalid_payload(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, payload: dict[str, object], expected: str
    ) -> None:
        _ = capsys.readouterr()
        assert_cli_rejects_token_stream_object(tmp_path, payload, expected)

    @pytest.mark.parametrize(
        "payload_text, expected",
        BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
    )
    def test_parse_tokens_subcommand_bad_top_level_json(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, payload_text: str, expected: str
    ) -> None:
        _ = capsys.readouterr()
        assert_cli_rejects_token_stream(tmp_path, payload_text, expected)

    def test_parse_tokens_subcommand_versioned_fixture(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case = token_fixture_case("versioned_loose_dot_bind.json")
        assert_fixture_boundary_parity(case)
        assert main(["parse-tokens", str(case.payload_path)]) == 0
        assert_cli_parse_tokens_output_matches_source(case, capsys.readouterr().out)

    def test_parse_tokens_subcommand_legacy_fixture(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case = token_fixture_case("legacy_singleton_tuple_type.json")
        assert_fixture_boundary_parity(case)
        assert main(["parse-tokens", str(case.payload_path)]) == 0
        assert_cli_parse_tokens_output_matches_source(case, capsys.readouterr().out)

    @pytest.mark.parametrize("case", native_core_fixture_cases(), ids=lambda case: case.name)
    def test_parse_tokens_subcommand_native_core_fixture_roundtrip(
        self, capsys: pytest.CaptureFixture[str], case
    ) -> None:
        assert_fixture_boundary_parity(case)
        assert main(["parse-tokens", str(case.payload_path)]) == 0
        assert_cli_parse_tokens_output_matches_source(case, capsys.readouterr().out)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "example_name",
        NATIVE_CORE_EXAMPLES,
    )
    def test_parse_native_core_examples_match_python_parser(
        self, capsys: pytest.CaptureFixture[str], example_name: str
    ) -> None:
        path = NATIVE_CORE / example_name
        assert main(["parse-native-core", str(path)]) == 0
        assert capsys.readouterr().out.strip() == repr(
            parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        EXPANDED_NATIVE_FRONTEND_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_expanded_examples_match_python(
        self, capsys: pytest.CaptureFixture[str], path: Path
    ) -> None:
        assert main(["tokens-native-core", str(path), "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        expected = json.loads(
            token_stream_to_json(tokenize(path.read_text(encoding="utf-8"), filename=path.as_posix()))
        )
        assert payload == expected

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        EXPANDED_NATIVE_FRONTEND_PARSE_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_parse_native_core_expanded_examples_match_python_parser(
        self, capsys: pytest.CaptureFixture[str], path: Path
    ) -> None:
        assert main(["parse-native-core", str(path)]) == 0
        assert capsys.readouterr().out.strip() == repr(
            parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        EXPANDED_NATIVE_FRONTEND_PARSE_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_parse_native_core_expanded_examples_stdin_matches_file_output(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        path: Path,
    ) -> None:
        src = path.read_text(encoding="utf-8")

        assert main(["parse-native-core", str(path)]) == 0
        file_output = capsys.readouterr().out.strip()

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["parse-native-core", "-"]) == 0
        stdin_output = capsys.readouterr().out.strip()

        assert stdin_output == file_output

    @pytest.mark.parametrize("payload, expected", MALFORMED_TOKEN_ENTRY_CASES)
    def test_parse_tokens_subcommand_malformed_token_entry(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, payload: dict[str, object], expected: str
    ) -> None:
        _ = capsys.readouterr()
        assert_cli_rejects_token_stream_object(tmp_path, payload, expected)

    def test_cpp_subcommand_stdout(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        src = tmp_path / "native_scalar.vkf"
        src.write_text(
            "twice(x:num) -> num:\n"
            "    x * 2\n\n"
            "num a: 3\n"
            ":: twice(a)\n",
            encoding="utf-8",
        )
        assert main(["cpp", str(src)]) == 0
        out = capsys.readouterr().out
        assert "double twice(double x)" in out
        assert 'std::cout << vf_format_num(twice(a)) << "\\n";' in out

    def test_cpp_subcommand_output_file(self, tmp_path: Path) -> None:
        src = tmp_path / "native_vec.vkf"
        out = tmp_path / "native_vec.cpp"
        src.write_text(
            "[num:2] a: [1,2]\n"
            "[num:2] b: [3,4]\n"
            ":: a + b\n",
            encoding="utf-8",
        )
        assert main(["cpp", str(src), "-o", str(out)]) == 0
        emitted = out.read_text(encoding="utf-8")
        assert "std::array<double, 2> a" in emitted
        assert "for (std::size_t vf_i = 0; vf_i < 2; ++vf_i)" in emitted

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", NATIVE_CORE_EXAMPLES)
    def test_cpp_native_core_examples_match_backend_emitter(
        self, tmp_path: Path, example_name: str
    ) -> None:
        src = NATIVE_CORE / example_name
        out = tmp_path / src.with_suffix(".cpp").name

        assert main(["cpp-native-core", str(src), "-o", str(out)]) == 0
        emitted = out.read_text(encoding="utf-8")
        standard = emit_cpp_from_source_file(src)
        if example_name in {
            "hello_native.vkf",
            "vectors_native.vkf",
            "numeric_native.vkf",
            "named_record_native.vkf",
            "named_record_nested_native.vkf",
            "named_record_collections_native.vkf",
            "named_record_scene_native.vkf",
        }:
            stem = Path(example_name).stem
            standard_exe = compile_cpp_source(standard, tmp_path / "standard", exe_name=f"{stem}_standard")
            native_exe = compile_cpp_source(emitted, tmp_path / "native", exe_name=f"{stem}_native")
            standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
            native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)
            assert standard_proc.returncode == 0
            assert native_proc.returncode == 0
            assert native_proc.stdout == standard_proc.stdout
            return
        assert emitted == standard

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_cpp_native_core_expanded_examples_match_backend_emitter(
        self, tmp_path: Path, src: Path
    ) -> None:
        out = tmp_path / src.with_suffix(".cpp").name

        assert main(["cpp-native-core", str(src), "-o", str(out)]) == 0

        assert out.read_text(encoding="utf-8") == emit_cpp_from_source_file(src)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_cpp_native_core_subcommand_stdin_matches_file_output(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        src_path = NATIVE_CORE / "hello_native.vkf"
        src = src_path.read_text(encoding="utf-8")
        out = tmp_path / "stdin_native_core.cpp"

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["cpp-native-core", "-", "-o", str(out)]) == 0

        emitted = out.read_text(encoding="utf-8")
        standard = emit_cpp_from_source_file(src_path)
        standard_exe = compile_cpp_source(standard, tmp_path / "standard", exe_name="hello_native_stdin_standard")
        native_exe = compile_cpp_source(emitted, tmp_path / "native", exe_name="hello_native_stdin_native")
        standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
        native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)
        assert standard_proc.returncode == 0
        assert native_proc.returncode == 0
        assert native_proc.stdout == standard_proc.stdout

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src_path",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_cpp_native_core_expanded_examples_stdin_matches_file_output(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, src_path: Path
    ) -> None:
        src = src_path.read_text(encoding="utf-8")
        file_out = tmp_path / f"{src_path.stem}_file.cpp"
        stdin_out = tmp_path / f"{src_path.stem}_stdin.cpp"

        assert main(["cpp-native-core", str(src_path), "-o", str(file_out)]) == 0

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["cpp-native-core", "-", "-o", str(stdin_out)]) == 0

        assert stdin_out.read_text(encoding="utf-8") == file_out.read_text(encoding="utf-8")

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_build_subcommand_creates_executable(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        src = tmp_path / "native_build.vkf"
        exe = tmp_path / "native_build.exe"
        src.write_text(
            "twice(x:num) -> num:\n"
            "    x * 2\n\n"
            ":: twice(21)\n",
            encoding="utf-8",
        )
        assert main(["build", str(src), "-o", str(exe)]) == 0
        reported = capsys.readouterr().out.strip()
        assert Path(reported) == exe.resolve()
        assert exe.is_file()
        proc = subprocess.run([str(exe)], capture_output=True, text=True)
        assert proc.returncode == 0
        assert proc.stdout.strip() == "42"

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "example_name, expected_line",
        [
            ("hello_native.vkf", "42"),
            ("vectors_native.vkf", "[2.5, 2.5, 2.5, 2.5]"),
            ("numeric_native.vkf", "0"),
            ("named_record_nested_native.vkf", "4"),
            ("named_record_collections_native.vkf", "[5, 7]"),
            ("named_record_scene_native.vkf", "4"),
        ],
    )
    def test_build_native_core_examples(self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str) -> None:
        src = NATIVE_CORE / example_name
        exe = tmp_path / f"{_short_artifact_stem(example_name, 'bn')}.exe"
        assert main(["build", str(src), "-o", str(exe)]) == 0
        _ = capsys.readouterr()
        proc = subprocess.run([str(exe)], capture_output=True, text=True)
        assert proc.returncode == 0
        assert proc.stdout.splitlines()[0].strip() == expected_line

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", NATIVE_CORE_EXAMPLES)
    def test_build_native_core_examples_match_directly_compiled_cpp(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
    ) -> None:
        src = NATIVE_CORE / example_name
        cpp_out = tmp_path / f"{_short_artifact_stem(example_name, 'cpp')}.cpp"
        built_exe = tmp_path / f"{_short_artifact_stem(example_name, 'be')}.exe"

        assert main(["cpp-native-core", str(src), "-o", str(cpp_out)]) == 0
        emitted = cpp_out.read_text(encoding="utf-8")

        manual_exe = compile_cpp_source(
            emitted,
            tmp_path / _short_artifact_stem(example_name, "mcpp"),
            exe_name=_short_artifact_stem(example_name, "mexe"),
        )
        manual_proc = run_cpp_executable(manual_exe)
        assert manual_proc.returncode == 0

        assert main(["build-native-core", str(src), "-o", str(built_exe)]) == 0
        reported = capsys.readouterr().out.strip()
        assert Path(reported) == built_exe.resolve()

        built_proc = run_cpp_executable(built_exe)
        assert built_proc.returncode == 0
        assert built_proc.stdout == manual_proc.stdout

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_build_native_core_expanded_examples_match_directly_compiled_cpp(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, src: Path
    ) -> None:
        cpp_out = tmp_path / src.with_suffix(".cpp").name
        built_exe = tmp_path / src.with_suffix(".exe").name

        assert main(["cpp-native-core", str(src), "-o", str(cpp_out)]) == 0
        emitted = cpp_out.read_text(encoding="utf-8")

        manual_exe = compile_cpp_source(
            emitted,
            tmp_path / f"{src.stem}_expanded_manual_cpp",
            exe_name=f"{src.stem}_expanded_manual",
        )
        manual_proc = run_cpp_executable(manual_exe)
        assert manual_proc.returncode == 0

        assert main(["build-native-core", str(src), "-o", str(built_exe)]) == 0
        reported = capsys.readouterr().out.strip()
        assert Path(reported) == built_exe.resolve()

        built_proc = run_cpp_executable(built_exe)
        assert built_proc.returncode == 0
        assert built_proc.stdout == manual_proc.stdout

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_build_native_core_subcommand_stdin_requires_output_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("sys.stdin.read", lambda: ":: 6 * 7\n")
        assert main(["build-native-core", "-"]) == 1

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src_path",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_build_native_core_expanded_examples_stdin_matches_file_output(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        tmp_path: Path,
        src_path: Path,
    ) -> None:
        src = src_path.read_text(encoding="utf-8")
        file_exe = tmp_path / f"{src_path.stem}_file.exe"
        stdin_exe = tmp_path / f"{src_path.stem}_stdin.exe"

        assert main(["build-native-core", str(src_path), "-o", str(file_exe)]) == 0
        file_reported = capsys.readouterr().out.strip()
        assert Path(file_reported) == file_exe.resolve()
        file_proc = run_cpp_executable(file_exe)
        assert file_proc.returncode == 0

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["build-native-core", "-", "-o", str(stdin_exe)]) == 0
        stdin_reported = capsys.readouterr().out.strip()
        assert Path(stdin_reported) == stdin_exe.resolve()
        stdin_proc = run_cpp_executable(stdin_exe)
        assert stdin_proc.returncode == 0

        assert stdin_proc.stdout == file_proc.stdout

    def test_bench_subcommand_list(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "--list"]) == 0
        out = capsys.readouterr().out
        assert "scalar_control" in out
        assert "custom_overloads" in out
        assert "vector_large_elementwise" in out

    def test_bench_subcommand_single_case(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control"]) == 0
        out = capsys.readouterr().out
        assert "scalar_control" in out
        assert "summary:" in out

    def test_bench_subcommand_list_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "--list", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"scalar_control"' in out
        assert '"native_supported"' in out

    def test_bench_subcommand_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"summary"' in out
        assert '"results"' in out
        assert '"scalar_control"' in out
        assert '"python_ref_ms"' in out

    def test_bench_subcommand_samples(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--samples", "2"]) == 0
        out = capsys.readouterr().out
        assert "timings: median of 2 sample(s), native run median over 1 internal execution(s) after 0 warmup run(s), units=ms" in out

    def test_bench_subcommand_samples_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--samples", "2", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"sample_count": 2' in out
        assert '"aggregation": "median"' in out

    def test_bench_subcommand_native_runs(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--native-runs", "2"]) == 0
        out = capsys.readouterr().out
        assert "native run median over 2 internal execution(s) after 1 warmup run(s)" in out

    def test_bench_subcommand_native_runs_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--native-runs", "2", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"native_run_count": 2' in out

    def test_bench_subcommand_native_warmups_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--native-runs", "2", "--native-warmups", "0", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"native_warmup_count": 0' in out

    def test_bench_subcommand_save_baseline(self, tmp_path: Path) -> None:
        baseline = tmp_path / "baseline.json"
        assert main(["bench", "scalar_control", "--save-baseline", str(baseline), "--json"]) == 0
        assert baseline.is_file()
        assert '"summary"' in baseline.read_text(encoding="utf-8")

    def test_bench_subcommand_compare_baseline(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        baseline = tmp_path / "baseline.json"
        assert main(["bench", "scalar_control", "--save-baseline", str(baseline), "--json"]) == 0
        _ = capsys.readouterr()
        assert main(["bench", "scalar_control", "--compare-baseline", str(baseline)]) == 0
        out = capsys.readouterr().out
        assert "baseline deltas:" in out

    def test_bench_subcommand_compare_baseline_json(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        baseline = tmp_path / "baseline.json"
        assert main(["bench", "scalar_control", "--save-baseline", str(baseline), "--json"]) == 0
        _ = capsys.readouterr()
        assert main(["bench", "scalar_control", "--compare-baseline", str(baseline), "--json"]) == 0
        out = capsys.readouterr().out
        assert '"baseline_comparison"' in out
