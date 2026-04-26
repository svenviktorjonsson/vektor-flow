"""Tests for the Vektor Flow lexer."""

from __future__ import annotations

from pathlib import Path

import pytest

from vektorflow.errors import LexError
from vektorflow.lexer import tokenize
from vektorflow.tokens import (
    AMPERSAND,
    AND,
    ARROW,
    AT,
    BAR,
    CARET,
    COLON,
    COMMA,
    DEDENT,
    DOLLAR,
    DOT,
    FALSE,
    EMIT,
    EOF,
    EQ,
    FAT_ARROW,
    GE,
    GT,
    IDENT,
    INDENT,
    LBRACE,
    LBRACKET,
    LE,
    LPAREN,
    LT,
    MINUS,
    NEQ,
    NEWLINE,
    NOT,
    NUMBER,
    OR,
    PERCENT,
    PIPE,
    PLUS,
    QUESTION,
    RANGE,
    RBRACE,
    RBRACKET,
    RPAREN,
    SEMICOLON,
    SLASH,
    STAR,
    STRING,
    STRING_RAW,
    TRUE,
    XOR,
)


def kinds(source: str) -> list[str]:
    """Helper: return just the kinds of non-trivial tokens (excluding EOF).

    Keeps NEWLINE / INDENT / DEDENT to allow testing structural behavior.
    """
    return [t.kind for t in tokenize(source) if t.kind != EOF]


def values(source: str) -> list[tuple[str, object]]:
    """Helper: (kind, value) pairs for every token except structural ones."""
    return [
        (t.kind, t.value)
        for t in tokenize(source)
        if t.kind not in (NEWLINE, INDENT, DEDENT, EOF)
    ]


# --- Basic literals -------------------------------------------------------

class TestLiterals:
    def test_integer(self) -> None:
        assert values("42") == [(NUMBER, 42)]

    def test_float(self) -> None:
        assert values("4.2345") == [(NUMBER, 4.2345)]

    def test_string(self) -> None:
        assert values('"hello"') == [(STRING, "hello")]

    def test_string_with_dollar_kept_raw(self) -> None:
        # Interpolation is decoded later; the lexer stores raw dollar.
        assert values('"printing $a.2f"') == [(STRING, "printing $a.2f")]

    def test_string_escapes(self) -> None:
        assert values(r'"line\nbreak\ttab\"quote"') == [
            (STRING, 'line\nbreak\ttab"quote')
        ]

    def test_string_single_quoted_raw_dollar_backslash(self) -> None:
        assert values(r"'$5 and C:\not\escape'") == [(STRING_RAW, r"$5 and C:\not\escape")]

    def test_string_single_quoted_doubled_quote(self) -> None:
        assert values(r"'it''s ok'") == [(STRING_RAW, "it's ok")]

    def test_identifier(self) -> None:
        assert values("foo") == [(IDENT, "foo")]

    def test_true_false_keywords(self) -> None:
        assert values("true false") == [(TRUE, None), (FALSE, None)]

    def test_field_access_dot_true_is_ident(self) -> None:
        assert values("a.true") == [
            (IDENT, "a"),
            (DOT, (True, True)),
            (IDENT, "true"),
        ]

    def test_identifier_underscore_private(self) -> None:
        assert values("_hidden") == [(IDENT, "_hidden")]

    def test_field_access_after_dot_keyword_becomes_ident(self) -> None:
        # Keywords after `.` are field names (e.g. `a.type`, `a.interface`).
        assert values("a.type") == [
            (IDENT, "a"),
            (DOT, (True, True)),
            (IDENT, "type"),
        ]
        assert values("a.interface") == [
            (IDENT, "a"),
            (DOT, (True, True)),
            (IDENT, "interface"),
        ]

    def test_use_is_identifier(self) -> None:
        assert values("use") == [(IDENT, "use")]

    def test_logical_ops_are_not_keywords(self) -> None:
        assert values("and or xor not") == [
            (IDENT, "and"),
            (IDENT, "or"),
            (IDENT, "xor"),
            (IDENT, "not"),
        ]

    def test_logical_lexemes(self) -> None:
        assert kinds(r"/\ \/ >< ~")[:4] == [AND, OR, XOR, NOT]


# --- Single- and multi-character operators --------------------------------

