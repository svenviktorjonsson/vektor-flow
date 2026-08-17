from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.cli import main


def test_eval_rejects_snippet_without_native_compiled_path(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", ':: "hello, world"']) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Python interpreter execution is disabled" in captured.err


def test_eval_long_option_rejects_without_native_compiled_path(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--eval", ':: "hello, world"']) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Python interpreter execution is disabled" in captured.err


def test_eval_rejects_complex_snippet_without_native_compiled_path(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", "points: (x:3, y:5); points.z: 9; :: points"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Python interpreter execution is disabled" in captured.err


def test_eval_reports_leading_indent_with_source_caret(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", " ..5 >> :: $"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Python interpreter execution is disabled" in captured.err


def test_eval_reports_missing_expression_without_token_name(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", ":: 1 +"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Python interpreter execution is disabled" in captured.err


def test_file_run_reports_source_caret_without_token_name(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "bad.vkf"
    path.write_text(" ..5 >> :: $\n", encoding="utf-8")

    assert main([str(path)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "native runtime does not support this file" in captured.err


def test_source_tokenize_reports_source_caret_for_lex_error(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-s", "!"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "Unexpected character '!'" in captured.err
    assert "!\n^" in captured.err
