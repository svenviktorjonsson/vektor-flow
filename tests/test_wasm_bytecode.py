from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _compiler_command(source: Path, output: Path) -> list[str]:
    for compiler in ("clang++", "g++", "c++"):
        path = shutil.which(compiler)
        if path is not None:
            return [
                path,
                "-std=c++17",
                "-Wall",
                "-Wextra",
                "-pedantic",
                "-I",
                str(ROOT),
                str(source),
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
            str(source),
            f"/Fe:{output}",
        ]
    pytest.skip("a C++17 compiler is required")


@pytest.fixture(scope="module")
def bytecode_harness(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("wasm-bytecode")
    source = directory / "harness.cpp"
    executable = directory / "harness.exe"
    source.write_text(
        r'''
#include "compiler/native/vkf_wasm_bytecode.hpp"

#include <iostream>
#include <string>
#include <vector>

using namespace vkf::wasm::bytecode;

Module valid_module() {
    Module module;
    module.constants = {
        Constant::utf8_string("main"),
        Constant::number_value(2.0),
        Constant::utf8_string(u8"fält"),
    };
    Function main;
    main.name_constant = 0;
    main.parameter_count = 1;
    main.return_type = ValueType::Number;
    main.local_types = {ValueType::Number};
    main.instructions = {
        {Opcode::LoadLocal, ValueType::Number, 0, 0},
        {Opcode::PushConstant, ValueType::Number, 1, 0},
        {Opcode::Multiply, ValueType::Number, 0, 0},
        {Opcode::JumpIfFalse, ValueType::Void, 5, 0},
        {Opcode::ObjectGet, ValueType::Dynamic, 2, 0},
        {Opcode::Return, ValueType::Void, 0, 0},
    };
    module.functions.push_back(main);
    module.entry_function = 0;
    return module;
}

int main(int argc, char** argv) {
    const std::string mode = argc > 1 ? argv[1] : "roundtrip";
    try {
        Module module = valid_module();
        if (mode == "roundtrip") {
            const auto first = serialize(module);
            const auto decoded = deserialize(first);
            const auto second = serialize(decoded);
            if (!(module == decoded) || first != second) {
                return 3;
            }
            std::cout << first.size();
            return 0;
        }
        if (mode == "constant") {
            module.functions[0].instructions[1].first = 99;
        } else if (mode == "jump") {
            module.functions[0].instructions[3].first = 99;
        } else if (mode == "function") {
            module.functions[0].instructions[2] = {
                Opcode::Call, ValueType::Number, 99, 1
            };
        } else if (mode == "local") {
            module.functions[0].instructions[0].first = 99;
        } else if (mode == "trailing") {
            auto bytes = serialize(module);
            bytes.push_back(0);
            (void)deserialize(bytes);
            return 4;
        } else if (mode == "truncated") {
            auto bytes = serialize(module);
            bytes.pop_back();
            (void)deserialize(bytes);
            return 4;
        } else if (mode == "utf8") {
            module.constants[2].string = std::string("\xc0\xaf", 2);
        } else {
            return 5;
        }
        (void)serialize(module);
        return 4;
    } catch (const BytecodeError& error) {
        std::cerr << error.what();
        return 2;
    }
}
''',
        encoding="utf-8",
    )
    subprocess.run(
        _compiler_command(source, executable),
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return executable


def _run(harness: Path, mode: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(harness), mode],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_roundtrip_is_deterministic(bytecode_harness: Path) -> None:
    first = _run(bytecode_harness, "roundtrip")
    second = _run(bytecode_harness, "roundtrip")

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert first.stdout == second.stdout
    assert int(first.stdout) > 32


@pytest.mark.parametrize(
    ("mode", "message"),
    [
        ("constant", "missing constant 99"),
        ("jump", "invalid jump target 99"),
        ("function", "missing function 99"),
        ("local", "missing local 99"),
        ("trailing", "trailing data"),
        ("truncated", "truncated bytecode"),
        ("utf8", "not valid UTF-8"),
    ],
)
def test_rejects_invalid_references_and_encoding(
    bytecode_harness: Path,
    mode: str,
    message: str,
) -> None:
    result = _run(bytecode_harness, mode)

    assert result.returncode == 2
    assert message in result.stderr
