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
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Literal

from . import ast
from .cpp_backend import CppEmitError, compile_cpp_source, emit_cpp_from_token_stream_json
from .native_core_lexer import lex_native_core_file_to_json, lex_native_core_stdin_to_json
from .native_lexer_fixtures import declared_fixture_contract_summary
from .native_parser_proto import (
    NativeParserProtoExecution,
    native_parser_proto_file_execution,
    native_parser_proto_source_execution,
)
from .parser import parse_token_stream_json


NativeSubset = Literal["native_core"]
NativeExecutionMode = Literal["native_parser_fast_path", "token_stream_seam"]
NativeExecutionBackend = Literal["native_parser", "token_stream"]
NativeExecutionStage = Literal["lex", "parse", "emit", "build", "run"]
NativeExecutionAlias = Literal[
    "summary",
    "execution_backend",
    "execution_mode",
    "fast_path_available",
    "fast_path_cpp_source",
    "lex_result",
    "lex_payload",
    "parsed_module",
    "cpp_source",
    "build_path",
    "run_result",
    "execute_result",
]
NativeExecutionProjection = Literal[
    "token_payload",
    "parsed_module",
    "cpp_emit_result",
    "cpp_source",
    "executable_path",
    "run_result",
]

_PROJECTION_STAGE_REQUIREMENTS: dict[NativeExecutionProjection, NativeExecutionStage] = {
    "token_payload": "lex",
    "parsed_module": "parse",
    "cpp_emit_result": "emit",
    "cpp_source": "emit",
    "executable_path": "build",
    "run_result": "run",
}

_ALIAS_PROJECTION_REQUIREMENTS: dict[NativeExecutionAlias, NativeExecutionProjection | None] = {
    "summary": None,
    "execution_backend": None,
    "execution_mode": None,
    "fast_path_available": None,
    "fast_path_cpp_source": "cpp_source",
    "lex_result": "token_payload",
    "lex_payload": "token_payload",
    "parsed_module": "parsed_module",
    "cpp_source": "cpp_source",
    "build_path": "executable_path",
    "run_result": "run_result",
    "execute_result": "run_result",
}

_ALL_EXECUTION_STAGES: tuple[NativeExecutionStage, ...] = ("lex", "parse", "emit", "build", "run")
_ALL_EXECUTION_PROJECTIONS: tuple[NativeExecutionProjection, ...] = (
    "token_payload",
    "parsed_module",
    "cpp_emit_result",
    "cpp_source",
    "executable_path",
    "run_result",
)
_ALL_EXECUTION_ALIASES: tuple[NativeExecutionAlias, ...] = (
    "summary",
    "execution_backend",
    "execution_mode",
    "fast_path_available",
    "fast_path_cpp_source",
    "lex_result",
    "lex_payload",
    "parsed_module",
    "cpp_source",
    "build_path",
    "run_result",
    "execute_result",
)


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
    execution_backend: NativeExecutionBackend

    @property
    def used_native_parser_fast_path(self) -> bool:
        return self.execution_backend == "native_parser"


@dataclass(frozen=True)
class NativeRunResult:
    request: NativeFrontendInput
    executable_path: Path
    process: subprocess.CompletedProcess[str]
    execution_backend: NativeExecutionBackend

    @property
    def used_native_parser_fast_path(self) -> bool:
        return self.execution_backend == "native_parser"


@dataclass(frozen=True)
class NativeExecutionSummary:
    request: NativeFrontendInput
    execution_backend: NativeExecutionBackend
    mode: NativeExecutionMode
    available_stages: tuple[NativeExecutionStage, ...]
    default_executable_path: Path

    @property
    def used_native_parser_fast_path(self) -> bool:
        return self.execution_backend == "native_parser"

    def supports(self, stage: NativeExecutionStage) -> bool:
        return stage in self.available_stages

    def supports_projection(self, projection: NativeExecutionProjection) -> bool:
        required_stage = _PROJECTION_STAGE_REQUIREMENTS.get(projection)
        if required_stage is None:
            return False
        return self.supports(required_stage)

    def supports_alias(self, alias: NativeExecutionAlias) -> bool:
        required_projection = _ALIAS_PROJECTION_REQUIREMENTS.get(alias)
        if required_projection is None:
            return alias in _ALIAS_PROJECTION_REQUIREMENTS
        if alias == "fast_path_cpp_source" and not self.used_native_parser_fast_path:
            return False
        return self.supports_projection(required_projection)

    def supported_stages(self) -> tuple[NativeExecutionStage, ...]:
        return tuple(stage for stage in _ALL_EXECUTION_STAGES if self.supports(stage))

    def supported_projections(self) -> tuple[NativeExecutionProjection, ...]:
        return tuple(
            projection for projection in _ALL_EXECUTION_PROJECTIONS if self.supports_projection(projection)
        )

    def supported_aliases(self) -> tuple[NativeExecutionAlias, ...]:
        return tuple(alias for alias in _ALL_EXECUTION_ALIASES if self.supports_alias(alias))


