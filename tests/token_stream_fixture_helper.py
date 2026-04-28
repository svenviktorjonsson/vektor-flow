from __future__ import annotations

import json
import io
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

from vektorflow.token_stream import TOKEN_STREAM_SCHEMA, TOKEN_STREAM_VERSION


ROOT = Path(__file__).resolve().parent.parent
TOKEN_FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "token_stream"
BAD_TOP_LEVEL_TOKEN_STREAM_CASES: tuple[tuple[str, str], ...] = (
    ('{"tokens":[', "malformed JSON"),
    ("[]", "expected object"),
    ("null", "expected object"),
    ('{"tokens":[{"kind":"NUMBER","value":NaN,"location":{"file":"<bad>","line":1,"column":1}}]}', "non-standard JSON constant NaN"),
    ('{"tokens":[{"kind":"NUMBER","value":Infinity,"location":{"file":"<bad>","line":1,"column":1}}]}', "non-standard JSON constant Infinity"),
    ('{"tokens":[],"tokens":[{"kind":"IDENT","value":"x","location":{"file":"<bad>","line":1,"column":1}}]}', "duplicate object key 'tokens'"),
    ('{"tokens":[{"kind":"IDENT","value":"x","location":{"file":"<bad>","file":"<worse>","line":1,"column":1}}]}', "duplicate object key 'file'"),
)
INVALID_TOKEN_STREAM_ENVELOPE_CASES: tuple[tuple[dict[str, object], str], ...] = (
    ({"tokens": []}, "empty token list"),
    (
        {
            "tokens": [
                {"kind": "IDENT", "value": "x", "location": {"file": "<bad>", "line": 1, "column": 1}}
            ]
        },
        "missing EOF terminator",
    ),
    (
        {
            "tokens": [
                {"kind": "EOF", "value": None, "location": {"file": "<bad>", "line": 1, "column": 1}},
                {"kind": "IDENT", "value": "x", "location": {"file": "<bad>", "line": 1, "column": 2}},
                {"kind": "EOF", "value": None, "location": {"file": "<bad>", "line": 1, "column": 3}},
            ]
        },
        "EOF must appear exactly once at end of stream",
    ),
    (
        {
            "tokens": [
                {"kind": "IDENT", "value": "x", "location": {"file": "<one>", "line": 1, "column": 1}},
                {"kind": "EOF", "value": None, "location": {"file": "<two>", "line": 1, "column": 2}},
            ]
        },
        "token locations must all use the same file",
    ),
    (
        {
            "tokens": [
                {"kind": "IDENT", "value": "alpha", "location": {"file": "<bad>", "line": 2, "column": 3}},
                {"kind": "IDENT", "value": "beta", "location": {"file": "<bad>", "line": 1, "column": 9}},
                {"kind": "EOF", "value": None, "location": {"file": "<bad>", "line": 2, "column": 4}},
            ]
        },
        "token locations must be in nondecreasing source order",
    ),
    ({"schema": TOKEN_STREAM_SCHEMA, "tokens": []}, "missing version"),
    ({"version": TOKEN_STREAM_VERSION, "tokens": []}, "missing schema"),
    ({"schema": "wrong.schema", "version": TOKEN_STREAM_VERSION, "tokens": []}, "unsupported schema"),
    ({"schema": TOKEN_STREAM_SCHEMA, "version": 99, "tokens": []}, "unsupported version"),
    ({"schema": TOKEN_STREAM_SCHEMA, "version": True, "tokens": []}, "token stream version: expected integer"),
    ({"tokens": [], "meta": "extra"}, "unexpected field(s): meta"),
    (
        {"schema": TOKEN_STREAM_SCHEMA, "version": TOKEN_STREAM_VERSION, "tokens": [], "meta": "extra"},
        "unexpected field(s): meta",
    ),
    ({}, "missing token list"),
)
MALFORMED_TOKEN_ENTRY_CASES: tuple[tuple[dict[str, object], str], ...] = (
    ({"tokens": ["oops"]}, "malformed token entry"),
    (
        {
            "tokens": [
                {
                    "kind": "   ",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "NOT_A_TOKEN",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "TRUE",
                    "value": False,
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": " \t ",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": 123,
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "PLUS",
                    "value": "+",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "NUMBER",
                    "value": True,
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "STRING",
                    "value": {"text": "oops"},
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "DOT",
                    "value": [True],
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "DOT",
                    "value": [1, 0],
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": 7,
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 0, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "extra": 1,
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": " \t ", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": "", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 0},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 1, "offset": 99},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "schema": TOKEN_STREAM_SCHEMA,
            "version": TOKEN_STREAM_VERSION,
            "tokens": [
                {
                    "kind": "NUMBER",
                    "value": 1,
                    "location": {"file": "<bad>", "line": "NaN", "column": 1},
                }
            ],
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "NUMBER",
                    "value": 1,
                    "location": {"file": "<bad>", "line": True, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": {"file": 9, "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "kind": "IDENT",
                    "value": "x",
                    "location": "<bad>",
                }
            ]
        },
        "malformed token entry",
    ),
    (
        {
            "tokens": [
                {
                    "value": "x",
                    "location": {"file": "<bad>", "line": 1, "column": 1},
                }
            ]
        },
        "malformed token entry",
    ),
)


