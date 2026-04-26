from __future__ import annotations

import contextlib
import io
import json
import math
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from .cpp_backend import (
    CppEmitError,
    compile_cpp_source,
    discover_cpp_compiler,
    emit_cpp_module,
    run_cpp_executable,
)
from .interpreter import EvalError, Interpreter
from .ir import lower_module
from .lexer import LexError
from .parser import ParseError, parse_module


@dataclass(frozen=True)
class BenchmarkCase:
    name: str
    rel_path: str
    native_supported: bool
    description: str

    @property
    def path(self) -> Path:
        return benchmark_root() / self.rel_path


@dataclass
class BenchmarkResult:
    case: BenchmarkCase
    parse_ms: float | None = None
    lower_ms: float | None = None
    interpret_ms: float | None = None
    emit_cpp_ms: float | None = None
    compile_ms: float | None = None
    native_run_ms: float | None = None
    interpreter_stdout: str = ""
    native_stdout: str | None = None
    native_status: str = "not-requested"
    output_match: bool | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and (self.output_match is not False)


BENCHMARK_CASES: tuple[BenchmarkCase, ...] = (
    BenchmarkCase(
        "scalar_control",
        "scalar_control.vkf",
        True,
        "Scalar math, functions, loops, match, and return-channel control flow.",
    ),
    BenchmarkCase(
        "vectors_shapes",
        "vectors_shapes.vkf",
        True,
        "Fixed vectors, symbolic sizes, compile-time shape arithmetic, and vector ops.",
    ),
    BenchmarkCase(
        "records_dynamic",
        "records_dynamic.vkf",
        True,
        "Records mixed with dynamic map/list payloads and nested field access.",
    ),
    BenchmarkCase(
        "multisets_records",
        "multisets_records.vkf",
        True,
        "Multisets, records, and collection transforms in the native subset.",
    ),
    BenchmarkCase(
        "bitmask_match",
        "bitmask_match.vkf",
        True,
        "Integer bitmask specificity in ?? matching.",
    ),
    BenchmarkCase(
        "custom_overloads",
        "custom_overloads.vkf",
        False,
        "Interpreter-only custom casts, reach overloads, and display behavior.",
    ),
    BenchmarkCase(
        "scalar_hotloop",
        "scalar_hotloop.vkf",
        True,
        "Heavier scalar/runtime loop workload for interpreter vs native timing.",
    ),
    BenchmarkCase(
        "vector_hotloop",
        "vector_hotloop.vkf",
        True,
        "Heavier vector loop workload with fixed-size vector arithmetic.",
    ),
)


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def benchmark_root() -> Path:
    return repo_root() / "examples" / "benchmarks"


def list_benchmarks() -> tuple[BenchmarkCase, ...]:
    return BENCHMARK_CASES


def get_benchmark(name: str) -> BenchmarkCase:
    for case in BENCHMARK_CASES:
        if case.name == name:
            return case
    raise KeyError(name)


def select_benchmarks(patterns: list[str] | None = None) -> list[BenchmarkCase]:
    if not patterns:
        return list(BENCHMARK_CASES)
    lowered = [p.lower() for p in patterns]
    out: list[BenchmarkCase] = []
    for case in BENCHMARK_CASES:
        hay = f"{case.name} {case.rel_path} {case.description}".lower()
        if any(p in hay for p in lowered):
            out.append(case)
    return out


def _ms(start: float, end: float) -> float:
    return round((end - start) * 1000.0, 3)


def run_benchmark(case: BenchmarkCase) -> BenchmarkResult:
    result = BenchmarkResult(case=case)
    try:
        source = case.path.read_text(encoding="utf-8")

        t0 = time.perf_counter()
        module = parse_module(source, filename=str(case.path))
        t1 = time.perf_counter()
        result.parse_ms = _ms(t0, t1)

        buf = io.StringIO()
        interp = Interpreter(case.path.resolve())
        t4 = time.perf_counter()
        with contextlib.redirect_stdout(buf):
            interp.run_module(module)
        t5 = time.perf_counter()
        result.interpret_ms = _ms(t4, t5)
        result.interpreter_stdout = buf.getvalue()

        if not case.native_supported:
            result.native_status = "unsupported"
            return result

        t2 = time.perf_counter()
        lowered = lower_module(module)
        t3 = time.perf_counter()
        result.lower_ms = _ms(t2, t3)

        t6 = time.perf_counter()
        cpp_source = emit_cpp_module(lowered)
        t7 = time.perf_counter()
        result.emit_cpp_ms = _ms(t6, t7)

        compiler = discover_cpp_compiler()
        if compiler is None:
            result.native_status = "compiler-unavailable"
            return result

        with tempfile.TemporaryDirectory(prefix="vf_bench_") as td:
            t8 = time.perf_counter()
            exe = compile_cpp_source(cpp_source, Path(td), exe_name=f"vf_{case.name}")
            t9 = time.perf_counter()
            result.compile_ms = _ms(t8, t9)

            t10 = time.perf_counter()
            proc = run_cpp_executable(exe)
            t11 = time.perf_counter()
            result.native_run_ms = _ms(t10, t11)

        result.native_stdout = proc.stdout
        result.native_status = "ok" if proc.returncode == 0 else f"runtime-error:{proc.returncode}"
        if proc.returncode != 0:
            result.error = proc.stderr.strip() or "native program failed"
            return result
        result.output_match = _outputs_match(result.interpreter_stdout, result.native_stdout)
        if result.output_match is False:
            result.error = "native output mismatch"
        return result
    except (OSError, LexError, ParseError, EvalError, CppEmitError, NotImplementedError) as exc:
        result.error = str(exc)
        if result.native_status == "not-requested":
            result.native_status = "error"
        return result


