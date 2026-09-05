# Shared browser compiler checkpoint — 2026-09-05

This checkpoint supplements, not replaces, the release handover. Nothing in
this packet has been published. Full browser execution coverage is **not green**.

## User acceptance contract

Every README/linked-guide VKF example must be editable. Run consumes current
editor contents. Reload restores the canonical source and recorded console
output. There is one console per example, replaced by execution output. Browser
execution must use the same language frontend as native, not source-pattern
handlers or a JavaScript interpreter. No user host capabilities or fallback.

The approved introductory geometry is `x: 0.1[..100]`, `y: sin(x)`, with `x_u:x`
and `y_u:y` only on the named arguments. Keep `Display()` inference and 101
samples. Do not revert it to the older complex-coordinate example to pass tests.

## Current working state

- One checkout: `ViktorTemp/vektor-flow`, branch `main`.
- Base HEAD: `67343be7e279c3e6ad65331df2490d7aa7605d2e`.
- Changes remain uncommitted. No branch switch, new worktree, cleanup, or push.
- All build output stays under `build/` in this repository.
- Docker restarted successfully. Native `vkf-strict` builds successfully in
  `build/native-compiler-docker/bin/`.

## Editor packet

`tools/build-site.mjs` now makes every `vkf` fence editable, not just fences
labelled `live`. Existing recorded stdout is used in the single console rather
than rendered as a second output. `web/documentation.mjs` restores
`textarea.defaultValue` before initialization. Run still uses `textarea.value`.

Verified with Node 22 in Docker:

```sh
node --test tests/js/pages-editable-examples.test.mjs \
  tests/js/pages-documentation-shell.test.mjs \
  tests/js/pages-inline-runner.test.mjs
```

Result: 40 passed, zero failed. This tests editor initialization/controller
behaviour and document generation, not a real browser reload. The browser
connection list was empty; manual browser validation remains outstanding.

The linked site contains 42 pages, 97 editors, and 87 distinct displayed source
texts. Counts are inventory, not language/release completion percentages.

The full execution test now uses individual subtests, preserving every failure
instead of stopping at the first one:

```sh
node --test --test-name-pattern 'every editor published anywhere' \
  tests/js/pages-readme-document.test.mjs
```

Result against the **shipped old WASM**: 12/97 editor execution subtests pass;
85 fail. The enclosing test also fails. Receipt:
`docs/evidence/readme-editor-execution-2026-09-05.tap`. These are execution
acceptance checks; they do not prove native-equivalent output for every example.
Do not describe this as only three broken examples: three enclosing regression
tests previously stopped at the first geometry failure and hid the larger gap.

## Shared compiler packet

`compiler/native/vkf_browser_compiler.cpp` calls the native lexer, parser and
AST-to-IR implementation directly. `vkf_emit_program` uses the existing shared
typed-IR bytecode lowerer, VM emitter, and extracted artifact manifest builder.
No new parser, source matcher, or interpreter was introduced.

```sh
# From this repository, mounted at /src in emscripten/emsdk:4.0.14:
bash scripts/build-shared-compiler.sh
node --test tests/bootstrap/shared-frontend-wasm.test.mjs \
  tests/bootstrap/shared-compiler-execution.test.mjs
node tools/verify-browser-frontend-parity.mjs \
  --output=docs/evidence/shared-frontend-wasm-parity-2026-09-05.json
```

Artifacts: `build/shared-compiler/vkf-compiler.wasm` and native
`vkf-compiler-probe`. This is a staged compiler build, **not yet wired into the
published page or downloadable browser SDK**.

Initial frontend scope (superseded artifact): 87/87 distinct inputs produce identical typed IR or
diagnostics through the same frontend compiled native and WASM; 76 are accepted,
11 rejected in both. The probe does not include the native CLI's filesystem
module linker. Frontend parity is not full native CLI or execution parity.

