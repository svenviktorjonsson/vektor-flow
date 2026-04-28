"""Reusable helpers for the current native frontend subset.

This module centralizes source-free frontend flows that already exist in pieces:

* native-core C++ lexer -> versioned token-stream JSON
* token-stream JSON -> AST
* token-stream JSON -> emitted C++
* emitted C++ -> compiled executable

The implementation is intentionally subset-specific for now. The goal is to
give the CLI and future callers one shared place to use the native frontend
without duplicating file/stdin glue.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from . import ast
from .cpp_backend import compile_cpp_source, emit_cpp_from_token_stream_json
from .native_core_lexer import lex_native_core_file_to_json, lex_native_core_stdin_to_json
from .parser import parse_token_stream_json


NativeSubset = Literal["native_core"]


def _normalize_subset(subset: str) -> NativeSubset:
    if subset != "native_core":
        raise ValueError(f"unsupported native frontend subset: {subset!r}")
    return "native_core"


def _default_filename_label(source: str | None, filename: str) -> str:
    if source is None:
        return Path(filename).as_posix()
    return filename


def _default_exe_name(source: str | None, filename: str) -> str:
    if source is None:
        stem = Path(filename).stem
        return stem or "vf_native_subset"
    return "vf_native_subset"


def lex_native_subset_payload(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> str:
    """Return versioned token-stream JSON from the active native frontend subset.

    ``source is None`` means ``filename`` is a filesystem path to lex.
    Otherwise ``source`` is lexed as stdin-like content and ``filename`` is used
    as the logical source label unless ``filename_label`` overrides it.
    """

    _normalize_subset(subset)
    label = filename_label if filename_label is not None else _default_filename_label(source, filename)
    if source is None:
        return lex_native_core_file_to_json(Path(filename), filename_label=label)
    return lex_native_core_stdin_to_json(source, filename_label=label)


def parse_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> ast.Module:
    """Parse the active native frontend subset through the token-stream seam."""

    payload = lex_native_subset_payload(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return parse_token_stream_json(payload)


def emit_cpp_from_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> str:
    """Emit C++ using the active native frontend subset as the source frontend."""

    payload = lex_native_subset_payload(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return emit_cpp_from_token_stream_json(payload)


def build_native_subset(
    source: str | None,
    filename: str,
    *,
    out_path: str | Path,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> Path:
    """Compile the active native frontend subset to an executable path."""

    out_path = Path(out_path)
    cpp_source = emit_cpp_from_native_subset(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    compiled = compile_cpp_source(
        cpp_source,
        out_path.parent,
        exe_name=out_path.stem or _default_exe_name(source, filename),
    )
    if compiled != out_path:
        if out_path.exists():
            out_path.unlink()
        compiled.replace(out_path)
    return out_path
