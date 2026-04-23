"""Command-line interface for Vektor Flow.

Usage
-----
    vkf <file>              Run a .vkf file (``a`` → ``a.vkf`` if needed)
    vkf tokens <file>       Print lexer token stream (diagnostics)
    vkf -s 'code'           Tokenize an inline snippet
    vkf --help
    vkf --version

``vkf <file>`` lexes, parses, and evaluates the program (emit to stdout, etc.).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .errors import EvalError, LexError, ParseError, VektorFlowError
from .lexer import tokenize
from .tokens import DEDENT, EOF, INDENT, NEWLINE


def _format_token_line(kind: str, value: object, line: int, col: int) -> str:
    if value is None or value == "":
        payload = ""
    else:
        payload = repr(value)
    return f"{line:>4}:{col:<4} {kind:<12} {payload}"


def resolve_vkf_path(arg: str) -> Path:
    """Resolve ``a`` → ``a.vkf`` when the bare path is missing but ``.vkf`` exists."""
    p = Path(arg)
    if p.is_file():
        return p.resolve()
    if p.suffix == "":
        with_vkf = p.with_suffix(".vkf")
        if with_vkf.is_file():
            return with_vkf.resolve()
    if p.suffix.lower() == ".vkf" and p.is_file():
        return p.resolve()
    raise FileNotFoundError(arg)


def cmd_tokens(source: str, filename: str, *, compact: bool) -> int:
    try:
        toks = tokenize(source, filename=filename)
    except VektorFlowError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    for t in toks:
        if compact and t.kind in (NEWLINE, INDENT, DEDENT, EOF):
            continue
        print(
            _format_token_line(t.kind, t.value, t.location.line, t.location.column)
        )
    return 0


def cmd_run(path: Path) -> int:
    """Parse and execute a ``.vkf`` file."""
    try:
        from .interpreter import run_file

        run_file(path)
    except OSError as exc:
        print(f"error: cannot read {path}: {exc}", file=sys.stderr)
        return 1
    except (LexError, ParseError, EvalError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    if not argv:
        print(
            "usage: vkf <file> | vkf tokens <file> | vkf -s <snippet>\n"
            "       (omit .vkf: `vkf hello` finds `hello.vkf`)",
            file=sys.stderr,
        )
        return 0

    if argv[0] in ("-h", "--help"):
        print(
            "Vektor Flow — vkf\n\n"
            "  vkf <file>           Run a .vkf file (extension optional)\n"
            "  vkf tokens <file>    Print lexer tokens\n"
            "  vkf -s/--source STR  Tokenize a snippet\n"
            "  --version            Show version\n",
            end="",
        )
        return 0

    if argv[0] == "--version":
        print(f"vkf {__version__}")
        return 0

    if argv[0] in ("-s", "--source"):
        if len(argv) < 2:
            print("error: -s requires a snippet", file=sys.stderr)
            return 1
        compact = "--compact" in argv
        return cmd_tokens(argv[1], "<cli>", compact=compact)

    if argv[0] == "tokens":
        if len(argv) < 2:
            print("error: vkf tokens <file>", file=sys.stderr)
            return 1
        compact = "--compact" in argv
        path_arg = next(a for a in argv[1:] if not a.startswith("-"))
        try:
            path = resolve_vkf_path(path_arg)
        except FileNotFoundError:
            print(f"error: file not found: {path_arg!r}", file=sys.stderr)
            return 1
        source = path.read_text(encoding="utf-8")
        return cmd_tokens(source, filename=str(path), compact=compact)

    # Default: run
    path_arg = argv[0]
    if path_arg.startswith("-"):
        print(f"error: unknown option {path_arg!r}", file=sys.stderr)
        return 1

    try:
        path = resolve_vkf_path(path_arg)
    except FileNotFoundError:
        print(
            f"error: file not found: {path_arg!r} "
            f"(tried {path_arg!r} and {Path(path_arg).with_suffix('.vkf')!r})",
            file=sys.stderr,
        )
        return 1

    return cmd_run(path)


def vkf_entry() -> None:
    """Console script target for ``vkf`` (see ``[project.scripts]`` in ``pyproject.toml``)."""
    raise SystemExit(main())


if __name__ == "__main__":
    raise SystemExit(main())
