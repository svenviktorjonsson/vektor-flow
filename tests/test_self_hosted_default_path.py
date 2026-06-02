from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
TOP_LEVEL_EXAMPLE_VKF_FILES = sorted((ROOT / "examples").glob("*.vkf"))
RECURSIVE_EXAMPLE_HELPER_OR_UNSUPPORTED_FILES = {
    (ROOT / "examples" / "modules" / "83_file_module_helpers.vkf").resolve(),
    (ROOT / "examples" / "nested" / "lib" / "helpers.vkf").resolve(),
    (ROOT / "examples" / "folder_repo" / "pkg" / "mod.vkf").resolve(),
    (ROOT / "examples" / "folder_repo" / "native_backend_unsupported.vkf").resolve(),
    (ROOT / "examples" / "folder_repo" / "native_preference_unsupported.vkf").resolve(),
}
RECURSIVE_RUNNABLE_EXAMPLE_VKF_FILES = sorted(
    source_path.resolve()
    for source_path in (ROOT / "examples").rglob("*.vkf")
    if source_path.resolve() not in RECURSIVE_EXAMPLE_HELPER_OR_UNSUPPORTED_FILES
)
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_compiler_artifact_smoke.cpp"
DRIVER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_driver_artifact_smoke.cpp"
WASM_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_wasm_artifact_smoke.cpp"
WEBGPU_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_webgpu_artifact_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"
COMPILER_SOURCE = ROOT / "compiler" / "self_hosted" / "compiler.vkf"
STDLIB_SOURCE = ROOT / "compiler" / "self_hosted" / "stdlib.vkf"


def _compiler_command(sources: list[Path], output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-I",
                str(ROOT),
                "-I",
                str(ROOT / "native" / "VfOverlay"),
                *[str(source) for source in sources],
                "-o",
                str(output),
            ]

    cl = shutil.which("cl")
    if cl is not None:
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{ROOT}",
            f"/I{ROOT / 'native' / 'VfOverlay'}",
            *[str(source) for source in sources],
            f"/Fe:{output}",
        ]

    return None


def _compile_or_skip(sources: list[Path], output: Path) -> Path:
    command = _compiler_command(sources, output)
    if command is None:
        pytest.skip("no C++ compiler found")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


