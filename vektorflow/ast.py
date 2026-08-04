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
class NullLit:
    pass


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


@dataclass
class ListLit:
    elements: list[Any]


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
class DerivativeExpr:
    """Symbolic derivative suffix, e.g. ``f'(x)``, ``f'phi(phi)``, ``f''xy(x, y)``."""

    expr: Any
    variables: list[Any]
    call_args: list[Any] | None = None


@dataclass
class PipeChain:
    """``src >> rhs1 >> rhs2`` — **pipe**: one value at a time through each segment (streaming).

    This is the usual way to express “for each” / iteration; use ``@|`` inside
    a pipe segment to break that stream.
    """

    source: Any
    segments: list[Any]  # each: expression or :class:`Block` from pipe RHS


@dataclass
class MultisetLit:
    """Multiset literal ``{value:count, ...}`` — counts are positive integers."""

    pairs: list[tuple[Any, Any]]


@dataclass
class MultisetFromValues:
    """Inside ``{}``: leading ``:expr`` — spill a compatible container into a multiset literal."""

    expr: Any


@dataclass
class AxisAlign:
    """Axis tagging via tight ``->`` (same adjacency rules as ``.``).

    Exactly one of ``label`` or ``indices`` is set. ``label`` is the raw identifier
    text after ``->`` (never a variable lookup), so ``->ij`` tags as ``ij`` even if
    ``ij`` is bound. ``indices`` is ``->(...)`` / ``->.$`` / ``->.0`` shapes like dotted
    access; expressions are evaluated to a single axis key string.
    """

    value: Any
    label: str | None = None
    indices: list[Any] | None = None


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
class RaiseExpr:
    """``expr!`` — evaluate ``expr`` and raise the resulting error value."""

    value: Any


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
class TypeSizeConst:
    value: int


@dataclass
class TypeSizeVar:
    name: str


@dataclass
class TypeSizeBinOp:
    op: str
    left: Any
    right: Any


@dataclass
class PrimTypeRef:
    """Single primitive or named type in a function domain, e.g. ``num`` in ``num -> num``."""

    name: str


@dataclass
class SymbolicDomainType:
    """Mathematical symbolic domain type, e.g. ``R`` / ``N`` / ``Z`` / ``Q`` / ``C``."""

    name: str


@dataclass
class TypePowerExpr:
    """Power type expression, e.g. ``L^2`` for a scalar dimension power."""

    base: Any
    exponent: Any


@dataclass
class TypeDomainBinOp:
    """Dimension/domain algebra inside type syntax, e.g. ``M*L/T^2``."""

    op: str
    left: Any
    right: Any


@dataclass
class SymbolicValueType:
    """Compile-time type for a symbolic value with a mathematical domain."""

    domain: Any | None = None


@dataclass
class TypeUnionExpr:
    """Type union ``A|B``."""

    members: list[Any]


@dataclass
class TypeIntersectionExpr:
    """Type intersection ``A&B``."""

    members: list[Any]


@dataclass
class TupleTypeExpr:
    """Positional product in a function domain, e.g. ``(num, num)`` in ``(num,num) -> num``."""

    elements: list[Any]


@dataclass
class FixedVectorType:
    """Fixed-size vector type ``[T:n]`` with symbolic or integer size."""

    element_type: Any
    size: Any


@dataclass
class MultisetType:
    """Homogeneous multiset type ``{T}``."""

    element_type: Any


@dataclass
class MapValueType:
    """Inferred dynamic map value type from ``map(...)`` stdlib ctor usage."""

    fields: list[tuple[str, Any]]


@dataclass
class LinkedListValueType:
    """Inferred dynamic linked-list value type from ``list(...)`` stdlib ctor usage."""

    elements: list[Any]


@dataclass
class NamedTypeSpec:
    """Named type slot such as ``x:[num:n+1]`` in a return annotation."""

    name: str
    type_expr: Any


@dataclass
class FuncType:
    """Function type: ``domain -> codomain`` (arrows only in type definitions)."""

    domain: Any  # PrimTypeRef | TupleTypeExpr | TypeExpr | FixedVectorType
    codomain: Any  # type node or nested FuncType


@dataclass
class Param:
    name: str
    type_name: str | None = None
    param_func_type: FuncType | None = None  # ``f:num->num`` — function parameter
    type_ref: Any | None = None
    default_expr: Any | None = None
    variadic_positional: bool = False
    variadic_named: bool = False


Stmt = Any


@dataclass
class Bind:
    target: Any  # Ident, Attribute, or DottedIndex
    value: Any
    declared_type: Any | None = None
    docstring: str | None = field(default=None, repr=False)


