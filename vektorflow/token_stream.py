"""Stable token-stream serialization boundary for future non-Python lexers.

The current lexer still lives in Python, but this module defines the JSON-safe
shape that a native lexer can target without needing to know about Python
dataclasses.

Two payload forms are accepted:

* legacy: ``{"tokens": [...]}``
* versioned: ``{"schema": "...", "version": 1, "tokens": [...]}``

The versioned form is the preferred foreign-lexer contract because it gives us
room to evolve the envelope without changing the token payload itself.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
import json

from .errors import SourceLocation
from .tokens import Token


TOKEN_STREAM_SCHEMA = "vektorflow.token_stream"
TOKEN_STREAM_VERSION = 1


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"non-standard JSON constant {value}")


def _reject_duplicate_object_keys(items: list[tuple[str, Any]]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key, value in items:
        if key in data:
            raise ValueError(f"duplicate object key {key!r}")
        data[key] = value
    return data


def normalize_token_stream_error_message(msg: str, *, parser_surface: bool = False) -> str:
    prefix = "invalid token stream payload: "
    if msg.startswith(prefix):
        msg = msg[len(prefix) :]
    if parser_surface and msg.startswith("invalid token entry:"):
        entry_msg = msg[len("invalid token entry:") :].lstrip()
        return f"malformed token entry: {entry_msg}"
    return msg


def _require_int(value: Any, ctx: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"invalid {ctx}: expected integer")
    return value


def _require_string(value: Any, ctx: str, *, allow_empty: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError(f"invalid {ctx}: expected string")
    if not allow_empty and value == "":
        raise ValueError(f"invalid {ctx}: expected non-empty string")
    return value


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


def build_token_stream_payload(tokens: list[Token]) -> dict[str, Any]:
    """Return the preferred versioned token-stream envelope."""
    return {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": tokens_to_data(tokens),
    }


def _normalize_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("invalid token stream payload: expected object")
    if "tokens" not in payload or not isinstance(payload["tokens"], list):
        raise ValueError("invalid token stream payload: missing token list")

    if "schema" not in payload and "version" not in payload:
        _reject_unknown_fields(payload, {"tokens"}, "token stream payload")
        return {
            "schema": TOKEN_STREAM_SCHEMA,
            "version": TOKEN_STREAM_VERSION,
            "tokens": payload["tokens"],
        }

    _reject_unknown_fields(payload, {"schema", "version", "tokens"}, "token stream payload")
    schema = payload.get("schema")
    version = payload.get("version")
    if schema != TOKEN_STREAM_SCHEMA:
        raise ValueError(
            f"invalid token stream payload: unsupported schema {schema!r}"
        )
    if _require_int(version, "token stream version") != TOKEN_STREAM_VERSION:
        raise ValueError(
            f"invalid token stream payload: unsupported version {version!r}"
        )
    return {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": payload["tokens"],
    }


def _require_mapping(value: Any, ctx: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"invalid {ctx}: expected object")
    return value


def _require_field(data: dict[str, Any], field: str, ctx: str) -> Any:
    if field not in data:
        raise ValueError(f"invalid {ctx}: missing {field}")
    return data[field]


def _reject_unknown_fields(data: dict[str, Any], allowed: set[str], ctx: str) -> None:
    extras = sorted(field for field in data if field not in allowed)
    if extras:
        joined = ", ".join(extras)
        raise ValueError(f"invalid {ctx}: unexpected field(s): {joined}")


def token_from_data(data: dict[str, Any]) -> Token:
    try:
        data = _require_mapping(data, "token entry")
        _reject_unknown_fields(data, {"kind", "value", "location"}, "token entry")
        kind = _require_string(
            _require_field(data, "kind", "token entry"),
            "token kind",
            allow_empty=False,
        )
        loc = _require_mapping(_require_field(data, "location", "token entry"), "token location")
        _reject_unknown_fields(loc, {"file", "line", "column"}, "token location")
        return Token(
            kind,
            _dejsonify_value(data.get("value")),
            SourceLocation(
                _require_string(
                    _require_field(loc, "file", "token location"),
                    "token location file",
                    allow_empty=False,
                ),
                _require_int(_require_field(loc, "line", "token location"), "token location line"),
                _require_int(_require_field(loc, "column", "token location"), "token location column"),
            ),
        )
    except ValueError as exc:
        msg = str(exc)
        if msg.startswith("invalid token entry:"):
            raise
        raise ValueError(f"invalid token entry: {msg}") from exc
    except (TypeError, KeyError, IndexError) as exc:
        raise ValueError(f"invalid token entry: {exc}") from exc


def tokens_from_data(data: list[dict[str, Any]]) -> list[Token]:
    return [token_from_data(item) for item in data]


def tokens_to_json(tokens: list[Token]) -> str:
    return json.dumps({"tokens": tokens_to_data(tokens)}, indent=2)


def token_stream_to_json(tokens: list[Token]) -> str:
    return json.dumps(build_token_stream_payload(tokens), indent=2)


def token_stream_payload_from_json(text: str) -> dict[str, Any]:
    """Parse token-stream JSON and return the normalized versioned envelope."""
    try:
        payload = json.loads(
            text,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_reject_duplicate_object_keys,
        )
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid token stream payload: malformed JSON: {exc.msg}") from exc
    except ValueError as exc:
        raise ValueError(f"invalid token stream payload: malformed JSON: {exc}") from exc
    return _normalize_payload(payload)


def tokens_from_json(text: str) -> list[Token]:
    payload = token_stream_payload_from_json(text)
    return tokens_from_data(payload["tokens"])


def load_tokens_from_json(text: str, *, parser_surface: bool = False) -> list[Token]:
    """Load tokens from JSON with the requested external error surface."""
    try:
        return tokens_from_json(text)
    except ValueError as exc:
        raise ValueError(
            normalize_token_stream_error_message(str(exc), parser_surface=parser_surface)
        ) from exc


def write_token_stream(tokens: list[Token], path: Path) -> None:
    path.write_text(tokens_to_json(tokens), encoding="utf-8")


def write_versioned_token_stream(tokens: list[Token], path: Path) -> None:
    path.write_text(token_stream_to_json(tokens), encoding="utf-8")


def read_token_stream(path: Path) -> list[Token]:
    return tokens_from_json(path.read_text(encoding="utf-8"))
