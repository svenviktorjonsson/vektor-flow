from __future__ import annotations

from pathlib import Path

from vektorflow.parser import parse_module


ROOT = Path(__file__).resolve().parent.parent
COMPILER_RULES_PATH = ROOT / "compiler" / "self_hosted" / "COMPILER_SOURCE_RULES.md"
PARSER_SOURCE_PATH = ROOT / "compiler" / "self_hosted" / "parser.vkf"
TYPED_IR_SOURCE_PATH = ROOT / "compiler" / "self_hosted" / "typed_ir.vkf"


def test_self_hosted_lexer_source_parses_with_bootstrap_parser() -> None:
    source_path = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    source = source_path.read_text(encoding="utf-8")

    module = parse_module(source, filename=source_path.as_posix())
    rendered = repr(module)

    assert "self_hosted_lexer_seed" in rendered
    assert "is_digit" in rendered
    assert "token_kind_catalog" in rendered


def test_self_hosted_lexer_declares_burst_2_scanner_capabilities() -> None:
    source_path = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    source = source_path.read_text(encoding="utf-8")

    capability_names = [
        "scan_whitespace",
        "scan_comment",
        "scan_identifier",
        "scan_number",
    ]

    for capability_name in capability_names:
        assert capability_name in source


def test_self_hosted_lexer_declares_cursor_helper_shapes() -> None:
    source_path = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    source = source_path.read_text(encoding="utf-8")

    helper_shapes = [
        "eof(cursor:Cursor)",
        "peek(cursor:Cursor)",
        "advance(cursor:Cursor)",
        "consume_while(cursor:Cursor, predicate_name:str)",
    ]

    for helper_shape in helper_shapes:
        assert helper_shape in source


def test_self_hosted_lexer_records_missing_string_indexing_and_slicing() -> None:
    source_path = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    source = source_path.read_text(encoding="utf-8")

    assert "vkf_string_eof primitive" in source
    assert "vkf_string_peek_scalar primitive" in source
    assert "vkf_string_slice_bytes primitive" in source
    assert "vkf_string_eof for cursor EOF checks" in source
    assert "vkf_string_slice_bytes for token text capture" in source


def test_self_hosted_lexer_declares_identifier_number_parity_fixture() -> None:
    source_path = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    source = source_path.read_text(encoding="utf-8")

    assert "identifier_number_parity_minimal" in source
    assert "IDENT:alpha" in source
    assert "NUMBER:123" in source


def test_string_primitive_architecture_doc_exists_and_names_minimum_primitives() -> None:
    doc_path = ROOT / "docs" / "architecture" / "python-free-language-string-primitives.md"
    doc = doc_path.read_text(encoding="utf-8")

    primitive_names = [
        "vkf_string_byte_len",
        "vkf_string_eof",
        "vkf_string_peek_scalar",
        "vkf_string_scalar_width",
        "vkf_string_slice_bytes",
        "vkf_cursor_advance_scalar",
    ]

    for primitive_name in primitive_names:
        assert primitive_name in doc

    assert "byte offsets into UTF-8 source" in doc
    assert "Unicode scalar values" in doc
    assert "line and column" in doc
    assert "O(1)" in doc


def test_self_hosted_lexer_language_pressure_references_doc_primitives() -> None:
    source_path = ROOT / "compiler" / "self_hosted" / "lexer.vkf"
    doc_path = ROOT / "docs" / "architecture" / "python-free-language-string-primitives.md"
    source = source_path.read_text(encoding="utf-8")
    doc = doc_path.read_text(encoding="utf-8")

    primitive_names = [
        "vkf_string_byte_len",
        "vkf_string_eof",
        "vkf_string_peek_scalar",
        "vkf_string_scalar_width",
        "vkf_string_slice_bytes",
        "vkf_cursor_advance_scalar",
    ]

    assert "language_pressure" in source
    for primitive_name in primitive_names:
        assert primitive_name in doc
        assert primitive_name in source


def test_compiler_source_rules_doc_exists_and_names_canonical_match_forms() -> None:
    doc = COMPILER_RULES_PATH.read_text(encoding="utf-8")

    required_markers = [
        "Use real VKF syntax only.",
        "Multi-arm discrimination uses `??`.",
        "Explicit match arms use `=>`.",
        "The default arm in `??` is a plain direct body at arm scope.",
        "`_ =>` is not supported",
        "Do not invent keyword forms such as `switch`, `match`, `case`",
        "Write compiler source in the clearest final language form",
        "Verify the syntax in `vektorflow/parser.py`.",
        "Verify user-facing examples in `tests/test_control_flow.py`",
    ]

    for marker in required_markers:
        assert marker in doc


def test_self_hosted_parser_and_typed_ir_use_canonical_match_shape() -> None:
    sources = [
        PARSER_SOURCE_PATH.read_text(encoding="utf-8"),
        TYPED_IR_SOURCE_PATH.read_text(encoding="utf-8"),
    ]

    required_markers = [
        "current.kind??",
        "kind??",
        'unsupported_syntax(cursor, "expected literal")',
        '"any"',
    ]
    forbidden_markers = [
        "_ =>",
        "switch(",
        "match(",
        "\nswitch ",
        "\nmatch ",
        "\ncase ",
    ]

    combined = "\n".join(sources)

    for marker in required_markers:
        assert marker in combined
    for marker in forbidden_markers:
        assert marker not in combined
