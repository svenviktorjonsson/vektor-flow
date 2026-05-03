from __future__ import annotations

import math

from vektorflow.benchmarks import (
    build_benchmark_payload,
    benchmark_cache_root,
    compare_benchmark_payload,
    format_benchmark_json,
    format_benchmark_list_json,
    get_benchmark,
    list_benchmarks,
    load_benchmark_baseline,
    run_benchmark,
    save_benchmark_baseline,
    select_benchmarks,
)


def test_benchmark_registry_contains_expected_cases() -> None:
    names = [case.name for case in list_benchmarks()]
    assert "scalar_control" in names
    assert "vectors_shapes" in names
    assert "records_dynamic" in names
    assert "stdlib_numeric" in names
    assert "custom_overloads" in names
    assert "scalar_hotloop" in names
    assert "vector_hotloop" in names
    assert "vector_large_elementwise" in names
    assert "vector_large_reduce" in names


def test_select_benchmarks_filters_by_name() -> None:
    cases = select_benchmarks(["vector"])
    assert [case.name for case in cases] == [
        "vectors_shapes",
        "vector_hotloop",
        "vector_large_elementwise",
        "vector_large_reduce",
    ]


def test_run_native_supported_benchmark_interpreter_and_emit() -> None:
    res = run_benchmark(get_benchmark("vectors_shapes"))
    assert res.error is None
    assert res.parse_py_ms is not None
    assert res.lower_py_ms is not None
    assert res.interpret_py_ms is not None
    assert res.emit_cpp_py_ms is not None
    assert res.cpp_compile_ms is not None
    assert "[2, 4, 6, 8, 10]" in res.interpreter_stdout
    assert res.native_status in {"compiler-unavailable", "ok"}


def test_run_stdlib_numeric_benchmark_interpreter_and_emit() -> None:
    res = run_benchmark(get_benchmark("stdlib_numeric"))
    assert res.error is None
    lines = res.interpreter_stdout.strip().splitlines()
    assert lines[0].startswith("3.14159265358979")
    exact_lines = {
        1: "0",
        2: "9",
        3: "5",
        4: "2",
        5: "4.5",
        6: "1.5",
        9: "0",
        10: "1",
        12: "1",
        13: "7",
        14: "8",
    }
    for idx, value in exact_lines.items():
        assert lines[idx] == value
    assert math.isclose(float(lines[7]), -1.22474487139159, rel_tol=1e-12, abs_tol=1e-12)
    assert math.isclose(float(lines[8]), 1.22474487139159, rel_tol=1e-12, abs_tol=1e-12)
    assert math.isclose(float(lines[11]), 1.33333333333333, rel_tol=1e-12, abs_tol=1e-12)
    assert res.native_status in {"compiler-unavailable", "ok"}


def test_run_benchmark_collects_sample_medians() -> None:
    res = run_benchmark(get_benchmark("scalar_control"), samples=2)
    assert res.sample_count == 2
    assert len(res.parse_samples_ms) == 2
    assert len(res.interpret_samples_ms) == 2
    assert res.parse_py_ms is not None
    assert res.interpret_py_ms is not None


def test_run_benchmark_collects_multiple_native_runs() -> None:
    res = run_benchmark(get_benchmark("scalar_control"), samples=1, native_runs=2)
    assert res.native_run_count == 2
    assert res.native_warmup_count == 1
    if res.native_status == "ok":
        assert len(res.native_run_samples_ms) == 1
        assert len(res.native_kernel_samples_ms) == 1
        assert res.native_kernel_ms is not None


def test_run_benchmark_reuses_cached_native_compile() -> None:
    cache_root = benchmark_cache_root()
    if cache_root.exists():
        import shutil

        shutil.rmtree(cache_root)
    first = run_benchmark(get_benchmark("scalar_control"))
    second = run_benchmark(get_benchmark("scalar_control"))
    if first.native_status == "ok" and second.native_status == "ok":
        assert first.compile_ms is not None
        assert second.compile_ms is not None
        assert second.compile_ms < 500.0


def test_run_interpreter_only_benchmark_marks_native_unsupported() -> None:
    res = run_benchmark(get_benchmark("custom_overloads"))
    assert res.error is None
    assert "point[2|5]" in res.interpreter_stdout
    assert res.native_status == "unsupported"


def test_benchmark_json_report_contains_summary_and_results() -> None:
    results = [run_benchmark(get_benchmark("scalar_control"))]
    payload = format_benchmark_json(results)
    assert '"summary"' in payload
    assert '"results"' in payload
    assert '"scalar_control"' in payload
    assert '"units": "ms"' in payload
    assert '"parse_py_ms"' in payload
    assert '"parse_ms"' in payload
    assert '"python_roundtrip_ms"' in payload
    assert '"python_reference_ms"' in payload
    assert '"python_ref_ms"' in payload
    assert '"native_steady_speedup"' in payload
    assert '"sample_count"' in payload
    assert '"native_run_count"' in payload
    assert '"native_warmup_count"' in payload
    assert '"aggregation": "median"' in payload
    assert '"parse_samples_ms"' in payload
    assert '"python_ref_ms"' in payload
    assert '"numpy_ref_ms"' in payload
    assert '"native_kernel_ms"' in payload
    assert '"native_kernel_vs_numpy_ref"' in payload


def test_vector_hotloop_collects_reference_timings() -> None:
    res = run_benchmark(get_benchmark("vector_hotloop"))
    assert res.error is None
    assert res.python_ref_ms is not None
    assert res.case.reference_impl == "vector_hotloop"


def test_benchmark_baseline_roundtrip_and_compare(tmp_path) -> None:
    results = [run_benchmark(get_benchmark("scalar_control"))]
    baseline_path = tmp_path / "baseline.json"
    save_benchmark_baseline(results, baseline_path)
    payload = load_benchmark_baseline(baseline_path)
    assert payload["summary"]["count"] == 1
    assert payload["results"][0]["name"] == "scalar_control"
    comparison = compare_benchmark_payload(build_benchmark_payload(results), payload)
    benchmark = comparison["benchmarks"][0]
    assert benchmark["name"] == "scalar_control"
    assert benchmark["time_metrics"]["parse_ms"]["delta"] == 0.0


def test_benchmark_json_can_embed_baseline_comparison(tmp_path) -> None:
    results = [run_benchmark(get_benchmark("scalar_control"))]
    baseline_path = tmp_path / "baseline.json"
    save_benchmark_baseline(results, baseline_path)
    payload = format_benchmark_json(results, baseline=load_benchmark_baseline(baseline_path))
    assert '"baseline_comparison"' in payload


def test_benchmark_list_json_contains_case_metadata() -> None:
    payload = format_benchmark_list_json(list_benchmarks())
    assert '"name"' in payload
    assert '"native_supported"' in payload
    assert '"scalar_hotloop"' in payload
    assert '"reference_impl"' in payload
