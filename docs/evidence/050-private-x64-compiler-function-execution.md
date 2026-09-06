# Source-responsive generated compiler-function execution

Baseline: bootstrap `c11a5b0d5c3853523fbcbe734e4eab92deb61092`.
This packet generates and executes a PE containing the actual compiler-source
function `_compile_locked_valid_source_graph`. It closes the earlier evidence
gap where the same semantic mutation was ignored because the fixture copied its
current executable. It is not yet a complete successor compiler or self-host.

## RED to GREEN

The prior source-response audit changed `sources.length()` to
`sources.length() + 1`, but copied successor executables continued reporting
11. The new producer reads no current executable and invokes no native process.
It structurally parses the function source, lowers its borrowed list and owned
record result, emits the exact native-compatible non-entry x64 body, links a
private list/result-context entry, and materializes the callable PE through the
existing runner template.

The entry allocates a valid 11-element empty-string list representation, passes
it through the native `r10` argument and `r11` result contexts, calls the
source-produced compiler function, frees both the returned owned list clone and
its input list, and returns `source_count` through the runner. Allocation,
release, and abort retain runtime ABI slots 8, 9, and 10.

Two unchanged-source productions are byte-identical and both execute with exit
0, empty stderr, and stdout `11`. The semantic `+ 1` mutation changes emitted
function and PE bytes and executes with stdout `12`. The producer source is
asserted free of `self_path`, `run_native`, and output-byte reads. Focused GREEN:
**1/1**, 11376.6989 ms. Exact function-byte parity plus execution: **2/2**,
24484.9276 ms.

## Regression

Expanded configured serial checkpoint: **29/29**, exit 0, 118819.1353 ms.
Generated compiler-function execution was 11052.3115 ms, function composition
13037.8267 ms, complete bundle 11501.4169 ms, and locked source graph
9059.3879 ms. Separate bundle repeat: **1/1**, exit 0, 11685.7642 ms total
(11597.8575 ms test). Timings are receipts, not performance claims.

No public syntax, semantics, API, schema, diagnostic, optimizer policy,
timeout, assertion, or fallback changed. Public artifacts remain untouched.

This is the first source-responsive execution of an actual generated compiler
function, but it does not emit another compiler. Vector-valued graph output,
general reachable compiler lowering/linking, successor compiler artifact
production, generated-compiler compilation, deterministic compiler fixed
point, broad parity, fallback removal, and exact I240 seed remain missing.
ADR-0005 acceptance stays conservatively 60% (delta 0).
