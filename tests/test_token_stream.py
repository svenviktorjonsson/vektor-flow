from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from vektorflow.lexer import tokenize
from vektorflow.native_lexer_fixtures import (
    TOKEN_FIXTURE_SPECS,
    default_fixture_root,
    regenerate_token_fixtures,
)
from vektorflow.native_lexer_proto import (
    lex_file_to_payload,
    lex_to_payload,
    stable_source_label,
)
from vektorflow.parser import parse_module, parse_token_stream_json, parse_tokens
from vektorflow.token_stream import (
    TOKEN_STREAM_SCHEMA,
    TOKEN_STREAM_VERSION,
    token_stream_payload_from_json,
    token_stream_to_json,
    tokens_from_json,
    tokens_to_json,
    write_versioned_token_stream,
)
from tests.token_stream_fixture_helper import (
    TOKEN_FIXTURE_ROOT,
    assert_fixture_parses_like_source,
    iter_token_fixture_cases,
    token_fixture_case,
)


def test_token_stream_roundtrip_preserves_dot_adjacency_payload() -> None:
    toks = tokenize("a.true\nx. y: [1,2]\n", filename="<test>")
    payload = tokens_to_json(toks)
    restored = tokens_from_json(payload)
    assert [(t.kind, t.value, t.location.line, t.location.column) for t in restored] == [
        (t.kind, t.value, t.location.line, t.location.column) for t in toks
    ]


def test_parse_tokens_matches_parse_module_for_same_source() -> None:
    src = "v : [1,2]\nv. value: [3,4]\n:: value.\n"
    direct = parse_module(src, filename="<test>")
    via_tokens = parse_tokens(tokenize(src, filename="<test>"))
    assert repr(via_tokens) == repr(direct)


def test_token_json_has_stable_top_level_shape() -> None:
    toks = tokenize(":: 3\n", filename="<test>")
    payload = json.loads(tokens_to_json(toks))
    assert list(payload.keys()) == ["tokens"]
    assert payload["tokens"][0]["kind"] == "EMIT"
    assert set(payload["tokens"][0]["location"].keys()) == {"file", "line", "column"}


def test_versioned_token_stream_json_roundtrips_foreign_payload() -> None:
    payload = {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": [
            {
                "kind": "IDENT",
                "value": "vec",
                "location": {"file": "<foreign>", "line": 1, "column": 1},
            },
            {
                "kind": "DOT",
                "value": [True, True],
                "location": {"file": "<foreign>", "line": 1, "column": 4},
            },
            {
                "kind": "IDENT",
                "value": "x",
                "location": {"file": "<foreign>", "line": 1, "column": 5},
            },
        ],
    }
    restored = tokens_from_json(json.dumps(payload))
    assert [(t.kind, t.value, t.location.file) for t in restored] == [
        ("IDENT", "vec", "<foreign>"),
        ("DOT", (True, True), "<foreign>"),
        ("IDENT", "x", "<foreign>"),
    ]


def test_versioned_token_stream_json_includes_schema_metadata() -> None:
    toks = tokenize(":: 3\n", filename="<test>")
    payload = json.loads(token_stream_to_json(toks))
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["version"] == TOKEN_STREAM_VERSION
    assert isinstance(payload["tokens"], list)


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({"schema": "wrong.schema", "version": TOKEN_STREAM_VERSION, "tokens": []}, "unsupported schema"),
        ({"schema": TOKEN_STREAM_SCHEMA, "version": 99, "tokens": []}, "unsupported version"),
        ({}, "missing token list"),
    ],
)
def test_token_stream_json_rejects_invalid_envelopes(payload: dict[str, object], expected: str) -> None:
    with pytest.raises(ValueError, match=expected):
        tokens_from_json(json.dumps(payload))


def test_versioned_fixture_parses_like_source_golden() -> None:
    case = token_fixture_case("versioned_loose_dot_bind.json")
    assert_fixture_parses_like_source(case)


def test_legacy_fixture_parses_like_source_golden() -> None:
    case = token_fixture_case("legacy_singleton_tuple_type.json")
    assert_fixture_parses_like_source(case)


@pytest.mark.parametrize(
    "payload, expected",
    [
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
    ],
)
def test_parse_token_stream_json_rejects_malformed_token_entries(
    payload: dict[str, object], expected: str
) -> None:
    with pytest.raises(ValueError, match=expected):
        parse_token_stream_json(json.dumps(payload))


def test_versioned_payload_helper_matches_json_output() -> None:
    toks = tokenize("v. value: [3,4]\n", filename="<test>")
    payload = lex_to_payload("v. value: [3,4]\n", filename="<test>")
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["version"] == TOKEN_STREAM_VERSION
    assert payload["tokens"] == token_stream_payload_from_json(token_stream_to_json(toks))["tokens"]


