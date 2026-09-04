# QOPT-12: deterministic threaded error propagation

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `d129c21f139f4ab6049c079205c174e3ceef4d79` (QOPT-11).
- Branch: `codex/quantum/qopt12-cancellation-error-proof`.
- Worktree: `.worktrees/quantum/qopt12-cancellation-error-proof`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- QOPT-11's bounded serial-plus-one-guided-candidate miss, paired statistical
  proof, retained fingerprints, exact result parity, apply-only-on-win policy,
  and hard-failure/no-fallback boundary: unchanged.

Owned paths:

- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_adaptive_optimizer_contract_test.cpp`
- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/architecture/automatic-flow-scheduling.md`
- `docs/evidence/qopt12-deterministic-error-propagation.md`

## Private correctness contract

QOPT-12 admits one deliberately narrow fallible pair: either otherwise-pure,
resource-free root may end in one statically bounded `AssertTruthy`, followed
only by the existing drop/load/return tail. Its transitive closure must remain
non-fallible and scalar-pure. Handlers, dynamic or nested errors, unclassified
operations, owned resources, incomplete provenance, and every other fallible
shape stay serial. The dependency receipt explicitly proves complete error
knowledge, source ordering, and mandatory join/cleanup.

The Windows x64 threaded artifact gives each lane private result and exact
error slots. The worker records its message pointer, floating-length bits, and
error mask in its context; the caller records the same fields in its frame. The
caller always waits for the worker and closes the thread handle before checking
either outcome. A wait failure closes the handle before hard abort. Left/root
source order wins when both lanes fail. Error handling precedes runtime output
stores, so no partial result is published and no serial retry occurs.

There is intentionally no unsafe forced thread termination. Eligible roots are
finite, pure, and resource-free, so a peer lane already in flight is allowed to
finish before the mandatory join and cleanup. This is the safest cancellation
available for the current private native seam; cooperative polling and broader
cancelable work remain a later gate.

The proof runner compares a complete outcome: ordered numeric bits, exact error
message bytes, exact floating-length bits, exact error mask, and the absence of
partial output. The packaged artifact retains its non-returning abort import.
Only the in-process tuning callback captures the exact error and returns through
the generated normal epilogue. Function, dependency, program, host, and
`x64-emitter-qopt12` toolchain fingerprints continue to govern retained reuse.

## Vertical TDD receipt

1. The generic concurrent executor test first made both branches throw, delayed
   the left branch, and required both branches to finish before propagating the
   left/source-first error. Against QOPT-11 it failed with:

   ```text
   concurrent branch errors must join both lanes and propagate the source-first error
   ```

   GREEN captures the caller exception, always joins the future, then rethrows
   the left error before the right error.
2. The dependency test next required explicit error-knowledge, source-order, and
   join-cleanup receipt fields for the exact terminal assertion shape. The RED
   was a strict compile failure because QOPT-11 had no such fields. GREEN admits
   only the exact contract. Dedicated negatives keep handled/non-terminal errors
   serial and prove terminal fallibility cannot mask an owned resource.
3. The production fixture required two correct candidates for a right-only
   failure and a simultaneous failure. Against QOPT-11 both cases reported:

   ```text
   right_error_candidates=0
   concurrent_error_candidates=0
   ```

   GREEN emits the private worker/caller error contexts, exact outcome capture,
   mandatory join/close, and left-first selection. The right-only artifact exits
   nonzero with empty redirected output. An unchanged fallible function graph
   reuses its proof across a surrounding source change with zero candidates.
4. An intermediate Windows implementation used `longjmp` from the tuning error
   callback and failed during baseline capture with status `0xC00000FF`.
   Instrumentation localized the failure to that callback. Capture-and-return
   plus the generated normal epilogue removed the unsafe cross-boundary jump;
   all temporary instrumentation was removed before verification.

## Verification

Strict focused Clang command pattern:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o C:/w/qopt12-clang/<test>.exe
```

The production integration retained `-Werror` and suppressed only its
pre-existing translation-unit warning classes:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror
  -Wno-missing-field-initializers -Wno-reorder-ctor
  -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function
  -pedantic -DVKF_X64_BACKEND_LIBRARY -I. -Inative/VfOverlay
  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
  compiler/native/vkf_x64_artifact.cpp native/VfOverlay/vf/json.cpp
  -o C:/w/qopt12-clang/vkf_retained_optimization_driver_integration_test.exe
```

Clang 22.1.4 compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

