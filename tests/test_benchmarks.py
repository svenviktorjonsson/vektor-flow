from __future__ import annotations

from vektorflow.benchmarks import get_benchmark, list_benchmarks, run_benchmark, select_benchmarks


def test_benchmark_registry_contains_expected_cases() -> None:
    names = [case.name for case in list_benchmarks()]
    assert "scalar_control" in names
    assert "vectors_shapes" in names
    assert "records_dynamic" in names
    assert "custom_overloads" in names


def test_select_benchmarks_filters_by_name() -> None:
    cases = select_benchmarks(["vector"])
    assert [case.name for case in cases] == ["vectors_shapes"]


def test_run_native_supported_benchmark_interpreter_and_emit() -> None:
    res = run_benchmark(get_benchmark("vectors_shapes"))
    assert res.error is None
    assert res.parse_ms is not None
    assert res.lower_ms is not None
    assert res.interpret_ms is not None
    assert res.emit_cpp_ms is not None
    assert "[2, 4, 6, 8, 10]" in res.interpreter_stdout
    assert res.native_status in {"compiler-unavailable", "ok"}


def test_run_interpreter_only_benchmark_marks_native_unsupported() -> None:
    res = run_benchmark(get_benchmark("custom_overloads"))
    assert res.error is None
    assert "point[2|5]" in res.interpreter_stdout
    assert res.native_status == "unsupported"
