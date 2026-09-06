# General tagged AST blocks into typed lowering

Baseline: bootstrap `31da4c2593c087630771ad205eab742dd466416e`.

This tracer advances the one-argument general tagged module cursor from
statement facts to explicit AST node/block arenas and a general typed-module
view. Import, function header, nested expression body, and output statements
all cross the same interfaces despite their different token shapes and lengths.

## RED to GREEN

The public strict CLI test first required missing AST, block, and typed-module
constructors. RED was **0/1**, exit 1, 1808.8436 ms, at the existing direct-call
boundary:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

GREEN adds `TaggedCursorAstModule`, concrete node access, and an explicit block
arena. Block assembly discovers every unique parent from the general
indentation links; it does not branch on fixture token counts or add a parser
overload. The canonical function block owns statement order `1`, contains
direct child order `2`, and retains exact span `3:5-3:13`.

`typed_tagged_cursor_ast_module` consumes only concrete source, node, block,
count, and span fields across the module seam. Its node accessor maps all
currently classified statement kinds to established typed-IR statement kinds:
imports and bindings become `store_binding`, functions remain `function`, and
expressions and outputs become `expr_stmt`. Source order, parent order, and
exact spans survive lowering. The uniform arenas avoid heterogeneous `any`
storage; unresolved expression types remain explicitly `any` pending general
expression lowering. Existing diagnostics are unchanged.

Focused GREEN passed **1/1**, exit 0, 4469.3827 ms. All real-cursor tests passed
**3/3**, exit 0, 9285.8087 ms.

## Regression

The locked serial checkpoint passed **32/32**, exit 0, 155673.5288 ms. It
includes the private parser/type/Machine-IR/x64 chain, source graph identities,
both bundle gates, Stage 2 artifact production, and locked Stage 2 source-graph
fixed point. A separate full-bundle repeat passed **1/1**, exit 0,
12297.0787 ms. `git diff --check` passed.

No public language, syntax, semantics, API, ABI, schema, diagnostic, fallback,
timeout, assertion, or optimizer policy changed. Browser artifacts were not
deployed.

This closes structural per-kind AST/block assembly and general typed statement
lowering. Per-kind token payload decoding, general expression typing, JSON
decoding, successor compiler production, generated-compiler fixed point,
fallback removal, and exact I240 seed remain open. ADR-0005 stays conservatively
60% (delta 0).
