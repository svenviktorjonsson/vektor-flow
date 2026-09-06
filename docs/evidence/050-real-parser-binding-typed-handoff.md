# Real parser numeric-binding typed handoff

Baseline: bootstrap `1b12764ec93d9a8452d2253e8109b762a53ce9ac`.
This tracer extends the real self-hosted `parse_module_from_cursor` path from
the expression `alpha+42` to the statement `answer:42`. The strict compiler CLI
executes IDENT, COLON, NUMBER, and newline tagged cursors through a concrete
bind AST and typed `store_binding`, preserving source order, value `42`, and
the exact `1:1` through `1:8` span.

## RED to GREEN

The public strict CLI test first called the missing four-cursor parser overload.
RED was **0/1**, exit 1, 1115.5811 ms total, with the exact existing overload
diagnostic naming only the established three-cursor and legacy one-cursor
candidates.

GREEN adds a bounded binding token producer, one concrete
`parse_module_from_cursor` overload, and one concrete typed binding adapter.
The existing parser overloads, legacy JSON entry, public syntax, and serialized
typed-IR schema remain unchanged. The parser validates IDENT/COLON/NUMBER/
NEWLINE tags before constructing the binding. Focused numeric-binding GREEN:
**1/1**, exit 0, 2451.7706 ms. Both real-cursor tracers passed **2/2**, exit 0,
8780.2792 ms.

## Regression

Related lexer/parser/typed-IR gates passed **7/7**, exit 0, 14811.4588 ms.
Expanded configured checkpoint, including the prior 30 tests and this new
behavior, passed **31/31**, exit 0, 140680.0992 ms. That run includes the full
bundle and locked Stage2 source-graph fixed point. Separate full-bundle repeat
passed **1/1**, exit 0, 15282.0842 ms. `git diff --check` passed.

No public language, API, ABI, schema, diagnostic, fallback, timeout, assertion,
or optimizer policy changed. Browser artifacts were not deployed.

This closes one heterogeneous binding AST/typed-IR tracer. Multi-statement
heterogeneous module accumulation, general cursor iteration, JSON decoding,
string/bool/null bindings, generic AST replacement, successor compiler
production, generated-compiler fixed point, fallback removal, and exact I240
seed remain open. ADR-0005 stays conservatively 60% (delta 0).
