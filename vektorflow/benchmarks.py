from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import math
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

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
    reference_impl: str | None = None

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
    python_ref_ms: float | None = None
    numpy_ref_ms: float | None = None
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
    python_ref_samples_ms: list[float] = field(default_factory=list)
    numpy_ref_samples_ms: list[float] = field(default_factory=list)

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

    @property
    def native_vs_python_ref(self) -> float | None:
        if self.python_ref_ms is None or self.native_run_ms is None or self.native_run_ms == 0:
            return None
        return round(self.python_ref_ms / self.native_run_ms, 3)

    @property
    def native_vs_numpy_ref(self) -> float | None:
        if self.numpy_ref_ms is None or self.native_run_ms is None or self.native_run_ms == 0:
            return None
        return round(self.numpy_ref_ms / self.native_run_ms, 3)


TIME_METRICS: tuple[str, ...] = (
    "parse_ms",
    "lower_ms",
    "interpret_ms",
    "emit_cpp_ms",
    "compile_ms",
    "native_run_ms",
    "python_ref_ms",
    "numpy_ref_ms",
    "python_roundtrip_ms",
    "native_roundtrip_ms",
)

SPEEDUP_METRICS: tuple[str, ...] = (
    "native_steady_speedup",
    "native_roundtrip_vs_python",
    "native_vs_python_ref",
    "native_vs_numpy_ref",
)


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
        reference_impl="vector_hotloop",
    ),
    BenchmarkCase(
        "vector_large_elementwise",
        "vector_large_elementwise.vkf",
        True,
        "Large fixed-vector elementwise arithmetic with scalar sentinel checks.",
        reference_impl="vector_large_elementwise",
    ),
    BenchmarkCase(
        "vector_large_reduce",
        "vector_large_reduce.vkf",
        True,
        "Large fixed-vector reduction using indexed accumulation.",
        reference_impl="vector_large_reduce",
    ),
)

_HAS_NUMPY = importlib.util.find_spec("numpy") is not None
_VECTOR_LARGE_SIZE = 1024
_VECTOR_LARGE_REPS = 256


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def benchmark_root() -> Path:
    return repo_root() / "examples" / "benchmarks"


def benchmark_cache_root() -> Path:
    return repo_root() / ".vf-bench-cache"


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


def _compile_cached_benchmark(case: BenchmarkCase, cpp_source: str) -> Path:
    compiler = discover_cpp_compiler()
    if compiler is None:
        raise CppEmitError("no C++ compiler found on PATH")
    compiler_key = f"{compiler.kind}:{compiler.path}"
    digest = hashlib.sha256((compiler_key + "\n" + cpp_source).encode("utf-8")).hexdigest()[:16]
    out_dir = benchmark_cache_root() / f"{case.name}-{digest}"
    exe = out_dir / f"vf_{case.name}"
    if exe.is_file():
        return exe
    return compile_cpp_source(cpp_source, out_dir, exe_name=f"vf_{case.name}")


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

        python_ref = _run_reference_impl(case.reference_impl, kind="python")
        if python_ref is not None:
            result.python_ref_ms, python_ref_stdout = python_ref
            if not _outputs_match(result.interpreter_stdout, python_ref_stdout):
                result.error = "python reference output mismatch"
                result.native_status = "error"
                return result
        numpy_ref = _run_reference_impl(case.reference_impl, kind="numpy")
        if numpy_ref is not None:
            result.numpy_ref_ms, numpy_ref_stdout = numpy_ref
            if not _outputs_match(result.interpreter_stdout, numpy_ref_stdout):
                result.error = "numpy reference output mismatch"
                result.native_status = "error"
                return result

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

        if discover_cpp_compiler() is None:
            result.native_status = "compiler-unavailable"
            return result

        t8 = time.perf_counter()
        exe = _compile_cached_benchmark(case, cpp_source)
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
        python_ref_samples_ms=[r.python_ref_ms for r in runs if r.python_ref_ms is not None],
        numpy_ref_samples_ms=[r.numpy_ref_ms for r in runs if r.numpy_ref_ms is not None],
    )
    aggregated.parse_ms = _median_ms(aggregated.parse_samples_ms)
    aggregated.lower_ms = _median_ms(aggregated.lower_samples_ms)
    aggregated.interpret_ms = _median_ms(aggregated.interpret_samples_ms)
    aggregated.emit_cpp_ms = _median_ms(aggregated.emit_cpp_samples_ms)
    aggregated.compile_ms = _median_ms(aggregated.compile_samples_ms)
    aggregated.native_run_ms = _median_ms(aggregated.native_run_samples_ms)
    aggregated.python_ref_ms = _median_ms(aggregated.python_ref_samples_ms)
    aggregated.numpy_ref_ms = _median_ms(aggregated.numpy_ref_samples_ms)
    return aggregated


