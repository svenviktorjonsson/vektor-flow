# Real parser cursor to concrete typed IR

Baseline: bootstrap `f1593ba3362710a7cd3d36046cab88b3be944b56`.
This tracer enters the existing public strict compiler CLI with `alpha+42`,
then executes the real self-hosted `parse_module_from_cursor` overload. It
preserves the identifier text, PLUS punctuation, numeric value, and exact
`1:1` through `1:7` source span into one concrete internal typed-IR value.
It is not a complete parser, typed lowerer, successor compiler, or self-host.

## RED to GREEN

The first test compiled a harness through `vkf-strict -b` and demanded the
parsed expression through the existing generic `ParseCursor`. RED was **0/1**,
exit 1, 2196.2411 ms total, with the existing diagnostic:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: machine IR supports direct calls only
```

Removing the initially absent typed adapter exposed the precise representation
barrier:

```text
<driver-smoke>:1:1: direct x64 backend unsupported: unknown machine IR aggregate projection expression.left.name in 1[]
```

`ParseCursor.tokens:any` had erased the heterogeneous token value layout before
direct lowering. GREEN keeps the existing one-argument `ParseCursor` interface
unchanged and adds an overload over the already-established concrete
`TaggedParseCursor` representation. The overload validates the exact
IDENT/PLUS/NUMBER tags and constructs the existing concrete one-statement AST.
The parser result constructor now retains its concrete body layout instead of
passing it through generic `module_node(body:any)`.

The typed-IR adapter accepts only concrete primitive fields across the module
seam, because VKF module-owned record types are nominal. It returns concrete
load/constant nodes plus the exact source span; no serialized public typed-IR
schema changes. Focused hardened GREEN: **1/1**, exit 0, 2367.4816 ms total.

## Regression

Related parser/typed-IR gates passed **6/6**, exit 0, 9778.9048 ms. Expanded
configured post-hardening serial checkpoint passed **30/30**, exit 0,
138112.3701 ms. Source
graph, full bundle, and locked Stage2 fixed point passed **4/4**, exit 0,
27656.6194 ms after the final source hashes were installed. A separate earlier
unchanged full-bundle repeat passed **1/1**, exit 0, 12559.0699 ms.

No public syntax, semantics, API, schema, diagnostic, ABI, optimizer policy,
timeout, assertion, or fallback changed. The generic JSON decoder and
one-argument parser seed remain unchanged. Browser artifacts were not deployed.

This closes one concrete IDENT/PLUS/NUMBER cursor-to-typed-IR tracer. General
statement iteration, JSON decoding, heterogeneous string/bool/null literals,
generic AST replacement, reachable compiler lowering/linking, successor
compiler production, generated-compiler fixed point, fallback removal, and the
exact I240 seed remain open. ADR-0005 stays conservatively 60% (delta 0).
