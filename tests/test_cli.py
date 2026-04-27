"""Tests for the ``vkf`` CLI."""

from __future__ import annotations

from pathlib import Path
import subprocess
import json

import pytest

from vektorflow.cli import main, resolve_vkf_path
from vektorflow.cpp_backend import discover_cpp_compiler
from vektorflow.lexer import tokenize
from vektorflow.parser import parse_module
from vektorflow.token_stream import tokens_to_json
from tests.token_stream_fixture_helper import (
    assert_cli_parse_tokens_output_matches_source,
    assert_fixture_boundary_parity,
    native_core_fixture_cases,
    token_fixture_case,
)

ROOT = Path(__file__).resolve().parent.parent
HELLO = ROOT / "examples" / "hello.vkf"
FOLDER_REPO_MAIN = ROOT / "examples" / "folder_repo" / "main.vkf"
NATIVE_CORE = ROOT / "examples" / "native_core"


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

    def test_parse_tokens_subcommand_invalid_payload(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path
    ) -> None:
        payload_path = tmp_path / "bad_tokens.json"
        payload_path.write_text('{"bad": []}', encoding="utf-8")

        assert main(["parse-tokens", str(payload_path)]) == 1
        assert "invalid token stream payload" in capsys.readouterr().err

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

    def test_parse_tokens_subcommand_malformed_token_entry(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path
    ) -> None:
        payload_path = tmp_path / "bad_token_entry.json"
        payload_path.write_text(
            json.dumps(
                {
                    "tokens": [
                        {
                            "kind": "IDENT",
                            "value": "x",
                            "location": {"file": "<bad>", "line": 1},
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )

        assert main(["parse-tokens", str(payload_path)]) == 1
        assert "invalid token stream payload: malformed token entry" in capsys.readouterr().err

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
        ],
    )
    def test_build_native_core_examples(self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str) -> None:
        src = NATIVE_CORE / example_name
        exe = tmp_path / src.with_suffix(".exe").name
        assert main(["build", str(src), "-o", str(exe)]) == 0
        _ = capsys.readouterr()
        proc = subprocess.run([str(exe)], capture_output=True, text=True)
        assert proc.returncode == 0
        assert proc.stdout.splitlines()[0].strip() == expected_line

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
