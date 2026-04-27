"""Stable token-stream serialization boundary for future non-Python lexers.

The current lexer still lives in Python, but this module defines the JSON-safe
shape that a native lexer can target without needing to know about Python
dataclasses.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
import json

from .errors import SourceLocation
from .tokens import Token


def _jsonify_value(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_jsonify_value(v) for v in value]
    if isinstance(value, list):
        return [_jsonify_value(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _jsonify_value(v) for k, v in value.items()}
    return value


def _dejsonify_value(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(_dejsonify_value(v) for v in value)
    if isinstance(value, dict):
        return {str(k): _dejsonify_value(v) for k, v in value.items()}
    return value


def token_to_data(token: Token) -> dict[str, Any]:
    return {
        "kind": token.kind,
        "value": _jsonify_value(token.value),
        "location": {
            "file": token.location.file,
            "line": token.location.line,
            "column": token.location.column,
        },
    }


def tokens_to_data(tokens: list[Token]) -> list[dict[str, Any]]:
    return [token_to_data(token) for token in tokens]


def token_from_data(data: dict[str, Any]) -> Token:
    loc = data["location"]
    return Token(
        str(data["kind"]),
        _dejsonify_value(data.get("value")),
        SourceLocation(str(loc["file"]), int(loc["line"]), int(loc["column"])),
    )


def tokens_from_data(data: list[dict[str, Any]]) -> list[Token]:
    return [token_from_data(item) for item in data]


def tokens_to_json(tokens: list[Token]) -> str:
    return json.dumps({"tokens": tokens_to_data(tokens)}, indent=2)


def tokens_from_json(text: str) -> list[Token]:
    payload = json.loads(text)
    if not isinstance(payload, dict) or "tokens" not in payload or not isinstance(payload["tokens"], list):
        raise ValueError("invalid token stream payload")
    return tokens_from_data(payload["tokens"])


def write_token_stream(tokens: list[Token], path: Path) -> None:
    path.write_text(tokens_to_json(tokens), encoding="utf-8")


def read_token_stream(path: Path) -> list[Token]:
    return tokens_from_json(path.read_text(encoding="utf-8"))
