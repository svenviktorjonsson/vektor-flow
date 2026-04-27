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
)
MALFORMED_TOKEN_ENTRY_CASES: tuple[tuple[dict[str, object], str], ...] = (
    ({"tokens": ["oops"]}, "malformed token entry"),
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
