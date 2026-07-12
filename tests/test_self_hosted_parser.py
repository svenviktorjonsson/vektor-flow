from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from vektorflow import ast
from vektorflow.lexer import tokenize
from vektorflow.parser import parse_module, parse_token_stream_json
from vektorflow.token_stream import TOKEN_STREAM_SCHEMA, TOKEN_STREAM_VERSION, token_stream_to_json


ROOT = Path(__file__).resolve().parent.parent
PARSER_SOURCE = ROOT / "compiler" / "self_hosted" / "parser.vkf"
PARSER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
LEXER_SMOKE_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"


def _parser_source() -> str:
    return PARSER_SOURCE.read_text(encoding="utf-8")


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


@pytest.fixture(scope="module")
def parser_smoke_exe(tmp_path_factory: pytest.TempPathFactory) -> Path:
    tmp_path = tmp_path_factory.mktemp("parser_smoke")
    output = tmp_path / "vkf_parser_token_stream_smoke.exe"
    command = _compiler_command([PARSER_SMOKE_SOURCE, JSON_SOURCE], output)
    if command is None:
        pytest.skip("no C++ compiler found")

    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


@pytest.fixture(scope="module")
def lexer_smoke_exe(tmp_path_factory: pytest.TempPathFactory) -> Path:
    tmp_path = tmp_path_factory.mktemp("lexer_smoke_for_parser")
    output = tmp_path / "vkf_lexer_cursor_smoke.exe"
    command = _compiler_command([LEXER_SMOKE_SOURCE], output)
    if command is None:
        pytest.skip("no C++ compiler found")

    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True)
    return output


def _token_payload(source: str, filename: str = "<parser-parity>") -> str:
    return token_stream_to_json(tokenize(source, filename=filename))


def _run_parser_smoke(exe: Path, payload: str) -> dict[str, Any]:
    proc = subprocess.run(
        [str(exe)],
        cwd=ROOT,
        input=payload,
        capture_output=True,
        text=True,
        check=True,
    )
    assert proc.stderr == ""
    return json.loads(proc.stdout)


def _run_parser_smoke_error(exe: Path, payload: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(exe)],
        cwd=ROOT,
        input=payload,
        capture_output=True,
        text=True,
        check=False,
    )


