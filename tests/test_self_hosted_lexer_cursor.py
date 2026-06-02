from __future__ import annotations

import shutil
import subprocess
import json
from pathlib import Path

import pytest

from vektorflow.lexer import tokenize
from vektorflow.token_stream import token_stream_to_json


ROOT = Path(__file__).resolve().parent.parent
SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"


def _compiler_command(source: Path, output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-I",
                str(ROOT),
                str(source),
                "-o",
                str(output),
            ]

    cl = shutil.which("cl")
    if cl is not None:
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{ROOT}",
            str(source),
            f"/Fe:{output}",
        ]

    return None


@pytest.fixture(scope="module")
def cursor_smoke_exe(tmp_path_factory: pytest.TempPathFactory) -> Path:
    tmp_path = tmp_path_factory.mktemp("cursor_smoke")
    output = tmp_path / "vkf_lexer_cursor_smoke.exe"
    command = _compiler_command(SMOKE_SOURCE, output)
    if command is None:
        pytest.skip("no C++ compiler found")

    smoke_source = SMOKE_SOURCE.read_text(encoding="utf-8")
    forbidden_python_hooks = ["Python.h", "Py_Initialize", "python.exe", "system(", "popen("]
    for marker in forbidden_python_hooks:
        assert marker not in smoke_source

    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


def _run_cursor_smoke_payload(output: Path, source: str) -> dict[str, object]:
    proc = subprocess.run(
        [str(output), source],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    assert proc.stderr == ""
    return json.loads(proc.stdout)


def _simplified_records_from_payload(payload: dict[str, object]) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for token in payload["tokens"]:
        assert isinstance(token, dict)
        location = token["location"]
        assert isinstance(location, dict)
        value = token["value"]
        if value is None:
            value = ""
        elif isinstance(value, (int, float)):
            value = str(value)
        records.append(
            {
                "kind": token["kind"],
                "value": value,
                "file": location["file"],
                "line": location["line"],
                "column": location["column"],
            }
        )
    return records


def _run_cursor_smoke(output: Path, source: str) -> list[dict[str, object]]:
    return _simplified_records_from_payload(_run_cursor_smoke_payload(output, source))


def _run_cursor_smoke_error(output: Path, source: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(output), source],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def _python_lexer_records(source: str) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for token in tokenize(source, filename="<cursor-smoke>"):
        value = token.value
        if value is None:
            value = ""
        elif isinstance(value, tuple):
            value = list(value)
        elif isinstance(value, (int, float)):
            value = str(value)
        records.append(
            {
                "kind": token.kind,
                "value": value,
                "file": token.location.file,
                "line": token.location.line,
                "column": token.location.column,
            }
        )
    return records


def _python_token_stream_payload(source: str) -> dict[str, object]:
    return json.loads(token_stream_to_json(tokenize(source, filename="<cursor-smoke>")))


def test_native_cursor_smoke_scans_identifier_and_number_without_python(cursor_smoke_exe: Path) -> None:
    assert _run_cursor_smoke(cursor_smoke_exe, "alpha 123 beta45 6.7") == [
        {"kind": "IDENT", "value": "alpha", "file": "<cursor-smoke>", "line": 1, "column": 1},
        {"kind": "NUMBER", "value": "123", "file": "<cursor-smoke>", "line": 1, "column": 7},
        {"kind": "IDENT", "value": "beta45", "file": "<cursor-smoke>", "line": 1, "column": 11},
        {"kind": "NUMBER", "value": "6.7", "file": "<cursor-smoke>", "line": 1, "column": 18},
        {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 21},
        {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 21},
    ]


@pytest.mark.parametrize(
    "source, expected",
    [
        (
            "abc",
            [
                {"kind": "IDENT", "value": "abc", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 4},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 4},
            ],
        ),
        (
            "x1_2",
            [
                {"kind": "IDENT", "value": "x1_2", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 5},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 5},
            ],
        ),
        (
            "42",
            [
                {"kind": "NUMBER", "value": "42", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 3},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 1, "column": 3},
            ],
        ),
        (
            "a\nb",
            [
                {"kind": "IDENT", "value": "a", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "IDENT", "value": "b", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 2},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 2},
            ],
        ),
    ],
)
def test_native_cursor_smoke_emits_token_records_for_tiny_inputs(
    cursor_smoke_exe: Path,
    source: str,
    expected: list[dict[str, object]],
) -> None:
    assert _run_cursor_smoke(cursor_smoke_exe, source) == expected


