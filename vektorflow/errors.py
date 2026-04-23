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
