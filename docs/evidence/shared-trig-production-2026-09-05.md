# Shared trig production checkpoint

Accepted Math A installs the audited `vkf-trig-v1` sin/cos source behind existing
VKF operations. This is a correctness checkpoint, not a performance claim or a
claim of complete browser language/UI coverage. Integration remains subject to
the explicit unfinished target gates below.

## RED → GREEN and unchanged gates

- Initial production tracer: **0/2 RED** (`7b2083dc`). After the coordinated
  switch: native and emitted-WASM candidate assertions **2/2 GREEN**.
- All **101** authored sine samples now have byte-identical native/WASM stdout;
  the original exact comparison and original vector tolerances are unchanged.
- Fresh native `vkf-strict -t tests/vkf`: **451 passed, 0 failed**.
- Full shared native/WASM gate: **119/451**, **332 failures**, zero discovery
  errors, no unsupported-test exclusions. This is not a release acceptance
  percentage. See `shared-trig-production-full-suite-2026-09-05.json`.
- Focused non-math, calls/defaults/spreads, record/scope/tuple and output boundary:
  **69/69**. Exact module/cache/JSON/selection/diagnostic gates: **14/14**.
- Package/candidate/numeric/production/consumer/boundary/Mach-O gates: **28/28**,
  including the **5/5** production consumer subset. Windows PE process gates:
  **2/2**. All focused gates have zero skips.
- Native and WASM package generators both pass deterministic `--check`.

The optimizer table, production C archive, and native/WASM relocation packages
retain all **12,793** frozen candidate input results, including signed zeros and
NaN classification. The earlier independent 400/600-digit reference audit still
applies: at most one binary64 step on the finite corpus, not a claim of universal
correct rounding or greater accuracy than glibc.

## Production target proof

| Consumer | Evidence / remaining limit |
| --- | --- |
| Direct ELF x64 | Actual compiled VKF program executes; dynamic-symbol audit has no platform `sin`/`cos` |
| Direct PE x64 | Final writer-generated sine/cosine programs execute on Windows; imports contain neither function. This proves writer/runtime integration, not a fresh full Windows CLI build |
| Direct Mach-O ARM64 | Actual VKF frontend → ARM64 encoder → Mach-O artifact; page-aligned audited package, complete `__text` coverage, no `_sin`/`_cos` binds. **No macOS host execution available** |
| Native runner | Fresh final runner binary executes both unchanged runtime slots with accepted exact results |
| Optimizer/JIT | Actual `ExecutableCode` class and installed runtime table execute all frozen inputs exactly |
| Emitted WASM | Old Taylor emitter removed; private relocated candidate functions/data/stack, zero host imports, exact native stdout |
| Compiler numeric evaluator | Actual canonical frontend expression evaluation matches final native program stdout |
| Retained numeric evaluator | Actual canonical frontend expressions evaluate through retained evaluator with exact native stdout |
| WASM artifact evaluator | Source dispatch switched; **fresh target build blocked by missing spectral header** |
| WebGPU artifact evaluator | Source dispatch switched; **fresh target build blocked by missing spectral header** |

Mach-O metadata had a focused **0/1 RED**: package bytes were inside executable
`__TEXT`, but outside declared `__text`. Extending only that section size and
rebuilding `vkf_arm64_artifact` made the unchanged range/import test **1/1 GREEN**.
ARM64 package execution under QEMU remains separate from final Mach-O execution.

## Exact before/after comparison

Reconstructed commit `789211d75fc1612e2c66847e4cc423e54d42760d` with `git archive`
inside `build/trig-pre-switch-789211d7` (not another worktree). Its rebuilt WASM
is byte-identical to the original pre-switch artifact. The first isolated run
used a different container path and lacked the I/O fixture directory; its raw
receipt is preserved as `shared-trig-pre-switch-full-suite-2026-09-05.json`.
All WASM results/diagnostics already matched; native output had 20 path-only
PASS-line differences and two fixture-setup failures. These were not normalized
or waived. A repeat uses the same `/src` mount after the unchanged native suite
establishes its normal fixture directory.

