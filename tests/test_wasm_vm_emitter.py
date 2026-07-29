from __future__ import annotations

import json
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
def vm_emitter_harness(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("wasm-vm-emitter")
    source = directory / "harness.cpp"
    executable = directory / "harness.exe"
    source.write_text(
        r'''
#include "compiler/native/vkf_wasm_vm_emitter.hpp"

#include <fstream>
#include <iostream>
#include <string>

using namespace vkf::wasm;

bytecode::Module make_module(bool unsupported = false) {
    bytecode::Module module;
    module.constants = {
        bytecode::Constant::utf8_string("scale"),
        bytecode::Constant::number_value(2.0),
        bytecode::Constant::utf8_string("entry"),
        bytecode::Constant::utf8_string("factorial"),
        bytecode::Constant::number_value(1.0),
        bytecode::Constant::utf8_string("array"),
        bytecode::Constant::number_value(3.0),
        bytecode::Constant::utf8_string("record"),
        bytecode::Constant::utf8_string("key"),
        bytecode::Constant::utf8_string("value"),
        bytecode::Constant::utf8_string("concat"),
        bytecode::Constant::utf8_string("ab"),
        bytecode::Constant::utf8_string("cd"),
    };

    bytecode::Function scale;
    scale.name_constant = 0;
    scale.parameter_count = 1;
    scale.return_type = bytecode::ValueType::Number;
    scale.local_types = {bytecode::ValueType::Number};
    scale.instructions = {
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 1, 0},
        {bytecode::Opcode::Multiply, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
    };

    bytecode::Function entry;
    entry.name_constant = 2;
    entry.parameter_count = 2;
    entry.return_type = bytecode::ValueType::Number;
    entry.local_types = {
        bytecode::ValueType::Number,
        bytecode::ValueType::Number,
        bytecode::ValueType::Number,
    };
    entry.instructions = {
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 1, 0},
        {bytecode::Opcode::Add, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::StoreLocal, bytecode::ValueType::Void, 2, 0},
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 2, 0},
        {bytecode::Opcode::Call, bytecode::ValueType::Number, 0, 1},
        {bytecode::Opcode::Negate, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 1, 0},
        {bytecode::Opcode::Divide, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
    };
    if (unsupported) {
        entry.instructions[6].opcode = bytecode::Opcode::IdentifierScan;
    }

    bytecode::Function factorial;
    factorial.name_constant = 3;
    factorial.parameter_count = 1;
    factorial.return_type = bytecode::ValueType::Number;
    factorial.local_types = {bytecode::ValueType::Number};
    factorial.instructions = {
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 4, 0},
        {bytecode::Opcode::LessEqual, bytecode::ValueType::Boolean, 0, 0},
        {bytecode::Opcode::JumpIfFalse, bytecode::ValueType::Void, 6, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 4, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::LoadLocal, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 4, 0},
        {bytecode::Opcode::Subtract, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::Call, bytecode::ValueType::Number, 2, 1},
        {bytecode::Opcode::Multiply, bytecode::ValueType::Number, 0, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
    };

    bytecode::Function array;
    array.name_constant = 5;
    array.return_type = bytecode::ValueType::Array;
    array.instructions = {
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 4, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::Number, 6, 0},
        {bytecode::Opcode::MakeArray, bytecode::ValueType::Array, 2, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
    };

    bytecode::Function record;
    record.name_constant = 7;
    record.return_type = bytecode::ValueType::Object;
    record.instructions = {
        {bytecode::Opcode::PushConstant, bytecode::ValueType::String, 8, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::String, 9, 0},
        {bytecode::Opcode::MakeObject, bytecode::ValueType::Object, 1, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
    };

    bytecode::Function concat;
    concat.name_constant = 10;
    concat.return_type = bytecode::ValueType::String;
    concat.instructions = {
        {bytecode::Opcode::PushConstant, bytecode::ValueType::String, 11, 0},
        {bytecode::Opcode::PushConstant, bytecode::ValueType::String, 12, 0},
        {bytecode::Opcode::Concatenate, bytecode::ValueType::String, 0, 0},
        {bytecode::Opcode::Return, bytecode::ValueType::Void, 0, 0},
    };

    module.functions = {scale, entry, factorial, array, record, concat};
    module.entry_function = 1;
    return module;
}

int main(int argc, char** argv) {
    if (argc < 3) {
        return 4;
    }
    const std::string mode = argv[1];
    try {
        auto module = make_module(mode == "unsupported");
        if (mode == "underflow") {
            module.functions[1].instructions.erase(
                module.functions[1].instructions.begin()
            );
        }
        const auto first = vm::emit(module);
        const auto second = vm::emit(module);
        if (first.wasm != second.wasm) {
            return 5;
        }
        std::ofstream output(argv[2], std::ios::binary);
        output.write(
            reinterpret_cast<const char*>(first.wasm.data()),
            static_cast<std::streamsize>(first.wasm.size())
        );
        output.close();
        std::cout
            << first.wasm.size() << " "
            << first.layout.bytecode_len << " "
            << first.layout.arguments_ptr << " "
            << first.layout.results_ptr;
        return 0;
    } catch (const vm::VmEmitterError& error) {
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


def test_emits_deterministic_executable_wasm(
    vm_emitter_harness: Path,
    tmp_path: Path,
) -> None:
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node.js is required")
    wasm_path = tmp_path / "vm.wasm"
    first = subprocess.run(
        [str(vm_emitter_harness), "emit", str(wasm_path)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    first_bytes = wasm_path.read_bytes()
    second = subprocess.run(
        [str(vm_emitter_harness), "emit", str(wasm_path)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert first.stdout == second.stdout
    assert first_bytes == wasm_path.read_bytes()
    assert first_bytes[:8] == b"\0asm\x01\0\0\0"

    script = tmp_path / "run.mjs"
    script.write_text(
        r'''
import { readFileSync } from "node:fs";

const bytes = readFileSync(process.argv[2]);
const { instance } = await WebAssembly.instantiate(bytes, {});
const e = instance.exports;
const required = [
  "memory",
  "vkf_vm_bytecode_ptr",
  "vkf_vm_bytecode_len",
  "vkf_vm_arguments_ptr",
  "vkf_vm_arguments_capacity",
  "vkf_vm_results_ptr",
  "vkf_vm_results_capacity",
  "vkf_vm_value_slot_size",
  "vkf_vm_heap_base",
  "vkf_vm_heap_limit",
  "vkf_vm_heap_ptr",
  "vkf_vm_alloc",
  "vkf_vm_reset",
  "vkf_vm_invoke",
  "vkf_vm_evaluate",
];
for (const name of required) {
  if (!(name in e)) throw new Error(`missing export ${name}`);
}
const bytecode = new Uint8Array(
  e.memory.buffer,
  e.vkf_vm_bytecode_ptr(),
  e.vkf_vm_bytecode_len(),
);
const view = new DataView(e.memory.buffer);
const args = e.vkf_vm_arguments_ptr();
const result = e.vkf_vm_results_ptr();
const setNumber = (pointer, value) => {
  view.setUint32(pointer, 2, true);
  view.setUint32(pointer + 4, 0, true);
  view.setFloat64(pointer + 8, value, true);
};
const readString = (pointer) => {
  const length = view.getUint32(pointer + 4, true);
  const payload = view.getUint32(pointer + 8, true);
  return new TextDecoder().decode(
    new Uint8Array(e.memory.buffer, payload, length),
  );
};
setNumber(args, 3);
setNumber(args + 16, 5);
const entryStatus = e.vkf_vm_evaluate(2);
const entryValue = view.getFloat64(result + 8, true);
setNumber(args, 7);
const callStatus = e.vkf_vm_invoke(0, 1);
const callValue = view.getFloat64(result + 8, true);
setNumber(args, 5);
const factorialStatus = e.vkf_vm_invoke(2, 1);
const factorialValue = view.getFloat64(result + 8, true);
const arrayStatus = e.vkf_vm_invoke(3, 0);
const arrayLength = view.getUint32(result + 4, true);
const arrayPayload = view.getUint32(result + 8, true);
const arrayFirst = view.getUint32(arrayPayload, true);
const arraySecond = view.getUint32(arrayPayload + 4, true);
const arrayValues = [
  view.getFloat64(arrayFirst + 8, true),
  view.getFloat64(arraySecond + 8, true),
];
const recordStatus = e.vkf_vm_invoke(4, 0);
const recordLength = view.getUint32(result + 4, true);
const recordPayload = view.getUint32(result + 8, true);
const recordKey = readString(view.getUint32(recordPayload, true));
const recordValue = readString(view.getUint32(recordPayload + 4, true));
const concatStatus = e.vkf_vm_invoke(5, 0);
const concatValue = readString(result);
const badFunction = e.vkf_vm_invoke(99, 0);
const badArity = e.vkf_vm_invoke(0, 0);
process.stdout.write(JSON.stringify({
  bytecodeMagic: new TextDecoder().decode(bytecode.slice(0, 5)),
  bytecodeLength: bytecode.length,
  argumentsCapacity: e.vkf_vm_arguments_capacity(),
  resultsCapacity: e.vkf_vm_results_capacity(),
  valueSlotSize: e.vkf_vm_value_slot_size(),
  heapOrdered: e.vkf_vm_heap_base() < e.vkf_vm_heap_ptr()
    && e.vkf_vm_heap_ptr() <= e.vkf_vm_heap_limit(),
  entryStatus,
  entryValue,
  callStatus,
  callValue,
  factorialStatus,
  factorialValue,
  arrayStatus,
  arrayLength,
  arrayValues,
  recordStatus,
  recordLength,
  recordKey,
  recordValue,
  concatStatus,
  concatValue,
  badFunction,
  badArity,
}));
''',
        encoding="utf-8",
    )
    result = subprocess.run(
        [node, str(script), str(wasm_path)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    assert payload == {
        "bytecodeMagic": "VKFBC",
        "bytecodeLength": int(first.stdout.split()[1]),
        "argumentsCapacity": 16,
        "resultsCapacity": 1,
        "valueSlotSize": 16,
        "heapOrdered": True,
        "entryStatus": 0,
        "entryValue": -8,
        "callStatus": 0,
        "callValue": 14,
        "factorialStatus": 0,
        "factorialValue": 120,
        "arrayStatus": 0,
        "arrayLength": 2,
        "arrayValues": [1, 3],
        "recordStatus": 0,
        "recordLength": 1,
        "recordKey": "key",
        "recordValue": "value",
        "concatStatus": 0,
        "concatValue": "abcd",
        "badFunction": 1,
        "badArity": 2,
    }


def test_rejects_unsupported_bytecode(
    vm_emitter_harness: Path,
    tmp_path: Path,
) -> None:
    result = subprocess.run(
        [str(vm_emitter_harness), "unsupported", str(tmp_path / "bad.wasm")],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "cursor-record runtime" in result.stderr


def test_rejects_invalid_numeric_stack(
    vm_emitter_harness: Path,
    tmp_path: Path,
) -> None:
    result = subprocess.run(
        [str(vm_emitter_harness), "underflow", str(tmp_path / "bad.wasm")],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "underflows the numeric operand stack" in result.stderr
