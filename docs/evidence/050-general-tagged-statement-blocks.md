# General tagged statement kinds and block nesting

Baseline: bootstrap `d272636c949798e2b2ea708a5965c8e77cd1a1b3`.

This tracer deepens the same one-argument `TaggedTapeParseCursor` module path.
Each statement arena row now carries an internal statement-kind code, nesting
depth, and parent statement order in addition to its token range and exact
span. It adds no fixed-token or example-specific parser overload.

## RED to GREEN

The strict CLI test first demanded statement kinds and nesting from the general
cursor module. RED was **0/1**, exit 1, 1883.576 ms, with the exact missing
projection diagnostic:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: unknown machine IR aggregate projection import_statement.kind in 12[order:1,span:8,token_count:1,token_start:1,token_stop:1]
```

GREEN classifies statement shape from its first, second, and last token kinds;
it does not depend on fixed token counts. The parser resolves each statement's
parent by walking backward to the nearest prior statement with a lower starting
column. This represents arbitrary dedent and deeper nesting in the same uniform
ten-cell numeric arena without routing heterogeneous AST values through `any`.

The canonical module proves top-level `import`, `function`, and `output`
statements at depth zero with parent `-1`, plus its `expression` body at depth
one with function order `1` as parent. Original source order, token counts, and
spans remain exact. Existing numeric-function validation, typed lowering, and
diagnostic text are unchanged. Focused GREEN passed **1/1**, exit 0,
3357.2311 ms. All real-cursor tests passed **3/3**, exit 0, 8198.2855 ms.

## Regression

The locked serial checkpoint passed **32/32**, exit 0, 154905.5694 ms. It
includes the private parser/type/Machine-IR/x64 chain, source graph identities,
both bundle gates, Stage 2 artifact production, and locked Stage 2 source-graph
fixed point. A separate full-bundle repeat passed **1/1**, exit 0,
12104.0834 ms. `git diff --check` passed.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed. Browser artifacts were not
deployed.

This closes generic statement-kind and indentation-parent facts. Concrete
per-kind AST node construction and block assembly, general typed lowering, JSON
decoding, successor compiler production, generated-compiler fixed point,
fallback removal, and exact I240 seed remain open. ADR-0005 stays conservatively
60% (delta 0).
