from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import pytest

from vektorflow.compiler_bootstrap import compiler_bootstrap_sources
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_compiler_artifact_smoke.cpp"
CPP_AOT_SOURCE = ROOT / "compiler" / "native" / "vkf_cpp_aot_artifact.cpp"
X64_ARTIFACT_SOURCE = ROOT / "compiler" / "native" / "vkf_x64_artifact.cpp"
X64_RUNNER_SOURCE = ROOT / "compiler" / "native" / "vkf_x64_runner_template.cpp"
ARM64_ARTIFACT_SOURCE = ROOT / "compiler" / "native" / "vkf_arm64_artifact.cpp"
WASM_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_wasm_artifact_smoke.cpp"
WEBGPU_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_webgpu_artifact_smoke.cpp"
DRIVER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_driver_artifact_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"
COMPILER_SOURCE = ROOT / "compiler" / "self_hosted" / "compiler.vkf"
COMPILED_RUNTIME_BRIDGE_SOURCE = ROOT / "web" / "vf-ui" / "vf-compiled-runtime-bridge.js"


def _compiler_command(
    sources: list[Path],
    output: Path,
    definitions: tuple[str, ...] = (),
    linker_args: tuple[str, ...] = (),
) -> list[str] | None:
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
                *[f"-D{definition}" for definition in definitions],
                *[str(source) for source in sources],
                *linker_args,
                "-o",
                str(output),
            ]

    cl = shutil.which("cl")
    if cl is not None:
        cl_linker_args = tuple(value for index, value in enumerate(linker_args) if index % 2 == 1)
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{ROOT}",
            f"/I{ROOT / 'native' / 'VfOverlay'}",
            *[f"/D{definition}" for definition in definitions],
            *[str(source) for source in sources],
            f"/Fe:{output}",
            *(["/link", *cl_linker_args] if cl_linker_args else []),
        ]

    return None


def _compile_or_skip(
    sources: list[Path],
    output: Path,
    definitions: tuple[str, ...] = (),
    linker_args: tuple[str, ...] = (),
) -> Path:
    command = _compiler_command(sources, output, definitions, linker_args)
    if command is None:
        pytest.skip("no C++ compiler found")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


