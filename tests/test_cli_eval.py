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