Executable tracer: source `square(value:num) -> num: value * value` emits a real
import-free WASM program returning 49 for 7; editing to `value * value + 1`
returns 50. Compiler WASM itself also has zero host imports. Linked descriptor
stubs return NOTCAPABLE; environment is empty. Host code only transports bytes.

Whole-program lowering now executes top-level statements through a compiler-private
entry, preserving updates and nested print order. A RED native differential test
also exposed dropped/reordered native function prints; that native defect is fixed
and independently regression-tested. The previous top-level rejection guard is gone.

The browser-generated program arena now matches the native artifact builder's
64 MiB. The new assertion was RED at the previous 1 MiB default and is GREEN
after rebuilding. All six shared compiler tests pass, including byte-identical
repeat emission and stale-output invalidation/recovery after malformed source.
Earlier compiler WASM SHA256 (not the current artifact):
`a00ec61a632d233c6a627a0f3f4254cd4b99c4a2b5ca8de0c6238a273aba7c64`.
The initial frontend receipt describes that artifact only.

Independent verification of manifest extraction compared pre/post native
artifact builders on `hello_native` typed IR (`--entry twice --prune-to-entry`).
Both WASM and manifest were byte-identical:

- WASM SHA256: `512321620d2d41d9de7e1109e4c5b42bb17c02451f992d6cefe044c4332478df`
- Manifest SHA256: `69f1be52fa59e72fd94578d55c0b7a05bf41406a7b3d9d4a352735a44dc723a9`

## Next required gates

1. Run the SAME `tests/vkf` suite as native, using the native test-discovery,
   tagged-test selection and expected-compile-error rules. This is the user's
   explicit additional acceptance gate. Never replace it with a browser subset.
2. Finish shared backend coverage and exact stdout/runtime diagnostics. Current
   GREEN tracers cover whole-program updates/ordered prints, edited vector function
   lifting, all 101 `0.1[..100]` samples, vector sine, named-axis products, and linked
   source-defined math.log. Shared linker and literal-definition snapshots are
   extracted from native, not reimplemented in JavaScript. Display inference and
   indexed/complex p_u frontend tests pass, but UI execution/rendering is NOT yet
   connected. Do not mistake accepted UI IR for a visible working example.
3. Replace the shipped pattern-specific compiler only after integration gates
   pass. Run every canonical editor, edits, diagnostics and refresh tests.
4. Resolve/document platform-capability examples without giving user code host
   access. Some linked historical snippets also fail native frontend validation;
   do not silently skip them or claim all examples run.
5. Keep publication gated on all runnable-example tests. Do not substitute
   inventory counts, frontend parity, prerecorded output, or acceptance-only
   results for end-to-end correctness.

## Latest integration notes

- `tools/verify-shared-documentation-execution.mjs` inventories the same published
  sources, executes each unique source in an isolated worker with a 30-second
  deadline, and reports every failure. Initial shared-backend smoke: 30/87 returned
  successfully. This is NOT an acceptance percentage: stdout, UI and edit/reset
  parity are separate gates. See `docs/evidence/shared-documentation-execution-smoke-2026-09-05.json`.
- Remaining failures include closures, tuples, reflection, collection/stat methods,
  control-flow forms, host-only modules and contextual historical snippets. Do not
  silently remove or exempt failures. A user question about sandbox-denial versus
  native-only host examples is pending; no capability expansion is authorized.
- Incremental shared builds use `scripts/shared-compiler.mk` with C++ dependency
  files. All generated objects remain in `build/shared-compiler` under this root.
- Trig kernels now use full-range fixed-point reduction; standalone differential
  tests across every binary64 exponent band pass the unchanged 1e-12 numerical
  gate. No optimization/performance claim follows from these correctness tests.
- A C++ stdout formatter preserves native scalar17/vector15 significant-digit
  conventions from raw tagged value memory. Scalar/vector/string integration now
  passes exact native differential tests, including nested output and unreachable
  print functions. Structured display metadata remains outstanding. No JS number
  formatter is used by the shared adapter.
- Compiler-owned geometry/axis packing and shared native test-suite extraction are
  active isolated agent packets. Nothing has been committed, pushed or deployed.

