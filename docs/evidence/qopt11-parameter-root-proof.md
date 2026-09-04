# QOPT-11: parameterized entry/root provenance proof

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `b6d4d233e4fe1333d75d15ad755ad9dca6b67094` (QOPT-10).
- Branch: `codex/quantum/qopt11-parameter-root-proof`.
- Worktree: `.worktrees/quantum/qopt11-parameter-root-proof`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- QOPT-10's exact parity, paired statistical proof, bounded two-candidate
  miss, retained proof policy, and hard-failure/no-fallback boundary:
  unchanged.

Owned paths:

- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/architecture/automatic-flow-scheduling.md`
- `docs/evidence/qopt11-parameter-root-proof.md`

## Private correctness contract

QOPT-11 extends the QOPT-10 proof to the entry/root boundary for one exact
shape. The two independent heavy roots may each receive exactly one immediate
`PushF64` argument. Each root must describe the corresponding parameter as a
numeric scalar in matching local slot zero, return one numeric scalar, and
leave the parameter slot read-only. The existing complete call-graph, effect,
fallibility, resource, value, and alias proof still applies to both closures.

The selected Windows x64 artifact puts the worker argument and result in
separate private context slots and the caller argument and result in its own
frame slots. Both roots therefore receive their declared value through the
ordinary internal call ABI. The join remains before observation and the two
result bit patterns remain in source order.

Computed or forwarded arguments, missing/defaulted parameters, ownership
transfer, parameter writes, address/aggregate parameters, inconsistent
metadata, multiple parameters, and other entry shapes remain serial.
Provenance failures report `parameter-provenance-unknown`; ownership and
mutable-region failures report `mutable-borrow-unknown`. Thread creation or
join failure still aborts, never falls back to serial execution.

On a proof miss, production still measures only `serial-mask-0` and
`threaded-scalar`, at most five paired samples/ten artifact runs. Every ordered
result must be bit-exact before selection, and the threaded candidate applies
only on a measured statistical win. The complete Machine IR module (including
entry literals), source/program identity, host, and `x64-emitter-qopt11`
toolchain fingerprints scope retained reuse. A source-only surrounding change
reuses the unchanged proof; a transitive helper-body change remeasures exactly
the two candidates.

## Vertical TDD receipt

1. The production fixture was first changed to pass distinct entry literals
   `42` and `43` into the two parameterized roots. Against QOPT-10 it failed:

   ```text
   literal scalar arguments to independent read-only roots must benchmark one threaded candidate against the serial baseline
   pair_candidates=0
   ```

   The old test subsequently accessed the absent candidate row; GREEN also
   adds a bounded early return so a future eligibility regression fails cleanly.
2. The dependency gate now proves only the exact entry literals and read-only
   scalar root regions. Dedicated negative assertions keep computed,
   forwarded, defaulted, owned, address, and aggregate arguments serial with
   the explicit provenance or borrow reason.
3. The private pair-shape parser accepts the original zero-argument shape and
   the new exact one-literal-per-root shape. The x64 emitter transfers each
   literal through isolated argument/result slots. The real artifact prints
   exact ordered output `42`, `43`.
4. A source-fingerprint-only change yields zero candidates and the same
   retained policy/machine-code fingerprint. A semantic change in the shared
   transitive helper yields exactly two new candidates.

## Verification

Strict focused Clang command pattern:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o C:/w/qopt11-clang/<test>.exe
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
  -o C:/w/qopt11-clang/vkf_retained_optimization_driver_integration_test.exe
```

Clang 22.1.4 compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

A clean `C:\w\qopt11` Visual Studio 2019/MSVC 19.29 x64 Release
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

Two independently compiled production tests on this host both measured a win
for this exact fixture and selected the threaded policy:

```text
Clang: pair_candidates=2 pair_selected=scalar serial_median_ns=2.86799e+07 threaded_median_ns=1.85629e+07 changed_pair_candidates=2
MSVC:  pair_candidates=2 pair_selected=scalar serial_median_ns=6.98284e+07 threaded_median_ns=4.76851e+07 changed_pair_candidates=2
```

The candidate medians are approximately 35.3% and 31.7% below their serial
baselines. They prove only the local apply-on-win behavior; they are not a
portable or release-wide performance claim.

Final SHA-256 receipts:

```text
d964a2fa25c917608d50d52d64f5ed88e8aacc5d478751df398ce6260f4a7ab0  compiler/native/vkf_adaptive_optimizer.hpp
a681763e310a9deffdda21d55add25af9f8dad1bcdaf025c957ea0c0b4364a81  compiler/native/vkf_optimization_dependency_gate.hpp
8f38adbc9dab9e2b15a6aa2654bee4a640f7e9bdd00fe1373c9317ad509f6fc7  compiler/native/vkf_optimization_dependency_gate_test.cpp
11f6c5582e1d31c8855b971052e592359ad4e16b8d14d34470770f6013223caf  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
12ab14b7d4218b9f221d8fbae8c9b059a79f395e6854d4bee942511647d149a4  compiler/native/vkf_x64_artifact.cpp
39297ea4ac8a69d83ae605860fae141a8984f99dec9fc232382beee5651e6acf  docs/architecture/automatic-flow-scheduling.md
d59767aa35bbd7dce57b6fb8df1cde8152df3056a5cb40726d79654a27785a75  clang/vkf_optimization_dependency_gate_test.exe
a6583d46ac5d8110c1fda00ca8cf54aa98115873616e4db6c5437275eb89d617  clang/vkf_adaptive_optimizer_contract_test.exe
b3646f39fc3c79cd5dd1bd7222c8d132228b875a8bf9c4d0bc6878df8443adbb  clang/vkf_retained_optimization_driver_integration_test.exe
289132a2cbadfb6719a3faac7e6d73e0b0b143a4bc5000865c76d0e97e36a918  msvc/vkf_optimization_dependency_gate_test.exe
9c1bdd819520c1b6a2ca710dc601cf2a9107489974ba361fc9daaea52fc9ad6b  msvc/vkf_adaptive_optimizer_contract_test.exe
23ca057629ad93fbb5b2ec3a4036325b7331965d25d8c562aca29def5f2323fb  msvc/vkf_retained_optimization_driver_integration_test.exe
f5f204db659424e988edb88506aa3433841050f6ee17a72d8f8c3c89e4c77a34  msvc/vkf_x64_artifact.exe
```

## Limits and remaining gates

- Only one immediate `f64` argument per root is admitted. Pure computed
  values, immutable local forwarding, multiple/default parameters, wider
  scalar classes, and multi-level forwarding remain serial.
- Address/aggregate inputs, ownership transfer, parameter-slot writes, and
  incomplete borrow metadata remain fail-closed.
- Only the exact Windows x64 two-result shape executes concurrently. POSIX,
  wider results, GPU scheduling, deterministic parallel reductions, and
  cancellation/failure scheduling remain separate declared-scope gates.
- The two timing rows are independent compiler builds on one host, not the
  separately owned ADR-0010/T4 exclusive-runner verification required for a
  release-wide performance claim.

## Lane estimate

The bounded quantum optimization lane remains estimated at **99% complete**,
with high confidence (about +/-1 point). Explicit 100-point weighting:
audit/model 10/10; statistical proof and exact parity 20/20; bounded one-shot
exploration 15/15; retained reuse 15/15; dependency/value/borrow-safe
composition and parallel eligibility 15/15; explicit failure reporting 10/10;
shipped integration plus independent performance evidence 14/15.

It is intentionally not reported as 100%. Independent T4 and the declared
target/result/reduction/cancellation scope gates above are not closed. No
Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