The identical-mount comparison is **exact across all 451 cases, zero differences**,
including all **332** failures. See
`shared-trig-pre-switch-full-suite-identical-mount-2026-09-05.json` and
`shared-trig-suite-comparison-identical-mount-2026-09-05.json`. The exact comparer
is `tools/compare-native-wasm-evidence.mjs`; it compares each test identity,
source hash, native result object, WASM result/error object and outcome/reason.

```sh
node tools/compare-native-wasm-evidence.mjs docs/evidence/shared-trig-pre-switch-full-suite-identical-mount-2026-09-05.json docs/evidence/shared-trig-production-full-suite-2026-09-05.json docs/evidence/shared-trig-suite-comparison-identical-mount-2026-09-05.json
```

## Public boundary and artifact identities

Nine non-math probes preserve exact frontend responses, serialized emission
manifest bytes, exports and stdout. Emitted programs remain import-free. JS
results still contain only `kind`, `stdout`, `stderr`; no language values are
exposed. Internal executable bytes change because the shared runtime is embedded
even in non-math programs. No old binary hash is silently retained or relabeled.
Public slot indices/schema remain unchanged. Arena capacity policy is unchanged;
the candidate's private stack and immutable data precede the existing arena.

| Artifact | SHA-256 |
| --- | --- |
| Pre-switch WASM | `ef5a91b822ebb5ccfbbf751331bec00beb73f45de874c880303447b84a5d2548` |
| Current WASM | `63b0f126f2c606dec39240845e660a63aaeb95abe1e6daeb69cf54340acfafc0` |
| Current native strict | `b7c6632499e2793f6a5f7b2f16ee74912f5e01df0b24cde81e3de0356b739816` |
| Current ARM64 artifact writer | `8ebae4d4f5e2349994a89ddb0c8ec4365703a10afb91579a4b0b8eb5efda2e8d` |

## Reproduce focused production proof

Run inside `vkf-trig-toolchain:14`, repository mounted at `/src`:

```sh
node --test tests/bootstrap/shared-trig-native-package.test.mjs tests/bootstrap/shared-trig-package.test.mjs tests/bootstrap/shared-trig-candidate.test.mjs tests/bootstrap/wasm-math-kernels.test.mjs tests/bootstrap/shared-trig-production.test.mjs tests/bootstrap/shared-sine-output-determinism.test.mjs tests/bootstrap/shared-trig-native-consumers.test.mjs tests/bootstrap/shared-trig-public-boundary.test.mjs tests/bootstrap/shared-trig-macho-writer.test.mjs
node tools/build-trig-runtime-package.mjs --check
node tools/build-trig-native-package.mjs --check
build/native-compiler-docker/bin/vkf-strict -t tests/vkf
node tools/verify-native-wasm-tests.mjs --output=docs/evidence/shared-trig-production-full-suite-2026-09-05.json
```

The public-boundary test requires the archived pre-switch artifact described
above; package tests require the unchanged frozen candidate observations. On
Windows, run `node --test tests/bootstrap/shared-trig-pe-writer.test.mjs` for the
actual PE process gate. Its writer harness uses Docker; execution uses Windows.

## Unfinished gates and preserved defects

`vkf_native_scene_lowering.hpp:3` includes nonexistent
`compiler/native/vkf_spectral_emission.hpp`. Root independently verified that
commit `2be9847c` introduced the include without its dependency; no tracked ref,
recovery worktree, unreachable commit or dangling blob supplied it. No substitute
header or fallback was introduced. Expanded WASM/WebGPU evaluator builds remain
blocked, so this packet does not claim ten-target execution completion.

Full shared-suite REDs (including named variadics, type patterns, closures,
reflection, labeled output and unsupported I/O) remain unskipped. UI execution
and Pages deployment are not part of this checkpoint. Presentation/orbit/GPU
shader trig is deliberately outside this binary64 VKF policy and remains
unchanged; other math operations retain their existing implementations.
