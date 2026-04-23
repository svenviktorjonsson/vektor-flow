"""Lexer for Vektor Flow.

Responsibilities
----------------
* Tokenize source into a stream of `Token`s.
* Emit `INDENT` / `DEDENT` / `NEWLINE` based on leading whitespace **column
  depth**: spaces advance one column; tabs advance to the next tab stop (width 8).
  Deeper lines must be indented by a **non-zero** number of columns relative to
  the previous level; sibling lines share the same column. You may use spaces,
  tabs, or any mix that yields the intended columns.
* ``(`` / ``[`` / ``{`` start grouping, tuple/vector/multiset literals.
* Pipe is ``>>``; ``|`` is only for ``|expr|`` (absolute value). Logical ops: ``/\\``, ``\\/``, ``><``, ``~``.
* Line comments use ``#`` to end of line (so ``/\\`` and ``\\/`` are never split as ``//``).
* ``@`` is tokenized **before** ``:`` so ``@::`` is one token (return+emit), not ``@:`` + ``::``.
* Inside matched brackets, newlines are ignored (implicit line continuation).

* Double-quoted strings (``"..."``) use backslash escapes (``\\n``, ``\\t``, ``\\\\``, ``\\"``, ``\\$``, …).
* Single-quoted strings (``'...'``) are **raw**: no escape sequences; dollar and
  backslash are literal. A single quote inside the text is written as ``''``
  (SQL-style). They tokenize as ``STRING_RAW`` and skip ``$`` interpolation.

String interpolation (``$name``, ``$name.fmt``, ``$(expr).fmt``) in double-quoted
strings is decoded during evaluation. Single-quoted ``STRING_RAW`` literals are
returned unchanged.
"""

from __future__ import annotations

from typing import Any

from .errors import LexError, SourceLocation
from .tokens import (
    AMPERSAND,
    AND,
    ARROW,
    AT_BANG,
    AT_BAR,
    AT_COLON,
    AT_GT,
    BAR,
    CARET,
    COLON,
    COMMA,
    DEDENT,
    DOLLAR,
    DOT,
    EMIT,
    EOF,
    EQ,
    FAT_ARROW,
    GE,
    GT,
    IDENT,
    INDENT,
    KEYWORDS,
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
    Token,
    AT_EMIT,
    XOR,
)

# Tab width for expanding leading tabs to columns (same convention as Python tokenize).
_TAB_WIDTH = 8


_BRACKET_OPEN_TO_CLOSE = {"(": ")", "[": "]", "{": "}"}
_SINGLE_CHAR = {
    "+": PLUS,
    "*": STAR,
    "^": CARET,
    "%": PERCENT,
    "&": AMPERSAND,
    ",": COMMA,
    ";": SEMICOLON,
    "?": QUESTION,
    "$": DOLLAR,
    "~": NOT,
}


