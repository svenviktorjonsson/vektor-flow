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

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from . import ast
from .cpp_backend import CppEmitError, compile_cpp_source, emit_cpp_from_token_stream_json
from .native_core_lexer import lex_native_core_file_to_json, lex_native_core_stdin_to_json
from .native_parser_proto import emit_cpp_for_hello_native_file, emit_cpp_for_hello_native_source
from .parser import parse_token_stream_json


NativeSubset = Literal["native_core"]


@dataclass(frozen=True)
class NativeSubsetCapabilities:
    subset: NativeSubset
    supports_file_lex: bool = True
    supports_stdin_lex: bool = True
    supports_token_payload: bool = True
    supports_parse: bool = True
    supports_cpp_emit: bool = True
    supports_build: bool = True
    supports_native_parser_fast_path: bool = False
    supports_native_cpp_emit_fast_path: bool = False


@dataclass(frozen=True)
class NativeFrontendInput:
    subset: NativeSubset
    source: str | None
    filename: str
    filename_label: str

    @property
    def is_file_input(self) -> bool:
        return self.source is None

    @property
    def path(self) -> Path:
        return Path(self.filename)


@dataclass(frozen=True)
class NativeTokenPayload:
    request: NativeFrontendInput
    payload: str


@dataclass(frozen=True)
class NativeCppEmitResult:
    request: NativeFrontendInput
    cpp_source: str
    used_native_parser_fast_path: bool


def _normalize_subset(subset: str) -> NativeSubset:
    if subset != "native_core":
        raise ValueError(f"unsupported native frontend subset: {subset!r}")
    return "native_core"


def native_subset_capabilities(subset: str = "native_core") -> NativeSubsetCapabilities:
    normalized = _normalize_subset(subset)
    return NativeSubsetCapabilities(
        subset=normalized,
        supports_native_parser_fast_path=True,
        supports_native_cpp_emit_fast_path=True,
    )


def native_subset_supported(subset: str = "native_core") -> bool:
    try:
        _normalize_subset(subset)
    except ValueError:
        return False
    return True


def native_subset_native_parser_fast_path_available(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> bool:
    request = _normalize_native_input(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return _native_parser_fast_path_available(request)


def _default_filename_label(source: str | None, filename: str) -> str:
    if source is None:
        return Path(filename).as_posix()
    return filename


def _default_exe_name(source: str | None, filename: str) -> str:
    if source is None:
        stem = Path(filename).stem
        return stem or "vf_native_subset"
    return "vf_native_subset"


def _normalize_native_input(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeFrontendInput:
    normalized_subset = _normalize_subset(subset)
    label = filename_label if filename_label is not None else _default_filename_label(source, filename)
    return NativeFrontendInput(
        subset=normalized_subset,
        source=source,
        filename=filename,
        filename_label=label,
    )


def _lex_native_payload(request: NativeFrontendInput) -> str:
    if request.subset == "native_core":
        if request.is_file_input:
            return lex_native_core_file_to_json(request.path, filename_label=request.filename_label)
        return lex_native_core_stdin_to_json(request.source or "", filename_label=request.filename_label)
    raise ValueError(f"unsupported native frontend subset: {request.subset!r}")


def _native_parser_fast_path_available(request: NativeFrontendInput) -> bool:
    capabilities = native_subset_capabilities(request.subset)
    if not (
        capabilities.supports_native_parser_fast_path
        and capabilities.supports_native_cpp_emit_fast_path
    ):
        return False
    try:
        if request.is_file_input:
            emit_cpp_for_hello_native_file(request.path)
        else:
            emit_cpp_for_hello_native_source(request.source or "")
    except CppEmitError:
        return False
    return True


def _emit_cpp_from_native_request(request: NativeFrontendInput) -> NativeCppEmitResult:
    native_cpp = _try_emit_cpp_from_native_parser_fast_path(request)
    if native_cpp is not None:
        return NativeCppEmitResult(
            request=request,
            cpp_source=native_cpp,
            used_native_parser_fast_path=True,
        )
    payload = _lex_native_payload(request)
    return NativeCppEmitResult(
        request=request,
        cpp_source=emit_cpp_from_token_stream_json(payload),
        used_native_parser_fast_path=False,
    )


def _try_emit_cpp_from_native_parser_fast_path(request: NativeFrontendInput) -> str | None:
    if not _native_parser_fast_path_available(request):
        return None
    if request.is_file_input:
        return emit_cpp_for_hello_native_file(request.path)
    return emit_cpp_for_hello_native_source(request.source or "")


def lex_native_subset_result(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeTokenPayload:
    """Return the normalized native frontend request and token payload."""

    request = _normalize_native_input(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return NativeTokenPayload(request=request, payload=_lex_native_payload(request))


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

    return lex_native_subset_result(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).payload


def parse_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> ast.Module:
    """Parse the active native frontend subset through the token-stream seam."""

    result = lex_native_subset_result(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return parse_token_stream_json(result.payload)


def emit_cpp_from_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> str:
    """Emit C++ using the active native frontend subset as the source frontend."""

    request = _normalize_native_input(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return _emit_cpp_from_native_request(request).cpp_source


def build_native_subset(
    source: str | None,
    filename: str,
    *,
    out_path: str | Path,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> Path:
    """Compile the active native frontend subset to an executable path."""

    request = _normalize_native_input(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    out_path = Path(out_path)
    emit_result = _emit_cpp_from_native_request(request)
    compiled = compile_cpp_source(
        emit_result.cpp_source,
        out_path.parent,
        exe_name=out_path.stem or _default_exe_name(request.source, request.filename),
    )
    if compiled != out_path:
        if out_path.exists():
            out_path.unlink()
        compiled.replace(out_path)
    return out_path