@dataclass(frozen=True)
class NativeExecutionOutcome:
    summary: NativeExecutionSummary
    request: NativeFrontendInput
    execution_backend: NativeExecutionBackend
    stage: NativeExecutionStage
    token_payload: str | None = None
    parsed_module: ast.Module | None = None
    cpp_emit_result: NativeCppEmitResult | None = None
    executable_path: Path | None = None
    process: subprocess.CompletedProcess[str] | None = None

    @property
    def used_native_parser_fast_path(self) -> bool:
        return self.execution_backend == "native_parser"

    @property
    def cpp_source(self) -> str | None:
        if self.cpp_emit_result is None:
            return None
        return self.cpp_emit_result.cpp_source

    @property
    def stdout(self) -> str | None:
        if self.process is None:
            return None
        return self.process.stdout

    @property
    def returncode(self) -> int | None:
        if self.process is None:
            return None
        return self.process.returncode

    def to_token_payload(self) -> NativeTokenPayload:
        return NativeTokenPayload(request=self.request, payload=self.require_token_payload())

    def to_run_result(self) -> NativeRunResult:
        return NativeRunResult(
            request=self.request,
            executable_path=self.require_executable_path(),
            process=self.require_process(),
            execution_backend=self.execution_backend,
        )

    def to_cpp_emit_result(self) -> NativeCppEmitResult:
        return self.require_cpp_emit_result()

    def require_token_payload(self) -> str:
        if self.token_payload is None:
            raise ValueError(f"native execution outcome for stage {self.stage!r} has no token payload")
        return self.token_payload

    def require_parsed_module(self) -> ast.Module:
        if self.parsed_module is None:
            raise ValueError(f"native execution outcome for stage {self.stage!r} has no parsed module")
        return self.parsed_module

    def require_cpp_emit_result(self) -> NativeCppEmitResult:
        if self.cpp_emit_result is None:
            raise ValueError(f"native execution outcome for stage {self.stage!r} has no C++ emit result")
        return self.cpp_emit_result

    def require_cpp_source(self) -> str:
        return self.require_cpp_emit_result().cpp_source

    def require_executable_path(self) -> Path:
        if self.executable_path is None:
            raise ValueError(
                f"native execution outcome for stage {self.stage!r} has no executable path"
            )
        return self.executable_path

    def require_process(self) -> subprocess.CompletedProcess[str]:
        if self.process is None:
            raise ValueError(f"native execution outcome for stage {self.stage!r} has no process")
        return self.process

    def project(
        self,
        projection: NativeExecutionProjection,
    ) -> NativeTokenPayload | ast.Module | NativeCppEmitResult | str | Path | NativeRunResult:
        if projection == "token_payload":
            return self.to_token_payload()
        if projection == "parsed_module":
            return self.require_parsed_module()
        if projection == "cpp_emit_result":
            return self.to_cpp_emit_result()
        if projection == "cpp_source":
            return self.require_cpp_source()
        if projection == "executable_path":
            return self.require_executable_path()
        if projection == "run_result":
            return self.to_run_result()
        raise ValueError(f"unsupported native execution projection: {projection!r}")


