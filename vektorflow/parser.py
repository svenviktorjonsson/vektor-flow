"""Parse token stream into AST (phase-1 subset)."""

from __future__ import annotations

import textwrap
from typing import Any

from . import ast
from .errors import ParseError, SourceLocation
from .tokens import (
    AMPERSAND,
    AND,
    ARROW,
    AT,
    AT_BANG,
    AT_BAR,
    AT_COLON,
    AT_EMIT,
    AT_GT,
    BAR,
    BANG,
    CARET,
    COLON,
    COMMA,
    DEDENT,
    DOLLAR,
    DOT,
    ELLIPSIS,
    EMIT,
    EOF,
    EQ,
    EXACT_EQ,
    FAT_ARROW,
    FALSE,
    FLOORDIV,
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
    NULL,
    NUMBER,
    OR,
    XOR,
    PERCENT,
    PIPE,
    PLUS,
    QUESTION,
    BANG_QUESTION,
    RANGE,
    RBRACE,
    RBRACKET,
    RPAREN,
    SEMICOLON,
    SLASH,
    STAR,
    STRUCT_NEQ,
    STRING,
    STRING_RAW,
    Token,
    TRUE,
)

# Statement-level operator definitions: `+(a, b): …`, `/\\(a, b): …`, `~(x): …`, etc.
OPERATOR_FUNC_KINDS = frozenset(
    {
        DOT,
        PLUS,
        MINUS,
        STAR,
        SLASH,
        FLOORDIV,
        PERCENT,
        CARET,
        AMPERSAND,
        EQ,
        STRUCT_NEQ,
        LT,
        LE,
        GT,
        GE,
        AND,
        OR,
        XOR,
        NOT,
    }
)


def _token_kind_to_op_symbol(kind: str) -> str:
    m = {
        DOT: ".",
        PLUS: "+",
        MINUS: "-",
        STAR: "*",
        SLASH: "/",
        FLOORDIV: "//",
        PERCENT: "%",
        CARET: "^",
        EQ: "=",
        STRUCT_NEQ: "~=",
        LT: "<",
        LE: "<=",
        GT: ">",
        GE: ">=",
        AND: "/\\",
        OR: "\\/",
        XOR: "><",
        NOT: "~",
        AMPERSAND: "&",
    }
    if kind not in m:
        raise ParseError(f"unsupported operator token for definition: {kind}")
    return m[kind]


# Operator tokens that can start a call: ``+(2, 3)``, ``/\\(1, 0)`` (not unary ``~`` — use ``~(x)``).
_ATOM_CALL_OP_KINDS = frozenset(OPERATOR_FUNC_KINDS - {NOT})
_UPDATE_BIND_OPS = {
    PLUS: PLUS,
    MINUS: MINUS,
    STAR: STAR,
    SLASH: SLASH,
    FLOORDIV: FLOORDIV,
    PERCENT: PERCENT,
    AND: AND,
    OR: OR,
    XOR: XOR,
}

BINOP_KIND_TO_SYM = {
    PLUS: "+",
    MINUS: "-",
    STAR: "*",
    SLASH: "/",
    FLOORDIV: "//",
    PERCENT: "%",
    CARET: "^",
    AMPERSAND: "&",
    EQ: "=",
    EXACT_EQ: "==",
    NEQ: "!=",
    STRUCT_NEQ: "~=",
    LT: "<",
    LE: "<=",
    GT: ">",
    GE: ">=",
    AND: "/\\",
    OR: "\\/",
    XOR: "><",
}

UNARY_KIND_TO_SYM = {
    PLUS: "+",
    MINUS: "-",
    NOT: "~",
}

# ``x : num`` / ``s : str`` / ``b : bool`` — these identifiers are type names, not calls. A newline
# before ``(`` must not become ``bool(…)`` and swallow the next line (see parse_postfix).
_PRIMITIVE_TYPE_IDENTS = frozenset({"int", "float", "num", "str", "byte", "bytes", "bool", "any"})

_TOKEN_DISPLAY = {
    INDENT: "indented block",
    DEDENT: "dedent",
    NEWLINE: "end of line",
    EOF: "end of input",
    IDENT: "identifier",
    NUMBER: "number",
    STRING: "string",
    STRING_RAW: "raw string",
    LPAREN: "`(`",
    RPAREN: "`)`",
    LBRACKET: "`[`",
    RBRACKET: "`]`",
    LBRACE: "`{`",
    RBRACE: "`}`",
    COLON: "`:`",
    COMMA: "`,`",
    SEMICOLON: "`;`",
    DOT: "`.`",
    ELLIPSIS: "`...`",
    QUESTION: "`?`",
    BANG: "`!`",
    BANG_QUESTION: "`!?`",
    EMIT: "`::`",
    FAT_ARROW: "`=>`",
    ARROW: "`->`",
}


def _describe_token_kind(kind: str) -> str:
    return _TOKEN_DISPLAY.get(kind, kind.lower())