@pytest.fixture()
def sibling_smokes(tmp_path: Path) -> dict[str, Path]:
    return {
        "lexer": _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe"),
        "parser": _compile_or_skip([PARSER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_parser_token_stream_smoke.exe"),
        "ir": _compile_or_skip([AST_TO_IR_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_ast_to_ir_smoke.exe"),
        "artifact": _compile_or_skip([ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_compiler_artifact_smoke.exe"),
        "wasm_artifact": _compile_or_skip([WASM_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_wasm_artifact_smoke.exe"),
        "webgpu_artifact": _compile_or_skip([WEBGPU_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_webgpu_artifact_smoke.exe"),
        "driver": _compile_or_skip([DRIVER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_driver_artifact_smoke.exe"),
    }


def _run_default_driver(source_path: Path, sibling_smokes: dict[str, Path]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def test_source_contracts_name_native_default_path_discovery() -> None:
    compiler_rendered = repr(parse_module(COMPILER_SOURCE.read_text(encoding="utf-8"), filename=COMPILER_SOURCE.as_posix()))
    stdlib_rendered = repr(parse_module(STDLIB_SOURCE.read_text(encoding="utf-8"), filename=STDLIB_SOURCE.as_posix()))

    assert "native default-path sibling discovery" in compiler_rendered
    assert "driver invoked as vkf_driver_artifact_smoke --source file.vkf --run" in compiler_rendered
    assert "discovers sibling vkf_lexer_cursor_smoke" in compiler_rendered
    assert "native default-path sibling discovery keeps stdlib pipeline independent" in stdlib_rendered


def test_driver_source_has_no_host_fallback_hooks() -> None:
    source = DRIVER_SMOKE_SOURCE.read_text(encoding="utf-8")
    forbidden_markers = ["Python.h", "Py_Initialize", "python.exe", "system(", "popen("]

    for marker in forbidden_markers:
        assert marker not in source


def test_default_path_native_tool_sources_have_no_python_process_hooks() -> None:
    default_path_sources = [
        LEXER_SMOKE_SOURCE,
        PARSER_SMOKE_SOURCE,
        AST_TO_IR_SMOKE_SOURCE,
        ARTIFACT_SMOKE_SOURCE,
        WASM_ARTIFACT_SMOKE_SOURCE,
        WEBGPU_ARTIFACT_SMOKE_SOURCE,
    ]
    forbidden_markers = [
        "Python.h",
        "Py_Initialize",
        "python.exe",
        "python3",
        "CreateProcess",
        "system(",
        "popen(",
    ]

    failures: list[str] = []
    for source_path in default_path_sources:
        source = source_path.read_text(encoding="utf-8")
        for marker in forbidden_markers:
            if marker in source:
                failures.append(f"{source_path.name}: {marker}")

    assert failures == []


def test_default_path_driver_runs_io_math_without_tool_args(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "default_io_math.vkf"
    source_path.write_text("io.print(math.pi)", encoding="utf-8")

    first = json.loads(_run_default_driver(source_path, sibling_smokes).stdout)
    assert first["status"] == "compiled"
    assert first["ran"] is True
    assert first["stdout"].strip().startswith("3.14159")

    second = json.loads(_run_default_driver(source_path, sibling_smokes).stdout)
    assert second["status"] == "current"
    assert second["stdout"].strip().startswith("3.14159")


def test_default_path_driver_runs_positional_file_like_vkf(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "hello_positional.vkf"
    source_path.write_text('io.print("hello")', encoding="utf-8")

    result = subprocess.run(
        [str(sibling_smokes["driver"]), str(source_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"].strip() == "hello"


def test_default_path_driver_runs_eval_snippet_like_vkf(
    sibling_smokes: dict[str, Path],
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "-e", ':: "hello, world"'],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"].strip() == "hello, world"


def test_default_path_driver_runs_abs_norm_emit_subset(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "abs_norm_emit.vkf"
    source_path.write_text(":: |-3|\n:: |[3, 4]|\n", encoding="utf-8")

    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == "3\r\n5\r\n"


def test_default_path_driver_runs_typeof_emit_subset(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "typeof_emit.vkf"
    source_path.write_text('point: (x: 3, y: 4)\nvalues: [1, 2, 3]\n:: point.\n:: values.\n', encoding="utf-8")

    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == "(x:num, y:num)\r\n[num]\r\n"


def test_default_path_driver_runs_imported_module_function_call_target(
    sibling_smokes: dict[str, Path],
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(ROOT / "examples" / "83_file_module.vkf"), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    assert summary["ran"] is True
    assert summary["stdout"] == "20\r\n"
    helper_dep = next(dep for dep in manifest["dependencies"] if dep["name"] == "import:helpers")
    assert helper_dep["path"] == str((ROOT / "examples" / "modules" / "83_file_module_helpers.vkf").resolve())
    assert isinstance(helper_dep["sha256"], str) and helper_dep["sha256"]


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "62_pipes.vkf", "[1, 4, 9, 16, 25]\r\n"),
        (ROOT / "examples" / "63_pipe_with_functions.vkf", "[1, 4, 9, 16, 25]\r\n"),
    ],
)
def test_default_path_driver_runs_pipe_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "15_ranges.vkf", "[1, 2, 3, 4, 5]\r\n[0, 1, 2, 3]\r\n"),
        (ROOT / "examples" / "52_compile_time_shape_params.vkf", "[1, 2, 3, 4, 5]\r\n"),
        (ROOT / "examples" / "61_switch.vkf", "green\r\n"),
    ],
)
def test_default_path_driver_runs_parser_shape_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


def test_default_path_driver_runs_semicolon_statement_chain_example(
    sibling_smokes: dict[str, Path],
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(ROOT / "examples" / "05_comments_and_semicolons.vkf"), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == "Viktor Jonsson\r\n"


def test_default_path_driver_runs_tuple_and_numeric_dotted_index_example(
    sibling_smokes: dict[str, Path],
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(ROOT / "examples" / "12_tuples.vkf"), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == "(3, 4)\r\n3\r\n4\r\n"


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "20_struct_field_rebind.vkf", "{x: 3, y: 4, z: 5}\r\n"),
        (ROOT / "examples" / "21_vector_index_rebind.vkf", "[4, 2, 3]\r\n"),
    ],
)
def test_default_path_driver_runs_rebind_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "30_functions_basic.vkf", "49\r\n"),
        (ROOT / "examples" / "31_single_line_functions.vkf", "49\r\n"),
        (ROOT / "examples" / "33_docstrings.vkf", "12\r\n"),
        (ROOT / "examples" / "34_typed_parameters.vkf", "7\r\n"),
    ],
)
def test_default_path_driver_runs_local_function_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "04_early_return.vkf", "negative\r\nzero\r\npositive\r\n"),
        (ROOT / "examples" / "60_if.vkf", "negative\r\nzero\r\npositive\r\n"),
    ],
)
def test_default_path_driver_runs_conditional_return_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


def test_default_path_driver_runs_constructor_spill_subset_example(
    sibling_smokes: dict[str, Path],
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(ROOT / "examples" / "23_spill_and_override.vkf"), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == "ColoredPoint(x:3, y:4, color:red)\r\n"


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "40_default_args.vkf", "24\r\n29\r\n"),
        (ROOT / "examples" / "41_named_args.vkf", "345\r\n"),
        (ROOT / "examples" / "42_call_spread_vector.vkf", "24\r\n"),
        (ROOT / "examples" / "43_call_spread_struct.vkf", "7\r\n"),
    ],
)
def test_default_path_driver_runs_advanced_call_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "24_immutable_values_mutable_resources.vkf", "{x: 9, y: 2}\r\n{name: bob, ok: true}\r\n"),
        (ROOT / "examples" / "80_module_import.vkf", "3\r\n"),
        (ROOT / "examples" / "81_scope_spill.vkf", "3\r\n"),
        (ROOT / "examples" / "82_qualified_call_avoids_recursion.vkf", "1\r\n"),
    ],
)
def test_default_path_driver_runs_stdlib_import_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "44_variadic_positional.vkf", "x: 1\r\nrest.length(): 3\r\nrest.(0): 2\r\n"),
        (ROOT / "examples" / "45_variadic_named.vkf", "named.flag: true\r\nnamed.mode: fast\r\n"),
    ],
)
def test_default_path_driver_runs_variadic_label_print_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


