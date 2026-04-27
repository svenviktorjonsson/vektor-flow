# Native Core Contract

The long-term goal is:

`vkf source -> native frontend -> IR -> C++ -> binary`

with **no Python dependency** required to build or run the core language.

Today, Python is still the frontend host, but this document defines the slice we
are actively pushing toward that end state.

For the runtime/UI de-Pythonization inventory and extraction order, see
[`PYTHON_DEPENDENCY_AUDIT.md`](./PYTHON_DEPENDENCY_AUDIT.md).

## Contract

A program is in the **native core** when all of the following are true:

- it parses with the reference frontend
- it compiles with `vkf build`
- the produced executable runs without Python at runtime
- interpreter output and native output match

The current proving examples live in:

- `examples/native_core/`

## Included Today

- scalar arithmetic and direct printing
- typed binds
- functions with typed params / returns
- fixed vectors with symbolic sizes
- fused vector arithmetic in the compiled subset
- records / structural values in the compiled subset
- multisets in the compiled subset
- `?`, `??`, `?>`, `??>`, `@`, `@>`, `@|`
- bitmask match specificity
- portable numeric intrinsics compiled from:
  - `math.*`
  - `stat.*`

## Explicitly Not Yet the Full Standalone Story

These still depend on Python-hosted infrastructure today:

- lexer
- parser
- AST / IR construction
- most stdlib host integration
- UI host plumbing

## Frontend Extraction Plan

The current sequence is:

1. expand the buildable native-core slice
2. freeze stable interchange boundaries
3. replace Python frontend pieces one by one

Current boundary work:

- stable token-stream JSON payload
- parser entrypoint from pre-tokenized streams

Next frontend pieces to remove from Python:

1. lexer
2. parser
3. IR serialization / loading

## Why This Contract Exists

Without a narrow contract, "Python-free" turns into a fuzzy aspiration. This
document keeps us honest:

- if an example belongs to `examples/native_core/`, it should build
- if it builds, the executable should run without Python
- if it does not fit yet, it belongs somewhere else until we expand the core
