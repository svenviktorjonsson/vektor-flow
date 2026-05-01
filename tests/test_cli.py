"""Tests for the ``vkf`` CLI."""

from __future__ import annotations

from pathlib import Path
import subprocess
import json
import sys

import pytest

from vektorflow.cli import main, resolve_vkf_path
from vektorflow.cpp_backend import (
    compile_cpp_source,
    discover_cpp_compiler,
    emit_cpp_from_source_file,
    load_native_package,
    run_cpp_executable,
)
from vektorflow.lexer import tokenize
from vektorflow.native_core_lexer import lex_native_core_file_to_json, lex_native_core_stdin_to_json
from vektorflow.parser import parse_module
from vektorflow.token_stream import token_stream_to_json, tokens_to_json
from tests.token_stream_fixture_helper import (
    BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
    INVALID_TOKEN_STREAM_ENVELOPE_CASES,
    MALFORMED_TOKEN_ENTRY_CASES,
    assert_cli_rejects_token_stream_object,
    assert_cli_rejects_token_stream,
    assert_cli_parse_tokens_output_matches_source,
    assert_fixture_boundary_parity,
    native_core_fixture_cases,
    token_fixture_case,
)

ROOT = Path(__file__).resolve().parent.parent
ALL_EXAMPLE_VKF_FILES = sorted((ROOT / "examples").rglob("*.vkf"))
HELLO = ROOT / "examples" / "hello.vkf"
FOLDER_REPO_MAIN = ROOT / "examples" / "folder_repo" / "main.vkf"
NATIVE_CORE = ROOT / "examples" / "native_core"
NATIVE_CORE_EXAMPLES = [
    "hello_native.vkf",
    "vectors_native.vkf",
    "records_native.vkf",
    "numeric_native.vkf",
    "named_record_native.vkf",
    "named_record_nested_native.vkf",
    "named_record_collections_native.vkf",
    "named_record_scene_native.vkf",
    "named_record_scene_chain_native.vkf",
    "named_record_scene_helpers_native.vkf",
    "named_record_scene_handoff_native.vkf",
    "named_record_scene_relay_native.vkf",
    "named_record_scene_fanout_native.vkf",
    "named_record_scene_compose_native.vkf",
    "named_record_scene_overlay_native.vkf",
    "named_record_scene_patch_native.vkf",
    "named_record_scene_split_native.vkf",
    "named_record_scene_splice_native.vkf",
    "named_record_scene_rebuild_native.vkf",
    "named_record_scene_crossfade_native.vkf",
    "named_record_scene_reverse_native.vkf",
    "named_record_scene_checkpoint_native.vkf",
]
SCENE_NATIVE_CORE_EXAMPLES = [
    example_name for example_name in NATIVE_CORE_EXAMPLES if example_name.startswith("named_record_scene_")
]
NON_SCENE_NATIVE_CORE_EXAMPLES = [
    example_name for example_name in NATIVE_CORE_EXAMPLES if example_name not in SCENE_NATIVE_CORE_EXAMPLES
]
RUNTIME_PARITY_NATIVE_CORE_EXAMPLES = {
    "hello_native.vkf",
    "vectors_native.vkf",
    "numeric_native.vkf",
    "named_record_native.vkf",
    "named_record_nested_native.vkf",
    "named_record_collections_native.vkf",
    *SCENE_NATIVE_CORE_EXAMPLES,
}
NATIVE_CORE_EXPECTED_FIRST_LINES = {
    "hello_native.vkf": "42",
    "vectors_native.vkf": "[2.5, 2.5, 2.5, 2.5]",
    "numeric_native.vkf": "0",
    "named_record_nested_native.vkf": "4",
    "named_record_collections_native.vkf": "[5, 7]",
    "named_record_scene_native.vkf": "4",
    "named_record_scene_chain_native.vkf": "7",
    "named_record_scene_helpers_native.vkf": "6",
    "named_record_scene_handoff_native.vkf": "10",
    "named_record_scene_relay_native.vkf": "10",
    "named_record_scene_fanout_native.vkf": "7",
    "named_record_scene_compose_native.vkf": "4",
    "named_record_scene_overlay_native.vkf": "4",
    "named_record_scene_patch_native.vkf": "4",
    "named_record_scene_split_native.vkf": "10",
    "named_record_scene_splice_native.vkf": "7",
    "named_record_scene_rebuild_native.vkf": "7",
    "named_record_scene_crossfade_native.vkf": "10",
    "named_record_scene_reverse_native.vkf": "10",
    "named_record_scene_checkpoint_native.vkf": "4",
}
NON_SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES = [
    (example_name, NATIVE_CORE_EXPECTED_FIRST_LINES[example_name])
    for example_name in NON_SCENE_NATIVE_CORE_EXAMPLES
    if example_name in NATIVE_CORE_EXPECTED_FIRST_LINES
]
SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES = [
    (example_name, NATIVE_CORE_EXPECTED_FIRST_LINES[example_name])
    for example_name in SCENE_NATIVE_CORE_EXAMPLES
]
SCENE_NATIVE_CORE_BATCH_A = SCENE_NATIVE_CORE_EXAMPLES[:4]
SCENE_NATIVE_CORE_BATCH_B = SCENE_NATIVE_CORE_EXAMPLES[4:8]
SCENE_NATIVE_CORE_BATCH_C = SCENE_NATIVE_CORE_EXAMPLES[8:12]
SCENE_NATIVE_CORE_BATCH_D = SCENE_NATIVE_CORE_EXAMPLES[12:]
SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_A = [
    (example_name, NATIVE_CORE_EXPECTED_FIRST_LINES[example_name])
    for example_name in SCENE_NATIVE_CORE_BATCH_A
]
SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_B = [
    (example_name, NATIVE_CORE_EXPECTED_FIRST_LINES[example_name])
    for example_name in SCENE_NATIVE_CORE_BATCH_B
]
SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_C = [
    (example_name, NATIVE_CORE_EXPECTED_FIRST_LINES[example_name])
    for example_name in SCENE_NATIVE_CORE_BATCH_C
]
SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_D = [
    (example_name, NATIVE_CORE_EXPECTED_FIRST_LINES[example_name])
    for example_name in SCENE_NATIVE_CORE_BATCH_D
]
EXPANDED_NATIVE_FRONTEND_PARSE_EXAMPLES = [
    ROOT / "examples" / "benchmarks" / "bitmask_match.vkf",
    ROOT / "examples" / "benchmarks" / "multisets_records.vkf",
    ROOT / "examples" / "benchmarks" / "stdlib_numeric.vkf",
    ROOT / "examples" / "benchmarks" / "records_dynamic.vkf",
    ROOT / "examples" / "benchmarks" / "custom_overloads.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_elementwise.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf",
    ROOT / "examples" / "benchmarks" / "vectors_shapes.vkf",
    ROOT / "examples" / "nested" / "app.vkf",
    ROOT / "examples" / "folder_repo" / "main.vkf",
]
EXPANDED_NATIVE_FRONTEND_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "benchmarks" / "bitmask_match.vkf",
    ROOT / "examples" / "benchmarks" / "multisets_records.vkf",
    ROOT / "examples" / "benchmarks" / "stdlib_numeric.vkf",
    ROOT / "examples" / "benchmarks" / "records_dynamic.vkf",
    ROOT / "examples" / "benchmarks" / "custom_overloads.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_elementwise.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf",
    ROOT / "examples" / "benchmarks" / "vectors_shapes.vkf",
]
MINUS_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "ui_field_mesh_uvw.vkf",
    ROOT / "examples" / "ui_torus_hole_clickthrough.vkf",
]
CARET_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "operators.vkf",
]
DOLLAR_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "funcs" / "a.vkf",
    ROOT / "examples" / "piping.vkf",
]
SEMICOLON_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "readme_surface.vkf",
    ROOT / "examples" / "branching.vkf",
]
AT_FORM_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "interaction.vkf",
]
PERCENT_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "ui_field_mesh_uv_landscape.vkf",
]
UTF8_STRING_TOKEN_PARITY_EXAMPLES = [
    ROOT / "examples" / "gui_event_loop.vkf",
    ROOT / "examples" / "time_pause_demo.vkf",
]
LAST_MILE_NATIVE_LEXER_PARITY_EXAMPLES = [
    ROOT / "examples" / "branching.vkf",
    ROOT / "examples" / "interaction.vkf",
    ROOT / "examples" / "ui_field_mesh_uv_landscape.vkf",
    ROOT / "examples" / "gui_event_loop.vkf",
    ROOT / "examples" / "time_pause_demo.vkf",
]
NATIVE_CORE_EXECUTION_CONTRACT_EXAMPLES = [
    "hello_native.vkf",
    "records_native.vkf",
    "numeric_native.vkf",
    "named_record_scene_helpers_native.vkf",
    "named_record_scene_splice_native.vkf",
    "named_record_scene_reverse_native.vkf",
]
EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES = [
    ROOT / "examples" / "benchmarks" / "bitmask_match.vkf",
    ROOT / "examples" / "benchmarks" / "multisets_records.vkf",
    ROOT / "examples" / "benchmarks" / "stdlib_numeric.vkf",
    ROOT / "examples" / "benchmarks" / "records_dynamic.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
    ROOT / "examples" / "benchmarks" / "scalar_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_hotloop.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_elementwise.vkf",
    ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf",
    ROOT / "examples" / "benchmarks" / "vectors_shapes.vkf",
]