class TestOperators:
    def test_arithmetic(self) -> None:
        assert kinds("+ - * / ^ %")[:6] == [
            PLUS, MINUS, STAR, SLASH, CARET, PERCENT,
        ]

    def test_ampersand_concat(self) -> None:
        assert kinds("&")[:1] == [AMPERSAND]

    def test_relations(self) -> None:
        assert kinds("= != < <= > >=")[:6] == [EQ, NEQ, LT, LE, GT, GE]

    def test_fat_arrow_vs_ge(self) -> None:
        assert kinds("=>")[:1] == [FAT_ARROW]
        assert kinds("a>=b")[:3] == [IDENT, GE, IDENT]

    def test_emit_vs_colon(self) -> None:
        assert kinds(":")[:1] == [COLON]
        assert kinds("::")[:1] == [EMIT]

    def test_range_vs_dot(self) -> None:
        assert kinds(".")[:1] == [DOT]
        assert kinds("..")[:1] == [RANGE]

    def test_arrow_function_type(self) -> None:
        assert kinds("->")[:1] == [ARROW]
        assert kinds("-")[:1] == [MINUS]

    def test_dollar(self) -> None:
        assert kinds("$")[:1] == [DOLLAR]

    def test_bar_and_pipe(self) -> None:
        assert kinds("|")[:1] == [BAR]
        assert kinds(">>")[:1] == [PIPE]

    def test_question(self) -> None:
        assert kinds("?")[:1] == [QUESTION]


# --- Grouping: ``(+ )`` is ``(`` ``+`` ``)``, not a special token ------------

class TestGroupingNotBracketOp:
    @pytest.mark.parametrize("op", ["+", "-", "*", "/"])
    def test_paren_wrapped_op_is_grouping(self, op: str) -> None:
        op_map = {"+": PLUS, "-": MINUS, "*": STAR, "/": SLASH}
        assert values(f"({op})") == [
            (LPAREN, None),
            (op_map[op], None),
            (RPAREN, None),
        ]

    @pytest.mark.parametrize("op", ["+", "-", "*", "/"])
    def test_square_brackets(self, op: str) -> None:
        op_map = {"+": PLUS, "-": MINUS, "*": STAR, "/": SLASH}
        assert values(f"[{op}]") == [
            (LBRACKET, None),
            (op_map[op], None),
            (RBRACKET, None),
        ]

    @pytest.mark.parametrize("op", ["+", "-", "*", "/"])
    def test_brace_wrapped_op_is_lbrace_plus_rbrace(self, op: str) -> None:
        op_map = {"+": PLUS, "-": MINUS, "*": STAR, "/": SLASH}
        assert values(f"{{{op}}}") == [
            (LBRACE, None),
            (op_map[op], None),
            (RBRACE, None),
        ]

    def test_plus_in_parens_in_expression(self) -> None:
        assert values("A (+) B") == [
            (IDENT, "A"),
            (LPAREN, None),
            (PLUS, None),
            (RPAREN, None),
            (IDENT, "B"),
        ]

    def test_tuple_not_mistaken_for_bracket_op(self) -> None:
        # `(1, 2)` is a tuple literal, not a bracket-op.
        assert values("(1, 2)") == [
            (LPAREN, None),
            (NUMBER, 1),
            (COMMA, None),
            (NUMBER, 2),
            (RPAREN, None),
        ]

    def test_grouping_paren_with_minus_inside(self) -> None:
        # `(-x)` should be LPAREN, MINUS, IDENT, RPAREN — not a bracket op
        # (would require `)` immediately after `-`).
        assert values("(-x)") == [
            (LPAREN, None),
            (MINUS, None),
            (IDENT, "x"),
            (RPAREN, None),
        ]

    def test_brace_lexes_colon_as_token_inside_braces(self) -> None:
        assert values("{1:2, 3:4}") == [
            (LBRACE, None),
            (NUMBER, 1),
            (COLON, None),
            (NUMBER, 2),
            (COMMA, None),
            (NUMBER, 3),
            (COLON, None),
            (NUMBER, 4),
            (RBRACE, None),
        ]

    def test_vector_range(self) -> None:
        assert values("[1..5]") == [
            (LBRACKET, None),
            (NUMBER, 1),
            (RANGE, None),
            (NUMBER, 5),
            (RBRACKET, None),
        ]


# --- Larger programs ------------------------------------------------------

