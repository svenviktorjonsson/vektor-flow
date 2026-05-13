"""Minimal expression parser for tests and early REPL: ``|x|``, calls, vectors.

Full Vektor Flow will replace this with the real grammar; this subset exists so
``|expr|`` and ``math.*`` can be exercised from Python tests.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .errors import ParseError, describe_unexpected_expression_token
from .lexer import tokenize
from .runtime.absnorm import abs_or_norm
from .tokens import (
    BAR,
    CARET,
    COMMA,
    DEDENT,
    EOF,
    IDENT,
    INDENT,
    LBRACKET,
    LPAREN,
    MINUS,
    NEWLINE,
    NUMBER,
    PERCENT,
    PLUS,
    RPAREN,
    RBRACKET,
    SLASH,
    STAR,
    Token,
)


@dataclass
class NumberNode:
    value: float


@dataclass
class VectorNode:
    elements: list[Any]


@dataclass
class NameNode:
    name: str


@dataclass
class CallNode:
    name: str
    args: list[Any]


@dataclass
class BinOpNode:
    op: str
    left: Any
    right: Any


@dataclass
class UnaryMinusNode:
    child: Any


@dataclass
class AbsNode:
    inner: Any


def _filter_tokens(toks: list[Token]) -> list[Token]:
    return [
        t
        for t in toks
        if t.kind not in (NEWLINE, INDENT, DEDENT, EOF)
    ]


class _Parser:
    def __init__(self, toks: list[Token]) -> None:
        self.toks = toks
        self.i = 0

    def _peek(self) -> str:
        if self.i >= len(self.toks):
            return EOF
        return self.toks[self.i].kind

    def _next(self) -> Token:
        if self.i >= len(self.toks):
            raise ParseError("unexpected end of input")
        t = self.toks[self.i]
        self.i += 1
        return t

    def parse(self) -> Any:
        n = self.parse_expr()
        if self._peek() != EOF:
            raise ParseError("trailing tokens after expression")
        return n

    def parse_expr(self) -> Any:
        return self.parse_additive()

    def parse_additive(self) -> Any:
        left = self.parse_multiplicative()
        while self._peek() in (PLUS, MINUS):
            op = self._next().kind
            right = self.parse_multiplicative()
            left = BinOpNode(op, left, right)
        return left

    def parse_multiplicative(self) -> Any:
        left = self.parse_power()
        while self._peek() in (STAR, SLASH, PERCENT):
            op = self._next().kind
            right = self.parse_power()
            left = BinOpNode(op, left, right)
        return left

    def parse_power(self) -> Any:
        left = self.parse_unary()
        if self._peek() == CARET:
            self._next()
            right = self.parse_power()
            return BinOpNode(CARET, left, right)
        return left

    def parse_unary(self) -> Any:
        if self._peek() == MINUS:
            self._next()
            return UnaryMinusNode(self.parse_unary())
        if self._peek() == BAR:
            self._next()
            inner = self.parse_expr()
            if self._peek() != BAR:
                raise ParseError("expected '|' to close absolute value")
            self._next()
            return AbsNode(inner)
        return self.parse_primary()

    def parse_primary(self) -> Any:
        k = self._peek()
        if k == NUMBER:
            return NumberNode(float(self._next().value))
        if k == LBRACKET:
            self._next()
            els: list[Any] = []
            if self._peek() != RBRACKET:
                while True:
                    els.append(self.parse_expr())
                    if self._peek() == COMMA:
                        self._next()
                        continue
                    break
            if self._peek() != RBRACKET:
                raise ParseError("expected ']' to close vector literal")
            self._next()
            return VectorNode(els)
        if k == LPAREN:
            self._next()
            inner = self.parse_expr()
            if self._peek() != RPAREN:
                raise ParseError("expected ')'")
            self._next()
            return inner
        if k == IDENT:
            name = str(self._next().value)
            if self._peek() == LPAREN:
                self._next()
                args: list[Any] = []
                if self._peek() != RPAREN:
                    while True:
                        args.append(self.parse_expr())
                        if self._peek() == COMMA:
                            self._next()
                            continue
                        break
                if self._peek() != RPAREN:
                    raise ParseError("expected ')' after arguments")
                self._next()
                return CallNode(name, args)
            return NameNode(name)
        raise ParseError(describe_unexpected_expression_token(k))


def parse_expression(source: str, *, filename: str = "<expr>") -> Any:
    toks = _filter_tokens(tokenize(source, filename=filename))
    return _Parser(toks).parse()


def eval_expression(source: str, env: dict[str, Any] | None = None) -> Any:
    """Parse and evaluate a single expression string.

    The ``math`` stdlib namespace is merged first; ``env`` entries override it.
    """
    from vektorflow.stdlib.math import build_math_namespace

    merged = {**build_math_namespace(), **(env or {})}
    ast = parse_expression(source)
    return eval_ast(ast, merged)


def eval_ast(node: Any, env: dict[str, Any]) -> Any:
    if isinstance(node, NumberNode):
        return node.value
    if isinstance(node, NameNode):
        if node.name not in env:
            raise NameError(node.name)
        return env[node.name]
    if isinstance(node, VectorNode):
        return [eval_ast(e, env) for e in node.elements]
    if isinstance(node, UnaryMinusNode):
        return -eval_ast(node.child, env)
    if isinstance(node, AbsNode):
        return abs_or_norm(eval_ast(node.inner, env))
    if isinstance(node, CallNode):
        fn = env.get(node.name)
        if fn is None or not callable(fn):
            raise NameError(f"callable {node.name!r} not in environment")
        args = [eval_ast(a, env) for a in node.args]
        return fn(*args)
    if isinstance(node, BinOpNode):
        a = eval_ast(node.left, env)
        b = eval_ast(node.right, env)
        if node.op == PLUS:
            return a + b
        if node.op == MINUS:
            return a - b
        if node.op == STAR:
            return a * b
        if node.op == SLASH:
            return a / b
        if node.op == PERCENT:
            return a % b
        if node.op == CARET:
            return a**b
        raise RuntimeError(f"unknown binop {node.op!r}")
    raise TypeError(f"unknown AST node {type(node)!r}")