A clean `C:\w\qopt12` Visual Studio 2019/MSVC 19.29 x64 Release
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
artifacts and measured the unchanged successful pair:

```text
Clang: pair_candidates=2 pair_selected=scalar serial_median_ns=7.24425e+07 threaded_median_ns=3.93324e+07 changed_pair_candidates=2 right_error_candidates=2 right_error_selected=scalar concurrent_error_candidates=2
MSVC:  pair_candidates=2 pair_selected=scalar serial_median_ns=8.72208e+07 threaded_median_ns=4.0746e+07 changed_pair_candidates=2 right_error_candidates=2 right_error_selected=mask-0 concurrent_error_candidates=2
```

Both compilers proved exact serial/threaded outcomes for the right-only and
simultaneous-error pairs. The right-only candidate was faster under Clang and
slower under MSVC, so the retained selections correctly differed. This is
apply-only-on-measured-win evidence, not a portable speed claim.

Final SHA-256 receipts:

```text
a295916b520c50b0acfdf6112873604e5ed78cde001cc41f52b18e78ba1c797b  compiler/native/vkf_adaptive_optimizer.hpp
808b4e2db18cf90ef503dd55f890b22a9494bb9768a24d00be1e7bfcffc1b9dc  compiler/native/vkf_adaptive_optimizer_contract_test.cpp
79588f835da6117bfbaed68547421ec7fd4f32b770377ce49a1170f74b249e26  compiler/native/vkf_optimization_dependency_gate.hpp
75b89e5f09295c82392057f5ec87b6c5393a127b5ed37386a4dcafa63a29c1a2  compiler/native/vkf_optimization_dependency_gate_test.cpp
3936be1bc98f323b0dd206f4354de63fb10d1061b05aa757a500d695e5121325  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
c54feb29ba82f6ecd646a2511dba91846f51acf7f2572e32271a2c742f192f5d  compiler/native/vkf_x64_artifact.cpp
150b36abcd1a9fa057339c24984a9f85ee873d6cb456a7d406f6d1078ca1542a  docs/architecture/automatic-flow-scheduling.md
0a39df0ff7b72eccd5b792132c7b04c6fb2f2e3f01e5c8dd15d9b7ce16e00f6a  clang/vkf_optimization_dependency_gate_test.exe
709ea25687bcbd3ff077095b97ff32dac6e9cd8506b1afaddcab9df6dcd6696a  clang/vkf_adaptive_optimizer_contract_test.exe
5c5095b358929f91ee8e6b05533c4f42a6cce1f8c07d1c776560588fffdec15f  clang/vkf_retained_optimization_driver_integration_test.exe
c2b32d5100d96ece99b815729bec1e6e82cbfb0e10b28beb8201101e87c0fc26  msvc/vkf_optimization_dependency_gate_test.exe
25a835da4d940c4f4048240e23cdecc5104cbbf78eea83a0db915ba3338a611e  msvc/vkf_adaptive_optimizer_contract_test.exe
5efc8f60be1dfa57a7d3a999017278f51d274f4fc4e078026d414af2e2b46f26  msvc/vkf_retained_optimization_driver_integration_test.exe
ff8cf308c4c8c492f2da452befa7a1b041585f5402637e108c789c6d3d4b0f50  msvc/vkf_x64_artifact.exe
```

## Limits and remaining gates

- Only one static terminal `AssertTruthy` per otherwise-pure root is admitted.
  Handled, dynamic-message, nested/transitive, resource-owning, and other error
  shapes remain fail-closed.
- Cancellation is cooperative completion plus mandatory join/cleanup. There is
  no polling protocol or safe preemption for long-running work yet.
- Only the exact Windows x64 two-result pair executes concurrently. POSIX,
  wider results, GPU scheduling, deterministic parallel reductions, and wider
  failure-aware scheduling remain separate declared-scope gates.
- The timing rows are independent compiler builds on one host, not the
  separately owned ADR-0010/T4 exclusive-runner verification required for a
  release-wide performance claim.

## Lane estimate

The bounded quantum optimization lane remains estimated at **99% complete**,
with high confidence (about +/-1 point). Explicit 100-point weighting:
audit/model 10/10; statistical proof and exact parity 20/20; bounded one-shot
exploration 15/15; retained reuse 15/15; dependency/value/borrow/error-safe
composition and parallel eligibility 15/15; explicit failure reporting 10/10;
shipped integration plus independent performance evidence 14/15.

It is intentionally not reported as 100%. Independent T4 and the declared
target/result/reduction/cancellation scope gates above are not closed. No
Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
