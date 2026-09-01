# Python-Free Language String Primitives

Goal: self-hosted compiler source can lex VKF without Python string helpers.

This document defines the public cursor selected for
`compiler/self_hosted/lexer.vkf` and its private runtime seam. Viktor selected
API A on 2026-09-01: one `StringCursor(source)` value owns the source, current
position, EOF state, and scalar-safe peek, advance, and slice operations.

## Unit Model

Lexer cursor indexes are byte offsets into UTF-8 source.

Character predicates operate on Unicode scalar values returned by peek/advance.
ASCII-only token classes (`0`-`9`, `a`-`z`, `A`-`Z`, `_`, operators,
punctuation, newline, tab, space) must still be fast-pathable by byte.

Invalid UTF-8 is a hard lexer error with file, byte index, line, and column.

## Public StringCursor

```vkf
cursor: StringCursor(source)
cursor.eof
cursor.position
cursor.peek()
cursor: cursor.advance()
text: cursor.slice(start, stop)
```

`position`, `start`, and `stop` are UTF-8 byte offsets. `advance` returns the
next cursor value and never exposes scalar width to lexer code. `slice` accepts
only scalar boundaries. `peek` observes one complete Unicode scalar without
advancing. EOF is not a scalar, so callers check `cursor.eof` before `peek`.

The cursor also maintains 1-based line and column values for existing lexer
diagnostics. Advancing `"\n"` increments line and resets column to 1. Any other
Unicode scalar increments column once. Tabs remain one cursor column;
indentation measurement applies tab-stop rules separately.

## Private Runtime Primitives

These names are compiler/runtime implementation details, not additional public
cursor APIs:

- `vkf_string_eof(source:str, byte_index:num) -> bool`: true when byte index is
  at or past byte length.
- `vkf_string_peek_scalar(source:str, byte_index:num) -> str`: return Unicode
  scalar at byte index without advancing; error on invalid UTF-8 or mid-scalar
  index.
- `vkf_cursor_advance_scalar(cursor:StringCursor) -> StringCursor`: validate
  one complete scalar and atomically update position, EOF, line, and column.
- `vkf_utf8_slice(source:str, start_byte:num, stop_byte:num) -> str`:
  return substring for byte range; error if either boundary splits a scalar.

## Cursor Rules

`StringCursor.position` is a byte offset. Cursor line and column are 1-based.

line and column updates are part of cursor advance.

Advancing `"\n"` increments line and resets column to 1. Advancing any other
Unicode scalar increments column by 1. Tabs do not expand in generic cursor
advance; indentation measurement applies tab-stop rules separately.

EOF is not a scalar. Peeking at EOF returns a diagnostic, not an empty string,
unless caller first checks `cursor.eof`.

## Lexer Mapping

- `cursor.eof` maps to `vkf_string_eof(cursor.source, cursor.position)`.
- `cursor.peek()` maps to
  `vkf_string_peek_scalar(cursor.source, cursor.position)`.
- `cursor.advance()` maps to `vkf_cursor_advance_scalar`, which updates position,
  EOF, line, and column together.
- `cursor.slice(start, stop)` maps to
  `vkf_utf8_slice(cursor.source, start, stop)`.
- Loops that consume identifiers, numbers, whitespace, and comments need
  source-level looping over repeated `peek` + predicate + `advance`.

## Performance Budget

For compiler-size sources, these primitives should keep lexing linear in input
bytes. Required targets:

- `vkf_string_eof`: O(1).
- `vkf_string_peek_scalar`: O(1) for ASCII, bounded by one UTF-8 scalar decode.
- `vkf_cursor_advance_scalar`: O(1), bounded by one UTF-8 scalar decode.
- `vkf_utf8_slice`: O(n) in slice byte length, no extra full-source scan.

Small-file lexer target remains under 250 ms as part of fresh compile budget.
