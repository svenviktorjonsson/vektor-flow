from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "compiler" / "native" / "vkf_symbolic_kernel_artifact.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"


def compiler_command(output: Path) -> list[str] | None:
    for compiler in ("clang++", "g++", "c++"):
        executable = shutil.which(compiler)
        if executable:
            return [
                executable,
                "-std=c++17",
                "-Wall",
                "-Wextra",
                "-pedantic",
                "-I",
                str(ROOT),
                "-I",
                str(ROOT / "native/VfOverlay"),
                str(SOURCE),
                str(JSON_SOURCE),
                "-o",
                str(output),
            ]
    return None


def test_emits_named_function_manifest_and_deterministic_wasm(
    tmp_path: Path,
) -> None:
    command = compiler_command(tmp_path / "artifact")
    if command is None:
        pytest.skip("no C++17 compiler found")
    subprocess.run(command, cwd=ROOT, check=True)

    typed_ir = {
        "kind": "typed_module",
        "body": [
            {
                "kind": "function",
                "name": "double_value",
                "params": [{"kind": "param", "name": "value", "type": "num"}],
                "return_type": "num",
                "body": {
                    "kind": "binary_op",
                    "op": "*",
                    "type": "num",
                    "left": {"kind": "load", "name": "value", "type": "num"},
                    "right": {"kind": "const", "value": 2, "type": "num"},
                },
            }
        ],
    }
    typed_path = tmp_path / "typed.json"
    typed_path.write_text(json.dumps(typed_ir), encoding="utf-8")

    outputs: list[bytes] = []
    for suffix in ("first", "second"):
        wasm = tmp_path / f"{suffix}.wasm"
        manifest = tmp_path / f"{suffix}.json"
        subprocess.run(
            [
                str(tmp_path / "artifact"),
                "--typed-ir",
                str(typed_path),
                "--wasm",
                str(wasm),
                "--manifest",
                str(manifest),
                "--entry",
                "double_value",
            ],
            cwd=ROOT,
            check=True,
        )
        outputs.append(wasm.read_bytes())
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        assert payload["schema"] == "vektor-flow.symbolic-kernel"
        assert payload["functions"]["double_value"] == {
            "index": 0,
            "parameters": 1,
            "resultType": 2,
        }
    assert outputs[0] == outputs[1]
    assert outputs[0].startswith(b"\0asm\x01\0\0\0")