@dataclass(frozen=True)
class NativeExecutionPlan:
    """One native execution strategy for the current request."""

    request: NativeFrontendInput
    mode: NativeExecutionMode
    native_parser_execution: NativeParserProtoExecution | None = None

    @classmethod
    def from_request(cls, request: NativeFrontendInput) -> NativeExecutionPlan:
        native_parser_execution = cls._try_native_parser_fast_path_execution(request)
        if native_parser_execution is not None:
            return cls(
                request=request,
                mode="native_parser_fast_path",
                native_parser_execution=native_parser_execution,
            )
        return cls(
            request=request,
            mode="token_stream_seam",
            native_parser_execution=None,
        )

    @staticmethod
    def _native_parser_fast_path_available(request: NativeFrontendInput) -> bool:
        capabilities = native_subset_capabilities(request.subset)
        if not (
            capabilities.supports_native_parser_fast_path
            and capabilities.supports_native_cpp_emit_fast_path
        ):
            return False
        try:
            if request.is_file_input:
                native_parser_proto_file_execution(request.path).cpp_source
            else:
                native_parser_proto_source_execution(
                    request.source or "",
                    filename=request.filename,
                ).cpp_source
        except CppEmitError:
            return False
        return True

    @classmethod
    def _try_native_parser_fast_path_execution(
        cls,
        request: NativeFrontendInput,
    ) -> NativeParserProtoExecution | None:
        if not cls._native_parser_fast_path_available(request):
            return None
        if request.is_file_input:
            return native_parser_proto_file_execution(request.path)
        return native_parser_proto_source_execution(request.source or "", filename=request.filename)

    @property
    def execution_backend(self) -> NativeExecutionBackend:
        if self.native_parser_execution is not None:
            return "native_parser"
        return "token_stream"

    @property
    def uses_native_parser_fast_path(self) -> bool:
        return self.execution_backend == "native_parser"

    def token_payload(self) -> str:
        return _lex_native_payload(self.request)

    def parsed_module(self) -> ast.Module:
        return parse_token_stream_json(self.token_payload())

    def emit_cpp(self) -> NativeCppEmitResult:
        if self.native_parser_execution is not None:
            return NativeCppEmitResult(
                request=self.request,
                cpp_source=self.native_parser_execution.cpp_source,
                execution_backend=self.execution_backend,
            )
        return NativeCppEmitResult(
            request=self.request,
            cpp_source=emit_cpp_from_token_stream_json(self.token_payload()),
            execution_backend=self.execution_backend,
        )

    def default_executable_name(self) -> str:
        if self.request.is_file_input:
            stem = self.request.path.stem
            return stem or "vf_native_subset"
        return "vf_native_subset"

    def default_executable_path(self, out_dir: str | Path | None = None) -> Path:
        if out_dir is None:
            base_dir = Path(tempfile.gettempdir()) / "vektorflow-native-runs"
        else:
            base_dir = Path(out_dir)
        suffix = ".exe" if os.name == "nt" else ""
        return base_dir / f"{self.default_executable_name()}{suffix}"

    def summary(self, out_dir: str | Path | None = None) -> NativeExecutionSummary:
        return NativeExecutionSummary(
            request=self.request,
            execution_backend=self.execution_backend,
            mode=self.mode,
            available_stages=("lex", "parse", "emit", "build", "run"),
            default_executable_path=self.default_executable_path(out_dir),
        )

    def build(self, out_path: str | Path) -> Path:
        out_path = Path(out_path)
        if self.native_parser_execution is not None:
            return self.native_parser_execution.build(out_path)
        compiled = compile_cpp_source(
            self.emit_cpp().cpp_source,
            out_path.parent,
            exe_name=out_path.stem or self.default_executable_name(),
        )
        if compiled != out_path:
            if out_path.exists():
                out_path.unlink()
            compiled.replace(out_path)
        return out_path

    def run(
        self,
        out_path: str | Path | None = None,
        *,
        out_dir: str | Path | None = None,
    ) -> NativeRunResult:
        executable_path = self.build(
            self.default_executable_path(out_dir) if out_path is None else out_path
        )
        process = subprocess.run([str(executable_path)], capture_output=True, text=True)
        return NativeRunResult(
            request=self.request,
            executable_path=executable_path,
            process=process,
            execution_backend=self.execution_backend,
        )

    def realize(
        self,
        stage: NativeExecutionStage,
        *,
        out_path: str | Path | None = None,
        out_dir: str | Path | None = None,
    ) -> NativeExecutionOutcome:
        summary = self.summary(out_dir if stage in {"build", "run"} else None)
        if stage == "lex":
            return NativeExecutionOutcome(
                summary=summary,
                request=self.request,
                execution_backend=self.execution_backend,
                stage=stage,
                token_payload=self.token_payload(),
            )
        if stage == "parse":
            return NativeExecutionOutcome(
                summary=summary,
                request=self.request,
                execution_backend=self.execution_backend,
                stage=stage,
                parsed_module=self.parsed_module(),
            )
        if stage == "emit":
            cpp_emit_result = self.emit_cpp()
            return NativeExecutionOutcome(
                summary=summary,
                request=self.request,
                execution_backend=self.execution_backend,
                stage=stage,
                cpp_emit_result=cpp_emit_result,
            )
        if stage == "build":
            cpp_emit_result = self.emit_cpp()
            executable_path = self.build(
                self.default_executable_path(out_dir) if out_path is None else out_path
            )
            return NativeExecutionOutcome(
                summary=summary,
                request=self.request,
                execution_backend=self.execution_backend,
                stage=stage,
                cpp_emit_result=cpp_emit_result,
                executable_path=executable_path,
            )
        if stage == "run":
            run_result = self.run(out_path=out_path, out_dir=out_dir)
            return NativeExecutionOutcome(
                summary=summary,
                request=self.request,
                execution_backend=self.execution_backend,
                stage=stage,
                executable_path=run_result.executable_path,
                process=run_result.process,
            )
        raise ValueError(f"unsupported native execution stage: {stage!r}")