def _short_artifact_stem(name: str, prefix: str) -> str:
    stem = Path(name).stem
    compact = (
        stem.replace("named_record", "nr")
        .replace("vector", "vec")
        .replace("scalar", "sca")
        .replace("collections", "cols")
        .replace("native", "n")
    )
    compact = "".join(ch for ch in compact if ch.isalnum() or ch == "_")
    return f"{prefix}_{compact[:20]}"


def _run_package_command(package_dir: Path, argv: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=package_dir, capture_output=True, text=True)


def _windows_runnable_command(package_dir: Path, kind: str, preferred: bool = True) -> list[str]:
    surface = load_native_package(package_dir)
    family = surface.smoke_test_family("windows") if kind == "smoke_test" else surface.launch_family("windows")
    if preferred:
        return list(family.preferred.argv)
    return list(family.fallbacks[1].argv)


def _assert_windows_runnable_projection(surface, manifest: dict[str, object], kind: str) -> None:
    entry = surface.smoke_test_entry_surface("windows") if kind == "smoke_test" else surface.launch_entry_surface("windows")
    execution = entry.execution
    runnable = surface.smoke_test_family("windows") if kind == "smoke_test" else surface.launch_family("windows")
    install = execution.install
    assert manifest["install"]["preferred"][kind]["windows"] == list(install.preferred_artifacts)
    assert manifest["install"]["preferred_commands"][kind]["windows"] == list(install.preferred_commands[0])
    assert manifest["install"]["commands"][kind]["windows"] == [list(command) for command in install.commands]
    assert manifest["install"][kind]["windows"] == list(install.artifacts)
    assert execution.preferred == runnable.preferred
    assert execution.fallbacks == runnable.fallbacks
    assert install.preferred_artifacts == (execution.preferred.artifact,)
    assert install.preferred_commands == (execution.preferred.argv,)
    assert install.artifacts == tuple(spec.artifact for spec in execution.fallbacks)
    assert install.commands == tuple(spec.argv for spec in execution.fallbacks)


def _assert_codegen_projection(surface, manifest: dict[str, object]) -> None:
    build = surface.build
    generated = build.generated
    compile = build.compile_command
    assert manifest["codegen_contract"]["backend"] == "cpp_backend"
    assert manifest["codegen_contract"]["emitted_cpp"] == generated.emitted_cpp.artifact
    assert manifest["codegen_contract"]["entry_executable"] == generated.entry_executable.artifact
    assert manifest["codegen_contract"]["compiler"]["kind"] == build.compiler.kind
    assert manifest["codegen_contract"]["compiler"]["path"] == build.compiler.path
    assert manifest["codegen_contract"]["compile"]["executable"] == compile.executable
    assert tuple(manifest["codegen_contract"]["compile"]["flags"]) == compile.flags
    assert tuple(manifest["codegen_contract"]["compile"]["inputs"]) == tuple(spec.artifact for spec in compile.inputs)
    assert tuple(manifest["codegen_contract"]["compile"]["outputs"]) == tuple(spec.artifact for spec in compile.outputs)
    assert manifest["codegen_contract"]["compile_argv"] == list(compile.argv)
    assert compile.executable == build.compiler.path
    assert compile.cwd == surface.package_dir
    assert compile.inputs == (generated.emitted_cpp,)
    assert compile.outputs == (generated.entry_executable,)
    assert manifest["codegen_contract"]["launch_executables"]["windows"] == generated.launch_target_for("windows").artifact
    assert manifest["codegen_contract"]["launch_executables"]["posix"] == generated.launch_target_for("posix").artifact
    assert generated.emitted_cpp.path == surface.cpp_path
    assert generated.entry_executable.path == surface.executable_path
    assert build.compiler.kind == surface.compiler_kind
    assert build.compiler.path == surface.compiler_path


def _assert_artifact_surface_projection(surface, manifest: dict[str, object]) -> None:
    artifacts = surface.artifacts
    assert artifacts.manifest_path == surface.manifest_path
    assert artifacts.readme_path == surface.readme_path
    assert artifacts.launchers.artifact_for("windows").artifact == manifest["artifacts"]["launchers"]["windows"]
    assert artifacts.launchers.artifact_for("windows_powershell").artifact == manifest["artifacts"]["launchers"]["windows_powershell"]
    assert artifacts.launchers.artifact_for("posix").artifact == manifest["artifacts"]["launchers"]["posix"]
    assert artifacts.smoke_tests.artifact_for("windows").artifact == manifest["artifacts"]["smoke_tests"]["windows"]
    assert artifacts.smoke_tests.artifact_for("windows_powershell").artifact == manifest["artifacts"]["smoke_tests"]["windows_powershell"]
    assert artifacts.smoke_tests.artifact_for("posix").artifact == manifest["artifacts"]["smoke_tests"]["posix"]


def _assert_entry_surface_projection(surface, manifest: dict[str, object], kind: str, platform: str) -> None:
    entry = surface.entry_surface(kind, platform)
    execution = entry.execution
    preferred_manifest = manifest["runnable_contract"][kind]["preferred"][platform]
    assert entry.kind == kind
    assert entry.platform == platform
    assert entry.support_artifact.artifact == manifest["artifacts"]["launchers" if kind == "launch" else "smoke_tests"][platform]
    assert execution.preferred.artifact == preferred_manifest["artifact"]
    assert execution.preferred.argv == tuple(preferred_manifest["argv"])


