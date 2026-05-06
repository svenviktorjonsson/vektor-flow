"""Token types for Vektor Flow.

A Token has a `kind` (string), an optional `value` (literal payload), and a
`SourceLocation`. The `kind` is kept as a plain string for readability and
ease of exhaustive matching in the parser.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .errors import SourceLocation


# --- Token kinds -----------------------------------------------------------

# Literals
NUMBER = "NUMBER"
STRING = "STRING"
# Single-quoted literal: no ``$`` interpolation (see :class:`ast.StringLit`).
STRING_RAW = "STRING_RAW"
IDENT = "IDENT"
TRUE = "TRUE"
FALSE = "FALSE"
NULL = "NULL"

# Logical operators (lexemes: `/\`, `\/`, `><`, `~`)
AND = "AND"
OR = "OR"
XOR = "XOR"
NOT = "NOT"

# Single-char operators
PLUS = "PLUS"          # +
MINUS = "MINUS"        # -
STAR = "STAR"          # *
SLASH = "SLASH"        # /
CARET = "CARET"        # ^
PERCENT = "PERCENT"    # %
AMPERSAND = "AMPERSAND"  # &  (concatenation / merge: tuple, vector, string, struct)

# Relations
EQ = "EQ"              # =
EXACT_EQ = "EXACT_EQ"  # ==
NEQ = "NEQ"            # !=
STRUCT_NEQ = "STRUCT_NEQ"  # ~=
LT = "LT"              # <
LE = "LE"              # <=
GT = "GT"              # >
GE = "GE"              # >=

# Punctuation & multi-char
COLON = "COLON"        # :   (bind / definition)
EMIT = "EMIT"          # ::
PIPE = "PIPE"          # >>
BAR = "BAR"            # |  (absolute value only; pipe is `>>`)
DOT = "DOT"            # .
RANGE = "RANGE"        # ..
ARROW = "ARROW"        # ->
FAT_ARROW = "FAT_ARROW"  # =>
COMMA = "COMMA"        # ,
SEMICOLON = "SEMICOLON"  # ;  (statement separator in function bodies)
QUESTION = "QUESTION"  # ?
BANG_QUESTION = "BANG_QUESTION"  # !?
DOLLAR = "DOLLAR"      # $  (sigil, used for lambda/pipe-element/current)

# Control flow (``@`` family)
# ``@`` returns ``null``; ``@:`` returns local scope / value; ``@::`` return+emit.
AT = "AT"              # @   return null
AT_COLON = "AT_COLON"  # @:  return local scope / value
AT_EMIT = "AT_EMIT"  # @::  return and print (single token so ``::`` is not split from ``@:``)
AT_GT = "AT_GT"        # @>  continue innermost loop / pipe iteration
AT_BAR = "AT_BAR"      # @|  break innermost loop / pipe iteration
AT_BANG = "AT_BANG"    # @!  exit program

# Brackets
LPAREN = "LPAREN"      # (
RPAREN = "RPAREN"      # )
LBRACKET = "LBRACKET"  # [
RBRACKET = "RBRACKET"  # ]
LBRACE = "LBRACE"      # {
RBRACE = "RBRACE"      # }

# Structural
NEWLINE = "NEWLINE"
INDENT = "INDENT"
DEDENT = "DEDENT"
EOF = "EOF"


KEYWORDS: dict[str, str] = {
    "true": TRUE,
    "false": FALSE,
    "null": NULL,
}


@dataclass
class Token:
    kind: str
    value: Any
    location: SourceLocation

    def __repr__(self) -> str:
        if self.value is None or self.value == "":
            return f"Token({self.kind} @ {self.location.line}:{self.location.column})"
        return f"Token({self.kind}, {self.value!r} @ {self.location.line}:{self.location.column})"
