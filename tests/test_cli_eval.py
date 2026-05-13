from __future__ import annotations

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


def test_eval_reports_leading_indent_with_source_caret(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["-e", " ..5 >> :: $"]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "<cli>:1:2: unexpected indentation" in captured.err
    assert " ..5 >> :: $" in captured.err
    assert "^" in captured.err
    assert "INDENT" not in captured.err