def test_default_path_driver_runs_runtime_resources_subset_example(
    sibling_smokes: dict[str, Path],
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(ROOT / "examples" / "90_runtime_resources.vkf"), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == "buffer.get(): 1\r\nbuffer.get(): 2\r\n{name: bob, ok: true}\r\n"


@pytest.mark.parametrize(
    "source_path",
    [
        ROOT / "examples" / "100_axis_4_panel.vkf",
        ROOT / "examples" / "110_mirror_showcase.vkf",
        ROOT / "examples" / "111_mirror_smoke.vkf",
        ROOT / "examples" / "112_scene3d_smoke.vkf",
    ],
)
def test_default_path_driver_runs_ui_scene_stub_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == ""


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "50_struct_types.vkf", "25\r\n"),
        (ROOT / "examples" / "51_vector_shape_types.vkf", "6\r\n"),
        (ROOT / "examples" / "64_axis_tags_and_broadcast.vkf", "((10, 20), (20, 40))\r\n"),
    ],
)
def test_default_path_driver_runs_numeric_shape_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


@pytest.mark.parametrize(
    ("source_path", "expected_stdout"),
    [
        (ROOT / "examples" / "16_multisets.vkf", "{1: 6, 2: 3}\r\n{1: 2, 2: 1}\r\n{1: 2, 2: 2}\r\n"),
        (ROOT / "examples" / "70_arithmetic.vkf", "3\r\n2\r\n28\r\n4\r\n256\r\n"),
        (ROOT / "examples" / "71_logic.vkf", "false\r\ntrue\r\ntrue\r\nfalse\r\n"),
        (ROOT / "examples" / "74_operator_overload.vkf", "{x: 4, y: 6}\r\n"),
    ],
)
def test_default_path_driver_runs_operator_logic_subset_examples(
    sibling_smokes: dict[str, Path],
    source_path: Path,
    expected_stdout: str,
) -> None:
    result = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    assert summary["ran"] is True
    assert summary["stdout"] == expected_stdout


