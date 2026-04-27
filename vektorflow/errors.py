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