class TestPrograms:
    def test_hello_world(self) -> None:
        assert values(':: "hello, world"') == [
            (EMIT, None),
            (STRING, "hello, world"),
        ]

    def test_function_definition(self) -> None:
        assert values("f(x, y) : x^2 + y^2") == [
            (IDENT, "f"),
            (LPAREN, None),
            (IDENT, "x"),
            (COMMA, None),
            (IDENT, "y"),
            (RPAREN, None),
            (COLON, None),
            (IDENT, "x"),
            (CARET, None),
            (NUMBER, 2),
            (PLUS, None),
            (IDENT, "y"),
            (CARET, None),
            (NUMBER, 2),
        ]

    def test_semicolon_in_function_body(self) -> None:
        assert values("f(x): y:2; x*y") == [
            (IDENT, "f"),
            (LPAREN, None),
            (IDENT, "x"),
            (RPAREN, None),
            (COLON, None),
            (IDENT, "y"),
            (COLON, None),
            (NUMBER, 2),
            (SEMICOLON, None),
            (IDENT, "x"),
            (STAR, None),
            (IDENT, "y"),
        ]

    def test_bind_dot_module_path(self) -> None:
        assert values('funcs : ."a.vkf"') == [
            (IDENT, "funcs"),
            (COLON, None),
            (DOT, (False, True)),
            (STRING, "a.vkf"),
        ]

    def test_pipe_with_dollar(self) -> None:
        assert values(":: 1..5 >> $^2") == [
            (EMIT, None),
            (NUMBER, 1),
            (RANGE, None),
            (NUMBER, 5),
            (PIPE, None),
            (DOLLAR, None),
            (CARET, None),
            (NUMBER, 2),
        ]

    def test_question_mark_lexes(self) -> None:
        """`?` is tokenized; there is no `?:` ternary in the grammar (see README)."""
        assert values("(n > 0 ? a : b)") == [
            (LPAREN, None),
            (IDENT, "n"),
            (GT, None),
            (NUMBER, 0),
            (QUESTION, None),
            (IDENT, "a"),
            (COLON, None),
            (IDENT, "b"),
            (RPAREN, None),
        ]

    def test_struct_field_assignment(self) -> None:
        assert values("p.x : 3") == [
            (IDENT, "p"),
            (DOT, (True, True)),
            (IDENT, "x"),
            (COLON, None),
            (NUMBER, 3),
        ]

    def test_lambda_application(self) -> None:
        assert values("($(x): x^2)(3)") == [
            (LPAREN, None),
            (DOLLAR, None),
            (LPAREN, None),
            (IDENT, "x"),
            (RPAREN, None),
            (COLON, None),
            (IDENT, "x"),
            (CARET, None),
            (NUMBER, 2),
            (RPAREN, None),
            (LPAREN, None),
            (NUMBER, 3),
            (RPAREN, None),
        ]

    def test_colon_eq_is_not_walrus(self) -> None:
        assert values("x :=") == [(IDENT, "x"), (COLON, None), (EQ, None)]

    def test_at_emit_single_token(self) -> None:
        from vektorflow.tokens import AT_COLON, AT_EMIT

        assert values("@\n") == [(AT, None)]
        assert values("@: x\n") == [(AT_COLON, None), (IDENT, "x")]
        assert values("@:: x\n") == [(AT_EMIT, None), (IDENT, "x")]

    def test_equality_relation(self) -> None:
        assert values("(3 = 2 + 1)") == [
            (LPAREN, None),
            (NUMBER, 3),
            (EQ, None),
            (NUMBER, 2),
            (PLUS, None),
            (NUMBER, 1),
            (RPAREN, None),
        ]

    def test_type_only_struct_definition(self) -> None:
        # Point:(x:num,y:num) — name, bind, type-only fields
        assert values("Point:(x:num,y:num)") == [
            (IDENT, "Point"),
            (COLON, None),
            (LPAREN, None),
            (IDENT, "x"),
            (COLON, None),
            (IDENT, "num"),
            (COMMA, None),
            (IDENT, "y"),
            (COLON, None),
            (IDENT, "num"),
            (RPAREN, None),
        ]

    def test_unary_operator_definition(self) -> None:
        # -(v1:Vec): … — unary minus overload
        assert values("-(v1:Vec):") == [
            (MINUS, None),
            (LPAREN, None),
            (IDENT, "v1"),
            (COLON, None),
            (IDENT, "Vec"),
            (RPAREN, None),
            (COLON, None),
        ]


# --- Indentation & newlines ----------------------------------------------

