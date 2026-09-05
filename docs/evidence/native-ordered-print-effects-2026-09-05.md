# Native ordered print effects

Base: `67343be7e279c3e6ad65331df2490d7aa7605d2e` with the ongoing shared-compiler
worktree changes. Environment: Linux x64, GCC 12, Node 22 Bookworm Docker image
on Windows. This receipt concerns output correctness, not performance.

The frozen behavior is documented in `docs/architecture/automatic-flow-scheduling.md`:
`::` is an ordered effect and its commits preserve source/logical order.

## RED

`node --test tests/bootstrap/native-ordered-print-effects.test.mjs` against the
previous native binary exited 1: the nested-call tracer printed `3\n5\n`, but
the required output was `2\n3\n4\n5\n`. The focused test took 44.24 ms. The
pre-fix binary hash was not captured; this is not a reproducible historical
binary receipt.

Two existing lowering bugs caused the discrepancy: statement `WriteString`
instructions defaulted to descriptor 0, and top-level print values were batched
until entry return even when nested calls printed between them. The existing
expression-level print lowering already selected stdout descriptor 1.

The next labelled-output regression independently failed with
`machine IR does not support top-level label_print` (exit 1). Its existing
statement handler was unreachable from top-level module admission.

## GREEN and regression

Statement/label print instructions now select stdout. Modules with nested
output effects reuse the existing immediate-output lowering, preserving the
return-value path for print-free calls. Top-level labelled output reaches its
existing handler. No source rewriting, output simulation, or test relaxation.

Final command, with repository mounted read-only at `/src` and container cwd
`/tmp` so native temporary executables do not modify repository files:

```sh
node --test /src/tests/bootstrap/native-ordered-print-effects.test.mjs /src/tests/bootstrap/shared-program-execution.test.mjs
```

Exit 0: 5 tests passed, 0 failed, 0 skipped. Total test duration 1993.846144 ms.
Covered nested output, transitive calls, labelled output, unchanged scalar and
structured output, binding updates, repeated WASM execution, and byte-for-byte
native/WASM integer output comparison. Native and WASM both emit
`2\n3\n4\n5\n` for the original tracer.

SHA-256 at verification:

- `compiler/native/vkf_machine_ir_lowering.hpp`: `afb81b5a97d2c5bfc8784ef79e683c1522dfe8202dce39b948f5b910b3a4a7e9`
- `tests/bootstrap/native-ordered-print-effects.test.mjs`: `f0482237f09bd32317dc621e279159bf747829ad9839455e173ef1f3e22d4112`
- `build/native-compiler-docker/bin/vkf-strict`: `2d13fb3a03783579eb0b90f0d498ac722fe4de02785537503dde6439a969e97f`
- `build/shared-compiler/vkf-compiler.wasm`: `f1e6875994ff75946afe413e83c46c2e7c6c6b0d06600789e64dc03b5e403257`

This verifies the focused Linux native and generated WASM path, not all README
examples or other native targets. Integration and release acceptance remain
the root agent's responsibility.
