from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "compiler" / "self_hosted" / "symbolic_expression.vkf"
LEXER_SOURCE = ROOT / "compiler" / "native" / "vkf_lexer_cursor_smoke.cpp"
PARSER_SOURCE = ROOT / "compiler" / "native" / "vkf_parser_token_stream_smoke.cpp"
AST_TO_IR_SOURCE = ROOT / "compiler" / "native" / "vkf_ast_to_ir_smoke.cpp"
JSON_SOURCE = ROOT / "native" / "VfOverlay" / "vf" / "json.cpp"


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


def test_symbolic_expression_source_is_real_vkf_with_stable_interfaces() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    module = parse_module(source, filename=SOURCE.as_posix())
    rendered = repr(module)

    for interface in (
        "symbolic_tokenize",
        "symbolic_parse_tokens",
        "symbolic_compile",
        "symbolic_latex",
        "symbolic_evaluate",
    ):
        assert interface in rendered

    for grammar_atom in ("NUMBER", "IDENT", "PLUS", "MINUS", "STAR", "SLASH", "CARET"):
        assert grammar_atom in rendered

    assert "\\\\pi" in rendered
    assert "3.141592653589793" in rendered
    assert "Python" not in source
    assert "_ =>" not in source


def test_symbolic_expression_declares_complete_browser_kernel_surface() -> None:
    source = SOURCE.read_text(encoding="utf-8")

    for capability in (
        "symbolic_compile_with_context",
        "symbolic_workspace_compile",
        "symbolic_program_evaluate_at",
        "symbolic_plot(program, workspace, view, style, revision)",
        "vf-symbolic-plot-renderer",
        "vf-screen-simplex-renderer",
    ):
        assert capability in source

    assert "missing: []" in source
    assert "belongs to the VKF rendering module" not in source


def test_native_pipeline_lowers_complete_symbolic_expression_to_typed_ir(
    tmp_path: Path,
) -> None:
    lexer = _compile_or_skip(
        [LEXER_SOURCE],
        tmp_path / "vkf_symbolic_expression_lexer.exe",
    )
    parser = _compile_or_skip(
        [PARSER_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_symbolic_expression_parser.exe",
    )
    ast_to_ir = _compile_or_skip(
        [AST_TO_IR_SOURCE, JSON_SOURCE],
        tmp_path / "vkf_symbolic_expression_ast_to_ir.exe",
    )

    tokens = subprocess.run(
        [str(lexer), "--file", str(SOURCE), SOURCE.relative_to(ROOT).as_posix()],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    token_payload = json.loads(tokens.stdout)
    assert token_payload["schema"] == "vektorflow.token_stream"
    assert token_payload["tokens"][-1]["kind"] == "EOF"

    parsed = subprocess.run(
        [str(parser)],
        cwd=ROOT,
        input=tokens.stdout,
        capture_output=True,
        text=True,
        check=True,
    )
    ast_payload = json.loads(parsed.stdout)
    assert ast_payload["kind"] == "module"
    assert ast_payload["body"]

    lowered = subprocess.run(
        [str(ast_to_ir)],
        cwd=ROOT,
        input=parsed.stdout,
        capture_output=True,
        text=True,
        check=True,
    )
    typed_module = json.loads(lowered.stdout)
    assert typed_module["kind"] == "typed_module"

    functions = {
        statement["name"]: statement
        for statement in typed_module["body"]
        if statement["kind"] == "function"
    }
    assert "symbolic_compile" in functions

    def calls_named(value: object, name: str) -> bool:
        if isinstance(value, dict):
            if (
                value.get("kind") == "call"
                and isinstance(value.get("callee"), dict)
                and value["callee"].get("kind") == "load"
                and value["callee"].get("name") == name
            ):
                return True
            return any(calls_named(child, name) for child in value.values())
        if isinstance(value, list):
            return any(calls_named(child, name) for child in value)
        return False

    recursive_functions = {
        name
        for name, function in functions.items()
        if calls_named(function["body"], name)
    }
    assert {
        "symbolic_tokenize_step",
        "symbolic_evaluate",
    } <= recursive_functions

    for left, right in (
        ("symbolic_parse_power", "symbolic_parse_power_right"),
        (
            "symbolic_parse_multiplicative_tail",
            "symbolic_parse_multiplicative_right",
        ),
        ("symbolic_parse_additive_tail", "symbolic_parse_additive_right"),
    ):
        assert calls_named(functions[left]["body"], right)
        assert calls_named(functions[right]["body"], left)
