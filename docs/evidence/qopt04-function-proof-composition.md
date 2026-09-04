# QOPT-04: private function-proof composition

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `0992b6c526dbe1464f40ada9a8334ce1d52c029e` (QOPT-03).
- Branch: `codex/quantum/qopt04-function-proof-composition`.
- Worktree: `.worktrees/quantum/qopt04-function-proof-composition`.
- Consumed contracts: QOPT-01 proof schedule, QOPT-02 atomic proof cache,
  and QOPT-03 production driver adapter.
- Public VKF syntax, semantics, APIs, diagnostics, manifest schemas, and ABIs:
  unchanged.
- Explicit research `tune` is unchanged. This packet changes only the private
  x64 `auto` path.

Owned paths:

- `compiler/native/vkf_retained_optimization_composition.hpp`
- `compiler/native/vkf_retained_optimization_composition_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `compiler/native/CMakeLists.txt`
- `docs/evidence/qopt04-function-proof-composition.md`

## Observable private behavior

The x64 driver now recognizes a deliberately narrow composition domain:
zero-argument, deterministic, replay-safe, numeric scalar leaves containing
only private scalar arithmetic, local, comparison, and control-flow machine
operations. Calls, parameters, aggregates, resources, I/O, and every
unrecognized operation are excluded. Modules outside that domain retain the
QOPT-03 whole-entry proof path.

Each eligible leaf receives its own QOPT-03 request and QOPT-02 cache slot.
Its fingerprint is derived from the canonical private machine-function JSON;
program, host, toolchain, proof-key, and policy fingerprints remain exact and
domain-separated. A surrounding program fingerprint change therefore yields
`function-hit` for an unchanged leaf, while a changed leaf yields
`function-mismatch` and returns to measurement.

On a miss, the driver emits exactly two isolated leaf candidates: baseline
`mask-0` and ABI-neutral `mask-fc`. Bits that alter aggregate parameter or
result ABI are excluded from the candidate. Run and time budgets are divided
across the remaining misses, candidates are measured in alternating pairs,
and every result is compared bit-for-bit. The existing QOPT-01 one-sided 95%
proof is required independently for every leaf.

The full module is emitted with the compatible `mask-fc` policy only when
every leaf independently proves that same candidate. Any slower or unproven
leaf selects global `mask-0`; any parity failure blocks composition with an
empty selected policy and no fallback. This packet does not introduce mixed
per-function ABI or a public policy representation.

## Vertical TDD receipt

1. Composition tracer RED: strict Clang exited 1 because
   `vkf_retained_optimization_composition.hpp` did not exist. GREEN prepared
   two independent leaf receipts, each with only `mask-0` and `mask-fc`.
2. Completion RED: strict Clang exited 1 because private `complete` did not
   exist. GREEN required both independent proofs before enabling the composed
   policy.
3. Reuse tracer GREEN proved an unchanged leaf returns `function-hit` across
   a program change while only the changed leaf returns `function-mismatch`.
4. Production tracer RED against QOPT-03 exited 1: the real backend exposed
   two whole-module candidates instead of four leaf candidates. QOPT-04 GREEN
   exposed four candidates on the first build and only two after changing one
   leaf and the surrounding source-graph fingerprint.
5. The first incremental test fixture correctly remained RED when its
   candidate was not statistically faster: QOPT-03 intentionally does not
   retain rejected speed evidence. The final production fixture exercises
   the native-integer-local policy with a 10,000-iteration deterministic loop,
   so reuse is asserted only after a real paired speed proof.
6. Parity composition test proved one incorrect leaf blocks the complete
   composition without a selected policy.

Strict header-only Clang command:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I. compiler/native/<test>.cpp -o .work/qopt04/<test>.exe
```

Strict real-backend Clang command retained `-Werror` and suppressed only the
pre-existing translation-unit warning classes:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror
  -Wno-missing-field-initializers -Wno-reorder-ctor
  -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function
  -pedantic -DVKF_X64_BACKEND_LIBRARY -I. -Inative/VfOverlay
  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
  compiler/native/vkf_x64_artifact.cpp native/VfOverlay/vf/json.cpp
  -o .work/qopt04/vkf_retained_optimization_driver_integration_test.exe