def _assert_typed_package_surface_contract(
    surface,
    *,
    subset: str,
    entrypoint: str,
    source_input: str,
    source_label: str,
) -> None:
    view = surface.manifest
    build = surface.build
    artifacts = surface.artifacts
    launch_windows = surface.launch_entry_surface("windows")
    launch_windows_ps1 = surface.launch_entry_surface("windows_powershell")
    launch_posix = surface.launch_entry_surface("posix")
    smoke_windows = surface.smoke_test_entry_surface("windows")
    smoke_windows_ps1 = surface.smoke_test_entry_surface("windows_powershell")
    smoke_posix = surface.smoke_test_entry_surface("posix")

    assert view.subset == subset
    assert view.entrypoint == entrypoint
    assert view.source_input == source_input
    assert view.source_label == source_label
    assert view.python_required_to_build is True
    assert view.python_required_to_run is False

    assert surface.manifest_path == artifacts.manifest_path
    assert surface.readme_path == artifacts.readme_path
    assert surface.cpp_path == build.generated.emitted_cpp.path
    assert surface.executable_path == build.generated.entry_executable.path
    assert surface.compiler_kind == build.compiler.kind
    assert surface.compiler_path == build.compiler.path
    assert view.entry_executable_name == build.generated.entry_executable.artifact

    assert build.compile_command.executable == build.compiler.path
    assert build.compile_command.cwd == surface.package_dir
    assert build.compile_command.inputs == (build.generated.emitted_cpp,)
    assert build.compile_command.outputs == (build.generated.entry_executable,)
    assert build.compile_command.argv[0] == build.compile_command.executable
    assert build.compile_command.argv[-2:] == ("-o", build.generated.entry_executable.artifact)

    assert launch_windows.execution.target_executable is not None
    assert launch_windows.execution.target_executable == build.generated.launch_target_for("windows")
    assert launch_windows_ps1.execution.target_executable is not None
    assert launch_windows_ps1.execution.target_executable == build.generated.launch_target_for("windows")
    assert launch_posix.execution.target_executable is not None
    assert launch_posix.execution.target_executable == build.generated.launch_target_for("posix")

    assert launch_windows.support_artifact == artifacts.launchers.artifact_for("windows")
    assert launch_windows_ps1.support_artifact == artifacts.launchers.artifact_for("windows_powershell")
    assert launch_posix.support_artifact == artifacts.launchers.artifact_for("posix")
    assert smoke_windows.support_artifact == artifacts.smoke_tests.artifact_for("windows")
    assert smoke_windows_ps1.support_artifact == artifacts.smoke_tests.artifact_for("windows_powershell")
    assert smoke_posix.support_artifact == artifacts.smoke_tests.artifact_for("posix")

    assert launch_windows.execution.preferred.artifact == "run.ps1"
    assert launch_windows.execution.fallbacks[1].artifact == "run.bat"
    assert launch_windows_ps1.execution.preferred.artifact == "run.ps1"
    assert smoke_windows.execution.preferred.artifact == "smoke-test.ps1"
    assert smoke_windows.execution.fallbacks[1].artifact == "smoke-test.bat"
    assert smoke_windows_ps1.execution.preferred.artifact == "smoke-test.ps1"

    assert launch_windows.execution.install.preferred_artifacts == ("run.ps1",)
    assert smoke_windows.execution.install.preferred_artifacts == ("smoke-test.ps1",)
    assert launch_posix.execution.install.preferred_artifacts == ("./run.sh",)
    assert smoke_posix.execution.install.preferred_artifacts == ("./smoke-test.sh",)


def _assert_native_core_cpp_contract(tmp_path: Path, example_name: str) -> None:
    src = NATIVE_CORE / example_name
    out = tmp_path / src.with_suffix(".cpp").name

    assert main(["cpp-native-core", str(src), "-o", str(out)]) == 0
    emitted = out.read_text(encoding="utf-8")
    standard = emit_cpp_from_source_file(src)
    if example_name in RUNTIME_PARITY_NATIVE_CORE_EXAMPLES:
        stem = Path(example_name).stem
        standard_exe = compile_cpp_source(standard, tmp_path / "standard", exe_name=f"{stem}_standard")
        native_exe = compile_cpp_source(emitted, tmp_path / "native", exe_name=f"{stem}_native")
        standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
        native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)
        assert standard_proc.returncode == 0
        assert native_proc.returncode == 0
        assert native_proc.stdout == standard_proc.stdout
        return
    assert emitted == standard


def _assert_native_core_build_first_line(
    capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str
) -> None:
    src = NATIVE_CORE / example_name
    exe = tmp_path / f"{_short_artifact_stem(example_name, 'bn')}.exe"
    assert main(["build", str(src), "-o", str(exe)]) == 0
    _ = capsys.readouterr()
    proc = subprocess.run([str(exe)], capture_output=True, text=True)
    assert proc.returncode == 0
    assert proc.stdout.splitlines()[0].strip() == expected_line


def _assert_native_core_build_matches_direct_cpp(
    capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
) -> None:
    src = NATIVE_CORE / example_name
    cpp_out = tmp_path / f"{_short_artifact_stem(example_name, 'cpp')}.cpp"
    built_exe = tmp_path / f"{_short_artifact_stem(example_name, 'be')}.exe"

    assert main(["cpp-native-core", str(src), "-o", str(cpp_out)]) == 0
    emitted = cpp_out.read_text(encoding="utf-8")

    manual_exe = compile_cpp_source(
        emitted,
        tmp_path / _short_artifact_stem(example_name, "mcpp"),
        exe_name=_short_artifact_stem(example_name, "mexe"),
    )
    manual_proc = run_cpp_executable(manual_exe)
    assert manual_proc.returncode == 0

    assert main(["build-native-core", str(src), "-o", str(built_exe)]) == 0
    reported = capsys.readouterr().out.strip()
    assert Path(reported) == built_exe.resolve()

    built_proc = run_cpp_executable(built_exe)
    assert built_proc.returncode == 0
    assert built_proc.stdout == manual_proc.stdout


def _assert_tokens_native_core_subprocess_matches_python(path: Path) -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "vektorflow.cli", "tokens-native-core", str(path), "--json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    payload = json.loads(proc.stdout)
    expected = json.loads(
        token_stream_to_json(tokenize(path.read_text(encoding="utf-8"), filename=path.as_posix()))
    )
    assert payload == expected


def _assert_tokens_native_core_direct_matches_python(path: Path) -> None:
    payload = json.loads(lex_native_core_file_to_json(path, filename_label=path.as_posix()))
    expected = json.loads(
        token_stream_to_json(tokenize(path.read_text(encoding="utf-8"), filename=path.as_posix()))
    )
    assert payload == expected


def _assert_tokens_native_core_file_and_stdin_match(path: Path) -> None:
    source = path.read_text(encoding="utf-8")
    file_payload = json.loads(lex_native_core_file_to_json(path, filename_label=path.as_posix()))
    stdin_payload = json.loads(lex_native_core_stdin_to_json(source, filename_label=path.as_posix()))
    assert stdin_payload == file_payload


def _assert_parse_and_build_native_core_execution_contract(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    example_name: str,
) -> None:
    path = NATIVE_CORE / example_name
    src = path.read_text(encoding="utf-8")
    expected_repr = repr(parse_module(src, filename=path.as_posix()))
    standard_exe = tmp_path / f"{_short_artifact_stem(example_name, 'std')}.exe"
    file_exe = tmp_path / f"{_short_artifact_stem(example_name, 'bnf')}.exe"
    stdin_exe = tmp_path / f"{_short_artifact_stem(example_name, 'bns')}.exe"

    assert main(["parse-native-core", str(path)]) == 0
    assert capsys.readouterr().out.strip() == expected_repr

    monkeypatch.setattr("sys.stdin.read", lambda: src)
    assert main(["parse-native-core", "-"]) == 0
    assert capsys.readouterr().out.strip() == expected_repr

    assert main(["build", str(path), "-o", str(standard_exe)]) == 0
    _ = capsys.readouterr()
    standard_proc = run_cpp_executable(standard_exe)
    assert standard_proc.returncode == 0

    assert main(["build-native-core", str(path), "-o", str(file_exe)]) == 0
    assert Path(capsys.readouterr().out.strip()) == file_exe.resolve()
    file_proc = run_cpp_executable(file_exe)
    assert file_proc.returncode == 0

    monkeypatch.setattr("sys.stdin.read", lambda: src)
    assert main(["build-native-core", "-", "-o", str(stdin_exe)]) == 0
    assert Path(capsys.readouterr().out.strip()) == stdin_exe.resolve()
    stdin_proc = run_cpp_executable(stdin_exe)
    assert stdin_proc.returncode == 0

    assert file_proc.stdout == standard_proc.stdout
    assert stdin_proc.stdout == standard_proc.stdout