def _normalized_node(node: Any) -> dict[str, Any]:
    if isinstance(node, ast.Module):
        return {"kind": "module", "body": [_normalized_node(statement) for statement in node.statements]}
    if isinstance(node, ast.ExprStmt):
        return _normalized_node(node.expr)
    if isinstance(node, ast.Bind):
        return {
            "kind": "bind",
            "target": _normalized_node(node.target),
            "value": _normalized_node(node.value),
        }
    if isinstance(node, ast.StdioPrint):
        return {"kind": "emit", "value": _normalized_node(node.value)}
    if isinstance(node, ast.SpillImport):
        return {
            "kind": "spill_import",
            "path": _normalized_node(node.path),
            "alias": node.alias,
        }
    if isinstance(node, ast.NumberLit):
        return {"kind": "number_literal", "value": node.value}
    if isinstance(node, ast.StringLit):
        return {"kind": "string_literal", "raw": node.raw, "value": node.value}
    if isinstance(node, ast.BoolLit):
        return {"kind": "bool_literal", "value": node.value}
    if isinstance(node, ast.NullLit):
        return {"kind": "null_literal"}
    if isinstance(node, ast.UnaryOp):
        if node.op == "MINUS" and isinstance(node.operand, ast.NumberLit):
            return {"kind": "number_literal", "value": -node.operand.value}
        return {
            "kind": "unary_op",
            "op": node.op,
            "operand": _normalized_node(node.operand),
        }
    if isinstance(node, ast.ListLit):
        return {"kind": "list_literal", "items": [_normalized_node(element) for element in node.elements]}
    if isinstance(node, ast.MultisetLit):
        return {
            "kind": "multiset_literal",
            "pairs": [
                {
                    "kind": "multiset_pair",
                    "key": _normalized_node(key),
                    "count": _normalized_node(count),
                }
                for key, count in node.pairs
            ],
        }
    if isinstance(node, ast.TupleLit):
        return {"kind": "tuple_literal", "elements": [_normalized_node(element) for element in node.elements]}
    if isinstance(node, ast.RangeExpr):
        return {
            "kind": "range_expr",
            "start": None if node.start is None else _normalized_node(node.start),
            "end": None if node.end is None else _normalized_node(node.end),
        }
    if isinstance(node, ast.PipeChain):
        return {
            "kind": "pipe_chain",
            "source": _normalized_node(node.source),
            "segments": [_normalized_node(segment) for segment in node.segments],
        }
    if isinstance(node, ast.AxisAlign):
        return {
            "kind": "axis_align",
            "value": _normalized_node(node.value),
            "label": node.label,
            "indices": None if node.indices is None else [_normalized_node(index) for index in node.indices],
        }
    if isinstance(node, ast.Ident):
        return {"kind": "identifier", "name": node.name}
    if isinstance(node, ast.Call):
        return {
            "kind": "call",
            "args": [_normalized_node(arg) for arg in node.args],
            "callee": _normalized_node(node.func),
        }
    if isinstance(node, ast.NamedCallArg):
        return {"kind": "named_call_arg", "name": node.name, "value": _normalized_node(node.value)}
    if isinstance(node, ast.SpreadArg):
        return {"kind": "spread_arg", "expr": _normalized_node(node.expr)}
    if isinstance(node, ast.BinOp):
        return {
            "kind": "binary_op",
            "op": node.op,
            "left": _normalized_node(node.left),
            "right": _normalized_node(node.right),
        }
    if isinstance(node, ast.Attribute):
        return {
            "kind": "attribute",
            "object": _normalized_node(node.value),
            "name": node.name,
        }
    if isinstance(node, ast.DottedIndex):
        return {
            "kind": "dotted_index",
            "base": _normalized_node(node.base),
            "indices": [_normalized_node(index) for index in node.indices],
        }
    if isinstance(node, ast.TypeOf):
        return {"kind": "type_of", "value": _normalized_node(node.value)}
    if isinstance(node, ast.AbsExpr):
        return {"kind": "abs_expr", "value": _normalized_node(node.inner)}
    if isinstance(node, ast.DotModulePath):
        return {"kind": "dot_module_path", "segments": list(node.segments)}
    if isinstance(node, ast.MatchArm):
        return {
            "kind": "match_arm",
            "condition": None if node.condition is None else _normalized_node(node.condition),
            "body": _normalized_node(node.body),
        }
    if isinstance(node, ast.MatchStmt):
        return {
            "kind": "match_stmt",
            "discriminant": _normalized_node(node.discriminant),
            "arms": [_normalized_node(arm) for arm in node.arms],
            "loop": node.loop,
            "catch": node.catch,
        }
    if isinstance(node, ast.FuncDef):
        return_type = None
        if node.func_type is not None:
            return_type = _normalized_node(node.func_type.codomain)
        return {
            "kind": "function_definition",
            "body": _normalized_node(node.body),
            "name": node.name,
            "params": [_normalized_node(param) for param in node.params],
            "return_type": return_type,
        }
    if isinstance(node, ast.Param):
        type_node = None
        if node.type_ref is not None:
            type_node = _normalized_node(node.type_ref)
        elif node.type_name is not None:
            type_node = {"kind": "type_annotation", "name": node.type_name}
        return {
            "kind": "param",
            "name": node.name,
            "type": type_node,
            "default": None if node.default_expr is None else _normalized_node(node.default_expr),
            "variadic_positional": node.variadic_positional,
            "variadic_named": node.variadic_named,
        }
    if isinstance(node, ast.PrimTypeRef):
        return {"kind": "type_annotation", "name": node.name}
    if isinstance(node, ast.Block):
        return {"kind": "block", "statements": [_normalized_node(statement) for statement in node.statements]}
    if isinstance(node, ast.ReturnStmt):
        return {
            "kind": "return",
            "value": None if node.value is None else _normalized_node(node.value),
        }
    raise AssertionError(f"unsupported normalized AST node: {node!r}")


def _python_normalized_ast(payload: str) -> dict[str, Any]:
    clean_payload = json.loads(payload)
    for token in clean_payload.get("tokens", []):
        token.pop("raw", None)
    return _normalized_node(parse_token_stream_json(json.dumps(clean_payload)))


def _without_native_number_metadata(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _without_native_number_metadata(item)
            for key, item in value.items()
            if key != "is_integer_surface"
        }
    if isinstance(value, list):
        return [_without_native_number_metadata(item) for item in value]
    return value


def test_self_hosted_parser_source_parses_with_bootstrap_parser() -> None:
    source = _parser_source()

    module = parse_module(source, filename=PARSER_SOURCE.as_posix())
    rendered = repr(module)

    assert "self_hosted_parser_seed" in rendered
    assert "parse_token_stream_json" in rendered
    assert "TokenStreamEnvelope" in rendered


def test_self_hosted_parser_declares_token_stream_boundary_shapes() -> None:
    source = _parser_source()

    required_markers = [
        "TOKEN_STREAM_SCHEMA",
        "vektorflow.token_stream",
        "TOKEN_STREAM_VERSION",
        "version",
        "tokens",
        "location",
        "EOF",
        "parse_token_stream_json",
        "validate_envelope_shape",
        "validate_eof",
    ]

    for marker in required_markers:
        assert marker in source