@dataclass(frozen=True)
class TokenStreamFixtureCase:
    name: str
    payload_path: Path
    source_path: Path
    source_filename: str

    def read_payload_text(self) -> str:
        return self.payload_path.read_text(encoding="utf-8")

    def read_source_text(self) -> str:
        return self.source_path.read_text(encoding="utf-8")

    def expected_module_repr(self) -> str:
        from vektorflow.parser import parse_module

        return repr(parse_module(self.read_source_text(), filename=self.source_filename))

    def payload_object(self) -> dict[str, object]:
        payload = json.loads(self.read_payload_text())
        if not isinstance(payload, dict):
            raise AssertionError(f"fixture {self.name} did not decode to an object")
        return payload


def token_fixture_path(name: str) -> Path:
    return TOKEN_FIXTURE_ROOT / name


def _declared_source_filename(payload_path: Path) -> str:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    tokens = payload["tokens"]
    if not tokens:
        raise ValueError(f"fixture {payload_path.name} has no tokens")
    location = tokens[0].get("location", {})
    filename = location.get("file")
    if not isinstance(filename, str) or not filename:
        raise ValueError(f"fixture {payload_path.name} has no stable source filename")
    return filename


def paired_source_for_payload(payload_path: Path) -> Path:
    sibling = payload_path.with_suffix(".vkf")
    if sibling.is_file():
        return sibling

    declared = _declared_source_filename(payload_path)
    candidate = ROOT / Path(declared)
    if candidate.is_file():
        return candidate

    raise FileNotFoundError(f"no paired source found for token fixture {payload_path.name}")


def token_fixture_case(name: str) -> TokenStreamFixtureCase:
    payload_path = token_fixture_path(name)
    return TokenStreamFixtureCase(
        name=name,
        payload_path=payload_path,
        source_path=paired_source_for_payload(payload_path),
        source_filename=_declared_source_filename(payload_path),
    )


def iter_token_fixture_cases() -> Iterator[TokenStreamFixtureCase]:
    for payload_path in sorted(TOKEN_FIXTURE_ROOT.glob("*.json")):
        yield token_fixture_case(payload_path.name)


def fixture_cases(names: Iterable[str]) -> list[TokenStreamFixtureCase]:
    return [token_fixture_case(name) for name in names]


def native_core_fixture_cases() -> list[TokenStreamFixtureCase]:
    from vektorflow.native_lexer_fixtures import TOKEN_FIXTURE_SPECS

    return fixture_cases(spec.fixture_name for spec in TOKEN_FIXTURE_SPECS)


def assert_fixture_parses_like_source(case: TokenStreamFixtureCase) -> None:
    from vektorflow.parser import parse_token_stream_json

    assert repr(parse_token_stream_json(case.read_payload_text())) == case.expected_module_repr()


def assert_cli_parse_tokens_output_matches_source(case: TokenStreamFixtureCase, output: str) -> None:
    assert output.strip() == case.expected_module_repr()


def assert_fixture_boundary_parity(case: TokenStreamFixtureCase, *, cli_output: str | None = None) -> None:
    payload = case.payload_object()
    if "schema" in payload or "version" in payload:
        assert list(payload.keys()) == ["schema", "version", "tokens"]
        assert payload["schema"] == TOKEN_STREAM_SCHEMA
        assert payload["version"] == TOKEN_STREAM_VERSION
    else:
        assert list(payload.keys()) == ["tokens"]
    assert isinstance(payload["tokens"], list)
    assert_fixture_parses_like_source(case)
    if cli_output is not None:
        assert_cli_parse_tokens_output_matches_source(case, cli_output)


