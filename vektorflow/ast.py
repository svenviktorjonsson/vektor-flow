"""Abstract syntax tree for Vektor Flow (phase-1 interpreter subset)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Union

Expr = Any  # forward


@dataclass
class NumberLit:
    value: float


@dataclass
class BoolLit:
    value: bool


@dataclass
class StringLit:
    value: str
    #: True for ``'...'`` (literal ``$`` / ``\``; no ``$name`` / ``$(...)`` processing).
    raw: bool = False


@dataclass
class Ident:
    name: str


@dataclass
class TupleLit:
    elements: list[Any]
    axis_tag: str | None = None  # fast path: ``(1,2)_i`` only — not struct literals


@dataclass
class ListLit:
    elements: list[Any]
    axis_tag: str | None = None  # ``[1,2]_i`` — not ``(x:1)`` structs


@dataclass
class VectorRepeat:
    """Inside ``[…]``: ``value : count`` repeats ``value`` ``count`` times (``count`` ≥ 0, integer)."""

    value: Any
    count: Any


@dataclass
class MsetSpill:
    """Inside ``[…]``: leading ``:expr`` — multiset ``expr`` expands to repeated elements (multiplicity preserved)."""

    expr: Any


@dataclass
class UnaryOp:
    op: str
    operand: Any


@dataclass
class BinOp:
    op: str
    left: Any
    right: Any


@dataclass
class PipeChain:
    """``src >> rhs1 >> rhs2`` — **pipe**: one value at a time through each segment (streaming).

    This is the usual way to express “for each” / iteration; use ``@>`` / ``@|`` inside
    a pipe segment to continue or break that stream. Switches use ``expr?`` instead.
    """

    source: Any
    segments: list[Any]  # each: expression or :class:`Block` from pipe RHS


@dataclass
class MultisetLit:
    """Multiset literal ``{value:count, ...}`` — counts are positive integers."""

    pairs: list[tuple[Any, Any]]
    axis_tag: str | None = None  # ``{1:2}_ij``


@dataclass
class Lambda:
    """Anonymous function ``($(x, y): expr)`` — parameters are names only."""

    params: list[str]
    body: Any


@dataclass
class OpRef:
    """Reference to an overloaded operator symbol (``+``, ``/\\``, …) for calls like ``+(2, 3)``."""

    symbol: str


@dataclass
class Call:
    func: Any
    args: list[Any]


@dataclass
class NamedCallArg:
    """Call argument ``name: value`` (e.g. ``map(x:3, y:4)``)."""

    name: str
    value: Any


@dataclass
class SpreadArg:
    """Call argument ``:expr`` — expand iterable into the callee (e.g. ``list(:data)``)."""

    expr: Any


@dataclass
class Attribute:
    value: Any
    name: str


@dataclass
class DottedIndex:
    """``base.(i, j, ...)`` — reach into list/tuple/str/struct (`.` is the reach-in operator)."""

    base: Any
    indices: list[Any]


@dataclass
class AbsExpr:
    inner: Any


@dataclass
class DotModulePath:
    """Relative import from cwd: ``.math``, ``.pkg.mod``, ``.\"file.vkf\"``."""

    segments: list[str]


@dataclass
class RangeExpr:
    """``a..b`` (both ends), ``..b`` (``a`` implicit 0), ``a..`` (lazy infinite), ``..`` (lazy from 0)."""

    start: Any | None
    end: Any | None


@dataclass
class StdinPipe:
    """Leading ``>> expr`` (no value on the left of ``>>``) — read one line from stdin; that string is ``$`` in ``expr`` (console input)."""

    expr: Any


@dataclass
class StructIdentity:
    """Expression ``:`` — evaluates to the current local scope as a record (field names → values)."""


@dataclass
class StructLit:
    fields: list[tuple[str, Any]]


@dataclass
class TypeExpr:
    """Record type shape ``(x:num, y:num)`` for interfaces."""

    fields: list[tuple[str, Any]]  # second: primitive name or nested FuncType


@dataclass
class PrimTypeRef:
    """Single primitive or named type in a function domain, e.g. ``num`` in ``num -> num``."""

    name: str


@dataclass
class TupleTypeExpr:
    """Positional product in a function domain, e.g. ``(num, num)`` in ``(num,num) -> num``."""

    elements: list[str]