@dataclass(frozen=True)
class NativeFrontendExecution:
    """Centralized execution flow for the current native frontend subset."""

    request: NativeFrontendInput

    @cached_property
    def plan(self) -> NativeExecutionPlan:
        return NativeExecutionPlan.from_request(self.request)

    @cached_property
    def summary(self) -> NativeExecutionSummary:
        return self.plan.summary()

    @cached_property
    def token_payload(self) -> str:
        return self.realize("lex").require_token_payload()

    @cached_property
    def parsed_module(self) -> ast.Module:
        return self.realize("parse").require_parsed_module()

    @property
    def native_parser_fast_path_available(self) -> bool:
        return self.alias("fast_path_available")

    @property
    def execution_backend(self) -> NativeExecutionBackend:
        return self.alias("execution_backend")

    @cached_property
    def native_parser_fast_path_cpp_source(self) -> str | None:
        return self.alias("fast_path_cpp_source")

    @cached_property
    def cpp_emit_result(self) -> NativeCppEmitResult:
        return self.realize("emit").to_cpp_emit_result()

    def build(self, out_path: str | Path) -> Path:
        return self.realize("build", out_path=out_path).require_executable_path()

    def run(self, out_path: str | Path) -> NativeRunResult:
        return self.realize("run", out_path=out_path).to_run_result()

    def execute(self, out_dir: str | Path | None = None) -> NativeRunResult:
        return self.realize("run", out_dir=out_dir).to_run_result()

    def realize(
        self,
        stage: NativeExecutionStage,
        *,
        out_path: str | Path | None = None,
        out_dir: str | Path | None = None,
    ) -> NativeExecutionOutcome:
        return self.plan.realize(stage, out_path=out_path, out_dir=out_dir)

    def project(
        self,
        stage: NativeExecutionStage,
        projection: NativeExecutionProjection,
        *,
        out_path: str | Path | None = None,
        out_dir: str | Path | None = None,
    ) -> NativeTokenPayload | ast.Module | NativeCppEmitResult | str | Path | NativeRunResult:
        return self.realize(stage, out_path=out_path, out_dir=out_dir).project(projection)

    def alias(
        self,
        alias: NativeExecutionAlias,
        *,
        out_path: str | Path | None = None,
        out_dir: str | Path | None = None,
    ) -> (
        NativeExecutionSummary
        | bool
        | NativeExecutionBackend
        | NativeExecutionMode
        | NativeTokenPayload
        | str
        | None
        | ast.Module
        | Path
        | NativeRunResult
    ):
        if alias == "summary":
            return self.summary
        if alias == "execution_backend":
            return self.summary.execution_backend
        if alias == "execution_mode":
            return self.summary.mode
        if alias == "fast_path_available":
            return self.summary.used_native_parser_fast_path
        if alias == "fast_path_cpp_source":
            if not self.summary.used_native_parser_fast_path:
                return None
            return self.project("emit", "cpp_source")
        if alias == "lex_result":
            return self.project("lex", "token_payload")
        if alias == "lex_payload":
            return self.token_payload
        if alias == "parsed_module":
            return self.project("parse", "parsed_module")
        if alias == "cpp_source":
            return self.project("emit", "cpp_source")
        if alias == "build_path":
            return self.project("build", "executable_path", out_path=out_path, out_dir=out_dir)
        if alias == "run_result":
            return self.project("run", "run_result", out_path=out_path, out_dir=out_dir)
        if alias == "execute_result":
            return self.project("run", "run_result", out_dir=out_dir)
        raise ValueError(f"unsupported native execution alias: {alias!r}")


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
    return alias_native_subset(
        source,
        filename,
        alias="fast_path_available",
        subset=subset,
        filename_label=filename_label,
    )