## Shared native test gate

`vkf_test_suite.hpp` is extracted from the native `-t` implementation. Both the
driver and compiler-WASM test host use its file filtering, source-order test
selection, explicit tags, parameter compatibility, compile-error markers and
generated assertion entry source. Inventory is 451 cases (431 runtime assertions,
20 expected-compile-error fixtures), 67 files, no discovery errors. Inventory is
not a pass count.

```sh
node tools/verify-native-wasm-tests.mjs \
  --native=build/native-compiler-docker/bin/vkf-strict \
  --output=docs/evidence/native-wasm-suite-2026-09-05.json
```

The gate runs every case on both targets, preserves a 30-second case deadline,
rejects unsupported execution instead of skipping it, and compares stdout/stderr.
Compile-error fixtures must fail during compilation, not merely trap at runtime.
Compiler CI runs this gate; Pages now depends on that workflow so a red language
parity gate cannot publish the site. Full execution was launched after the exact
console and shared-test-host tracer gates passed; consult the receipt, not the
inventory, for outcomes.

Native baseline binary during the first full comparison:
`045b689a0ca4b3d6ee91710c5fb5594da94d3302cfa75dafb56cdc0e2ac83479`.
It contains a verified fixed-local statistics storage optimization defect; the
source fix has direct RED/GREEN regression evidence but is not in that baseline.
Do not weaken WASM results to match corrupted native values. Rerun both targets
after rebuilding that fix.

### Fresh-artifact comparison (latest completed full run)

Parallel lanes were resumed at the user's explicit request. The root checkout
remains dirty `main`; do not switch, reset, or clean it. Two registered branch
worktrees stay inside this same repository root:

- `build/branches/bootstrap`, branch `bootstrap`, initial HEAD
  `1b60eebaec29b023603f398ba17b5faf5d7f5b7d`;
- `build/branches/pre-gen`, branch `pre-gen`, initial HEAD
  `9ff5651f533df13379441cbeb6adfb7d8126356a`.

**These are active source checkouts, not disposable build artifacts. Never
recursively remove the root `build` directory.** Each lane writes generated
output only to its own checkout's `build` directory. Branch heads were fetched
and matched their origin refs; both new checkouts started clean. No outside
working directories were created, and no histories were merged or discarded.

Bootstrap resumed independent Windows-native tool builds and fresh executable
bundle/fixed-point gates. The I240 exact runner-seed blocker remains: required
SHA `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`.
New toolchain builds must not be substituted for that locked seed.

Pre-gen resumed an approved internal composition packet: connect nine existing
measured leaf-species material variants to the existing forest draw pipeline,
preserving geometry, wood/bark, schemas, and exact deterministic identities.
This is not nine tree architectures. Its nature roadmap covers water,
mountains/hills, beaches, trees, bushes and flowers. The preserved generic
scene-capture test remains RED pending a defined material-consumer contract;
do not invent fallback shading or claim private CPU capture is GPU integration.

The subsequent combined WASM default/math/number regression passed 11/11.
Native was rebuilt with shared layout extraction, shadow initializer correction,
and round-trip JSON precision; its unchanged language suite passed 451/451.
The completed comparison before the continuation checkpoint is preserved at
`docs/evidence/native-wasm-suite-current-2026-09-05.json`; later receipts below
supersede its pass count for newer artifacts.

`docs/evidence/native-wasm-suite-fresh-2026-09-05.json` records **88/451**
WASM parity passes (19.5%) and 363 failures; native passed all 451 cases.
Every positive native case used a newly materialized identical source and a
unique output path under `build/native-wasm-suite`, preventing executable-cache
reuse. The native binary hash was unchanged throughout the run:
`09ba532b6754d1a1ce8645ad64852d0bb92c0b65b7abf26131052034fffbfcc2`.
Compiler WASM hash:
`d0b8e31b82aee9ffc9fca32e4f886cc664aee92357ca3e77410e292b1721d576`.
No tests were excluded. This is language-test parity, not README/UI acceptance.