@dataclass
class FuncType:
    """Function type: ``domain -> codomain`` (arrows only in type definitions)."""

    domain: Any  # PrimTypeRef | TupleTypeExpr | TypeExpr
    codomain: Any  # str (primitive) or nested FuncType for ``num -> num -> num``


@dataclass
class Param:
    name: str
    type_name: str | None = None
    param_func_type: FuncType | None = None  # ``f:num->num`` — function parameter


Stmt = Any


@dataclass
class Bind:
    target: Any  # Ident, Attribute, or DottedIndex
    value: Any


@dataclass
class Emit:
    """Legacy stdout emit; prefer :class:`StdioPrint`."""

    value: Any
    to_file: Any | None = None


@dataclass
class StdioPrint:
    """``:: expr`` — print to stdout.

    A trailing newline is added unless the stringified value already ends with
    ``\\n`` (e.g. ``$ & "\\n"`` or a string literal that ends with ``\\n``), so you
    can control line endings explicitly in tight loops.

    ``::: expr`` is syntactic sugar for printing ``expr`` as a line (same as
    ``:: (expr & "\\n")`` / ``::"$a\\n"``-style output when ``expr`` is ``a``).
    """

    value: Any


@dataclass
class SpillImport:
    """``: .path`` — load module (``.vkf`` / folder / stdlib) and merge exports into current scope."""

    path: Any  # DotModulePath


@dataclass
class StdioReadLine:
    """``name ::`` — read one line from stdin into ``name``."""

    target: Any  # Ident


@dataclass
class StdioPrompt:
    """``name:::` — print ``name: `` then read one line (prompted stdin)."""

    target: Any  # Ident


@dataclass
class FuncDefStdin:
    """``f(x):::`` or ``f(x) ::`` — read function body line from stdin."""

    name: str
    params: list[Param]
    interactive_prompt: bool  # ``:::`` shows ``f(x): ``; ``::`` does not


@dataclass
class FuncDef:
    name: str
    params: list[Param]
    body: Union[Any, "Block"]
    func_type: FuncType | None = None


@dataclass
class TypeOf:
    """``expr.`` — type of ``expr`` (suffix dot with no field/index)."""

    value: Any


@dataclass
class ExprStmt:
    expr: Any


@dataclass
class ContinueStmt:
    """``@>`` — continue the innermost ``>>`` **pipe** iteration.

    In a **switch** (``expr?`` …), a trailing ``@>`` on an arm (``=> @>`` or the last
    line of the arm) **re-enters** that switch: the discriminant is evaluated again
    from the top. That is the same switch form used for conditionals and
    multi-way dispatch; ``@>`` here means “run the switch again”, not a pipe
    continue (see ``PipeChain`` / ``>>``).
    """

    pass


@dataclass
class BreakStmt:
    """``@|`` — break out of the innermost ``>>`` **pipe** iteration."""

    pass


@dataclass
class ExitProgramStmt:
    """``@!`` — exit the host process."""

    pass


@dataclass
class ReturnStmt:
    """``@:`` expr or bare ``@:`` — early return from innermost callable.

    Compact implicit return: only the last statement at *function body* scope (not the last
    row inside a nested block) may be a plain expression whose value is
    the result without ``@:``.
    """

    value: Any | None


@dataclass
class ReturnEmitStmt:
    """``@:: expr`` — print (like ``::``) then return that value from the innermost callable."""

    value: Any


@dataclass
class MatchArm:
    """One branch in an ``expr?`` block: ``condition? body`` or a default arm.

    ``condition`` is ``None`` for a default / else arm (write ``? body`` or a bare
    ``body`` after ``;``). Otherwise the arm runs when ``discriminant = condition``
    (equality). The subject is also available as ``$`` while choosing and running arms.
    """

    condition: Any | None
    body: Any


@dataclass
class MatchStmt:
    """**Switch** — ``discriminant?`` then arms ``cond? body``, ``? default``, or bare ``else`` body.

    Branching uses only ``?`` (no ``=>``). When a :class:`MatchStmt` appears as an
    expression, the matched arm’s value is returned; as a statement, only effects run.
    """

    discriminant: Any
    arms: list[MatchArm]


@dataclass
class Block:
    statements: list[Any] = field(default_factory=list)


@dataclass
class Module:
    statements: list[Any] = field(default_factory=list)