def format_benchmark_report(results: list[BenchmarkResult], baseline: dict[str, object] | None = None) -> str:
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
            if r.python_ref_ms is not None or r.numpy_ref_ms is not None:
                lines.append(
                    "    "
                    f"runtime_refs: python={_fmt_ms(r.python_ref_ms)} ms, "
                    f"numpy={_fmt_ms(r.numpy_ref_ms)} ms, "
                    f"native_vs_python_ref={_fmt_ratio(r.native_vs_python_ref)}x, "
                    f"native_vs_numpy_ref={_fmt_ratio(r.native_vs_numpy_ref)}x"
                )
    if baseline is not None:
        comparison = compare_benchmark_payload(build_benchmark_payload(results), baseline)
        lines.extend(_format_baseline_report_lines(comparison))
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
        "python_ref_ms": result.python_ref_ms,
        "python_ref_samples_ms": result.python_ref_samples_ms,
        "numpy_ref_ms": result.numpy_ref_ms,
        "numpy_ref_samples_ms": result.numpy_ref_samples_ms,
        "python_roundtrip_ms": result.python_roundtrip_ms,
        "native_roundtrip_ms": result.native_roundtrip_ms,
        "native_steady_speedup": result.native_steady_speedup,
        "native_roundtrip_vs_python": result.native_roundtrip_vs_python,
        "native_vs_python_ref": result.native_vs_python_ref,
        "native_vs_numpy_ref": result.native_vs_numpy_ref,
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
        "reference_impl": case.reference_impl,
    }


def build_benchmark_payload(results: list[BenchmarkResult]) -> dict[str, object]:
    speedups = [r.native_steady_speedup for r in results if r.native_steady_speedup is not None]
    roundtrip_ratios = [
        r.native_roundtrip_vs_python for r in results if r.native_roundtrip_vs_python is not None
    ]
    python_ref_ratios = [r.native_vs_python_ref for r in results if r.native_vs_python_ref is not None]
    numpy_ref_ratios = [r.native_vs_numpy_ref for r in results if r.native_vs_numpy_ref is not None]
    sample_counts = sorted({r.sample_count for r in results})
    native_run_counts = sorted({r.native_run_count for r in results})
    native_warmup_counts = sorted({r.native_warmup_count for r in results})
    return {
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
            "avg_native_vs_python_ref": round(sum(python_ref_ratios) / len(python_ref_ratios), 3) if python_ref_ratios else None,
            "avg_native_vs_numpy_ref": round(sum(numpy_ref_ratios) / len(numpy_ref_ratios), 3) if numpy_ref_ratios else None,
        },
        "results": [benchmark_result_to_dict(r) for r in results],
    }


def format_benchmark_json(results: list[BenchmarkResult], baseline: dict[str, object] | None = None) -> str:
    payload = build_benchmark_payload(results)
    if baseline is not None:
        payload["baseline_comparison"] = compare_benchmark_payload(payload, baseline)
    return json.dumps(payload, indent=2)


