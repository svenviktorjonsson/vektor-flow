# QOPT-13: source-order reduction proof

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `11d77a1b278e1f7dc340171e2e5016d9481dff19` (QOPT-12).
- Branch: `codex/quantum/qopt13-reduction-proof`.
- Worktree: `.worktrees/quantum/qopt13-reduction-proof`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- QOPT-12's bounded serial-plus-one-guided-candidate miss, exact outcome
  parity, retained fingerprints, apply-only-on-win policy, deterministic error
  propagation, mandatory join/cleanup, and hard-failure/no-fallback boundary:
  unchanged.

Owned paths:

- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_adaptive_optimizer_contract_test.cpp`
- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/architecture/automatic-flow-scheduling.md`
- `docs/evidence/qopt13-source-order-reduction-proof.md`

## Private correctness contract

QOPT-13 admits one deliberately narrow reduction shape inside either proven
independent pair root: a non-empty, fixed-arity `SumF64Values`. The existing x64
emitter evaluates this operation as a scalar IEEE left fold from stack operand
zero through operand `arity - 1`. The private dependency receipt records every
admitted node as:

```text
<function>#<instruction>:sum-f64-values:left-fold:<arity>
```

Threaded execution calls the same root body as serial execution. Parallelism is
therefore only between the two roots; it never partitions, balances, or
reassociates either reduction. Exact candidate proof compares the ordered result
bits. A root/dependency instruction, operand, order, or arity change changes the
complete Machine IR function material and invalidates retained proof. Program,
function, dependency, host, and `x64-emitter-qopt13` toolchain fingerprints
continue to scope reuse.

All list/local reductions, mean, variance, standard deviation, range, count,
empty or unknown fixed sums, and any other associative-looking operation without
this exact tree remain serial with the explicit private reason
`reduction-order-unknown`. Effects, errors, resource ownership, alias/provenance
uncertainty, and incomplete call graphs remain governed by their stricter
existing fail-closed reasons. Candidate failure still hard-fails and never
causes a hidden serial retry. The QOPT-12 cooperative completion and
join/cleanup policy is unchanged.

## Vertical TDD receipt

1. The dependency test first required complete reduction knowledge, exact
   source-order proof, and parallel eligibility for fixed three-input sums. The
   initial strict compile RED was:

   ```text
   error: no member named 'reduction_knowledge_complete' in 'Receipt'
   error: no member named 'reduction_tree_source_ordered' in 'Receipt'
   ```

   GREEN recognizes only non-empty `SumF64Values` and records both root trees.
2. A list reduction then required fail-closed eligibility and the explicit
   `reduction-order-unknown` reason. The strict compile RED was:

   ```text
   error: no member named 'ReductionOrderUnknown' in 'Reason'
   ```

   GREEN classifies every numeric reduction outside the admitted fixed sum
   before generic unclassified-operation handling.
3. The measured automatic-pair contract then required the exact reduction pair
   to select two lanes under already-proven faster evidence. Its behavioral RED
   was:

   ```text
   a measured fixed source-order reduction pair must preserve its exact tree in two CPU lanes
   ```

   GREEN permits the stable-tree safety exception only when the dependency
   receipt carries the fixed source-order proof.
4. The production fixture exercises `1e16 + -1e16 + value`, whose left fold is
   vulnerable to reassociation. Both serial and threaded candidates preserve
   exact outputs `42`, `43`. The miss measures exactly two correct candidates in
   at most ten artifact runs. A source-only change reuses the proof with zero
   candidates; swapping reduction operands invalidates the function proof and
   measures exactly two fresh candidates.

## Verification

Strict focused Clang command pattern:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o C:/w/qopt13-clang/<test>.exe
```

The production integration retained `-Werror` and suppressed only its existing
translation-unit warning classes:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror
  -Wno-missing-field-initializers -Wno-reorder-ctor
  -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function
  -pedantic -DVKF_X64_BACKEND_LIBRARY -I. -Inative/VfOverlay
  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
  compiler/native/vkf_x64_artifact.cpp native/VfOverlay/vf/json.cpp
  -o C:/w/qopt13-clang/vkf_retained_optimization_driver_integration_test.exe
```

Clang 22.1.4 compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

A clean `C:\w\qopt13` Visual Studio 2019/MSVC 19.29 x64 Release
configuration compiled the same seven tests plus standalone
`vkf_x64_artifact`; all seven tests passed.

Salient common output:

```text
optimization dependency gate: reason=call-graph-dependency pair=unresolved-call independent=1 pure_call=independent parameter_pair=independent borrow=mutable-borrow-unknown
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected negative=negative-program-hit negative_function=negative-function-hit expired=negative-expired store=io-error
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 concurrent=1 superseded=8 process_concurrent=1 deterministic_tie=1 selected=1
```

