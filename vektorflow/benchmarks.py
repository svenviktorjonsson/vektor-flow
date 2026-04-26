from __future__ import annotations

import contextlib
import io
import json
import math
import statistics
import tempfile
import time
from dataclasses import dataclass, field
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
    sample_count: int = 1
    native_run_count: int = 1
    native_warmup_count: int = 0
    parse_samples_ms: list[float] = field(default_factory=list)
    lower_samples_ms: list[float] = field(default_factory=list)
    interpret_samples_ms: list[float] = field(default_factory=list)
    emit_cpp_samples_ms: list[float] = field(default_factory=list)
    compile_samples_ms: list[float] = field(default_factory=list)
    native_run_samples_ms: list[float] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.error is None and (self.output_match is not False)

    @property
    def python_roundtrip_ms(self) -> float | None:
        if self.parse_ms is None or self.interpret_ms is None:
            return None
        return round(self.parse_ms + self.interpret_ms, 3)

    @property
    def native_roundtrip_ms(self) -> float | None:
        parts = (
            self.parse_ms,
            self.lower_ms,
            self.emit_cpp_ms,
            self.compile_ms,
            self.native_run_ms,
        )
        if any(part is None for part in parts):
            return None
        return round(sum(part for part in parts if part is not None), 3)

    @property
    def native_steady_speedup(self) -> float | None:
        if self.interpret_ms is None or self.native_run_ms is None or self.native_run_ms == 0:
            return None
        return round(self.interpret_ms / self.native_run_ms, 3)

    @property
    def native_roundtrip_vs_python(self) -> float | None:
        if self.python_roundtrip_ms is None or self.native_roundtrip_ms is None or self.native_roundtrip_ms == 0:
            return None
        return round(self.python_roundtrip_ms / self.native_roundtrip_ms, 3)


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


def _median_ms(values: list[float]) -> float | None:
    if not values:
        return None
    return round(float(statistics.median(values)), 3)


def _run_benchmark_once(case: BenchmarkCase, source: str, native_runs: int, native_warmups: int) -> BenchmarkResult:
    result = BenchmarkResult(case=case)
    result.native_run_count = native_runs
    result.native_warmup_count = native_warmups
    try:
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

            for _ in range(native_warmups):
                warmup = run_cpp_executable(exe)
                if warmup.returncode != 0:
                    result.native_stdout = warmup.stdout
                    result.native_status = f"runtime-error:{warmup.returncode}"
                    result.error = warmup.stderr.strip() or "native program failed"
                    return result
            native_run_samples: list[float] = []
            proc = None
            for _ in range(native_runs):
                t10 = time.perf_counter()
                proc = run_cpp_executable(exe)
                t11 = time.perf_counter()
                native_run_samples.append(_ms(t10, t11))
            result.native_run_samples_ms = native_run_samples
            result.native_run_ms = _median_ms(native_run_samples)

        assert proc is not None
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


def run_benchmark(
    case: BenchmarkCase,
    samples: int = 1,
    native_runs: int = 1,
    native_warmups: int | None = None,
) -> BenchmarkResult:
    if samples < 1:
        raise ValueError("samples must be >= 1")
    if native_runs < 1:
        raise ValueError("native_runs must be >= 1")
    if native_warmups is None:
        native_warmups = 1 if native_runs > 1 else 0
    if native_warmups < 0:
        raise ValueError("native_warmups must be >= 0")
    source = case.path.read_text(encoding="utf-8")
    runs: list[BenchmarkResult] = []
    for _ in range(samples):
        run = _run_benchmark_once(case, source, native_runs=native_runs, native_warmups=native_warmups)
        runs.append(run)
        if not run.ok:
            break
    first = runs[0]
    aggregated = BenchmarkResult(
        case=case,
        interpreter_stdout=first.interpreter_stdout,
        native_stdout=first.native_stdout,
        native_status=first.native_status,
        output_match=first.output_match,
        error=first.error,
        sample_count=len(runs),
        native_run_count=native_runs,
        native_warmup_count=native_warmups,
        parse_samples_ms=[r.parse_ms for r in runs if r.parse_ms is not None],
        lower_samples_ms=[r.lower_ms for r in runs if r.lower_ms is not None],
        interpret_samples_ms=[r.interpret_ms for r in runs if r.interpret_ms is not None],
        emit_cpp_samples_ms=[r.emit_cpp_ms for r in runs if r.emit_cpp_ms is not None],
        compile_samples_ms=[r.compile_ms for r in runs if r.compile_ms is not None],
        native_run_samples_ms=[value for r in runs for value in r.native_run_samples_ms],
    )
    aggregated.parse_ms = _median_ms(aggregated.parse_samples_ms)
    aggregated.lower_ms = _median_ms(aggregated.lower_samples_ms)
    aggregated.interpret_ms = _median_ms(aggregated.interpret_samples_ms)
    aggregated.emit_cpp_ms = _median_ms(aggregated.emit_cpp_samples_ms)
    aggregated.compile_ms = _median_ms(aggregated.compile_samples_ms)
    aggregated.native_run_ms = _median_ms(aggregated.native_run_samples_ms)
    return aggregated