@dataclass
class BindExpr(Bind):
    """Parenthesized binding expression ``(name: value)``."""


@dataclass
class Emit:
    """Legacy stdout emit; prefer :class:`StdioPrint`."""

    value: Any
    to_file: Any | None = None


@dataclass
class StdioPrint:
    """``:: expr`` — print to stdout with no implicit newline (exact stringified output)."""

    value: Any


@dataclass
class StdioLabelPrint:
    """``::: expr`` — print ``expr_text: value\\n`` for quick labeled inspection."""

    expr_text: str
    value: Any


@dataclass
class SpillImport:
    """``: .path`` — load module (``.vkf`` / folder / stdlib) and merge exports into current scope.
    If ``alias`` is set (e.g. ``time:.time``) the module is bound under that name only (no spill).
    If ``alias`` is None (plain ``:.path``) only exported names are spilled into the current scope."""

    path: Any        # DotModulePath
    alias: str | None = None  # e.g. "time" from ``time:.time``


@dataclass
class SpillValue:
    """``:expr`` — spill full object behavior and any visible fields into current local scope."""

    value: Any


@dataclass
class SpillExpr:
    """``(:expr)`` — materialize the spill result of ``expr`` as a scope record value."""

    value: Any


@dataclass
class ScopeExpr:
    """Scoped block expression — returns last row; lone ``:`` returns the local scope record."""

    body: "Block"


@dataclass
class StdioReadLine:
    """``name ::`` — read one line from stdin into ``name``."""

    target: Any  # Ident
    declared_type: Any | None = None


@dataclass
class StdioPrompt:
    """``name:::` — print ``name: `` then read one line (prompted stdin)."""

    target: Any  # Ident
    declared_type: Any | None = None


@dataclass
class FuncDefStdin:
    """``f(x):::`` or ``f(x) ::`` — read function body line from stdin."""

    name: str
    params: list[Param]
    interactive_prompt: bool  # ``:::`` shows ``f(x): ``; ``::`` does not


@dataclass
class EvalBind:
    """``name :: expr`` — evaluate source text/value and bind result to ``name``."""

    target: Any  # Ident
    source: Any
    declared_type: Any | None = None


@dataclass
class FuncDefSource:
    """``f(x) :: expr`` — compile function body from source text at runtime."""

    name: str
    params: list[Param]
    source: Any


@dataclass
class FuncDef:
    name: str
    params: list[Param]
    body: Union[Any, "Block"]
    func_type: FuncType | None = None
    docstring: str | None = field(default=None, repr=False)


@dataclass
class TypeOf:
    """``expr.`` — type of ``expr`` (suffix dot with no field/index)."""

    value: Any


@dataclass
class ExprStmt:
    expr: Any


@dataclass
class ContinueStmt:
    """``@>`` — continue the innermost loop / iteration."""

    pass


@dataclass
class BreakStmt:
    """``@|`` — break out of the innermost loop / iteration."""

    pass


@dataclass
class ExitProgramStmt:
    """``@!`` — exit the host process."""

    pass


@dataclass
class ReturnStmt:
    """``@`` / ``@:`` / ``@: expr`` — early return from innermost ``:`` scope.

    Compact implicit return: only the last statement at *function body* scope (not the last
    row inside a nested block) may be a plain expression whose value is
    the result without ``@``.
    """

    value: Any | None


@dataclass
class ReturnEmitStmt:
    """``@:: expr`` — print (like ``::``) then return that value from the innermost callable."""

    value: Any


@dataclass
class MatchArm:
    """One branch in an ``expr??`` switch: ``condition => body`` or bare ``=> body``.

    ``condition`` is ``None`` for the default arm (written as ``=>``). Otherwise the
    arm runs when ``discriminant = condition`` (equality). The subject is also available
    as ``$`` while choosing and running arms.
    """

    condition: Any | None
    body: Any


@dataclass
class MatchStmt:
    """**Switch/catch** — ``discriminant??`` or ``discriminant!?`` followed by arms."""

    discriminant: Any
    arms: list[MatchArm]
    loop: bool = False
    catch: bool = False


@dataclass
class ConditionalExpr:
    """Single-branch conditional: ``expr? body``."""

    condition: Any
    body: Any
    loop: bool = False


@dataclass
class AssertExpr:
    """``condition?!`` or ``condition?! message`` — fail if falsy."""

    condition: Any
    message: Any | None = None
    condition_text: str | None = None


@dataclass
class Block:
    statements: list[Any] = field(default_factory=list)


@dataclass
class Module:
    statements: list[Any] = field(default_factory=list)
