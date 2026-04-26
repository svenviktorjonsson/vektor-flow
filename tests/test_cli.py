"""Tests for the ``vkf`` CLI."""

from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.cli import main, resolve_vkf_path

ROOT = Path(__file__).resolve().parent.parent
HELLO = ROOT / "examples" / "hello.vkf"
FOLDER_REPO_MAIN = ROOT / "examples" / "folder_repo" / "main.vkf"


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

    def test_tokens_unknown_file(self) -> None:
        assert main(["tokens", "nope_not_a_file"]) == 1

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