class Parser:
    def __init__(self, tokens: list[Token], *, source: str | None = None, filename: str = "<stdin>") -> None:
        self.toks = tokens
        self.i = 0
        self._type_expr_relaxed_loose_dot_depth = 0
        self.source = source
        self.filename = filename
        self._line_offsets: list[int] | None = None
        if source is not None:
            self._line_offsets = [0]
            for idx, ch in enumerate(source):
                if ch == "\n":
                    self._line_offsets.append(idx + 1)

    def _peek(self) -> str:
        self._skip_trivia()
        if self.i >= len(self.toks):
            return EOF
        return self.toks[self.i].kind

    def _peek_raw(self) -> str:
        if self.i >= len(self.toks):
            return EOF
        return self.toks[self.i].kind

    def _skip_trivia(self) -> None:
        while self.i < len(self.toks) and self.toks[self.i].kind == NEWLINE:
            self.i += 1

    def _advance(self) -> Token:
        self._skip_trivia()
        if self.i >= len(self.toks):
            raise ParseError("unexpected end of input", self._loc_here())
        t = self.toks[self.i]
        self.i += 1
        return t

    def _loc_here(self) -> SourceLocation:
        if self.i >= len(self.toks):
            return self.toks[-1].location
        return self.toks[self.i].location

    def _expect(self, kind: str) -> Token:
        self._skip_trivia()
        if self._peek_raw() != kind:
            raise ParseError(
                f"expected {_describe_token_kind(kind)}, got {_describe_token_kind(self._peek_raw())}",
                self._loc_here(),
            )
        return self._advance()

    def _emit_disallowed_in_value_expr(self, ctx: str) -> None:
        """``::`` is a statement-level emit; it may not appear after a subexpression in a literal or arg list."""
        self._skip_trivia()
        if self._peek_raw() == EMIT:
            raise ParseError(
                f"emit (`::`) is not allowed inside {ctx}; use a separate statement or bind first",
                self._loc_here(),
            )

    def _consume_newline_raw(self) -> None:
        """Consume exactly one ``NEWLINE`` without ``_advance`` (which would skip past ``INDENT``)."""
        if self._peek_raw() != NEWLINE:
            raise ParseError(f"expected {NEWLINE}, got {self._peek_raw()}", self._loc_here())
        self.i += 1

    def _expect_end_of_simple_control_stmt(self) -> None:
        """After ``@`` / ``@>`` / ``@|`` / ``@!``: no expression; end the statement without eating the next line.

        Only one line break is consumed as statement end, so sibling lines are not lost.
        """
        k = self._peek_raw()
        if k == NEWLINE:
            self.i += 1
            return
        if k in (SEMICOLON, EOF, RPAREN, DEDENT):
            if k == SEMICOLON:
                self.i += 1
            return
        raise ParseError(
            "expected end of line, `;`, `)`, end of input, or dedent after `@` / `@>` / `@|` / `@!`",
            self._loc_here(),
        )

    def _expect_end_of_return_stmt(self) -> None:
        """After ``@`` expr: same terminators (allows ``(@ x)``-style endings)."""
        # Do not call ``_skip_trivia`` here: it consumes all newlines, so the next
        # statement on the following line (e.g. ``99``) would be read as invalid.
        k = self._peek_raw()
        if k in (NEWLINE, SEMICOLON, EOF, RPAREN):
            if k == SEMICOLON:
                self.i += 1
            elif k == NEWLINE:
                self.i += 1
            return
        raise ParseError(
            "expected end of line, `;`, `)`, or end of input after `@:` / `@::` return",
            self._loc_here(),
        )

    def _parse_switch_arm_body(self) -> Any:
        """One match arm: one line (one statement) or newline + indented block."""
        if self._peek_raw() == NEWLINE:
            self._consume_newline_raw()
            self._skip_trivia()
            if self._peek_raw() != INDENT:
                raise ParseError(
                    "expected indented block after a `?` arm head (or put the body on the same line)",
                    self._loc_here(),
                )
            self._expect(INDENT)
            body_stmts: list[Any] = []
            while True:
                self._skip_trivia()
                if self._peek_raw() in (DEDENT, EOF):
                    break
                body_stmts.extend(self.parse_stmt_semicolon_chain())
            self._expect(DEDENT)
            return self._func_body_from_stmts(body_stmts)
        st = self.parse_stmt()
        return self._func_body_from_stmts([st])

    def _parse_conditional_body(self) -> Any:
        """Parse body for ``expr? body`` (single-branch conditional)."""
        return self._parse_switch_arm_body()

    def _parse_one_switch_arm_fat_arrow(self) -> ast.MatchArm:
        """One ``??`` arm: ``case => body``."""
        self._skip_trivia()
        cond: Any | None
        if self._peek_raw() == IDENT and str(self.toks[self.i].value) == "_":
            raise ParseError(
                "`_ =>` is not supported",
                self._loc_here(),
            )
        cond = self._try_parse_match_arm_type_pattern()
        if cond is None:
            cond = self.parse_or_expr()
        self._skip_trivia()
        if self._peek_raw() != FAT_ARROW:
            raise ParseError("expected `=>` in `??` switch arm", self._loc_here())
        self._advance()
        body = self._parse_switch_arm_body()
        return ast.MatchArm(cond, body)

    def _line_has_fat_arrow(self) -> bool:
        """True if current arm line contains a top-level ``=>`` before newline/dedent/EOF."""
        j = self.i
        depth = 0
        while j < len(self.toks):
            k = self.toks[j].kind
            if k in (NEWLINE, DEDENT, EOF):
                return False
            if depth == 0 and k == SEMICOLON:
                return False
            if k in (LPAREN, LBRACKET, LBRACE):
                depth += 1
            elif k in (RPAREN, RBRACKET, RBRACE):
                if depth > 0:
                    depth -= 1
            elif depth == 0 and k == FAT_ARROW:
                return True
            j += 1
        return False

    def _parse_switch_arms_list_fat_arrow(self, end_tokens: set) -> list[ast.MatchArm]:
        arms: list[ast.MatchArm] = []
        while True:
            self._skip_trivia()
            while self._peek_raw() == SEMICOLON:
                self._advance()
            if self._peek_raw() in end_tokens or self._peek_raw() == EOF:
                break
            arms.append(self._parse_one_switch_arm_fat_arrow())
        if not arms:
            raise ParseError("expected at least one switch arm after `??`", self._loc_here())
        return arms

    def _parse_match_arms_after_double_question(self) -> list[ast.MatchArm]:
        """Parse ``??`` arms (inline or indented)."""
        self._skip_trivia()
        if self._peek_raw() == LPAREN:
            self._advance()
            self._skip_trivia()
            arms = self._parse_switch_arms_list_fat_arrow(
                end_tokens={SEMICOLON, RPAREN, NEWLINE, EOF, PIPE, COMMA}
            )
            self._expect(RPAREN)
            return arms
        if self._peek_raw() == INDENT:
            self._expect(INDENT)
            arms: list[ast.MatchArm] = []
            saw_default = False
            while True:
                self._skip_trivia()
                while self._peek_raw() == SEMICOLON:
                    self._advance()
                if self._peek_raw() in (DEDENT, EOF):
                    break
                if self._line_has_fat_arrow():
                    if saw_default:
                        raise ParseError(
                            "default arm must be last in `??` switch",
                            self._loc_here(),
                        )
                    arms.append(self._parse_one_switch_arm_fat_arrow())
                    continue
                # Default arm: plain body at arm scope (no `_ =>`, no bare `=>`).
                if saw_default:
                    raise ParseError(
                        "only one default arm is allowed in `??` switch",
                        self._loc_here(),
                    )
                saw_default = True
                body = self._parse_switch_arm_body()
                arms.append(ast.MatchArm(None, body))
            if not arms:
                raise ParseError("expected at least one switch arm after `??`", self._loc_here())
            self._expect(DEDENT)
            return arms
        return self._parse_switch_arms_list_fat_arrow(
            end_tokens={SEMICOLON, NEWLINE, EOF, RPAREN, PIPE, COMMA, DEDENT}
        )

    def _kind_after_balanced_call(self) -> str | None:
        """If at ``IDENT`` ``(``, return the kind after the matching ``)``, skipping newlines."""
        if self._peek_raw() != IDENT:
            return None
        if self.i + 1 >= len(self.toks) or self.toks[self.i + 1].kind != LPAREN:
            return None
        depth = 1
        j = self.i + 2
        while j < len(self.toks) and depth > 0:
            k = self.toks[j].kind
            if k == LPAREN:
                depth += 1
            elif k == RPAREN:
                depth -= 1
            j += 1
        if depth != 0:
            return None
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        if j < len(self.toks):
            return self.toks[j].kind
        return EOF

    def _paren_is_only_func_param_list(self, lparen_idx: int) -> bool:
        """True if ``(`` … ``)`` at ``lparen_idx`` is a valid function parameter list."""
        if lparen_idx >= len(self.toks) or self.toks[lparen_idx].kind != LPAREN:
            return False
        saved = self.i
        try:
            self.i = lparen_idx + 1
            self.parse_func_params()
            self._skip_trivia()
            return self._peek_raw() == RPAREN
        except ParseError:
            return False
        finally:
            self.i = saved

    def _kind_after_balanced_call_from_lparen(self, lparen_idx: int) -> str | None:
        """Kind after the ``)`` matching ``lparen_idx`` (``lparen_idx`` points at ``LPAREN``)."""
        if lparen_idx >= len(self.toks) or self.toks[lparen_idx].kind != LPAREN:
            return None
        depth = 1
        j = lparen_idx + 1
        while j < len(self.toks) and depth > 0:
            k = self.toks[j].kind
            if k == LPAREN:
                depth += 1
            elif k == RPAREN:
                depth -= 1
            j += 1
        if depth != 0:
            return None
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        if j < len(self.toks):
            return self.toks[j].kind
        return EOF

    def parse_module(self) -> ast.Module:
        stmts: list[Any] = []
        while True:
            self._skip_trivia()
            if self._peek_raw() == EOF:
                break
            if (
                self._peek_raw() == IDENT
                and self.i + 1 < len(self.toks)
                and self.toks[self.i + 1].kind == COLON
                and not (self.i + 2 < len(self.toks) and self.toks[self.i + 2].kind == DOT)
                and not (self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN)
            ):
                name = str(self._advance().value)
                self._advance()
                stmts.append(ast.Bind(ast.Ident(name), self._parse_bind_rhs(ast.Ident(name))))
                continue
            stmts.append(self.parse_stmt())
        return ast.Module(stmts)

    def parse_stmt(self) -> Any:
        self._skip_trivia()
        # Leading ``:: expr`` — print to stdout; ``:: :`` prints the current local scope (see StructIdentity).
        # ``::: expr`` — labeled print: ``expr_text: value`` with newline.
        if self._peek_raw() == EMIT:
            self._advance()
            if self._peek_raw() == COLON:
                self._advance()
                if self._peek_raw() in (NEWLINE, EOF, SEMICOLON):
                    return ast.StdioLabelPrint(":", ast.StructIdentity())
                val = self.parse_expr()
                return ast.StdioLabelPrint(self._format_expr_for_label(val), val)
            val = self.parse_expr()
            return ast.StdioPrint(val)

        # ``:.path`` — spill module exports into current scope
        if self._peek_raw() == COLON:
            if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == DOT:
                self._advance()
                path = self._parse_dot_module_path_from_dot()
                return ast.SpillImport(path)

        # Simple name bind fast path: `name: expr` / `name:` block / `name op: expr`
        if self._peek_raw() == IDENT:
            if not (
                self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN
            ):
                name = str(self.toks[self.i].value)
                if (
                    self.i + 1 < len(self.toks)
                    and self.toks[self.i + 1].kind == COLON
                    and not (
                        self.i + 2 < len(self.toks)
                        and self.toks[self.i + 2].kind == DOT
                    )
                ):
                    self._advance()
                    self._advance()
                    return ast.Bind(ast.Ident(name), self._parse_bind_rhs(ast.Ident(name)))
                mark = self.i
                target = ast.Ident(str(self._advance().value))
                update_op = self._peek_update_bind_op()
                if update_op is not None:
                    self._advance()
                    self._expect(COLON)
                    rhs = self._parse_bind_rhs(target)
                    return ast.Bind(target, ast.BinOp(update_op, target, rhs))
                self.i = mark

        typed_stdio_stmt = self._try_parse_prefix_typed_stdio_stmt()
        if typed_stdio_stmt is not None:
            return typed_stdio_stmt

        # ``:expr`` spills a value/module into local scope; lone ``:`` returns current local scope.
        if self._peek_raw() == COLON:
            self._advance()
            if self._peek_raw() in (NEWLINE, EOF, SEMICOLON):
                return ast.ExprStmt(ast.StructIdentity())
            return ast.SpillValue(self.parse_expr())

        if self._peek_raw() == AT:
            self._advance()
            self._expect_end_of_simple_control_stmt()
            return ast.ReturnStmt(None)

        if self._peek_raw() == AT_GT:
            self._advance()
            self._expect_end_of_simple_control_stmt()
            return ast.ContinueStmt()

        if self._peek_raw() == AT_BAR:
            self._advance()
            self._expect_end_of_simple_control_stmt()
            return ast.BreakStmt()

        if self._peek_raw() == AT_BANG:
            self._advance()
            self._expect_end_of_simple_control_stmt()
            return ast.ExitProgramStmt()

        # ``@:: expr`` — print then return (single lexer token; not ``@`` + ``::``).
        if self._peek_raw() == AT_EMIT:
            self._advance()
            if self._peek_raw() in (NEWLINE, SEMICOLON, EOF, RPAREN):
                raise ParseError(
                    "expected expression after `@::` (return and emit)",
                    self._loc_here(),
                )
            val = self.parse_expr()
            self._expect_end_of_return_stmt()
            return ast.ReturnEmitStmt(val)

        # ``@:`` return — ``@:|a|`` is unambiguous (return `|a|`).
        if self._peek_raw() == AT_COLON:
            self._advance()
            if self._peek_raw() in (NEWLINE, SEMICOLON, EOF, RPAREN):
                if self._peek_raw() == SEMICOLON:
                    self.i += 1
                return ast.ReturnStmt(ast.StructIdentity())
            val = self.parse_expr()
            self._expect_end_of_return_stmt()
            return ast.ReturnStmt(val)

        # Operator function: `+(a, b):` / `<(a, b):` — before `IDENT (` normal func
        if self._peek_raw() in OPERATOR_FUNC_KINDS:
            if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                k_after = self._kind_after_balanced_call_from_lparen(self.i + 1)
                if k_after == COLON:
                    return self.parse_operator_func_def()

        # ``f(x):::`` / ``f(x) ::`` — body from stdin (print is only ``:: expr``, not trailing)
        if self._peek_raw() == IDENT:
            if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                lpar = self.i + 1
                if self._paren_is_only_func_param_list(lpar):
                    k_after = self._kind_after_balanced_call()
                    if k_after == EMIT:
                        return self.parse_func_def_acquire()

        # Function: IDENT ( ... ) :  or  IDENT ( ... ) -> codomain :
        if self._peek_raw() == IDENT:
            if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                k_after = self._kind_after_balanced_call()
                if k_after in (COLON, ARROW):
                    return self.parse_func_def()

        # ``alias:.path`` — import module bound to alias, no spill (e.g. ``time:.time``)
        if self._peek_raw() == IDENT:
            if (
                self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == COLON
                and self.i + 2 < len(self.toks) and self.toks[self.i + 2].kind == DOT
            ):
                alias = str(self._advance().value)  # consume IDENT
                self._advance()                      # consume COLON
                path = self._parse_dot_module_path_from_dot()
                return ast.SpillImport(path, alias=alias)

        # Bind: lvalue `:` expr (single colon, not ::); lvalue is postfix (``a``, ``a.b``, ``a.(1)``, …)
        if self._peek_raw() == IDENT:
            if not (
                self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN
            ):
                mark = self.i
                target = self.parse_postfix()
                self._skip_trivia()
                update_op = self._peek_update_bind_op()
                if update_op is not None:
                    self._advance()
                    self._expect(COLON)
                    rhs = self._parse_bind_rhs(target)
                    return ast.Bind(target, ast.BinOp(update_op, target, rhs))
                if self._peek_raw() == COLON and (
                    self.i + 1 >= len(self.toks) or self.toks[self.i + 1].kind != COLON
                ):
                    self._advance()
                    val = self._parse_bind_rhs(target)
                    return ast.Bind(target, val)
                self.i = mark

        typed_bind = self._try_parse_prefix_typed_bind_stmt()
        if typed_bind is not None:
            return typed_bind

        expr = self.parse_expr()
        # After a multiline ``expr?`` / ``…?`` block, ``DEDENT`` can be immediately followed
        # by ``::`` (no ``NEWLINE`` token between). The next statement must be a leading
        # ``:: expr`` print, not a mis-parse of trailing ``t ::`` (stdio) on the match.
        if isinstance(expr, (ast.MatchStmt, ast.ConditionalExpr)) and self._peek_raw() == EMIT:
            return expr
        # Do not ``_skip_trivia`` here: it consumes newlines, so ``f(10, 20)`` on one
        # line would incorrectly absorb leading ``::`` on the next line as trailing ``::``.
        # Trailing ``name ::`` / ``name :::`` — stdin read; ``:::`` prints ``name: `` before the caret.
        if self._peek_raw() == EMIT:
            self._advance()
            if self._peek_raw() == COLON:
                self._advance()
                if self._peek_raw() not in (NEWLINE, EOF):
                    raise ParseError(
                        "trailing `:::` only reads stdin after `name: ` prompt; nothing may follow on the line",
                        self._loc_here(),
                    )
                if isinstance(expr, ast.Ident):
                    return ast.StdioPrompt(expr)
                raise ParseError(
                    "`:::` line input expects a simple name before `:::`",
                    self._loc_here(),
                )
            if isinstance(expr, ast.Ident):
                if self._peek_raw() in (NEWLINE, EOF):
                    return ast.StdioReadLine(expr)
                source = self.parse_expr()
                return ast.EvalBind(expr, source)
            if self._peek_raw() not in (NEWLINE, EOF):
                raise ParseError(
                    "trailing :: source bind expects a simple name before :: expr",
                    self._loc_here(),
                )
            raise ParseError(
                "trailing :: only reads a line into a simple name; use leading :: to print ( :: expr )",
                self._loc_here(),
            )
        self._skip_trivia()
        if isinstance(expr, ast.MatchStmt):
            return expr
        return ast.ExprStmt(expr)

    def _try_parse_prefix_typed_bind_stmt(self) -> Any | None:
        self._skip_trivia()
        if self._peek_raw() not in (IDENT, LPAREN, LBRACKET, LBRACE):
            return None
        saved = self.i
        try:
            declared_type = self._parse_arrow_type()
            self._skip_trivia()
            if self._peek_raw() != IDENT:
                self.i = saved
                return None
            name = str(self._advance().value)
            self._skip_trivia()
            if self._peek_raw() != COLON:
                self.i = saved
                return None
            self._advance()
            value = self.parse_expr()
            return ast.Bind(ast.Ident(name), value, declared_type=declared_type)
        except ParseError:
            self.i = saved
            return None

    def _parse_dot_module_path_from_dot(self) -> ast.DotModulePath:
        self._expect(DOT)
        segments: list[str] = []
        while True:
            if self._peek_raw() in (STRING, STRING_RAW):
                segments.append(str(self._advance().value))
            elif self._peek_raw() == IDENT:
                segments.append(str(self._advance().value))
            else:
                raise ParseError(
                    "expected identifier or string segment in .module path",
                    self._loc_here(),
                )
            self._skip_trivia()
            if self._peek_raw() == DOT:
                self._advance()
                continue
            break
        return ast.DotModulePath(segments)

    def parse_func_def_acquire(self) -> Any:
        name = str(self._expect(IDENT).value)
        self._expect(LPAREN)
        params = self.parse_func_params()
        self._expect(RPAREN)
        if self._peek_raw() != EMIT:
            raise ParseError("expected :: or ::: after function head", self._loc_here())
        self._advance()
        if self._peek_raw() == COLON:
            self._advance()
            return ast.FuncDefStdin(name, params, True)
        if self._peek_raw() in (NEWLINE, EOF):
            return ast.FuncDefStdin(name, params, False)
        source = self.parse_expr()
        return ast.FuncDefSource(name, params, source)

    def parse_operator_func_def(self) -> ast.FuncDef:
        t = self._advance()
        if t.kind not in OPERATOR_FUNC_KINDS:
            raise ParseError(
                f"expected operator token, got {t.kind}", self._loc_here()
            )
        name = _token_kind_to_op_symbol(t.kind)
        self._expect(LPAREN)
        params = self.parse_func_params(allow_defaults=False)
        self._expect(RPAREN)
        self._expect(COLON)
        if self._peek_raw() == NEWLINE:
            self._consume_newline_raw()
            if self._peek_raw() != INDENT:
                raise ParseError(
                    "operator function must have a body (indent a block after the colon)",
                    self._loc_here(),
                )
            self._expect(INDENT)
            body_stmts: list[Any] = []
            while True:
                self._skip_trivia()
                if self._peek_raw() in (DEDENT, EOF):
                    break
                body_stmts.extend(self.parse_stmt_semicolon_chain())
            self._expect(DEDENT)
            return ast.FuncDef(name, params, self._func_body_from_stmts(body_stmts))
        stmts = self.parse_stmt_semicolon_chain()
        return ast.FuncDef(name, params, self._func_body_from_stmts(stmts))

    def parse_stmt_semicolon_chain(self) -> list[Any]:
        """One or more statements separated by ``;`` (same logical indentation line)."""
        out: list[Any] = []
        while True:
            out.append(self.parse_stmt())
            self._skip_trivia()
            if self._peek_raw() == SEMICOLON:
                self._advance()
                self._skip_trivia()
                continue
            break
        return out

    def _func_body_from_stmts(self, stmts: list[Any]) -> Any:
        """Single trailing expression keeps legacy shape; multiple stmts use :class:`Block`."""
        if not stmts:
            return ast.Block([])
        if len(stmts) == 1 and isinstance(stmts[0], ast.ExprStmt):
            return stmts[0].expr
        return ast.Block(stmts)

    def _extract_leading_docstring(self, stmts: list[Any]) -> tuple[str | None, list[Any]]:
        if not stmts:
            return None, stmts
        first = stmts[0]
        if isinstance(first, ast.ExprStmt) and isinstance(first.expr, ast.StringLit):
            return first.expr.value, stmts[1:]
        return None, stmts

    def parse_func_params(self, *, allow_defaults: bool = True) -> list[ast.Param]:
        params: list[ast.Param] = []
        seen_var_pos = False
        seen_var_named = False
        if self._peek_raw() == RPAREN:
            return params
        while True:
            param = self._parse_func_param(allow_defaults=allow_defaults)
            if param.variadic_named:
                if seen_var_named:
                    raise ParseError("only one `:::named` parameter is allowed", self._loc_here())
                seen_var_named = True
            elif param.variadic_positional:
                if seen_var_pos:
                    raise ParseError("only one `...rest` parameter is allowed", self._loc_here())
                if seen_var_named:
                    raise ParseError("`...rest` may not appear after `:::named`", self._loc_here())
                seen_var_pos = True
            elif seen_var_pos or seen_var_named:
                raise ParseError("fixed parameters must come before variadic captures", self._loc_here())
            params.append(param)
            if self._peek_raw() == COMMA:
                self._advance()
                continue
            break
        return params

    def _param_from_type_expr(
        self,
        pname: str,
        t: Any | None,
        default_expr: Any | None = None,
        *,
        variadic_positional: bool = False,
        variadic_named: bool = False,
    ) -> ast.Param:
        if isinstance(t, ast.FuncType):
            return ast.Param(pname, None, t, None, default_expr, variadic_positional, variadic_named)
        if isinstance(t, ast.PrimTypeRef):
            return ast.Param(pname, t.name, None, t, default_expr, variadic_positional, variadic_named)
        if t is None:
            return ast.Param(pname, None, None, None, default_expr, variadic_positional, variadic_named)
        return ast.Param(pname, None, None, t, default_expr, variadic_positional, variadic_named)

    def _try_parse_name_first_typed_param(self, pname: str) -> ast.Param | None:
        saved = self.i
        try:
            t = self._parse_arrow_type()
        except ParseError:
            self.i = saved
            return None

    def _try_parse_prefix_typed_stdio_stmt(self) -> Any | None:
        self._skip_trivia()
        if self._peek_raw() not in (IDENT, LPAREN, LBRACKET, LBRACE):
            return None
        saved = self.i
        try:
            declared_type = self._parse_arrow_type()
            self._skip_trivia()
            if self._peek_raw() != IDENT:
                self.i = saved
                return None
            name = str(self._advance().value)
            self._skip_trivia()
            if self._peek_raw() != EMIT:
                self.i = saved
                return None
            self._advance()
            target = ast.Ident(name)
            if self._peek_raw() == COLON:
                self._advance()
                if self._peek_raw() not in (NEWLINE, EOF):
                    raise ParseError(
                        "typed `:::` prompt input may not have trailing tokens on the line",
                        self._loc_here(),
                    )
                return ast.StdioPrompt(target, declared_type=declared_type)
            if self._peek_raw() in (NEWLINE, EOF):
                return ast.StdioReadLine(target, declared_type=declared_type)
            source = self.parse_expr()
            return ast.EvalBind(target, source, declared_type=declared_type)
        except ParseError:
            self.i = saved
            return None
        if self._peek_raw() not in (COMMA, RPAREN):
            self.i = saved
            return None
        return self._param_from_type_expr(pname, t)

    def _parse_func_param(self, *, allow_defaults: bool = True) -> ast.Param:
        if self._peek_raw() == ELLIPSIS:
            self._advance()
            pname = str(self._expect(IDENT).value)
            declared_type: Any | None = None
            if self._peek_raw() == COLON:
                self._advance()
                declared_type = self._parse_arrow_type()
            return self._param_from_type_expr(
                pname,
                declared_type,
                variadic_positional=True,
            )
        if self._peek_raw() == EMIT:
            saved = self.i
            self._advance()
            if self._peek_raw() != COLON:
                self.i = saved
            else:
                self._advance()
                pname = str(self._expect(IDENT).value)
                declared_type: Any | None = None
                if self._peek_raw() == COLON:
                    self._advance()
                    declared_type = self._parse_arrow_type()
                return self._param_from_type_expr(
                    pname,
                    declared_type,
                    variadic_named=True,
                )

        saved = self.i
        try:
            t = self._parse_arrow_type()
            self._skip_trivia()
            if self._peek_raw() != IDENT:
                raise ParseError("expected parameter name after parameter type", self._loc_here())
            pname = str(self._advance().value)
            default_expr: Any | None = None
            if allow_defaults and self._peek_raw() == EQ:
                self._advance()
                default_expr = self.parse_expr()
            return self._param_from_type_expr(pname, t, default_expr)
        except ParseError as exc:
            self.i = saved

        pname = str(self._expect(IDENT).value)
        declared_type: Any | None = None
        if self._peek_raw() == COLON:
            self._advance()
            declared_type = self._parse_arrow_type()
        default_expr: Any | None = None
        if allow_defaults and self._peek_raw() == EQ:
            self._advance()
            default_expr = self.parse_expr()
        return self._param_from_type_expr(pname, declared_type, default_expr)

    def _parse_type_size_atom(self) -> Any:
        self._skip_trivia()
        if self._peek_raw() == NUMBER:
            n = float(self._advance().value)
            if n != int(n):
                raise ParseError("type size constants must be integers", self._loc_here())
            return ast.TypeSizeConst(int(n))
        if self._peek_raw() == TRUE:
            self._advance()
            return ast.TypeSizeConst(1)
        if self._peek_raw() == FALSE:
            self._advance()
            return ast.TypeSizeConst(0)
        if self._peek_raw() == IDENT:
            name = str(self._advance().value)
            if name in _PRIMITIVE_TYPE_IDENTS:
                raise ParseError(
                    "type size expressions may only use integer-like compile-time values or symbols, not type names",
                    self._loc_here(),
                )
            return ast.TypeSizeVar(name)
        if self._peek_raw() == LPAREN:
            self._advance()
            inner = self._parse_type_size_expr()
            self._expect(RPAREN)
            return inner
        raise ParseError("expected type size expression", self._loc_here())

    def _parse_type_size_expr(self) -> Any:
        left = self._parse_type_size_atom()
        while True:
            self._skip_trivia()
            if self._peek_raw() == PLUS:
                self._advance()
                left = ast.TypeSizeBinOp("+", left, self._parse_type_size_atom())
                continue
            if self._peek_raw() == MINUS:
                self._advance()
                left = ast.TypeSizeBinOp("-", left, self._parse_type_size_atom())
                continue
            break
        return left

    def _paren_starts_type_record(self) -> bool:
        self._skip_trivia()
        if self._peek_raw() != LPAREN:
            return False
        j = self.i + 1
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        if j >= len(self.toks):
            return False
        if self.toks[j].kind == RPAREN:
            return False
        if self.toks[j].kind != IDENT:
            return False
        j += 1
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        return j < len(self.toks) and self.toks[j].kind == COLON

    def _parse_fixed_vector_type_after_lbracket(self) -> ast.FixedVectorType:
        """Parse ``elem : size ]`` after leading ``[`` (fixed-vector type)."""
        elem = self._parse_type_union()
        self._expect(COLON)
        size = self._parse_type_size_expr()
        self._expect(RBRACKET)
        return ast.FixedVectorType(elem, size)

    def _parse_fixed_vector_type(self) -> ast.FixedVectorType:
        self._expect(LBRACKET)
        return self._parse_fixed_vector_type_after_lbracket()

    def _try_parse_match_arm_fixed_vector_type_pattern(self) -> ast.FixedVectorType | None:
        """In ``??`` arms only: ``[T:n]`` -> type pattern, not vector literal / repeat."""
        self._skip_trivia()
        if self._peek_raw() != LBRACKET:
            return None
        saved = self.i
        self._advance()
        try:
            return self._parse_fixed_vector_type_after_lbracket()
        except ParseError:
            self.i = saved
            return None

    def _parse_multiset_type(self) -> ast.MultisetType:
        self._expect(LBRACE)
        elem = self._parse_type_union()
        self._expect(RBRACE)
        return ast.MultisetType(elem)

    def _parse_map_value_type(self) -> ast.MapValueType:
        name = str(self._expect(IDENT).value)
        if name != "map":
            raise ParseError("expected map type", self._loc_here())
        self._expect(LPAREN)
        fields: list[tuple[str, Any]] = []
        if self._peek_raw() != RPAREN:
            while True:
                field_name = str(self._expect(IDENT).value)
                self._expect(COLON)
                fields.append((field_name, self._parse_arrow_type()))
                if self._peek_raw() == COMMA:
                    self._advance()
                    continue
                break
        self._expect(RPAREN)
        return ast.MapValueType(fields)

    def _parse_linked_list_value_type(self) -> ast.LinkedListValueType:
        name = str(self._expect(IDENT).value)
        if name != "list":
            raise ParseError("expected list type", self._loc_here())
        self._expect(LPAREN)
        elements: list[Any] = []
        if self._peek_raw() != RPAREN:
            while True:
                elements.append(self._parse_arrow_type())
                if self._peek_raw() == COMMA:
                    self._advance()
                    continue
                break
        self._expect(RPAREN)
        return ast.LinkedListValueType(elements)

    def _tuple_type_has_comma_before_matching_rparen(self) -> bool:
        """True when ``( … )`` is a tuple type (comma-separated); false for a singleton ``(T)``."""
        if self._peek_raw() != LPAREN:
            return False
        depth = 1
        j = self.i + 1
        while j < len(self.toks):
            k = self.toks[j].kind
            if k in (LPAREN, LBRACKET, LBRACE):
                depth += 1
            elif k in (RPAREN, RBRACKET, RBRACE):
                depth -= 1
                if depth == 0:
                    return False
            elif k == COMMA and depth == 1:
                return True
            j += 1
        return False

    def _parse_type_atom(self) -> Any:
        self._skip_trivia()
        saved = self.i
        self._type_expr_relaxed_loose_dot_depth += 1
        try:
            expr = self.parse_postfix()
            if isinstance(expr, ast.TypeOf):
                return expr
        except ParseError:
            pass
        finally:
            self._type_expr_relaxed_loose_dot_depth -= 1
        self.i = saved
        if self._peek_raw() == LPAREN:
            named_domain = self._try_parse_named_func_domain_type()
            if named_domain is not None:
                return named_domain
            if self._paren_starts_type_record():
                return self._parse_type_record()
            if not self._tuple_type_has_comma_before_matching_rparen():
                self._expect(LPAREN)
                if self._peek_raw() == RPAREN:
                    self._advance()
                    inner: Any = ast.TypeExpr([])
                else:
                    inner = self._parse_arrow_type()
                    self._expect(RPAREN)
                return inner
            return self._parse_tuple_type()
        if self._peek_raw() == LBRACKET:
            return self._parse_fixed_vector_type()
        if self._peek_raw() == LBRACE:
            return self._parse_multiset_type()
        if self._peek_raw() == IDENT:
            if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                ident = str(self.toks[self.i].value)
                if ident == "map":
                    return self._parse_map_value_type()
                if ident == "list":
                    return self._parse_linked_list_value_type()
            ident = str(self.toks[self.i].value)
            if ident in _PRIMITIVE_TYPE_IDENTS or self._name_is_type_bind(ident):
                return ast.PrimTypeRef(str(self._advance().value))
        raise ParseError("expected type atom", self._loc_here())

    def _try_parse_named_func_domain_type(self) -> Any | None:
        if self._peek_raw() != LPAREN:
            return None
        saved = self.i
        try:
            self._expect(LPAREN)
            params = self.parse_func_params(allow_defaults=False)
            self._expect(RPAREN)
            self._skip_trivia()
            if self._peek_raw() != ARROW:
                self.i = saved
                return None
            if not any(
                p.param_func_type is not None or p.type_ref is not None or p.type_name is not None
                for p in params
            ):
                self.i = saved
                return None
            return self._params_to_domain_type(params)
        except ParseError:
            self.i = saved
            return None

    def _try_parse_match_arm_type_pattern(self) -> Any | None:
        """In ``??`` arms: allow full type patterns like ``int|str`` and ``num&int``.

        We only commit to the parse if a top-level ``=>`` follows immediately after the
        type expression, so ordinary value arms still parse through expression syntax.
        """
        fixed = self._try_parse_match_arm_fixed_vector_type_pattern()
        if fixed is not None:
            return fixed
        saved = self.i
        try:
            pattern = self._parse_arrow_type()
            self._skip_trivia()
            if self._peek_raw() != FAT_ARROW:
                self.i = saved
                return None
            return pattern
        except ParseError:
            self.i = saved
            return None

    def _flatten_type_members(self, node_type: type, left: Any, right: Any) -> list[Any]:
        out: list[Any] = []
        if isinstance(left, node_type):
            out.extend(left.members)
        else:
            out.append(left)
        if isinstance(right, node_type):
            out.extend(right.members)
        else:
            out.append(right)
        return out

    def _parse_type_intersection(self) -> Any:
        left = self._parse_type_atom()
        while True:
            self._skip_trivia()
            if self._peek_raw() != AMPERSAND:
                break
            self._advance()
            right = self._parse_type_atom()
            left = ast.TypeIntersectionExpr(
                self._flatten_type_members(ast.TypeIntersectionExpr, left, right)
            )
        return left

    def _parse_type_union(self) -> Any:
        left = self._parse_type_intersection()
        while True:
            self._skip_trivia()
            if self._peek_raw() != BAR:
                break
            self._advance()
            right = self._parse_type_intersection()
            left = ast.TypeUnionExpr(
                self._flatten_type_members(ast.TypeUnionExpr, left, right)
            )
        return left

    def _parse_arrow_type(self) -> Any:
        """Parse type expressions with right-associative ``->``."""
        left = self._parse_type_union()
        if self._peek_raw() != ARROW:
            return left
        self._require_spaced_arrow_after_rparen_for_types()
        self._advance()
        rhs = self._parse_arrow_type()
        return ast.FuncType(left, rhs)

    def _normalize_codomain_for_func_type(self, cod: Any) -> Any:
        if isinstance(
            cod,
                (
                    ast.PrimTypeRef,
                    ast.FuncType,
                    ast.TupleTypeExpr,
                    ast.TypeExpr,
                    ast.TypeUnionExpr,
                    ast.TypeIntersectionExpr,
                    ast.FixedVectorType,
                    ast.MultisetType,
                    ast.MapValueType,
                    ast.LinkedListValueType,
                    ast.NamedTypeSpec,
                ),
            ):
            return cod
        raise ParseError("internal: invalid function codomain", self._loc_here())

    def _parse_return_type_spec(self) -> Any:
        self._skip_trivia()
        if self._peek_raw() == IDENT:
            saved = self.i
            try:
                name = str(self._advance().value)
                self._expect(COLON)
                named = ast.NamedTypeSpec(name, self._parse_arrow_type())
                self._skip_trivia()
                if self._peek_raw() == COLON:
                    return named
            except ParseError:
                pass
            self.i = saved
        return self._parse_arrow_type()

    def parse_func_def(self) -> ast.FuncDef:
        name = str(self._expect(IDENT).value)
        self._expect(LPAREN)
        params = self.parse_func_params()
        self._expect(RPAREN)
        func_type: ast.FuncType | None = None
        if self._peek_raw() == ARROW:
            self._require_spaced_arrow_after_rparen_for_types()
            self._advance()
            cod = self._parse_return_type_spec()
            domain = self._params_to_domain_type(params)
            func_type = ast.FuncType(domain, self._normalize_codomain_for_func_type(cod))
        self._expect(COLON)
        if self._peek_raw() == NEWLINE:
            self._consume_newline_raw()
            # No INDENT: empty body — struct constructor (``class``) with no statements.
            if self._peek_raw() != INDENT:
                return ast.FuncDef(name, params, ast.Block([]), func_type)
            self._expect(INDENT)
            body_stmts: list[Any] = []
            while True:
                self._skip_trivia()
                if self._peek_raw() in (DEDENT, EOF):
                    break
                body_stmts.extend(self.parse_stmt_semicolon_chain())
            self._expect(DEDENT)
            docstring, body_stmts = self._extract_leading_docstring(body_stmts)
            return ast.FuncDef(
                name,
                params,
                self._func_body_from_stmts(body_stmts),
                func_type,
                docstring,
            )
        stmts = self.parse_stmt_semicolon_chain()
        docstring, stmts = self._extract_leading_docstring(stmts)
        return ast.FuncDef(
            name,
            params,
            self._func_body_from_stmts(stmts),
            func_type,
            docstring,
        )

    def _name_is_type_bind(self, name: str) -> bool:
        return len(name) > 0 and name[0].isalpha() and name[0].isupper()

    def _is_type_record_shape(self) -> bool:
        return self._paren_starts_type_record()

    def _parse_type_record(self) -> ast.TypeExpr:
        self._expect(LPAREN)
        return self._parse_type_record_after_lparen()

    def _parse_type_record_after_lparen(self) -> ast.TypeExpr:
        fields: list[tuple[str, Any]] = []
        if self._peek_raw() == RPAREN:
            self._advance()
            return ast.TypeExpr([])
        while True:
            fname = str(self._expect(IDENT).value)
            self._expect(COLON)
            fields.append((fname, self._parse_arrow_type()))
            if self._peek_raw() == COMMA:
                self._advance()
                continue
            self._expect(RPAREN)
            return ast.TypeExpr(fields)

    def _is_type_record_contents_after_lparen(self) -> bool:
        self._skip_trivia()
        if self._peek_raw() == RPAREN:
            return False
        if self._peek_raw() != IDENT:
            return False
        j = self.i + 1
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        if j >= len(self.toks) or self.toks[j].kind != COLON:
            return False
        j += 1
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        if j >= len(self.toks):
            return False
        return self.toks[j].kind in (IDENT, LPAREN, LBRACKET)

    def _parse_tuple_type(self) -> ast.TupleTypeExpr:
        self._expect(LPAREN)
        els: list[Any] = []
        if self._peek_raw() == RPAREN:
            self._advance()
            return ast.TupleTypeExpr([])
        while True:
            els.append(self._parse_arrow_type())
            if self._peek_raw() == COMMA:
                self._advance()
                if self._peek_raw() == RPAREN:
                    self._advance()
                    return ast.TupleTypeExpr(els)
                continue
            self._expect(RPAREN)
            return ast.TupleTypeExpr(els)

    def _parse_type_domain(self) -> Any:
        return self._parse_type_union()

    def _parse_type_definition(self) -> ast.TypeExpr | ast.FuncType:
        """Parse a type RHS after ``Name :`` when ``Name`` is a type binding (capitalized)."""
        domain = self._parse_type_domain()
        if isinstance(domain, ast.TupleTypeExpr) and not domain.elements:
            domain = ast.TypeExpr([])
        if self._peek_raw() == ARROW:
            self._require_spaced_arrow_after_rparen_for_types()
            self._advance()
            codomain = self._parse_return_type_spec()
            return ast.FuncType(domain, codomain)
        if isinstance(domain, (ast.TypeExpr, ast.PrimTypeRef, ast.TypeUnionExpr, ast.TypeIntersectionExpr, ast.FixedVectorType, ast.MultisetType, ast.MapValueType, ast.LinkedListValueType, ast.TypeOf)):
            return domain
        raise ParseError(
            "tuple or bare type name requires '->' codomain (e.g. num -> num, (num,num) -> num)",
            self._loc_here(),
        )

    def _stmt_boundary_index(self, start: int) -> int:
        """Return the first top-level statement terminator from ``start`` onward."""
        depth = 0
        j = start
        while j < len(self.toks):
            kind = self.toks[j].kind
            if depth == 0 and kind in (NEWLINE, SEMICOLON, DEDENT, EOF):
                return j
            if kind in (LPAREN, LBRACKET, LBRACE):
                depth += 1
            elif kind in (RPAREN, RBRACKET, RBRACE) and depth > 0:
                depth -= 1
            j += 1
        return j

    def _parse_type_definition_until_stmt_end(self) -> ast.TypeExpr | ast.FuncType:
        """Parse a type RHS without consuming across the enclosing statement boundary."""
        boundary = self._stmt_boundary_index(self.i)
        eof_loc = self.toks[boundary].location if boundary < len(self.toks) else self._loc_here()
        eof_tok = Token(EOF, None, eof_loc)
        sub = Parser(self.toks[self.i:boundary] + [eof_tok])
        out = sub._parse_type_definition()
        sub._skip_trivia()
        if sub._peek_raw() != EOF:
            raise ParseError("unexpected trailing tokens in type definition", sub._loc_here())
        self.i = boundary
        return out

    def _parse_indented_stmt_block(self, *, missing_message: str) -> ast.Block:
        self._consume_newline_raw()
        if self._peek_raw() != INDENT:
            raise ParseError(missing_message, self._loc_here())
        self._expect(INDENT)
        body_stmts: list[Any] = []
        while True:
            self._skip_trivia()
            if self._peek_raw() in (DEDENT, EOF):
                break
            body_stmts.extend(self.parse_stmt_semicolon_chain())
        self._expect(DEDENT)
        return ast.Block(body_stmts)

    def _parse_parenthesized_scope_block(self) -> ast.ScopeExpr:
        if self.source is not None and self.i > 0:
            open_paren = self.toks[self.i - 1]
            close_index = self._find_matching_group_end(self.i, LPAREN, RPAREN)
            close_paren = self.toks[close_index]
            inner_source = self._slice_source_between(open_paren.location, close_paren.location)
            dedented = textwrap.dedent(inner_source).strip("\n")
            if dedented:
                inner_module = parse_module(dedented, filename=self.filename)
                self.i = close_index + 1
                return ast.ScopeExpr(ast.Block(inner_module.statements))
            self.i = close_index + 1
            return ast.ScopeExpr(ast.Block([]))
        body_stmts: list[Any] = []
        while True:
            self._skip_trivia()
            if self._peek_raw() in (RPAREN, EOF):
                break
            body_stmts.extend(self.parse_stmt_semicolon_chain())
        self._expect(RPAREN)
        return ast.ScopeExpr(ast.Block(body_stmts))

    def _next_token_starts_new_line_after(self, line: int) -> bool:
        self._skip_trivia()
        if self.i >= len(self.toks):
            return False
        return self.toks[self.i].location.line > line

    def _find_matching_group_end(self, start_index: int, open_kind: str, close_kind: str) -> int:
        depth = 0
        for j in range(start_index, len(self.toks)):
            kind = self.toks[j].kind
            if kind == open_kind:
                depth += 1
                continue
            if kind == close_kind:
                if depth == 0:
                    return j
                depth -= 1
        raise ParseError(f"expected {_describe_token_kind(close_kind)}", self._loc_here())

    def _slice_source_between(self, start: SourceLocation, end: SourceLocation) -> str:
        if self.source is None or self._line_offsets is None:
            raise ParseError("internal error: source text unavailable for scope block parsing", start)
        start_offset = self._line_offsets[start.line - 1] + start.column
        end_offset = self._line_offsets[end.line - 1] + (end.column - 1)
        return self.source[start_offset:end_offset]

    def _paren_contains_top_level_comma(self) -> bool:
        depth = 0
        j = self.i
        while j < len(self.toks):
            kind = self.toks[j].kind
            if kind == LPAREN:
                depth += 1
            elif kind == RPAREN:
                if depth == 0:
                    return False
                depth -= 1
            elif kind == COMMA and depth == 0:
                return True
            j += 1
        return False

    def _parse_bind_rhs(self, target: Any) -> Any:
        if self._peek_raw() == NEWLINE:
            if not isinstance(target, ast.Ident):
                raise ParseError(
                    "only simple named definitions may use an indented scope body",
                    self._loc_here(),
                )
            return ast.ScopeExpr(
                self._parse_indented_stmt_block(
                    missing_message="expected indented block after `name:`",
                )
            )
        if isinstance(target, ast.Ident) and self._name_is_type_bind(target.name):
            saved = self.i
            try:
                out = self._parse_type_definition_until_stmt_end()
                if (
                    isinstance(out, ast.MapValueType) and not out.fields
                ) or (
                    isinstance(out, ast.LinkedListValueType) and not out.elements
                ):
                    self.i = saved
                    return self.parse_expr()
                return out
            except ParseError as e:
                if "spaced ` -> `" in str(e):
                    raise
                self.i = saved
                return self.parse_expr()
        return self.parse_expr()

    def _peek_update_bind_op(self) -> str | None:
        self._skip_trivia()
        kind = self._peek_raw()
        if kind not in _UPDATE_BIND_OPS:
            return None
        if self.i + 1 >= len(self.toks) or self.toks[self.i + 1].kind != COLON:
            return None
        if kind in (AND, OR, XOR) and self.i + 2 < len(self.toks) and self.toks[self.i + 2].kind == LPAREN:
            return None
        return _UPDATE_BIND_OPS[kind]

    def parse_expr(self) -> Any:
        return self.parse_pipe()

    def parse_pipe(self) -> Any:
        self._skip_trivia()
        # Leading ``>>`` (no LHS yet) — stdin supplies the line piped into ``$`` (see ``StdinPipe``).
        if self._peek_raw() == PIPE:
            self._advance()
            right = self.parse_expr()
            return ast.StdinPipe(right)
        left = self.parse_or_expr()
        if self._peek_raw() == QUESTION:
            self._advance()
            if self._peek_raw() == BANG:
                self._advance()
                message = None
                if self._peek_raw() not in (NEWLINE, EOF, SEMICOLON, RPAREN, DEDENT):
                    message = self.parse_expr()
                left = ast.AssertExpr(left, message, self._format_expr_for_label(left))
            elif self._peek_raw() == QUESTION:
                self._advance()
                loop_mode = False
                if self._peek_raw() == GT:
                    self._advance()
                    loop_mode = True
                arms = self._parse_match_arms_after_double_question()
                left = ast.MatchStmt(left, arms, loop=loop_mode, catch=False)
            else:
                loop_mode = False
                if self._peek_raw() == GT:
                    self._advance()
                    loop_mode = True
                body = self._parse_conditional_body()
                left = ast.ConditionalExpr(left, body, loop=loop_mode)
        elif self._peek_raw() == BANG_QUESTION:
            self._advance()
            arms = self._parse_match_arms_after_double_question()
            left = ast.MatchStmt(left, arms, loop=False, catch=True)
        segments: list[Any] = []
        while True:
            k = self._peek_raw()
            if k == PIPE:
                self._advance()
                segments.append(self._parse_pipe_rhs())
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                if self._peek_raw() == PIPE:
                    self._advance()
                    segments.append(self._parse_pipe_rhs())
                    continue
                self.i = saved
                break
            break
        if not segments:
            return left
        return ast.PipeChain(left, segments)

    def _parse_pipe_rhs(self) -> Any:
        """RHS of ``>>``: semicolon-separated statements (``:: $``; ``$? …``; binds; …).

        Each ``:: expr`` prints with a trailing newline unless ``expr`` stringifies to text
        that already ends with ``\\n`` (e.g. ``$ & "\\n"`` controls the line ending explicitly).
        """
        stmts = self.parse_stmt_semicolon_chain()
        return self._func_body_from_stmts(stmts)

    def parse_or_expr(self) -> Any:
        left = self.parse_and_expr()
        while True:
            k = self._peek_raw()
            if k in (OR, XOR):
                op = self._advance().kind
                right = self.parse_and_expr()
                left = ast.BinOp(op, left, right)
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                k2 = self._peek_raw()
                if k2 in (OR, XOR):
                    if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                        self.i = saved
                        break
                    op = self._advance().kind
                    right = self.parse_and_expr()
                    left = ast.BinOp(op, left, right)
                    continue
                self.i = saved
                break
            break
        return left

    def parse_and_expr(self) -> Any:
        left = self.parse_not_expr()
        while True:
            k = self._peek_raw()
            if k == AND:
                self._advance()
                right = self.parse_not_expr()
                left = ast.BinOp(AND, left, right)
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                if self._peek_raw() == AND:
                    if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                        self.i = saved
                        break
                    self._advance()
                    right = self.parse_not_expr()
                    left = ast.BinOp(AND, left, right)
                    continue
                self.i = saved
                break
            break
        return left

    def parse_not_expr(self) -> Any:
        self._skip_trivia()
        if self._peek_raw() == NOT:
            self._advance()
            return ast.UnaryOp(NOT, self.parse_not_expr())
        return self.parse_cmp_expr()

    def parse_cmp_expr(self) -> Any:
        cmp_ops = (EQ, EXACT_EQ, NEQ, STRUCT_NEQ, LT, LE, GT, GE)
        left = self.parse_add_expr()
        while True:
            k = self._peek_raw()
            if k in cmp_ops:
                op = self._advance().kind
                left = ast.BinOp(op, left, self.parse_add_expr())
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                if self._peek_raw() in cmp_ops:
                    op = self._advance().kind
                    left = ast.BinOp(op, left, self.parse_add_expr())
                    continue
                self.i = saved
                break
            break
        return left

    def parse_add_expr(self) -> Any:
        left = self.parse_mul_expr()
        while True:
            k = self._peek_raw()
            if k in (PLUS, MINUS, AMPERSAND):
                op = self._advance().kind
                left = ast.BinOp(op, left, self.parse_mul_expr())
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                if self._peek_raw() in (PLUS, MINUS, AMPERSAND):
                    op = self._advance().kind
                    left = ast.BinOp(op, left, self.parse_mul_expr())
                    continue
                self.i = saved
                break
            break
        return left

    def parse_mul_expr(self) -> Any:
        left = self.parse_power()
        while True:
            k = self._peek_raw()
            if k in (STAR, SLASH, FLOORDIV, PERCENT):
                op = self._advance().kind
                left = ast.BinOp(op, left, self.parse_power())
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                k2 = self._peek_raw()
                if k2 in (STAR, SLASH, FLOORDIV, PERCENT):
                    op = self._advance().kind
                    left = ast.BinOp(op, left, self.parse_power())
                    continue
                self.i = saved
                break
            if self._implicit_mul_follows():
                left = ast.BinOp(STAR, left, self.parse_power())
                continue
            break
        return left

    def parse_power(self) -> Any:
        left = self.parse_unary()
        k = self._peek_raw()
        if k == CARET:
            self._advance()
            right = self.parse_power()
            return ast.BinOp(CARET, left, right)
        if k == NEWLINE:
            saved = self.i
            self._skip_trivia()
            if self._peek_raw() == CARET:
                self._advance()
                right = self.parse_power()
                return ast.BinOp(CARET, left, right)
            self.i = saved
        return left

    def parse_unary(self) -> Any:
        self._skip_trivia()
        if self._peek_raw() == MINUS:
            self._advance()
            return ast.UnaryOp(MINUS, self.parse_unary())
        if self._peek_raw() == BAR:
            self._advance()
            inner = self.parse_expr()
            if self._peek_raw() != BAR:
                raise ParseError("expected '|' to close absolute value", self._loc_here())
            self._advance()
            return ast.AbsExpr(inner)
        return self.parse_postfix()

    def _call_may_continue_after_newline(self, left: Any) -> bool:
        """``f`` / ``obj.m`` / ``g(x)`` may be split across lines before ``(``; literals may not."""
        return isinstance(left, (ast.Ident, ast.Attribute))

    def _params_to_domain_type(
        self, params: list[ast.Param]
    ) -> Any:
        if not params:
            return ast.TupleTypeExpr([])
        fields: list[tuple[str, Any]] = []
        for p in params:
            if p.param_func_type is not None:
                fields.append((p.name, p.param_func_type))
            else:
                fields.append((p.name, p.type_ref if p.type_ref is not None else (p.type_name or "any")))
        return ast.TypeExpr(fields)

    def _dot_adjacency(self) -> tuple[bool, bool]:
        """Lexer records whether `.` touches the operand on each side (no whitespace)."""
        v = self.toks[self.i - 1].value
        if isinstance(v, tuple) and len(v) == 2:
            return (bool(v[0]), bool(v[1]))
        return (True, True)

    def _reject_illegal_follow_after_loose_dot(self) -> None:
        """After `a.` with whitespace after `.`, the reach ends (type-of); certain tokens may not follow on the same line."""
        dot_line = self.toks[self.i - 1].location.line
        j = self.i
        while j < len(self.toks) and self.toks[j].kind == NEWLINE:
            j += 1
        if j >= len(self.toks) or self.toks[j].kind == EOF:
            return
        t = self.toks[j]
        if t.location.line != dot_line:
            return
        if t.kind in (RPAREN, RBRACKET, RBRACE, COMMA, SEMICOLON):
            return
        if self._type_expr_relaxed_loose_dot_depth > 0 and t.kind == IDENT:
            return
        # Operators and `::` may follow (e.g. `a. = t`, `a. + 1`); field/index starters may not.
        if t.kind in (IDENT, LPAREN, NUMBER, STRING, STRING_RAW, DOLLAR):
            raise ParseError(
                "space after `.` ends the reach; use `a.b` with no space between `.` and the name",
                self._loc_here(),
            )

    def _parse_dot_suffix(
        self, left: Any, left_tight: bool, right_tight: bool
    ) -> Any:
        """After ``.``: ``(…)``, ``.$``, index, field — or loose dot → type-of (``a.``)."""
        if not left_tight:
            raise ParseError(
                "`.` must be adjacent to the left operand (no space before `.`)",
                self._loc_here(),
            )
        if not right_tight:
            self._reject_illegal_follow_after_loose_dot()
            return ast.TypeOf(left)
        self._skip_trivia()
        k0 = self._peek_raw()
        if k0 not in (LPAREN, DOLLAR, NUMBER, STRING, STRING_RAW, IDENT):
            return ast.TypeOf(left)
        if self._peek_raw() == LPAREN:
            self._advance()
            indices: list[Any] = []
            if self._peek_raw() == RPAREN:
                raise ParseError(
                    "expected at least one index in .(...)", self._loc_here()
                )
            while True:
                indices.append(self.parse_expr())
                if self._peek_raw() == COMMA:
                    self._advance()
                    continue
                break
            self._expect(RPAREN)
            return ast.DottedIndex(left, indices)
        if self._peek_raw() == DOLLAR:
            self._advance()
            if self._peek_raw() == LPAREN:
                self._advance()
                if self._peek_raw() == RPAREN:
                    raise ParseError(
                        "expected expression in .$(...)", self._loc_here()
                    )
                expr = self.parse_expr()
                self._expect(RPAREN)
                return ast.DottedIndex(left, [expr])
            if self._peek_raw() == IDENT:
                name = str(self._advance().value)
                return ast.DottedIndex(left, [ast.Ident(name)])
            raise ParseError(
                "expected identifier or (expr) after .$", self._loc_here()
            )
        if self._peek_raw() == NUMBER:
            n = self._advance().value
            return ast.DottedIndex(left, [ast.NumberLit(n)])
        if self._peek_raw() == STRING:
            s = self._expect(STRING)
            return ast.Attribute(left, str(s.value))
        if self._peek_raw() == STRING_RAW:
            s = self._expect(STRING_RAW)
            return ast.Attribute(left, str(s.value))
        name = str(self._expect(IDENT).value)
        return ast.Attribute(left, name)

    def _parse_call_argument(self) -> Any:
        """``expr``, ``name: value``, or ``:expr`` (spread)."""
        self._skip_trivia()
        if self._peek_raw() == COLON:
            self._advance()
            inner = self.parse_expr()
            return ast.SpreadArg(inner)
        if self._peek_raw() == IDENT:
            j = self.i + 1
            while j < len(self.toks) and self.toks[j].kind == NEWLINE:
                j += 1
            if j < len(self.toks) and self.toks[j].kind == COLON:
                name = str(self._advance().value)
                self._expect(COLON)
                val = self.parse_expr()
                return ast.NamedCallArg(name, val)
        return self.parse_expr()

    def _parse_tuple_literal_element(self) -> Any:
        """One slot in ``( … )``: ``:expr`` spreads into the flat tuple; else normal ``expr``."""
        self._skip_trivia()
        if self._peek_raw() == COLON:
            self._advance()
            inner = self.parse_expr()
            return ast.SpreadArg(inner)
        return self.parse_expr()

    def _arrow_adjacency(self) -> tuple[bool, bool]:
        """Lexer records whether ``->`` touches the operand on each side (no whitespace)."""
        v = self.toks[self.i - 1].value
        if isinstance(v, tuple) and len(v) == 2:
            return (bool(v[0]), bool(v[1]))
        return (True, True)

    def _arrow_adjacency_at_cursor(self) -> tuple[bool, bool]:
        """Tightness for the ``ARROW`` token currently under ``self._peek_raw()``."""
        v = self.toks[self.i].value
        if isinstance(v, tuple) and len(v) == 2:
            return (bool(v[0]), bool(v[1]))
        return (True, True)

    def _require_spaced_arrow_after_rparen_for_types(self) -> None:
        """Distinguish type/function ``) ->`` from value postfix ``)->`` (axis access).

        After a closing ``)`` that ends a parameter list or tuple type, the lexer
        marks ``->`` as left-loose only when there is whitespace before ``-``. Axis
        tagging uses tight ``)->`` on parenthesized values.
        """
        if self.i == 0:
            return
        if self.toks[self.i - 1].kind != RPAREN:
            return
        lt, _ = self._arrow_adjacency_at_cursor()
        if lt:
            raise ParseError(
                "after `)` use a spaced ` -> ` for function or type arrows "
                "(e.g. `(x:num) -> num` or `() -> num`); tight `)->` is postfix axis access",
                self._loc_here(),
            )

    def _parse_arrow_access_suffix(
        self, left: Any, left_tight: bool, right_tight: bool
    ) -> Any:
        """After tight ``->``: same reach shapes as ``.`` (field / index / string / number)."""
        if not left_tight:
            raise ParseError(
                "`->` must be adjacent to the left operand (no space before `->`)",
                self._loc_here(),
            )
        if not right_tight:
            raise ParseError(
                "`->` must be adjacent to the axis access (no space after `->`)",
                self._loc_here(),
            )
        self._skip_trivia()
        k0 = self._peek_raw()
        if k0 not in (LPAREN, DOLLAR, NUMBER, STRING, STRING_RAW, IDENT):
            raise ParseError(
                "expected axis access after `->` (identifier, number, string, or `(...)` like after `.`)",
                self._loc_here(),
            )
        if self._peek_raw() == LPAREN:
            self._advance()
            indices: list[Any] = []
            if self._peek_raw() == RPAREN:
                raise ParseError(
                    "expected at least one index in `->(...)`", self._loc_here()
                )
            while True:
                indices.append(self.parse_expr())
                if self._peek_raw() == COMMA:
                    self._advance()
                    continue
                break
            self._expect(RPAREN)
            return ast.AxisAlign(left, indices=indices)
        if self._peek_raw() == DOLLAR:
            self._advance()
            if self._peek_raw() == LPAREN:
                self._advance()
                if self._peek_raw() == RPAREN:
                    raise ParseError(
                        "expected expression in `->$(...)`", self._loc_here()
                    )
                expr = self.parse_expr()
                self._expect(RPAREN)
                return ast.AxisAlign(left, indices=[expr])
            if self._peek_raw() == IDENT:
                name = str(self._advance().value)
                return ast.AxisAlign(left, indices=[ast.Ident(name)])
            raise ParseError(
                "expected identifier or (expr) after `->$`", self._loc_here()
            )
        if self._peek_raw() == NUMBER:
            n = self._advance().value
            return ast.AxisAlign(left, indices=[ast.NumberLit(n)])
        if self._peek_raw() == STRING:
            s = self._expect(STRING)
            return ast.AxisAlign(left, label=str(s.value))
        if self._peek_raw() == STRING_RAW:
            s = self._expect(STRING_RAW)
            return ast.AxisAlign(left, label=str(s.value))
        name = str(self._expect(IDENT).value)
        if name in _PRIMITIVE_TYPE_IDENTS:
            raise ParseError(
                f"{name!r} cannot be used as an axis label (reserved like a primitive type name)",
                self._loc_here(),
            )
        return ast.AxisAlign(left, label=name)

    def parse_postfix(self) -> Any:
        left = self.parse_atom()
        while True:
            k = self._peek_raw()
            if k == DOT:
                self._advance()
                lt, rt = self._dot_adjacency()
                left = self._parse_dot_suffix(left, lt, rt)
                continue
            if k == ARROW:
                if isinstance(left, ast.Ident) and left.name in _PRIMITIVE_TYPE_IDENTS:
                    break
                self._advance()
                lt, rt = self._arrow_adjacency()
                left = self._parse_arrow_access_suffix(left, lt, rt)
                continue
            if k == LPAREN:
                self._advance()
                args: list[Any] = []
                if self._peek_raw() != RPAREN:
                    while True:
                        args.append(self._parse_call_argument())
                        self._emit_disallowed_in_value_expr("function call argument")
                        if self._peek_raw() == COMMA:
                            self._advance()
                            continue
                        break
                self._expect(RPAREN)
                left = ast.Call(left, args)
                continue
            if k == NEWLINE:
                saved = self.i
                self._skip_trivia()
                if self._peek_raw() == DOT:
                    self._advance()
                    lt, rt = self._dot_adjacency()
                    left = self._parse_dot_suffix(left, lt, rt)
                    continue
                if self._peek_raw() == ARROW:
                    if isinstance(left, ast.Ident) and left.name in _PRIMITIVE_TYPE_IDENTS:
                        self.i = saved
                        break
                    self._advance()
                    lt, rt = self._arrow_adjacency()
                    left = self._parse_arrow_access_suffix(left, lt, rt)
                    continue
                if self._peek_raw() == LPAREN and self._call_may_continue_after_newline(left):
                    if isinstance(left, ast.Ident) and left.name in _PRIMITIVE_TYPE_IDENTS:
                        self.i = saved
                        break
                    self._advance()
                    args: list[Any] = []
                    if self._peek_raw() != RPAREN:
                        while True:
                            args.append(self._parse_call_argument())
                            self._emit_disallowed_in_value_expr("function call argument")
                            if self._peek_raw() == COMMA:
                                self._advance()
                                continue
                            break
                    self._expect(RPAREN)
                    left = ast.Call(left, args)
                    continue
                self.i = saved
            if k == BANG:
                self._advance()
                left = ast.RaiseExpr(left)
                continue
            break
        return left

    def parse_atom(self) -> Any:
        self._skip_trivia()
        k = self._peek_raw()
        if k in _ATOM_CALL_OP_KINDS:
            if self.i + 1 < len(self.toks) and self.toks[self.i + 1].kind == LPAREN:
                sym = _token_kind_to_op_symbol(self._advance().kind)
                self._expect(LPAREN)
                args: list[Any] = []
                if self._peek_raw() != RPAREN:
                    while True:
                        args.append(self._parse_call_argument())
                        self._emit_disallowed_in_value_expr("function call argument")
                        if self._peek_raw() == COMMA:
                            self._advance()
                            continue
                        break
                self._expect(RPAREN)
                return ast.Call(ast.OpRef(sym), args)
        if k == RANGE:
            self._advance()
            if self._peek_raw() == NUMBER:
                n = self._advance().value
                return ast.RangeExpr(None, ast.NumberLit(n))
            return ast.RangeExpr(None, None)
        if k == NUMBER:
            n = self._advance().value
            if self._peek_raw() == RANGE:
                self._advance()
                if self._peek_raw() == NUMBER:
                    end = self._advance().value
                    return ast.RangeExpr(ast.NumberLit(n), ast.NumberLit(end))
                return ast.RangeExpr(ast.NumberLit(n), None)
            return ast.NumberLit(n)
        if k == STRING:
            return ast.StringLit(str(self._advance().value), raw=False)
        if k == STRING_RAW:
            return ast.StringLit(str(self._advance().value), raw=True)
        if k == TRUE:
            self._advance()
            return ast.BoolLit(True)
        if k == FALSE:
            self._advance()
            return ast.BoolLit(False)
        if k == NULL:
            self._advance()
            return ast.NullLit()
        if k == DOT:
            return self._parse_dot_module_path_from_dot()
        if k == IDENT:
            return ast.Ident(str(self._advance().value))
        if k == DOLLAR:
            self._advance()
            return ast.Ident("$")
        if k == LPAREN:
            open_paren = self._advance()
            if self._peek_raw() == RPAREN:
                self._advance()
                return ast.StructLit([])
            if self._next_token_starts_new_line_after(open_paren.location.line) and not self._paren_contains_top_level_comma():
                return self._parse_parenthesized_scope_block()
            if self._peek_raw() == COLON:
                self._advance()
                if self._peek_raw() == RPAREN:
                    self._advance()
                    return ast.StructIdentity()
                inner = self.parse_expr()
                self._expect(RPAREN)
                return ast.SpillExpr(inner)
            if self._is_type_record_contents_after_lparen():
                saved = self.i
                try:
                    te = self._parse_type_record_after_lparen()
                    self._skip_trivia()
                    if self._peek_raw() == ARROW:
                        self._require_spaced_arrow_after_rparen_for_types()
                        self._advance()
                        cod = self._parse_return_type_spec()
                        return ast.FuncType(te, self._normalize_codomain_for_func_type(cod))
                    return te
                except ParseError:
                    self.i = saved
            if (
                self._peek_raw() == DOLLAR
                and self.i + 1 < len(self.toks)
                and self.toks[self.i + 1].kind == LPAREN
            ):
                self._advance()
                self._expect(LPAREN)
                pnames: list[str] = []
                if self._peek_raw() != RPAREN:
                    while True:
                        pnames.append(str(self._expect(IDENT).value))
                        if self._peek_raw() == COMMA:
                            self._advance()
                            continue
                        break
                self._expect(RPAREN)
                self._expect(COLON)
                body = self.parse_expr()
                self._expect(RPAREN)
                return ast.Lambda(pnames, body)
            if self._peek_raw() == IDENT:
                saved = self.i
                name = str(self._expect(IDENT).value)
                self._skip_trivia()
                if self._peek_raw() == COLON:
                    self._advance()
                    value = self.parse_expr()
                    self._emit_disallowed_in_value_expr("parenthesized binding / struct literal")
                    self._skip_trivia()
                    if self._peek_raw() == COMMA:
                        fields = [(name, value)]
                        while self._peek_raw() == COMMA:
                            self._advance()
                            self._skip_trivia()
                            if self._peek_raw() == RPAREN:
                                break
                            field_name = str(self._expect(IDENT).value)
                            self._expect(COLON)
                            field_value = self.parse_expr()
                            self._emit_disallowed_in_value_expr("struct literal")
                            fields.append((field_name, field_value))
                            self._skip_trivia()
                        self._expect(RPAREN)
                        return ast.StructLit(fields)
                    self._expect(RPAREN)
                    return ast.Bind(ast.Ident(name), value)
                self.i = saved
            e = self._parse_tuple_literal_element()
            self._emit_disallowed_in_value_expr("tuple literal")
            self._skip_trivia()
            if self._peek_raw() == COMMA:
                els = [e]
                while self._peek_raw() == COMMA:
                    self._advance()
                    self._skip_trivia()
                    if self._peek_raw() == RPAREN:
                        break
                    els.append(self._parse_tuple_literal_element())
                    self._emit_disallowed_in_value_expr("tuple literal")
                self._expect(RPAREN)
                return ast.TupleLit(els)
            self._expect(RPAREN)
            if isinstance(e, ast.SpreadArg):
                return ast.TupleLit([e])
            return e
        if k == LBRACKET:
            self._advance()
            els: list[Any] = []
            if self._peek_raw() != RBRACKET:
                while True:
                    els.append(self._parse_vector_element())
                    self._emit_disallowed_in_value_expr("vector literal")
                    if self._peek_raw() == COMMA:
                        self._advance()
                        continue
                    break
            self._expect(RBRACKET)
            return ast.ListLit(els)
        if k == LBRACE:
            self._advance()
            if self._peek_raw() == RBRACE:
                self._expect(RBRACE)
                return ast.MultisetLit([])
            if self._peek_raw() == COLON:
                self._advance()
                inner = self.parse_expr()
                self._emit_disallowed_in_value_expr("multiset literal")
                if self._peek_raw() == COMMA:
                    raise ParseError(
                        "multiset spill `{:expr}` must be the only entry in the multiset literal",
                        self._loc_here(),
                    )
                self._expect(RBRACE)
                return ast.MultisetFromValues(inner)
            pairs: list[tuple[Any, Any]] = []
            while True:
                ke = self.parse_expr()
                if self._peek_raw() == COLON:
                    self._advance()
                    ce = self.parse_expr()
                else:
                    ce = ast.NumberLit(1)
                pairs.append((ke, ce))
                self._emit_disallowed_in_value_expr("multiset literal")
                if self._peek_raw() == COMMA:
                    self._advance()
                    continue
                break
            self._expect(RBRACE)
            return ast.MultisetLit(pairs)

        raise ParseError(f"unexpected {_describe_token_kind(k)} in expression", self._loc_here())

    def _parse_vector_element(self) -> Any:
        """One vector slot: ``:expr`` multiset spill, ``expr`` or ``expr : count`` repeat."""
        self._skip_trivia()
        if self._peek_raw() == COLON:
            self._advance()
            inner = self.parse_expr()
            return ast.MsetSpill(inner)
        e = self.parse_expr()
        self._skip_trivia()
        if self._peek_raw() == COLON:
            self._advance()
            cnt = self.parse_expr()
            return ast.VectorRepeat(e, cnt)
        return e

    def _parse_struct_literal(self) -> ast.StructLit:
        fields: list[tuple[str, Any]] = []
        while True:
            name = str(self._expect(IDENT).value)
            self._expect(COLON)
            fe = self.parse_expr()
            self._emit_disallowed_in_value_expr("struct literal")
            fields.append((name, fe))
            if self._peek_raw() == COMMA:
                self._advance()
                continue
            break
        self._expect(RPAREN)
        return ast.StructLit(fields)

    def _implicit_mul_follows(self) -> bool:
        k = self._peek_raw()
        if k == NEWLINE:
            return False
        return k in (
            NUMBER,
            IDENT,
            LPAREN,
            LBRACKET,
            LBRACE,
            DOLLAR,
            DOT,
            STRING,
            STRING_RAW,
        )

    def _format_expr_for_label(self, expr: Any) -> str:
        if isinstance(expr, ast.Ident):
            return expr.name
        if isinstance(expr, ast.NumberLit):
            v = expr.value
            if isinstance(v, int):
                return str(v)
            if isinstance(v, float) and v.is_integer():
                return str(int(v))
            return str(v)
        if isinstance(expr, ast.BoolLit):
            return "true" if expr.value else "false"
        if isinstance(expr, ast.NullLit):
            return "null"
        if isinstance(expr, ast.StringLit):
            quote = "'" if expr.raw else '"'
            inner = expr.value.replace("\\", "\\\\").replace(quote, "\\" + quote)
            return f"{quote}{inner}{quote}"
        if isinstance(expr, ast.BinOp):
            return (
                f"{self._format_expr_for_label(expr.left)}"
                f"{BINOP_KIND_TO_SYM.get(expr.op, expr.op)}"
                f"{self._format_expr_for_label(expr.right)}"
            )
        if isinstance(expr, ast.UnaryOp):
            return f"{UNARY_KIND_TO_SYM.get(expr.op, expr.op)}{self._format_expr_for_label(expr.operand)}"
        if isinstance(expr, ast.Call):
            parts: list[str] = []
            for a in expr.args:
                if isinstance(a, ast.NamedCallArg):
                    parts.append(f"{a.name}:{self._format_expr_for_label(a.value)}")
                elif isinstance(a, ast.SpreadArg):
                    parts.append(f":{self._format_expr_for_label(a.expr)}")
                else:
                    parts.append(self._format_expr_for_label(a))
            return f"{self._format_expr_for_label(expr.func)}({', '.join(parts)})"
        if isinstance(expr, ast.Attribute):
            return f"{self._format_expr_for_label(expr.value)}.{expr.name}"
        if isinstance(expr, ast.DottedIndex):
            parts = ", ".join(self._format_expr_for_label(i) for i in expr.indices)
            return f"{self._format_expr_for_label(expr.base)}.({parts})"
        if isinstance(expr, ast.TupleLit):
            parts: list[str] = []
            for e in expr.elements:
                if isinstance(e, ast.SpreadArg):
                    parts.append(f":{self._format_expr_for_label(e.expr)}")
                else:
                    parts.append(self._format_expr_for_label(e))
            return f"({', '.join(parts)})"
        if isinstance(expr, ast.ListLit):
            return "[" + ", ".join(self._format_expr_for_label(e) for e in expr.elements) + "]"
        if isinstance(expr, ast.AxisAlign):
            inner = self._format_expr_for_label(expr.value)
            if expr.label is not None:
                return f"{inner}->{expr.label}"
            assert expr.indices is not None
            return f"{inner}->({', '.join(self._format_expr_for_label(i) for i in expr.indices)})"
        return f"<{type(expr).__name__}>"


