from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
WASM_ARTIFACT_SOURCE = ROOT / "compiler" / "native" / "vkf_wasm_artifact_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"


def _compiler_command(output: Path) -> list[str] | None:
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
                str(WASM_ARTIFACT_SOURCE),
                str(JSON_SOURCE),
                "-o",
                str(output),
            ]
    cl = shutil.which("cl") or shutil.which("cl.exe")
    if cl is None and shutil.which("where.exe") is not None:
        located = subprocess.run(
            ["where.exe", "cl"],
            capture_output=True,
            text=True,
            check=False,
        )
        if located.returncode == 0:
            cl = located.stdout.splitlines()[0].strip()
    if cl is not None:
        return [
            cl,
            "/nologo",
            "/EHsc",
            "/std:c++17",
            f"/I{ROOT}",
            f"/I{ROOT / 'native' / 'VfOverlay'}",
            str(WASM_ARTIFACT_SOURCE),
            str(JSON_SOURCE),
            f"/Fe:{output}",
        ]
    return None


def _node_or_skip() -> str:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not found")
    return node


def test_wasm_artifact_exposes_round_trip_symbolic_text_buffers(tmp_path: Path) -> None:
    executable = tmp_path / "vkf_wasm_artifact_smoke"
    command = _compiler_command(executable)
    if command is None:
        pytest.skip("no C++ compiler found")
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)

    source_path = tmp_path / "symbolic_trace.vkf"
    source_path.write_text("let answer = 42\n", encoding="utf-8")
    typed_ir_path = tmp_path / "symbolic_trace.typed-ir.json"
    typed_ir_path.write_text(
        json.dumps(
            {
                "kind": "typed_module",
                "body": [
                    {
                        "kind": "type_alias",
                        "name": "Answer",
                        "type_annotation": {
                            "kind": "type_annotation",
                            "name": "num",
                        },
                    },
                    {
                        "kind": "store_binding",
                        "name": "answer",
                        "value": {"kind": "const", "value": 42},
                        "type": "Answer",
                    },
                    {
                        "kind": "expr_stmt",
                        "expr": {"kind": "load", "name": "answer", "type": "Answer"},
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            str(executable),
            "--source",
            str(source_path),
            "--typed-ir",
            str(typed_ir_path),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    artifact = json.loads(result.stdout)
    manifest = json.loads(Path(artifact["manifest_path"]).read_text(encoding="utf-8"))
    symbolic = manifest["runtime_surface"]["symbolic_text"]
    assert symbolic == {
        "input_ptr_export": "vkf_symbolic_input_ptr",
        "input_capacity_export": "vkf_symbolic_input_capacity",
        "input_len_export": "vkf_symbolic_input_len",
        "set_input_len_export": "vkf_symbolic_set_input_len",
        "output_ptr_export": "vkf_symbolic_output_ptr",
        "output_capacity_export": "vkf_symbolic_output_capacity",
        "output_len_export": "vkf_symbolic_output_len",
        "trace_export": "vkf_symbolic_trace",
        "encoding": "utf-8",
    }

    expression = "sqrt(x^2 + y^2) + pi"
    node_script = r"""
const fs = require("fs");
const bytes = fs.readFileSync(process.argv[1]);
const expression = process.argv[2];
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
const required = [
  "vkf_symbolic_input_ptr",
  "vkf_symbolic_input_capacity",
  "vkf_symbolic_input_len",
  "vkf_symbolic_set_input_len",
  "vkf_symbolic_output_ptr",
  "vkf_symbolic_output_capacity",
  "vkf_symbolic_output_len",
  "vkf_symbolic_trace",
];
for (const name of required) {
  if (typeof e[name] !== "function") throw new Error("missing " + name);
}
const encoded = new TextEncoder().encode(expression);
if (encoded.length > e.vkf_symbolic_input_capacity()) throw new Error("test expression too long");
new Uint8Array(e.memory.buffer, e.vkf_symbolic_input_ptr(), encoded.length).set(encoded);
const accepted = e.vkf_symbolic_set_input_len(encoded.length);
const traced = e.vkf_symbolic_trace();
const output = new Uint8Array(e.memory.buffer, e.vkf_symbolic_output_ptr(), traced);
process.stdout.write(JSON.stringify({
  accepted,
  inputLen: e.vkf_symbolic_input_len(),
  outputLen: e.vkf_symbolic_output_len(),
  output: new TextDecoder().decode(output),
  distinctBuffers: e.vkf_symbolic_input_ptr() !== e.vkf_symbolic_output_ptr(),
}));
"""
    node_result = subprocess.run(
        [
            _node_or_skip(),
            "-e",
            node_script,
            artifact["artifact_path"],
            expression,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(node_result.stdout) == {
        "accepted": len(expression.encode("utf-8")),
        "inputLen": len(expression.encode("utf-8")),
        "outputLen": len(expression.encode("utf-8")),
        "output": expression,
        "distinctBuffers": True,
    }
