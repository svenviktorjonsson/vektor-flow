from __future__ import annotations

from pathlib import Path
import contextlib
import json
from functools import lru_cache
from io import StringIO
import subprocess

import pytest

from vektorflow.cli import main
from vektorflow.cpp_backend import discover_cpp_compiler
from vektorflow.interpreter import run_file
from vektorflow.parser import parse_module, parse_token_stream_json


ROOT = Path(__file__).resolve().parent.parent
NATIVE_CORE = ROOT / "examples" / "native_core"


EXPECTED_OUTPUTS = {
    "hello_native.vkf": "42",
    "vectors_native.vkf": "[2.5, 2.5, 2.5, 2.5]",
    "records_native.vkf": "(pts:[11, 22], bag:{2:1, 3:3, 4:2}, total:3)",
    "numeric_native.vkf": "0\n3.14159265358979\n3\n[0, 0.25, 0.5, 0.75, 1]\n1",
}


def _expected_module_repr(path: Path) -> str:
    return repr(parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix()))


def _run_cli_stdout(args: list[str]) -> tuple[int, str]:
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        rc = main(args)
    return rc, buf.getvalue()


@lru_cache(maxsize=1)
def _supports_build_native_core() -> bool:
    rc, out = _run_cli_stdout(["--help"])
    assert rc == 0
    return "build-native-core" in out


def _native_core_build_args(path: Path, exe: Path) -> list[str]:
    if _supports_build_native_core():
        return ["build-native-core", str(path), "-o", str(exe)]
    return ["build", str(path), "-o", str(exe)]


def _assert_interpreter_output(name: str, out: str) -> None:
    if name in ("hello_native.vkf", "vectors_native.vkf"):
        assert out == EXPECTED_OUTPUTS[name]
        return
    if name == "records_native.vkf":
        assert "pts:[11, 22]" in out
        assert "bag:{2:1, 3:3, 4:2}" in out
        assert "total:3" in out
        return
    if name == "numeric_native.vkf":
        lines = out.splitlines()
        assert lines[0] == "0"
        assert float(lines[1]) == pytest.approx(3.14159265358979)
        assert lines[2] == "3"
        assert lines[3] == "[0, 0.25, 0.5, 0.75, 1]"
        assert float(lines[4]) == pytest.approx(1.0)
        return
    raise AssertionError(f"missing interpreter validator for {name}")


@pytest.mark.parametrize("name, expected", EXPECTED_OUTPUTS.items())
def test_native_core_examples_run_under_interpreter(name: str, expected: str) -> None:
    path = NATIVE_CORE / name
    buf = StringIO()
    with contextlib.redirect_stdout(buf):
        run_file(path)
    _assert_interpreter_output(name, buf.getvalue().strip())


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", EXPECTED_OUTPUTS)
def test_native_core_examples_parse_via_native_frontend(name: str) -> None:
    path = NATIVE_CORE / name
    rc, out = _run_cli_stdout(["parse-native-core", str(path)])
    assert rc == 0
    assert out.strip() == _expected_module_repr(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name", EXPECTED_OUTPUTS)
def test_native_core_examples_native_tokens_round_trip_to_parser(name: str) -> None:
    path = NATIVE_CORE / name
    rc, out = _run_cli_stdout(["tokens-native-core", str(path), "--json"])
    assert rc == 0

    payload = json.loads(out)
    assert payload["tokens"][-1]["kind"] == "EOF"
    assert payload["tokens"][0]["location"]["file"] == path.as_posix()
    assert repr(parse_token_stream_json(out)) == _expected_module_repr(path)


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
@pytest.mark.parametrize("name, expected", EXPECTED_OUTPUTS.items())
def test_native_core_examples_build_and_run(name: str, expected: str, tmp_path: Path) -> None:
    path = NATIVE_CORE / name
    exe = tmp_path / path.with_suffix(".exe").name
    parse_rc, parse_out = _run_cli_stdout(["parse-native-core", str(path)])
    assert parse_rc == 0
    assert parse_out.strip() == _expected_module_repr(path)

    assert main(_native_core_build_args(path, exe)) == 0
    proc = subprocess.run([str(exe)], capture_output=True, text=True)
    assert proc.returncode == 0
    assert proc.stdout.strip() == expected