@pytest.fixture(scope="module")
def smoke_exes(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    tmp_path = tmp_path_factory.mktemp("artifact_smokes")
    return {
        "lexer": _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe"),
        "parser": _compile_or_skip([PARSER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_parser_token_stream_smoke.exe"),
        "ir": _compile_or_skip([AST_TO_IR_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_ast_to_ir_smoke.exe"),
        "artifact": _compile_or_skip([ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_compiler_artifact_smoke.exe"),
        "cpp_aot": _compile_or_skip([CPP_AOT_SOURCE, JSON_SOURCE], tmp_path / "vkf_cpp_aot_artifact.exe"),
        "x64_artifact": _compile_or_skip([X64_ARTIFACT_SOURCE, JSON_SOURCE], tmp_path / "vkf_x64_artifact.exe"),
        "arm64_artifact": _compile_or_skip([ARM64_ARTIFACT_SOURCE, JSON_SOURCE], tmp_path / "vkf_arm64_artifact.exe"),
        "x64_template": _compile_or_skip(
            [X64_RUNNER_SOURCE],
            tmp_path / "vkf_x64_runner_template.exe",
            linker_args=(
                "-Xlinker", "/nodefaultlib",
                "-Xlinker", "legacy_stdio_definitions.lib",
                "-Xlinker", "legacy_stdio_wide_specifiers.lib",
                "-Xlinker", "ucrt.lib",
                "-Xlinker", "kernel32.lib",
            ),
        ),
        "wasm_artifact": _compile_or_skip([WASM_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_wasm_artifact_smoke.exe"),
        "webgpu_artifact": _compile_or_skip([WEBGPU_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_webgpu_artifact_smoke.exe"),
        "driver": _compile_or_skip(
            [
                DRIVER_SMOKE_SOURCE,
                X64_ARTIFACT_SOURCE,
                LEXER_SMOKE_SOURCE,
                PARSER_SMOKE_SOURCE,
                AST_TO_IR_SMOKE_SOURCE,
                JSON_SOURCE,
            ],
            tmp_path / "vkf_driver_artifact_smoke.exe",
            ("VKF_X64_BACKEND_LIBRARY", "VKF_NATIVE_FRONTEND_LIBRARY"),
        ),
    }


def _run(exe: Path, input_text: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe)],
        cwd=ROOT,
        input=input_text,
        capture_output=True,
        encoding="utf-8",
        check=True,
    )


def _typed_ir_json(source: str, exes: dict[str, Path]) -> str:
    tokens = subprocess.run(
        [str(exes["lexer"]), source, "<artifact-pipeline>"],
        cwd=ROOT,
        capture_output=True,
        encoding="utf-8",
        check=True,
    ).stdout
    ast_json = _run(exes["parser"], tokens).stdout
    return _run(exes["ir"], ast_json).stdout


def _typed_ir_json_for_file(source_path: Path, exes: dict[str, Path]) -> str:
    try:
        source_label = source_path.relative_to(ROOT).as_posix()
    except ValueError:
        source_label = source_path.as_posix()
    tokens = subprocess.run(
        [str(exes["lexer"]), "--file", str(source_path), source_label],
        cwd=ROOT,
        capture_output=True,
        encoding="utf-8",
        check=True,
    ).stdout
    ast_json = _run(exes["parser"], tokens).stdout
    return _run(exes["ir"], ast_json).stdout


def _run_artifact(exe: Path, source_path: Path, typed_ir_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def _run_wasm_artifact(exe: Path, source_path: Path, typed_ir_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def _run_webgpu_artifact(exe: Path, source_path: Path, typed_ir_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def _node_or_skip() -> str:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not found")
    return node


def _run_node(script: str, *args: str) -> subprocess.CompletedProcess[str]:
    node = _node_or_skip()
    return subprocess.run(
        [node, "-e", script, *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def _run_cmd_artifact(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["cmd", "/c", str(path)],
        cwd=path.parent,
        capture_output=True,
        text=True,
        check=True,
    )


def _run_driver(
    source_path: Path,
    smoke_exes: dict[str, Path],
    *,
    run: bool = False,
    aot: bool = False,
) -> subprocess.CompletedProcess[str]:
    args = [
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
    ]
    if run:
        args.append("--run")
    if aot:
        args.append("--aot")
    proc = subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return proc


def test_compiler_source_parses_and_names_manifest_artifact_ownership() -> None:
    source = COMPILER_SOURCE.read_text(encoding="utf-8")

    module = parse_module(source, filename=COMPILER_SOURCE.as_posix())
    rendered = repr(module)

    assert "self_hosted_compiler_artifact_seed" in rendered
    assert "vkf_compiler_artifact_smoke" in rendered
    assert "manifest.json" in rendered
    assert "native smoke owns build directory" in rendered
    assert "artifact script prints supported const and load values" in rendered
    assert "artifact_content_sha256" in rendered
    assert "vkf_driver_artifact_smoke" in rendered
    assert "vkf <file> compile/run orchestration" in rendered
    assert "bootstrap manifest is the last Python-parser boundary" in rendered
    assert "native bootstrap bundle lexer smoke tokenizes declared compiler bundle without Python runtime help" in rendered
    assert "compiled compiler takes declared compiler bundle instead of rediscovering files ad hoc" in rendered


def test_artifact_and_driver_sources_have_no_host_fallback_hooks() -> None:
    sources = [
        ARTIFACT_SMOKE_SOURCE.read_text(encoding="utf-8"),
        WASM_ARTIFACT_SMOKE_SOURCE.read_text(encoding="utf-8"),
        WEBGPU_ARTIFACT_SMOKE_SOURCE.read_text(encoding="utf-8"),
        DRIVER_SMOKE_SOURCE.read_text(encoding="utf-8"),
    ]

    forbidden_markers = [
        "Python.h",
        "Py_Initialize",
        "python.exe",
        "system(",
        "popen(",
    ]

    for source in sources:
        for marker in forbidden_markers:
            assert marker not in source


def test_wasm_artifact_smoke_emits_real_module_for_numeric_const(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "answer.vkf"
    typed_ir_path = tmp_path / "answer.typed-ir.json"
    source_path.write_text("answer: 42", encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json("answer: 42", smoke_exes), encoding="utf-8")

    first = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(first["artifact_path"])
    manifest_path = Path(first["manifest_path"])
    assert first["artifact_kind"] == "wasm"
    assert first["status"] == "compiled"
    assert artifact_path.is_file()
    assert manifest_path.is_file()
    assert artifact_path.read_bytes()[:4] == b"\x00asm"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["state_size"] == 8
    assert manifest["runtime_surface"]["input_offset"] == 8
    assert manifest["runtime_surface"]["input_size"] == 4
    assert manifest["runtime_surface"]["input_ptr_export"] == "vkf_input_ptr"
    assert manifest["runtime_surface"]["bindings"] == [
        {"name": "answer", "kind": "i32", "value_export": "vkf_get_answer"}
    ]

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
if (typeof inst.exports.vkf_init !== "function") throw new Error("missing vkf_init");
if (typeof inst.exports.vkf_update !== "function") throw new Error("missing vkf_update");
if (typeof inst.exports.vkf_shutdown !== "function") throw new Error("missing vkf_shutdown");
if (typeof inst.exports.vkf_state_ptr !== "function") throw new Error("missing vkf_state_ptr");
if (typeof inst.exports.vkf_state_size !== "function") throw new Error("missing vkf_state_size");
if (typeof inst.exports.vkf_input_ptr !== "function") throw new Error("missing vkf_input_ptr");
if (typeof inst.exports.vkf_input_size !== "function") throw new Error("missing vkf_input_size");
if (typeof inst.exports.vkf_get_answer !== "function") throw new Error("missing vkf_get_answer");
inst.exports.vkf_init();
const inputPtr = inst.exports.vkf_input_ptr();
const inputSize = inst.exports.vkf_input_size();
if (inputSize !== 4) throw new Error("unexpected input size");
const memory = new DataView(inst.exports.memory.buffer);
memory.setInt32(inputPtr, 7, true);
inst.exports.vkf_update();
inst.exports.vkf_update();
const statePtr = inst.exports.vkf_state_ptr();
const tick = memory.getInt32(statePtr, true);
const wheelAccum = memory.getInt32(statePtr + 4, true);
const size = inst.exports.vkf_state_size();
process.stdout.write(JSON.stringify({ answer: inst.exports.vkf_get_answer(), tick, wheelAccum, size, inputSize }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload["answer"] == 42
    assert payload["tick"] == 2
    assert payload["wheelAccum"] == 14
    assert payload["size"] >= 8
    assert payload["inputSize"] == 4

    second = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    assert second["status"] == "current"


def test_wasm_artifact_smoke_emits_memory_backed_string_exports(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "name.vkf"
    typed_ir_path = tmp_path / "name.typed-ir.json"
    source_path.write_text('name: "Ada"', encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json('name: "Ada"', smoke_exes), encoding="utf-8")

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["bindings"] == [
        {"name": "name", "kind": "string", "ptr_export": "vkf_get_name_ptr", "len_export": "vkf_get_name_len"}
    ]

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
const mem = new Uint8Array(inst.exports.memory.buffer);
const ptr = inst.exports.vkf_get_name_ptr();
const len = inst.exports.vkf_get_name_len();
const size = inst.exports.vkf_state_size();
const inputSize = inst.exports.vkf_input_size();
process.stdout.write(JSON.stringify({ text: Buffer.from(mem.slice(ptr, ptr + len)).toString("utf8"), ptr, len, size, inputSize }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload["text"] == "Ada"
    assert payload["ptr"] >= 12
    assert payload["len"] == 3
    assert payload["size"] == 8
    assert payload["inputSize"] == 4


def test_wasm_artifact_smoke_emits_memory_backed_axis_vector_exports(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "axis_vec.vkf"
    typed_ir_path = tmp_path / "axis_vec.typed-ir.json"
    source = "u: [-1, 0, 1] -> u"
    source_path.write_text(source, encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source, smoke_exes), encoding="utf-8")

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["bindings"] == [
        {
            "name": "u",
            "kind": "axis_i32_array",
            "axis_key": "u",
            "ptr_export": "vkf_get_u_ptr",
            "len_export": "vkf_get_u_len",
        }
    ]

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
const mem = new DataView(inst.exports.memory.buffer);
const ptr = inst.exports.vkf_get_u_ptr();
const len = inst.exports.vkf_get_u_len();
const values = [];
for (let i = 0; i < len; i += 1) values.push(mem.getInt32(ptr + i * 4, true));
process.stdout.write(JSON.stringify({ ptr, len, values }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload["len"] == 3
    assert payload["values"] == [-1, 0, 1]


def test_wasm_artifact_smoke_emits_computed_axis_f64_vector_exports(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_wave.vkf"
    typed_ir_path = tmp_path / "axis_wave.typed-ir.json"
    source_path.write_text("axis wave", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.0},
                                    {"kind": "const", "type": "num", "value": 1.5707963267948966},
                                    {"kind": "const", "type": "num", "value": 3.141592653589793},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "call",
                            "type": "axis<u>:list<num>",
                            "callee": {
                                "kind": "field_access",
                                "field": "sin",
                                "type": "any",
                                "object": {"kind": "load", "name": "math", "type": "any"},
                                "object_type": "any",
                            },
                            "callee_type": "any",
                            "arg_types": ["axis<u>:list<num>"],
                            "args": [{"kind": "load", "name": "theta", "type": "axis<u>:list<num>"}],
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "scaled_wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "binary_op",
                            "op": "STAR",
                            "type": "axis<u>:list<num>",
                            "left": {"kind": "const", "type": "num", "value": 0.5},
                            "right": {"kind": "load", "name": "wave", "type": "axis<u>:list<num>"},
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["bindings"] == [
        {"name": "theta", "kind": "axis_f64_array", "axis_key": "u", "ptr_export": "vkf_get_theta_ptr", "len_export": "vkf_get_theta_len"},
        {"name": "wave", "kind": "axis_f64_array", "axis_key": "u", "ptr_export": "vkf_get_wave_ptr", "len_export": "vkf_get_wave_len"},
        {"name": "scaled_wave", "kind": "axis_f64_array", "axis_key": "u", "ptr_export": "vkf_get_scaled_wave_ptr", "len_export": "vkf_get_scaled_wave_len"},
    ]

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
const mem = new DataView(inst.exports.memory.buffer);
function readVec(name) {
  const ptr = inst.exports["vkf_get_" + name + "_ptr"]();
  const len = inst.exports["vkf_get_" + name + "_len"]();
  const values = [];
  for (let i = 0; i < len; i += 1) values.push(mem.getFloat64(ptr + i * 8, true));
  return values;
}
process.stdout.write(JSON.stringify({ theta: readVec("theta"), wave: readVec("wave"), scaled: readVec("scaled_wave") }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload["theta"] == pytest.approx([0.0, 1.5707963267948966, 3.141592653589793])
    assert payload["wave"] == pytest.approx([0.0, 1.0, 0.0], abs=1e-12)
    assert payload["scaled"] == pytest.approx([0.0, 0.5, 0.0], abs=1e-12)


def test_wasm_artifact_smoke_can_lower_axis_vector_scalar_update_function(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_vec_update.vkf"
    typed_ir_path = tmp_path / "axis_vec_update.typed-ir.json"
    source_path.write_text("axis vector update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "num"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "num"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert manifest["runtime_surface"]["state_axis_key"] == "u"
    assert manifest["runtime_surface"]["state_axis_length"] == 3

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
inst.exports.vkf_init();
const mem = new DataView(inst.exports.memory.buffer);
const statePtr = inst.exports.vkf_state_ptr();
const inputPtr = inst.exports.vkf_input_ptr();
mem.setInt32(inputPtr, 10, true);
inst.exports.vkf_update();
const state = [];
for (let i = 0; i < 3; i += 1) state.push(mem.getInt32(statePtr + i * 4, true));
process.stdout.write(JSON.stringify({ state }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload["state"] == [12, 14, 16]


def test_compiled_runtime_bridge_consumes_float_axis_vector_wasm_runtime(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_vec_float_update.vkf"
    typed_ir_path = tmp_path / "axis_vec_float_update.typed-ir.json"
    source_path.write_text("axis vector float update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1.5},
                                    {"kind": "const", "type": "num", "value": 2.5},
                                    {"kind": "const", "type": "num", "value": 3.5},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "num"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "num"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert manifest["runtime_surface"]["state_fields"] == [
        {
            "name": "values",
            "offset": 0.0,
            "type": "axis<u>:list<f64>",
            "axis_key": "u",
            "axis_length": 3.0,
            "storage": "f64",
        }
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f64", "storage": "f64"}
    ]

    script = r"""
const fs = require("fs");
const bridge = require("./web/vf-ui/vf-compiled-runtime-bridge.js");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const bytes = fs.readFileSync(process.argv[2]);
const runtime = bridge.instantiateWasmRuntime({ manifest, bytes });
runtime.init();
runtime.writeState({ values: [10.0, 20.0, 30.0] });
runtime.writeInput({ value: 0.25 });
runtime.update();
const state = runtime.readState();
const bindings = runtime.readBindings();
process.stdout.write(JSON.stringify({ state, bindings, stateLayout: runtime.stateLayout(), inputLayout: runtime.inputLayout() }));
"""
    payload = json.loads(_run_node(script, str(manifest_path), str(artifact_path)).stdout)
    assert payload["state"]["values"] == pytest.approx([11.75, 22.75, 33.75], abs=1e-12)
    assert payload["bindings"]["gain"]["axisKey"] == "u"
    assert payload["bindings"]["gain"]["values"] == pytest.approx([1.5, 2.5, 3.5], abs=1e-12)
    assert payload["stateLayout"]["fields"][0]["storage"] == "f64"
    assert payload["inputLayout"]["fields"][0]["storage"] == "f64"


def test_wasm_artifact_smoke_can_lower_axis_vector_vector_update_function(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_vec_vec_update.vkf"
    typed_ir_path = tmp_path / "axis_vec_vec_update.typed-ir.json"
    source_path.write_text("axis vector vector update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "axis<u>:list<num>"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "axis<u>:list<num>"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "axis<u>:list<num>"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_vector"
    assert manifest["runtime_surface"]["input_axis_key"] == "u"
    assert manifest["runtime_surface"]["input_axis_length"] == 3

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
inst.exports.vkf_init();
const mem = new DataView(inst.exports.memory.buffer);
const statePtr = inst.exports.vkf_state_ptr();
const inputPtr = inst.exports.vkf_input_ptr();
const stateValues = [10, 20, 30];
const inputValues = [5, 6, 7];
for (let i = 0; i < 3; i += 1) {
  mem.setInt32(statePtr + i * 4, stateValues[i], true);
  mem.setInt32(inputPtr + i * 4, inputValues[i], true);
}
inst.exports.vkf_update();
const state = [];
for (let i = 0; i < 3; i += 1) state.push(mem.getInt32(statePtr + i * 4, true));
process.stdout.write(JSON.stringify({ state }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload["state"] == [16, 28, 40]


def test_wasm_artifact_smoke_can_lower_ir_owned_update_function(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "runtime_update.vkf"
    typed_ir_path = tmp_path / "runtime_update.typed-ir.json"
    source = """gain: 3
vkf_update(state:num, input:num) -> num:
    @: state + input + gain
"""
    source_path.write_text(source, encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source, smoke_exes), encoding="utf-8")

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["bindings"] == [
        {"name": "gain", "kind": "i32", "value_export": "vkf_get_gain"}
    ]

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
inst.exports.vkf_init();
const memory = new DataView(inst.exports.memory.buffer);
memory.setInt32(inst.exports.vkf_input_ptr(), 5, true);
inst.exports.vkf_update();
inst.exports.vkf_update();
const state = memory.getInt32(inst.exports.vkf_state_ptr(), true);
process.stdout.write(JSON.stringify({ state, gain: inst.exports.vkf_get_gain() }));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload == {"state": 16, "gain": 3}


def test_wasm_artifact_smoke_can_lower_record_state_update_function(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "runtime_record_update.vkf"
    typed_ir_path = tmp_path / "runtime_record_update.typed-ir.json"
    source_path.write_text("runtime record update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "num",
                        "value": {"kind": "const", "type": "num", "value": 2},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,total:num}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,bias:num}"},
                        ],
                        "return_type": "record{count:num,total:num}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,total:num}", "record{delta:num,bias:num}"],
                            "return_type": "record{count:num,total:num}",
                            "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,total:num}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,total:num}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,total:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,bias:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "total",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "num",
                                                        "left": {
                                                            "kind": "binary_op",
                                                            "op": "PLUS",
                                                            "type": "num",
                                                            "left": {
                                                                "kind": "field_access",
                                                                "field": "total",
                                                                "object_type": "record{count:num,total:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                            },
                                                            "right": {
                                                                "kind": "field_access",
                                                                "field": "delta",
                                                                "object_type": "record{delta:num,bias:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                            },
                                                        },
                                                        "right": {
                                                            "kind": "field_access",
                                                            "field": "bias",
                                                            "object_type": "record{delta:num,bias:num}",
                                                            "type": "num",
                                                            "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                        },
                                                    },
                                                    "right": {"kind": "load", "name": "gain", "type": "num"},
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["update_mode"] == "record"
    assert manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "total", "offset": 4, "type": "num"},
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "bias", "offset": 4, "type": "num"},
    ]

    script = r"""
const fs = require("fs");
const path = process.argv[1];
const bytes = fs.readFileSync(path);
const mod = new WebAssembly.Module(bytes);
const inst = new WebAssembly.Instance(mod, {});
inst.exports.vkf_init();
const memory = new DataView(inst.exports.memory.buffer);
const statePtr = inst.exports.vkf_state_ptr();
const inputPtr = inst.exports.vkf_input_ptr();
memory.setInt32(statePtr + 0, 10, true);
memory.setInt32(statePtr + 4, 100, true);
memory.setInt32(inputPtr + 0, 3, true);
memory.setInt32(inputPtr + 4, 7, true);
inst.exports.vkf_update();
process.stdout.write(JSON.stringify({
  count: memory.getInt32(statePtr + 0, true),
  total: memory.getInt32(statePtr + 4, true),
  gain: inst.exports.vkf_get_gain()
}));
"""
    payload = json.loads(_run_node(script, str(artifact_path)).stdout)
    assert payload == {"count": 13, "total": 112, "gain": 2}


def test_wasm_artifact_smoke_can_lower_mixed_record_axis_state_update_function(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "runtime_record_axis_update.vkf"
    typed_ir_path = tmp_path / "runtime_record_axis_update.typed-ir.json"
    source_path.write_text("runtime record axis update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,values:axis<u>:list<num>},record{delta:num,offsets:axis<u>:list<num>})->record{count:num,values:axis<u>:list<num>}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                        ],
                        "return_type": "record{count:num,values:axis<u>:list<num>}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,values:axis<u>:list<num>}", "record{delta:num,offsets:axis<u>:list<num>}"],
                            "return_type": "record{count:num,values:axis<u>:list<num>}",
                            "type": "fn(record{count:num,values:axis<u>:list<num>},record{delta:num,offsets:axis<u>:list<num>})->record{count:num,values:axis<u>:list<num>}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,values:axis<u>:list<num>}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,values:axis<u>:list<num>}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,values:axis<u>:list<num>}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,offsets:axis<u>:list<num>}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "values",
                                                "type": "axis<u>:list<num>",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "axis<u>:list<num>",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "axis<u>:list<num>",
                                                        "left": {
                                                            "kind": "field_access",
                                                            "field": "values",
                                                            "object_type": "record{count:num,values:axis<u>:list<num>}",
                                                            "type": "axis<u>:list<num>",
                                                            "object": {"kind": "load", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                                                        },
                                                        "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "offsets",
                                                        "object_type": "record{delta:num,offsets:axis<u>:list<num>}",
                                                        "type": "axis<u>:list<num>",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["update_mode"] == "record"
    assert manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "values", "offset": 4, "type": "axis<u>:list<num>", "axis_key": "u", "axis_length": 3},
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "offsets", "offset": 4, "type": "axis<u>:list<num>", "axis_key": "u", "axis_length": 3},
    ]

    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bytes = fs.readFileSync(process.argv[3]);
const runtime = bridge.instantiateWasmRuntime({ manifest, bytes });
runtime.init();
runtime.writeState({ count: 10, values: { values: [100, 200, 300] } });
runtime.writeInput({ delta: 5, offsets: { values: [7, 8, 9] } });
runtime.update();
process.stdout.write(JSON.stringify({
  state: runtime.readState(),
  input: runtime.readInput()
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["state"] == {"count": 15, "values": {"values": [108, 210, 312]}}
    assert payload["input"] == {"delta": 5, "offsets": {"values": [7, 8, 9]}}


def test_wasm_artifact_smoke_fails_hard_on_unsupported_function(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bad.vkf"
    typed_ir_path = tmp_path / "bad.typed-ir.json"
    source_path.write_text("bad", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "function",
                        "name": "f",
                        "type": "fn()->num",
                        "params": [],
                        "return_type": "num",
                        "body": {"kind": "const", "type": "num", "value": 1},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(smoke_exes["wasm_artifact"]), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
    assert "unsupported typed IR function f for wasm artifact emission" in proc.stderr


def test_wasm_artifact_smoke_rejects_bad_update_signature(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bad_update.vkf"
    typed_ir_path = tmp_path / "bad_update.typed-ir.json"
    source_path.write_text("bad", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(str,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "str"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["str", "num"],
                            "return_type": "num",
                            "type": "fn(str,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "const", "type": "num", "value": 1},
                                }
                            ],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(smoke_exes["wasm_artifact"]), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
    assert "wasm vkf_update must use either num/num->num or matching record state/input types" in proc.stderr


def test_webgpu_artifact_smoke_emits_scalar_update_shader(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "scalar_gpu.vkf"
    typed_ir_path = tmp_path / "scalar_gpu.typed-ir.json"
    source = """gain: 3
vkf_update(state:num, input:num) -> num:
    @: state + input + gain
"""
    source_path.write_text(source, encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source, smoke_exes), encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = artifact_path.read_text(encoding="utf-8")

    assert result["artifact_kind"] == "webgpu-wgsl"
    assert result["status"] == "compiled"
    assert manifest["runtime_surface"]["update_mode"] == "scalar"
    assert manifest["runtime_surface"]["bindings"] == [
        {"name": "gain", "kind": "i32_const", "value": 3}
    ]
    assert "struct State {\n  value: i32," in shader
    assert "struct Input {\n  value: i32," in shader
    assert "const gain: i32 = 3;" in shader
    assert "fn vkf_update()" in shader
    assert "let next_value: i32 = ((state.value + input.value) + gain);" in shader
    assert "state.value = next_value;" in shader


def test_webgpu_artifact_smoke_emits_axis_vector_binding_manifest(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "axis_gpu.vkf"
    typed_ir_path = tmp_path / "axis_gpu.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "u",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": -1},
                                    {"kind": "const", "type": "num", "value": 0},
                                    {"kind": "const", "type": "num", "value": 1},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    source_path.write_text("axis gpu", encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["runtime_surface"]["bindings"] == [
        {"name": "u", "kind": "axis_i32_array", "axis_key": "u", "values": [-1, 0, 1]}
    ]


def test_webgpu_artifact_smoke_emits_computed_axis_f64_binding_manifest(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "axis_wave_gpu.vkf"
    typed_ir_path = tmp_path / "axis_wave_gpu.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.0},
                                    {"kind": "const", "type": "num", "value": 1.5707963267948966},
                                    {"kind": "const", "type": "num", "value": 3.141592653589793},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "call",
                            "type": "axis<u>:list<num>",
                            "callee": {
                                "kind": "field_access",
                                "field": "sin",
                                "type": "any",
                                "object": {"kind": "load", "name": "math", "type": "any"},
                                "object_type": "any",
                            },
                            "callee_type": "any",
                            "arg_types": ["axis<u>:list<num>"],
                            "args": [{"kind": "load", "name": "theta", "type": "axis<u>:list<num>"}],
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    source_path.write_text("axis wave gpu", encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")
    bindings = manifest["runtime_surface"]["bindings"]
    assert bindings[0]["name"] == "theta"
    assert bindings[0]["kind"] == "axis_f64_array"
    assert bindings[0]["axis_key"] == "u"
    assert bindings[0]["values"] == pytest.approx([0.0, 1.5707963267948966, 3.141592653589793])
    assert bindings[1]["name"] == "wave"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["axis_key"] == "u"
    assert bindings[1]["values"] == pytest.approx([0.0, 1.0, 0.0], abs=1e-6)
    assert "const theta: array<f32, 3> = array<f32, 3>(0" in shader


def test_webgpu_artifact_smoke_emits_source_style_computed_axis_f64_binding_manifest(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_wave_source_style_gpu.vkf"
    typed_ir_path = tmp_path / "axis_wave_source_style_gpu.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.0},
                                    {"kind": "const", "type": "num", "value": 1.5707963267948966},
                                    {"kind": "const", "type": "num", "value": 3.141592653589793},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "call",
                            "type": "axis<u>:list<num>",
                            "callee": {
                                "kind": "stdlib_function",
                                "module": "math",
                                "name": "sin",
                                "full_name": "math.sin",
                                "type": "fn(any)->any",
                            },
                            "callee_type": "fn(any)->any",
                            "arg_types": ["axis<u>:list<num>"],
                            "args": [{"kind": "load", "name": "theta", "type": "axis<u>:list<num>"}],
                            "named_args": [],
                            "spread_args": [],
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    source_path.write_text("axis wave source style gpu", encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")
    bindings = manifest["runtime_surface"]["bindings"]
    assert bindings[1]["name"] == "wave"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["axis_key"] == "u"
    assert bindings[1]["values"] == pytest.approx([0.0, 1.0, 0.0], abs=1e-6)
    assert "const wave: array<f32, 3> = array<f32, 3>(" in shader


def test_webgpu_artifact_smoke_emits_source_style_computed_axis_f64_exp_binding_manifest(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_exp_source_style_gpu.vkf"
    typed_ir_path = tmp_path / "axis_exp_source_style_gpu.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.0},
                                    {"kind": "const", "type": "num", "value": 1.0},
                                    {"kind": "const", "type": "num", "value": 2.0},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "call",
                            "type": "axis<u>:list<num>",
                            "callee": {
                                "kind": "stdlib_function",
                                "module": "math",
                                "name": "exp",
                                "full_name": "math.exp",
                                "type": "fn(any)->any",
                            },
                            "callee_type": "fn(any)->any",
                            "arg_types": ["axis<u>:list<num>"],
                            "args": [{"kind": "load", "name": "theta", "type": "axis<u>:list<num>"}],
                            "named_args": [],
                            "spread_args": [],
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    source_path.write_text("axis exp source style gpu", encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    bindings = manifest["runtime_surface"]["bindings"]
    assert bindings[1]["name"] == "wave"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["axis_key"] == "u"
    assert bindings[1]["values"] == pytest.approx([1.0, 2.718281828459045, 7.38905609893065], abs=1e-6)


def test_webgpu_artifact_smoke_emits_computed_axis_f64_division_binding_manifest(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_division_gpu.vkf"
    typed_ir_path = tmp_path / "axis_division_gpu.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 2.0},
                                    {"kind": "const", "type": "num", "value": 5.0},
                                    {"kind": "const", "type": "num", "value": 10.0},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "half",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "binary_op",
                            "op": "SLASH",
                            "left": {"kind": "load", "name": "theta", "type": "axis<u>:list<num>"},
                            "right": {"kind": "const", "type": "num", "value": 4.0},
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    source_path.write_text("axis division gpu", encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    bindings = manifest["runtime_surface"]["bindings"]
    assert bindings[1]["name"] == "half"
    assert bindings[1]["kind"] == "axis_f64_array"
    assert bindings[1]["axis_key"] == "u"
    assert bindings[1]["values"] == pytest.approx([0.5, 1.25, 2.5], abs=1e-6)


def test_webgpu_artifact_smoke_emits_computed_axis_f64_power_binding_manifest(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_power_gpu.vkf"
    typed_ir_path = tmp_path / "axis_power_gpu.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1.0},
                                    {"kind": "const", "type": "num", "value": 2.0},
                                    {"kind": "const", "type": "num", "value": 3.0},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "pow2",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "binary_op",
                            "op": "CARET",
                            "left": {"kind": "load", "name": "theta", "type": "axis<u>:list<num>"},
                            "right": {"kind": "const", "type": "num", "value": 2.0},
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    source_path.write_text("axis power gpu", encoding="utf-8")

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    bindings = manifest["runtime_surface"]["bindings"]
    assert bindings[1]["name"] == "pow2"
    assert bindings[1]["kind"] == "axis_i32_array"
    assert bindings[1]["axis_key"] == "u"
    assert bindings[1]["values"] == [1, 4, 9]


def test_webgpu_artifact_smoke_emits_axis_vector_scalar_update_shader(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "axis_vector_gpu.vkf"
    typed_ir_path = tmp_path / "axis_vector_gpu.typed-ir.json"
    source_path.write_text("axis vector gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "num"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "num"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = artifact_path.read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert manifest["runtime_surface"]["state_axis_key"] == "u"
    assert manifest["runtime_surface"]["state_axis_length"] == 3
    assert "struct State {\n  values: array<i32, 3>," in shader
    assert "struct Input {\n  value: i32," in shader
    assert "const gain: array<i32, 3> = array<i32, 3>(1, 2, 3);" in shader
    assert "let next_value_0: i32 = ((state.values[0] + gain[0]) + input.value);" in shader
    assert "let next_value_2: i32 = ((state.values[2] + gain[2]) + input.value);" in shader
    assert "state.values[0] = next_value_0;" in shader
    assert "state.values[2] = next_value_2;" in shader


def test_webgpu_artifact_smoke_emits_float_axis_vector_scalar_update_shader(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_vector_float_gpu.vkf"
    typed_ir_path = tmp_path / "axis_vector_float_gpu.typed-ir.json"
    source_path.write_text("axis vector float gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1.5},
                                    {"kind": "const", "type": "num", "value": 2.5},
                                    {"kind": "const", "type": "num", "value": 3.5},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "num"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "num"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = artifact_path.read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert manifest["runtime_surface"]["state_fields"] == [
        {
            "name": "values",
            "offset": 0.0,
            "type": "axis<u>:list<f32>",
            "axis_key": "u",
            "axis_length": 3.0,
            "storage": "f32",
        }
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "struct State {\n  values: array<f32, 3>," in shader
    assert "struct Input {\n  value: f32," in shader
    assert "const gain: array<f32, 3> = array<f32, 3>(1.5" in shader
    assert "let next_value_0: f32 = ((state.values[0] + gain[0]) + input.value);" in shader
    assert "let next_value_2: f32 = ((state.values[2] + gain[2]) + input.value);" in shader


def test_webgpu_artifact_smoke_emits_float_scalar_update_shader(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_update_webgpu.vkf"
    typed_ir_path = tmp_path / "float_scalar_update_webgpu.typed-ir.json"
    source_path.write_text("float scalar update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "bias",
                        "type": "f64",
                        "value": {"kind": "const", "type": "f64", "value": 0.5},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(f32,f32)->f32",
                        "params": [
                            {"kind": "param", "name": "state", "type": "f32"},
                            {"kind": "param", "name": "input", "type": "f32"},
                        ],
                        "return_type": "f32",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["f32", "f32"],
                            "return_type": "f32",
                            "type": "fn(f32,f32)->f32",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "f32",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "f32",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "f32",
                                            "left": {"kind": "load", "name": "state", "type": "f32"},
                                            "right": {"kind": "load", "name": "input", "type": "f32"},
                                        },
                                        "right": {"kind": "load", "name": "bias", "type": "f64"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "scalar"
    assert manifest["runtime_surface"]["state_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "value", "offset": 0.0, "type": "f32", "storage": "f32"}
    ]
    assert "struct State {\n  value: f32," in shader
    assert "struct Input {\n  value: f32," in shader
    assert "const bias: f32 = 0.5;" in shader
    assert "let next_value: f32 = ((state.value + input.value) + bias);" in shader


def test_webgpu_artifact_smoke_emits_float_scalar_local_binding_update_shader(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_local_binding_update_webgpu.vkf"
    typed_ir_path = tmp_path / "float_scalar_local_binding_update_webgpu.typed-ir.json"
    source_path.write_text("float scalar local binding update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "bias",
                        "type": "f64",
                        "value": {"kind": "const", "type": "f64", "value": 0.5},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(f32,f32)->f32",
                        "params": [
                            {"kind": "param", "name": "state", "type": "f32"},
                            {"kind": "param", "name": "input", "type": "f32"},
                        ],
                        "return_type": "f32",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["f32", "f32"],
                            "return_type": "f32",
                            "type": "fn(f32,f32)->f32",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "store_binding",
                                    "name": "total",
                                    "type": "f32",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "f32",
                                        "left": {"kind": "load", "name": "state", "type": "f32"},
                                        "right": {"kind": "load", "name": "input", "type": "f32"},
                                    },
                                },
                                {
                                    "kind": "return",
                                    "type": "f32",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "f32",
                                        "left": {"kind": "load", "name": "total", "type": "f32"},
                                        "right": {"kind": "load", "name": "bias", "type": "f64"},
                                    },
                                },
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    shader = artifact_path.read_text(encoding="utf-8")
    assert len(artifact_path.parent.name) <= 24
    assert artifact_path.name.startswith(f"{artifact_path.parent.name}.")
    assert "const bias: f32 = 0.5;" in shader
    assert "let next_value: f32 = ((state.value + input.value) + bias);" in shader


def test_webgpu_artifact_smoke_emits_float_axis_vector_intrinsic_update_shader(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_vector_intrinsic_gpu.vkf"
    typed_ir_path = tmp_path / "axis_vector_intrinsic_gpu.typed-ir.json"
    source_path.write_text("axis vector intrinsic gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.5},
                                    {"kind": "const", "type": "num", "value": 1.5},
                                    {"kind": "const", "type": "num", "value": 2.5},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<f32>,f32)->axis<u>:list<f32>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<f32>"},
                            {"kind": "param", "name": "input", "type": "f32"},
                        ],
                        "return_type": "axis<u>:list<f32>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<f32>", "f32"],
                            "return_type": "axis<u>:list<f32>",
                            "type": "fn(axis<u>:list<f32>,f32)->axis<u>:list<f32>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<f32>",
                                    "value": {
                                        "kind": "call",
                                        "type": "axis<u>:list<f32>",
                                        "callee": {
                                            "kind": "field_access",
                                            "field": "sin",
                                            "type": "any",
                                            "object": {"kind": "load", "name": "math", "type": "any"},
                                            "object_type": "any",
                                        },
                                        "callee_type": "any",
                                        "arg_types": ["axis<u>:list<f32>"],
                                        "args": [
                                            {
                                                "kind": "binary_op",
                                                "op": "PLUS",
                                                "type": "axis<u>:list<f32>",
                                                "left": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "axis<u>:list<f32>",
                                                    "left": {"kind": "load", "name": "state", "type": "axis<u>:list<f32>"},
                                                    "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                                },
                                                "right": {"kind": "load", "name": "input", "type": "f32"},
                                            }
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_scalar"
    assert "const gain: array<f32, 3> = array<f32, 3>(0.5" in shader
    assert "let next_value_2: f32 = sin(((state.values[2] + gain[2]) + input.value));" in shader


def test_webgpu_artifact_smoke_emits_float_scalar_exp_update_shader(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_exp_update_webgpu.vkf"
    typed_ir_path = tmp_path / "float_scalar_exp_update_webgpu.typed-ir.json"
    source_path.write_text("float scalar exp update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "bias",
                        "type": "f64",
                        "value": {"kind": "const", "type": "f64", "value": 0.5},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(f32,f32)->f32",
                        "params": [
                            {"kind": "param", "name": "state", "type": "f32"},
                            {"kind": "param", "name": "input", "type": "f32"},
                        ],
                        "return_type": "f32",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["f32", "f32"],
                            "return_type": "f32",
                            "type": "fn(f32,f32)->f32",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "f32",
                                    "value": {
                                        "kind": "call",
                                        "type": "f32",
                                        "callee": {
                                            "kind": "stdlib_function",
                                            "module": "math",
                                            "name": "exp",
                                            "full_name": "math.exp",
                                            "type": "fn(any)->any",
                                        },
                                        "callee_type": "fn(any)->any",
                                        "arg_types": ["f32"],
                                        "args": [
                                            {
                                                "kind": "binary_op",
                                                "op": "PLUS",
                                                "type": "f32",
                                                "left": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "f32",
                                                    "left": {"kind": "load", "name": "state", "type": "f32"},
                                                    "right": {"kind": "load", "name": "input", "type": "f32"},
                                                },
                                                "right": {"kind": "load", "name": "bias", "type": "f64"},
                                            }
                                        ],
                                        "named_args": [],
                                        "spread_args": [],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")
    assert "const bias: f32 = 0.5;" in shader
    assert "let next_value: f32 = exp(((state.value + input.value) + bias));" in shader


def test_webgpu_artifact_smoke_emits_float_scalar_division_update_shader(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "float_scalar_division_update_webgpu.vkf"
    typed_ir_path = tmp_path / "float_scalar_division_update_webgpu.typed-ir.json"
    source_path.write_text("float scalar division update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "scale",
                        "type": "f64",
                        "value": {"kind": "const", "type": "f64", "value": 2.5},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(f32,f32)->f32",
                        "params": [
                            {"kind": "param", "name": "state", "type": "f32"},
                            {"kind": "param", "name": "input", "type": "f32"},
                        ],
                        "return_type": "f32",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["f32", "f32"],
                            "return_type": "f32",
                            "type": "fn(f32,f32)->f32",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "f32",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "SLASH",
                                        "type": "f32",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "f32",
                                            "left": {"kind": "load", "name": "state", "type": "f32"},
                                            "right": {"kind": "load", "name": "input", "type": "f32"},
                                        },
                                        "right": {"kind": "load", "name": "scale", "type": "f64"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")
    assert "const scale: f32 = 2.5;" in shader
    assert "let next_value: f32 = ((state.value + input.value) / scale);" in shader


def test_webgpu_artifact_smoke_emits_axis_vector_vector_update_shader(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "axis_vector_vector_gpu.vkf"
    typed_ir_path = tmp_path / "axis_vector_vector_gpu.typed-ir.json"
    source_path.write_text("axis vector vector gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "axis<u>:list<num>"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "axis<u>:list<num>"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "axis<u>:list<num>"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = artifact_path.read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "axis_vector_vector"
    assert manifest["runtime_surface"]["state_axis_key"] == "u"
    assert manifest["runtime_surface"]["input_axis_key"] == "u"
    assert manifest["runtime_surface"]["state_axis_length"] == 3
    assert manifest["runtime_surface"]["input_axis_length"] == 3
    assert "struct Input {\n  values: array<i32, 3>," in shader
    assert "let next_value_0: i32 = ((state.values[0] + gain[0]) + input.values[0]);" in shader
    assert "let next_value_2: i32 = ((state.values[2] + gain[2]) + input.values[2]);" in shader


def test_webgpu_artifact_smoke_emits_record_update_shader(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "record_gpu.vkf"
    typed_ir_path = tmp_path / "record_gpu.typed-ir.json"
    source_path.write_text("record gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "num",
                        "value": {"kind": "const", "type": "num", "value": 2},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,total:num}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,bias:num}"},
                        ],
                        "return_type": "record{count:num,total:num}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,total:num}", "record{delta:num,bias:num}"],
                            "return_type": "record{count:num,total:num}",
                            "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,total:num}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,total:num}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,total:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,bias:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "total",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "num",
                                                        "left": {
                                                            "kind": "binary_op",
                                                            "op": "PLUS",
                                                            "type": "num",
                                                            "left": {
                                                                "kind": "field_access",
                                                                "field": "total",
                                                                "object_type": "record{count:num,total:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                            },
                                                            "right": {
                                                                "kind": "field_access",
                                                                "field": "delta",
                                                                "object_type": "record{delta:num,bias:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                            },
                                                        },
                                                        "right": {
                                                            "kind": "field_access",
                                                            "field": "bias",
                                                            "object_type": "record{delta:num,bias:num}",
                                                            "type": "num",
                                                            "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                        },
                                                    },
                                                    "right": {"kind": "load", "name": "gain", "type": "num"},
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = artifact_path.read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "record"
    assert manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "total", "offset": 4, "type": "num"},
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "bias", "offset": 4, "type": "num"},
    ]
    assert "struct State {\n  count: i32,\n  total: i32," in shader
    assert "struct Input {\n  delta: i32,\n  bias: i32," in shader
    assert "const gain: i32 = 2;" in shader
    assert "let next_count: i32 = (state.count + input.delta);" in shader
    assert "let next_total: i32 = (((state.total + input.delta) + input.bias) + gain);" in shader
    assert "state.count = next_count;" in shader
    assert "state.total = next_total;" in shader


def test_webgpu_artifact_smoke_emits_mixed_record_axis_update_shader(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "record_axis_gpu.vkf"
    typed_ir_path = tmp_path / "record_axis_gpu.typed-ir.json"
    source_path.write_text("record axis gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,values:axis<u>:list<num>},record{delta:num,offsets:axis<u>:list<num>})->record{count:num,values:axis<u>:list<num>}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                        ],
                        "return_type": "record{count:num,values:axis<u>:list<num>}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,values:axis<u>:list<num>}", "record{delta:num,offsets:axis<u>:list<num>}"],
                            "return_type": "record{count:num,values:axis<u>:list<num>}",
                            "type": "fn(record{count:num,values:axis<u>:list<num>},record{delta:num,offsets:axis<u>:list<num>})->record{count:num,values:axis<u>:list<num>}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,values:axis<u>:list<num>}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,values:axis<u>:list<num>}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,values:axis<u>:list<num>}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,offsets:axis<u>:list<num>}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "values",
                                                "type": "axis<u>:list<num>",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "axis<u>:list<num>",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "axis<u>:list<num>",
                                                        "left": {
                                                            "kind": "field_access",
                                                            "field": "values",
                                                            "object_type": "record{count:num,values:axis<u>:list<num>}",
                                                            "type": "axis<u>:list<num>",
                                                            "object": {"kind": "load", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                                                        },
                                                        "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "offsets",
                                                        "object_type": "record{delta:num,offsets:axis<u>:list<num>}",
                                                        "type": "axis<u>:list<num>",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    shader = artifact_path.read_text(encoding="utf-8")

    assert manifest["runtime_surface"]["update_mode"] == "record"
    assert manifest["runtime_surface"]["state_fields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "values", "offset": 4, "type": "axis<u>:list<num>", "axis_key": "u", "axis_length": 3},
    ]
    assert manifest["runtime_surface"]["input_fields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "offsets", "offset": 4, "type": "axis<u>:list<num>", "axis_key": "u", "axis_length": 3},
    ]
    assert "struct State {\n  count: i32,\n  values: array<i32, 3>," in shader
    assert "struct Input {\n  delta: i32,\n  offsets: array<i32, 3>," in shader
    assert "let next_count: i32 = (state.count + input.delta);" in shader
    assert "let next_values_0: i32 = ((state.values[0] + gain[0]) + input.offsets[0]);" in shader
    assert "let next_values_2: i32 = ((state.values[2] + gain[2]) + input.offsets[2]);" in shader
    assert "state.values[0] = next_values_0;" in shader
    assert "state.values[2] = next_values_2;" in shader


def test_webgpu_artifact_smoke_requires_update_function(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "no_update_gpu.vkf"
    typed_ir_path = tmp_path / "no_update_gpu.typed-ir.json"
    source_path.write_text("no update", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "num",
                        "value": {"kind": "const", "type": "num", "value": 2},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(smoke_exes["webgpu_artifact"]), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 1
    assert "webgpu artifact smoke requires a vkf_update function" in proc.stderr


def test_compiled_runtime_bridge_consumes_emitted_wasm_runtime(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_runtime.vkf"
    typed_ir_path = tmp_path / "bridge_runtime.typed-ir.json"
    source = """gain: 3
vkf_update(state:(count:num, total:num), input:(delta:num, bias:num)) -> (count:num, total:num):
    @: (count: state.count + input.delta, total: state.total + input.delta + input.bias + gain)
"""
    source_path.write_text(source, encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "num",
                        "value": {"kind": "const", "type": "num", "value": 3},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,total:num}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,bias:num}"},
                        ],
                        "return_type": "record{count:num,total:num}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,total:num}", "record{delta:num,bias:num}"],
                            "return_type": "record{count:num,total:num}",
                            "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,total:num}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,total:num}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,total:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,bias:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "total",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "num",
                                                        "left": {
                                                            "kind": "binary_op",
                                                            "op": "PLUS",
                                                            "type": "num",
                                                            "left": {
                                                                "kind": "field_access",
                                                                "field": "total",
                                                                "object_type": "record{count:num,total:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                            },
                                                            "right": {
                                                                "kind": "field_access",
                                                                "field": "delta",
                                                                "object_type": "record{delta:num,bias:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                            },
                                                        },
                                                        "right": {
                                                            "kind": "field_access",
                                                            "field": "bias",
                                                            "object_type": "record{delta:num,bias:num}",
                                                            "type": "num",
                                                            "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                        },
                                                    },
                                                    "right": {"kind": "load", "name": "gain", "type": "num"},
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bytes = fs.readFileSync(process.argv[3]);
const runtime = bridge.instantiateWasmRuntime({ manifest, bytes });
runtime.init();
runtime.writeState({ count: 10, total: 100 });
runtime.writeInput({ delta: 5, bias: 7 });
runtime.update();
process.stdout.write(JSON.stringify({
  state: runtime.readState(),
  inputLayout: runtime.inputLayout(),
  stateLayout: runtime.stateLayout()
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["state"] == {"count": 15, "total": 115}
    assert payload["stateLayout"]["fields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "total", "offset": 4, "type": "num"},
    ]
    assert payload["inputLayout"]["fields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "bias", "offset": 4, "type": "num"},
    ]


def test_compiled_runtime_bridge_consumes_emitted_webgpu_runtime_spec(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_gpu.typed-ir.json"
    source_path.write_text("bridge gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "num",
                        "value": {"kind": "const", "type": "num", "value": 4},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,total:num}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,bias:num}"},
                        ],
                        "return_type": "record{count:num,total:num}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,total:num}", "record{delta:num,bias:num}"],
                            "return_type": "record{count:num,total:num}",
                            "type": "fn(record{count:num,total:num},record{delta:num,bias:num})->record{count:num,total:num}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,total:num}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,total:num}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,total:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,bias:num}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "total",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "num",
                                                        "left": {
                                                            "kind": "binary_op",
                                                            "op": "PLUS",
                                                            "type": "num",
                                                            "left": {
                                                                "kind": "field_access",
                                                                "field": "total",
                                                                "object_type": "record{count:num,total:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "state", "type": "record{count:num,total:num}"},
                                                            },
                                                            "right": {
                                                                "kind": "field_access",
                                                                "field": "delta",
                                                                "object_type": "record{delta:num,bias:num}",
                                                                "type": "num",
                                                                "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                            },
                                                        },
                                                        "right": {
                                                            "kind": "field_access",
                                                            "field": "bias",
                                                            "object_type": "record{delta:num,bias:num}",
                                                            "type": "num",
                                                            "object": {"kind": "load", "name": "input", "type": "record{delta:num,bias:num}"},
                                                        },
                                                    },
                                                    "right": {"kind": "load", "name": "gain", "type": "num"},
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ count: 10, total: 100 }));
const inputBytes = Array.from(spec.encodeInput({ delta: 5, bias: 7 }));
process.stdout.write(JSON.stringify({
  entryPoint: spec.entryPoint,
  stateBinding: spec.stateBinding,
  inputBinding: spec.inputBinding,
  stateFields: spec.stateFields,
  inputFields: spec.inputFields,
  stateBytes,
  inputBytes,
  hasShader: spec.wgsl.includes("fn vkf_update()")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["entryPoint"] == "vkf_update"
    assert payload["stateBinding"] == 0
    assert payload["inputBinding"] == 1
    assert payload["stateFields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "total", "offset": 4, "type": "num"},
    ]
    assert payload["inputFields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "bias", "offset": 4, "type": "num"},
    ]
    assert payload["stateBytes"] == [10, 0, 0, 0, 100, 0, 0, 0]
    assert payload["inputBytes"] == [5, 0, 0, 0, 7, 0, 0, 0]
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_emitted_mixed_record_axis_webgpu_runtime_spec(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_record_axis_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_record_axis_gpu.typed-ir.json"
    source_path.write_text("bridge record axis gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:num,values:axis<u>:list<num>},record{delta:num,offsets:axis<u>:list<num>})->record{count:num,values:axis<u>:list<num>}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                            {"kind": "param", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                        ],
                        "return_type": "record{count:num,values:axis<u>:list<num>}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:num,values:axis<u>:list<num>}", "record{delta:num,offsets:axis<u>:list<num>}"],
                            "return_type": "record{count:num,values:axis<u>:list<num>}",
                            "type": "fn(record{count:num,values:axis<u>:list<num>},record{delta:num,offsets:axis<u>:list<num>})->record{count:num,values:axis<u>:list<num>}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:num,values:axis<u>:list<num>}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:num,values:axis<u>:list<num>}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "num",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "num",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:num,values:axis<u>:list<num>}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:num,offsets:axis<u>:list<num>}",
                                                        "type": "num",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "values",
                                                "type": "axis<u>:list<num>",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "axis<u>:list<num>",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "axis<u>:list<num>",
                                                        "left": {
                                                            "kind": "field_access",
                                                            "field": "values",
                                                            "object_type": "record{count:num,values:axis<u>:list<num>}",
                                                            "type": "axis<u>:list<num>",
                                                            "object": {"kind": "load", "name": "state", "type": "record{count:num,values:axis<u>:list<num>}"},
                                                        },
                                                        "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "offsets",
                                                        "object_type": "record{delta:num,offsets:axis<u>:list<num>}",
                                                        "type": "axis<u>:list<num>",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:num,offsets:axis<u>:list<num>}"},
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ count: 10, values: { values: [100, 200, 300] } }));
const inputBytes = Array.from(spec.encodeInput({ delta: 5, offsets: { values: [7, 8, 9] } }));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  stateFields: spec.stateFields,
  inputFields: spec.inputFields,
  stateBytes,
  inputBytes,
  hasShader: spec.wgsl.includes("state.values[2] = next_values_2;")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "record"
    assert payload["stateFields"] == [
        {"name": "count", "offset": 0, "type": "num"},
        {"name": "values", "offset": 4, "type": "axis<u>:list<num>", "axis_key": "u", "axis_length": 3},
    ]
    assert payload["inputFields"] == [
        {"name": "delta", "offset": 0, "type": "num"},
        {"name": "offsets", "offset": 4, "type": "axis<u>:list<num>", "axis_key": "u", "axis_length": 3},
    ]
    assert payload["stateBytes"] == [10, 0, 0, 0, 100, 0, 0, 0, 200, 0, 0, 0, 44, 1, 0, 0]
    assert payload["inputBytes"] == [5, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0, 9, 0, 0, 0]
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_axis_vector_webgpu_runtime_spec(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_axis_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_axis_gpu.typed-ir.json"
    source_path.write_text("bridge axis gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "num"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "num"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ values: [10, 20, 30] }));
const inputBytes = Array.from(spec.encodeInput({ value: 5 }));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  stateAxisKey: spec.stateAxisKey,
  stateAxisLength: spec.stateAxisLength,
  stateBytes,
  inputBytes,
  hasShader: spec.wgsl.includes("state.values[2] = next_value_2;")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "axis_vector_scalar"
    assert payload["stateAxisKey"] == "u"
    assert payload["stateAxisLength"] == 3
    assert payload["stateBytes"] == [10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0]
    assert payload["inputBytes"] == [5, 0, 0, 0]
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_float_axis_vector_webgpu_runtime_spec(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "bridge_axis_float_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_axis_float_gpu.typed-ir.json"
    source_path.write_text("bridge axis float gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1.5},
                                    {"kind": "const", "type": "num", "value": 2.5},
                                    {"kind": "const", "type": "num", "value": 3.5},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "num"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,num)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "num"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(new Uint8Array(spec.encodeState({ values: [10.0, 20.0, 30.0] }).buffer));
const inputBytes = Array.from(new Uint8Array(spec.encodeInput({ value: 0.25 }).buffer));
const stateFloats = Array.from(new Float32Array(spec.encodeState({ values: [10.0, 20.0, 30.0] }).buffer));
const inputFloats = Array.from(new Float32Array(spec.encodeInput({ value: 0.25 }).buffer));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  stateFields: spec.stateFields,
  inputFields: spec.inputFields,
  stateBytes,
  inputBytes,
  stateFloats,
  inputFloats,
  hasShader: spec.wgsl.includes("let next_value_2: f32")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "axis_vector_scalar"
    assert payload["stateFields"] == [
        {"name": "values", "offset": 0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3}
    ]
    assert payload["inputFields"] == [
        {"name": "value", "offset": 0, "type": "f32", "storage": "f32"}
    ]
    assert payload["stateFloats"] == pytest.approx([10.0, 20.0, 30.0], abs=1e-6)
    assert payload["inputFloats"] == pytest.approx([0.25], abs=1e-6)
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_emitted_float_record_webgpu_runtime_spec(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "bridge_float_record_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_float_record_gpu.typed-ir.json"
    source_path.write_text("bridge float record gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "bias",
                        "type": "f64",
                        "value": {"kind": "const", "type": "f64", "value": 0.25},
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:f32},record{delta:f32})->record{count:f32}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:f32}"},
                            {"kind": "param", "name": "input", "type": "record{delta:f32}"},
                        ],
                        "return_type": "record{count:f32}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:f32}", "record{delta:f32}"],
                            "return_type": "record{count:f32}",
                            "type": "fn(record{count:f32},record{delta:f32})->record{count:f32}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:f32}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:f32}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "f32",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "f32",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "f32",
                                                        "left": {
                                                            "kind": "field_access",
                                                            "field": "count",
                                                            "object_type": "record{count:f32}",
                                                            "type": "f32",
                                                            "object": {"kind": "load", "name": "state", "type": "record{count:f32}"},
                                                        },
                                                        "right": {
                                                            "kind": "field_access",
                                                            "field": "delta",
                                                            "object_type": "record{delta:f32}",
                                                            "type": "f32",
                                                            "object": {"kind": "load", "name": "input", "type": "record{delta:f32}"},
                                                        },
                                                    },
                                                    "right": {"kind": "load", "name": "bias", "type": "f64"},
                                                },
                                            }
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ count: 1.5 }));
const inputBytes = Array.from(spec.encodeInput({ delta: 2.25 }));
const stateFloats = Array.from(new Float32Array(spec.encodeState({ count: 1.5 }).buffer));
const inputFloats = Array.from(new Float32Array(spec.encodeInput({ delta: 2.25 }).buffer));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  stateFields: spec.stateFields,
  inputFields: spec.inputFields,
  stateBytes,
  inputBytes,
  stateFloats,
  inputFloats,
  hasShader: spec.wgsl.includes("let next_count: f32 = ((state.count + input.delta) + bias);")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "record"
    assert payload["stateFields"] == [
        {"name": "count", "offset": 0, "type": "f32", "storage": "f32"}
    ]
    assert payload["inputFields"] == [
        {"name": "delta", "offset": 0, "type": "f32", "storage": "f32"}
    ]
    assert payload["stateBytes"] == [0, 0, 192, 63]
    assert payload["inputBytes"] == [0, 0, 16, 64]
    assert payload["stateFloats"] == pytest.approx([1.5], abs=1e-6)
    assert payload["inputFloats"] == pytest.approx([2.25], abs=1e-6)
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_emitted_mixed_float_record_axis_webgpu_runtime_spec(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "bridge_float_record_axis_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_float_record_axis_gpu.typed-ir.json"
    source_path.write_text("bridge float record axis gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1.5},
                                    {"kind": "const", "type": "num", "value": 2.5},
                                    {"kind": "const", "type": "num", "value": 3.5},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(record{count:f32,values:axis<u>:list<f32>},record{delta:f32,offsets:axis<u>:list<f32>})->record{count:f32,values:axis<u>:list<f32>}",
                        "params": [
                            {"kind": "param", "name": "state", "type": "record{count:f32,values:axis<u>:list<f32>}"},
                            {"kind": "param", "name": "input", "type": "record{delta:f32,offsets:axis<u>:list<f32>}"},
                        ],
                        "return_type": "record{count:f32,values:axis<u>:list<f32>}",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["record{count:f32,values:axis<u>:list<f32>}", "record{delta:f32,offsets:axis<u>:list<f32>}"],
                            "return_type": "record{count:f32,values:axis<u>:list<f32>}",
                            "type": "fn(record{count:f32,values:axis<u>:list<f32>},record{delta:f32,offsets:axis<u>:list<f32>})->record{count:f32,values:axis<u>:list<f32>}",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "record{count:f32,values:axis<u>:list<f32>}",
                                    "value": {
                                        "kind": "record",
                                        "type": "record{count:f32,values:axis<u>:list<f32>}",
                                        "fields": [
                                            {
                                                "kind": "field",
                                                "name": "count",
                                                "type": "f32",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "f32",
                                                    "left": {
                                                        "kind": "field_access",
                                                        "field": "count",
                                                        "object_type": "record{count:f32,values:axis<u>:list<f32>}",
                                                        "type": "f32",
                                                        "object": {"kind": "load", "name": "state", "type": "record{count:f32,values:axis<u>:list<f32>}"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "delta",
                                                        "object_type": "record{delta:f32,offsets:axis<u>:list<f32>}",
                                                        "type": "f32",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:f32,offsets:axis<u>:list<f32>}"},
                                                    },
                                                },
                                            },
                                            {
                                                "kind": "field",
                                                "name": "values",
                                                "type": "axis<u>:list<f32>",
                                                "value": {
                                                    "kind": "binary_op",
                                                    "op": "PLUS",
                                                    "type": "axis<u>:list<f32>",
                                                    "left": {
                                                        "kind": "binary_op",
                                                        "op": "PLUS",
                                                        "type": "axis<u>:list<f32>",
                                                        "left": {
                                                            "kind": "field_access",
                                                            "field": "values",
                                                            "object_type": "record{count:f32,values:axis<u>:list<f32>}",
                                                            "type": "axis<u>:list<f32>",
                                                            "object": {"kind": "load", "name": "state", "type": "record{count:f32,values:axis<u>:list<f32>}"},
                                                        },
                                                        "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                                    },
                                                    "right": {
                                                        "kind": "field_access",
                                                        "field": "offsets",
                                                        "object_type": "record{delta:f32,offsets:axis<u>:list<f32>}",
                                                        "type": "axis<u>:list<f32>",
                                                        "object": {"kind": "load", "name": "input", "type": "record{delta:f32,offsets:axis<u>:list<f32>}"},
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ count: 1.5, values: { values: [10.0, 20.0, 30.0] } }));
const inputBytes = Array.from(spec.encodeInput({ delta: 2.25, offsets: { values: [0.5, 1.5, 2.5] } }));
const stateFloats = Array.from(new Float32Array(spec.encodeState({ count: 1.5, values: { values: [10.0, 20.0, 30.0] } }).buffer));
const inputFloats = Array.from(new Float32Array(spec.encodeInput({ delta: 2.25, offsets: { values: [0.5, 1.5, 2.5] } }).buffer));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  stateFields: spec.stateFields,
  inputFields: spec.inputFields,
  stateBytes,
  inputBytes,
  stateFloats,
  inputFloats,
  hasShader: spec.wgsl.includes("let next_values_2: f32 = ((state.values[2] + gain[2]) + input.offsets[2]);")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "record"
    assert payload["stateFields"] == [
        {"name": "count", "offset": 0, "type": "f32", "storage": "f32"},
        {"name": "values", "offset": 4, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3},
    ]
    assert payload["inputFields"] == [
        {"name": "delta", "offset": 0, "type": "f32", "storage": "f32"},
        {"name": "offsets", "offset": 4, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3},
    ]
    assert payload["stateFloats"] == pytest.approx([1.5, 10.0, 20.0, 30.0], abs=1e-6)
    assert payload["inputFloats"] == pytest.approx([2.25, 0.5, 1.5, 2.5], abs=1e-6)
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_float_axis_vector_vector_webgpu_runtime_spec(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "bridge_axis_vector_vector_float_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_axis_vector_vector_float_gpu.typed-ir.json"
    source_path.write_text("bridge axis vector vector float gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1.5},
                                    {"kind": "const", "type": "num", "value": 2.5},
                                    {"kind": "const", "type": "num", "value": 3.5},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<f32>,axis<u>:list<f32>)->axis<u>:list<f32>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<f32>"},
                            {"kind": "param", "name": "input", "type": "axis<u>:list<f32>"},
                        ],
                        "return_type": "axis<u>:list<f32>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<f32>", "axis<u>:list<f32>"],
                            "return_type": "axis<u>:list<f32>",
                            "type": "fn(axis<u>:list<f32>,axis<u>:list<f32>)->axis<u>:list<f32>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<f32>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<f32>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<f32>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<f32>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "axis<u>:list<f32>"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ values: [10.0, 20.0, 30.0] }));
const inputBytes = Array.from(spec.encodeInput({ values: [0.5, 1.5, 2.5] }));
const stateFloats = Array.from(new Float32Array(spec.encodeState({ values: [10.0, 20.0, 30.0] }).buffer));
const inputFloats = Array.from(new Float32Array(spec.encodeInput({ values: [0.5, 1.5, 2.5] }).buffer));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  stateFields: spec.stateFields,
  inputFields: spec.inputFields,
  stateFloats,
  inputFloats,
  stateBytes,
  inputBytes,
  hasShader: spec.wgsl.includes("let next_value_2: f32 = ((state.values[2] + gain[2]) + input.values[2]);")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "axis_vector_vector"
    assert payload["stateFields"] == [
        {"name": "values", "offset": 0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3}
    ]
    assert payload["inputFields"] == [
        {"name": "values", "offset": 0, "type": "axis<u>:list<f32>", "storage": "f32", "axis_key": "u", "axis_length": 3}
    ]
    assert payload["stateFloats"] == pytest.approx([10.0, 20.0, 30.0], abs=1e-6)
    assert payload["inputFloats"] == pytest.approx([0.5, 1.5, 2.5], abs=1e-6)
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_consumes_axis_vector_wasm_runtime(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_axis_wasm.vkf"
    typed_ir_path = tmp_path / "bridge_axis_wasm.typed-ir.json"
    source_path.write_text("bridge axis wasm", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "axis<u>:list<num>"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "axis<u>:list<num>"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "axis<u>:list<num>"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bytes = fs.readFileSync(process.argv[3]);
const runtime = bridge.instantiateWasmRuntime({ manifest, bytes });
runtime.init();
runtime.writeState({ values: [10, 20, 30] });
runtime.writeInput({ values: [5, 6, 7] });
runtime.update();
process.stdout.write(JSON.stringify({
  state: runtime.readState(),
  input: runtime.readInput(),
  stateLayout: runtime.stateLayout(),
  inputLayout: runtime.inputLayout()
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["state"] == {"values": [16, 28, 40]}
    assert payload["input"] == {"values": [5, 6, 7]}
    assert payload["stateLayout"]["axisKey"] == "u"
    assert payload["stateLayout"]["axisLength"] == 3
    assert payload["inputLayout"]["axisKey"] == "u"
    assert payload["inputLayout"]["axisLength"] == 3


def test_compiled_runtime_bridge_reads_computed_axis_f64_wasm_bindings(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_axis_f64_wasm.vkf"
    typed_ir_path = tmp_path / "bridge_axis_f64_wasm.typed-ir.json"
    source_path.write_text("bridge axis f64 wasm", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.0},
                                    {"kind": "const", "type": "num", "value": 1.5707963267948966},
                                    {"kind": "const", "type": "num", "value": 3.141592653589793},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "call",
                            "type": "axis<u>:list<num>",
                            "callee": {
                                "kind": "field_access",
                                "field": "sin",
                                "type": "any",
                                "object": {"kind": "load", "name": "math", "type": "any"},
                                "object_type": "any",
                            },
                            "callee_type": "any",
                            "arg_types": ["axis<u>:list<num>"],
                            "args": [{"kind": "load", "name": "theta", "type": "axis<u>:list<num>"}],
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "scaled_wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "binary_op",
                            "op": "STAR",
                            "type": "axis<u>:list<num>",
                            "left": {"kind": "const", "type": "num", "value": 0.5},
                            "right": {"kind": "load", "name": "wave", "type": "axis<u>:list<num>"},
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_wasm_artifact(smoke_exes["wasm_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const bytes = fs.readFileSync(process.argv[3]);
const runtime = bridge.instantiateWasmRuntime({ manifest, bytes });
process.stdout.write(JSON.stringify({
  bindingsLayout: runtime.bindingsLayout(),
  wave: runtime.readBinding("wave"),
  all: runtime.readBindings()
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["bindingsLayout"][1]["kind"] == "axis_f64_array"
    assert payload["wave"]["axisKey"] == "u"
    assert payload["wave"]["values"] == pytest.approx([0.0, 1.0, 0.0], abs=1e-12)
    assert payload["all"]["scaled_wave"]["values"] == pytest.approx([0.0, 0.5, 0.0], abs=1e-12)


def test_compiled_runtime_bridge_consumes_axis_vector_vector_webgpu_runtime_spec(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_axis_vector_vector_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_axis_vector_vector_gpu.typed-ir.json"
    source_path.write_text("bridge axis vector vector gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "gain",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 1},
                                    {"kind": "const", "type": "num", "value": 2},
                                    {"kind": "const", "type": "num", "value": 3},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        "params": [
                            {"kind": "param", "name": "state", "type": "axis<u>:list<num>"},
                            {"kind": "param", "name": "input", "type": "axis<u>:list<num>"},
                        ],
                        "return_type": "axis<u>:list<num>",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["axis<u>:list<num>", "axis<u>:list<num>"],
                            "return_type": "axis<u>:list<num>",
                            "type": "fn(axis<u>:list<num>,axis<u>:list<num>)->axis<u>:list<num>",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "axis<u>:list<num>",
                                    "value": {
                                        "kind": "binary_op",
                                        "op": "PLUS",
                                        "type": "axis<u>:list<num>",
                                        "left": {
                                            "kind": "binary_op",
                                            "op": "PLUS",
                                            "type": "axis<u>:list<num>",
                                            "left": {"kind": "load", "name": "state", "type": "axis<u>:list<num>"},
                                            "right": {"kind": "load", "name": "gain", "type": "axis<u>:list<num>"},
                                        },
                                        "right": {"kind": "load", "name": "input", "type": "axis<u>:list<num>"},
                                    },
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
const stateBytes = Array.from(spec.encodeState({ values: [10, 20, 30] }));
const inputBytes = Array.from(spec.encodeInput({ values: [5, 6, 7] }));
process.stdout.write(JSON.stringify({
  updateMode: spec.updateMode,
  inputAxisKey: spec.inputAxisKey,
  inputAxisLength: spec.inputAxisLength,
  stateBytes,
  inputBytes,
  hasShader: spec.wgsl.includes("input.values[2]")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["updateMode"] == "axis_vector_vector"
    assert payload["inputAxisKey"] == "u"
    assert payload["inputAxisLength"] == 3
    assert payload["stateBytes"] == [10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0]
    assert payload["inputBytes"] == [5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0]
    assert payload["hasShader"] is True


def test_compiled_runtime_bridge_reads_computed_axis_f64_webgpu_bindings(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "bridge_axis_f64_gpu.vkf"
    typed_ir_path = tmp_path / "bridge_axis_f64_gpu.typed-ir.json"
    source_path.write_text("bridge axis f64 gpu", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "theta",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": 0.0},
                                    {"kind": "const", "type": "num", "value": 1.5707963267948966},
                                    {"kind": "const", "type": "num", "value": 3.141592653589793},
                                ],
                            },
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "wave",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "call",
                            "type": "axis<u>:list<num>",
                            "callee": {
                                "kind": "field_access",
                                "field": "sin",
                                "type": "any",
                                "object": {"kind": "load", "name": "math", "type": "any"},
                                "object_type": "any",
                            },
                            "callee_type": "any",
                            "arg_types": ["axis<u>:list<num>"],
                            "args": [{"kind": "load", "name": "theta", "type": "axis<u>:list<num>"}],
                        },
                    },
                    {
                        "kind": "function",
                        "name": "vkf_update",
                        "type": "fn(num,num)->num",
                        "params": [
                            {"kind": "param", "name": "state", "type": "num"},
                            {"kind": "param", "name": "input", "type": "num"},
                        ],
                        "return_type": "num",
                        "signature": {
                            "kind": "function_signature",
                            "params": ["num", "num"],
                            "return_type": "num",
                            "type": "fn(num,num)->num",
                        },
                        "body": {
                            "kind": "block",
                            "body": [
                                {
                                    "kind": "return",
                                    "type": "num",
                                    "value": {"kind": "load", "name": "state", "type": "num"},
                                }
                            ],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    result = json.loads(_run_webgpu_artifact(smoke_exes["webgpu_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    manifest_path = Path(result["manifest_path"])
    script = r"""
const fs = require("fs");
const bridge = require(process.argv[1]);
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const wgsl = fs.readFileSync(process.argv[3], "utf8");
const spec = bridge.createWebGpuRuntimeSpec({ manifest, wgsl });
process.stdout.write(JSON.stringify({
  bindings: spec.bindings,
  theta: spec.readBinding("theta"),
  wave: spec.readBinding("wave")
}));
"""
    payload = json.loads(_run_node(script, str(COMPILED_RUNTIME_BRIDGE_SOURCE), str(manifest_path), str(artifact_path)).stdout)
    assert payload["bindings"][0]["kind"] == "axis_f64_array"
    assert payload["theta"]["axisKey"] == "u"
    assert payload["theta"]["values"] == pytest.approx([0.0, 1.5707963267948966, 3.141592653589793])
    assert payload["wave"]["values"] == pytest.approx([0.0, 1.0, 0.0], abs=1e-6)


def test_native_pipeline_writes_manifest_artifact_and_current_status(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "answer.vkf"
    typed_ir_path = tmp_path / "answer.typed-ir.json"
    source_path.write_text("answer: 42\nprint(answer)", encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    first = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    assert first["status"] == "compiled"
    manifest_path = Path(first["manifest_path"])
    artifact_path = Path(first["artifact_path"])
    assert manifest_path.is_file()
    assert artifact_path.is_file()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "compiled"
    assert manifest["source_path"] == str(source_path.resolve())
    assert len(manifest["source_sha256"]) == 16
    assert len(manifest["typed_ir_sha256"]) == 16
    assert manifest["compiler_version"] == "vkf-artifact-smoke-0.2"
    assert manifest["artifact_path"] == str(artifact_path)
    assert len(manifest["artifact_content_sha256"]) == 16
    assert manifest["runtime_hash"] == manifest["artifact_content_sha256"]
    assert _run_cmd_artifact(artifact_path).stdout.strip() == "42"

    second = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    assert second["status"] == "current"
    assert json.loads(manifest_path.read_text(encoding="utf-8"))["status"] == "current"
    assert _run_cmd_artifact(artifact_path).stdout.strip() == "42"


def test_artifact_script_prints_string_load(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "name.vkf"
    typed_ir_path = tmp_path / "name.typed-ir.json"
    source_path.write_text('name: "Ada"\nprint(name)', encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    result = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)

    assert result["status"] == "compiled"
    assert _run_cmd_artifact(Path(result["artifact_path"])).stdout.strip() == "Ada"


def test_artifact_executes_index_update_inside_local_function(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = """\
Point : (x:num)
step(points:[Point:1]) -> [Point:1]:
    points.0: (x:points.0.x + 1)
    points
out: step([(x:1)])
:: out.0.x
"""
    source_path = tmp_path / "local_index_update.vkf"
    typed_ir_path = tmp_path / "local_index_update.typed-ir.json"
    source_path.write_text(source, encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source, smoke_exes), encoding="utf-8")

    result = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)

    assert _run_cmd_artifact(Path(result["artifact_path"])).stdout.strip() == "2"


def test_artifact_smoke_accepts_axis_aligned_bind_as_compile_only_placeholder(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "axis_align.vkf"
    typed_ir_path = tmp_path / "axis_align.typed-ir.json"
    source_path.write_text("u: [-1, 0, 1] -> u", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "store_binding",
                        "name": "u",
                        "type": "axis<u>:list<num>",
                        "value": {
                            "kind": "axis_align",
                            "axis_key": "u",
                            "type": "axis<u>:list<num>",
                            "value": {
                                "kind": "list",
                                "type": "list<num>",
                                "element_type": "num",
                                "items": [
                                    {"kind": "const", "type": "num", "value": -1},
                                    {"kind": "const", "type": "num", "value": 0},
                                    {"kind": "const", "type": "num", "value": 1},
                                ],
                            },
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    artifact_text = artifact_path.read_text(encoding="utf-8")

    assert result["status"] == "compiled"
    assert artifact_path.is_file()
    assert "rem expr" not in artifact_text


def test_artifact_smoke_recompiles_when_source_or_ir_changes(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "stale.vkf"
    typed_ir_path = tmp_path / "stale.typed-ir.json"
    source_path.write_text("answer: 42", encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json("answer: 42", smoke_exes), encoding="utf-8")

    assert json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)["status"] == "compiled"
    assert json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)["status"] == "current"

    source_path.write_text("answer: 43", encoding="utf-8")
    assert json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)["status"] == "compiled"
    assert json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)["status"] == "current"

    typed_ir_path.write_text(_typed_ir_json("answer: 43\nprint(answer)", smoke_exes), encoding="utf-8")
    assert json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)["status"] == "compiled"


def test_artifact_smoke_recompiles_when_artifact_missing(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "missing_artifact.vkf"
    typed_ir_path = tmp_path / "missing_artifact.typed-ir.json"
    source_path.write_text("answer: 42", encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json("answer: 42", smoke_exes), encoding="utf-8")

    first = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(first["artifact_path"])
    artifact_path.unlink()

    assert json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)["status"] == "compiled"


def test_artifact_smoke_recompiles_when_artifact_tampered(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "tampered.vkf"
    typed_ir_path = tmp_path / "tampered.typed-ir.json"
    source_path.write_text("answer: 42\nprint(answer)", encoding="utf-8")
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    first = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(first["artifact_path"])
    artifact_path.write_text("@echo off\r\necho hacked\r\nexit /b 0\r\n", encoding="utf-8")

    second = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    assert second["status"] == "compiled"
    assert _run_cmd_artifact(artifact_path).stdout.strip() == "42"


def test_function_ir_compiles_to_placeholder_artifact(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "unsupported.vkf"
    typed_ir_path = tmp_path / "unsupported.typed-ir.json"
    source_path.write_text("answer: 42", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "function",
                        "name": "f",
                        "params": [],
                        "return_type": "num",
                        "body": {"kind": "block", "body": []},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(result["artifact_path"])
    assert result["status"] == "compiled"
    assert artifact_path.is_file()
    assert "rem function f" in artifact_path.read_text(encoding="utf-8")


def test_unknown_ir_still_fails_hard_and_writes_no_success_manifest(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "unknown_ir.vkf"
    typed_ir_path = tmp_path / "unknown_ir.typed-ir.json"
    source_path.write_text("answer: 42", encoding="utf-8")
    typed_ir_path.write_text(
        json.dumps({"kind": "typed_module", "body": [{"kind": "mystery_stmt"}]}),
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(smoke_exes["artifact"]), "--source", str(source_path), "--typed-ir", str(typed_ir_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "unsupported typed IR statement kind mystery_stmt" in proc.stderr
    assert "fallback" not in proc.stderr.lower()
    assert not (tmp_path / ".vkfbuild" / "unknown_ir" / "manifest.json").exists()


def test_driver_compile_run_reports_compiled_then_current(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "driver_answer.vkf"
    source_path.write_text("answer: 42\nprint(answer)", encoding="utf-8")

    first = json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)
    assert first["status"] == "compiled"
    assert first["ran"] is True
    assert first["stdout"].strip() == "42"
    assert Path(first["manifest_path"]).is_file()
    assert Path(first["artifact_path"]).is_file()
    assert Path(first["token_path"]).is_file()
    assert Path(first["ast_path"]).is_file()
    assert Path(first["typed_ir_path"]).is_file()
    for key in ("lexer_ms", "parser_ms", "ir_ms", "artifact_ms", "run_ms", "total_ms"):
        assert key in first
        assert isinstance(first[key], (int, float))
        assert first[key] >= 0

    second = json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)
    assert second["status"] == "current"
    assert second["ran"] is True
    assert second["stdout"].strip() == "42"
    for key in ("lexer_ms", "parser_ms", "ir_ms", "artifact_ms", "run_ms", "total_ms"):
        assert key in second
        assert isinstance(second[key], (int, float))
        assert second[key] >= 0


def test_driver_source_change_rebuilds_and_updates_stdout(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "driver_stale.vkf"
    source_path.write_text("answer: 42\nprint(answer)", encoding="utf-8")
    assert json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)["stdout"].strip() == "42"
    assert json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)["status"] == "current"

    source_path.write_text("answer: 43\nprint(answer)", encoding="utf-8")
    changed = json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)
    assert changed["status"] == "compiled"
    assert changed["stdout"].strip() == "43"


def test_driver_function_only_program_compiles_directly_without_output(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "driver_library.vkf"
    source_path.write_text("f(x:num) -> num:\n    @: x", encoding="utf-8")

    result = json.loads(_run_driver(source_path, smoke_exes, run=True, aot=True).stdout)
    assert result["status"] == "compiled"
    assert result["ran"] is True
    assert result["stdout"] == ""
    assert result["artifact_fallback"] is False
    assert Path(result["manifest_path"]).is_file()
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["result_transport"] == "none"
    assert Path(result["artifact_path"]).read_bytes()[:2] == b"MZ"

    typed_ir_path = tmp_path / "driver_library.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    assert arm64_manifest["result_transport"] == "none"
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_direct_x64_accepts_bootstrap_contract_modules(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_paths = [
        ROOT / "compiler" / "self_hosted" / "machine_ir.vkf",
        ROOT / "compiler" / "self_hosted" / "typed_ir.vkf",
        ROOT / "compiler" / "self_hosted" / "native_scene_compiler.vkf",
    ]

    for source_path in source_paths:
        typed_ir_path = tmp_path / f"{source_path.stem}.typed-ir.json"
        typed_ir_path.write_text(
            _typed_ir_json_for_file(source_path, smoke_exes),
            encoding="utf-8",
        )
        summary = json.loads(
            _run_artifact(
                smoke_exes["x64_artifact"], source_path, typed_ir_path
            ).stdout
        )
        manifest = json.loads(
            Path(summary["manifest_path"]).read_text(encoding="utf-8")
        )

        assert manifest["result_transport"] == "none"
        assert Path(summary["artifact_path"]).is_file()


def test_x64_and_arm64_compile_scope_identity_with_outer_aggregate_bindings(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "aggregate-scope-library.vkf"
    source_path.write_text(
        "make_record(value:num) -> any:\n"
        "    (value: value, label: \"record\")\n\n"
        "first: make_record(1)\n"
        "second: make_record(2)\n\n"
        "capability:\n"
        "    name: \"direct\"\n"
        "    :\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "aggregate-scope-library.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    x64_manifest = json.loads(Path(x64["manifest_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))

    assert x64_manifest["result_transport"] == "none"
    assert arm64_manifest["result_transport"] == "none"
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_driver_defers_program_evaluation_until_runtime(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "driver_deferred.vkf"
    source_path.write_text(
        """run(n:num) -> num:
    i: 0
    x: 0
    i < n?>
        x: x + 1
        i: i + 1
    x

:: run(20000)
""",
        encoding="utf-8",
    )

    compiled = json.loads(_run_driver(source_path, smoke_exes).stdout)
    assert compiled["status"] == "compiled"
    assert compiled["artifact_ms"] < 500
    artifact = Path(compiled["artifact_path"]).read_text(encoding="utf-8")
    assert "20000" not in artifact
    assert "--run-typed-ir" in artifact

    ran = json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)
    assert ran["stdout"].strip() == "20000"


def test_x64_artifact_emits_runnable_machine_code(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "scalar.vkf"
    source_path.write_text(
        "advance(x:num, i:num) -> num:\n"
        "    x * 1.00000011920929 + i * 0.0000001\n\n"
        "run(n:num) -> num:\n"
        "    i: 0\n"
        "    x: 1\n"
        "    i < n?>\n"
        "        x: advance(x, i)\n"
        "        i: i + 1\n"
        "    x\n\n"
        ":: run(10)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    machine_ir = json.loads(Path(summary["machine_ir_path"]).read_text(encoding="utf-8"))
    result = subprocess.run([str(artifact_path)], cwd=artifact_path.parent, capture_output=True, text=True, check=True)

    assert artifact_path.is_file()
    artifact_magic = artifact_path.read_bytes()[:4]
    assert artifact_magic[:2] == b"MZ" if os.name == "nt" else artifact_magic == b"\x7fELF"
    assert not artifact_path.with_suffix(".cpp").exists()
    assert manifest["backend"] == ("x64-pe" if os.name == "nt" else "x64-elf")
    assert manifest["artifact_bytes"] == artifact_path.stat().st_size
    if manifest["artifact_writer"] == "stage0-template":
        assert artifact_path.stat().st_size <= smoke_exes["x64_template"].stat().st_size
        assert manifest["artifact_compacted"] is (
            artifact_path.stat().st_size < smoke_exes["x64_template"].stat().st_size
        )
    else:
        assert manifest["artifact_writer"] == "compiler-owned"
        assert manifest["template_bytes"] == 0
        assert artifact_path.stat().st_size < 8192
    assert Path(manifest["code_path"]).read_bytes()
    assert manifest["code_bytes"] > 0
    assert manifest["machine_ir_version"] == 13
    assert manifest["runtime_abi_version"] == 12
    assert Path(manifest["machine_ir"]) == Path(summary["machine_ir_path"])
    assert machine_ir["schema"] == "vektorflow.machine_ir"
    assert machine_ir["version"] == 13
    assert machine_ir["entry"]["name"] == "$entry"
    assert [function["name"] for function in machine_ir["functions"]] == ["advance", "run"]
    assert any(
        instruction["kind"] == "call" and instruction["symbol"] == "run"
        for instruction in machine_ir["entry"]["instructions"]
    )
    assert manifest["target_architecture"] == "x64"
    assert manifest["target_calling_convention"] == ("windows-x64" if os.name == "nt" else "sysv-x64")
    assert manifest["target_object_format"] == ("pe" if os.name == "nt" else "elf")
    assert manifest["target_os"] == ("windows" if os.name == "nt" else "linux")
    if manifest["artifact_writer"] == "stage0-template":
        assert manifest["template_bytes"] == smoke_exes["x64_template"].stat().st_size
    assert float(result.stdout.strip()) == pytest.approx(1.0000056920949698)


@pytest.mark.skipif(sys.platform != "linux", reason="ELF SysV x64 regression")
def test_x64_elf_numeric_wrapper_preserves_stack_alignment(
    tmp_path: Path, smoke_exes: dict[str, Path]
) -> None:
    source_path = tmp_path / "numeric-stack-alignment.vkf"
    source_path.write_text(":: 1\n", encoding="utf-8")
    typed_ir_path = tmp_path / "numeric-stack-alignment.typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(":: 1\n", smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    result = subprocess.run(
        [str(artifact_path)], cwd=artifact_path.parent, capture_output=True, text=True
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "1\n"


def test_arm64_artifact_emits_apple_abi_machine_code(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "scalar-arm64.vkf"
    source_path.write_text(
        "advance(x:num, i:num) -> num:\n"
        "    x * 1.00000011920929 + i * 0.0000001\n\n"
        "run(n:num) -> num:\n"
        "    i: 0\n"
        "    x: 1\n"
        "    i < n?>\n"
        "        x: advance(x, i)\n"
        "        i: i + 1\n"
        "    x\n\n"
        ":: run(10)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    machine_ir = json.loads(Path(summary["machine_ir_path"]).read_text(encoding="utf-8"))
    executable = artifact_path.read_bytes()
    code = Path(summary["raw_code_path"]).read_bytes()
    words = struct.unpack(f"<{len(code) // 4}I", code)

    assert manifest["artifact_format"] == "macho-executable"
    assert manifest["backend"] == "arm64-macho"
    assert manifest["target_architecture"] == "arm64"
    assert manifest["target_calling_convention"] == "apple-arm64"
    assert manifest["target_os"] == "macos"
    assert manifest["target_object_format"] == "macho"
    assert manifest["artifact_bytes"] == len(executable)
    assert manifest["code_bytes"] == len(code)
    assert manifest["machine_ir_version"] == 13
    assert manifest["runtime_abi_version"] == 12
    assert manifest["runtime_imports_complete"] is True
    assert manifest["result_transport"] == "stdout-f64"
    assert machine_ir["schema"] == "vektorflow.machine_ir"
    assert len(code) > 0 and len(code) % 4 == 0
    assert words[:5] == (0xD10083FF, 0xA9007BFD, 0x910003FD, 0xF9000BB3, 0xAA0003F3)
    assert words[-1] == 0xD65F03C0
    assert any((word & 0xFC000000) == 0x94000000 for word in words)
    assert set(manifest["function_offsets"]) == {"$entry", "advance", "run"}
    assert all(offset % 4 == 0 and offset < len(code) for offset in manifest["function_offsets"].values())
    assert executable[:4] == b"\xcf\xfa\xed\xfe"
    signature_offset = manifest["signature_offset"]
    assert signature_offset >= 0x8000
    assert signature_offset % 16 == 0
    assert b"/usr/lib/libSystem.B.dylib" in executable
    assert b"_printf\0" in executable
    assert b"_pow\0" in executable
    assert b"_fmod\0" in executable
    assert b"_floor\0" in executable
    assert b"_log\0" in executable
    assert b"_sin\0" in executable
    assert b"_cos\0" in executable
    assert b"_exp\0" in executable
    assert b"_malloc\0" in executable
    assert b"_free\0" in executable
    assert b"_abort\0" in executable
    assert executable[signature_offset:signature_offset + 4] == b"\xfa\xde\x0c\xc0"
    code_directory_offset = signature_offset + 24
    assert executable[code_directory_offset:code_directory_offset + 4] == b"\xfa\xde\x0c\x02"
    hash_offset = struct.unpack_from(">I", executable, code_directory_offset + 16)[0]
    code_slots = struct.unpack_from(">I", executable, code_directory_offset + 28)[0]
    assert code_slots == 9
    for slot in range(code_slots):
        expected_hash = hashlib.sha256(
            executable[slot * 4096:min((slot + 1) * 4096, signature_offset)]
        ).digest()
        actual_hash = executable[
            code_directory_offset + hash_offset + slot * 32:
            code_directory_offset + hash_offset + (slot + 1) * 32
        ]
        assert actual_hash == expected_hash


def test_arm64_artifact_calls_runtime_abi_for_power(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "power-arm64.vkf"
    source_path.write_text("base: 2\nexponent: 8\n:: base ^ exponent\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    code = Path(summary["raw_code_path"]).read_bytes()
    words = struct.unpack(f"<{len(code) // 4}I", code)

    assert 0xF9400269 in words
    assert 0xD63F0120 in words


def test_arm64_artifact_calls_runtime_abi_for_remainder(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "remainder-arm64.vkf"
    source_path.write_text("left: 5.5\nright: 2\n:: left % right\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    code = Path(summary["raw_code_path"]).read_bytes()
    words = struct.unpack(f"<{len(code) // 4}I", code)

    assert 0xF9400669 in words
    assert 0xD63F0120 in words


def test_arm64_artifact_calls_runtime_abi_for_floor_division(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "floor-division-arm64.vkf"
    source_path.write_text("left: -5.5\nright: 2\n:: left // right\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    code = Path(summary["raw_code_path"]).read_bytes()
    words = struct.unpack(f"<{len(code) // 4}I", code)

    assert 0x1E611800 in words
    assert 0xF9400A69 in words
    assert 0xD63F0120 in words


def test_arm64_artifact_emits_short_circuit_branches(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    for index, (expression, branch) in enumerate((("false /\\ true", 0x34000009), ("true \\/ false", 0x35000009))):
        case_dir = tmp_path / str(index)
        case_dir.mkdir()
        source_path = case_dir / "logic-arm64.vkf"
        source_path.write_text(f":: {expression}\n", encoding="utf-8")
        typed_ir_path = case_dir / "typed-ir.json"
        typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

        summary = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
        code = Path(summary["raw_code_path"]).read_bytes()
        words = struct.unpack(f"<{len(code) // 4}I", code)

        assert any((word & 0xFF00001F) == branch for word in words)


def test_x64_artifact_emits_top_level_scalar_bindings(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "top-level-bindings.vkf"
    source_path.write_text("answer: 40\nbonus: 2\n:: answer + bonus\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    result = subprocess.run([str(artifact_path)], cwd=artifact_path.parent, capture_output=True, text=True, check=True)

    assert float(result.stdout.strip()) == 42


def test_x64_artifact_calls_runtime_abi_for_scalar_power(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "power.vkf"
    source_path.write_text("base: 2\nexponent: 8\n:: base ^ exponent\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    machine_ir = json.loads(Path(summary["machine_ir_path"]).read_text(encoding="utf-8"))
    result = subprocess.run([str(artifact_path)], cwd=artifact_path.parent, capture_output=True, text=True, check=True)

    assert any(
        instruction["kind"] == "power_f64"
        for instruction in machine_ir["entry"]["instructions"]
    )
    assert float(result.stdout.strip()) == 256


def test_x64_artifact_calls_runtime_abi_for_scalar_remainder(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "remainder.vkf"
    source_path.write_text("left: 5.5\nright: 2\n:: left % right\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    machine_ir = json.loads(Path(summary["machine_ir_path"]).read_text(encoding="utf-8"))
    result = subprocess.run([str(artifact_path)], cwd=artifact_path.parent, capture_output=True, text=True, check=True)

    assert any(
        instruction["kind"] == "remainder_f64"
        for instruction in machine_ir["entry"]["instructions"]
    )
    assert float(result.stdout.strip()) == 1.5


def test_x64_artifact_calls_runtime_abi_for_scalar_floor_division(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "floor-division.vkf"
    source_path.write_text("left: -5.5\nright: 2\n:: left // right\n", encoding="utf-8")
    typed_ir_path = tmp_path / "typed-ir.json"
    typed_ir_path.write_text(_typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8")

    summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact_path = Path(summary["artifact_path"])
    machine_ir = json.loads(Path(summary["machine_ir_path"]).read_text(encoding="utf-8"))
    result = subprocess.run([str(artifact_path)], cwd=artifact_path.parent, capture_output=True, text=True, check=True)

    assert any(
        instruction["kind"] == "floor_divide_f64"
        for instruction in machine_ir["entry"]["instructions"]
    )
    assert float(result.stdout.strip()) == -3


def test_x64_and_arm64_artifacts_call_direct_math_runtime_intrinsics(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "math-runtime.vkf"
    source_path.write_text(
        ":: math.sqrt(81) + math.sin(0) + math.cos(0) + math.exp(0) + "
        "math.abs(-3)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "math-runtime.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8"
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run([str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True)
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )
    assert float(result.stdout.strip()) == pytest.approx(14)
    assert {"abs_f64", "sqrt_f64", "sin_f64", "cos_f64", "exp_f64"}.issubset(
        {instruction["kind"] for instruction in machine_ir["entry"]["instructions"]}
    )
    assert {0x1E61C000, 0xF9401269, 0xF9401669, 0xF9401A69}.issubset(set(arm_words))
    assert 0x1E60C000 in set(arm_words)


def test_x64_artifact_imports_only_used_math_runtime_functions(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "sqrt-only.vkf"
    source_path.write_text(":: math.sqrt(81)\n", encoding="utf-8")
    typed_ir_path = tmp_path / "sqrt-only.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8"
    )

    summary = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(summary["artifact_path"])
    executable = artifact.read_bytes()
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )

    assert float(result.stdout.strip()) == 9
    for unused in (b"pow\0", b"fmod\0", b"floor\0", b"sqrt\0", b"sin\0", b"cos\0", b"exp\0"):
        assert unused not in executable


def test_time_stdlib_is_direct_and_has_no_language_toolchain_runtime(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "direct-time.vkf"
    source_path.write_text(
        "time_api: .time\n"
        "before: time.monotonic_seconds()\n"
        "time.sleep_seconds(0.001)\n"
        "now: time.wall_seconds()\n"
        "parts: time.local_parts(now)\n"
        ":: time.monotonic_seconds() >= before\n"
        ":: now > 1700000000\n"
        ":: parts.year\n",
        encoding="utf-8",
    )

    summary = json.loads(_run_driver(source_path, smoke_exes, run=True, aot=True).stdout)
    artifact = Path(summary["artifact_path"])
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    executable = artifact.read_bytes()
    lowered_executable = executable.lower()
    output_lines = summary["stdout"].splitlines()

    assert summary["artifact_fallback"] is False
    assert manifest["artifact_writer"] == "compiler-owned"
    assert manifest["template_bytes"] == 0
    assert output_lines[:2] == ["true", "true"]
    assert int(output_lines[2]) >= 2026
    for forbidden in (b"python", b"clang", b"g++", b"c++", b".cpp", b"assembler"):
        assert forbidden not in lowered_executable

    if os.name == "nt":
        for runtime_import in (
            b"QueryPerformanceCounter\0",
            b"QueryPerformanceFrequency\0",
            b"GetSystemTimePreciseAsFileTime\0",
            b"Sleep\0",
            b"_localtime64_s\0",
        ):
            assert runtime_import in executable

    typed_ir_path = tmp_path / "direct-time.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    arm64_artifact = Path(arm64["artifact_path"]).read_bytes()
    for runtime_import in (b"_clock_gettime\0", b"_nanosleep\0", b"_localtime_r\0"):
        assert runtime_import in arm64_artifact
    for forbidden in (b"python", b"clang", b"g++", b"c++", b".cpp", b"assembler"):
        assert forbidden not in arm64_artifact.lower()


def test_system_stdlib_uses_native_host_apis_on_x64_and_arm64(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "direct-system.vkf"
    source_path.write_text(
        "system_api: .system\n"
        "present: system_api.env_native(\"PATH\")\n"
        "missing: system_api.env_native(\"VKF_MISSING_SYSTEM_TEST_0_1_0\")\n"
        ":: system_api.os_name()\n"
        ":: system_api.arch_name()\n"
        ":: system_api.cpu_count_native() > 0\n"
        ":: system_api.cwd_native()\n"
        ":: present.found\n"
        ":: missing.found\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "direct-system.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    executable_path = Path(x64["artifact_path"])
    executed = subprocess.run(
        [str(executable_path)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )
    output = executed.stdout.splitlines()
    assert output[0] in {"windows", "linux"}
    assert output[1] == "x86_64"
    assert output[2] == "true"
    assert Path(output[3]).resolve() == tmp_path.resolve()
    assert output[4:] == ["true", "false"]
    executable = executable_path.read_bytes()
    expected_x64_imports = (
        (b"GetActiveProcessorCount\0", b"_getcwd\0")
        if os.name == "nt"
        else (b"sysconf\0", b"getcwd\0")
    )
    for runtime_import in (*expected_x64_imports, b"getenv\0", b"strlen\0", b"memcpy\0"):
        assert runtime_import in executable

    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    arm64_artifact = Path(arm64["artifact_path"]).read_bytes()
    for runtime_import in (
        b"_sysconf\0", b"_getcwd\0", b"_getenv\0", b"_strlen\0", b"_memcpy\0"
    ):
        assert runtime_import in arm64_artifact
    for forbidden in (b"python", b"clang", b"g++", b"c++", b".cpp", b"assembler"):
        assert forbidden not in arm64_artifact.lower()


def test_process_stdlib_runs_exact_argv_and_captures_both_streams(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    if os.name == "nt":
        program = "cmd.exe"
        arguments = '["/d", "/c", "(<nul set /p =hello)&(<nul set /p =error>&2)&exit /b 7"]'
    else:
        program = "/bin/sh"
        arguments = '["-c", "printf hello; printf error >&2; exit 7"]'
    source_path = tmp_path / "direct-process.vkf"
    source_path.write_text(
        "process_api: .process\n"
        f'result: process_api.run_native("{program}", {arguments})\n'
        ":: result.code\n"
        ":: result.out\n"
        ":: result.err\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "direct-process.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    executable_path = Path(x64["artifact_path"])
    executed = subprocess.run(
        [str(executable_path)], cwd=tmp_path, capture_output=True, text=True, check=True
    )
    assert executed.stdout.splitlines() == ["7", "hello", "error"]

    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    arm64_artifact = Path(arm64["artifact_path"]).read_bytes()
    for runtime_import in (
        b"_tmpfile\0", b"_fileno\0", b"_fclose\0", b"_dup2\0",
        b"_fork\0", b"_execvp\0", b"_waitpid\0", b"__exit\0",
    ):
        assert runtime_import in arm64_artifact
    for forbidden in (b"python", b"clang", b"g++", b"c++", b".cpp", b"assembler"):
        assert forbidden not in arm64_artifact.lower()


def test_capture_stdlib_compiles_typed_linear_patterns_to_native_code(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "direct-capture.vkf"
    source_path.write_text(
        "capture_api: .capture\n"
        "named: capture_api.regex(\"values are 123 and 45\", "
        "'values are (?P<a>\\d+) and (?P<b>\\d+)')\n"
        "positional: capture_api.groups(\"id=A_19\", 'id=([A-Z]\\w+)')\n"
        "whole: capture_api.regex(\"prefix needle suffix\", 'needle')\n"
        "anchored: capture_api.regex(\"2026-08\", "
        "'^(?P<year>\\d{4})-(?P<month>\\d{2})$')\n"
        ":: named.a\n"
        ":: named.b\n"
        ":: positional.(0)\n"
        ":: whole._\n"
        ":: anchored.year\n"
        ":: anchored.month\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "direct-capture.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    executable_path = Path(x64["artifact_path"])
    executed = subprocess.run(
        [str(executable_path)], cwd=tmp_path, capture_output=True, text=True, check=True
    )
    assert executed.stdout.splitlines() == ["123", "45", "A_19", "needle", "2026", "08"]
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    captures = [
        instruction
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
        if instruction["kind"] == "capture_regex"
    ]
    assert len(captures) == 4
    assert [capture["group_count"] for capture in captures] == [2, 1, 1, 2]

    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    arm64_artifact = Path(arm64["artifact_path"]).read_bytes()
    assert len(arm64_artifact) > 0
    for forbidden in (b"python", b"clang", b"g++", b"c++", b".cpp", b"assembler"):
        assert forbidden not in arm64_artifact.lower()


def test_driver_eval_shorthand_does_not_invent_stdlib_dependency(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    proc = subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--aot",
            "-e", ":: 2 ^ 8",
            "--lexer", str(smoke_exes["lexer"]),
            "--parser", str(smoke_exes["parser"]),
            "--ir", str(smoke_exes["ir"]),
            "--artifact", str(smoke_exes["x64_artifact"]),
            "--x64-template", str(smoke_exes["x64_template"]),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    assert summary["artifact_fallback"] is False
    assert float(summary["stdout"].strip()) == 256


def test_driver_default_aot_pipeline_runs_frontend_in_process(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "--diagnostics", "-e", ":: 2 ^ 8"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    assert summary["diagnostics_emitted"] is True
    assert Path(summary["token_path"]).is_file()
    assert Path(summary["ast_path"]).is_file()
    assert Path(summary["typed_ir_path"]).is_file()
    assert summary["frontend_mode"] == "integrated"
    assert summary["artifact_fallback"] is False
    assert manifest["artifact_writer"] == "compiler-owned"
    assert manifest["template_bytes"] == 0
    assert Path(summary["artifact_path"]).is_relative_to(tmp_path)
    assert ".vkf-eval" in Path(summary["artifact_path"]).parts
    assert float(summary["stdout"].strip()) == 256


def test_driver_default_aot_skips_diagnostic_sidecars(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "-e", ":: 2 ^ 8"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    assert summary["diagnostics_emitted"] is False
    assert "token_path" not in summary
    assert "ast_path" not in summary
    assert "typed_ir_path" not in summary
    assert "manifest_path" not in summary
    assert Path(summary["artifact_path"]).is_file()
    assert float(summary["stdout"].strip()) == 256


def test_driver_direct_aot_links_spilled_file_module(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    helper = tmp_path / "helper.vkf"
    helper.write_text(
        "increment(value:num) -> num:\n"
        "    value + 1\n\n"
        "twice(value:num) -> num:\n"
        "    increment(value) * 2\n",
        encoding="utf-8",
    )
    source = tmp_path / "main.vkf"
    source.write_text(
        ': ."helper.vkf"\n\n'
        ":: twice(20)\n",
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "--source", str(source), "--run"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    assert summary["artifact_fallback"] is False
    assert float(summary["stdout"].strip()) == 42


def test_driver_direct_aot_links_aliased_file_module(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    helper = tmp_path / "helper.vkf"
    helper.write_text(
        "increment(value:num) -> num:\n"
        "    value + 1\n\n"
        "twice(value:num) -> num:\n"
        "    increment(value) * 2\n",
        encoding="utf-8",
    )
    source = tmp_path / "main.vkf"
    source.write_text(
        'helper: ."helper.vkf"\n\n'
        ":: helper.twice(20)\n",
        encoding="utf-8",
    )

    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "--source", str(source), "--run"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    assert summary["artifact_fallback"] is False
    assert float(summary["stdout"].strip()) == 42


def test_x64_and_arm64_artifacts_specialize_any_parameters_by_call_layout(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "polymorphic-any.vkf"
    source.write_text(
        "box(values:any):\n"
        "    (values: values)\n\n"
        'small: box(["a"])\n'
        'large: box(["b", "c", "d"])\n'
        ":: small.values.0 & large.values.2\n",
        encoding="utf-8",
    )
    typed_ir = tmp_path / "polymorphic-any.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source, typed_ir).stdout)
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert result.stdout == "ad\n"
    assert {function["name"] for function in machine_ir["functions"]} == {
        "box$vkf$0",
        "box$vkf$1",
    }
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_artifact_preserves_specialized_any_layouts_in_block_records(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "polymorphic-any-block.vkf"
    source.write_text(
        "box(values:any):\n"
        "    (values: values)\n\n"
        'small: box(["a"])\n'
        'large: box(["b", "c", "d"])\n'
        "catalog:\n"
        "    whitespace: small\n"
        "    numbers: large\n"
        "    :\n"
        ":: catalog.whitespace.values.0 & catalog.numbers.values.2\n",
        encoding="utf-8",
    )
    typed_ir = tmp_path / "polymorphic-any-block.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )

    assert result.stdout == "ad\n"


def test_x64_and_arm64_artifacts_skip_unreachable_functions(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "unreachable-function.vkf"
    source.write_text(
        "unused(value:num):\n"
        "    unavailable_runtime_primitive(value)\n\n"
        ":: 42\n",
        encoding="utf-8",
    )
    typed_ir = tmp_path / "unreachable-function.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source, typed_ir).stdout)
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert float(result.stdout.strip()) == 42
    assert machine_ir["functions"] == []
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_self_hosted_lexer_seed_compiles_direct_x64_and_arm64(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    typed_ir = tmp_path / "lexer.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source, typed_ir).stdout)
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert {function["name"] for function in machine_ir["functions"]} == {
        "scanner_state$vkf$0",
        "scanner_state$vkf$1",
        "scanner_state$vkf$2",
        "scanner_state$vkf$3",
    }
    assert Path(x64["artifact_path"]).exists()
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_emit_mixed_output_sequences(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "mixed-output.vkf"
    source.write_text(
        'greeting: "alpha"\n'
        ":: greeting\n"
        ":: 42\n"
        ':: "omega"\n',
        encoding="utf-8",
    )
    typed_ir = tmp_path / "mixed-output.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source, typed_ir).stdout)
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    x64_manifest = json.loads(Path(x64["manifest_path"]).read_text(encoding="utf-8"))
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))

    assert result.stdout == "alpha\n42\nomega\n"
    assert machine_ir["output_kind"] == "mixed_sequence"
    assert machine_ir["outputs"] == ["string", "f64", "string"]
    assert machine_ir["entry"]["instructions"][-1]["result_count"] == 5
    assert x64_manifest["result_transport"] == "stdout-value-sequence"
    assert arm64_manifest["result_transport"] == "stdout-value-sequence"
    assert x64_manifest["output_count"] == arm64_manifest["output_count"] == 3


def test_x64_and_arm64_artifacts_render_core_structured_values(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "structured-output.vkf"
    source.write_text(
        "point: (3, 4)\n"
        "named: (x: 3, y: 4)\n"
        "values: [1, 2, 3, 4]\n"
        ":: true\n"
        ":: null\n"
        ":: point\n"
        ":: named\n"
        ":: values\n",
        encoding="utf-8",
    )
    typed_ir = tmp_path / "structured-output.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source, typed_ir).stdout)
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))

    assert result.stdout == "true\nnull\n(3, 4)\n(x:3, y:4)\n[1, 2, 3, 4]\n"
    assert machine_ir["output_kind"] == "structured_sequence"
    assert machine_ir["output_count"] == 5
    token_kinds = [token["kind"] for token in machine_ir["output_tokens"]]
    assert token_kinds[:4] == ["bit", "text", "null", "text"]
    assert token_kinds.count("f64") == 8
    assert token_kinds.count("text") == 18
    assert arm64_manifest["result_transport"] == "stdout-display-plan"
    assert arm64_manifest["output_count"] == 5


def test_x64_artifact_renders_single_structured_resource_value(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "single-structured-output.vkf"
    source.write_text(':: (name: "Ada", ok: true)\n', encoding="utf-8")
    typed_ir = tmp_path / "single-structured-output.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert result.stdout == "(name:Ada, ok:true)\n"
    assert machine_ir["output_kind"] == "structured_sequence"
    assert machine_ir["output_count"] == 1
    assert machine_ir["entry"]["instructions"][-1]["result_count"] == 3


def test_x64_artifact_renders_untyped_function_results(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = tmp_path / "inferred-display.vkf"
    source.write_text(
        'word(): "ready"\n'
        "point(): (x: 3, y: 4)\n"
        ":: word()\n"
        ":: point()\n",
        encoding="utf-8",
    )
    typed_ir = tmp_path / "inferred-display.typed-ir.json"
    typed_ir.write_text(_typed_ir_json_for_file(source, smoke_exes), encoding="utf-8")

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source, typed_ir).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )

    assert result.stdout == "ready\n(x:3, y:4)\n"


def test_driver_direct_aot_links_and_runs_physics_collision_module(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = ROOT / "compiler" / "self_hosted" / "stdlib" / "physics_collision_matrix_smoke.vkf"
    proc = subprocess.run(
        [
            str(smoke_exes["driver"]), "--aot", "--diagnostics",
            "--source", str(source), "--run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    assert summary["artifact_fallback"] is False
    assert [float(row) for row in summary["stdout"].splitlines()] == pytest.approx(
        [5 / 6, 10.8]
    )
    x64_manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source, Path(summary["typed_ir_path"])).stdout
    )
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    assert x64_manifest["result_transport"] == "stdout-f64-sequence"
    assert x64_manifest["output_count"] == 2
    assert arm64_manifest["result_transport"] == "stdout-f64-sequence"
    assert arm64_manifest["output_count"] == 2


def test_driver_direct_aot_links_and_runs_physics_contact_module(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = ROOT / "compiler" / "self_hosted" / "stdlib" / "physics_contact_model_smoke.vkf"
    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "--source", str(source), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    rows = [float(row) for row in summary["stdout"].splitlines()]
    assert summary["artifact_fallback"] is False
    assert len(rows) == 9
    assert rows[:5] == pytest.approx([0.5, 0.25, 0.6, 0.4, 0.05])


def test_driver_direct_aot_links_and_runs_rigid_body_module(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source = ROOT / "compiler" / "self_hosted" / "stdlib" / "physics_rigid_body_smoke.vkf"
    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "--source", str(source), "--run"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    summary = json.loads(proc.stdout)
    rows = [float(row) for row in summary["stdout"].splitlines()]
    assert summary["artifact_fallback"] is False
    assert len(rows) == 5
    assert rows[:2] == pytest.approx([1, 0.25])


def test_x64_artifact_lowers_scalar_logic_with_short_circuit_branches(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    cases = [
        ("false /\\ true", "false", "jump_if_false"),
        ("true \\/ false", "true", "jump_if_true"),
        ("true >< false", "true", "logical_xor_f64"),
        ("~true", "false", "logical_not_f64"),
    ]
    for index, (expression, expected, required_instruction) in enumerate(cases):
        case_dir = tmp_path / str(index)
        case_dir.mkdir()
        source_path = case_dir / "logic.vkf"
        source_path.write_text(f":: {expression}\n", encoding="utf-8")
        typed_ir_path = case_dir / "typed-ir.json"
        typed_ir_path.write_text(
            _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
            encoding="utf-8",
        )

        summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
        artifact_path = Path(summary["artifact_path"])
        machine_ir = json.loads(Path(summary["machine_ir_path"]).read_text(encoding="utf-8"))
        result = subprocess.run(
            [str(artifact_path)],
            cwd=artifact_path.parent,
            capture_output=True,
            text=True,
            check=True,
        )

        assert required_instruction in [
            instruction["kind"] for instruction in machine_ir["entry"]["instructions"]
        ]
        assert result.stdout.strip() == expected


def test_x64_artifact_uses_ordered_ieee_nan_comparisons(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    cases = [("<", "false"), ("<=", "false"), ("==", "false"),
             ("!=", "true"), (">", "false"), (">=", "false")]
    for index, (operator, expected) in enumerate(cases):
        case_dir = tmp_path / str(index)
        case_dir.mkdir()
        source_path = case_dir / "nan-comparison.vkf"
        source_path.write_text(f"nan: 0 / 0\n:: nan {operator} nan\n", encoding="utf-8")
        typed_ir_path = case_dir / "typed-ir.json"
        typed_ir_path.write_text(
            _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
            encoding="utf-8",
        )

        summary = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
        artifact_path = Path(summary["artifact_path"])
        result = subprocess.run(
            [str(artifact_path)],
            cwd=artifact_path.parent,
            capture_output=True,
            text=True,
            check=True,
        )

        assert result.stdout.strip() == expected


def test_driver_emits_direct_machine_code_for_fixed_vector_ir(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "fixed-vector.vkf"
    template = (ROOT / "benchmarks" / "core-comparison" / "programs" / "fixed-vector.vkf").read_text(encoding="utf-8")
    source_path.write_text(template.replace("{{COUNT}}", "10"), encoding="utf-8")
    proc = subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--aot",
            "--source", str(source_path),
            "--lexer", str(smoke_exes["lexer"]),
            "--parser", str(smoke_exes["parser"]),
            "--ir", str(smoke_exes["ir"]),
            "--artifact", str(smoke_exes["x64_artifact"]),
            "--x64-template", str(smoke_exes["x64_template"]),
            "--fallback-artifact", str(smoke_exes["cpp_aot"]),
            "--run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    summary = json.loads(proc.stdout)

    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    machine_ir = json.loads(Path(manifest["machine_ir"]).read_text(encoding="utf-8"))

    assert summary["artifact_fallback"] is False
    assert manifest["artifact_writer"] == "compiler-owned"
    assert manifest["template_bytes"] == 0
    assert any(
        instruction["kind"] == "return_values" and instruction["result_count"] == 4
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    )
    assert any(
        instruction["kind"] == "call"
        and instruction["argument_count"] == 4
        and instruction["result_count"] == 4
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    )
    assert Path(summary["artifact_path"]).is_file()
    assert float(summary["stdout"].strip()) == pytest.approx(10.000016999554949)


def test_x64_and_arm64_artifacts_reduce_fixed_numeric_containers(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "fixed-reductions.vkf"
    source_path.write_text(
        "values: [1, 2, 3, 4]\n"
        ":: stat.sum(values) + stat.mean(values) + stat.count(values)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "fixed-reductions.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_code = Path(arm64["raw_code_path"]).read_bytes()
    arm_words = struct.unpack(f"<{len(arm_code) // 4}I", arm_code)

    reductions = [
        instruction
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] in {"sum_f64_values", "mean_f64_values", "count_values"}
    ]
    assert float(result.stdout.strip()) == pytest.approx(16.5)
    assert {instruction["kind"] for instruction in reductions} == {
        "sum_f64_values",
        "mean_f64_values",
        "count_values",
    }
    assert all(instruction["argument_count"] == 4 for instruction in reductions)
    assert 0x1E602820 in arm_words
    assert 0x1E611800 in arm_words


def test_driver_reduces_large_fixed_container_without_fallback(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    values = ", ".join(str(value) for value in range(1, 161))
    source_path = tmp_path / "large-fixed-reductions.vkf"
    source_path.write_text(
        f"values: [{values}]\n"
        ":: stat.sum(values) + stat.mean(values) + stat.count(values)\n",
        encoding="utf-8",
    )
    proc = subprocess.run(
        [
            str(smoke_exes["driver"]),
            "--aot",
            "--diagnostics",
            "--source",
            str(source_path),
            "--run",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    summary = json.loads(proc.stdout)
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))
    machine_ir = json.loads(Path(manifest["machine_ir"]).read_text(encoding="utf-8"))
    arm64 = json.loads(
        _run_artifact(
            smoke_exes["arm64_artifact"], source_path, Path(summary["typed_ir_path"])
        ).stdout
    )
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))

    assert summary["frontend_mode"] == "integrated"
    assert summary["artifact_fallback"] is False
    assert manifest["artifact_writer"] == "compiler-owned"
    assert float(summary["stdout"].strip()) == pytest.approx(13120.5)
    assert [
        instruction["argument_count"]
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] in {"sum_f64_locals", "mean_f64_locals", "count_local_values"}
    ] == [160, 160, 160]
    assert arm64_manifest["code_bytes"] > 4096
    assert Path(arm64["artifact_path"]).read_bytes()[:4] == b"\xcf\xfa\xed\xfe"


def test_x64_and_arm64_artifacts_scalarize_fixed_records(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "record-call.vkf"
    source_path.write_text(
        "swap(point:(x:num, y:num)) -> (x:num, y:num):\n"
        "    (x: point.y, y: point.x)\n\n"
        "run() -> num:\n"
        "    point: (x: 1, y: 2)\n"
        "    moved: swap(point)\n"
        "    shape: (origin: (x: 1, y: 2), weight: 3)\n"
        "    moved.x + moved.y + shape.origin.y + shape.weight\n\n"
        ":: run()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "record-call.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    x64_artifact = Path(x64["artifact_path"])
    x64_result = subprocess.run(
        [str(x64_artifact)], cwd=x64_artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    machine_ir = json.loads(Path(arm64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert float(x64_result.stdout.strip()) == 8
    assert Path(arm64["artifact_path"]).read_bytes()[:4] == b"\xcf\xfa\xed\xfe"
    assert any(
        instruction["kind"] == "return_values" and instruction["result_count"] == 2
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    )


def test_x64_and_arm64_project_top_level_dynamic_list_into_fixed_call_parameter(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "top-level-fixed-call.vkf"
    source_path.write_text(
        "sum2(values:[num:2]) -> num:\n"
        "    values.0 + values.1\n\n"
        "values: [1, 2]\n"
        ":: sum2(values)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "top-level-fixed-call.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    machine_ir = json.loads(Path(arm64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert float(result.stdout.strip()) == 3
    assert Path(arm64["artifact_path"]).read_bytes()[:4] == b"\xcf\xfa\xed\xfe"
    assert any(
        instruction["kind"] == "call" and instruction["argument_count"] == 2
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    )


def test_x64_and_arm64_project_dynamic_list_nested_in_record_call_parameter(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "nested-list-record-call.vkf"
    source_path.write_text(
        "total(state:(pts:[num:2], weight:num), extra:[num:2]) -> num:\n"
        "    moved: state.pts + extra\n"
        "    moved.0 + moved.1 + state.weight\n\n"
        "state: (pts: [1, 2], weight: 3)\n"
        "extra: [10, 20]\n"
        ":: total(state, extra)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "nested-list-record-call.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    machine_ir = json.loads(Path(arm64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert float(result.stdout.strip()) == 36
    assert Path(arm64["artifact_path"]).read_bytes()[:4] == b"\xcf\xfa\xed\xfe"
    assert any(
        instruction["kind"] == "call" and instruction["argument_count"] == 5
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    )


def test_private_aggregate_abi_carries_values_beyond_register_count(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "wide-vector.vkf"
    source_path.write_text(
        "identity(v:[num:12]) -> [num:12]:\n"
        "    v\n\n"
        "run() -> num:\n"
        "    values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]\n"
        "    copied: identity(values)\n"
        "    copied.0 + copied.5 + copied.11\n\n"
        ":: run()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "wide-vector.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run([str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True)
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    machine_ir = json.loads(Path(arm64["machine_ir_path"]).read_text(encoding="utf-8"))

    assert float(result.stdout.strip()) == 19
    assert any(
        instruction["kind"] == "call"
        and instruction["argument_count"] == 12
        and instruction["result_count"] == 12
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    )


def test_x64_and_arm64_artifacts_lower_string_values_directly(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "string-call.vkf"
    source_path.write_text(
        "identity(value:str) -> str:\n"
        "    value\n\n"
        "message: (text: \"direct native string\")\n"
        ":: identity(message.text)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "string-call.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    x64_manifest = json.loads(Path(x64["manifest_path"]).read_text(encoding="utf-8"))
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )

    assert result.stdout == "direct native string\n"
    assert x64_manifest["result_transport"] == "stdout-string"
    assert arm64_manifest["result_transport"] == "stdout-string"
    assert x64_manifest["runtime_abi_version"] == 12
    assert arm64_manifest["runtime_abi_version"] == 12
    assert machine_ir["output_kind"] == "string"
    assert machine_ir["string_bytes"] == len("direct native string")
    assert any(
        instruction["kind"] == "push_string"
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    )
    assert 0xF9401E69 in arm_words


def test_x64_and_arm64_artifacts_own_borrow_index_and_release_dynamic_numeric_lists(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "dynamic-list.vkf"
    source_path.write_text(
        "measure(values:[num]) -> num:\n"
        "    values.(1): 10\n"
        "    stat.sum(values) + stat.mean(values) + stat.count(values) + values.(2)\n\n"
        "[num] values: [1, 2, 3, 4]\n"
        ":: measure(values) + stat.sum(collections.list(5, 6)) + collections.list(7, 8).(1)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "dynamic-list.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    x64_manifest = json.loads(Path(x64["manifest_path"]).read_text(encoding="utf-8"))
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm64_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )

    instruction_kinds = {
        instruction["kind"]
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    }
    assert float(result.stdout.strip()) == pytest.approx(48.5)
    assert x64_manifest["runtime_abi_version"] == 12
    assert arm64_manifest["runtime_abi_version"] == 12
    assert machine_ir["entry"]["owned_f64_list_locals"] == [0]
    assert {
        "make_owned_f64_list",
        "sum_f64_list",
        "mean_f64_list",
        "count_f64_list",
        "load_f64_list_index",
        "store_f64_list_index",
        "release_f64_list_local",
    } <= instruction_kinds
    assert {
        instruction.get("owns_input")
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
        if instruction["kind"] in {
            "sum_f64_list", "mean_f64_list", "count_f64_list", "load_f64_list_index"
        }
    } == {False, True}
    assert {0xF9402269, 0xF9402669, 0xF9402A69, 0xFD000960} <= set(arm_words)
    executable = artifact.read_bytes()
    assert b"malloc\0" in executable
    assert b"free\0" in executable
    assert b"abort\0" in executable


def test_x64_and_arm64_artifacts_compute_variance_and_std_for_fixed_and_dynamic_lists(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "stat-std.vkf"
    source_path.write_text(
        "[num:16] fixed: [2, 4, 4, 4, 5, 5, 7, 9, 2, 4, 4, 4, 5, 5, 7, 9]\n"
        "[num] dynamic: collections.list(2, 4, 4, 4, 5, 5, 7, 9)\n"
        ":: stat.std(fixed) + stat.std(dynamic) + "
        "stat.std([2, 4, 4, 4, 5, 5, 7, 9]) + "
        "stat.std(collections.list(2, 4, 4, 4, 5, 5, 7, 9)) + "
        "stat.std(collections.list(-2, 0, 2), ddof:1) + "
        "stat.variance(fixed) + stat.variance(dynamic) + "
        "stat.variance([2, 4, 4, 4, 5, 5, 7, 9]) + "
        "stat.variance(collections.list(-2, 0, 2), ddof:1)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "stat-std.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes), encoding="utf-8"
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    instruction_kinds = {
        instruction["kind"]
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    }
    list_reductions = [
        instruction
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] == "stddev_f64_list"
    ]
    variance_list_reductions = [
        instruction
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] == "variance_f64_list"
    ]

    assert float(result.stdout.strip()) == 26
    # Fixed literals are materialized once; reductions operate on fixed locals
    # or owned lists rather than rebuilding transient value packs.
    assert {
        "variance_f64_locals",
        "variance_f64_list",
        "stddev_f64_locals",
        "stddev_f64_list",
    } <= instruction_kinds
    assert {instruction["owns_input"] for instruction in list_reductions} == {False, True}
    assert {instruction["ddof"] for instruction in list_reductions} == {0, 1}
    assert {instruction["owns_input"] for instruction in variance_list_reductions} == {False, True}
    assert {instruction["ddof"] for instruction in variance_list_reductions} == {0, 1}
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_compute_range_for_fixed_and_dynamic_lists(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "stat-range.vkf"
    source_path.write_text(
        "[num:16] fixed: [2, 4, 4, 4, 5, 5, 7, 9, 2, 4, 4, 4, 5, 5, 7, 9]\n"
        "[num] dynamic: collections.list(-2, 0, 3, 5, 1)\n"
        ":: stat.range(fixed) + stat.range(dynamic) + "
        "stat.range([-2, 0, 3, 5, 1]) + "
        "stat.range(collections.list(-2, 0, 3, 5, 1))\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "stat-range.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes), encoding="utf-8"
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    instructions = [
        instruction
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    ]

    assert float(result.stdout.strip()) == 28
    # Fixed literals are materialized once as owned lists, so the current direct
    # path needs local and list reductions; no transient values reduction is
    # required.
    assert {"range_f64_locals", "range_f64_list"} <= {
        instruction["kind"] for instruction in instructions
    }
    range_locals = next(
        instruction for instruction in instructions
        if instruction["kind"] == "range_f64_locals"
    )
    assert range_locals["argument_count"] == 16
    assert range_locals["index"] >= 0
    assert "ddof" not in range_locals
    assert {
        instruction["owns_input"]
        for instruction in instructions
        if instruction["kind"] == "range_f64_list"
    } == {False, True}
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_direct_stat_range_rejects_empty_dynamic_list(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "stat-range-empty.vkf"
    source_path.write_text(":: stat.range(collections.list())\n", encoding="utf-8")
    typed_ir_path = tmp_path / "stat-range-empty.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes), encoding="utf-8"
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=False
    )

    assert result.returncode != 0


def test_direct_stat_reductions_reject_unsupported_named_arguments(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    for name, source, message in (
        ("std-ddof", ":: stat.std([1, 2], ddof:2)\n", "ddof must be constant 0 or 1"),
        ("mean-named", ":: stat.mean([1, 2], ddof:1)\n", "does not accept named arguments"),
    ):
        source_path = tmp_path / f"{name}.vkf"
        source_path.write_text(source, encoding="utf-8")
        typed_ir_path = tmp_path / f"{name}.typed-ir.json"
        typed_ir_path.write_text(
            _typed_ir_json_for_file(source_path, smoke_exes), encoding="utf-8"
        )

        result = subprocess.run(
            [
                str(smoke_exes["x64_artifact"]),
                "--source",
                str(source_path),
                "--typed-ir",
                str(typed_ir_path),
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode != 0
        assert message in result.stderr


def test_x64_and_arm64_artifacts_apply_top_level_fixed_projection_updates(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "top-level-projection-updates.vkf"
    source_path.write_text(
        "point: (x: 3, y: 4)\n"
        "values: [1, 2, 3]\n"
        "point.x: 9\n"
        "values.0: 7\n"
        ":: point.x + values.0\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "top-level-projection-updates.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes), encoding="utf-8"
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)

    assert float(result.stdout.strip()) == 16
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_bulk_initialize_constant_numeric_lists(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "constant-list.vkf"
    source_path.write_text(
        "[num] values: [1, 2, 3, 4, 5, 6, 7, 8]\n"
        ":: stat.sum(values)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "constant-list.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)

    assert result.stdout == "36\n"
    assert any(
        instruction["kind"] == "make_owned_f64_list_literal"
        and instruction["argument_count"] == 8
        for instruction in machine_ir["entry"]["instructions"]
    )
    assert machine_ir["entry"]["max_stack"] <= 2
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_preserve_null_equality(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "null-equality.vkf"
    source_path.write_text(
        "is_null(value:any): value == null\n:: is_null(null)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "null-equality.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)],
        cwd=artifact.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )

    assert result.stdout == "true\n"
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_preserve_null_inequality(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "null-inequality.vkf"
    source_path.write_text(":: null != null\n", encoding="utf-8")
    typed_ir_path = tmp_path / "null-inequality.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)],
        cwd=artifact.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )

    assert result.stdout == "false\n"
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_resolve_record_type_alias_parameters(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "record-alias.vkf"
    source_path.write_text(
        "Signature: (type:str)\n"
        "reads_type(signature:Signature): signature.type == \"function signature\"\n"
        ":: reads_type((type: \"function signature\"))\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "record-alias.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)],
        cwd=artifact.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )

    assert result.stdout == "true\n"
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_read_module_literal_constants(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "module-constant.vkf"
    source_path.write_text(
        "compiler_version: \"vkf-0.1\"\n"
        "is_current(): compiler_version == \"vkf-0.1\"\n"
        ":: is_current()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "module-constant.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)],
        cwd=artifact.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )

    assert result.stdout == "true\n"
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_infer_any_dynamic_list_indexing(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "inferred-dynamic-list.vkf"
    source_path.write_text(
        "select(values:any, index:num): values.(index)\n"
        ":: select(collections.list(4, 9, 16), 1)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "inferred-dynamic-list.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)],
        cwd=artifact.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )

    assert float(result.stdout.strip()) == 9
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_bind_named_and_default_arguments(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "default-named-arguments.vkf"
    source_path.write_text(
        "weighted(x:num=3, y:num=x + 1, z:num=y + 1) -> num:\n"
        "    x * 100 + y * 10 + z\n\n"
        ":: weighted(z: 5)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "default-named-arguments.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)

    call = next(
        instruction
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] == "call"
    )
    weighted = next(function for function in machine_ir["functions"] if function["name"] == "weighted")
    assert float(result.stdout.strip()) == 345
    assert call["argument_count"] == 3
    assert call["provided_parameter_mask"] == 4
    assert weighted["parameter_mask_local"] is not None
    assert sum(
        instruction["kind"] == "jump_if_parameter_provided"
        for instruction in weighted["instructions"]
    ) == 3
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_own_resource_defaults(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "resource-default-arguments.vkf"
    source_path.write_text(
        "text_ok(value:str=\"hel\" & \"lo\") -> num:\n"
        "    value == \"hello\"?\n"
        "        @: 1\n"
        "    0\n\n"
        "sum_default(values:[num]=collections.list(2, 4, 6)) -> num:\n"
        "    stat.sum(values)\n\n"
        ":: text_ok() * 1000 + text_ok(\"hel\" & \"lo\") * 100 + "
        "sum_default() * 10 + sum_default(collections.list(1, 3, 5))\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "resource-default-arguments.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    text_function = next(function for function in machine_ir["functions"] if function["name"] == "text_ok")
    list_function = next(function for function in machine_ir["functions"] if function["name"] == "sum_default")

    assert float(result.stdout.strip()) == 1229
    assert text_function["owned_string_locals"]
    assert list_function["owned_f64_list_locals"]
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_pack_numeric_variadic_arguments(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "numeric-variadic.vkf"
    source_path.write_text(
        "sum_rest(head:num, ...rest:num) -> num:\n"
        "    head + stat.sum(rest)\n\n"
        "[num] values: collections.list(2, 3, 4)\n"
        ":: sum_rest(1, 2, 3, 4) * 100 + sum_rest(5) * 10 + sum_rest(1, :values)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "numeric-variadic.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    entry_kinds = [instruction["kind"] for instruction in machine_ir["entry"]["instructions"]]

    assert float(result.stdout.strip()) == 1060
    assert entry_kinds.count("make_owned_f64_list") == 4
    assert entry_kinds.count("concat_f64_lists") == 1
    assert entry_kinds.count("release_f64_list_local") >= 2
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


@pytest.mark.parametrize(
    ("program_name", "source", "expected"),
    [
        (
            "fixed-vector-spread",
            (ROOT / "examples" / "42_call_spread_vector.vkf").read_text(encoding="utf-8"),
            "24\n",
        ),
        (
            "fixed-record-spread",
            (ROOT / "examples" / "43_call_spread_struct.vkf").read_text(encoding="utf-8"),
            "7\n",
        ),
        (
            "positional-variadic",
            "summary(x, ...rest):\n"
            "    (x, rest.length(), rest.0)\n\n"
            ":: summary(1, 2, 3, 4)\n",
            "(1, 3, 2)\n",
        ),
        (
            "named-variadic",
            "capture(x, :::named):\n"
            "    (named.flag, named.mode)\n\n"
            ":: capture(1, flag:true, mode:\"fast\")\n",
            "(true, fast)\n",
        ),
        (
            "record-field-extension",
            (ROOT / "examples" / "20_struct_field_rebind.vkf").read_text(encoding="utf-8"),
            "(x:3, y:4, z:5)\n",
        ),
        (
            "record-spill",
            (ROOT / "examples" / "23_spill_and_override.vkf").read_text(encoding="utf-8"),
            "ColoredPoint(x:3, y:4, color:red)\n",
        ),
        (
            "axis-broadcast",
            (ROOT / "examples" / "64_axis_tags_and_broadcast.vkf").read_text(encoding="utf-8"),
            "[[10, 20], [20, 40]]\n",
        ),
        (
            "aggregate-concat",
            (ROOT / "examples" / "72_concat.vkf").read_text(encoding="utf-8"),
            "hello world\n[1, 2, 3, 4]\n(1, 2, 3, 4)\n",
        ),
        (
            "operator-overload",
            (ROOT / "examples" / "74_operator_overload.vkf").read_text(encoding="utf-8"),
            "(x:4, y:6)\n",
        ),
        (
            "compile-time-shapes",
            (ROOT / "examples" / "52_compile_time_shape_params.vkf").read_text(encoding="utf-8"),
            "[1, 2, 3, 4, 5]\n",
        ),
        (
            "type-reflection",
            (ROOT / "examples" / "53_type_reflection.vkf").read_text(encoding="utf-8"),
            "(x:int, y:int)\n[int:3]\n",
        ),
        (
            "switch",
            (ROOT / "examples" / "61_switch.vkf").read_text(encoding="utf-8"),
            "green\n",
        ),
        (
            "interp-example",
            (ROOT / "examples" / "11_strings_and_interpolation.vkf").read_text(encoding="utf-8"),
            "Hej världen\nx rounded is 4.23\nsum=7.2345\n",
        ),
        (
            "interp-values",
            "describe(value:num, ok:bit, name:str, point:(x:num, y:bit), values:[num:2]) -> str:\n"
            "    \"name=$name value=$value.1f ok=$ok point=$point values=$values sum=$(value + point.x)\"\n\n"
            ":: describe(3.5, true, \"Ada\", (x:2, y:false), [1, 2])\n"
            ":: \"cost=\\$5\"\n",
            "name=Ada value=3.5 ok=true point=(x:2, y:false) values=[1, 2] sum=5.5\ncost=$5\n",
        ),
        (
            "interp-dynamic-values",
            "render(...values:num) -> str:\n"
            "    \"values=$values\"\n\n"
            ":: render(1, 2, 3)\n"
            ":: render()\n",
            "values=[1, 2, 3]\nvalues=[]\n",
        ),
        (
            "numeric-multisets",
            (ROOT / "examples" / "16_multisets.vkf").read_text(encoding="utf-8"),
            "{1:6, 2:3}\n{1:2, 2:1}\n{1:2, 2:2}\n",
        ),
    ],
)
def test_x64_artifact_runs_core_spread_and_variadic_examples(
    program_name: str,
    source: str,
    expected: str,
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / f"{program_name}.vkf"
    source_path.write_text(source, encoding="utf-8")
    typed_ir_path = tmp_path / f"{program_name}.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, encoding="utf-8", check=True
    )

    assert result.stdout == expected
    if program_name in {"interp-values", "interp-dynamic-values", "numeric-multisets"}:
        machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
        instruction_kinds = {
            instruction["kind"]
            for function in [machine_ir["entry"], *machine_ir["functions"]]
            for instruction in function["instructions"]
        }
        if program_name == "numeric-multisets":
            assert {
                "normalize_f64_multiset",
                "union_f64_multisets",
                "difference_f64_multisets",
                "floor_divide_f64_multisets",
            } <= instruction_kinds
            arm64 = json.loads(
                _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
            )
            arm64_manifest = json.loads(
                Path(arm64["manifest_path"]).read_text(encoding="utf-8")
            )
            assert Path(arm64["raw_code_path"]).stat().st_size > 0
            assert arm64_manifest["runtime_abi_version"] == 12
        else:
            arm64 = json.loads(
                _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
            )
            arm64_manifest = json.loads(
                Path(arm64["manifest_path"]).read_text(encoding="utf-8")
            )

            assert "format_f64_string" in instruction_kinds
            if program_name == "interp-values":
                assert "format_bit_string" in instruction_kinds
            else:
                assert {"count_f64_list", "load_f64_list_index"} <= instruction_kinds
            assert Path(arm64["raw_code_path"]).stat().st_size > 0
            assert arm64_manifest["runtime_abi_version"] == 12
            assert b"_snprintf\0" in Path(arm64["artifact_path"]).read_bytes()


def test_x64_and_arm64_artifacts_support_large_fixed_vector_runtime_indexing(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = ROOT / "examples" / "benchmarks" / "vector_large_reduce.vkf"
    typed_ir_path = tmp_path / "large-fixed-vector.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    result = subprocess.run(
        [x64["artifact_path"]],
        cwd=Path(x64["artifact_path"]).parent,
        capture_output=True,
        encoding="utf-8",
        check=True,
    )
    assert result.stdout == "91760230400\n"

    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    instruction_kinds = {
        instruction["kind"]
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    }
    assert "load_f64_locals_index" in instruction_kinds

    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_support_dynamic_list_builders(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = ROOT / "examples" / "benchmarks" / "vector_append_builder_pressure.vkf"
    typed_ir_path = tmp_path / "dynamic-list-builder.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    result = subprocess.run(
        [x64["artifact_path"]],
        cwd=Path(x64["artifact_path"]).parent,
        capture_output=True,
        encoding="utf-8",
        check=True,
    )
    assert result.stdout == "0\n255\n511\n"

    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    instruction_kinds = {
        instruction["kind"]
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    }
    assert "concat_f64_lists" in instruction_kinds

    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


@pytest.mark.parametrize(
    ("source_name", "expected"),
    [
        ("44_variadic_positional.vkf", "x: 1\nrest.length(): 3\nrest.(0): 2\n"),
        ("45_variadic_named.vkf", "named.flag: true\nnamed.mode: fast\n"),
    ],
)
def test_x64_and_arm64_artifacts_write_function_local_label_prints(
    source_name: str,
    expected: str,
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = ROOT / "examples" / source_name
    typed_ir_path = tmp_path / f"{source_path.stem}.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes), encoding="utf-8"
    )

    x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout
    )
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    instructions = [
        instruction
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    ]
    arm64 = json.loads(
        _run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout
    )

    assert result.stdout == expected
    assert any(
        instruction["kind"] == "write_string" and instruction["owns_input"] is True
        for instruction in instructions
    )
    assert b"_write\0" in artifact.read_bytes()
    assert b"_write\0" in Path(arm64["artifact_path"]).read_bytes()


def test_x64_and_arm64_artifacts_lower_string_match_expressions(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "string-match.vkf"
    source_path.write_text(
        "classify(value:str) -> str:\n"
        "    value??\n"
        "        \"left\" => \"le\" & \"ft\"\n"
        "        \"other\"\n\n"
        ":: classify(\"left\")\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "string-match.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    kinds = {
        instruction["kind"]
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    }

    assert result.stdout == "left\n"
    assert {"string_equal", "jump_if_false", "concat_strings", "clone_string"} <= kinds
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_catch_assertions_by_error_type(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "catch-assertion.vkf"
    source_path.write_text(
        "errors: .errors\n\n"
        "raise_assertion() -> bit:\n"
        "    (1 == 2)?! \"expected\"\n\n"
        "forward_assertion() -> bit:\n"
        "    raise_assertion()\n\n"
        "catch_error() -> str:\n"
        "    caught: \"\"\n"
        "    forward_assertion()!?\n"
        "        errors.Error => caught: \"general\"\n"
        "        errors.AssertionError => caught: $.message\n"
        "    caught\n\n"
        ":: catch_error()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "catch-assertion.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    catch_function = next(
        function for function in machine_ir["functions"] if function["name"] == "catch_error"
    )

    assert result.stdout == "expected\n"
    handled_call = next(
        instruction
        for instruction in catch_function["instructions"]
        if instruction["kind"] == "call"
    )
    assert handled_call["may_error"] is True
    assert handled_call["has_error_handler"] is True
    assert all(
        function["may_error"] is True
        for function in machine_ir["functions"]
        if function["name"] in {"raise_assertion", "forward_assertion", "catch_error"}
    )
    assert Path(arm64["raw_code_path"]).stat().st_size > 0

    unmatched_source = tmp_path / "unmatched-catch.vkf"
    unmatched_source.write_text(
        "errors: .errors\n\n"
        "uncaught() -> num:\n"
        "    ((1 == 2)?!)!?\n"
        "        errors.TypeError => 1\n"
        "    0\n\n"
        ":: uncaught()\n",
        encoding="utf-8",
    )
    unmatched_typed = tmp_path / "unmatched-catch.typed-ir.json"
    unmatched_typed.write_text(
        _typed_ir_json(unmatched_source.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )
    unmatched_x64 = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], unmatched_source, unmatched_typed).stdout
    )
    unmatched_artifact = Path(unmatched_x64["artifact_path"])
    unmatched_result = subprocess.run(
        [str(unmatched_artifact)], cwd=unmatched_artifact.parent, capture_output=True, text=True
    )
    assert unmatched_result.returncode != 0


def test_x64_and_arm64_artifacts_catch_runtime_index_error_by_type(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "catch-index.vkf"
    source_path.write_text(
        "errors: .errors\n\n"
        "raise_index() -> num:\n"
        "    [num] values: [1, 2]\n"
        "    values.(5)\n\n"
        "catch_index() -> num:\n"
        "    caught: 0\n"
        "    raise_index()!?\n"
        "        errors.Error => caught: 1\n"
        "        errors.IndexError => caught: 2\n"
        "    caught\n\n"
        ":: catch_index()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "catch-index.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    kinds = {
        instruction["kind"]
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
    }

    assert result.stdout == "2\n"
    assert {"load_f64_list_index", "error_type_matches", "rethrow_error"} <= kinds
    assert any(
        instruction.get("error_type_local") is not None
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
        if instruction["kind"] == "call" and instruction.get("has_error_handler")
    )
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_catch_invalid_int_by_value_error_type(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "catch-value.vkf"
    source_path.write_text(
        "errors: .errors\n\n"
        "validate(value:num) -> num:\n"
        "    caught: 0\n"
        "    int(value)!?\n"
        "        errors.Error => caught: 1\n"
        "        errors.ValueError => caught: 2\n"
        "    caught\n\n"
        ":: validate(1.5)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "catch-value.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    validation = next(
        instruction
        for function in machine_ir["functions"]
        for instruction in function["instructions"]
        if instruction["kind"] == "assert_truthy"
    )

    assert result.stdout == "2\n"
    assert validation["error_type_mask"] != 0
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_x64_and_arm64_artifacts_rank_match_values_over_specific_types(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "match-ranking.vkf"
    source_path.write_text(
        "classify(value:int) -> num:\n"
        "    value??\n"
        "        any => 30\n"
        "        num => 20\n"
        "        int => 2\n"
        "        3 => 1\n\n"
        "compound(value:int) -> num:\n"
        "    value??\n"
        "        int|str => 2\n"
        "        num&int => 1\n"
        "        3\n\n"
        "shape(value:[num:4]) -> num:\n"
        "    value??\n"
        "        [any:4] => 2\n"
        "        [num:4] => 1\n"
        "        3\n\n"
        "record_shape(value:(x:num,y:num,z:num)) -> num:\n"
        "    value??\n"
        "        (x:any,y:num) => 2\n"
        "        (x:num,y:num) => 1\n"
        "        3\n\n"
        "tuple_shape(value:(num,num)) -> num:\n"
        "    value??\n"
        "        (any,num) => 2\n"
        "        (num,num) => 1\n"
        "        3\n\n"
        ":: ((((classify(3) * 10 + classify(4)) * 10 + compound(4)) * 10 + "
        "shape([1, 2, 3, 4])) * 10 + record_shape((x: 1, y: 2, z: 3))) * 10 + "
        "tuple_shape((1, 2))\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "match-ranking.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)

    assert float(result.stdout.strip()) == 121111
    assert Path(arm64["raw_code_path"]).stat().st_size > 0


def test_dynamic_numeric_list_rebinding_releases_previous_storage(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "dynamic-list-rebind.vkf"
    source_path.write_text(
        "run() -> num:\n"
        "    [num] values: [1, 2]\n"
        "    [num] values: [3, 4]\n"
        "    stat.sum(values)\n\n"
        ":: run()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "dynamic-list-rebind.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    run_function = next(function for function in machine_ir["functions"] if function["name"] == "run")

    assert float(result.stdout.strip()) == 7
    assert run_function["owned_f64_list_locals"] == [0]
    assert sum(
        instruction["kind"] == "make_owned_f64_list"
        for instruction in run_function["instructions"]
    ) == 2
    assert sum(
        instruction["kind"] == "release_f64_list_local"
        for instruction in run_function["instructions"]
    ) == 3


def test_dynamic_numeric_list_returns_clone_borrows_and_release_owned_temporaries(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "dynamic-list-return.vkf"
    source_path.write_text(
        "copy(values:[num]) -> [num]:\n"
        "    values\n\n"
        "make() -> [num]:\n"
        "    [num] local: [1, 2, 3]\n"
        "    local\n\n"
        "fresh() -> [num]:\n"
        "    collections.list(6, 7)\n\n"
        "discard() -> num:\n"
        "    collections.list(99)\n"
        "    1\n\n"
        "[num] values: make()\n"
        "[num] copied: values\n"
        ":: stat.sum(values) + stat.sum(copied) + "
        "stat.sum(copy(collections.list(4, 5))) + fresh().(1) + discard()\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "dynamic-list-return.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )
    instruction_kinds = [
        instruction["kind"]
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    ]

    assert float(result.stdout.strip()) == 29
    assert "clone_f64_list" in instruction_kinds
    assert "release_f64_list_value" in instruction_kinds
    assert machine_ir["entry"]["owned_f64_list_locals"] == [0, 1, 2]
    assert {0xD37DF180, 0xF90001AC, 0xFD0001A0} <= set(arm_words)


def test_dynamic_numeric_list_concat_preserves_order_and_releases_owned_inputs(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "dynamic-list-concat.vkf"
    source_path.write_text(
        "[num] a: [1, 2]\n"
        "[num] b: [3, 4]\n"
        "[num] c: a & b\n"
        ":: stat.sum(c) + "
        "stat.sum(collections.list(5) & collections.list(6, 7)) + "
        "stat.sum(a & collections.list(8)) + "
        "stat.sum(collections.list(9) & b)\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "dynamic-list-concat.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )
    concat_instructions = [
        instruction
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] == "concat_f64_lists"
    ]

    assert float(result.stdout.strip()) == 55
    assert {
        (instruction["owns_left"], instruction["owns_right"])
        for instruction in concat_instructions
    } == {(False, False), (False, True), (True, False), (True, True)}
    assert {0xAB0E01AF, 0xF900000F, 0xFD000200} <= set(arm_words)


def test_dynamic_numeric_list_concat_handles_large_owned_containers(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    left = ", ".join(str(value) for value in range(1, 257))
    right = ", ".join(str(value) for value in range(257, 513))
    source_path = tmp_path / "dynamic-list-concat-large.vkf"
    source_path.write_text(
        f":: stat.sum(collections.list({left}) & collections.list({right}))\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "dynamic-list-concat-large.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    concat = next(
        instruction
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] == "concat_f64_lists"
    )

    assert float(result.stdout.strip()) == 131328
    assert concat["owns_left"] is True
    assert concat["owns_right"] is True
    assert arm_manifest["backend"] == "arm64-macho"
    assert arm_manifest["artifact_format"] == "macho-executable"
    assert arm_manifest["runtime_imports_complete"] is True


def test_x64_artifact_embeds_and_prints_large_string_without_fallback(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    payload = "vkf0123456789" * 1024
    proc = subprocess.run(
        [str(smoke_exes["driver"]), "--aot", "--diagnostics", "-e", f':: "{payload}"'],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )
    summary = json.loads(proc.stdout)
    manifest = json.loads(Path(summary["manifest_path"]).read_text(encoding="utf-8"))

    assert summary["artifact_fallback"] is False
    assert summary["stdout"] == payload + os.linesep
    assert manifest["artifact_writer"] == "compiler-owned"
    assert manifest["result_transport"] == "stdout-string"
    assert manifest["string_bytes"] == len(payload)


def test_x64_and_arm64_artifacts_clone_concat_return_and_release_owned_strings(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "owned-string.vkf"
    source_path.write_text(
        "copy(value:str) -> str:\n"
        "    value\n\n"
        "suffix(value:str) -> str:\n"
        "    value & \"!\"\n\n"
        "discard() -> str:\n"
        "    \"x\" & \"y\"\n"
        "    \"ok\"\n\n"
        "str message: \"hello\" & \" world\"\n"
        "str cloned: message\n"
        ":: copy(cloned) & \" / \" & suffix(discard())\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "owned-string.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json(source_path.read_text(encoding="utf-8"), smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )
    arm_artifact = Path(arm64["artifact_path"]).read_bytes()
    arm_artifact_words = struct.unpack(f"<{len(arm_artifact) // 4}I", arm_artifact)
    instruction_kinds = {
        instruction["kind"]
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    }

    assert result.stdout == "hello world / ok!\n"
    assert machine_ir["entry"]["owned_string_locals"] == [0, 2, 4]
    assert {"clone_string", "concat_strings", "release_string_value", "release_string_local"} <= instruction_kinds
    assert {0xB1002580, 0xF90001EE} <= set(arm_words)
    assert {0x9E78002B, 0xF94027E9} <= set(arm_artifact_words)


def test_x64_and_arm64_artifacts_compare_utf8_strings_and_release_owned_operands(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "string-comparison.vkf"
    source_path.write_text(
        "copy(value:str) -> str:\n"
        "    value\n\n"
        ":: (\"a\" < \"b\") /\\ (\"a\" <= \"a\") /\\ (\"é\" > \"z\") /\\ "
        "(\"é\" >= \"é\") /\\ ((\"é\" & \"x\") == copy(\"éx\")) /\\ "
        "(copy(\"ab\") != (\"a\" & \"c\")) /\\ (\"same\" = \"same\") /\\ (\"a\" ~= \"b\")\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "string-comparison.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)
    arm_words = struct.unpack(
        f"<{Path(arm64['raw_code_path']).stat().st_size // 4}I",
        Path(arm64["raw_code_path"]).read_bytes(),
    )
    instruction_kinds = {
        instruction["kind"]
        for function in [machine_ir["entry"], *machine_ir["functions"]]
        for instruction in function["instructions"]
    }
    string_comparisons = {
        "string_equal",
        "string_not_equal",
        "string_less",
        "string_less_equal",
        "string_greater",
        "string_greater_equal",
    }

    assert result.stdout == "true\n"
    assert string_comparisons <= instruction_kinds
    assert any(
        instruction.get("owns_left") or instruction.get("owns_right")
        for instruction in machine_ir["entry"]["instructions"]
        if instruction["kind"] in string_comparisons
    )
    assert 0x6B0E013F in arm_words


def test_x64_artifact_recursively_owns_strings_and_lists_inside_records(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    source_path = tmp_path / "nested-ownership.vkf"
    source_path.write_text(
        "values() -> [num]:\n"
        "    [1, 2]\n\n"
        "make() -> (text:str, values:[num]):\n"
        "    (text: \"hel\" & \"lo\", values: values())\n\n"
        "copy(value:(text:str, values:[num])) -> (text:str, values:[num]):\n"
        "    value\n\n"
        "measure(value:(text:str, values:[num])) -> num:\n"
        "    stat.sum(value.values)\n\n"
        "first: make()\n"
        "second: first\n"
        "third: copy(second)\n"
        ":: stat.sum(third.values) + (third.text == \"hello\") + measure(make())\n",
        encoding="utf-8",
    )
    typed_ir_path = tmp_path / "nested-ownership.typed-ir.json"
    typed_ir_path.write_text(
        _typed_ir_json_for_file(source_path, smoke_exes),
        encoding="utf-8",
    )

    x64 = json.loads(_run_artifact(smoke_exes["x64_artifact"], source_path, typed_ir_path).stdout)
    artifact = Path(x64["artifact_path"])
    result = subprocess.run(
        [str(artifact)], cwd=artifact.parent, capture_output=True, text=True, check=True
    )
    machine_ir = json.loads(Path(x64["machine_ir_path"]).read_text(encoding="utf-8"))
    arm64 = json.loads(_run_artifact(smoke_exes["arm64_artifact"], source_path, typed_ir_path).stdout)

    assert result.stdout == "7\n"
    arm_manifest = json.loads(Path(arm64["manifest_path"]).read_text(encoding="utf-8"))
    assert machine_ir["entry"]["owned_string_locals"] == [0, 3, 6, 12]
    assert machine_ir["entry"]["owned_f64_list_locals"] == [2, 5, 8, 14]
    assert arm_manifest["backend"] == "arm64-macho"
    assert arm_manifest["runtime_imports_complete"] is True


def test_native_assertion_returns_condition_or_aborts(
    tmp_path: Path,
    smoke_exes: dict[str, Path],
) -> None:
    passing_source = tmp_path / "assert-pass.vkf"
    passing_source.write_text(":: (2 + 2 == 4)?!\n", encoding="utf-8")
    passing_ir = tmp_path / "assert-pass.typed-ir.json"
    passing_ir.write_text(_typed_ir_json_for_file(passing_source, smoke_exes), encoding="utf-8")
    passing = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], passing_source, passing_ir).stdout
    )
    passing_artifact = Path(passing["artifact_path"])
    passing_result = subprocess.run(
        [str(passing_artifact)],
        cwd=passing_artifact.parent,
        capture_output=True,
        text=True,
        check=True,
    )
    machine_ir = json.loads(Path(passing["machine_ir_path"]).read_text(encoding="utf-8"))

    failing_source = tmp_path / "assert-fail.vkf"
    failing_source.write_text(":: (2 + 2 == 5)?!\n", encoding="utf-8")
    failing_ir = tmp_path / "assert-fail.typed-ir.json"
    failing_ir.write_text(_typed_ir_json_for_file(failing_source, smoke_exes), encoding="utf-8")
    failing = json.loads(
        _run_artifact(smoke_exes["x64_artifact"], failing_source, failing_ir).stdout
    )
    failing_artifact = Path(failing["artifact_path"])
    failing_result = subprocess.run(
        [str(failing_artifact)],
        cwd=failing_artifact.parent,
        capture_output=True,
        text=True,
        check=False,
    )

    assert passing_result.stdout == "true\n"
    assert any(
        instruction["kind"] == "assert_truthy"
        for instruction in machine_ir["entry"]["instructions"]
    )
    assert failing_result.returncode != 0


def test_artifact_smoke_compiles_declared_compiler_bundle(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    for source_path in compiler_bootstrap_sources(ROOT):
        typed_ir_path = tmp_path / (source_path.stem + ".typed-ir.json")
        typed_ir_path.write_text(_typed_ir_json_for_file(source_path, smoke_exes), encoding="utf-8")
        result = json.loads(_run_artifact(smoke_exes["artifact"], source_path, typed_ir_path).stdout)
        assert result["status"] in {"compiled", "current"}
        assert Path(result["artifact_path"]).is_file()
        assert Path(result["manifest_path"]).is_file()


def test_driver_compiles_declared_compiler_bundle(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    for source_path in compiler_bootstrap_sources(ROOT):
        copied = tmp_path / source_path.name
        copied.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")
        result = json.loads(_run_driver(copied, smoke_exes, run=False).stdout)
        assert result["status"] in {"compiled", "current"}
        assert result["ran"] is False
        assert Path(result["token_path"]).is_file()
        assert Path(result["ast_path"]).is_file()
        assert Path(result["typed_ir_path"]).is_file()
        assert Path(result["artifact_path"]).is_file()
        assert Path(result["manifest_path"]).is_file()