def parse_module(source: str, filename: str = "<stdin>") -> ast.Module:
    from .lexer import tokenize

    toks = tokenize(source, filename=filename)
    p = Parser(toks, source=source, filename=filename)
    return p.parse_module()


def parse_tokens(tokens: list[Token]) -> ast.Module:
    """Parse a pre-tokenized stream.

    This is the first stable seam for a future native lexer: produce the token
    stream in the same shape and hand it to the existing parser.
    """
    from .token_stream import validate_token_sequence

    validate_token_sequence(tokens)
    p = Parser(tokens)
    return p.parse_module()


def parse_token_stream_json(text: str) -> ast.Module:
    """Parse a JSON token-stream payload into an AST module.

    This is the CLI-facing ingestion seam for external lexers: emit the stable
    token JSON payload defined by ``token_stream.py`` and hand it straight to
    the parser without going back through the source lexer.
    """
    from .token_stream import load_tokens_from_json

    tokens = load_tokens_from_json(text, parser_surface=True)
    return parse_tokens(tokens)


def parse_expression(source: str, filename: str = "<expr>") -> Any:
    """Parse a single expression (used by string ``$(...)`` interpolation)."""
    from .lexer import tokenize

    toks = tokenize(source, filename=filename)
    p = Parser(toks)
    e = p.parse_expr()
    p._skip_trivia()
    if p._peek_raw() != EOF:
        raise ParseError("trailing tokens in interpolated expression", p._loc_here())
    return e