def format_benchmark_report(results: list[BenchmarkResult]) -> str:
    lines = [
        "name                 parse   lower   interp   cpp_emit  compile   native    status",
        "--------------------------------------------------------------------------------",
    ]
    for r in results:
        lines.append(
            f"{r.case.name:<20} "
            f"{_fmt_ms(r.parse_ms):>7} "
            f"{_fmt_ms(r.lower_ms):>7} "
            f"{_fmt_ms(r.interpret_ms):>8} "
            f"{_fmt_ms(r.emit_cpp_ms):>9} "
            f"{_fmt_ms(r.compile_ms):>8} "
            f"{_fmt_ms(r.native_run_ms):>8} "
            f"{_status_text(r)}"
        )
    ok = sum(1 for r in results if r.ok)
    lines.append("")
    lines.append(f"summary: {ok}/{len(results)} benchmark(s) OK")
    if any(r.output_match is False for r in results):
        bad = ", ".join(r.case.name for r in results if r.output_match is False)
        lines.append(f"output mismatches: {bad}")
    if any(r.error for r in results):
        lines.append("errors:")
        for r in results:
            if r.error:
                lines.append(f"  - {r.case.name}: {r.error}")
    return "\n".join(lines)


def benchmark_result_to_dict(result: BenchmarkResult) -> dict[str, object]:
    return {
        "name": result.case.name,
        "path": str(result.case.path),
        "description": result.case.description,
        "native_supported": result.case.native_supported,
        "ok": result.ok,
        "parse_ms": result.parse_ms,
        "lower_ms": result.lower_ms,
        "interpret_ms": result.interpret_ms,
        "emit_cpp_ms": result.emit_cpp_ms,
        "compile_ms": result.compile_ms,
        "native_run_ms": result.native_run_ms,
        "native_status": result.native_status,
        "output_match": result.output_match,
        "error": result.error,
        "interpreter_stdout": result.interpreter_stdout,
        "native_stdout": result.native_stdout,
    }


def benchmark_case_to_dict(case: BenchmarkCase) -> dict[str, object]:
    return {
        "name": case.name,
        "path": str(case.path),
        "rel_path": case.rel_path,
        "native_supported": case.native_supported,
        "description": case.description,
    }


def format_benchmark_json(results: list[BenchmarkResult]) -> str:
    payload = {
        "summary": {
            "count": len(results),
            "ok": sum(1 for r in results if r.ok),
            "all_ok": all(r.ok for r in results),
        },
        "results": [benchmark_result_to_dict(r) for r in results],
    }
    return json.dumps(payload, indent=2)


def format_benchmark_list_json(cases: list[BenchmarkCase] | tuple[BenchmarkCase, ...]) -> str:
    return json.dumps([benchmark_case_to_dict(case) for case in cases], indent=2)


def _fmt_ms(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.3f}"


def _status_text(result: BenchmarkResult) -> str:
    if result.error:
        return f"error ({result.native_status})"
    if result.native_status == "ok" and result.output_match:
        return "ok (match)"
    if result.native_status == "ok" and result.output_match is False:
        return "mismatch"
    return result.native_status


def _outputs_match(left: str, right: str) -> bool:
    if left == right:
        return True
    left_lines = left.splitlines()
    right_lines = right.splitlines()
    if len(left_lines) != len(right_lines):
        return False
    return all(_line_matches(a, b) for a, b in zip(left_lines, right_lines))


def _line_matches(left: str, right: str) -> bool:
    if left == right:
        return True
    try:
        lv = float(left)
        rv = float(right)
    except ValueError:
        return False
    return math.isclose(lv, rv, rel_tol=1e-12, abs_tol=1e-12)