def format_benchmark_report(results: list[BenchmarkResult]) -> str:
    sample_counts = sorted({r.sample_count for r in results})
    sample_label = str(sample_counts[0]) if len(sample_counts) == 1 else ",".join(str(n) for n in sample_counts)
    native_run_counts = sorted({r.native_run_count for r in results})
    native_run_label = str(native_run_counts[0]) if len(native_run_counts) == 1 else ",".join(str(n) for n in native_run_counts)
    native_warmup_counts = sorted({r.native_warmup_count for r in results})
    native_warmup_label = (
        str(native_warmup_counts[0]) if len(native_warmup_counts) == 1 else ",".join(str(n) for n in native_warmup_counts)
    )
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
    lines.append(
        f"timings: median of {sample_label} sample(s), native run median over {native_run_label} execution(s) after {native_warmup_label} warmup run(s), units=ms"
    )
    comparative = [r for r in results if r.native_status == "ok" and r.output_match]
    if comparative:
        lines.append("")
        lines.append("comparisons (all times in ms, speedup as interpreter/native runtime):")
        for r in comparative:
            lines.append(
                "  - "
                f"{r.case.name}: "
                f"python_roundtrip={_fmt_ms(r.python_roundtrip_ms)} ms, "
                f"native_roundtrip={_fmt_ms(r.native_roundtrip_ms)} ms, "
                f"steady_speedup={_fmt_ratio(r.native_steady_speedup)}x, "
                f"roundtrip_vs_python={_fmt_ratio(r.native_roundtrip_vs_python)}x"
            )
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
        "sample_count": result.sample_count,
        "native_run_count": result.native_run_count,
        "native_warmup_count": result.native_warmup_count,
        "aggregation": "median",
        "units": "ms",
        "parse_ms": result.parse_ms,
        "parse_samples_ms": result.parse_samples_ms,
        "lower_ms": result.lower_ms,
        "lower_samples_ms": result.lower_samples_ms,
        "interpret_ms": result.interpret_ms,
        "interpret_samples_ms": result.interpret_samples_ms,
        "emit_cpp_ms": result.emit_cpp_ms,
        "emit_cpp_samples_ms": result.emit_cpp_samples_ms,
        "compile_ms": result.compile_ms,
        "compile_samples_ms": result.compile_samples_ms,
        "native_run_ms": result.native_run_ms,
        "native_run_samples_ms": result.native_run_samples_ms,
        "python_roundtrip_ms": result.python_roundtrip_ms,
        "native_roundtrip_ms": result.native_roundtrip_ms,
        "native_steady_speedup": result.native_steady_speedup,
        "native_roundtrip_vs_python": result.native_roundtrip_vs_python,
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
    speedups = [r.native_steady_speedup for r in results if r.native_steady_speedup is not None]
    roundtrip_ratios = [
        r.native_roundtrip_vs_python for r in results if r.native_roundtrip_vs_python is not None
    ]
    sample_counts = sorted({r.sample_count for r in results})
    native_run_counts = sorted({r.native_run_count for r in results})
    native_warmup_counts = sorted({r.native_warmup_count for r in results})
    payload = {
        "summary": {
            "count": len(results),
            "ok": sum(1 for r in results if r.ok),
            "all_ok": all(r.ok for r in results),
            "sample_counts": sample_counts,
            "native_run_counts": native_run_counts,
            "native_warmup_counts": native_warmup_counts,
            "aggregation": "median",
            "units": "ms",
            "avg_native_steady_speedup": round(sum(speedups) / len(speedups), 3) if speedups else None,
            "avg_native_roundtrip_vs_python": (
                round(sum(roundtrip_ratios) / len(roundtrip_ratios), 3) if roundtrip_ratios else None
            ),
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


def _fmt_ratio(value: float | None) -> str:
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