class Lexer:
    """Streaming lexer. Call :py:meth:`tokenize` to get the full token list."""

    def __init__(self, source: str, filename: str = "<stdin>") -> None:
        self.src = source
        self.filename = filename
        self.pos = 0
        self.line = 1
        self.col = 1
        self.tokens: list[Token] = []
        self.indent_stack: list[int] = [0]
        self.bracket_depth = 0
        self.at_line_start = True
        # After a single `.` (field access), the next identifier is always a
        # field name — never a keyword — so `a.type` works even if `type` were
        # reserved later.
        self._field_name_next = False

    # --- internals -----------------------------------------------------

    def _loc(self) -> SourceLocation:
        return SourceLocation(self.filename, self.line, self.col)

    def _peek(self, offset: int = 0) -> str:
        p = self.pos + offset
        if p >= len(self.src):
            return ""
        return self.src[p]

    def _advance(self) -> str:
        ch = self.src[self.pos]
        self.pos += 1
        if ch == "\n":
            self.line += 1
            self.col = 1
        else:
            self.col += 1
        return ch

    def _emit(self, kind: str, value: Any, loc: SourceLocation) -> None:
        self.tokens.append(Token(kind, value, loc))

    # --- main loop -----------------------------------------------------

    def tokenize(self) -> list[Token]:
        while self.pos < len(self.src):
            if self.at_line_start and self.bracket_depth == 0:
                self._handle_line_start()
                if self.pos >= len(self.src):
                    break

            ch = self._peek()

            if ch == "\n":
                self._advance()
                if self.bracket_depth == 0:
                    if self.tokens and self.tokens[-1].kind != NEWLINE:
                        self._emit(NEWLINE, None, self._loc())
                    self.at_line_start = True
                continue

            if ch == " " or ch == "\t":
                self._advance()
                continue

            if ch == "#":
                while self.pos < len(self.src) and self._peek() != "\n":
                    self._advance()
                continue

            self._lex_token()

        # Final NEWLINE (if any content), closing DEDENTs, then EOF.
        if self.tokens and self.tokens[-1].kind not in (NEWLINE, DEDENT, INDENT):
            self._emit(NEWLINE, None, self._loc())
        while len(self.indent_stack) > 1:
            self.indent_stack.pop()
            self._emit(DEDENT, None, self._loc())
        self._emit(EOF, None, self._loc())
        return self.tokens

    # --- line-start indentation ---------------------------------------

    def _leading_indent_column(self) -> int:
        """Consume leading spaces/tabs and return the indent column (0-based)."""
        col = 0
        while self.pos < len(self.src):
            ch = self._peek()
            if ch == "\t":
                col = ((col // _TAB_WIDTH) + 1) * _TAB_WIDTH
                self._advance()
            elif ch == " ":
                col += 1
                self._advance()
            else:
                break
        return col

    def _handle_line_start(self) -> None:
        """Measure leading indent (column depth) and emit INDENT/DEDENT as needed.

        Lines that are blank or contain only a comment are skipped without
        affecting the indentation stack.
        """
        col = self._leading_indent_column()

        # Look ahead: is this line effectively blank (nothing but whitespace
        # or a line comment)?
        scan = self.pos
        has_content = False
        while scan < len(self.src):
            c = self.src[scan]
            if c == "\n":
                break
            if c == "#":
                break
            if not c.isspace():
                has_content = True
                break
            scan += 1

        if not has_content:
            # Skip to the next newline; main loop consumes it.
            while self.pos < len(self.src) and self._peek() != "\n":
                self._advance()
            self.at_line_start = True
            return

        current = self.indent_stack[-1]
        if col > current:
            # col > current ⇒ strictly deeper indent (never a zero-width “step”).
            self.indent_stack.append(col)
            self._emit(INDENT, None, self._loc())
        elif col < current:
            while col < self.indent_stack[-1]:
                self.indent_stack.pop()
                self._emit(DEDENT, None, self._loc())
            if col != self.indent_stack[-1]:
                raise LexError(
                    f"Inconsistent indentation: column {col} does not match "
                    f"any outer level (stack {self.indent_stack})",
                    self._loc(),
                )

        self.at_line_start = False

    # --- token dispatch ------------------------------------------------

    def _lex_token(self) -> None:
        loc = self._loc()
        ch = self._peek()

        if ch.isdigit():
            self._lex_number(loc)
            return
        if ch == '"':
            self._lex_string(loc)
            return
        if ch == "'":
            self._lex_string_single(loc)
            return
        if ch.isalpha() or ch == "_":
            self._lex_ident(loc, field_name=self._field_name_next)
            self._field_name_next = False
            return

        if ch in "([{":
            self._advance()
            if ch == "(":
                self._emit(LPAREN, None, loc)
            elif ch == "[":
                self._emit(LBRACKET, None, loc)
            else:
                self._emit(LBRACE, None, loc)
            self.bracket_depth += 1
            return

        if ch in ")]}":
            self._advance()
            if ch == ")":
                self._emit(RPAREN, None, loc)
            elif ch == "]":
                self._emit(RBRACKET, None, loc)
            else:
                self._emit(RBRACE, None, loc)
            self.bracket_depth -= 1
            if self.bracket_depth < 0:
                raise LexError(f"Unmatched closing '{ch}'", loc)
            return

        if ch == "-":
            self._advance()
            if self._peek() == ">":
                self._advance()
                self._emit(ARROW, None, loc)
            else:
                self._emit(MINUS, None, loc)
            return

        # ``@`` before ``:`` so ``@::`` becomes ``AT_EMIT`` (not ``@`` + ``::`` emit).
        if ch == "@":
            self._advance()
            n = self._peek()
            if n == ">":
                self._advance()
                self._emit(AT_GT, None, loc)
            elif n == "|":
                self._advance()
                self._emit(AT_BAR, None, loc)
            elif n == "!":
                self._advance()
                self._emit(AT_BANG, None, loc)
            elif n == ":":
                self._advance()
                if self._peek() == ":":
                    self._advance()
                    self._emit(AT_EMIT, None, loc)
                else:
                    self._emit(AT_COLON, None, loc)
            else:
                raise LexError(
                    "incomplete `@`; use `@:` / `@::`, `@>`, `@|`, or `@!`",
                    loc,
                )
            return
        # Multi-character operators.
        if ch == ":":
            self._advance()
            if self._peek() == ":":
                self._advance()
                self._emit(EMIT, None, loc)
            else:
                self._emit(COLON, None, loc)
            return
        if ch == "=":
            self._advance()
            if self._peek() == ">":
                self._advance()
                self._emit(FAT_ARROW, None, loc)
            else:
                self._emit(EQ, None, loc)
            return
        if ch == "!":
            self._advance()
            if self._peek() == "=":
                self._advance()
                self._emit(NEQ, None, loc)
                return
            raise LexError("Unexpected '!'; did you mean '!='?", loc)
        if ch == "<":
            self._advance()
            if self._peek() == "=":
                self._advance()
                self._emit(LE, None, loc)
            else:
                self._emit(LT, None, loc)
            return
        if ch == ">":
            self._advance()
            if self._peek() == "=":
                self._advance()
                self._emit(GE, None, loc)
            elif self._peek() == ">":
                self._advance()
                self._emit(PIPE, None, loc)
            elif self._peek() == "<":
                self._advance()
                self._emit(XOR, None, loc)
            else:
                self._emit(GT, None, loc)
            return
        if ch == "/":
            self._advance()
            if self._peek() == "\\":
                self._advance()
                self._emit(AND, None, loc)
            else:
                self._emit(SLASH, None, loc)
            return
        if ch == "\\":
            self._advance()
            if self._peek() == "/":
                self._advance()
                self._emit(OR, None, loc)
            else:
                raise LexError(
                    "Unexpected backslash outside a string (use \\/ for logical or)",
                    loc,
                )
            return
        if ch == "|":
            self._advance()
            self._emit(BAR, None, loc)
            return
        if ch == ".":
            pos_at_dot = self.pos
            # Only spaces/tabs before `.` break the reach; newline is allowed (line continuation).
            left_adjacent = pos_at_dot > 0 and self.src[pos_at_dot - 1] not in (" ", "\t", "\r")
            self._advance()
            if self._peek() == ".":
                self._advance()
                self._emit(RANGE, None, loc)
            else:
                right_adjacent = self.pos < len(self.src) and self.src[self.pos] not in (
                    " ",
                    "\t",
                    "\n",
                    "\r",
                )
                # (left_adjacent, right_adjacent): tight reach requires no whitespace
                # touching `.` on that side.
                self._emit(DOT, (left_adjacent, right_adjacent), loc)
                self._field_name_next = right_adjacent
            return

        if ch in _SINGLE_CHAR:
            self._advance()
            self._emit(_SINGLE_CHAR[ch], None, loc)
            return

        raise LexError(f"Unexpected character {ch!r}", loc)

    # --- literals ------------------------------------------------------

    def _lex_number(self, loc: SourceLocation) -> None:
        start = self.pos
        while self._peek().isdigit():
            self._advance()

        is_float = False
        # A single `.` followed by a digit starts a fractional part.
        # `1..5` must lex as NUMBER(1), RANGE, NUMBER(5), so we require the
        # character after the dot to be a digit (not another dot).
        if self._peek() == "." and self._peek(1).isdigit():
            is_float = True
            self._advance()
            while self._peek().isdigit():
                self._advance()

        text = self.src[start : self.pos]
        value: Any = float(text) if is_float else int(text)
        self._emit(NUMBER, value, loc)

    def _lex_string(self, loc: SourceLocation) -> None:
        self._advance()  # opening quote
        out: list[str] = []
        while self.pos < len(self.src):
            ch = self._peek()
            if ch == '"':
                self._advance()
                self._emit(STRING, "".join(out), loc)
                return
            if ch == "\n":
                raise LexError("Unterminated string literal", loc)
            if ch == "\\":
                self._advance()
                esc = self._peek()
                if esc == "":
                    raise LexError("Unterminated string literal", loc)
                self._advance()
                out.append(_decode_escape(esc, loc))
                continue
            out.append(ch)
            self._advance()
        raise LexError("Unterminated string literal", loc)

    def _lex_string_single(self, loc: SourceLocation) -> None:
        """Single-quoted literal: no `\\` escapes; `''` -> one `'`; `$` and `\\` are kept as-is."""
        self._advance()  # opening '
        out: list[str] = []
        while self.pos < len(self.src):
            ch = self._peek()
            if ch == "'":
                self._advance()
                if self._peek() == "'":
                    self._advance()
                    out.append("'")
                    continue
                self._emit(STRING_RAW, "".join(out), loc)
                return
            if ch == "":
                break
            out.append(ch)
            self._advance()
        raise LexError("Unterminated single-quoted string literal", loc)

    def _lex_ident(self, loc: SourceLocation, *, field_name: bool = False) -> None:
        start = self.pos
        while True:
            c = self._peek()
            if c.isalnum() or c == "_":
                self._advance()
            else:
                break
        name = self.src[start : self.pos]
        if field_name:
            self._emit(IDENT, name, loc)
            return
        kind = KEYWORDS.get(name)
        if kind is not None:
            self._emit(kind, None, loc)
        else:
            self._emit(IDENT, name, loc)


def _decode_escape(esc: str, loc: SourceLocation) -> str:
    if esc == "n":
        return "\n"
    if esc == "t":
        return "\t"
    if esc == "r":
        return "\r"
    if esc == "\\":
        return "\\"
    if esc == '"':
        return '"'
    if esc == "$":
        # Escaped dollar — preserved as a literal. Interpolation parsing
        # (later stage) treats a raw backslash-dollar as a literal '$'.
        return "\\$"
    raise LexError(f"Unknown escape sequence \\{esc}", loc)


def tokenize(source: str, filename: str = "<stdin>") -> list[Token]:
    """Convenience wrapper: tokenize ``source`` into a list of tokens."""
    return Lexer(source, filename).tokenize()
