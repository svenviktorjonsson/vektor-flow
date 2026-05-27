from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.cpp_backend import discover_cpp_compiler
from vektorflow.native_frontend import (
    alias_native_subset,
    execute_native_subset,
    native_frontend_execution,
    project_native_subset,
    realize_native_subset,
    run_native_subset,
    summarize_native_subset,
)
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
NATIVE_CORE = ROOT / "examples" / "native_core"
HELLO = ROOT / "examples" / "01_hello.vkf"
INLINE_FUNCTION_SOURCE = "scale(x, k) : x * k\n:: scale(2, 10)\n"
TYPED_INLINE_FUNCTION_SOURCE = "scale(x:num, k:num) -> num: x * k\n:: scale(2, 10)\n"
TWO_TYPED_INLINE_HELPERS_SOURCE = (
    "twice(x:num) -> num: x * 2\n"
    "inc(x:num) -> num: x + 1\n"
    ":: inc(twice(20))\n"
)
TYPED_INLINE_HELPER_BODY_CHAIN_SOURCE = (
    "twice(x:num) -> num: x * 2\n"
    "forty_two() -> num:\n"
    "  base: twice(20)\n"
    "  base + 2\n"
    ":: forty_two()\n"
)
TYPED_INLINE_TOP_LEVEL_BINDING_SOURCE = (
    "twice(x:num) -> num: x * 2\n"
    "forty_two() -> num: twice(20) + 2\n"
    "value: forty_two()\n"
    ":: value + 1\n"
)
TYPED_BLOCK_HELPER_SOURCE = "hyp2(x:num, y:num) -> num:\n  sx: x * x\n  sy: y * y\n  sx + sy\n:: hyp2(3, 4)\n"
TYPED_BLOCK_HELPER_ARITH_CALL_SOURCE = (
    "hyp2(x:num, y:num) -> num:\n"
    "  sx: x * x\n"
    "  sy: y * y\n"
    "  sx + sy\n"
    ":: hyp2(1 + 2, 2 * 2)\n"
)
ZERO_ARG_TYPED_BLOCK_HELPER_SOURCE = (
    "forty_two() -> num:\n"
    "  base: 6 * 7\n"
    "  base\n"
    ":: forty_two()\n"
)
TYPED_BLOCK_HELPER_EMIT_EXPR_SOURCE = (
    "hyp2(x:num, y:num) -> num:\n"
    "  sx: x * x\n"
    "  sy: y * y\n"
    "  sx + sy\n"
    ":: hyp2(3, 4) + 1\n"
)
FALLBACK_FUNCTION_SOURCE = ":: 5 ^ 2\n"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_file_fast_path_run(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    execution = native_frontend_execution(
        None,
        str(path),
        subset="native_core",
        filename_label=path.as_posix(),
    )

    assert execution.execution_backend == "native_parser"
    assert execution.parsed_module == parse_module(
        path.read_text(encoding="utf-8"),
        filename=path.as_posix(),
    )

    result = execution.run(tmp_path / "hello_native.exe")
    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_normal_vkf_file_fast_path_run(tmp_path: Path) -> None:
    execution = native_frontend_execution(
        None,
        str(HELLO),
        subset="native_core",
        filename_label=HELLO.as_posix(),
    )

    assert execution.execution_backend == "native_parser"
    assert execution.parsed_module == parse_module(
        HELLO.read_text(encoding="utf-8"),
        filename=HELLO.as_posix(),
    )

    result = execution.run(tmp_path / "hello.exe")
    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "hello, world"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_stdin_native_expression_build_and_run(tmp_path: Path) -> None:
    source = ":: 6 * 7\n"
    execution = native_frontend_execution(
        source,
        "stdin_snippet.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        source,
        "stdin_snippet.vkf",
        out_path=tmp_path / "stdin_snippet.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_inline_helper_family_build_and_run(tmp_path: Path) -> None:
    execution = native_frontend_execution(
        INLINE_FUNCTION_SOURCE,
        "inline_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        INLINE_FUNCTION_SOURCE,
        "inline_helper.vkf",
        out_path=tmp_path / "inline_helper.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "20"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_inline_helper_family_build_and_run(tmp_path: Path) -> None:
    execution = native_frontend_execution(
        TYPED_INLINE_FUNCTION_SOURCE,
        "typed_inline_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TYPED_INLINE_FUNCTION_SOURCE,
        "typed_inline_helper.vkf",
        out_path=tmp_path / "typed_inline_helper.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "20"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_inline_helper_chain_family_build_and_run(
    tmp_path: Path,
) -> None:
    execution = native_frontend_execution(
        TWO_TYPED_INLINE_HELPERS_SOURCE,
        "two_typed_inline_helpers.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TWO_TYPED_INLINE_HELPERS_SOURCE,
        "two_typed_inline_helpers.vkf",
        out_path=tmp_path / "two_typed_inline_helpers.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "41"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_inline_helper_body_chain_family_build_and_run(
    tmp_path: Path,
) -> None:
    execution = native_frontend_execution(
        TYPED_INLINE_HELPER_BODY_CHAIN_SOURCE,
        "typed_inline_helper_body_chain.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TYPED_INLINE_HELPER_BODY_CHAIN_SOURCE,
        "typed_inline_helper_body_chain.vkf",
        out_path=tmp_path / "typed_inline_helper_body_chain.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_inline_top_level_binding_family_build_and_run(
    tmp_path: Path,
) -> None:
    execution = native_frontend_execution(
        TYPED_INLINE_TOP_LEVEL_BINDING_SOURCE,
        "typed_inline_top_level_binding.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TYPED_INLINE_TOP_LEVEL_BINDING_SOURCE,
        "typed_inline_top_level_binding.vkf",
        out_path=tmp_path / "typed_inline_top_level_binding.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "43"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_block_helper_family_build_and_run(tmp_path: Path) -> None:
    execution = native_frontend_execution(
        TYPED_BLOCK_HELPER_SOURCE,
        "typed_block_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TYPED_BLOCK_HELPER_SOURCE,
        "typed_block_helper.vkf",
        out_path=tmp_path / "typed_block_helper.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "25"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_block_helper_arithmetic_call_family_build_and_run(
    tmp_path: Path,
) -> None:
    execution = native_frontend_execution(
        TYPED_BLOCK_HELPER_ARITH_CALL_SOURCE,
        "typed_block_helper_arith_call.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TYPED_BLOCK_HELPER_ARITH_CALL_SOURCE,
        "typed_block_helper_arith_call.vkf",
        out_path=tmp_path / "typed_block_helper_arith_call.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "25"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_zero_arg_typed_block_helper_family_build_and_run(
    tmp_path: Path,
) -> None:
    execution = native_frontend_execution(
        ZERO_ARG_TYPED_BLOCK_HELPER_SOURCE,
        "zero_arg_typed_block_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        ZERO_ARG_TYPED_BLOCK_HELPER_SOURCE,
        "zero_arg_typed_block_helper.vkf",
        out_path=tmp_path / "zero_arg_typed_block_helper.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_run_native_subset_typed_block_helper_emit_expression_family_build_and_run(
    tmp_path: Path,
) -> None:
    execution = native_frontend_execution(
        TYPED_BLOCK_HELPER_EMIT_EXPR_SOURCE,
        "typed_block_helper_emit_expr.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    assert execution.execution_backend == "native_parser"

    result = run_native_subset(
        TYPED_BLOCK_HELPER_EMIT_EXPR_SOURCE,
        "typed_block_helper_emit_expr.vkf",
        out_path=tmp_path / "typed_block_helper_emit_expr.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert result.execution_backend == "native_parser"
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "26"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_stdin_fast_path_matches_file_output(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"
    source = path.read_text(encoding="utf-8")

    file_result = run_native_subset(
        None,
        str(path),
        out_path=tmp_path / "file.exe",
        subset="native_core",
        filename_label=path.as_posix(),
    )
    stdin_result = run_native_subset(
        source,
        "hello_native_stdin.vkf",
        out_path=tmp_path / "stdin.exe",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert file_result.execution_backend == "native_parser"
    assert stdin_result.execution_backend == "native_parser"
    assert file_result.process.returncode == 0
    assert stdin_result.process.returncode == 0
    assert stdin_result.process.stdout == file_result.process.stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_execute_native_subset_uses_default_run_location(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    result = execute_native_subset(
        None,
        str(path),
        out_dir=tmp_path,
        subset="native_core",
        filename_label=path.as_posix(),
    )

    assert result.execution_backend == "native_parser"
    assert result.executable_path.parent == tmp_path
    assert result.executable_path.is_file()
    assert result.process.returncode == 0
    assert result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_summary_exposes_one_backend_neutral_plan_view(
    tmp_path: Path,
) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    execution = native_frontend_execution(
        None,
        str(path),
        subset="native_core",
        filename_label=path.as_posix(),
    )

    summary = execution.summary

    assert summary.execution_backend == "native_parser"
    assert summary.mode == "native_parser_fast_path"
    assert summary.available_stages == ("lex", "parse", "emit", "build", "run")
    assert summary.supports("run") is True
    assert summary.default_executable_path.parent.name == "vektorflow-native-runs"
    assert summary.default_executable_path.suffix == ".exe"

    public_summary = summarize_native_subset(
        None,
        str(path),
        subset="native_core",
        filename_label=path.as_posix(),
    )
    assert public_summary == summary


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_realize_native_subset_run_outcome_hides_backend_specific_steps(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    outcome = realize_native_subset(
        None,
        str(path),
        stage="run",
        out_dir=tmp_path,
        subset="native_core",
        filename_label=path.as_posix(),
    )

    assert outcome.execution_backend == "native_parser"
    assert outcome.stage == "run"
    assert outcome.summary.execution_backend == "native_parser"
    assert outcome.summary.mode == "native_parser_fast_path"
    assert outcome.token_payload is None
    assert outcome.parsed_module is None
    assert outcome.cpp_emit_result is None
    assert outcome.executable_path is not None
    assert outcome.process is not None
    assert outcome.returncode == 0
    assert outcome.stdout is not None
    assert outcome.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_realize_native_subset_emit_outcome_for_token_stream_subset() -> None:
    source = FALLBACK_FUNCTION_SOURCE

    outcome = realize_native_subset(
        source,
        "fallback_fn.vkf",
        stage="emit",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert outcome.execution_backend == "token_stream"
    assert outcome.stage == "emit"
    assert outcome.summary.execution_backend == "token_stream"
    assert outcome.summary.mode == "token_stream_seam"
    assert outcome.token_payload is None
    assert outcome.parsed_module is None
    assert outcome.cpp_emit_result is not None
    assert outcome.cpp_source is not None
    assert "int main()" in outcome.cpp_source
    assert outcome.executable_path is None
    assert outcome.process is None


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_realize_native_subset_parse_outcome_stays_stage_sized() -> None:
    source = FALLBACK_FUNCTION_SOURCE

    outcome = realize_native_subset(
        source,
        "fallback_fn.vkf",
        stage="parse",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert outcome.summary.execution_backend == "token_stream"
    assert outcome.stage == "parse"
    assert outcome.token_payload is None
    assert outcome.parsed_module == parse_module(source, filename="fallback_fn.vkf")
    assert outcome.cpp_emit_result is None
    assert outcome.executable_path is None
    assert outcome.process is None


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_realize_native_subset_run_outcome_projects_to_run_result(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    outcome = realize_native_subset(
        None,
        str(path),
        stage="run",
        out_dir=tmp_path,
        subset="native_core",
        filename_label=path.as_posix(),
    )
    run_result = outcome.to_run_result()

    assert run_result.execution_backend == "native_parser"
    assert run_result.executable_path == outcome.require_executable_path()
    assert run_result.process == outcome.require_process()
    assert run_result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_methods_project_from_realize(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    execution = native_frontend_execution(
        None,
        str(path),
        subset="native_core",
        filename_label=path.as_posix(),
    )
    run_outcome = execution.realize("run", out_dir=tmp_path)
    run_result = execution.execute(tmp_path)

    assert execution.token_payload == execution.realize("lex").require_token_payload()
    assert execution.parsed_module == execution.realize("parse").require_parsed_module()
    assert execution.cpp_emit_result == execution.realize("emit").to_cpp_emit_result()
    assert run_result.execution_backend == run_outcome.execution_backend
    assert run_result.executable_path == run_outcome.require_executable_path()
    assert run_result.process.returncode == run_outcome.require_process().returncode
    assert run_result.process.stdout == run_outcome.require_process().stdout


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_project_routes_through_outcome_core(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"
    execution = native_frontend_execution(
        None,
        str(path),
        subset="native_core",
        filename_label=path.as_posix(),
    )

    run_result = execution.project("run", "run_result", out_dir=tmp_path)
    cpp_source = execution.project("emit", "cpp_source")

    assert run_result.process.stdout.strip() == "42"
    assert "int main()" in cpp_source


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_project_native_subset_exposes_route_neutral_projection_surface(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    executable_path = project_native_subset(
        None,
        str(path),
        stage="build",
        projection="executable_path",
        out_path=tmp_path / "hello_native.exe",
        subset="native_core",
        filename_label=path.as_posix(),
    )
    run_result = project_native_subset(
        None,
        str(path),
        stage="run",
        projection="run_result",
        out_dir=tmp_path,
        subset="native_core",
        filename_label=path.as_posix(),
    )

    assert executable_path.is_file()
    assert run_result.execution_backend == "native_parser"
    assert run_result.process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_frontend_execution_alias_routes_through_projection_core(tmp_path: Path) -> None:
    path = NATIVE_CORE / "hello_native.vkf"
    execution = native_frontend_execution(
        None,
        str(path),
        subset="native_core",
        filename_label=path.as_posix(),
    )

    assert execution.summary.supports_alias("cpp_source") is True
    assert execution.summary.supports_projection("cpp_source") is True
    assert execution.summary.supports_alias("fast_path_cpp_source") is True
    assert execution.alias("execution_backend") == "native_parser"
    assert execution.alias("execution_mode") == "native_parser_fast_path"
    assert execution.alias("fast_path_available") is True
    assert execution.alias("fast_path_cpp_source").startswith("#include")
    assert execution.alias("cpp_source").startswith("#include")
    assert execution.alias("execute_result", out_dir=tmp_path).process.stdout.strip() == "42"


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_execution_summary_support_matrix_covers_fast_path_and_fallback() -> None:
    file_execution = native_frontend_execution(
        None,
        str(HELLO),
        subset="native_core",
        filename_label=HELLO.as_posix(),
    )
    helper_execution = native_frontend_execution(
        INLINE_FUNCTION_SOURCE,
        "inline_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    typed_block_execution = native_frontend_execution(
        TYPED_BLOCK_HELPER_SOURCE,
        "typed_block_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    stdin_execution = native_frontend_execution(
        FALLBACK_FUNCTION_SOURCE,
        "fallback_fn.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert file_execution.summary.supports_projection("cpp_emit_result") is True
    assert file_execution.summary.supports_alias("fast_path_cpp_source") is True
    assert helper_execution.summary.execution_backend == "native_parser"
    assert helper_execution.summary.supports_alias("fast_path_cpp_source") is True
    assert typed_block_execution.summary.execution_backend == "native_parser"
    assert typed_block_execution.summary.supports_alias("fast_path_cpp_source") is True
    assert stdin_execution.summary.supports_projection("run_result") is True
    assert stdin_execution.summary.supports_alias("fast_path_cpp_source") is False
    assert stdin_execution.alias("fast_path_cpp_source") is None


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_native_execution_summary_enumerates_supported_surface_for_fast_path_and_fallback() -> None:
    file_execution = native_frontend_execution(
        None,
        str(HELLO),
        subset="native_core",
        filename_label=HELLO.as_posix(),
    )
    helper_execution = native_frontend_execution(
        INLINE_FUNCTION_SOURCE,
        "inline_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    typed_block_execution = native_frontend_execution(
        TYPED_BLOCK_HELPER_SOURCE,
        "typed_block_helper.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )
    stdin_execution = native_frontend_execution(
        FALLBACK_FUNCTION_SOURCE,
        "fallback_fn.vkf",
        subset="native_core",
        filename_label="<stdin>",
    )

    assert file_execution.summary.supported_stages() == ("lex", "parse", "emit", "build", "run")
    assert file_execution.summary.supported_projections() == (
        "token_payload",
        "parsed_module",
        "cpp_emit_result",
        "cpp_source",
        "executable_path",
        "run_result",
    )
    assert "fast_path_cpp_source" in file_execution.summary.supported_aliases()
    assert helper_execution.summary.execution_backend == "native_parser"
    assert "fast_path_cpp_source" in helper_execution.summary.supported_aliases()
    assert typed_block_execution.summary.execution_backend == "native_parser"
    assert "fast_path_cpp_source" in typed_block_execution.summary.supported_aliases()

    assert stdin_execution.summary.supported_stages() == ("lex", "parse", "emit", "build", "run")
    assert stdin_execution.summary.supported_projections() == (
        "token_payload",
        "parsed_module",
        "cpp_emit_result",
        "cpp_source",
        "executable_path",
        "run_result",
    )
    assert "fast_path_cpp_source" not in stdin_execution.summary.supported_aliases()


@pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
def test_alias_native_subset_exposes_legacy_helper_family_through_one_surface(
    tmp_path: Path,
) -> None:
    path = NATIVE_CORE / "hello_native.vkf"

    summary = alias_native_subset(
        None,
        str(path),
        alias="summary",
        subset="native_core",
        filename_label=path.as_posix(),
    )
    run_result = alias_native_subset(
        None,
        str(path),
        alias="run_result",
        out_path=tmp_path / "hello_native.exe",
        subset="native_core",
        filename_label=path.as_posix(),
    )

    assert summary.execution_backend == "native_parser"
    assert run_result.process.stdout.strip() == "42"