@pytest.mark.parametrize(
    "source, expected",
    [
        (
            "a # c\nb",
            [
                {"kind": "IDENT", "value": "a", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "IDENT", "value": "b", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 2},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 2},
            ],
        ),
        (
            "a\n  b\nc",
            [
                {"kind": "IDENT", "value": "a", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "INDENT", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 3},
                {"kind": "IDENT", "value": "b", "file": "<cursor-smoke>", "line": 2, "column": 3},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 1},
                {"kind": "DEDENT", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 1},
                {"kind": "IDENT", "value": "c", "file": "<cursor-smoke>", "line": 3, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 2},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 2},
            ],
        ),
        (
            "a\n\n  # comment only\n  b\nc",
            [
                {"kind": "IDENT", "value": "a", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "INDENT", "value": "", "file": "<cursor-smoke>", "line": 4, "column": 3},
                {"kind": "IDENT", "value": "b", "file": "<cursor-smoke>", "line": 4, "column": 3},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 5, "column": 1},
                {"kind": "DEDENT", "value": "", "file": "<cursor-smoke>", "line": 5, "column": 1},
                {"kind": "IDENT", "value": "c", "file": "<cursor-smoke>", "line": 5, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 5, "column": 2},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 5, "column": 2},
            ],
        ),
        (
            "a\n\tb\nc",
            [
                {"kind": "IDENT", "value": "a", "file": "<cursor-smoke>", "line": 1, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 1},
                {"kind": "INDENT", "value": "", "file": "<cursor-smoke>", "line": 2, "column": 2},
                {"kind": "IDENT", "value": "b", "file": "<cursor-smoke>", "line": 2, "column": 2},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 1},
                {"kind": "DEDENT", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 1},
                {"kind": "IDENT", "value": "c", "file": "<cursor-smoke>", "line": 3, "column": 1},
                {"kind": "NEWLINE", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 2},
                {"kind": "EOF", "value": "", "file": "<cursor-smoke>", "line": 3, "column": 2},
            ],
        ),
    ],
)
def test_native_cursor_smoke_handles_comments_and_indentation(
    cursor_smoke_exe: Path,
    source: str,
    expected: list[dict[str, object]],
) -> None:
    assert _run_cursor_smoke(cursor_smoke_exe, source) == expected


def test_native_cursor_smoke_reports_inconsistent_dedent(cursor_smoke_exe: Path) -> None:
    proc = _run_cursor_smoke_error(cursor_smoke_exe, "a\n    b\n  c")

    assert proc.returncode != 0
    assert "Inconsistent indentation: column 2" in proc.stderr


@pytest.mark.parametrize(
    "source",
    [
        "+ - * / ^ % & , ; ? $ ~ | ( ) [ ] { }",
        ":: -> => .. ... == != ~= <= >= >> /\\ \\/ // >< !?",
        "@ @: @:: @> @| @!",
        "(x) -> num\n(x)->x",
        "[a\nb]",
    ],
)
def test_native_cursor_smoke_operator_records_match_python_lexer(
    cursor_smoke_exe: Path,
    source: str,
) -> None:
    assert _run_cursor_smoke(cursor_smoke_exe, source) == _python_lexer_records(source)


def test_native_cursor_smoke_arrow_payloads_match_spaced_and_tight_python_lexer(
    cursor_smoke_exe: Path,
) -> None:
    records = _run_cursor_smoke(cursor_smoke_exe, "(x) -> num\n(x)->x")
    arrow_records = [record for record in records if record["kind"] == "ARROW"]

    assert arrow_records == [
        {"kind": "ARROW", "value": [False, False], "file": "<cursor-smoke>", "line": 1, "column": 5},
        {"kind": "ARROW", "value": [True, True], "file": "<cursor-smoke>", "line": 2, "column": 4},
    ]


def test_native_cursor_smoke_at_emit_and_floordiv_names_match_python_lexer(
    cursor_smoke_exe: Path,
) -> None:
    records = _run_cursor_smoke(cursor_smoke_exe, "@:: //")

    assert [record["kind"] for record in records[:2]] == ["AT_EMIT", "FLOORDIV"]
    assert records == _python_lexer_records("@:: //")


@pytest.mark.parametrize(
    "source",
    [
        '"hi"',
        r'"a\n"',
        r'"a\t\r\\\"\$"',
        r"'a\$b'",
        "'can''t'",
        '"""a\nb"""',
        "'''a\nb'''",
    ],
)
def test_native_cursor_smoke_string_records_match_python_lexer(
    cursor_smoke_exe: Path,
    source: str,
) -> None:
    assert _run_cursor_smoke(cursor_smoke_exe, source) == _python_lexer_records(source)


@pytest.mark.parametrize(
    "source, expected",
    [
        ('"unterminated', "Unterminated string literal"),
        ('"""unterminated', "Unterminated triple-quoted string literal"),
        ("'unterminated", "Unterminated single-quoted string literal"),
        ("'''unterminated", "Unterminated triple single-quoted string literal"),
    ],
)
def test_native_cursor_smoke_reports_unterminated_string_errors(
    cursor_smoke_exe: Path,
    source: str,
    expected: str,
) -> None:
    proc = _run_cursor_smoke_error(cursor_smoke_exe, source)

    assert proc.returncode != 0
    assert expected in proc.stderr


@pytest.mark.parametrize(
    "source",
    [
        "alpha 123 beta45 6.7",
        "true false null",
        '"hi"',
        "'''a\nb'''",
        "a # c\nb",
        "a\n  b\nc",
        "+ - * / ^ % & , ; ? $ ~ |",
        ":: -> => .. ... == != ~= <= >= >> /\\ \\/ // >< !?",
        "@ @: @:: @> @| @!",
        "(x) -> num\n(x)->x",
        "[a\nb]",
    ],
)
def test_native_cursor_smoke_versioned_token_stream_payload_matches_python(
    cursor_smoke_exe: Path,
    source: str,
) -> None:
    assert _run_cursor_smoke_payload(cursor_smoke_exe, source) == _python_token_stream_payload(source)
