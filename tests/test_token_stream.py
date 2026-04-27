from __future__ import annotations

import json

import pytest

from vektorflow.lexer import tokenize
from vektorflow.parser import parse_module, parse_tokens
from vektorflow.token_stream import (
    TOKEN_STREAM_SCHEMA,
    TOKEN_STREAM_VERSION,
    token_stream_to_json,
    tokens_from_json,
    tokens_to_json,
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
