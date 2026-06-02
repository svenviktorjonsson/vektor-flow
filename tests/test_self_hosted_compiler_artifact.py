from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from vektorflow.compiler_bootstrap import compiler_bootstrap_sources
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_compiler_artifact_smoke.cpp"
WASM_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_wasm_artifact_smoke.cpp"
WEBGPU_ARTIFACT_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_webgpu_artifact_smoke.cpp"
DRIVER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_driver_artifact_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"
COMPILER_SOURCE = ROOT / "compiler" / "self_hosted" / "compiler.vkf"
COMPILED_RUNTIME_BRIDGE_SOURCE = ROOT / "web" / "vf-ui" / "vf-compiled-runtime-bridge.js"


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
    tmp_path = tmp_path_factory.mktemp("artifact_smokes")
    return {
        "lexer": _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe"),
        "parser": _compile_or_skip([PARSER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_parser_token_stream_smoke.exe"),
        "ir": _compile_or_skip([AST_TO_IR_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_ast_to_ir_smoke.exe"),
        "artifact": _compile_or_skip([ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_compiler_artifact_smoke.exe"),
        "wasm_artifact": _compile_or_skip([WASM_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_wasm_artifact_smoke.exe"),
        "webgpu_artifact": _compile_or_skip([WEBGPU_ARTIFACT_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_webgpu_artifact_smoke.exe"),
        "driver": _compile_or_skip([DRIVER_SMOKE_SOURCE, JSON_SOURCE], tmp_path / "vkf_driver_artifact_smoke.exe"),
    }


def _run(exe: Path, input_text: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe)],
        cwd=ROOT,
        input=input_text,
        capture_output=True,
        text=True,
        check=True,
    )


def _typed_ir_json(source: str, exes: dict[str, Path]) -> str:
    tokens = subprocess.run(
        [str(exes["lexer"]), source, "<artifact-pipeline>"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    ast_json = _run(exes["parser"], tokens).stdout
    return _run(exes["ir"], ast_json).stdout


def _typed_ir_json_for_file(source_path: Path, exes: dict[str, Path]) -> str:
    tokens = subprocess.run(
        [str(exes["lexer"]), "--file", str(source_path), source_path.relative_to(ROOT).as_posix()],
        cwd=ROOT,
        capture_output=True,
        text=True,
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


def _run_driver(source_path: Path, smoke_exes: dict[str, Path], *, run: bool = False) -> subprocess.CompletedProcess[str]:
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
    return subprocess.run(
        args,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


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


def test_wasm_artifact_smoke_fails_hard_on_unsupported_stmt_kind(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
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
    assert "unsupported typed IR statement kind function" in proc.stderr


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
    shader = Path(result["artifact_path"]).read_text(encoding="utf-8")
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
    assert manifest["compiler_version"] == "vkf-artifact-smoke-0.1"
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


def test_driver_function_only_program_compiles_and_runs_placeholder_artifact(tmp_path: Path, smoke_exes: dict[str, Path]) -> None:
    source_path = tmp_path / "driver_unsupported.vkf"
    source_path.write_text("f(x:num) -> num:\n    @: x", encoding="utf-8")

    result = json.loads(_run_driver(source_path, smoke_exes, run=True).stdout)
    assert result["status"] == "compiled"
    assert result["ran"] is True
    assert result["stdout"] == ""
    assert Path(result["manifest_path"]).is_file()
    assert "rem function f" in Path(result["artifact_path"]).read_text(encoding="utf-8")


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
