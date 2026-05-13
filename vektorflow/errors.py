"""Error types for the Vektor Flow interpreter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class SourceLocation:
    """A position in a source file."""

    file: str
    line: int
    column: int

    def __str__(self) -> str:
        return f"{self.file}:{self.line}:{self.column}"


class VektorFlowError(Exception):
    """Base class for all Vektor Flow errors."""

    def __init__(self, message: str, location: SourceLocation | None = None) -> None:
        self.message = message
        self.location = location
        if location is not None:
            super().__init__(f"{location}: {message}")
        else:
            super().__init__(message)


class LexError(VektorFlowError):
    """Raised when the lexer encounters invalid input."""


class ParseError(VektorFlowError):
    """Raised when the parser encounters invalid syntax."""


class EvalError(VektorFlowError):
    """Raised during evaluation."""


_TOKEN_LABELS: dict[str, str] = {
    "AMPERSAND": "`&`",
    "AND": "`/\\`",
    "ARROW": "`->`",
    "AT": "`@`",
    "AT_BANG": "`@!`",
    "AT_BAR": "`@|`",
    "AT_COLON": "`@:`",
    "AT_EMIT": "`@::`",
    "AT_GT": "`@>`",
    "BANG_QUESTION": "`!?`",
    "BAR": "`|`",
    "CARET": "`^`",
    "COLON": "`:`",
    "COMMA": "`,`",
    "DEDENT": "end of indented block",
    "DOLLAR": "`$`",
    "DOT": "`.`",
    "EMIT": "`::`",
    "EOF": "end of input",
    "EQ": "`=`",
    "FALSE": "`false`",
    "FAT_ARROW": "`=>`",
    "FLOOR_DIV": "`//`",
    "GE": "`>=`",
    "GT": "`>`",
    "IDENT": "name",
    "INDENT": "indentation",
    "LBRACE": "`{`",
    "LBRACKET": "`[`",
    "LE": "`<=`",
    "LPAREN": "`(`",
    "LT": "`<`",
    "MINUS": "`-`",
    "NEQ": "`!=`",
    "NEWLINE": "end of line",
    "NOT": "`~`",
    "NULL": "`null`",
    "NUMBER": "number",
    "OR": "`\\/`",
    "PERCENT": "`%`",
    "PIPE": "`>>`",
    "PLUS": "`+`",
    "QUESTION": "`?`",
    "RANGE": "`..`",
    "RBRACE": "`}`",
    "RBRACKET": "`]`",
    "RPAREN": "`)`",
    "SEMICOLON": "`;`",
    "SLASH": "`/`",
    "STAR": "`*`",
    "STRING": "string",
    "STRING_RAW": "raw string",
    "TRUE": "`true`",
    "XOR": "`><`",
}


def describe_token_kind(kind: str) -> str:
    """Return user-facing wording for an internal token kind."""
    return _TOKEN_LABELS.get(kind, "syntax")


def describe_unexpected_expression_token(kind: str) -> str:
    """Return clear wording for a token found where an expression should start."""
    descriptions = {
        "INDENT": "unexpected indentation; remove leading spaces or put the statement inside a block",
        "DEDENT": "unexpected end of indented block; check surrounding indentation",
        "NEWLINE": "unexpected newline; expected an expression",
        "EOF": "unexpected end of input; expected an expression",
        "EMIT": "unexpected print operator `::`; use it as a statement, not as a value",
        "COLON": "unexpected `:`; use `:` alone as a statement to return the current local scope",
        "RPAREN": "unexpected `)`",
        "RBRACKET": "unexpected `]`",
        "RBRACE": "unexpected `}`",
    }
    return descriptions.get(kind, "unexpected syntax where an expression should start")


def format_source_diagnostic(source: str, exc: VektorFlowError) -> str:
    """Format a user-facing error with source line and caret when location is known."""
    location = exc.location
    if location is None:
        return f"error: {exc.message}"
    lines = source.splitlines() or [source]
    line = lines[location.line - 1] if 1 <= location.line <= len(lines) else ""
    caret_col = max(1, location.column)
    if exc.message.startswith("unexpected indentation") and line[: max(0, caret_col - 1)].strip() == "":
        caret_col = 1
    caret = " " * (caret_col - 1) + "^"
    return f"error: {location}: {exc.message}\n{line}\n{caret}"


@dataclass(frozen=True)
class ErrorTypeValue:
    """Runtime-matchable error type value for ``errors.X`` arms."""

    name: str
    mask: int
    py_types: tuple[type[BaseException], ...] = ()

    def __repr__(self) -> str:
        return self.name

    def __str__(self) -> str:
        return self.name


class ControlFlow(Exception):
    """Non-local control transfer (internal to the interpreter)."""


class ReturnSignal(ControlFlow):
    def __init__(self, value: Any) -> None:
        self.value = value


class BreakSignal(ControlFlow):
    pass


class ContinueSignal(ControlFlow):
    pass


class ExitProgramSignal(ControlFlow):
    def __init__(self, code: int = 0) -> None:
        self.code = code


ERROR = ErrorTypeValue("ERROR", 0b1)
VEKTORFLOW_ERROR = ErrorTypeValue("VEKTORFLOW_ERROR", 0b11, (VektorFlowError,))
LEX_ERROR_TYPE = ErrorTypeValue("LEX_ERROR", 0b111, (LexError,))
PARSE_ERROR_TYPE = ErrorTypeValue("PARSE_ERROR", 0b1011, (ParseError,))
EVAL_ERROR_TYPE = ErrorTypeValue("EVAL_ERROR", 0b10011, (EvalError,))
PYTHON_ERROR = ErrorTypeValue("PYTHON_ERROR", 0b100001, (Exception,))
TYPE_ERROR_TYPE = ErrorTypeValue("TYPE_ERROR", 0b1100001, (TypeError,))
VALUE_ERROR_TYPE = ErrorTypeValue("VALUE_ERROR", 0b10100001, (ValueError,))
KEY_ERROR_TYPE = ErrorTypeValue("KEY_ERROR", 0b100100001, (KeyError,))
INDEX_ERROR_TYPE = ErrorTypeValue("INDEX_ERROR", 0b1000100001, (IndexError,))
FILE_NOT_FOUND_ERROR_TYPE = ErrorTypeValue("FILE_NOT_FOUND", 0b10000100001, (FileNotFoundError,))
RUNTIME_ERROR_TYPE = ErrorTypeValue("RUNTIME_ERROR", 0b100000100001, (RuntimeError,))

ERROR_NAMESPACE: dict[str, ErrorTypeValue] = {
    "ERROR": ERROR,
    "VEKTORFLOW_ERROR": VEKTORFLOW_ERROR,
    "LEX_ERROR": LEX_ERROR_TYPE,
    "PARSE_ERROR": PARSE_ERROR_TYPE,
    "EVAL_ERROR": EVAL_ERROR_TYPE,
    "PYTHON_ERROR": PYTHON_ERROR,
    "TYPE_ERROR": TYPE_ERROR_TYPE,
    "VALUE_ERROR": VALUE_ERROR_TYPE,
    "KEY_ERROR": KEY_ERROR_TYPE,
    "INDEX_ERROR": INDEX_ERROR_TYPE,
    "FILE_NOT_FOUND": FILE_NOT_FOUND_ERROR_TYPE,
    "RUNTIME_ERROR": RUNTIME_ERROR_TYPE,
}

_ERROR_TYPES_BY_SPECIFICITY: tuple[ErrorTypeValue, ...] = (
    LEX_ERROR_TYPE,
    PARSE_ERROR_TYPE,
    EVAL_ERROR_TYPE,
    FILE_NOT_FOUND_ERROR_TYPE,
    INDEX_ERROR_TYPE,
    KEY_ERROR_TYPE,
    VALUE_ERROR_TYPE,
    TYPE_ERROR_TYPE,
    RUNTIME_ERROR_TYPE,
    VEKTORFLOW_ERROR,
    PYTHON_ERROR,
    ERROR,
)


def error_type_for_exception(exc: BaseException) -> ErrorTypeValue:
    for err_type in _ERROR_TYPES_BY_SPECIFICITY:
        if err_type.py_types and isinstance(exc, err_type.py_types):
            return err_type
    return ERROR


def error_type_match_specificity(value: BaseException, pattern: ErrorTypeValue) -> int | None:
    actual = error_type_for_exception(value)
    if (actual.mask & pattern.mask) != pattern.mask:
        return None
    return pattern.mask.bit_count()