def test_default_path_driver_can_emit_wasm_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "hello_wasm.vkf"
    source_path.write_text("answer: 42", encoding="utf-8")

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--wasm-artifact",
            str(sibling_smokes["wasm_artifact"]),
            "--emit-wasm",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    wasm_artifact_path = Path(summary["wasm_artifact_path"])
    wasm_manifest = json.loads(Path(summary["wasm_manifest_path"]).read_text(encoding="utf-8"))
    assert summary["wasm_status"] == "compiled"
    assert wasm_artifact_path.is_file()
    assert wasm_artifact_path.read_bytes()[:4] == b"\x00asm"
    assert wasm_manifest["runtime_surface"]["update_export"] == "vkf_update"
    assert wasm_manifest["runtime_surface"]["bindings"] == [
        {"name": "answer", "kind": "i32", "value_export": "vkf_get_answer"}
    ]


def test_default_path_driver_can_emit_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "hello_webgpu.vkf"
    source_path.write_text(
        """gain: 42
vkf_update(state:num, input:num) -> num:
    @: state + gain + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--webgpu-artifact",
            str(sibling_smokes["webgpu_artifact"]),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_artifact_path.is_file()
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "scalar"
    assert webgpu_manifest["runtime_surface"]["bindings"] == [
        {"name": "gain", "kind": "i32_const", "value": 42}
    ]
    assert "@group(0) @binding(0) var<storage, read_write> state: State;" in shader


def test_default_path_driver_can_emit_source_driven_float_axis_wasm_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_axis_update.vkf"
    source_path.write_text(
        """gain: [1.5, 2.5, 3.5] -> u
vkf_update(state:axis<u>:list<num>, input:num) -> axis<u>:list<num>:
    @: state + gain + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-wasm",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    wasm_artifact_path = Path(summary["wasm_artifact_path"])
    wasm_manifest = json.loads(Path(summary["wasm_manifest_path"]).read_text(encoding="utf-8"))
    assert summary["wasm_status"] == "compiled"
    assert wasm_manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert wasm_manifest["runtime_surface"]["state_fields"] == [
        {
            "name": "values",
            "offset": 0.0,
            "type": "axis<u>:list<f64>",
            "axis_key": "u",
            "axis_length": 3.0,
            "storage": "f64",
        }
    ]
    assert wasm_manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f64", "storage": "f64"}
    ]

    node = shutil.which("node")
    if node is None:
        pytest.skip("node not found")
    proc = subprocess.run(
        [
            node,
            "-e",
            r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
inst.exports.vkf_init();
const mem = new DataView(inst.exports.memory.buffer);
const statePtr = inst.exports.vkf_state_ptr();
const inputPtr = inst.exports.vkf_input_ptr();
[10.0, 20.0, 30.0].forEach((value, index) => mem.setFloat64(statePtr + index * 8, value, true));
mem.setFloat64(inputPtr, 0.25, true);
inst.exports.vkf_update();
const state = [];
for (let i = 0; i < 3; i += 1) state.push(mem.getFloat64(statePtr + i * 8, true));
process.stdout.write(JSON.stringify({ state }));
""",
            str(wasm_artifact_path),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(proc.stdout)
    assert payload["state"] == pytest.approx([11.75, 22.75, 33.75], abs=1e-12)


def test_default_path_driver_can_emit_source_driven_float_axis_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_axis_update_webgpu.vkf"
    source_path.write_text(
        """gain: [1.5, 2.5, 3.5] -> u
vkf_update(state:axis<u>:list<num>, input:num) -> axis<u>:list<num>:
    @: state + gain + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {
            "name": "values",
            "offset": 0.0,
            "type": "axis<u>:list<f32>",
            "axis_key": "u",
            "axis_length": 3.0,
            "storage": "f32",
        }
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "struct State {\n  values: array<f32, 3>," in shader
    assert "struct Input {\n  value: f32," in shader
    assert "const gain: array<f32, 3> = array<f32, 3>(1.5" in shader
    assert "let next_value_2: f32 = ((state.values[2] + gain[2]) + input.value);" in shader


def test_default_path_driver_can_emit_source_driven_float_scalar_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_update_webgpu.vkf"
    source_path.write_text(
        """bias: 0.5
vkf_update(state:f32, input:f32) -> f32:
    @: state + bias + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "scalar"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "struct State {\n  value: f32," in shader
    assert "struct Input {\n  value: f32," in shader
    assert "const bias: f32 = 0.5;" in shader
    assert "let next_value: f32 = ((state.value + bias) + input.value);" in shader or "let next_value: f32 = ((state.value + input.value) + bias);" in shader


def test_default_path_driver_can_emit_source_driven_float_scalar_local_binding_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_local_binding_update_webgpu.vkf"
    source_path.write_text(
        """bias: 0.5
vkf_update(state:f32, input:f32) -> f32:
    total: state + input
    @: total + bias
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "scalar"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "const bias: f32 = 0.5;" in shader
    assert "let next_value: f32 = ((state.value + input.value) + bias);" in shader


def test_default_path_driver_can_emit_source_driven_float_record_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_record_update_webgpu.vkf"
    source_path.write_text(
        """bias: 0.25
vkf_update(state:record{count:f32}, input:record{delta:f32}) -> record{count:f32}:
    @: (count: state.count + input.delta + bias)
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "record"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "struct State {\n  count: f32," in shader
    assert "struct Input {\n  delta: f32," in shader
    assert "const bias: f32 = 0.25;" in shader
    assert "let next_count: f32 = ((state.count + input.delta) + bias);" in shader


def test_default_path_driver_can_emit_source_driven_mixed_float_record_axis_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_record_axis_update_webgpu.vkf"
    source_path.write_text(
        """gain: [1.5, 2.5, 3.5] -> u
vkf_update(state:record{count:f32,values:axis<u>:list<f32>}, input:record{delta:f32,offsets:axis<u>:list<f32>}) -> record{count:f32,values:axis<u>:list<f32>}:
    @: (count: state.count + input.delta, values: state.values + gain + input.offsets)
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "record"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0.0, "type": "f32", "storage": "f32"},
        {"name": "values", "offset": 4.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0},
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0.0, "type": "f32", "storage": "f32"},
        {"name": "offsets", "offset": 4.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0},
    ]
    assert "struct State {\n  count: f32,\n  values: array<f32, 3>," in shader
    assert "struct Input {\n  delta: f32,\n  offsets: array<f32, 3>," in shader
    assert "const gain: array<f32, 3> = array<f32, 3>(1.5" in shader
    assert "let next_count: f32 = (state.count + input.delta);" in shader
    assert "let next_values_2: f32 = ((state.values[2] + gain[2]) + input.offsets[2]);" in shader


def test_default_path_driver_can_emit_source_driven_float_axis_vector_vector_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_axis_vector_vector_webgpu.vkf"
    source_path.write_text(
        """gain: [1.5, 2.5, 3.5] -> u
vkf_update(state:axis<u>:list<f32>, input:axis<u>:list<f32>) -> axis<u>:list<f32>:
    @: state + gain + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "axis_vector_vector"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "values", "offset": 0.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0}
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "values", "offset": 0.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0}
    ]
    assert "struct State {\n  values: array<f32, 3>," in shader
    assert "struct Input {\n  values: array<f32, 3>," in shader
    assert "const gain: array<f32, 3> = array<f32, 3>(1.5" in shader
    assert "let next_value_2: f32 = ((state.values[2] + gain[2]) + input.values[2]);" in shader


def test_default_path_driver_can_emit_source_driven_float_axis_intrinsic_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_axis_intrinsic_webgpu.vkf"
    source_path.write_text(
        """gain: [0.5, 1.5, 2.5] -> u
vkf_update(state:axis<u>:list<f32>, input:f32) -> axis<u>:list<f32>:
    @: math.sin(state + gain + input)
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "values", "offset": 0.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0}
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "const gain: array<f32, 3> = array<f32, 3>(0.5" in shader
    assert "let next_value_2: f32 = sin(((state.values[2] + gain[2]) + input.value));" in shader


def test_default_path_driver_can_emit_source_driven_mixed_float_record_axis_bias_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_record_axis_bias_webgpu.vkf"
    source_path.write_text(
        """bias: 0.25
gain: [1.5, 2.5, 3.5] -> u
vkf_update(state:record{count:f32,values:axis<u>:list<f32>}, input:record{delta:f32,offsets:axis<u>:list<f32>}) -> record{count:f32,values:axis<u>:list<f32>}:
    @: (count: state.count + input.delta + bias, values: state.values + gain + input.offsets)
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert webgpu_manifest["runtime_surface"]["update_mode"] == "record"
    assert webgpu_manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0.0, "type": "f32", "storage": "f32"},
        {"name": "values", "offset": 4.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0},
    ]
    assert webgpu_manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0.0, "type": "f32", "storage": "f32"},
        {"name": "offsets", "offset": 4.0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3.0},
    ]
    assert "struct State {\n  count: f32,\n  values: array<f32, 3>," in shader
    assert "struct Input {\n  delta: f32,\n  offsets: array<f32, 3>," in shader
    assert "const bias: f32 = 0.25;" in shader
    assert "const gain: array<f32, 3> = array<f32, 3>(1.5" in shader
    assert "let next_count: f32 = ((state.count + input.delta) + bias);" in shader
    assert "let next_values_2: f32 = ((state.values[2] + gain[2]) + input.offsets[2]);" in shader


def test_default_path_driver_can_emit_source_driven_computed_intrinsic_binding_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "computed_intrinsic_binding_webgpu.vkf"
    source_path.write_text(
        """theta: [0.0, 1.5707963267948966, 3.141592653589793] -> u
wave: math.sin(theta)
vkf_update(state:axis<u>:list<f32>, input:f32) -> axis<u>:list<f32>:
    @: state + wave + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    bindings = webgpu_manifest["runtime_surface"]["bindings"]
    assert summary["webgpu_status"] == "compiled"
    assert bindings[0]["name"] == "theta"
    assert bindings[0]["kind"] == "axis_f64_array"
    assert bindings[1]["name"] == "wave"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["values"] == pytest.approx([0.0, 1.0, 0.0], abs=1e-6)
    assert "const wave: array<f32, 3> = array<f32, 3>(" in shader
    assert "let next_value_2: f32 = ((state.values[2] + wave[2]) + input.value);" in shader


def test_default_path_driver_can_emit_source_driven_float_scalar_exp_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_exp_webgpu.vkf"
    source_path.write_text(
        """bias: 0.5
vkf_update(state:f32, input:f32) -> f32:
    @: math.exp(state + input + bias)
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert "const bias: f32 = 0.5;" in shader
    assert "let next_value: f32 = exp(((state.value + input.value) + bias));" in shader


def test_default_path_driver_can_emit_source_driven_computed_exp_binding_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "computed_exp_binding_webgpu.vkf"
    source_path.write_text(
        """theta: [0.0, 1.0, 2.0] -> u
wave: math.exp(theta)
vkf_update(state:axis<u>:list<f32>, input:f32) -> axis<u>:list<f32>:
    @: state + wave + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    bindings = webgpu_manifest["runtime_surface"]["bindings"]
    assert summary["webgpu_status"] == "compiled"
    assert bindings[1]["name"] == "wave"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["values"] == pytest.approx([1.0, 2.718281828459045, 7.38905609893065], abs=1e-6)
    assert "const wave: array<f32, 3> = array<f32, 3>(" in shader
    assert "let next_value_2: f32 = ((state.values[2] + wave[2]) + input.value);" in shader


def test_default_path_driver_can_emit_source_driven_float_scalar_division_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_division_webgpu.vkf"
    source_path.write_text(
        """scale: 2.5
vkf_update(state:f32, input:f32) -> f32:
    @: state + input / scale
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert "const scale: f32 = 2.5;" in shader
    assert "let next_value: f32 = (state.value + (input.value / scale));" in shader


def test_default_path_driver_can_emit_source_driven_computed_division_binding_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "computed_division_binding_webgpu.vkf"
    source_path.write_text(
        """theta: [2.0, 5.0, 10.0] -> u
half: theta / 4.0
vkf_update(state:axis<u>:list<f32>, input:f32) -> axis<u>:list<f32>:
    @: state + half + input
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    webgpu_manifest = json.loads(Path(summary["webgpu_manifest_path"]).read_text(encoding="utf-8"))
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    bindings = webgpu_manifest["runtime_surface"]["bindings"]
    assert summary["webgpu_status"] == "compiled"
    assert bindings[1]["name"] == "half"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["values"] == pytest.approx([0.5, 1.25, 2.5], abs=1e-6)
    assert "const half: array<f32, 3> = array<f32, 3>(" in shader
    assert "let next_value_2: f32 = ((state.values[2] + half[2]) + input.value);" in shader


def test_default_path_driver_can_emit_source_driven_float_scalar_power_webgpu_artifact(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_power_webgpu.vkf"
    source_path.write_text(
        """scale: 2.0
vkf_update(state:f32, input:f32) -> f32:
    @: input ^ scale
""",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(sibling_smokes["driver"]),
            "--source",
            str(source_path),
            "--emit-webgpu",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(result.stdout)
    webgpu_artifact_path = Path(summary["webgpu_artifact_path"])
    shader = webgpu_artifact_path.read_text(encoding="utf-8")
    assert summary["webgpu_status"] == "compiled"
    assert "let next_value: f32 = pow(input.value, scale);" in shader


def test_default_path_missing_sibling_tool_fails_native_diagnostic(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "missing_parser.vkf"
    source_path.write_text('io.print("hello")', encoding="utf-8")
    sibling_smokes["parser"].unlink()

    proc = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "missing native sibling tool parser" in proc.stderr
    assert "fallback" not in proc.stderr.lower()


def test_default_path_unsupported_source_fails_without_python_fallback(
    tmp_path: Path,
    sibling_smokes: dict[str, Path],
) -> None:
    source_path = tmp_path / "unsupported_scene.vkf"
    source_path.write_text('scene Main:\n    io.print("hello")', encoding="utf-8")

    proc = subprocess.run(
        [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "fallback" not in proc.stderr.lower()
    assert "Python" not in proc.stderr
    assert not (tmp_path / ".vkfbuild" / "unsupported_scene" / "manifest.json").exists()


def test_default_path_driver_runs_all_top_level_examples_without_python_fallback(
    sibling_smokes: dict[str, Path],
) -> None:
    failures: list[str] = []

    for source_path in TOP_LEVEL_EXAMPLE_VKF_FILES:
        proc = subprocess.run(
            [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            failures.append(
                f"{source_path.name}: rc={proc.returncode}: {proc.stderr.strip() or proc.stdout.strip()}"
            )
            continue
        summary = json.loads(proc.stdout)
        if summary.get("ran") is not True:
            failures.append(f"{source_path.name}: expected ran=true, got {summary!r}")
            continue
        if "fallback" in proc.stderr.lower() or "python" in proc.stderr.lower():
            failures.append(f"{source_path.name}: stderr leaked fallback/python markers: {proc.stderr.strip()}")

    assert failures == []


def test_default_path_driver_runs_all_recursive_runnable_examples_without_python_fallback(
    sibling_smokes: dict[str, Path],
) -> None:
    failures: list[str] = []

    for source_path in RECURSIVE_RUNNABLE_EXAMPLE_VKF_FILES:
        proc = subprocess.run(
            [str(sibling_smokes["driver"]), "--source", str(source_path), "--run"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        display_name = source_path.relative_to(ROOT).as_posix()
        if proc.returncode != 0:
            failures.append(
                f"{display_name}: rc={proc.returncode}: {proc.stderr.strip() or proc.stdout.strip()}"
            )
            continue
        summary = json.loads(proc.stdout)
        if summary.get("ran") is not True:
            failures.append(f"{display_name}: expected ran=true, got {summary!r}")
            continue
        if "fallback" in proc.stderr.lower() or "python" in proc.stderr.lower():
            failures.append(f"{display_name}: stderr leaked fallback/python markers: {proc.stderr.strip()}")

    assert len(RECURSIVE_RUNNABLE_EXAMPLE_VKF_FILES) == 97
    assert failures == []