def _assert_cpp_native_core_execution_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    example_name: str,
) -> None:
    path = NATIVE_CORE / example_name
    src = path.read_text(encoding="utf-8")
    standard_cpp = emit_cpp_from_source_file(path)
    standard_exe = compile_cpp_source(
        standard_cpp,
        tmp_path / f"{_short_artifact_stem(example_name, 'cstd')}",
        exe_name=_short_artifact_stem(example_name, "estd"),
    )
    file_cpp = tmp_path / f"{_short_artifact_stem(example_name, 'cf')}.cpp"
    stdin_cpp = tmp_path / f"{_short_artifact_stem(example_name, 'cs')}.cpp"

    assert main(["cpp-native-core", str(path), "-o", str(file_cpp)]) == 0

    monkeypatch.setattr("sys.stdin.read", lambda: src)
    assert main(["cpp-native-core", "-", "-o", str(stdin_cpp)]) == 0

    file_exe = compile_cpp_source(
        file_cpp.read_text(encoding="utf-8"),
        tmp_path / f"{_short_artifact_stem(example_name, 'cfx')}",
        exe_name=_short_artifact_stem(example_name, "ef"),
    )
    stdin_exe = compile_cpp_source(
        stdin_cpp.read_text(encoding="utf-8"),
        tmp_path / f"{_short_artifact_stem(example_name, 'csx')}",
        exe_name=_short_artifact_stem(example_name, "es"),
    )

    standard_proc = run_cpp_executable(standard_exe)
    file_proc = run_cpp_executable(file_exe)
    stdin_proc = run_cpp_executable(stdin_exe)

    assert standard_proc.returncode == 0
    assert file_proc.returncode == 0
    assert stdin_proc.returncode == 0
    assert file_proc.stdout == standard_proc.stdout
    assert stdin_proc.stdout == standard_proc.stdout


def _assert_package_native_core_contract(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    example_name: str,
) -> None:
    path = NATIVE_CORE / example_name
    src = path.read_text(encoding="utf-8")
    package_dir = tmp_path / _short_artifact_stem(example_name, "pkg")

    assert main(["package-native-core", str(path), "-o", str(package_dir)]) == 0
    assert Path(capsys.readouterr().out.strip()) == package_dir.resolve()

    manifest_path = package_dir / "vektorflow-package.json"
    readme_path = package_dir / "README.txt"
    assert manifest_path.is_file()
    assert readme_path.is_file()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    surface = load_native_package(package_dir)
    artifacts = surface.artifacts
    view = surface.manifest
    assert manifest["kind"] == "vektorflow-native-package"
    assert manifest["runtime_contract"]["python_required_to_build"] is True
    assert manifest["runtime_contract"]["python_required_to_run"] is False
    _assert_typed_package_surface_contract(
        surface,
        subset="native_core",
        entrypoint="package-native-core",
        source_input=path.as_posix(),
        source_label=path.as_posix(),
    )
    _assert_codegen_projection(surface, manifest)
    _assert_artifact_surface_projection(surface, manifest)
    assert manifest["runtime_contract"]["preferred_launchers"]["windows"] == "run.ps1"
    assert manifest["runtime_contract"]["preferred_smoke_tests"]["windows"] == "smoke-test.ps1"
    assert manifest["runtime_contract"]["launchers"]["windows"] == "run.bat"
    assert manifest["runtime_contract"]["launchers"]["windows_powershell"] == "run.ps1"
    assert manifest["runtime_contract"]["launchers"]["posix"] == "run.sh"
    assert manifest["runtime_contract"]["smoke_tests"]["windows"] == "smoke-test.bat"
    assert manifest["runtime_contract"]["smoke_tests"]["windows_powershell"] == "smoke-test.ps1"
    assert manifest["runtime_contract"]["smoke_tests"]["posix"] == "smoke-test.sh"
    assert manifest["runtime_contract"]["preferred_launchers"]["windows"] == manifest["runnable_contract"]["launch"]["preferred"]["windows"]["artifact"]
    assert manifest["runtime_contract"]["preferred_smoke_tests"]["windows"] == manifest["runnable_contract"]["smoke_test"]["preferred"]["windows"]["artifact"]
    launch_entry = surface.launch_entry_surface("windows")
    smoke_entry = surface.smoke_test_entry_surface("windows")
    launch_execution = launch_entry.execution
    smoke_execution = smoke_entry.execution
    assert launch_execution.target_executable is not None
    assert launch_execution.target_executable.artifact == surface.build.generated.launch_target_for("windows").artifact
    assert launch_execution.preferred.artifact == "run.ps1"
    assert launch_execution.fallbacks[1].artifact == "run.bat"
    assert smoke_execution.preferred.artifact == "smoke-test.ps1"
    assert smoke_execution.fallbacks[1].artifact == "smoke-test.bat"
    _assert_entry_surface_projection(surface, manifest, "launch", "windows")
    _assert_entry_surface_projection(surface, manifest, "smoke_test", "windows")
    windows_launch_target = manifest["runtime_contract"]["launch_executables"]["windows"]
    posix_launch_target = manifest["runtime_contract"]["launch_executables"]["posix"]

    exe_path = surface.build.generated.entry_executable.path
    cpp_path = surface.build.generated.emitted_cpp.path
    windows_target_path = launch_execution.target_executable.path
    posix_target_path = surface.build.generated.launch_target_for("posix").path
    run_bat_path = launch_entry.support_artifact.path
    run_ps1_path = surface.launch_entry_surface("windows_powershell").support_artifact.path
    run_sh_path = artifacts.launchers.artifact_for("posix").path
    smoke_bat_path = smoke_entry.support_artifact.path
    smoke_ps1_path = surface.smoke_test_entry_surface("windows_powershell").support_artifact.path
    smoke_sh_path = artifacts.smoke_tests.artifact_for("posix").path
    assert exe_path.is_file()
    assert cpp_path.is_file()
    assert windows_target_path.is_file()
    assert posix_target_path.is_file()
    assert run_bat_path.is_file()
    assert run_ps1_path.is_file()
    assert run_sh_path.is_file()
    assert smoke_bat_path.is_file()
    assert smoke_ps1_path.is_file()
    assert smoke_sh_path.is_file()
    assert windows_launch_target in run_bat_path.read_text(encoding="utf-8")
    assert windows_launch_target in run_ps1_path.read_text(encoding="utf-8")
    assert posix_launch_target in run_sh_path.read_text(encoding="utf-8")
    assert manifest["artifacts"]["launchers"]["windows"] in smoke_bat_path.read_text(encoding="utf-8")
    assert manifest["artifacts"]["launchers"]["windows_powershell"] in smoke_ps1_path.read_text(encoding="utf-8")
    assert manifest["artifacts"]["launchers"]["posix"] in smoke_sh_path.read_text(encoding="utf-8")
    assert manifest["install"]["preferred"]["launch"]["windows"] == ["run.ps1"]
    assert manifest["install"]["preferred"]["smoke_test"]["windows"] == ["smoke-test.ps1"]
    assert manifest["install"]["launch"]["windows"] == ["run.ps1", "run.bat"]
    assert manifest["install"]["launch"]["posix"] == ["./run.sh"]
    assert manifest["install"]["smoke_test"]["windows"] == ["smoke-test.ps1", "smoke-test.bat"]
    assert manifest["install"]["smoke_test"]["posix"] == ["./smoke-test.sh"]
    _assert_windows_runnable_projection(surface, manifest, "launch")
    _assert_windows_runnable_projection(surface, manifest, "smoke_test")

    proc = run_cpp_executable(exe_path)
    assert proc.returncode == 0
    expected_line = NATIVE_CORE_EXPECTED_FIRST_LINES.get(example_name)
    if expected_line is not None:
        assert proc.stdout.splitlines()[0].strip() == expected_line
    smoke_proc = _run_package_command(package_dir, _windows_runnable_command(package_dir, "smoke_test", preferred=False))
    assert smoke_proc.returncode == 0
    assert smoke_proc.stdout == proc.stdout
    smoke_ps1_proc = _run_package_command(package_dir, _windows_runnable_command(package_dir, "smoke_test"))
    assert smoke_ps1_proc.returncode == 0
    assert smoke_ps1_proc.stdout == proc.stdout

    stdin_package_dir = tmp_path / _short_artifact_stem(example_name, "pgs")
    monkeypatch.setattr("sys.stdin.read", lambda: src)
    assert main(["package-native-core", "-", "-o", str(stdin_package_dir)]) == 0
    assert Path(capsys.readouterr().out.strip()) == stdin_package_dir.resolve()
    stdin_manifest = json.loads((stdin_package_dir / "vektorflow-package.json").read_text(encoding="utf-8"))
    assert stdin_manifest["source"]["input"] == "<stdin>"
    assert stdin_manifest["source"]["label"] == "<stdin>"
    stdin_exe = load_native_package(stdin_package_dir).build.generated.entry_executable.path
    stdin_proc = run_cpp_executable(stdin_exe)
    assert stdin_proc.returncode == 0
    assert stdin_proc.stdout == proc.stdout