def _default_filename_label(source: str | None, filename: str) -> str:
    if source is None:
        return Path(filename).as_posix()
    return filename


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


def summarize_native_subset(
    source: str | None,
    filename: str,
    *,
    out_dir: str | Path | None = None,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeExecutionSummary:
    """Return one backend-neutral execution summary for the current native subset request."""

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).alias("summary", out_dir=out_dir)


def project_native_subset(
    source: str | None,
    filename: str,
    *,
    stage: NativeExecutionStage,
    projection: NativeExecutionProjection,
    out_path: str | Path | None = None,
    out_dir: str | Path | None = None,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeTokenPayload | ast.Module | NativeCppEmitResult | str | Path | NativeRunResult:
    """Project one route-neutral native frontend result from the plan/outcome core."""

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).project(stage, projection, out_path=out_path, out_dir=out_dir)


def alias_native_subset(
    source: str | None,
    filename: str,
    *,
    alias: NativeExecutionAlias,
    out_path: str | Path | None = None,
    out_dir: str | Path | None = None,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> (
    NativeExecutionSummary
    | bool
    | NativeExecutionBackend
    | NativeExecutionMode
    | NativeTokenPayload
    | str
    | None
    | ast.Module
    | Path
    | NativeRunResult
):
    """Expose the legacy helper alias family through one deep native frontend surface."""

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).alias(alias, out_path=out_path, out_dir=out_dir)


def lex_native_subset_result(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeTokenPayload:
    """Return the normalized native frontend request and token payload."""

    return alias_native_subset(
        source,
        filename,
        alias="lex_result",
        subset=subset,
        filename_label=filename_label,
    )


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

    return alias_native_subset(
        source,
        filename,
        alias="lex_payload",
        subset=subset,
        filename_label=filename_label,
    )


def parse_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> ast.Module:
    """Parse the active native frontend subset through the token-stream seam."""

    return alias_native_subset(
        source,
        filename,
        alias="parsed_module",
        subset=subset,
        filename_label=filename_label,
    )


def emit_cpp_from_native_subset(
    source: str | None,
    filename: str,
    *,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> str:
    """Emit C++ using the active native frontend subset as the source frontend."""

    return alias_native_subset(
        source,
        filename,
        alias="cpp_source",
        subset=subset,
        filename_label=filename_label,
    )


def build_native_subset(
    source: str | None,
    filename: str,
    *,
    out_path: str | Path,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> Path:
    """Compile the active native frontend subset to an executable path."""

    return alias_native_subset(
        source,
        filename,
        alias="build_path",
        out_path=out_path,
        subset=subset,
        filename_label=filename_label,
    )


def run_native_subset(
    source: str | None,
    filename: str,
    *,
    out_path: str | Path,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeRunResult:
    """Build and run the active native frontend subset through one execution flow."""

    return alias_native_subset(
        source,
        filename,
        alias="run_result",
        out_path=out_path,
        subset=subset,
        filename_label=filename_label,
    )


def execute_native_subset(
    source: str | None,
    filename: str,
    *,
    out_dir: str | Path | None = None,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeRunResult:
    """Build and run the active native subset using a default executable location."""

    return alias_native_subset(
        source,
        filename,
        alias="execute_result",
        out_dir=out_dir,
        subset=subset,
        filename_label=filename_label,
    )


def realize_native_subset(
    source: str | None,
    filename: str,
    *,
    stage: NativeExecutionStage,
    out_path: str | Path | None = None,
    out_dir: str | Path | None = None,
    subset: str = "native_core",
    filename_label: str | None = None,
) -> NativeExecutionOutcome:
    """Materialize one native-first frontend outcome through a single plan interface."""

    return native_frontend_execution(
        source,
        filename,
        subset=subset,
        filename_label=filename_label,
    ).realize(stage, out_path=out_path, out_dir=out_dir)