def assert_parser_rejects_token_stream(payload_text: str, expected: str) -> None:
    from vektorflow.parser import parse_token_stream_json

    try:
        parse_token_stream_json(payload_text)
    except ValueError as exc:
        assert expected in str(exc)
        return
    raise AssertionError("expected parse_token_stream_json to reject payload")


def assert_parser_rejects_token_stream_object(payload: dict[str, object], expected: str) -> None:
    assert_parser_rejects_token_stream(json.dumps(payload), expected)


def parser_rejects_token_stream_message(payload_text: str) -> str:
    from vektorflow.parser import parse_token_stream_json

    try:
        parse_token_stream_json(payload_text)
    except ValueError as exc:
        return str(exc)
    raise AssertionError("expected parse_token_stream_json to reject payload")


def parser_rejects_token_stream_object_message(payload: dict[str, object]) -> str:
    return parser_rejects_token_stream_message(json.dumps(payload))


def assert_loader_rejects_token_stream(payload_text: str, expected: str) -> None:
    from vektorflow.token_stream import tokens_from_json

    try:
        tokens_from_json(payload_text)
    except ValueError as exc:
        assert expected in str(exc)
        return
    raise AssertionError("expected tokens_from_json to reject payload")


def assert_loader_rejects_token_stream_object(payload: dict[str, object], expected: str) -> None:
    assert_loader_rejects_token_stream(json.dumps(payload), expected)


def loader_rejects_token_stream_message(payload_text: str) -> str:
    from vektorflow.token_stream import tokens_from_json

    try:
        tokens_from_json(payload_text)
    except ValueError as exc:
        return str(exc)
    raise AssertionError("expected tokens_from_json to reject payload")


def loader_rejects_token_stream_object_message(payload: dict[str, object]) -> str:
    return loader_rejects_token_stream_message(json.dumps(payload))


def assert_parser_surface_rejects_token_stream(payload_text: str, expected: str) -> None:
    from vektorflow.token_stream import load_tokens_from_json

    try:
        load_tokens_from_json(payload_text, parser_surface=True)
    except ValueError as exc:
        assert expected in str(exc)
        return
    raise AssertionError("expected load_tokens_from_json(..., parser_surface=True) to reject payload")


def assert_parser_surface_rejects_token_stream_object(payload: dict[str, object], expected: str) -> None:
    assert_parser_surface_rejects_token_stream(json.dumps(payload), expected)


def parser_surface_rejects_token_stream_object_message(payload: dict[str, object]) -> str:
    from vektorflow.token_stream import load_tokens_from_json

    try:
        load_tokens_from_json(json.dumps(payload), parser_surface=True)
    except ValueError as exc:
        return str(exc)
    raise AssertionError("expected load_tokens_from_json(..., parser_surface=True) to reject payload")


def assert_loader_parser_cli_reject_token_stream_object(
    tmp_path: Path,
    payload: dict[str, object],
    *,
    loader_expected: str,
    parser_expected: str,
    cli_expected: str | None = None,
) -> None:
    assert_loader_rejects_token_stream_object(payload, loader_expected)
    assert_parser_rejects_token_stream_object(payload, parser_expected)
    assert_cli_rejects_token_stream_object(tmp_path, payload, cli_expected or parser_expected)


def assert_loader_parser_cli_reject_token_stream(
    tmp_path: Path,
    payload_text: str,
    *,
    loader_expected: str,
    parser_expected: str,
    cli_expected: str | None = None,
) -> None:
    assert_loader_rejects_token_stream(payload_text, loader_expected)
    assert_parser_rejects_token_stream(payload_text, parser_expected)
    assert_cli_rejects_token_stream(tmp_path, payload_text, cli_expected or parser_expected)


def assert_cli_rejects_token_stream(tmp_path: Path, payload_text: str, expected: str) -> None:
    from vektorflow.cli import main

    payload_path = tmp_path / "bad_token_stream.json"
    payload_path.write_text(payload_text, encoding="utf-8")
    out = io.StringIO()
    err = io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        rc = main(["parse-tokens", str(payload_path)])
    assert rc == 1
    assert expected in err.getvalue()


def assert_cli_rejects_token_stream_object(tmp_path: Path, payload: dict[str, object], expected: str) -> None:
    assert_cli_rejects_token_stream(tmp_path, json.dumps(payload), expected)