def test_write_versioned_token_stream_roundtrips(tmp_path: Path) -> None:
    toks = tokenize(":: 3\n", filename="<test>")
    out = tmp_path / "tokens.json"
    write_versioned_token_stream(toks, out)
    payload = token_stream_payload_from_json(out.read_text(encoding="utf-8"))
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert [(t.kind, t.value) for t in tokens_from_json(out.read_text(encoding="utf-8"))] == [
        (t.kind, t.value) for t in toks
    ]


def test_native_lexer_proto_emits_versioned_payload_from_file(tmp_path: Path) -> None:
    source = tmp_path / "sample.vkf"
    source.write_text("vec.(3+2)\n", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "vektorflow.native_lexer_proto", str(source)],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = token_stream_payload_from_json(proc.stdout)
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["tokens"][0]["kind"] == "IDENT"
    assert payload["tokens"][1]["kind"] == "DOT"


def test_native_lexer_proto_emits_versioned_payload_from_stdin() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "vektorflow.native_lexer_proto", "-"],
        cwd=Path(__file__).resolve().parents[1],
        input="1.2E+4\n",
        capture_output=True,
        text=True,
        check=True,
    )
    payload = token_stream_payload_from_json(proc.stdout)
    assert payload["schema"] == TOKEN_STREAM_SCHEMA
    assert payload["tokens"][0]["kind"] == "NUMBER"
    assert payload["tokens"][0]["value"] == 1.2e4


def test_stable_source_label_prefers_repo_relative_path() -> None:
    repo = Path(__file__).resolve().parents[1]
    source = repo / "examples" / "native_core" / "hello_native.vkf"
    assert stable_source_label(source, root=repo) == "examples/native_core/hello_native.vkf"


@pytest.mark.parametrize(
    "source_rel, fixture_name",
    [(spec.source_rel, spec.fixture_name) for spec in TOKEN_FIXTURE_SPECS],
)
def test_native_core_fixture_matches_lex_file_payload(source_rel: str, fixture_name: str) -> None:
    repo = Path(__file__).resolve().parents[1]
    source = repo / Path(source_rel)
    payload = lex_file_to_payload(source, root=repo)
    fixture_payload = token_stream_payload_from_json(token_fixture_case(fixture_name).read_payload_text())
    assert payload == fixture_payload


@pytest.mark.parametrize(
    "source_rel, fixture_name",
    [(spec.source_rel, spec.fixture_name) for spec in TOKEN_FIXTURE_SPECS],
)
def test_native_core_fixture_parses_like_source(source_rel: str, fixture_name: str) -> None:
    case = token_fixture_case(fixture_name)
    assert_fixture_parses_like_source(case)


def test_all_token_stream_fixtures_with_sources_parse_like_paired_source() -> None:
    for case in iter_token_fixture_cases():
        assert_fixture_parses_like_source(case)


def test_native_core_fixtures_are_canonical_versioned_payloads() -> None:
    for spec in TOKEN_FIXTURE_SPECS:
        raw = json.loads(token_fixture_case(spec.fixture_name).read_payload_text())
        assert list(raw.keys()) == ["schema", "version", "tokens"]
        assert raw["schema"] == TOKEN_STREAM_SCHEMA
        assert raw["version"] == TOKEN_STREAM_VERSION
        assert isinstance(raw["tokens"], list)


def test_regenerate_token_fixtures_matches_checked_in_samples(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    written = regenerate_token_fixtures(repo_root=repo, fixture_root=out_root)
    assert {path.name for path in written} == {spec.fixture_name for spec in TOKEN_FIXTURE_SPECS}
    assert default_fixture_root(repo) == TOKEN_FIXTURE_ROOT
    for spec in TOKEN_FIXTURE_SPECS:
        generated = (out_root / spec.fixture_name).read_text(encoding="utf-8")
        checked_in = token_fixture_case(spec.fixture_name).read_payload_text()
        assert generated == checked_in


def test_native_lexer_fixtures_module_regenerates_all_checked_in_samples(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(out_root),
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    listed = {Path(line).name for line in proc.stdout.splitlines() if line.strip()}
    assert listed == {spec.fixture_name for spec in TOKEN_FIXTURE_SPECS}
    for spec in TOKEN_FIXTURE_SPECS:
        generated = (out_root / spec.fixture_name).read_text(encoding="utf-8")
        checked_in = token_fixture_case(spec.fixture_name).read_payload_text()
        assert generated == checked_in


def test_native_lexer_fixtures_module_defaults_to_canonical_versioned_form(tmp_path: Path) -> None:
    repo = Path(__file__).resolve().parents[1]
    out_root = tmp_path / "token_stream"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "vektorflow.native_lexer_fixtures",
            "--repo-root",
            str(repo),
            "--fixture-root",
            str(out_root),
        ],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    )
    for spec in TOKEN_FIXTURE_SPECS:
        raw = json.loads((out_root / spec.fixture_name).read_text(encoding="utf-8"))
        assert list(raw.keys()) == ["schema", "version", "tokens"]
        assert raw["schema"] == TOKEN_STREAM_SCHEMA
        assert raw["version"] == TOKEN_STREAM_VERSION