Both independently compiled production tests exercised the real packaged x64
artifact, retained exact proof, and reduction-order invalidation:

```text
Clang: reduction_candidates=2 reduction_selected=scalar reduction_serial_median_ns=7.17305e+07 reduction_threaded_median_ns=3.84157e+07 changed_reduction_candidates=2
MSVC:  reduction_candidates=2 reduction_selected=scalar reduction_serial_median_ns=4.39208e+07 reduction_threaded_median_ns=2.52091e+07 changed_reduction_candidates=2
```

The threaded candidate medians were about 46.4% and 42.6% below their local
serial baselines, and both independent builds selected threading. These rows
prove local apply-on-win behavior only; they are not a portable speed claim.
QOPT-12 right-only and simultaneous error scenarios also retained two exact
candidates in both production runs.

Final SHA-256 receipts:

```text
f032dfba8ae3c5f031491ff92a04f804a1edea7bf22ff5e200bc20344d1ba9c4  compiler/native/vkf_adaptive_optimizer.hpp
6d5488674b47f2c5a8ba26b73541cc18ea732819dc2e6071175bb0bf9ef857a6  compiler/native/vkf_adaptive_optimizer_contract_test.cpp
645c9516651ce64bc5acf099e5326ceeb3606aad1f4a78d4077b58f1dcc6d589  compiler/native/vkf_optimization_dependency_gate.hpp
cb69fa67540933ee042f0b3f05aa9506e54e5fd805395920ccfa6d702cd32540  compiler/native/vkf_optimization_dependency_gate_test.cpp
d1ab5b23b458e751ba50d8443fed27081ad0fe21b44260f06ab62751ab3149c7  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
67bf853d48fdb1742553a90b3b71aa5aa517255f64067435f08dabf981bc652c  compiler/native/vkf_x64_artifact.cpp
7f63071aad3f74d3801dc7721e598327c82dc0fed211fe967891a97c648e220d  docs/architecture/automatic-flow-scheduling.md
3ee9cc53451e65d51865bd1b88010cf9906b045682b35c21a970c3167cb83393  clang/vkf_optimization_dependency_gate_test.exe
84ec33de0c5807073c0efb81646612423c0afd96b4e2589ed733a72bc3a3cf92  clang/vkf_adaptive_optimizer_contract_test.exe
28308540d90f1a5bfdfcd6e7c66281bfebc3610bb0701828ad8e5c195e7e3e6f  clang/vkf_retained_optimization_driver_integration_test.exe
90a7da3d8354d136e24e31c21237a32888a9ea8e8e89d7dbf32fa290af47167a  msvc/vkf_optimization_dependency_gate_test.exe
eb37487c67b1ede9d0c015c0f6abbf59546a46a1bdee39ce605d6e3f3e46d3f4  msvc/vkf_adaptive_optimizer_contract_test.exe
4db2587496bef3ea9fa63bb7c3a049e0508cb9f9519f200ac57f2dd2ffb2b29a  msvc/vkf_retained_optimization_driver_integration_test.exe
a77214726f7b4569822b14f872a104c67f2fc79ee08f5609637e9a0e036f1af9  msvc/vkf_x64_artifact.exe
```

## Limits and remaining gates

- This gate proves only fixed-arity `SumF64Values` inside otherwise-proven pair
  roots. It does not parallelize a reduction internally.
- Dynamic/list/local reductions, mean/variance/stddev/range/count, wider scalar
  and result shapes, and independently partitioned fixed merge trees remain
  serial.
- Cancellation remains cooperative completion plus mandatory join/cleanup;
  polling or safe preemption for long-running work remains open.
- Only the exact Windows x64 two-result pair executes concurrently. POSIX, GPU,
  and broader scheduling remain separate declared-scope gates.
- The timing rows are independent compiler builds on one host, not the
  separately owned ADR-0010/T4 exclusive-runner verification required for a
  release-wide performance claim.

## Lane estimate

The bounded quantum optimization lane remains estimated at **99% complete**,
with high confidence (about +/-1 point). Explicit 100-point weighting:
audit/model 10/10; statistical proof and exact parity 20/20; bounded one-shot
exploration 15/15; retained reuse 15/15; dependency/value/borrow/error/reduction
safety and parallel eligibility 15/15; explicit failure reporting 10/10;
shipped integration plus independent performance evidence 14/15.

It is intentionally not reported as 100%. Independent T4 and the declared
target/result/reduction/cancellation scope gates above are not closed. No
Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
