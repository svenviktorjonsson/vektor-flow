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
