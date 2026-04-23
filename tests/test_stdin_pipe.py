"""Leading ``>>`` reads one line from stdin into ``$``."""

from __future__ import annotations

import contextlib
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from vektorflow.interpreter import Interpreter
from vektorflow.parser import parse_module


def _run_with_stdin(src: str, stdin_text: str) -> str:
    mod = parse_module(src, filename="<test>")
    ip = Interpreter(Path(__file__))
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        with patch("sys.stdin", StringIO(stdin_text)):
            ip.run_module(mod)
    return buf.getvalue().strip()


class TestStdinPipe:
    def test_pipe_line_to_emit(self) -> None:
        assert _run_with_stdin(":: >> $", "hello\n") == "hello"

    def test_pipe_line_transform(self) -> None:
        assert _run_with_stdin(':: >> ( $ & "!" )', "hi\n") == "hi!"

    def test_eof_empty_line(self) -> None:
        assert _run_with_stdin(":: >> $", "") == ""
