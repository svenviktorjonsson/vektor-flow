# Python-Free Language String Primitives

Goal: self-hosted compiler source can lex VKF without Python string helpers.

This document defines the minimum string and character primitive set needed by
`compiler/self_hosted/lexer.vkf`. It is a language/runtime contract, not an
implementation plan for this slice.

## Unit Model

Lexer cursor indexes are byte offsets into UTF-8 source.

Character predicates operate on Unicode scalar values returned by peek/advance.
ASCII-only token classes (`0`-`9`, `a`-`z`, `A`-`Z`, `_`, operators,
punctuation, newline, tab, space) must still be fast-pathable by byte.

Invalid UTF-8 is a hard lexer error with file, byte index, line, and column.

## Required Primitives

- `vkf_string_byte_len(source:str) -> num`: return source length in bytes.
- `vkf_string_eof(source:str, byte_index:num) -> bool`: true when byte index is
  at or past byte length.
- `vkf_string_peek_scalar(source:str, byte_index:num) -> str`: return Unicode
  scalar at byte index without advancing; error on invalid UTF-8 or mid-scalar
  index.
- `vkf_string_scalar_width(source:str, byte_index:num) -> num`: return byte
  width of scalar at byte index.
- `vkf_string_slice_bytes(source:str, start_byte:num, stop_byte:num) -> str`:
  return substring for byte range; error if either boundary splits a scalar.
- `vkf_cursor_advance_scalar(cursor:Cursor) -> Cursor`: move by one scalar,
  updating byte index, line, and column.

## Cursor Rules

`Cursor.index` is a byte offset. `Cursor.line` and `Cursor.column` are 1-based.

line and column updates are part of cursor advance.

Advancing `"\n"` increments line and resets column to 1. Advancing any other
Unicode scalar increments column by 1. Tabs do not expand in generic cursor
advance; indentation measurement applies tab-stop rules separately.

EOF is not a scalar. Peeking at EOF returns a diagnostic, not an empty string,
unless caller first checks `vkf_string_eof`.

## Lexer Mapping

- `eof(cursor)` maps to `vkf_string_eof(cursor.source, cursor.index)`.
- `peek(cursor)` maps to `vkf_string_peek_scalar(cursor.source, cursor.index)`.
- `advance(cursor)` maps to `vkf_cursor_advance_scalar(cursor)`.
- Token text capture maps to `vkf_string_slice_bytes(source, start.index, stop.index)`.
- Loops that consume identifiers, numbers, whitespace, and comments need
  source-level looping over repeated `peek` + predicate + `advance`.

## Performance Budget

For compiler-size sources, these primitives should keep lexing linear in input
bytes. Required targets:

- `vkf_string_eof`: O(1).
- `vkf_string_peek_scalar`: O(1) for ASCII, bounded by one UTF-8 scalar decode.
- `vkf_string_scalar_width`: O(1), bounded by one UTF-8 scalar decode.
- `vkf_string_slice_bytes`: O(n) in slice byte length, no extra full-source scan.
- `vkf_cursor_advance_scalar`: O(1), bounded by one UTF-8 scalar decode.

Small-file lexer target remains under 250 ms as part of fresh compile budget.
