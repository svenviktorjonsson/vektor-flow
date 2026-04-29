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
from functools import cached_property
from pathlib import Path
from typing import Literal

from . import ast
from .cpp_backend import CppEmitError, compile_cpp_source, emit_cpp_from_token_stream_json
from .native_core_lexer import lex_native_core_file_to_json, lex_native_core_stdin_to_json
from .native_lexer_fixtures import declared_fixture_contract_summary
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
    declared_token_fixture_status: str = "unknown"
    declared_token_fixture_ready: bool = False
    declared_token_fixture_count: int = 0
    declared_token_fixture_usable_count: int = 0
    declared_token_fixture_blocked_count: int = 0
    declared_token_fixture_names: tuple[str, ...] = ()
    declared_token_fixture_usable_names: tuple[str, ...] = ()
    declared_token_fixture_blocked_names: tuple[str, ...] = ()
    declared_token_fixture_covered_token_kinds: tuple[str, ...] = ()
    declared_token_fixture_covered_token_kind_count: int = 0
    declared_token_fixture_token_family_coverage: tuple[dict[str, object], ...] = ()
    declared_token_fixture_covered_token_family_count: int = 0
    declared_token_fixture_uncovered_token_family_count: int = 0
    declared_token_fixture_coverage_blockers: tuple[str, ...] = ()
    declared_token_fixture_next_coverage_blocker: str | None = None
    declared_token_fixture_partial_coverage_blockers: tuple[str, ...] = ()
    declared_token_fixture_next_partial_coverage_blocker: str | None = None
    declared_token_fixture_token_family_status_by_name: dict[str, object] | None = None
    declared_token_fixture_token_family_frontier: tuple[dict[str, object], ...] = ()
    declared_token_fixture_textual_token_family_frontier: tuple[dict[str, object], ...] = ()
    lexer_frontier_overview: dict[str, object] | None = None
    lexer_operational_status: dict[str, object] | None = None
    lexer_confidence_signal: dict[str, object] | None = None
    discovered_token_fixture_covered_token_kinds: tuple[str, ...] = ()
    discovered_token_fixture_covered_token_kind_count: int = 0
    discovered_token_fixture_token_family_coverage: tuple[dict[str, object], ...] = ()
    discovered_token_fixture_covered_token_family_count: int = 0
    discovered_token_fixture_uncovered_token_family_count: int = 0
    discovered_token_fixture_coverage_blockers: tuple[str, ...] = ()
    discovered_token_fixture_next_coverage_blocker: str | None = None
    discovered_token_fixture_partial_coverage_blockers: tuple[str, ...] = ()
    discovered_token_fixture_next_partial_coverage_blocker: str | None = None
    discovered_token_fixture_token_family_status_by_name: dict[str, object] | None = None
    discovered_token_fixture_token_family_frontier: tuple[dict[str, object], ...] = ()
    discovered_token_fixture_textual_token_family_frontier: tuple[dict[str, object], ...] = ()
    declared_token_fixture_validation_passed: bool = False
    declared_token_fixture_completion_done: bool = False
    declared_token_fixture_completion_blocking_reasons: tuple[str, ...] = ()
    declared_token_fixture_completion_blocked_contract_count: int = 0
    declared_token_fixture_completion_state_validation_failures: int = 0
    declared_token_fixture_completion_declared_catalog_issue_count: int = 0
    declared_token_fixture_comparison_sha256: str = ""
    declared_token_fixture_readiness_sha256: str = ""
    declared_token_fixture_state_sha256: str = ""


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


@dataclass(frozen=True)
class NativeFrontendExecution:
    """Centralized execution flow for the current native frontend subset."""

    request: NativeFrontendInput

    @cached_property
    def token_payload(self) -> str:
        return _lex_native_payload(self.request)

    @cached_property
    def parsed_module(self) -> ast.Module:
        return parse_token_stream_json(self.token_payload)

    @cached_property
    def native_parser_fast_path_cpp_source(self) -> str | None:
        return _try_emit_cpp_from_native_parser_fast_path(self.request)

    @property
    def native_parser_fast_path_available(self) -> bool:
        return self.native_parser_fast_path_cpp_source is not None

    @cached_property
    def cpp_emit_result(self) -> NativeCppEmitResult:
        native_cpp = self.native_parser_fast_path_cpp_source
        if native_cpp is not None:
            return NativeCppEmitResult(
                request=self.request,
                cpp_source=native_cpp,
                used_native_parser_fast_path=True,
            )
        return NativeCppEmitResult(
            request=self.request,
            cpp_source=emit_cpp_from_token_stream_json(self.token_payload),
            used_native_parser_fast_path=False,
        )

    def build(self, out_path: str | Path) -> Path:
        out_path = Path(out_path)
        compiled = compile_cpp_source(
            self.cpp_emit_result.cpp_source,
            out_path.parent,
            exe_name=out_path.stem or _default_exe_name(self.request.source, self.request.filename),
        )
        if compiled != out_path:
            if out_path.exists():
                out_path.unlink()
            compiled.replace(out_path)
        return out_path


def _normalize_subset(subset: str) -> NativeSubset:
    if subset != "native_core":
        raise ValueError(f"unsupported native frontend subset: {subset!r}")
    return "native_core"


