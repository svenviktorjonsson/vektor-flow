from __future__ import annotations

from vektorflow.benchmarks import (
    format_benchmark_json,
    format_benchmark_list_json,
    get_benchmark,
    list_benchmarks,
    run_benchmark,
    select_benchmarks,
)


def test_benchmark_registry_contains_expected_cases() -> None:
    names = [case.name for case in list_benchmarks()]
    assert "scalar_control" in names
    assert "vectors_shapes" in names
    assert "records_dynamic" in names
    assert "custom_overloads" in names
    assert "scalar_hotloop" in names
    assert "vector_hotloop" in names


def test_select_benchmarks_filters_by_name() -> None:
    cases = select_benchmarks(["vector"])
    assert [case.name for case in cases] == ["vectors_shapes", "vector_hotloop"]


def test_run_native_supported_benchmark_interpreter_and_emit() -> None:
    res = run_benchmark(get_benchmark("vectors_shapes"))
    assert res.error is None
    assert res.parse_ms is not None
    assert res.lower_ms is not None
    assert res.interpret_ms is not None
    assert res.emit_cpp_ms is not None
    assert "[2, 4, 6, 8, 10]" in res.interpreter_stdout
    assert res.native_status in {"compiler-unavailable", "ok"}


def test_run_benchmark_collects_sample_medians() -> None:
    res = run_benchmark(get_benchmark("scalar_control"), samples=2)
    assert res.sample_count == 2
    assert len(res.parse_samples_ms) == 2
    assert len(res.interpret_samples_ms) == 2
    assert res.parse_ms is not None
    assert res.interpret_ms is not None


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
    assert '"python_roundtrip_ms"' in payload
    assert '"native_steady_speedup"' in payload
    assert '"sample_count"' in payload
    assert '"aggregation": "median"' in payload
    assert '"parse_samples_ms"' in payload


def test_benchmark_list_json_contains_case_metadata() -> None:
    payload = format_benchmark_list_json(list_benchmarks())
    assert '"name"' in payload
    assert '"native_supported"' in payload
    assert '"scalar_hotloop"' in payload
