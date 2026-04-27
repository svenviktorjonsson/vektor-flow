from __future__ import annotations

import json

from vektorflow.lexer import tokenize
from vektorflow.parser import parse_module, parse_tokens
from vektorflow.token_stream import tokens_from_json, tokens_to_json


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