def test_self_hosted_parser_declares_cursor_helpers() -> None:
    source = _parser_source()

    helper_shapes = [
        "cursor(envelope:TokenStreamEnvelope)",
        "peek(cursor:ParseCursor)",
        "peek_kind(cursor:ParseCursor)",
        "advance(cursor:ParseCursor)",
        "expect(cursor:ParseCursor, kind:str)",
        "at_end(cursor:ParseCursor)",
    ]

    for helper_shape in helper_shapes:
        assert helper_shape in source


def test_self_hosted_parser_declares_diagnostics_with_source_spans() -> None:
    source = _parser_source()

    diagnostic_markers = [
        "Diagnostic: (code:str, message:str, file:str, line:num, column:num, span:Span)",
        "file: where.file",
        "line: where.line",
        "column: where.column",
        "span: span(where, stop)",
        "unsupported-syntax",
    ]

    for marker in diagnostic_markers:
        assert marker in source


def test_self_hosted_parser_declares_subset_ast_node_records() -> None:
    source = _parser_source()

    ast_shapes = [
        "ModuleNode: (kind:str, body:any, span:Span)",
        "BindNode: (kind:str, target:any, annotation:any, value:any, span:Span)",
        "NumberLiteralNode: (kind:str, value:num, span:Span)",
        "StringLiteralNode: (kind:str, value:str, raw:bit, span:Span)",
        "BoolLiteralNode: (kind:str, value:bit, span:Span)",
        "NullLiteralNode: (kind:str, span:Span)",
        "IdentifierNode: (kind:str, name:str, span:Span)",
        "CallNode: (kind:str, callee:any, args:any, span:Span)",
        "BinaryOpNode",
        "DottedIndexNode",
        "MatchStmtNode",
        "FunctionDefinitionNode: (kind:str, name:str, params:any, return_type:any, body:any, span:Span)",
        "BlockNode: (kind:str, statements:any, span:Span)",
        "TypeAnnotationNode: (kind:str, name:str, span:Span)",
    ]

    for ast_shape in ast_shapes:
        assert ast_shape in source


def test_self_hosted_parser_source_has_no_source_scan_fallback_markers() -> None:
    source = _parser_source()

    forbidden_markers = [
        "tokenize(",
        "Python",
        "python.exe",
        "lexer fallback",
        "parse_module(source",
    ]

    for marker in forbidden_markers:
        assert marker not in source


def test_native_parser_smoke_source_has_no_host_fallback_hooks() -> None:
    source = PARSER_SMOKE_SOURCE.read_text(encoding="utf-8")

    forbidden_markers = [
        "Python.h",
        "Py_Initialize",
        "python.exe",
        "system(",
        "popen(",
    ]

    for marker in forbidden_markers:
        assert marker not in source


def test_bootstrap_parser_accepts_versioned_token_stream_json_directly() -> None:
    payload = {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": [
            {
                "kind": "IDENT",
                "value": "answer",
                "location": {"file": "<parser-test>", "line": 1, "column": 1},
            },
            {
                "kind": "COLON",
                "value": None,
                "location": {"file": "<parser-test>", "line": 1, "column": 7},
            },
            {
                "kind": "NUMBER",
                "value": 42,
                "location": {"file": "<parser-test>", "line": 1, "column": 9},
            },
            {
                "kind": "EOF",
                "value": None,
                "location": {"file": "<parser-test>", "line": 1, "column": 11},
            },
        ],
    }

    rendered = repr(parse_token_stream_json(json.dumps(payload)))

    assert "answer" in rendered
    assert "42" in rendered


def test_bootstrap_parser_rejects_unsupported_token_stream_without_source_retry() -> None:
    payload = {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": [
            {
                "kind": "PLUS",
                "value": None,
                "location": {"file": "<parser-test>", "line": 3, "column": 5},
            },
            {
                "kind": "EOF",
                "value": None,
                "location": {"file": "<parser-test>", "line": 3, "column": 6},
            },
        ],
    }

    with pytest.raises(Exception) as excinfo:
        parse_token_stream_json(json.dumps(payload))

    message = str(excinfo.value)
    assert "3" in message
    assert "5" in message
    assert "fallback" not in message.lower()