Subsequent source packets awaiting combined regression verification:

- Native block shadowing evaluated initializers after replacing the outer slot.
  A fresh native probe printed `1,3,2` instead of frontend-consistent `4,3,5`.
  The narrow native slot-order correction is in source; do not copy the defect
  into WASM. One separate canonical block test still requires shared transitive
  inferred-layout adaptation (`any_record_field_inference_propagates_call_shape`).
- Native and WASM fixed named-call binding consume the same helper. Named/mixed
  runtime tracer is awaiting the combined build; callee-scope defaults remain a
  subsequent packet. Argument evaluation order has a pending human decision in
  `docs/plans/call-argument-order-decision.md`; it has not been changed.
- Shared JSON number transport now uses round-trip precision and accepts
  representable subnormals. Standalone regression preserves 16,382 binary64
  values bit-for-bit, across every finite exponent band. Whole-compiler transport
  and geometry tests must still be rerun after rebuild.
- Plain native math builtins have a shared classification/arity helper and a
  WASM execution tracer. Fractional power/full-range exponential work is ongoing.

Everything remains uncommitted and undeployed. Pages' old compiler-build path
must still be replaced by the verified shared artifact before publication;
adding a parity dependency alone does not wire the new compiler into the site.

## Continuation checkpoint after agent-model handoff

All three active lanes were stopped at explicit filesystem/process checkpoints
and resumed with fresh agents inheriting the root model. No worktree, dirty file,
or running build was discarded.

- `bootstrap` is clean and pushed at
  `2f622dd7c6f70aef0bf080dcbfcdfe3c81afbd66`. Runtime-input `#` and `##`
  comment tokenization has archived RED and current GREEN evidence; its focused
  and adjacent gates pass. The exact I240 seed and genuine self-compilation gap
  remain unresolved and are not hidden by the passing self-copy bundle.
- `pre-gen` is clean and pushed at
  `52693a6278b6577e84047274a5b980b426c8bf9f`. The frozen forest identity passes
  on Windows and differs on Linux because `std::sin(float)`/`std::cos(float)`
  produce different foliage bits. No hash, tolerance, or producer was changed.
- The rebuilt shared compiler at SHA256
  `2e302b672863df593d75367aeaa43ed12809db656029b074acfc618c9827edc2`
  passes numeric list construction, all 17 unchanged scalar-operation cases,
  XOR source-order/one-evaluation checks, all 14 unchanged block cases, and the
  record-argument once-only regressions. The full unchanged gate records
  **119/451** WASM parity cases and 332 failures; native remains green. No cases
  were excluded. Receipt: `native-wasm-suite-variadic-2026-09-05.json`.
- The same artifact executes **40/87** distinct documentation sources, up from
  30. This remains only a smoke measurement: stdout, visual effects, edits and
  reload are separate acceptance gates. Receipt:
  `shared-documentation-execution-conditional-2026-09-05.json`.
- Tagged-memory record stdout formatting has focused and combined GREEN
  native/WASM evidence, including nested records and exact source field order.
  Numeric variadic list packing, dynamic spreads and defaults-with-rest also
  pass exact native differential tests. The integrated focused gate is 53/53;
  native remains 451/451. The subsequent full gate remains 119/451 because the
  complete calls file next reaches unsupported tuple lowering. Fixed vector and
  record spreads themselves pass the integrated focused gate. The most recent
  full receipt used the immediately preceding fixed-spread artifact and is
  `native-wasm-suite-fixed-spread-2026-09-05.json`.

The canonical numeric conditional README example now runs exactly like native,
including the existing numeric-null `nan` display. A conditional numeric body
returned through an ordinary function remains RED because `int` is represented
as dynamic at that internal boundary; the broader typing change was not applied
without explicit authority.

Tuple transport and compiled retained-UI effects are the next shared-backend
boundaries. Pages
still serves the old compiler path; publication remains correctly gated.