```

Final focused outputs:

```text
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected store=io-error
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 selected=1
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
retained optimization driver integration: candidates=4 incremental_candidates=2 exact_output=1
```

The real integration passed three additional consecutive strict-Clang runs,
each reporting `4 -> 2` candidates and exact artifact output.

## Native verification

Environment:

```text
Microsoft Windows 10.0.26200, X64
Clang 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
MSVC 19.29.30159.0
CMake 4.3.0
```

Strict Clang compiled and passed:

- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_cache_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

From the clean short build path `C:\w\qopt04`, MSVC Release built the same six
tests plus standalone `vkf_x64_artifact`. All six tests passed. The real test
compiled and executed the selected PE and received exact `42` output.

One captured MSVC changed-leaf proof measured 16 pairs per policy: median
baseline 80,500 ns and median `mask-fc` 10,200 ns (ratio 0.127). This is a
fixture-local proof of the production gate, not a general performance-frontier
claim. Independent ADR-0010/T4 measurement remains required for a release
performance claim.

SHA-256 at final GREEN:

| Artifact | SHA-256 |
| --- | --- |
| private composition adapter | `B4B2E4D82D3D67C7908BBD3532102FC0F5AD9D0E51D830AD20787AC2634F6EE9` |
| composition behavior test | `A61245D7516FB14DFB6EAA3E33E4620A3A3D4406CE571AFC9810CE90E929C570` |
| production integration test | `3E024D0B1F01A2BF78E80295B32DF64AABAF82358E968DC8B3581E14F0D810C1` |
| x64 backend source | `8C56D1572F94B071E527DB509E9D7987E7F0C86620B8F1947469D165FB106182` |
| native CMake graph | `F494D4CB28A2899ACC9EA7934C35639BB52FC2202D29638696645DB2BF6C4A5E` |
| strict Clang composition test | `2FE005788BF439C7A8DAE8F9006BBDFC8E9871AB91E628DD7CC0DEBD5DF0F8A8` |
| strict Clang integration test | `C5BBF476538BCC79297D863D3E6FF2BEAE31E41A89A6FDD0331C73FC5F9CD95F` |
| MSVC composition test | `6C8044586E377925ACC0FA70746EDED3AA2228B5ACD3A83E2B328B4A4B8E868C` |
| MSVC integration test | `26D7499845A81D3CA3C488412528BBA996F041A23BC5010E029E8AC9A3705D9E` |
| MSVC production x64 artifact | `EE88510E99E8F50E9FD7686DF52A78A9F9F87F149AE127D5F4DE63DEDB513865` |

## Limitations and next gates

- Composition currently requires every emitted function to be an independent
  eligible leaf and selects one compatible global policy. Parameterized or
  call-connected functions continue through the prior whole-entry proof path.
- A statistically slower or unproven candidate is not cached, so unchanged
  non-winning leaves remeasure. Retaining bounded negative decisions requires
  a separate expiry/invalidation policy.
- Proof measurement remains serial and deterministically budgeted. No
  parallel execution was added without dependency proof.
- Toolchain identity intentionally includes build time and conservatively
  invalidates equivalent rebuilds.
- Concurrent-process cache stress, admission/pruning, crash-durability policy,
  GPU/reduction/cancellation scheduling, and independent T4 evidence remain.

The next smallest gate is a private dependency-aware function graph that can
compose parameterized or call-connected functions without changing public
syntax, ABI, or manifest schema. Parallel measurement or execution must remain
disabled until that graph proves independence.

## Lane estimate

The quantum optimization lane is estimated at **89% complete**, with medium
confidence (about +/-6 points). There is no canonical quantum-lane roadmap, so
the explicit 100-point gate weighting is: audit/model 10/10; statistical proof
and exact parity 20/20; bounded one-shot exploration 15/15; retained reuse
15/15; dependency-safe composition/parallel execution 11/15; explicit failure
reporting 10/10; shipped integration plus independent performance evidence
8/15.

No Language Design Authority decision is required. This packet is
independently revertible and is not merged or pushed.
