# Fixed vector and record spread parity — 2026-09-05

Base: dirty `main` at `67343be7e279c3e6ad65331df2490d7aa7605d2e`.
This packet extends the preceding numeric-variadic receipt. It does not claim
full call-suite or language coverage and has not been committed or deployed.

## RED → GREEN

The unchanged `_volume`, `fixed_vector_spread_binds_positional_parameters`,
`_point_sum` and `fixed_record_spread_binds_by_field_name` declarations/assertions
from `tests/vkf/calls.vkf` print `true\ntrue\n` natively. Before this packet,
WASM rejected the `_volume` fixed spread. The exact same tracer now passes.

`vkf_fixed_spread_plan.hpp` extracts the existing native selection rules into
one pure placement plan consumed by both targets. Fixed vector selections
retain native flattened offset order; record selections use exact parameter
names and leave already-bound parameters alone. The existing child-layout
helper preserves nested layouts. There is no new source parser or fallback.

WASM evaluates the sole spread once before ordinary operands, stores the
result, then loads selections in native parameter order. A focused observable
probe prints `9\n2\n24\n`, proving that the spread producer runs once before
the ordinary producer. Mixed named/spread/default calls print `567\n238\n`.
This preserves existing behavior and does not resolve the pending separate
language-authority argument-order question.

Invalid fixed cardinality produces the exact core diagnostic
`spread argument count mismatch for volume` on both targets. The test also
asserts the native driver's existing full diagnostic envelope separately;
no prefix is silently stripped to manufacture equality.

## Verification

Docker `emscripten/emsdk:4.0.14`, repository mounted at `/src`:

```sh
bash scripts/build-shared-compiler.sh
cmake --build build/native-compiler-docker --target vkf-strict -j2
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
node --test tests/bootstrap/shared-variadic-call-execution.test.mjs \
  tests/bootstrap/shared-console-parity.test.mjs \
  tests/bootstrap/shared-stdout-formatter.test.mjs \
  tests/bootstrap/shared-list-construction.test.mjs \
  tests/bootstrap/shared-scalar-logic.test.mjs \
  tests/bootstrap/shared-call-execution.test.mjs \
  tests/bootstrap/shared-scope-execution.test.mjs \
  tests/bootstrap/shared-default-call-thunk.test.mjs
```

Native rebuild and unchanged suite: exit 0, **451 passed, 0 failed**.
Focused integrated gate: exit 0, **56 passed, 0 failed, 0 skipped**, 6.386 seconds.
Scoped syntax and `git diff --check` pass. Durations are test receipts, not
performance claims.

One intermediate test run mistakenly overlapped the native linker replacing
the executable and received `spawnSync ... EACCES`. That run is invalid, not
a language failure or flaky acceptance pass. The linker was confirmed complete
before rerunning against frozen artifacts. A first diagnostic assertion omitted
the native driver's envelope; it was corrected to the observed exact envelope,
while retaining the exact core WASM diagnostic check.

SHA256:

| Artifact | Hash |
| --- | --- |
| Shared compiler WASM | `2afd6c01dc194ef2951058fa3241a265173e2390161d12348a101e827f00247f` |
| Native compiler | `fe0368cf434d50879a7a9066a373b7ea0af0abefcafbbf265f162afe8ed3e6df` |

## Remaining boundaries

The pure shared plan represents dynamic numeric-list spread cardinality, and
native retains its exact runtime check. The WASM consumer still rejects that
fixed-call case explicitly: its current bare `Trap` cannot carry the required
runtime diagnostic. A generic trap is not an implementation of the native
error. Finish the shared runtime-error channel before enabling this case.

Named-rest capture, tuple representation and the separate effectful numeric
variadic native crash remain open. The crash source is preserved in
`shared-variadic-call-parity-2026-09-05.md`. Nothing here weakens those gates.
