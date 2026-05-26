from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.cli import main


def test_eval_executes_inline_snippet(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", ':: "hello, world"']) == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == "hello, world"
    assert captured.err == ""


def test_eval_long_option_executes_inline_snippet(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["--eval", ':: "hello, world"']) == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == "hello, world"
    assert captured.err == ""


def test_eval_executes_semicolon_separated_top_level_snippet(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", "points: (x:3, y:5); points.z: 9; :: points"]) == 0
    captured = capsys.readouterr()
    assert captured.out.strip() == "(x:3, y:5, z:9)"
    assert captured.err == ""


def test_eval_reports_leading_indent_with_source_caret(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", " ..5 >> :: $"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "<cli>:1:2: unexpected indentation" in captured.err
    assert " ..5 >> :: $" in captured.err
    assert "^" in captured.err
    assert "INDENT" not in captured.err


def test_eval_reports_missing_expression_without_token_name(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", ":: 1 +"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "unexpected end of input; expected an expression" in captured.err
    assert ":: 1 +" in captured.err
    assert "^" in captured.err
    assert "EOF" not in captured.err


def test_file_run_reports_source_caret_without_token_name(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "bad.vkf"
    path.write_text(" ..5 >> :: $\n", encoding="utf-8")

    assert main([str(path)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "unexpected indentation" in captured.err
    assert " ..5 >> :: $" in captured.err
    assert "^" in captured.err
    assert "INDENT" not in captured.err


def test_source_tokenize_reports_source_caret_for_lex_error(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-s", "!"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "did you mean" in captured.err
    assert "!\n^" in captured.err
