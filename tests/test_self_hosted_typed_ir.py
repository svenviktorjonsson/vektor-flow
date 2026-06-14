from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from vektorflow.compiler_bootstrap import compiler_bootstrap_sources
from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"
TYPED_IR_SOURCE = ROOT / "compiler" / "self_hosted" / "typed_ir.vkf"


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
def lexer_smoke_exe(tmp_path_factory: pytest.TempPathFactory) -> Path:
    tmp_path = tmp_path_factory.mktemp("typed_ir_lexer_smoke")
    return _compile_or_skip([LEXER_SMOKE_SOURCE], tmp_path / "vkf_lexer_cursor_smoke.exe")


@pytest.fixture(scope="module")
def parser_smoke_exe(tmp_path_factory: pytest.TempPathFactory) -> Path:
    tmp_path = tmp_path_factory.mktemp("typed_ir_parser_smoke")
    return _compile_or_skip(
        [PARSER_SMOKE_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_parser_token_stream_smoke.exe",
    )


@pytest.fixture(scope="module")
def ast_to_ir_smoke_exe(tmp_path_factory: pytest.TempPathFactory) -> Path:
    tmp_path = tmp_path_factory.mktemp("ast_to_ir_smoke")
    return _compile_or_skip(
        [AST_TO_IR_SMOKE_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_ast_to_ir_smoke.exe",
    )


def _run(exe: Path, input_text: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe)],
        cwd=ROOT,
        input=input_text,
        capture_output=True,
        text=True,
        check=True,
    )


