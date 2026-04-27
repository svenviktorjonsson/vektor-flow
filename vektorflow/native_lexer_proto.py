"""Standalone lexer-prototype entrypoint for the external token-stream contract.

This module is still implemented in Python, but it behaves like a foreign lexer:
it reads source text and emits the versioned token-stream JSON envelope that the
parser-facing token boundary accepts.

That makes it a practical stand-in while we move lexing out of Python, and it
gives future native implementations a very small contract to mimic.
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence
import argparse
import sys

from .lexer import tokenize
from .token_stream import (
    build_token_stream_payload,
    token_stream_to_json,
    write_versioned_token_stream,
)


def lex_to_payload(source: str, filename: str = "<stdin>") -> dict[str, object]:
    """Tokenize ``source`` and return the preferred versioned token payload."""
    return build_token_stream_payload(tokenize(source, filename=filename))


def lex_to_json(source: str, filename: str = "<stdin>") -> str:
    """Tokenize ``source`` and return the versioned token payload as JSON."""
    return token_stream_to_json(tokenize(source, filename=filename))


def lex_path_to_json(path: Path) -> str:
    return lex_to_json(path.read_text(encoding="utf-8"), filename=str(path))


def stable_source_label(path: Path, *, root: Path | None = None) -> str:
    """Return a stable display filename for fixture/token payload generation."""
    path = path.resolve()
    if root is not None:
        try:
            return path.relative_to(root.resolve()).as_posix()
        except ValueError:
            pass
    return str(path)


def lex_file_to_payload(path: Path, *, root: Path | None = None) -> dict[str, object]:
    filename = stable_source_label(path, root=root)
    return lex_to_payload(path.read_text(encoding="utf-8"), filename=filename)


def write_fixture_for_source(
    source_path: Path,
    fixture_path: Path,
    *,
    root: Path | None = None,
) -> None:
    filename = stable_source_label(source_path, root=root)
    tokens = tokenize(source_path.read_text(encoding="utf-8"), filename=filename)
    write_versioned_token_stream(tokens, fixture_path)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m vektorflow.native_lexer_proto",
        description="Emit the versioned Vektor Flow token-stream JSON payload.",
    )
    parser.add_argument(
        "source",
        help="VKF source file path, or '-' to read from stdin.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    if args.source == "-":
        sys.stdout.write(lex_to_json(sys.stdin.read(), filename="<stdin>"))
        sys.stdout.write("\n")
        return 0

    path = Path(args.source)
    sys.stdout.write(lex_path_to_json(path))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
