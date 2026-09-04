# QOPT-09: production serial-versus-threaded pair proof

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `65c4dace1804d4cec2dadc701eebf15066f4697b` (QOPT-08).
- Branch: `codex/quantum/qopt09-production-pair-proof`.
- Worktree: `.worktrees/quantum/qopt09-production-pair-proof`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- Explicit research `tune`, cache format, proof thresholds, and unsupported
  target behavior: unchanged.

Owned paths:

- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/architecture/automatic-flow-scheduling.md`
- `docs/evidence/qopt09-production-pair-proof.md`

## Private correctness contract

The Windows production x64 adapter now benchmarks the QOPT-08-proven
independent two-result graph as one serial baseline and one otherwise-identical
threaded candidate. Both emit with the all-disabled optimization mask; the
private `mask-0`/`scalar` policy names distinguish the retained choices while
the automatic CPU-pair emitter flag is the only code-generation difference.

The pair is admitted only when all of these facts hold:

- the QOPT-08 dependency, value, alias, effect, and replay-safety proof admits
  the exact pair;
- both roots exceed the conservative static-work floor;
- the output shape is exactly two numeric results; and
- the target is Windows x64, where the emitted candidate has the production
  thread runtime bindings.

A miss runs at most five paired samples: ten artifact invocations total, not a
256-policy search. Each sample compares the ordered vector of both result bit
patterns. The threaded candidate is retained and applied only when the existing
paired proof reports exact parity, sufficient samples, and a measured win.
Otherwise the receipt retains serial execution explicitly. Runtime thread
creation or join failure aborts; a selected threaded artifact does not silently
fall back to serial execution.

The retained identity includes the exact Machine IR module, including function
bodies and the resolved dependency graph, plus host and `x64-emitter-qopt09`
toolchain fingerprints. A changed surrounding source-graph fingerprint can
therefore reuse an unchanged graph proof without remeasurement. Changing the
shared transitive helper changes the function fingerprint and forces exactly
the bounded two-candidate measurement again.

POSIX and unsupported result shapes remain serial. No general speedup is
inferred from eligibility or from this host's measurements.

## Vertical TDD receipt

1. Production-pair RED compiled and failed with:

   ```text
   an independent multi-result graph must benchmark one threaded candidate against the serial baseline
   ```

   The diagnostic ended with `pair_candidates=0`.
2. GREEN routed the proven graph through the retained driver and emitted an
   actual threaded candidate. The receipt contained exactly
   `serial-mask-0` and `threaded-scalar`; both were tested, both were bit-exact,
   and the total run budget was at most ten.
3. Reuse RED initially remeasured because unrelated fixtures shared one debug
   proof pathname. The production-shaped fixture now has its own `pair.vkf`
   proof identity. Changing only the surrounding source fingerprint produces
   zero candidates, the same retained policy, and the same machine-code
   fingerprint.
4. Changing one instruction in the shared transitive helper invalidates the
   function/dependency fingerprint and produces exactly two candidates again.
5. The final produced native artifact exits successfully and prints the exact
   ordered results `42` then `43`.

## Verification

Strict focused Clang command pattern:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o C:/w/qopt09-clang/<test>.exe
```

The real-backend integration retained `-Werror` and suppressed only the
translation unit's pre-existing warning classes:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror
  -Wno-missing-field-initializers -Wno-reorder-ctor
  -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function
  -pedantic -DVKF_X64_BACKEND_LIBRARY -I. -Inative/VfOverlay
  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
  compiler/native/vkf_x64_artifact.cpp native/VfOverlay/vf/json.cpp
  -o C:/w/qopt09-clang/vkf_retained_optimization_driver_integration_test.exe
```

Clang 22.1.4 compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

A clean `C:\w\qopt09` MSVC 19.29 x64 Release configuration compiled the same
seven tests plus standalone `vkf_x64_artifact`; all seven tests passed.

Salient common output:

```text
optimization dependency gate: reason=call-graph-dependency pair=unresolved-call independent=1 pure_call=independent
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected negative=negative-program-hit negative_function=negative-function-hit expired=negative-expired store=io-error
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 concurrent=1 superseded=8 process_concurrent=1 deterministic_tie=1 selected=1
```

The independent compiler builds both measured a win for this exact fixture and
therefore selected the threaded policy on this host:

```text
Clang: pair_candidates=2 pair_selected=scalar serial_median_ns=4.29431e+07 threaded_median_ns=2.77714e+07 changed_pair_candidates=2
MSVC:  pair_candidates=2 pair_selected=scalar serial_median_ns=4.47448e+07 threaded_median_ns=3.02735e+07 changed_pair_candidates=2
```

Those medians are approximately 35.3% and 32.3% below their serial baselines.
They are implementation evidence for the apply-on-win gate, not a portable or
release-wide performance claim.

Final SHA-256 receipts:

```text
627ba778fdbdccef19103afecba88e32f92832956053f4dbe86f99c6611ad5b9  compiler/native/vkf_adaptive_optimizer.hpp
b75d74e85771af688cc96e2e1a8b57500f1971fcb9ce8d4d83f04caa87dc48e9  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
7fc27d79bbfca0b352534db6a4111391e0a9cdffa1ba107267ef5b898d7ae852  compiler/native/vkf_x64_artifact.cpp
899ad94bb32e695e50b5458ceb8ed9cb376f0519477d7f3925c392063265d81a  docs/architecture/automatic-flow-scheduling.md
c8348b1f377470837115eee6b3b55bff728155757928e2ab4551c7d9840c9ff9  clang/vkf_optimization_dependency_gate_test.exe
4b2e960a32626bc844247ba2dc96ced538f217df7425da01afafe8d6173cec6d  clang/vkf_adaptive_optimizer_contract_test.exe
7b962f564a81c9a6b9805bccc8e396b72dc30f262206e86e550526cd2a6bba33  clang/vkf_retained_optimization_driver_integration_test.exe
a160372ca522f91a32bcad421ea5035f3180242059a504389b60fe533146bb58  msvc/vkf_optimization_dependency_gate_test.exe
2dd5e9e15db92c41410459de43980ee465fb93d99c7389964815ab4792ec5dcc  msvc/vkf_adaptive_optimizer_contract_test.exe
3589cd0950b06c7b93f4375b249a064b1c0c9ad067d0e7f65cb4336f2933f55a  msvc/vkf_retained_optimization_driver_integration_test.exe
b11fb139f40f42121b2a65bc4cb93195bd468c0cd8ab228e0b861ad735e3ebf6  msvc/vkf_x64_artifact.exe
```

## Limits and next gates

- Only the exact Windows x64 two-`f64` production shape is benchmarked and
  emitted concurrently. POSIX, wider result sets, parameterized graphs,
  address/aggregate aliases, and incomplete graph knowledge remain serial.
- The two compiler builds are independent code-generation/timing runs on one
  host. ADR-0010/T4 still requires a separately owned performance run before a
  release-wide speed claim.
- GPU scheduling, stable reductions, partition cancellation/failure policy,
  and broader region scheduling remain separate proof gates.
- The retained proof is host- and toolchain-specific. A host, toolchain,
  function, or transitive dependency mismatch deliberately remeasures or stays
  serial; it never reuses an inapplicable threaded decision.

## Lane estimate

The quantum optimization lane is estimated at **98% complete**, with high
confidence (about +/-2 points). Explicit 100-point weighting: audit/model
10/10; statistical proof and exact parity 20/20; bounded one-shot exploration
15/15; retained reuse 15/15; dependency-safe composition and parallel
eligibility 15/15; explicit failure reporting 10/10; shipped integration plus
independent performance evidence 13/15.

No Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