def save_benchmark_baseline(results: list[BenchmarkResult], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = build_benchmark_payload(results)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_benchmark_baseline(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def compare_benchmark_payload(current: dict[str, object], baseline: dict[str, object]) -> dict[str, object]:
    current_results = {
        item["name"]: item
        for item in current.get("results", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    baseline_results = {
        item["name"]: item
        for item in baseline.get("results", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    all_names = sorted(set(current_results) | set(baseline_results))
    compared: list[dict[str, object]] = []
    for name in all_names:
        now = current_results.get(name)
        before = baseline_results.get(name)
        compared.append(
            {
                "name": name,
                "present_in_current": now is not None,
                "present_in_baseline": before is not None,
                "time_metrics": _compare_metric_group(now, before, TIME_METRICS, prefer_lower=True),
                "speedup_metrics": _compare_metric_group(now, before, SPEEDUP_METRICS, prefer_lower=False),
            }
        )
    return {
        "baseline_summary": baseline.get("summary"),
        "current_summary": current.get("summary"),
        "benchmarks": compared,
    }


def _vf_number_string(value: float | int) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _vector_hotloop_output_python() -> str:
    v0 = 0.0
    v1 = 0.0
    for _ in range(12000):
        v0 += 1.0
        v1 += 2.0
    return f"[{_vf_number_string(v0)}, {_vf_number_string(v1)}]\n"


def _vector_hotloop_output_numpy() -> str:
    import numpy as np

    step = np.array([1.0, 2.0], dtype=np.float64)
    out = np.array([0.0, 0.0], dtype=np.float64)
    for _ in range(12000):
        out = out + step
    return f"[{_vf_number_string(float(out[0]))}, {_vf_number_string(float(out[1]))}]\n"


def _large_vector_inputs_python() -> tuple[list[float], list[float]]:
    a = [float(i) for i in range(_VECTOR_LARGE_SIZE)]
    b = [float(i + 1) for i in range(_VECTOR_LARGE_SIZE)]
    return a, b


def _vector_large_elementwise_output_python() -> str:
    a, b = _large_vector_inputs_python()
    out = list(a)
    for _ in range(_VECTOR_LARGE_REPS):
        out = [(x + y) * 0.5 for x, y in zip(out, b)]
    return (
        f"{_vf_number_string(out[0])}\n"
        f"{_vf_number_string(out[_VECTOR_LARGE_SIZE // 2])}\n"
        f"{_vf_number_string(out[-1])}\n"
    )


def _vector_large_elementwise_output_numpy() -> str:
    import numpy as np

    a = np.arange(_VECTOR_LARGE_SIZE, dtype=np.float64)
    b = np.arange(1, _VECTOR_LARGE_SIZE + 1, dtype=np.float64)
    out = a
    for _ in range(_VECTOR_LARGE_REPS):
        out = (out + b) * 0.5
    return (
        f"{_vf_number_string(float(out[0]))}\n"
        f"{_vf_number_string(float(out[_VECTOR_LARGE_SIZE // 2]))}\n"
        f"{_vf_number_string(float(out[-1]))}\n"
    )


def _vector_large_reduce_output_python() -> str:
    a, b = _large_vector_inputs_python()
    vec = [(x * y) + y for x, y in zip(a, b)]
    total = 0.0
    for _ in range(_VECTOR_LARGE_REPS):
        subtotal = 0.0
        for value in vec:
            subtotal += value
        total += subtotal
    return f"{_vf_number_string(total)}\n"


def _vector_large_reduce_output_numpy() -> str:
    import numpy as np

    a = np.arange(_VECTOR_LARGE_SIZE, dtype=np.float64)
    b = np.arange(1, _VECTOR_LARGE_SIZE + 1, dtype=np.float64)
    vec = (a * b) + b
    total = 0.0
    for _ in range(_VECTOR_LARGE_REPS):
        total += float(np.sum(vec))
    return f"{_vf_number_string(total)}\n"


_PYTHON_REFERENCE_IMPLS: dict[str, Callable[[], str]] = {
    "vector_hotloop": _vector_hotloop_output_python,
    "vector_large_elementwise": _vector_large_elementwise_output_python,
    "vector_large_reduce": _vector_large_reduce_output_python,
}

_NUMPY_REFERENCE_IMPLS: dict[str, Callable[[], str]] = {
    "vector_hotloop": _vector_hotloop_output_numpy,
    "vector_large_elementwise": _vector_large_elementwise_output_numpy,
    "vector_large_reduce": _vector_large_reduce_output_numpy,
}


def _run_reference_impl(reference_impl: str | None, kind: str) -> tuple[float, str] | None:
    if reference_impl is None:
        return None
    if kind == "numpy":
        if not _HAS_NUMPY:
            return None
        fn = _NUMPY_REFERENCE_IMPLS.get(reference_impl)
    else:
        fn = _PYTHON_REFERENCE_IMPLS.get(reference_impl)
    if fn is None:
        return None
    t0 = time.perf_counter()
    output = fn()
    t1 = time.perf_counter()
    return _ms(t0, t1), output


def format_benchmark_list_json(cases: list[BenchmarkCase] | tuple[BenchmarkCase, ...]) -> str:
    return json.dumps([benchmark_case_to_dict(case) for case in cases], indent=2)


def _compare_metric_group(
    current: dict[str, object] | None,
    baseline: dict[str, object] | None,
    metrics: tuple[str, ...],
    *,
    prefer_lower: bool,
) -> dict[str, dict[str, float | None] | None]:
    out: dict[str, dict[str, float | None] | None] = {}
    for metric in metrics:
        cur_val = _float_or_none(current.get(metric) if current else None)
        base_val = _float_or_none(baseline.get(metric) if baseline else None)
        if cur_val is None or base_val is None:
            out[metric] = None
            continue
        delta = round(cur_val - base_val, 3)
        pct = round((delta / base_val) * 100.0, 3) if base_val != 0 else None
        factor = round((base_val / cur_val) if prefer_lower and cur_val != 0 else (cur_val / base_val if base_val != 0 else 0), 3)
        out[metric] = {
            "current": cur_val,
            "baseline": base_val,
            "delta": delta,
            "delta_pct": pct,
            "improvement_factor": factor,
        }
    return out


def _format_baseline_report_lines(comparison: dict[str, object]) -> list[str]:
    lines = ["", "baseline deltas:"]
    for item in comparison.get("benchmarks", []):
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not isinstance(name, str):
            continue
        if not item.get("present_in_current"):
            lines.append(f"  - {name}: missing from current run")
            continue
        if not item.get("present_in_baseline"):
            lines.append(f"  - {name}: new benchmark (not present in baseline)")
            continue
        time_summary = _metric_brief(item.get("time_metrics"), ("native_run_ms", "compile_ms", "python_roundtrip_ms"))
        speed_summary = _metric_brief(item.get("speedup_metrics"), ("native_steady_speedup", "native_vs_numpy_ref"))
        parts = [part for part in (time_summary, speed_summary) if part]
        if parts:
            lines.append(f"  - {name}: " + "; ".join(parts))
    return lines


def _metric_brief(metrics: object, order: tuple[str, ...]) -> str:
    if not isinstance(metrics, dict):
        return ""
    labels = {
        "native_run_ms": "native",
        "compile_ms": "compile",
        "python_roundtrip_ms": "py_roundtrip",
        "native_steady_speedup": "steady",
        "native_vs_numpy_ref": "vs_numpy",
    }
    parts: list[str] = []
    for key in order:
        payload = metrics.get(key)
        if not isinstance(payload, dict):
            continue
        delta_pct = _float_or_none(payload.get("delta_pct"))
        factor = _float_or_none(payload.get("improvement_factor"))
        if delta_pct is None or factor is None:
            continue
        direction = "better" if ((factor > 1.0) if key in {"native_steady_speedup", "native_vs_numpy_ref"} else (delta_pct < 0.0)) else "worse"
        parts.append(f"{labels.get(key, key)} {direction} ({delta_pct:+.1f}%, {factor:.2f}x)")
    return ", ".join(parts)


def _float_or_none(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


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