class TestIndentation:
    def test_simple_block(self) -> None:
        source = "f(x) :\n\tx + 1\n"
        k = kinds(source)
        # Expect: IDENT LPAREN IDENT RPAREN COLON NEWLINE INDENT IDENT PLUS NUMBER NEWLINE DEDENT
        assert INDENT in k
        assert DEDENT in k
        # INDENT should appear after the first NEWLINE.
        first_newline = k.index(NEWLINE)
        assert k[first_newline + 1] == INDENT

    def test_nested_blocks(self) -> None:
        source = "a :\n\tb :\n\t\tc\n"
        k = kinds(source)
        assert k.count(INDENT) == 2
        assert k.count(DEDENT) == 2

    def test_blank_lines_do_not_affect_indent(self) -> None:
        source = "f :\n\n\tx\n\n"
        k = kinds(source)
        assert k.count(INDENT) == 1
        assert k.count(DEDENT) == 1

    def test_comment_only_lines_do_not_affect_indent(self) -> None:
        source = "f :\n\t# a comment\n\tx\n"
        k = kinds(source)
        assert k.count(INDENT) == 1

    def test_spaces_indentation_block(self) -> None:
        source = "f :\n    x\n"
        k = kinds(source)
        assert INDENT in k
        assert DEDENT in k
        first_newline = k.index(NEWLINE)
        assert k[first_newline + 1] == INDENT

    def test_nested_blocks_with_spaces(self) -> None:
        source = "a :\n    b :\n        c\n"
        k = kinds(source)
        assert k.count(INDENT) == 2
        assert k.count(DEDENT) == 2

    def test_non_uniform_indent_increase_allowed(self) -> None:
        """Like Python: 0→4 then 4→10 is valid (different step sizes per level)."""
        source = "a :\n    b :\n          c\n"
        k = kinds(source)
        assert k.count(INDENT) == 2
        assert k.count(DEDENT) == 2

    def test_newlines_suppressed_inside_brackets(self) -> None:
        source = "[\n1,\n2,\n3\n]"
        # No NEWLINE / INDENT / DEDENT should appear between [ and ].
        toks = tokenize(source)
        inside = [
            t.kind
            for t in toks
            if t.kind not in (EOF,)
        ]
        assert NEWLINE not in inside[:inside.index(RBRACKET)]
        assert INDENT not in inside
        assert DEDENT not in inside


# --- Comments -------------------------------------------------------------

class TestComments:
    def test_line_comment_stripped(self) -> None:
        assert values("x # trailing\n") == [(IDENT, "x")]

    def test_comment_only_line(self) -> None:
        toks = tokenize("# just a comment\n")
        # Should produce no content tokens (only possibly NEWLINE-less EOF).
        assert [t.kind for t in toks if t.kind not in (NEWLINE, EOF)] == []

    def test_logical_ops_not_line_comment(self) -> None:
        assert values("a /\\ b\n") == [(IDENT, "a"), (AND, None), (IDENT, "b")]
        assert values("a \\/ b\n") == [(IDENT, "a"), (OR, None), (IDENT, "b")]


# --- Example files on disk -----------------------------------------------

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "examples"


class TestExampleFiles:
    @pytest.mark.parametrize(
        "rel_path",
        [
            "hello.vkf",
            "screen_demo.vkf",
            "funcs/a.vkf",
            "funcs/b.vkf",
            "piping.vkf",
            "operators.vkf",
            "nested/app.vkf",
            "nested/lib/helpers.vkf",
            "folder_repo/main.vkf",
            "folder_repo/pkg/mod.vkf",
        ],
    )
    def test_example_tokenizes_without_error(self, rel_path: str) -> None:
        path = EXAMPLES_DIR / rel_path
        source = path.read_text(encoding="utf-8")
        toks = tokenize(source, filename=str(path))
        assert toks[-1].kind == EOF
        assert len(toks) > 1


# --- Error cases ----------------------------------------------------------

class TestErrors:
    def test_unterminated_string(self) -> None:
        with pytest.raises(LexError):
            tokenize('"oops')

    def test_bang_alone_errors(self) -> None:
        with pytest.raises(LexError):
            tokenize("! ")

    def test_unmatched_closing_bracket(self) -> None:
        with pytest.raises(LexError):
            tokenize(")")

    def test_unknown_escape(self) -> None:
        with pytest.raises(LexError):
            tokenize(r'"\q"')
