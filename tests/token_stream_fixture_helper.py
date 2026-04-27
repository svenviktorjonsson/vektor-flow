from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator


ROOT = Path(__file__).resolve().parent.parent
TOKEN_FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "token_stream"


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
