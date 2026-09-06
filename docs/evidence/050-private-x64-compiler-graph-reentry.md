# Owned compiler-graph vector reentry

Baseline: bootstrap `2e4fa29ac74f421e0f0a766d8f82e6ab51b2239d`.
This packet extends source-responsive execution of the actual compiler-source
function `_compile_locked_valid_source_graph`. It proves that the function's
vector-valued graph output is a live owned list and that the returned graph can
be used as the borrowed input to a second invocation of the same generated
function. It is not yet a complete successor compiler or self-host.

## RED to GREEN

The prior entry called the generated function once, observed only the numeric
`source_count` field, and freed the returned `sources` clone without inspecting
it. The entry now checks both returned list headers before continuing: the
pointer must be non-null and its cell count and capacity must both equal 22,
the two-cell representation of eleven strings. Any failed check calls runtime
ABI abort slot 10.

After the first checks, the entry preserves the returned owned vector, frees
the original input, passes that returned vector into a second call through the
native `r10` argument and `r11` result contexts, and repeats the structural
checks. Both owned generations are released through runtime ABI free slot 9.
Two independently recorded relative call relocations link to the same
source-produced compiler-function body.

Unchanged-source productions remain byte-identical. Both execute twice through
the compiler function with exit 0, empty stderr, and stdout `11`. The semantic
`sources.length() + 1` mutation changes emitted function and PE bytes and
executes with stdout `12`. The producer remains free of `self_path`,
`run_native`, and output-byte reads. Focused compiler-graph reentry GREEN:
**1/1**, 11888.1931 ms. Exact source-derived vector-function byte parity plus
source-graph digest checks: **3/3**, 13968.8785 ms for parity and 14163.0414 ms
total.

## Boundary

Expanded configured serial checkpoint: **29/29**, exit 0, 127216.1741 ms.
Compiler-graph reentry was 11730.5943 ms, function composition 13575.2281
ms, exact vector-function parity 14173.7416 ms, and locked source graph
9641.8871 ms. Separate bundle repeat: **1/1**, exit 0, 12694.2275 ms total
(12603.5719 ms test). Timings are receipts, not performance claims.

No public syntax, semantics, API, schema, diagnostic, optimizer policy,
timeout, assertion, or fallback changed. Regenerated browser artifacts retained
their expected generated identities (`2bb78c97eb9ac347922b69edd4e1808c83597ffb7094c1b7ea9c1da9e028e817`
WASM and `c342e0e1b1500b8d55d7b86e63cdb8f4ef8031257c789cb2416edbec25f6cc41`
manifest), then the tracked public artifacts were restored unchanged.

This closes only owned compiler-graph vector validation and generated-function
reentry. General reachable compiler lowering/linking, successor compiler
artifact production, generated-compiler compilation, deterministic compiler
fixed point, broad parity, fallback removal, and the exact I240 seed remain
missing. ADR-0005 acceptance stays conservatively 60% (delta 0).
