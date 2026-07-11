from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from vektorflow.parser import parse_module
from vektorflow.interpreter import Interpreter


ROOT = Path(__file__).resolve().parent.parent
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_compiler_artifact_smoke.cpp"
DRIVER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_driver_artifact_smoke.cpp"
WASM_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_wasm_artifact_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"
STDLIB_SOURCE = ROOT / "compiler" / "self_hosted" / "stdlib.vkf"
MATH_FIXTURE = ROOT / "compiler" / "self_hosted" / "stdlib" / "math.vkf"
IO_FIXTURE = ROOT / "compiler" / "self_hosted" / "stdlib" / "io.vkf"
PHYSICS_FIXTURE = ROOT / "compiler" / "self_hosted" / "stdlib" / "physics.vkf"
PHYSICS_SMOKE = ROOT / "compiler" / "self_hosted" / "stdlib" / "physics_collision_matrix_smoke.vkf"


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


@pytest.fixture(scope="module")
def smoke_exes(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    tmp_path = tmp_path_factory.mktemp("stdlib_smokes")
    return {
        "lexer": _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe"),
        "parser": _compile_or_skip([PARSER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_parser_token_stream_smoke.exe"),
        "ir": _compile_or_skip([AST_TO_IR_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_ast_to_ir_smoke.exe"),
        "artifact": _compile_or_skip([ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_compiler_artifact_smoke.exe"),
        "wasm_artifact": _compile_or_skip([WASM_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_wasm_artifact_smoke.exe"),
        "driver": _compile_or_skip([DRIVER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_driver_artifact_smoke.exe"),
    }


def _run_driver(source_path: Path, smoke_exes: dict[str, Path]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--source",
            str(source_path),
            "--lexer",
            str(smoke_exes["lexer"]),
            "--parser",
            str(smoke_exes["parser"]),
            "--ir",
            str(smoke_exes["ir"]),
            "--artifact",
            str(smoke_exes["artifact"]),
            "--run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def _run_driver_wasm(source_path: Path, smoke_exes: dict[str, Path]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--source",
            str(source_path),
            "--lexer",
            str(smoke_exes["lexer"]),
            "--parser",
            str(smoke_exes["parser"]),
            "--ir",
            str(smoke_exes["ir"]),
            "--artifact",
            str(smoke_exes["artifact"]),
            "--wasm-artifact",
            str(smoke_exes["wasm_artifact"]),
            "--emit-wasm",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def test_stdlib_source_parses_and_names_dependency_contract() -> None:
    source = STDLIB_SOURCE.read_text(encoding="utf-8")

    module = parse_module(source, filename=STDLIB_SOURCE.as_posix())
    rendered = repr(module)

    assert "self_hosted_stdlib_seed" in rendered
    assert "math.pi" in rendered
    assert "math.tau" in rendered
    assert "io.print" in rendered
    assert "bare print remains compatibility alias for io.print" in rendered
    assert "manifest records dependencies with name path sha256" in rendered


def test_physics_stdlib_source_parses_and_names_collision_matrix_contract() -> None:
    source = PHYSICS_FIXTURE.read_text(encoding="utf-8")

    module = parse_module(source, filename=PHYSICS_FIXTURE.as_posix())
    rendered = repr(module)

    assert "physics_collision_matrix_seed" in rendered
    assert "collision_matrix3" in rendered
    assert "normal_restitution_impulse3" in rendered
    assert "M_pp maps linear impulse to contact relative linear velocity" in rendered
    assert "position and velocity updates can live in the runtime variable ledger" in rendered


def test_physics_stdlib_smoke_runs_collision_matrix_and_restitution(capsys: pytest.CaptureFixture[str]) -> None:
    source = PHYSICS_SMOKE.read_text(encoding="utf-8")

    module = parse_module(source, filename=PHYSICS_SMOKE.as_posix())
    Interpreter(file_path=PHYSICS_SMOKE).run_module(module)

    assert capsys.readouterr().out.splitlines() == ["0.8333333333333333", "10.8"]


def test_touched_native_sources_have_no_host_fallback_hooks() -> None:
    sources = [
        AST_TO_IR_SMOKE_SOURCE.read_text(encoding="utf-8"),
        ARTIFACT_SMOKE_SOURCE.read_text(encoding="utf-8"),
        DRIVER_SMOKE_SOURCE.read_text(encoding="utf-8"),
    ]
    forbidden_markers = ["Python.h", "Py_Initialize", "python.exe", "system(", "popen("]

    for source in sources:
        for marker in forbidden_markers:
            assert marker not in source


def test_driver_prints_math_pi_and_records_dependency(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "math_pi.vkf"
    source_path.write_text("print(math.pi)", encoding="utf-8")

    first = json.loads(_run_driver(source_path, smoke_exes).stdout)
    assert first["status"] == "compiled"
    assert first["stdout"].strip().startswith("3.14159")

    manifest = json.loads(Path(first["manifest_path"]).read_text(encoding="utf-8"))
    deps = {dependency["name"]: dependency for dependency in manifest["dependencies"]}
    assert deps["math"]["path"] == str(MATH_FIXTURE.resolve())
    assert deps["io"]["path"] == str(IO_FIXTURE.resolve())
    assert len(deps["math"]["sha256"]) == 16
    assert len(deps["io"]["sha256"]) == 16

    second = json.loads(_run_driver(source_path, smoke_exes).stdout)
    assert second["status"] == "current"
    assert second["stdout"].strip().startswith("3.14159")


def test_driver_prints_explicit_io_print_string(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "io_print.vkf"
    source_path.write_text('io.print("hello")', encoding="utf-8")

    result = json.loads(_run_driver(source_path, smoke_exes).stdout)

    assert result["status"] == "compiled"
    assert result["stdout"].strip() == "hello"
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["dependencies"] == [
        {
            "name": "io",
            "path": str(IO_FIXTURE.resolve()),
            "sha256": manifest["dependencies"][0]["sha256"],
        }
    ]


def test_driver_prints_explicit_io_print_load(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "io_print_load.vkf"
    source_path.write_text('value: "Ada"\nio.print(value)', encoding="utf-8")

    result = json.loads(_run_driver(source_path, smoke_exes).stdout)

    assert result["status"] == "compiled"
    assert result["stdout"].strip() == "Ada"


def test_driver_prints_io_math_and_records_both_dependencies(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "io_math.vkf"
    source_path.write_text("io.print(math.pi)", encoding="utf-8")

    first = json.loads(_run_driver(source_path, smoke_exes).stdout)
    assert first["status"] == "compiled"
    assert first["stdout"].strip().startswith("3.14159")

    manifest = json.loads(Path(first["manifest_path"]).read_text(encoding="utf-8"))
    deps = {dependency["name"]: dependency for dependency in manifest["dependencies"]}
    assert deps["math"]["path"] == str(MATH_FIXTURE.resolve())
    assert deps["io"]["path"] == str(IO_FIXTURE.resolve())

    second = json.loads(_run_driver(source_path, smoke_exes).stdout)
    assert second["status"] == "current"
    assert second["stdout"].strip().startswith("3.14159")


def test_driver_prints_bound_math_tau(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "math_tau.vkf"
    source_path.write_text("value: math.tau\nprint(value)", encoding="utf-8")

    result = json.loads(_run_driver(source_path, smoke_exes).stdout)

    assert result["status"] == "compiled"
    assert result["stdout"].strip().startswith("6.28318")


def test_driver_can_emit_wasm_for_bound_math_tau(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "math_tau_wasm.vkf"
    source_path.write_text("value: math.tau", encoding="utf-8")

    result = json.loads(_run_driver_wasm(source_path, smoke_exes).stdout)
    wasm_artifact_path = Path(result["wasm_artifact_path"])

    assert result["wasm_status"] == "compiled"
    assert wasm_artifact_path.is_file()
    assert wasm_artifact_path.read_bytes()[:4] == b"\x00asm"


def test_editing_math_fixture_rebuilds_dependency_consumer(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "math_dependency.vkf"
    source_path.write_text("print(math.pi)", encoding="utf-8")
    original = MATH_FIXTURE.read_text(encoding="utf-8")

    try:
        assert json.loads(_run_driver(source_path, smoke_exes).stdout)["status"] == "compiled"
        assert json.loads(_run_driver(source_path, smoke_exes).stdout)["status"] == "current"

        MATH_FIXTURE.write_text(original + "\n# dependency hash probe\n", encoding="utf-8")
        changed = json.loads(_run_driver(source_path, smoke_exes).stdout)

        assert changed["status"] == "compiled"
    finally:
        MATH_FIXTURE.write_text(original, encoding="utf-8")


def test_editing_io_fixture_rebuilds_dependency_consumer(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "io_dependency.vkf"
    source_path.write_text('io.print("hello")', encoding="utf-8")
    original = IO_FIXTURE.read_text(encoding="utf-8")

    try:
        assert json.loads(_run_driver(source_path, smoke_exes).stdout)["status"] == "compiled"
        assert json.loads(_run_driver(source_path, smoke_exes).stdout)["status"] == "current"

        IO_FIXTURE.write_text(original + "\n# dependency hash probe\n", encoding="utf-8")
        changed = json.loads(_run_driver(source_path, smoke_exes).stdout)

        assert changed["status"] == "compiled"
    finally:
        IO_FIXTURE.write_text(original, encoding="utf-8")


def test_unknown_math_member_fails_hard_without_fallback(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "math_unknown.vkf"
    source_path.write_text("print(math.unknown)", encoding="utf-8")

    proc = subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--source",
            str(source_path),
            "--lexer",
            str(smoke_exes["lexer"]),
            "--parser",
            str(smoke_exes["parser"]),
            "--ir",
            str(smoke_exes["ir"]),
            "--artifact",
            str(smoke_exes["artifact"]),
            "--run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "unknown stdlib math member unknown" in proc.stderr
    assert "fallback" not in proc.stderr.lower()
    assert not (tmp_path / ".vkfbuild" / "math_unknown" / "manifest.json").exists()


def test_unknown_io_member_fails_hard_without_fallback(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "io_unknown.vkf"
    source_path.write_text('io.unknown("x")', encoding="utf-8")

    proc = subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--source",
            str(source_path),
            "--lexer",
            str(smoke_exes["lexer"]),
            "--parser",
            str(smoke_exes["parser"]),
            "--ir",
            str(smoke_exes["ir"]),
            "--artifact",
            str(smoke_exes["artifact"]),
            "--run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "unknown stdlib io member unknown" in proc.stderr
    assert "fallback" not in proc.stderr.lower()
    assert not (tmp_path / ".vkfbuild" / "io_unknown" / "manifest.json").exists()