def native_subset_capabilities(subset: str = "native_core") -> NativeSubsetCapabilities:
    normalized = _normalize_subset(subset)
    fixture_contract = declared_fixture_contract_summary()
    return NativeSubsetCapabilities(
        subset=normalized,
        supports_native_parser_fast_path=True,
        supports_native_cpp_emit_fast_path=True,
        declared_token_fixture_status=fixture_contract["status"],
        declared_token_fixture_ready=bool(fixture_contract["ready"]),
        declared_token_fixture_count=int(fixture_contract["total"]),
        declared_token_fixture_usable_count=int(fixture_contract["usable_count"]),
        declared_token_fixture_blocked_count=int(fixture_contract["blocked_count"]),
        declared_token_fixture_names=tuple(fixture_contract["fixture_names"]),
        declared_token_fixture_usable_names=tuple(fixture_contract["usable_fixture_names"]),
        declared_token_fixture_blocked_names=tuple(fixture_contract["blocked_fixture_names"]),
        declared_token_fixture_covered_token_kinds=tuple(fixture_contract["covered_token_kinds"]),
        declared_token_fixture_covered_token_kind_count=int(
            fixture_contract["covered_token_kind_count"]
        ),
        declared_token_fixture_token_family_coverage=tuple(
            fixture_contract["token_family_coverage"]
        ),
        declared_token_fixture_covered_token_family_count=int(
            fixture_contract["covered_token_family_count"]
        ),
        declared_token_fixture_uncovered_token_family_count=int(
            fixture_contract["uncovered_token_family_count"]
        ),
        declared_token_fixture_coverage_blockers=tuple(fixture_contract["coverage_blockers"]),
        declared_token_fixture_next_coverage_blocker=fixture_contract["next_coverage_blocker"],
        declared_token_fixture_partial_coverage_blockers=tuple(
            fixture_contract["partial_coverage_blockers"]
        ),
        declared_token_fixture_next_partial_coverage_blocker=fixture_contract[
            "next_partial_coverage_blocker"
        ],
        declared_token_fixture_token_family_status_by_name=dict(
            fixture_contract["token_family_status_by_name"]
        ),
        declared_token_fixture_token_family_frontier=tuple(
            fixture_contract["token_family_frontier"]
        ),
        declared_token_fixture_textual_token_family_frontier=tuple(
            fixture_contract["textual_token_family_frontier"]
        ),
        lexer_frontier_overview=dict(fixture_contract["lexer_frontier_overview"]),
        lexer_operational_status=dict(fixture_contract["lexer_operational_status"]),
        lexer_confidence_signal=dict(fixture_contract["lexer_confidence_signal"]),
        discovered_token_fixture_covered_token_kinds=tuple(
            fixture_contract["discovered_covered_token_kinds"]
        ),
        discovered_token_fixture_covered_token_kind_count=int(
            fixture_contract["discovered_covered_token_kind_count"]
        ),
        discovered_token_fixture_token_family_coverage=tuple(
            fixture_contract["discovered_token_family_coverage"]
        ),
        discovered_token_fixture_covered_token_family_count=int(
            fixture_contract["discovered_covered_token_family_count"]
        ),
        discovered_token_fixture_uncovered_token_family_count=int(
            fixture_contract["discovered_uncovered_token_family_count"]
        ),
        discovered_token_fixture_coverage_blockers=tuple(
            fixture_contract["discovered_coverage_blockers"]
        ),
        discovered_token_fixture_next_coverage_blocker=fixture_contract[
            "next_discovered_coverage_blocker"
        ],
        discovered_token_fixture_partial_coverage_blockers=tuple(
            fixture_contract["discovered_partial_coverage_blockers"]
        ),
        discovered_token_fixture_next_partial_coverage_blocker=fixture_contract[
            "next_discovered_partial_coverage_blocker"
        ],
        discovered_token_fixture_token_family_status_by_name=dict(
            fixture_contract["discovered_token_family_status_by_name"]
        ),
        discovered_token_fixture_token_family_frontier=tuple(
            fixture_contract["discovered_token_family_frontier"]
        ),
        discovered_token_fixture_textual_token_family_frontier=tuple(
            fixture_contract["discovered_textual_token_family_frontier"]
        ),
        declared_token_fixture_validation_passed=bool(fixture_contract["validation_passed"]),
        declared_token_fixture_completion_done=bool(fixture_contract["completion_done"]),
        declared_token_fixture_completion_blocking_reasons=tuple(
            fixture_contract["completion_blocking_reasons"]
        ),
        declared_token_fixture_completion_blocked_contract_count=int(
            fixture_contract["completion_blocked_contract_count"]
        ),
        declared_token_fixture_completion_state_validation_failures=int(
            fixture_contract["completion_state_validation_failures"]
        ),
        declared_token_fixture_completion_declared_catalog_issue_count=int(
            fixture_contract["completion_declared_catalog_issue_count"]
        ),
        declared_token_fixture_comparison_sha256=str(fixture_contract["comparison_sha256"]),
        declared_token_fixture_readiness_sha256=str(fixture_contract["readiness_sha256"]),
        declared_token_fixture_state_sha256=str(fixture_contract["state_sha256"]),
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
    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).native_parser_fast_path_available


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


def native_frontend_execution(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeFrontendExecution:
    return NativeFrontendExecution(
        request=_normalize_native_input(
            source,
            filename,
            subset=subset,
            filename_label=filename_label,
        )
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

    execution = native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    )
    return NativeTokenPayload(request=execution.request, payload=execution.token_payload)


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

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).parsed_module


def emit_cpp_from_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> str:
    """Emit C++ using the active native frontend subset as the source frontend."""

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).cpp_emit_result.cpp_source


def build_native_subset(
    source: str | None,
    filename: str,
    *,
    out_path: str | Path,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> Path:
    """Compile the active native frontend subset to an executable path."""

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).build(out_path)