def _pipeline_ir(
    source: str,
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> dict[str, Any]:
    tokens = subprocess.run(
        [str(lexer_smoke_exe), source, "<typed-ir-pipeline>"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    ast_json = _run(parser_smoke_exe, tokens).stdout
    ir_json = _run(ast_to_ir_smoke_exe, ast_json).stdout
    return json.loads(ir_json)


def _pipeline_ir_from_file(
    source_path: Path,
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> dict[str, Any]:
    tokens = subprocess.run(
        [str(lexer_smoke_exe), "--file", str(source_path), source_path.relative_to(ROOT).as_posix()],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    ast_json = _run(parser_smoke_exe, tokens).stdout
    ir_json = _run(ast_to_ir_smoke_exe, ast_json).stdout
    return json.loads(ir_json)


def test_typed_ir_source_parses_with_bootstrap_parser() -> None:
    source = TYPED_IR_SOURCE.read_text(encoding="utf-8")

    module = parse_module(source, filename=TYPED_IR_SOURCE.as_posix())
    rendered = repr(module)

    assert "self_hosted_typed_ir_seed" in rendered
    assert "vkf_ast_to_ir_smoke" in rendered
    assert "unknown identifier type any" in rendered
    assert "symbol_table" in rendered
    assert "known function call typing uses declared return type" in rendered
    assert "collections" in rendered
    assert "field_access" in rendered
    assert "stdlib_aliases" in rendered
    assert "collections.map alias call lowers to map field types" in rendered
    assert "math and stat function aliases preserve intrinsic return typing" in rendered


def test_native_ast_to_ir_smoke_source_has_no_host_fallback_hooks() -> None:
    sources = [
        AST_TO_IR_SMOKE_SOURCE.read_text(encoding="utf-8"),
        PARSER_SMOKE_SOURCE.read_text(encoding="utf-8"),
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


def test_pipeline_lowers_scalar_bind_to_typed_store(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    assert _pipeline_ir("answer: 42", lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe) == {
        "kind": "typed_module",
        "body": [
            {
                "kind": "store_binding",
                "name": "answer",
                "type": "num",
                "value": {"kind": "const", "type": "num", "value": 42},
            }
        ],
    }


def test_pipeline_lowers_bind_then_call_with_loaded_binding(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    assert _pipeline_ir(
        "answer: 42\nprint(answer)",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    ) == {
        "kind": "typed_module",
        "body": [
            {
                "kind": "store_binding",
                "name": "answer",
                "type": "num",
                "value": {"kind": "const", "type": "num", "value": 42},
            },
            {
                "kind": "expr_stmt",
                "expr": {
                    "kind": "call",
                    "type": "any",
                    "callee": {"kind": "load", "name": "print", "type": "any"},
                    "arg_types": ["num"],
                    "args": [{"kind": "load", "name": "answer", "type": "num"}],
                    "callee_type": "any",
                },
            },
        ],
    }


def test_pipeline_lowers_binary_comparison_chain(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    bind = _pipeline_ir(
        'is_digit(ch:str):\n    ch >= "0" /\\ ch <= "9"',
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )["body"][0]
    body = bind["body"]["body"][0]["expr"]
    assert body["kind"] == "binary_op"
    assert body["op"] == "AND"
    assert body["type"] == "bit"


def test_pipeline_lowers_dotted_index_expression(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    expr = _pipeline_ir(
        "cursor.tokens.(cursor.index)",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )["body"][0]["expr"]
    assert expr["kind"] == "dotted_index"
    assert expr["type"] == "any"


def test_pipeline_lowers_emit_abs_and_typeof_subset(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        'point: (x: 3, y: 4)\n:: point.\n:: |-3|',
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    assert module["body"][1]["kind"] == "expr_stmt"
    assert module["body"][1]["expr"]["kind"] == "call"
    assert module["body"][1]["expr"]["args"][0] == {"kind": "const", "type": "str", "value": "(x:num, y:num)"}
    assert module["body"][2]["expr"]["args"][0] == {"kind": "const", "type": "num", "value": 3}


def test_pipeline_lowers_file_module_alias_import_shape(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        'helpers: ."modules/83_file_module_helpers.vkf"',
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    assert module["body"][0]["kind"] == "module_import"
    assert module["body"][0]["alias"] == "helpers"
    assert module["body"][0]["path"] == {
        "kind": "dot_module_path",
        "segments": ["modules/83_file_module_helpers.vkf"],
    }


def test_pipeline_lowers_finite_pipe_subset_to_typed_list(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    bind = _pipeline_ir(
        "squares: [1..5] >> $ * $",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["type"] == "list<num>"
    assert bind["value"] == {
        "kind": "list",
        "items": [{"kind": "const", "type": "num", "value": value} for value in [1, 4, 9, 16, 25]],
        "element_type": "num",
        "type": "list<num>",
    }


def test_pipeline_lowers_pipe_subset_with_local_function_call(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        "square(x): x * x\n:: [1..5] >> square($)",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    assert module["body"][1]["kind"] == "expr_stmt"
    assert module["body"][1]["expr"]["kind"] == "call"
    assert module["body"][1]["expr"]["args"][0] == {
        "kind": "list",
        "items": [{"kind": "const", "type": "num", "value": value} for value in [1, 4, 9, 16, 25]],
        "element_type": "num",
        "type": "list<num>",
    }


def test_pipeline_lowers_tuple_literal_and_numeric_dotted_index(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        "point: (3, 4)\n:: point.0",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    bind = module["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["type"] == "tuple<num,num>"
    assert bind["value"] == {
        "kind": "tuple",
        "items": [
            {"kind": "const", "type": "num", "value": 3},
            {"kind": "const", "type": "num", "value": 4},
        ],
        "type": "tuple<num,num>",
    }
    assert module["body"][1]["expr"]["args"][0]["kind"] == "dotted_index"


def test_pipeline_lowers_multiset_literal_and_count_ops(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        "a: {1:4, 2:2}\nb: {1:2, 2:1}\n:: a + b\n:: a - b\n:: a // b",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    bind = module["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["type"] == "multiset<num>"
    assert bind["value"] == {
        "kind": "multiset",
        "pairs": [
            {
                "kind": "multiset_pair",
                "key": {"kind": "const", "type": "num", "value": 1},
                "count": {"kind": "const", "type": "num", "value": 4},
            },
            {
                "kind": "multiset_pair",
                "key": {"kind": "const", "type": "num", "value": 2},
                "count": {"kind": "const", "type": "num", "value": 2},
            },
        ],
        "element_type": "num",
        "type": "multiset<num>",
    }
    assert module["body"][2]["expr"]["args"][0]["op"] == "PLUS"
    assert module["body"][3]["expr"]["args"][0]["op"] == "MINUS"
    assert module["body"][4]["expr"]["args"][0]["op"] == "FLOORDIV"


def test_pipeline_lowers_attribute_and_numeric_index_rebind_subset(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        "point: (x: 3, y: 4)\npoint.z: 5\nvalues: [1, 2, 3]\nvalues.0: 4",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    assert module["body"][1] == {
        "kind": "update_attr",
        "base_name": "point",
        "field": "z",
        "value": {"kind": "const", "type": "num", "value": 5},
    }
    assert module["body"][3] == {
        "kind": "update_index",
        "base_name": "values",
        "indices": [{"kind": "const", "type": "num", "value": 0}],
        "value": {"kind": "const", "type": "num", "value": 4},
    }


def test_pipeline_lowers_match_stmt_expression(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    expr = _pipeline_ir(
        'pick(kind:str):\n    kind??\n        "a" => "x"\n        "fallback"',
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )["body"][0]["body"]["body"][0]["expr"]
    assert expr["kind"] == "match_stmt"
    assert expr["type"] == "any"
    assert len(expr["arms"]) == 2


def test_native_ast_to_ir_smoke_lowers_declared_compiler_bundle(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    for source_path in compiler_bootstrap_sources(ROOT):
        payload = _pipeline_ir_from_file(source_path, lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe)
        assert payload["kind"] == "typed_module"


def test_pipeline_lowers_function_shell_with_typed_return(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    assert _pipeline_ir(
        "double(x:num) -> num:\n    @: x",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    ) == {
        "kind": "typed_module",
        "body": [
            {
                "kind": "function",
                "name": "double",
                "type": "fn(num)->num",
                "params": [{"kind": "param", "name": "x", "type": "num"}],
                "return_type": "num",
                "signature": {
                    "kind": "function_signature",
                    "params": ["num"],
                    "return_type": "num",
                    "type": "fn(num)->num",
                },
                "body": {
                    "kind": "block",
                    "body": [
                        {
                            "kind": "return",
                            "type": "num",
                            "value": {"kind": "load", "name": "x", "type": "num"},
                        }
                    ],
                },
            }
        ],
    }


def test_known_function_return_type_propagates_through_binding(
    ast_to_ir_smoke_exe: Path,
) -> None:
    ir = json.loads(
        _run(
            ast_to_ir_smoke_exe,
            json.dumps(
                {
                    "kind": "module",
                    "body": [
                        {
                            "kind": "function_definition",
                            "name": "double",
                            "params": [
                                {
                                    "kind": "param",
                                    "name": "x",
                                    "type": {"kind": "type_annotation", "name": "num"},
                                }
                            ],
                            "return_type": {"kind": "type_annotation", "name": "num"},
                            "body": {
                                "kind": "block",
                                "statements": [
                                    {
                                        "kind": "return",
                                        "value": {"kind": "identifier", "name": "x"},
                                    }
                                ],
                            },
                        },
                        {
                            "kind": "bind",
                            "target": {"kind": "identifier", "name": "answer"},
                            "value": {
                                "kind": "call",
                                "callee": {"kind": "identifier", "name": "double"},
                                "args": [{"kind": "number_literal", "value": 21}],
                            },
                        },
                    ],
                }
            ),
        ).stdout
    )

    answer = ir["body"][1]
    assert answer["kind"] == "store_binding"
    assert answer["name"] == "answer"
    assert answer["type"] == "num"
    assert answer["value"]["kind"] == "call"
    assert answer["value"]["type"] == "num"
    assert answer["value"]["callee_type"] == "fn(num)->num"
    assert answer["value"]["arg_types"] == ["num"]


def test_known_function_wrong_arity_fails_without_fallback(
    ast_to_ir_smoke_exe: Path,
) -> None:
    proc = subprocess.run(
        [str(ast_to_ir_smoke_exe)],
        cwd=ROOT,
        input=json.dumps(
            {
                "kind": "module",
                "body": [
                    {
                        "kind": "function_definition",
                        "name": "double",
                        "params": [
                            {
                                "kind": "param",
                                "name": "x",
                                "type": {"kind": "type_annotation", "name": "num"},
                            }
                        ],
                        "return_type": {"kind": "type_annotation", "name": "num"},
                        "body": {
                            "kind": "block",
                            "statements": [
                                {
                                    "kind": "return",
                                    "value": {"kind": "identifier", "name": "x"},
                                }
                            ],
                        },
                    },
                    {
                        "kind": "bind",
                        "target": {"kind": "identifier", "name": "answer"},
                        "value": {
                            "kind": "call",
                            "callee": {"kind": "identifier", "name": "double"},
                            "args": [],
                        },
                    },
                ],
            }
        ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "wrong arity for function double: expected 1, got 0" in proc.stderr
    assert "fallback" not in proc.stderr.lower()


def test_pipeline_lowers_list_bind_to_typed_list(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    assert _pipeline_ir("values: [1, 2]", lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe) == {
        "kind": "typed_module",
        "body": [
            {
                "kind": "store_binding",
                "name": "values",
                "type": "list<num>",
                "value": {
                    "kind": "list",
                    "items": [
                        {"kind": "const", "type": "num", "value": 1},
                        {"kind": "const", "type": "num", "value": 2},
                    ],
                    "element_type": "num",
                    "type": "list<num>",
                },
            }
        ],
    }


def test_pipeline_lowers_record_bind_and_field_access(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    assert _pipeline_ir(
        'person: (name: "Ada", age: 42)\nname: person.name',
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    ) == {
        "kind": "typed_module",
        "body": [
            {
                "kind": "store_binding",
                "name": "person",
                "type": "record{name:str,age:num}",
                "value": {
                    "kind": "record",
                    "type": "record{name:str,age:num}",
                    "fields": [
                        {
                            "kind": "field",
                            "name": "name",
                            "type": "str",
                            "value": {"kind": "const", "type": "str", "value": "Ada"},
                        },
                        {
                            "kind": "field",
                            "name": "age",
                            "type": "num",
                            "value": {"kind": "const", "type": "num", "value": 42},
                        },
                    ],
                },
            },
            {
                "kind": "store_binding",
                "name": "name",
                "type": "str",
                "value": {
                    "kind": "field_access",
                    "field": "name",
                    "object_type": "record{name:str,age:num}",
                    "type": "str",
                    "object": {
                        "kind": "load",
                        "name": "person",
                        "type": "record{name:str,age:num}",
                    },
                },
            }
        ],
    }


def test_pipeline_lowers_mixed_list_to_any_element_type(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    bind = _pipeline_ir('mixed: [1, "two"]', lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe)["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["name"] == "mixed"
    assert bind["type"] == "list<any>"
    assert bind["value"]["element_type"] == "any"


def test_pipeline_lowers_axis_aligned_fixed_vector_bind(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    bind = _pipeline_ir("u: [-1, 0, 1] -> u", lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe)["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["name"] == "u"
    assert bind["type"] == "axis<u>:list<num>"
    assert bind["value"] == {
        "kind": "axis_align",
        "axis_key": "u",
        "type": "axis<u>:list<num>",
        "value": {
            "kind": "list",
            "items": [
                {"kind": "const", "type": "num", "value": -1},
                {"kind": "const", "type": "num", "value": 0},
                {"kind": "const", "type": "num", "value": 1},
            ],
            "element_type": "num",
            "type": "list<num>",
        },
    }


def test_pipeline_lowers_axis_suffix_fixed_vector_bind(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    bind = _pipeline_ir("u: [1, 2]_ij", lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe)["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["name"] == "u"
    assert bind["type"] == "axis<ij>:list<num>"
    assert bind["value"] == {
        "kind": "axis_align",
        "axis_key": "ij",
        "type": "axis<ij>:list<num>",
        "value": {
            "kind": "list",
            "items": [
                {"kind": "const", "type": "num", "value": 1},
                {"kind": "const", "type": "num", "value": 2},
            ],
            "element_type": "num",
            "type": "list<num>",
        },
    }


def test_pipeline_lowers_dynamic_axis_aligned_bind_to_any_axis_key(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        'axis_name: "v"\nv: [-1, 0, 1] -> (axis_name)',
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    bind = module["body"][1]
    assert bind["kind"] == "store_binding"
    assert bind["name"] == "v"
    assert bind["type"] == "axis<any>:list<num>"
    assert bind["value"]["kind"] == "axis_align"
    assert bind["value"]["axis_key"] == "any"


def test_pipeline_lowers_disjoint_axis_outer_product_subset(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    module = _pipeline_ir(
        "u: [-1, 0, 1] -> u\nv: [-1, 0, 1] -> v\nz: u * v",
        lexer_smoke_exe,
        parser_smoke_exe,
        ast_to_ir_smoke_exe,
    )
    bind = module["body"][2]
    assert bind["kind"] == "store_binding"
    assert bind["name"] == "z"
    assert bind["type"] == "axis<uv>:list<list<num>>"
    assert bind["value"]["kind"] == "binary_op"
    assert bind["value"]["type"] == "axis<uv>:list<list<num>>"


def test_pipeline_unknown_field_access_is_explicit_any(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
    ast_to_ir_smoke_exe: Path,
) -> None:
    bind = _pipeline_ir("name: external.name", lexer_smoke_exe, parser_smoke_exe, ast_to_ir_smoke_exe)["body"][0]
    assert bind["kind"] == "store_binding"
    assert bind["type"] == "any"
    assert bind["value"]["kind"] == "field_access"
    assert bind["value"]["object_type"] == "any"


def test_unknown_identifier_type_is_explicit_any(ast_to_ir_smoke_exe: Path) -> None:
    ast_json = json.dumps(
        {
            "kind": "module",
            "body": [{"kind": "identifier", "name": "missing"}],
        }
    )

    proc = _run(ast_to_ir_smoke_exe, ast_json)

    assert json.loads(proc.stdout) == {
        "kind": "typed_module",
        "body": [
            {
                "kind": "expr_stmt",
                "expr": {"kind": "load", "name": "missing", "type": "any"},
            }
        ],
    }


def test_unsupported_ast_kind_fails_hard(ast_to_ir_smoke_exe: Path) -> None:
    proc = subprocess.run(
        [str(ast_to_ir_smoke_exe)],
        cwd=ROOT,
        input=json.dumps({"kind": "module", "body": [{"kind": "match", "arms": []}]}),
        capture_output=True,
        text=True,
        check=False,
    )

    assert proc.returncode != 0
    assert "<ast-to-ir>:1:1" in proc.stderr
    assert "unsupported AST kind match" in proc.stderr
    assert "fallback" not in proc.stderr.lower()