@pytest.mark.parametrize(
    "source",
    [
        "answer: 42",
        'name: "Ada"',
        "raw: 'Ada'",
        "flag: true",
        "flag: false",
        "value: null",
        "answer",
        "print(answer)",
        "peek(cursor).kind",
        "cursor.tokens.(cursor.index)",
            'pipeline: ["a"\n    "b"]',
            "u: [-1, 0, 1] -> u",
            "u: [1, 2]_ij",
            'axis_name: "v"\nv: [-1, 0, 1] -> (axis_name)',
            "from_zero: [..3]",
            'pick(kind:str):\n    kind??\n        "a" => "x"\n        "fallback"',
            'kind: "edge"\nkind??\n    "edge" => color: "green"',
            "answer: 42\nprint(answer)",
        'first: "Viktor"; last: "Jonsson"\n:: first & " " & last',
        "point: (3, 4)\n:: point\n:: point.0\n:: point.1",
        "double(x:num) -> num:\n    @: x",
        "vkf_update(state:axis<u>:list<num>, input:num) -> axis<u>:list<num>:\n    @: state + input",
        "greet(name:str):\n    print(name)",
        "main():\n    answer: 42\n    print(answer)",
        'is_digit(ch:str):\n    ch >= "0" /\\ ch <= "9"',
        "squares: [1..5] >> $ * $",
        "square(x): x * x\n:: [1..5] >> square($)",
        ":: |-3|",
        "bag: {1:4, 2:2}\n:: bag",
        ":: point.",
        'helpers: ."modules/83_file_module_helpers.vkf"',
    ],
)
def test_native_parser_smoke_matches_python_normalized_ast(parser_smoke_exe: Path, source: str) -> None:
    payload = _token_payload(source)

    assert _without_native_number_metadata(_run_parser_smoke(parser_smoke_exe, payload)) == _python_normalized_ast(payload)


def test_native_parser_smoke_accepts_payload_from_argv(parser_smoke_exe: Path) -> None:
    payload = _token_payload("answer: 42")

    proc = subprocess.run(
        [str(parser_smoke_exe), payload],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    assert _without_native_number_metadata(json.loads(proc.stdout)) == _python_normalized_ast(payload)
    assert proc.stderr == ""


@pytest.mark.parametrize(
    "payload, expected",
    [
        (
            {
                "schema": "wrong.schema",
                "version": TOKEN_STREAM_VERSION,
                "tokens": [
                    {
                        "kind": "EOF",
                        "value": None,
                        "location": {"file": "<bad-schema>", "line": 1, "column": 1},
                    }
                ],
            },
            "unsupported schema",
        ),
        (
            {
                "schema": TOKEN_STREAM_SCHEMA,
                "version": 99,
                "tokens": [
                    {
                        "kind": "EOF",
                        "value": None,
                        "location": {"file": "<bad-version>", "line": 1, "column": 1},
                    }
                ],
            },
            "unsupported version",
        ),
        (
            {
                "schema": TOKEN_STREAM_SCHEMA,
                "version": TOKEN_STREAM_VERSION,
                "tokens": [
                    {
                        "kind": "IDENT",
                        "value": "answer",
                        "location": {"file": "<missing-eof>", "line": 2, "column": 3},
                    }
                ],
            },
            "missing EOF",
        ),
    ],
)
def test_native_parser_smoke_rejects_invalid_envelopes(
    parser_smoke_exe: Path,
    payload: dict[str, object],
    expected: str,
) -> None:
    proc = _run_parser_smoke_error(parser_smoke_exe, json.dumps(payload))

    assert proc.returncode != 0
    assert expected in proc.stderr
    assert "fallback" not in proc.stderr.lower()


def test_native_parser_smoke_unsupported_tokens_include_source_location(parser_smoke_exe: Path) -> None:
    payload = {
        "schema": TOKEN_STREAM_SCHEMA,
        "version": TOKEN_STREAM_VERSION,
        "tokens": [
            {
                "kind": "PLUS",
                "value": None,
                "location": {"file": "<unsupported>", "line": 7, "column": 9},
            },
            {
                "kind": "EOF",
                "value": None,
                "location": {"file": "<unsupported>", "line": 7, "column": 10},
            },
        ],
    }

    proc = _run_parser_smoke_error(parser_smoke_exe, json.dumps(payload))

    assert proc.returncode != 0
    assert "<unsupported>:7:9" in proc.stderr
    assert "unsupported token PLUS" in proc.stderr
    assert "fallback" not in proc.stderr.lower()


def test_native_lexer_smoke_output_pipes_into_native_parser_smoke(
    lexer_smoke_exe: Path,
    parser_smoke_exe: Path,
) -> None:
    lex_proc = subprocess.run(
        [str(lexer_smoke_exe), "answer: 42", "<lexer-to-parser>"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    native_ast = _run_parser_smoke(parser_smoke_exe, lex_proc.stdout)

    assert _without_native_number_metadata(native_ast) == _python_normalized_ast(lex_proc.stdout)
