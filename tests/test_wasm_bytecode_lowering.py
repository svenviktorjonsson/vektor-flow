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
                "-I",
                str(ROOT / "native/VfOverlay"),
                str(source),
                str(ROOT / "native/VfOverlay/vf/json.cpp"),
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
            str(source),
            str(ROOT / "native/VfOverlay/vf/json.cpp"),
            f"/Fe:{output}",
        ]
    pytest.skip("a C++17 compiler is required")


@pytest.fixture(scope="module")
def lowering_harness(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("wasm-bytecode-lowering")
    source = directory / "harness.cpp"
    executable = directory / "harness.exe"
    source.write_text(
        r'''
#include "compiler/native/vkf_wasm_bytecode_lowering.hpp"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using namespace vkf::wasm;
using namespace vkf::wasm::bytecode;

vf::JsonValue parse(const std::string& source) {
    return vf::parse_json(source);
}

const char* valid_ir = R"json(
{
  "kind": "typed_module",
  "body": [
    {
      "kind": "store_binding",
      "name": "unused_metadata",
      "type": "any",
      "value": {
        "kind": "block_expr", "type": "any",
        "body": [{
          "kind": "store_binding", "name": "label", "type": "str",
          "value": {"kind": "const", "type": "str", "value": "metadata"}
        }]
      }
    },
    {
      "kind": "store_binding",
      "name": "scale",
      "type": "num",
      "value": {"kind": "const", "type": "num", "value": 2}
    },
    {
      "kind": "function",
      "name": "main",
      "type": "fn(num)->num",
      "params": [{"kind": "param", "name": "x", "type": "num"}],
      "return_type": "num",
      "body": {
        "kind": "block",
        "body": [
          {
            "kind": "store_binding",
            "name": "scaled",
            "type": "num",
            "value": {
              "kind": "call",
              "type": "num",
              "callee": {"kind": "load", "name": "twice", "type": "any"},
              "args": [{"kind": "load", "name": "x", "type": "num"}]
            }
          },
          {
            "kind": "expr_stmt",
            "expr": {"kind": "const", "type": "str", "value": "discard"}
          },
          {
            "kind": "expr_stmt",
            "expr": {
              "kind": "binary_op",
              "op": "PLUS",
              "type": "num",
              "left": {"kind": "load", "name": "scaled", "type": "num"},
              "right": {"kind": "load", "name": "scale", "type": "num"}
            }
          }
        ]
      }
    },
    {
      "kind": "function",
      "name": "twice",
      "type": "fn(num)->num",
      "params": [{"kind": "param", "name": "value", "type": "num"}],
      "return_type": "num",
      "body": {
        "kind": "binary_op",
        "op": "STAR",
        "type": "num",
        "left": {"kind": "load", "name": "value", "type": "num"},
        "right": {"kind": "const", "type": "num", "value": 2}
      }
    },
    {
      "kind": "function",
      "name": "predicates",
      "type": "fn(num)->bool",
      "params": [{"kind": "param", "name": "value", "type": "num"}],
      "return_type": "bool",
      "body": {
        "kind": "unary_op",
        "op": "NOT",
        "type": "bool",
        "operand": {
          "kind": "binary_op",
          "op": "LE",
          "type": "bool",
          "left": {
            "kind": "unary_op",
            "op": "MINUS",
            "type": "num",
            "operand": {"kind": "load", "name": "value", "type": "num"}
          },
          "right": {"kind": "const", "type": "num", "value": 0}
        }
      }
    },
    {
      "kind": "function",
      "name": "nullable",
      "type": "fn()->any",
      "params": [],
      "return_type": "any",
      "body": {"kind": "const", "type": "any", "value": null}
    }
  ]
}
)json";

const char* rich_ir = R"json(
{
  "kind": "typed_module",
  "body": [
    {
      "kind": "function",
      "name": "walk",
      "type": "fn(num)->num",
      "params": [{"kind": "param", "name": "n", "type": "num"}],
      "return_type": "num",
      "body": {
        "kind": "block",
        "body": [
          {
            "kind": "if_stmt",
            "condition": {
              "kind": "binary_op", "op": "LE", "type": "bool",
              "left": {"kind": "load", "name": "n", "type": "num"},
              "right": {"kind": "const", "type": "num", "value": 0}
            },
            "body": {
              "kind": "block",
              "body": [{
                "kind": "return", "type": "num",
                "value": {"kind": "const", "type": "num", "value": 0}
              }]
            },
            "loop": false
          },
          {
            "kind": "expr_stmt",
            "expr": {
              "kind": "call", "type": "num",
              "callee": {"kind": "load", "name": "walk", "type": "any"},
              "args": [{
                "kind": "binary_op", "op": "MINUS", "type": "num",
                "left": {"kind": "load", "name": "n", "type": "num"},
                "right": {"kind": "const", "type": "num", "value": 1}
              }]
            }
          }
        ]
      }
    },
    {
      "kind": "function",
      "name": "collections",
      "type": "fn(bool,num)->any",
      "params": [
        {"kind": "param", "name": "flag", "type": "bool"},
        {"kind": "param", "name": "index", "type": "num"}
      ],
      "return_type": "any",
      "body": {
        "kind": "block",
        "body": [
          {
            "kind": "store_binding", "name": "items", "type": "list<any>",
            "value": {
              "kind": "list", "type": "list<any>", "element_type": "any",
              "items": [
                {"kind": "const", "type": "str", "value": "value"},
                {"kind": "load", "name": "flag", "type": "bool"},
                {"kind": "const", "type": "null", "value": null}
              ]
            }
          },
          {
            "kind": "store_binding", "name": "node",
            "type": "record{items:any,label:str}",
            "value": {
              "kind": "record", "type": "record{items:any,label:str}",
              "fields": [
                {
                  "kind": "field", "name": "items", "type": "any",
                  "value": {"kind": "load", "name": "items", "type": "list<any>"}
                },
                {
                  "kind": "field", "name": "label", "type": "str",
                  "value": {"kind": "const", "type": "str", "value": "node"}
                }
              ]
            }
          },
          {
            "kind": "expr_stmt",
            "expr": {
              "kind": "match_stmt", "type": "any", "catch": false,
              "loop": false,
              "discriminant": {
                "kind": "field_access", "field": "label", "type": "str",
                "object_type": "any",
                "object": {"kind": "load", "name": "node", "type": "any"}
              },
              "arms": [
                {
                  "kind": "match_arm",
                  "condition": {"kind": "const", "type": "str", "value": "node"},
                  "body": {
                    "kind": "dotted_index", "type": "any",
                    "base": {
                      "kind": "field_access", "field": "items", "type": "any",
                      "object_type": "any",
                      "object": {"kind": "load", "name": "node", "type": "any"}
                    },
                    "indices": [{"kind": "load", "name": "index", "type": "num"}]
                  }
                },
                {
                  "kind": "match_arm", "condition": null,
                  "body": {"kind": "const", "type": "null", "value": null}
                }
              ]
            }
          }
        ]
      }
    },
    {
      "kind": "function",
      "name": "logic",
      "type": "fn(bool,bool)->bool",
      "params": [
        {"kind": "param", "name": "a", "type": "bool"},
        {"kind": "param", "name": "b", "type": "bool"}
      ],
      "return_type": "bool",
      "body": {
        "kind": "binary_op", "op": "OR", "type": "bool",
        "left": {
          "kind": "binary_op", "op": "AND", "type": "bool",
          "left": {"kind": "load", "name": "a", "type": "bool"},
          "right": {"kind": "load", "name": "b", "type": "bool"}
        },
        "right": {"kind": "load", "name": "a", "type": "bool"}
      }
    }
  ]
}
)json";

int main(int argc, char** argv) {
    const std::string mode = argc > 1 ? argv[1] : "valid";
    try {
        std::string source = valid_ir;
        if (mode == "unsupported") {
            source = R"json({
              "kind":"typed_module",
              "body":[{
                "kind":"function","name":"bad","type":"fn()->any",
                "params":[],"return_type":"any",
                "body":{
                  "kind":"binary_op","op":"AMPERSAND","type":"any",
                  "left":{"kind":"list","type":"list<any>","element_type":"any","items":[]},
                  "right":{"kind":"list","type":"list<any>","element_type":"any","items":[]}
                }
              }]
            })json";
        } else if (mode == "intrinsic") {
            source = R"json({
              "kind":"typed_module",
              "body":[{
                "kind":"function","name":"peek","type":"fn(str,num)->any",
                "params":[
                  {"kind":"param","name":"source","type":"str"},
                  {"kind":"param","name":"offset","type":"num"}
                ],
                "return_type":"any",
                "body":{"kind":"call","type":"any",
                        "callee":{"kind":"load","name":"vkf_string_peek_scalar","type":"any"},
                        "args":[
                          {"kind":"load","name":"source","type":"str"},
                          {"kind":"load","name":"offset","type":"num"}
                        ]}
              }]
            })json";
        } else if (mode == "arity") {
            source = R"json({
              "kind":"typed_module",
              "body":[
                {"kind":"function","name":"callee","type":"fn(num)->num",
                 "params":[{"kind":"param","name":"x","type":"num"}],
                 "return_type":"num",
                 "body":{"kind":"load","name":"x","type":"num"}},
                {"kind":"function","name":"caller","type":"fn()->num",
                 "params":[],"return_type":"num",
                 "body":{"kind":"call","type":"num",
                         "callee":{"kind":"load","name":"callee","type":"any"},
                         "args":[]}}
              ]
            })json";
        } else if (mode == "rich") {
            source = rich_ir;
        } else if (mode == "typed-file") {
            if (argc < 3) {
                return 4;
            }
            std::ifstream input(argv[2], std::ios::binary);
            std::ostringstream buffer;
            buffer << input.rdbuf();
            source = buffer.str();
        }

        Module module = lower_typed_ir_to_bytecode(parse(source));
        if (mode == "typed-file") {
            std::cout << serialize(module).size();
            return 0;
        }
        if (mode == "rich") {
            if (module.functions.size() != 3) {
                return 20;
            }
            bool recursive_call = false;
            bool conditional_jump = false;
            bool made_array = false;
            bool made_object = false;
            bool got_field = false;
            bool got_index = false;
            bool matched = false;
            bool short_circuited = false;
            for (std::size_t function_index = 0;
                 function_index < module.functions.size();
                 ++function_index) {
                for (const auto& instruction :
                     module.functions[function_index].instructions) {
                    recursive_call = recursive_call
                        || (function_index == 0
                            && instruction.opcode == Opcode::Call
                            && instruction.first == 0);
                    conditional_jump = conditional_jump
                        || instruction.opcode == Opcode::JumpIfFalse;
                    made_array = made_array
                        || instruction.opcode == Opcode::MakeArray;
                    made_object = made_object
                        || instruction.opcode == Opcode::MakeObject;
                    got_field = got_field
                        || instruction.opcode == Opcode::ObjectGet;
                    got_index = got_index
                        || instruction.opcode == Opcode::ArrayGet;
                    matched = matched
                        || instruction.opcode == Opcode::Equal;
                    short_circuited = short_circuited
                        || instruction.opcode == Opcode::LogicalNot;
                }
            }
            if (!recursive_call || !conditional_jump || !made_array
                || !made_object || !got_field || !got_index || !matched
                || !short_circuited) {
                return 21;
            }
            std::cout << serialize(module).size();
            return 0;
        }
        if (mode != "valid") {
            return 5;
        }

        if (module.functions.size() != 4 || module.constants.size() != 7) {
            return 6;
        }
        const Function& main = module.functions[0];
        if (main.parameter_count != 1 || main.local_types.size() != 2) {
            return 7;
        }
        bool forward_call = false;
        bool stored_local = false;
        bool popped_expression = false;
        for (const auto& instruction : main.instructions) {
            forward_call = forward_call
                || (instruction.opcode == Opcode::Call
                    && instruction.first == 1
                    && instruction.second == 1);
            stored_local = stored_local
                || (instruction.opcode == Opcode::StoreLocal
                    && instruction.first == 1);
            popped_expression = popped_expression
                || instruction.opcode == Opcode::Pop;
        }
        if (!forward_call || !stored_local || !popped_expression
            || main.instructions.back().opcode != Opcode::Return) {
            return 8;
        }

        const Function& twice = module.functions[1];
        if (twice.instructions.size() != 4
            || twice.instructions[2].opcode != Opcode::Multiply
            || twice.instructions[3].opcode != Opcode::Return) {
            return 9;
        }
        const Function& predicates = module.functions[2];
        if (predicates.instructions.size() != 6
            || predicates.instructions[1].opcode != Opcode::Negate
            || predicates.instructions[3].opcode != Opcode::LessEqual
            || predicates.instructions[4].opcode != Opcode::LogicalNot
            || predicates.instructions[5].opcode != Opcode::Return) {
            return 10;
        }
        const Function& nullable = module.functions[3];
        if (nullable.instructions[0].opcode != Opcode::PushNull) {
            return 11;
        }

        const auto bytes_a = serialize(module);
        const auto bytes_b = serialize(
            lower_typed_ir_to_bytecode(parse(valid_ir))
        );
        if (bytes_a != bytes_b || !(module == deserialize(bytes_a))) {
            return 12;
        }
        std::cout << bytes_a.size();
        return 0;
    } catch (const BytecodeLoweringError& error) {
        std::cerr << error.what();
        return 2;
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 3;
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


def test_lowers_scalar_functions_and_calls_deterministically(
    lowering_harness: Path,
) -> None:
    first = _run(lowering_harness, "valid")
    second = _run(lowering_harness, "valid")

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert first.stdout == second.stdout
    assert int(first.stdout) > 100


def test_lowers_collections_control_flow_and_recursion(
    lowering_harness: Path,
) -> None:
    result = _run(lowering_harness, "rich")

    assert result.returncode == 0, result.stderr
    assert int(result.stdout) > 100


@pytest.mark.parametrize(
    ("mode", "message"),
    [
        ("unsupported", "collection/string concatenation"),
        ("intrinsic", "runtime intrinsic vkf_string_peek_scalar"),
        ("arity", "wrong arity for function callee"),
    ],
)
def test_rejects_unsupported_ir_explicitly(
    lowering_harness: Path,
    mode: str,
    message: str,
) -> None:
    result = _run(lowering_harness, mode)

    assert result.returncode == 2
    assert message in result.stderr