def _assert_package_supported_native_contract(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    src_path = tmp_path / "supported_native_package.vkf"
    src_path.write_text(
        "twice(x:num) -> num:\n"
        "    x * 2\n\n"
        ":: twice(21)\n",
        encoding="utf-8",
    )
    source = src_path.read_text(encoding="utf-8")
    package_dir = tmp_path / "pkg_supported_native"

    assert main(["package", str(src_path), "-o", str(package_dir)]) == 0
    assert Path(capsys.readouterr().out.strip()) == package_dir.resolve()

    manifest_path = package_dir / "vektorflow-package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    surface = load_native_package(package_dir)
    artifacts = surface.artifacts
    view = surface.manifest
    assert manifest["kind"] == "vektorflow-native-package"
    assert manifest["runtime_contract"]["python_required_to_build"] is True
    assert manifest["runtime_contract"]["python_required_to_run"] is False
    _assert_typed_package_surface_contract(
        surface,
        subset="supported_native",
        entrypoint="package",
        source_input=src_path.as_posix(),
        source_label=src_path.as_posix(),
    )
    _assert_codegen_projection(surface, manifest)
    _assert_artifact_surface_projection(surface, manifest)
    assert manifest["runtime_contract"]["preferred_launchers"]["windows"] == "run.ps1"
    assert manifest["runtime_contract"]["smoke_tests"]["windows"] == "smoke-test.bat"
    launch_entry = surface.launch_entry_surface("windows")
    smoke_entry = surface.smoke_test_entry_surface("windows")
    launch_execution = launch_entry.execution
    smoke_execution = smoke_entry.execution
    assert launch_execution.preferred.artifact == "run.ps1"
    assert smoke_execution.preferred.artifact == "smoke-test.ps1"
    _assert_entry_surface_projection(surface, manifest, "launch", "windows")
    _assert_entry_surface_projection(surface, manifest, "smoke_test", "windows")
    _assert_windows_runnable_projection(surface, manifest, "launch")
    _assert_windows_runnable_projection(surface, manifest, "smoke_test")

    exe_path = surface.build.generated.entry_executable.path
    readme_path = artifacts.readme_path
    windows_target_path = launch_execution.target_executable.path
    run_bat_path = launch_entry.support_artifact.path
    run_ps1_path = surface.launch_entry_surface("windows_powershell").support_artifact.path
    run_sh_path = artifacts.launchers.artifact_for("posix").path
    smoke_bat_path = smoke_entry.support_artifact.path
    smoke_ps1_path = surface.smoke_test_entry_surface("windows_powershell").support_artifact.path
    smoke_sh_path = artifacts.smoke_tests.artifact_for("posix").path
    assert exe_path.is_file()
    assert readme_path.is_file()
    assert windows_target_path.is_file()
    assert run_bat_path.is_file()
    assert run_ps1_path.is_file()
    assert run_sh_path.is_file()
    assert smoke_bat_path.is_file()
    assert smoke_ps1_path.is_file()
    assert smoke_sh_path.is_file()
    proc = run_cpp_executable(exe_path)
    assert proc.returncode == 0
    assert proc.stdout.strip() == "42"
    smoke_proc = _run_package_command(package_dir, _windows_runnable_command(package_dir, "smoke_test", preferred=False))
    assert smoke_proc.returncode == 0
    assert smoke_proc.stdout == proc.stdout
    smoke_ps1_proc = _run_package_command(package_dir, _windows_runnable_command(package_dir, "smoke_test"))
    assert smoke_ps1_proc.returncode == 0
    assert smoke_ps1_proc.stdout == proc.stdout

    stdin_package_dir = tmp_path / "pkg_supported_stdin"
    monkeypatch.setattr("sys.stdin.read", lambda: source)
    assert main(["package", "-", "-o", str(stdin_package_dir)]) == 0
    assert Path(capsys.readouterr().out.strip()) == stdin_package_dir.resolve()
    stdin_manifest = json.loads((stdin_package_dir / "vektorflow-package.json").read_text(encoding="utf-8"))
    assert stdin_manifest["source"]["input"] == "<stdin>"
    assert stdin_manifest["source"]["label"] == "<stdin>"
    stdin_exe = load_native_package(stdin_package_dir).build.generated.entry_executable.path
    stdin_proc = run_cpp_executable(stdin_exe)
    assert stdin_proc.returncode == 0
    assert stdin_proc.stdout == proc.stdout


def _assert_package_supported_native_example_contract(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
    src_path: Path,
) -> None:
    source = src_path.read_text(encoding="utf-8")
    package_dir = tmp_path / _short_artifact_stem(src_path.name, "spkg")
    standard_exe = tmp_path / f"{_short_artifact_stem(src_path.name, 'sstd')}.exe"

    assert main(["build", str(src_path), "-o", str(standard_exe)]) == 0
    _ = capsys.readouterr()
    standard_proc = run_cpp_executable(standard_exe)
    assert standard_proc.returncode == 0

    assert main(["package", str(src_path), "-o", str(package_dir)]) == 0
    assert Path(capsys.readouterr().out.strip()) == package_dir.resolve()
    manifest_path = package_dir / "vektorflow-package.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    surface = load_native_package(package_dir)
    artifacts = surface.artifacts
    view = surface.manifest
    _assert_typed_package_surface_contract(
        surface,
        subset="supported_native",
        entrypoint="package",
        source_input=src_path.as_posix(),
        source_label=src_path.as_posix(),
    )
    _assert_codegen_projection(surface, manifest)
    _assert_artifact_surface_projection(surface, manifest)
    assert manifest["runtime_contract"]["entry_executable"] == surface.build.generated.entry_executable.artifact
    assert manifest["runtime_contract"]["launch_executables"]["windows"] == surface.build.generated.launch_target_for("windows").artifact
    assert view.entry_executable_name == surface.build.generated.entry_executable.artifact
    launch_entry = surface.launch_entry_surface("windows")
    smoke_entry = surface.smoke_test_entry_surface("windows")
    launch_execution = launch_entry.execution
    smoke_execution = smoke_entry.execution
    assert launch_execution.target_executable is not None
    assert launch_execution.target_executable.artifact == surface.build.generated.launch_target_for("windows").artifact
    assert smoke_execution.preferred.artifact == "smoke-test.ps1"
    assert smoke_execution.fallbacks[1].artifact == "smoke-test.bat"
    _assert_entry_surface_projection(surface, manifest, "launch", "windows")
    _assert_entry_surface_projection(surface, manifest, "smoke_test", "windows")
    _assert_windows_runnable_projection(surface, manifest, "launch")
    _assert_windows_runnable_projection(surface, manifest, "smoke_test")
    assert manifest["install"]["preferred"]["smoke_test"]["windows"] == ["smoke-test.ps1"]
    assert manifest["install"]["smoke_test"]["windows"] == ["smoke-test.ps1", "smoke-test.bat"]
    package_exe = surface.build.generated.entry_executable.path
    smoke_bat_path = smoke_entry.support_artifact.path
    smoke_ps1_path = surface.smoke_test_entry_surface("windows_powershell").support_artifact.path
    package_proc = run_cpp_executable(package_exe)
    assert package_proc.returncode == 0
    assert package_proc.stdout == standard_proc.stdout
    smoke_proc = _run_package_command(package_dir, _windows_runnable_command(package_dir, "smoke_test", preferred=False))
    assert smoke_proc.returncode == 0
    assert smoke_proc.stdout == standard_proc.stdout
    smoke_ps1_proc = _run_package_command(package_dir, _windows_runnable_command(package_dir, "smoke_test"))
    assert smoke_ps1_proc.returncode == 0
    assert smoke_ps1_proc.stdout == standard_proc.stdout

    stdin_package_dir = tmp_path / _short_artifact_stem(src_path.name, "sps")
    monkeypatch.setattr("sys.stdin.read", lambda: source)
    assert main(["package", "-", "-o", str(stdin_package_dir)]) == 0
    assert Path(capsys.readouterr().out.strip()) == stdin_package_dir.resolve()
    stdin_manifest = json.loads((stdin_package_dir / "vektorflow-package.json").read_text(encoding="utf-8"))
    assert stdin_manifest["source"]["input"] == "<stdin>"
    assert stdin_manifest["source"]["label"] == "<stdin>"
    stdin_exe = load_native_package(stdin_package_dir).build.generated.entry_executable.path
    stdin_proc = run_cpp_executable(stdin_exe)
    assert stdin_proc.returncode == 0
    assert stdin_proc.stdout == standard_proc.stdout


class TestResolveVkfPath:
    def test_explicit_vkf(self) -> None:
        assert resolve_vkf_path(str(HELLO)) == HELLO.resolve()

    def test_basename_without_extension(self) -> None:
        # examples/hello resolves to examples/hello.vkf
        assert resolve_vkf_path(str(ROOT / "examples" / "hello")) == HELLO.resolve()

    def test_missing_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            resolve_vkf_path("definitely_missing_file_xyz")


class TestMain:
    def test_run_hello(self) -> None:
        assert main([str(HELLO)]) == 0

    def test_run_short_name(self) -> None:
        assert main([str(ROOT / "examples" / "hello")]) == 0

    def test_run_supports_explicit_math_stdlib_namespace_import(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path
    ) -> None:
        src = tmp_path / "explicit_math_import.vkf"
        src.write_text(
            "math: .math\n"
            ":: math.sin(0)\n"
            ":: math.sqrt(81)\n",
            encoding="utf-8",
        )

        assert main([str(src)]) == 0
        assert capsys.readouterr().out.strip().splitlines() == ["0", "9"]

    def test_run_folder_repo_main(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Regression: bind + emit on the next line must not join across newlines."""
        assert main([str(FOLDER_REPO_MAIN)]) == 0
        assert capsys.readouterr().out.strip() == "42"

    def test_tokens_subcommand(self) -> None:
        rc = main(["tokens", str(HELLO)])
        assert rc == 0

    def test_tokens_subcommand_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["tokens", str(HELLO), "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        assert "tokens" in payload
        assert payload["tokens"][0]["kind"] == "EMIT"
        assert payload["tokens"][1]["kind"] == "STRING"

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_subcommand_json_matches_python(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "hello_native.vkf"
        assert main(["tokens-native-core", str(path), "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        expected = json.loads(
            token_stream_to_json(tokenize(path.read_text(encoding="utf-8"), filename=path.as_posix()))
        )
        assert payload == expected

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_subcommand_stdin_matches_python(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        src = ":: 6 * 7\n"
        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["tokens-native-core", "-", "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        expected = json.loads(token_stream_to_json(tokenize(src, filename="<stdin>")))
        assert payload == expected

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_subcommand_file_and_stdin_match_same_payload(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "hello_native.vkf"
        src = path.read_text(encoding="utf-8")

        assert main(["tokens-native-core", str(path), "--json"]) == 0
        file_payload = json.loads(capsys.readouterr().out)

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["tokens-native-core", "-", "--json"]) == 0
        stdin_payload = json.loads(capsys.readouterr().out)

        for payload in (file_payload, stdin_payload):
            for token in payload["tokens"]:
                token["location"]["file"] = "<normalized>"

        assert stdin_payload == file_payload

    def test_tokens_unknown_file(self) -> None:
        assert main(["tokens", "nope_not_a_file"]) == 1

    def test_parse_tokens_subcommand_file(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path
    ) -> None:
        src = ":: 3 + 4\n"
        payload_path = tmp_path / "tokens.json"
        payload_path.write_text(tokens_to_json(tokenize(src, filename="<test>")), encoding="utf-8")

        assert main(["parse-tokens", str(payload_path)]) == 0
        assert capsys.readouterr().out.strip() == repr(parse_module(src, filename="<test>"))

    def test_parse_tokens_subcommand_stdin(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        src = "x: 2\n:: x\n"
        payload = tokens_to_json(tokenize(src, filename="<stdin-tokens>"))
        monkeypatch.setattr("sys.stdin.read", lambda: payload)

        assert main(["parse-tokens", "-"]) == 0
        assert capsys.readouterr().out.strip() == repr(parse_module(src, filename="<stdin-tokens>"))

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_parse_native_core_subcommand_file(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "hello_native.vkf"
        assert main(["parse-native-core", str(path)]) == 0
        assert capsys.readouterr().out.strip() == repr(
            parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_parse_native_core_subcommand_stdin(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        src = ":: 6 * 7\n"
        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["parse-native-core", "-"]) == 0
        assert capsys.readouterr().out.strip() == repr(parse_module(src, filename="<stdin>"))

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_parse_native_core_numeric_example_preserves_stdlib_user_surface(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = NATIVE_CORE / "numeric_native.vkf"
        assert main(["parse-native-core", str(path)]) == 0
        parsed = capsys.readouterr().out.strip()
        assert parsed == repr(parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix()))
        assert "math.sin" in path.read_text(encoding="utf-8")
        assert "stat.mean" in path.read_text(encoding="utf-8")

    @pytest.mark.parametrize("payload, expected", INVALID_TOKEN_STREAM_ENVELOPE_CASES)
    def test_parse_tokens_subcommand_invalid_payload(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, payload: dict[str, object], expected: str
    ) -> None:
        _ = capsys.readouterr()
        assert_cli_rejects_token_stream_object(tmp_path, payload, expected)

    @pytest.mark.parametrize(
        "payload_text, expected",
        BAD_TOP_LEVEL_TOKEN_STREAM_CASES,
    )
    def test_parse_tokens_subcommand_bad_top_level_json(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, payload_text: str, expected: str
    ) -> None:
        _ = capsys.readouterr()
        assert_cli_rejects_token_stream(tmp_path, payload_text, expected)

    def test_parse_tokens_subcommand_versioned_fixture(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case = token_fixture_case("versioned_loose_dot_bind.json")
        assert_fixture_boundary_parity(case)
        assert main(["parse-tokens", str(case.payload_path)]) == 0
        assert_cli_parse_tokens_output_matches_source(case, capsys.readouterr().out)

    def test_parse_tokens_subcommand_legacy_fixture(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        case = token_fixture_case("legacy_singleton_tuple_type.json")
        assert_fixture_boundary_parity(case)
        assert main(["parse-tokens", str(case.payload_path)]) == 0
        assert_cli_parse_tokens_output_matches_source(case, capsys.readouterr().out)

    @pytest.mark.parametrize("case", native_core_fixture_cases(), ids=lambda case: case.name)
    def test_parse_tokens_subcommand_native_core_fixture_roundtrip(
        self, capsys: pytest.CaptureFixture[str], case
    ) -> None:
        assert_fixture_boundary_parity(case)
        assert main(["parse-tokens", str(case.payload_path)]) == 0
        assert_cli_parse_tokens_output_matches_source(case, capsys.readouterr().out)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "example_name",
        NATIVE_CORE_EXAMPLES,
    )
    def test_parse_native_core_examples_match_python_parser(
        self, capsys: pytest.CaptureFixture[str], example_name: str
    ) -> None:
        path = NATIVE_CORE / example_name
        assert main(["parse-native-core", str(path)]) == 0
        assert capsys.readouterr().out.strip() == repr(
            parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        EXPANDED_NATIVE_FRONTEND_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_expanded_examples_match_python(
        self, capsys: pytest.CaptureFixture[str], path: Path
    ) -> None:
        assert main(["tokens-native-core", str(path), "--json"]) == 0
        payload = json.loads(capsys.readouterr().out)
        expected = json.loads(
            token_stream_to_json(tokenize(path.read_text(encoding="utf-8"), filename=path.as_posix()))
        )
        assert payload == expected

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        MINUS_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_minus_examples_match_python_via_subprocess(self, path: Path) -> None:
        _assert_tokens_native_core_subprocess_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        CARET_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_caret_examples_match_python_via_subprocess(self, path: Path) -> None:
        _assert_tokens_native_core_subprocess_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        DOLLAR_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_dollar_examples_match_python_via_subprocess(self, path: Path) -> None:
        _assert_tokens_native_core_subprocess_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        SEMICOLON_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_semicolon_examples_match_python_via_subprocess(self, path: Path) -> None:
        _assert_tokens_native_core_subprocess_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        AT_FORM_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_at_form_examples_match_python_via_subprocess(self, path: Path) -> None:
        _assert_tokens_native_core_subprocess_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        PERCENT_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_percent_examples_match_python_direct(self, path: Path) -> None:
        _assert_tokens_native_core_direct_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        UTF8_STRING_TOKEN_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_utf8_string_examples_match_python_direct(self, path: Path) -> None:
        _assert_tokens_native_core_direct_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        LAST_MILE_NATIVE_LEXER_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_last_mile_examples_match_python_direct(self, path: Path) -> None:
        _assert_tokens_native_core_direct_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_tokens_native_core_all_real_examples_match_python_direct(self) -> None:
        for path in ALL_EXAMPLE_VKF_FILES:
            _assert_tokens_native_core_direct_matches_python(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        LAST_MILE_NATIVE_LEXER_PARITY_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_tokens_native_core_last_mile_examples_file_and_stdin_match(self, path: Path) -> None:
        _assert_tokens_native_core_file_and_stdin_match(path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        EXPANDED_NATIVE_FRONTEND_PARSE_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_parse_native_core_expanded_examples_match_python_parser(
        self, capsys: pytest.CaptureFixture[str], path: Path
    ) -> None:
        assert main(["parse-native-core", str(path)]) == 0
        assert capsys.readouterr().out.strip() == repr(
            parse_module(path.read_text(encoding="utf-8"), filename=path.as_posix())
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "path",
        EXPANDED_NATIVE_FRONTEND_PARSE_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_parse_native_core_expanded_examples_stdin_matches_file_output(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        path: Path,
    ) -> None:
        src = path.read_text(encoding="utf-8")

        assert main(["parse-native-core", str(path)]) == 0
        file_output = capsys.readouterr().out.strip()

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["parse-native-core", "-"]) == 0
        stdin_output = capsys.readouterr().out.strip()

        assert stdin_output == file_output

    @pytest.mark.parametrize("payload, expected", MALFORMED_TOKEN_ENTRY_CASES)
    def test_parse_tokens_subcommand_malformed_token_entry(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, payload: dict[str, object], expected: str
    ) -> None:
        _ = capsys.readouterr()
        assert_cli_rejects_token_stream_object(tmp_path, payload, expected)

    def test_cpp_subcommand_stdout(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        src = tmp_path / "native_scalar.vkf"
        src.write_text(
            "twice(x:num) -> num:\n"
            "    x * 2\n\n"
            "num a: 3\n"
            ":: twice(a)\n",
            encoding="utf-8",
        )
        assert main(["cpp", str(src)]) == 0
        out = capsys.readouterr().out
        assert "double twice(double x)" in out
        assert 'std::cout << vf_format_num(twice(a)) << "\\n";' in out

    def test_cpp_subcommand_output_file(self, tmp_path: Path) -> None:
        src = tmp_path / "native_vec.vkf"
        out = tmp_path / "native_vec.cpp"
        src.write_text(
            "[num:2] a: [1,2]\n"
            "[num:2] b: [3,4]\n"
            ":: a + b\n",
            encoding="utf-8",
        )
        assert main(["cpp", str(src), "-o", str(out)]) == 0
        emitted = out.read_text(encoding="utf-8")
        assert "std::array<double, 2> a" in emitted
        assert "for (std::size_t vf_i = 0; vf_i < 2; ++vf_i)" in emitted

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", NON_SCENE_NATIVE_CORE_EXAMPLES)
    def test_cpp_native_core_examples_match_backend_emitter(
        self, tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_cpp_contract(tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_A)
    def test_cpp_native_core_scene_examples_match_backend_emitter_batch_a(
        self, tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_cpp_contract(tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_B)
    def test_cpp_native_core_scene_examples_match_backend_emitter_batch_b(
        self, tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_cpp_contract(tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_C)
    def test_cpp_native_core_scene_examples_match_backend_emitter_batch_c(
        self, tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_cpp_contract(tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_D)
    def test_cpp_native_core_scene_examples_match_backend_emitter_batch_d(
        self, tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_cpp_contract(tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_cpp_native_core_expanded_examples_match_backend_emitter(
        self, tmp_path: Path, src: Path
    ) -> None:
        out = tmp_path / src.with_suffix(".cpp").name

        assert main(["cpp-native-core", str(src), "-o", str(out)]) == 0

        assert out.read_text(encoding="utf-8") == emit_cpp_from_source_file(src)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_cpp_native_core_subcommand_stdin_matches_file_output(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        src_path = NATIVE_CORE / "hello_native.vkf"
        src = src_path.read_text(encoding="utf-8")
        out = tmp_path / "stdin_native_core.cpp"

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["cpp-native-core", "-", "-o", str(out)]) == 0

        emitted = out.read_text(encoding="utf-8")
        standard = emit_cpp_from_source_file(src_path)
        standard_exe = compile_cpp_source(standard, tmp_path / "standard", exe_name="hello_native_stdin_standard")
        native_exe = compile_cpp_source(emitted, tmp_path / "native", exe_name="hello_native_stdin_native")
        standard_proc = subprocess.run([str(standard_exe)], capture_output=True, text=True)
        native_proc = subprocess.run([str(native_exe)], capture_output=True, text=True)
        assert standard_proc.returncode == 0
        assert native_proc.returncode == 0
        assert native_proc.stdout == standard_proc.stdout

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src_path",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_cpp_native_core_expanded_examples_stdin_matches_file_output(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, src_path: Path
    ) -> None:
        src = src_path.read_text(encoding="utf-8")
        file_out = tmp_path / f"{src_path.stem}_file.cpp"
        stdin_out = tmp_path / f"{src_path.stem}_stdin.cpp"

        assert main(["cpp-native-core", str(src_path), "-o", str(file_out)]) == 0

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["cpp-native-core", "-", "-o", str(stdin_out)]) == 0

        assert stdin_out.read_text(encoding="utf-8") == file_out.read_text(encoding="utf-8")

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_build_subcommand_creates_executable(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        src = tmp_path / "native_build.vkf"
        exe = tmp_path / "native_build.exe"
        src.write_text(
            "twice(x:num) -> num:\n"
            "    x * 2\n\n"
            ":: twice(21)\n",
            encoding="utf-8",
        )
        assert main(["build", str(src), "-o", str(exe)]) == 0
        reported = capsys.readouterr().out.strip()
        assert Path(reported) == exe.resolve()
        assert exe.is_file()
        proc = subprocess.run([str(exe)], capture_output=True, text=True)
        assert proc.returncode == 0
        assert proc.stdout.strip() == "42"

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name, expected_line", NON_SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES)
    def test_build_native_core_examples(self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str) -> None:
        _assert_native_core_build_first_line(capsys, tmp_path, example_name, expected_line)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name, expected_line", SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_A)
    def test_build_native_core_scene_examples_batch_a(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str
    ) -> None:
        _assert_native_core_build_first_line(capsys, tmp_path, example_name, expected_line)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name, expected_line", SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_B)
    def test_build_native_core_scene_examples_batch_b(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str
    ) -> None:
        _assert_native_core_build_first_line(capsys, tmp_path, example_name, expected_line)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name, expected_line", SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_C)
    def test_build_native_core_scene_examples_batch_c(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str
    ) -> None:
        _assert_native_core_build_first_line(capsys, tmp_path, example_name, expected_line)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name, expected_line", SCENE_NATIVE_CORE_EXPECTED_FIRST_LINES_BATCH_D)
    def test_build_native_core_scene_examples_batch_d(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str, expected_line: str
    ) -> None:
        _assert_native_core_build_first_line(capsys, tmp_path, example_name, expected_line)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", NON_SCENE_NATIVE_CORE_EXAMPLES)
    def test_build_native_core_examples_match_directly_compiled_cpp(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_build_matches_direct_cpp(capsys, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_A)
    def test_build_native_core_scene_examples_match_directly_compiled_cpp_batch_a(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_build_matches_direct_cpp(capsys, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_B)
    def test_build_native_core_scene_examples_match_directly_compiled_cpp_batch_b(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_build_matches_direct_cpp(capsys, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_C)
    def test_build_native_core_scene_examples_match_directly_compiled_cpp_batch_c(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_build_matches_direct_cpp(capsys, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", SCENE_NATIVE_CORE_BATCH_D)
    def test_build_native_core_scene_examples_match_directly_compiled_cpp_batch_d(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, example_name: str
    ) -> None:
        _assert_native_core_build_matches_direct_cpp(capsys, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_build_native_core_expanded_examples_match_directly_compiled_cpp(
        self, capsys: pytest.CaptureFixture[str], tmp_path: Path, src: Path
    ) -> None:
        cpp_out = tmp_path / src.with_suffix(".cpp").name
        built_exe = tmp_path / src.with_suffix(".exe").name

        assert main(["cpp-native-core", str(src), "-o", str(cpp_out)]) == 0
        emitted = cpp_out.read_text(encoding="utf-8")

        manual_exe = compile_cpp_source(
            emitted,
            tmp_path / f"{src.stem}_expanded_manual_cpp",
            exe_name=f"{src.stem}_expanded_manual",
        )
        manual_proc = run_cpp_executable(manual_exe)
        assert manual_proc.returncode == 0

        assert main(["build-native-core", str(src), "-o", str(built_exe)]) == 0
        reported = capsys.readouterr().out.strip()
        assert Path(reported) == built_exe.resolve()

        built_proc = run_cpp_executable(built_exe)
        assert built_proc.returncode == 0
        assert built_proc.stdout == manual_proc.stdout

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_build_native_core_subcommand_stdin_requires_output_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("sys.stdin.read", lambda: ":: 6 * 7\n")
        assert main(["build-native-core", "-"]) == 1

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_package_native_core_subcommand_requires_output_directory(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("sys.stdin.read", lambda: ":: 6 * 7\n")
        assert main(["package-native-core", "-"]) == 1

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_package_subcommand_requires_output_directory(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("sys.stdin.read", lambda: ":: 6 * 7\n")
        assert main(["package", "-"]) == 1

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "src_path",
        EXPANDED_NATIVE_FRONTEND_BUILD_EXAMPLES,
        ids=lambda path: path.relative_to(ROOT).as_posix(),
    )
    def test_build_native_core_expanded_examples_stdin_matches_file_output(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        tmp_path: Path,
        src_path: Path,
    ) -> None:
        src = src_path.read_text(encoding="utf-8")
        file_exe = tmp_path / f"{src_path.stem}_file.exe"
        stdin_exe = tmp_path / f"{src_path.stem}_stdin.exe"

        assert main(["build-native-core", str(src_path), "-o", str(file_exe)]) == 0
        file_reported = capsys.readouterr().out.strip()
        assert Path(file_reported) == file_exe.resolve()
        file_proc = run_cpp_executable(file_exe)
        assert file_proc.returncode == 0

        monkeypatch.setattr("sys.stdin.read", lambda: src)
        assert main(["build-native-core", "-", "-o", str(stdin_exe)]) == 0
        stdin_reported = capsys.readouterr().out.strip()
        assert Path(stdin_reported) == stdin_exe.resolve()
        stdin_proc = run_cpp_executable(stdin_exe)
        assert stdin_proc.returncode == 0

        assert stdin_proc.stdout == file_proc.stdout

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", NATIVE_CORE_EXECUTION_CONTRACT_EXAMPLES)
    def test_native_core_execution_contract_examples_preserve_parse_and_build_runtime(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        tmp_path: Path,
        example_name: str,
    ) -> None:
        _assert_parse_and_build_native_core_execution_contract(
            monkeypatch,
            capsys,
            tmp_path,
            example_name,
        )

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize("example_name", NATIVE_CORE_EXECUTION_CONTRACT_EXAMPLES)
    def test_native_core_execution_contract_examples_preserve_cpp_runtime_for_file_and_stdin(
        self,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
        example_name: str,
    ) -> None:
        _assert_cpp_native_core_execution_contract(monkeypatch, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    @pytest.mark.parametrize(
        "example_name",
        [
            "numeric_native.vkf",
            "named_record_scene_splice_native.vkf",
            "named_record_scene_reverse_native.vkf",
        ],
    )
    def test_package_native_core_examples_create_runnable_native_package(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        tmp_path: Path,
        example_name: str,
    ) -> None:
        _assert_package_native_core_contract(monkeypatch, capsys, tmp_path, example_name)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_package_supported_native_subcommand_creates_runnable_native_package(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        tmp_path: Path,
    ) -> None:
        _assert_package_supported_native_contract(monkeypatch, capsys, tmp_path)

    @pytest.mark.skipif(discover_cpp_compiler() is None, reason="no C++ compiler available on PATH")
    def test_package_supported_native_benchmark_example_matches_build_runtime(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
        tmp_path: Path,
    ) -> None:
        _assert_package_supported_native_example_contract(
            monkeypatch,
            capsys,
            tmp_path,
            ROOT / "examples" / "benchmarks" / "scalar_control.vkf",
        )

    def test_bench_subcommand_list(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "--list"]) == 0
        out = capsys.readouterr().out
        assert "scalar_control" in out
        assert "custom_overloads" in out
        assert "vector_large_elementwise" in out

    def test_bench_subcommand_single_case(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control"]) == 0
        out = capsys.readouterr().out
        assert "scalar_control" in out
        assert "summary:" in out

    def test_bench_subcommand_list_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "--list", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"scalar_control"' in out
        assert '"native_supported"' in out

    def test_bench_subcommand_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"summary"' in out
        assert '"results"' in out
        assert '"scalar_control"' in out
        assert '"python_ref_ms"' in out

    def test_bench_subcommand_samples(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--samples", "2"]) == 0
        out = capsys.readouterr().out
        assert "timings: median of 2 sample(s), native run median over 1 internal execution(s) after 0 warmup run(s), units=ms" in out

    def test_bench_subcommand_samples_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--samples", "2", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"sample_count": 2' in out
        assert '"aggregation": "median"' in out

    def test_bench_subcommand_native_runs(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--native-runs", "2"]) == 0
        out = capsys.readouterr().out
        assert "native run median over 2 internal execution(s) after 1 warmup run(s)" in out

    def test_bench_subcommand_native_runs_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--native-runs", "2", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"native_run_count": 2' in out

    def test_bench_subcommand_native_warmups_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["bench", "scalar_control", "--native-runs", "2", "--native-warmups", "0", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"native_warmup_count": 0' in out

    def test_bench_subcommand_save_baseline(self, tmp_path: Path) -> None:
        baseline = tmp_path / "baseline.json"
        assert main(["bench", "scalar_control", "--save-baseline", str(baseline), "--json"]) == 0
        assert baseline.is_file()
        assert '"summary"' in baseline.read_text(encoding="utf-8")

    def test_bench_subcommand_compare_baseline(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        baseline = tmp_path / "baseline.json"
        assert main(["bench", "scalar_control", "--save-baseline", str(baseline), "--json"]) == 0
        _ = capsys.readouterr()
        assert main(["bench", "scalar_control", "--compare-baseline", str(baseline)]) == 0
        out = capsys.readouterr().out
        assert "baseline deltas:" in out

    def test_bench_subcommand_compare_baseline_json(self, capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
        baseline = tmp_path / "baseline.json"
        assert main(["bench", "scalar_control", "--save-baseline", str(baseline), "--json"]) == 0
        _ = capsys.readouterr()
        assert main(["bench", "scalar_control", "--compare-baseline", str(baseline), "--json"]) == 0
        out = capsys.readouterr().out
        assert '"baseline_comparison"' in out
