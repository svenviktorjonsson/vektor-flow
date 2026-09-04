# QOPT-10: parameter provenance and borrow proof

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `9a20e8e4aa058b2f405e90908a08677d2dcfde4b` (QOPT-09).
- Branch: `codex/quantum/qopt10-parameter-borrow-proof`.
- Worktree: `.worktrees/quantum/qopt10-parameter-borrow-proof`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- QOPT-09's exact parity, paired statistical proof, two-candidate miss,
  retention policy, and hard-failure/no-fallback boundary: unchanged.

Owned paths:

- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/architecture/automatic-flow-scheduling.md`
- `docs/evidence/qopt10-parameter-borrow-proof.md`

## Private correctness contract

QOPT-10 extends only the inside of the QOPT-09-proven two-root closure. The
entry and both heavy roots remain zero-argument scalar functions. A nested
parameterized call may now enter the benchmark candidate when every argument
is an immediately preceding `PushF64`, every required parameter is present,
and the callee metadata proves an `f64` value passed by value into the matching
read-only scalar local slot.

The private receipt adds:

- `parameter_provenance_complete`;
- `borrow_regions_complete`; and
- `mutable_borrows_proven_disjoint`.

The new explicit serial reasons are `parameter-provenance-unknown` and
`mutable-borrow-unknown`. Computed or missing arguments, parameter-count/mask
mismatch, defaults, ownership flags, missing or inconsistent scalar metadata,
non-scalar results, address/aggregate parameters, and stores into parameter
slots remain serial. Existing effect, fallibility, resource, recursion,
unresolved-call, and general alias reasons remain conservative.

Admitted scalar arguments have no shared borrow region: the callee receives
the value in its private stack frame, and the analysis rejects parameter-slot
writes. Shared immutable function code remains safe. Any mutable or unknown
region blocks the pair before benchmarking.

Once admitted, the production adapter still benchmarks only `serial-mask-0`
and otherwise-identical `threaded-scalar`, with no more than five paired
samples/ten artifact runs. Both ordered results must match bit-for-bit. The
threaded candidate is selected only on the retained measured win. A rejected
or inapplicable proof stays explicitly serial; runtime thread failure aborts
and never silently falls back.

The exact function/dependency graph, host, and `x64-emitter-qopt10` toolchain
fingerprints scope retention. An unchanged parameterized graph reuses its
decision across a surrounding source-fingerprint change. A semantic change to
the parameterized helper body forces exactly the bounded two-candidate proof.

## Vertical TDD receipt

1. Parameter-provenance RED failed strict compilation because the private
   receipt did not expose the three new facts:

   ```text
   error: no member named 'parameter_provenance_complete'
   error: no member named 'borrow_regions_complete'
   error: no member named 'mutable_borrows_proven_disjoint'
   ```

   GREEN admitted two closures that pass distinct literal scalar values into
   the same fully described read-only scalar helper.
2. The adjacent rejection tracer proves an address parameter leaves borrow and
   alias knowledge incomplete, reports `mutable-borrow-unknown`, and keeps
   parallelism false. The older missing-argument case now reports the more
   precise `parameter-provenance-unknown` reason.
3. The production QOPT-09 fixture was converted to a real parameterized shared
   helper. It measured exactly the serial and threaded candidates, preserved
   ordered exact output `42`, `43`, and retained the measured decision.
4. The first dependency-invalidation RED reported:

   ```text
   a changed transitive dependency fingerprint must invalidate the pair proof and remeasure exactly two candidates
   changed_pair_candidates=0
   ```

   That mutation changed only an unused `f64` field on `LoadLocal`; canonical
   Machine IR correctly ignored it. GREEN inserts a real `PushF64`/`AddF64`
   helper-body change and observes exactly two candidates again.
5. Changing only the surrounding source fingerprint yields zero candidates,
   the same retained policy, and the same machine-code fingerprint.

## Verification

Strict focused Clang command pattern:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o C:/w/qopt10-clang/<test>.exe
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
  -o C:/w/qopt10-clang/vkf_retained_optimization_driver_integration_test.exe
```

Clang 22.1.4 compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

A clean `C:\w\qopt10` MSVC 19.29 x64 Release configuration compiled the same
seven tests plus standalone `vkf_x64_artifact`; all seven tests passed.

Salient common output:

```text
optimization dependency gate: reason=call-graph-dependency pair=unresolved-call independent=1 pure_call=independent parameter_pair=independent borrow=mutable-borrow-unknown
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected negative=negative-program-hit negative_function=negative-function-hit expired=negative-expired store=io-error
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 concurrent=1 superseded=8 process_concurrent=1 deterministic_tie=1 selected=1
```

Independent exact-source compiler builds both measured a win for this exact
parameterized fixture on this host and therefore selected the threaded policy:

```text
Clang: pair_candidates=2 pair_selected=scalar serial_median_ns=7.20792e+07 threaded_median_ns=4.98794e+07 changed_pair_candidates=2
MSVC:  pair_candidates=2 pair_selected=scalar serial_median_ns=6.99508e+07 threaded_median_ns=4.12994e+07 changed_pair_candidates=2
```

Those medians are approximately 30.8% and 41.0% below their serial baselines.
They prove the local apply-on-win path only; they are not a portable or
release-wide speed claim.

Final SHA-256 receipts:

```text
1c69c1d966aaa61283abe0ac4912aee533c4e310d1c64707ab4a8d0ce51ee69b  compiler/native/vkf_adaptive_optimizer.hpp
32f78d2e47742fb08d2e094c86dc267ba38db099a796dab0fbfc685a2e24e591  compiler/native/vkf_optimization_dependency_gate.hpp
e0160963df615b531995afd860da83c8893b6183b44fe073f85ec2e64c65107e  compiler/native/vkf_optimization_dependency_gate_test.cpp
c5542d665490196f93874871c2c1e8f75125d3101128330ec1e0e4e5105661f9  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
1b1469e7a3854edc8bbb6423620a5c503a3616184b05fb22b062552e10ee5c5b  compiler/native/vkf_x64_artifact.cpp
2888812dbf7dce405f9c4912fd71608b0f0fc2596abb73e825c52f955bf5412a  docs/architecture/automatic-flow-scheduling.md
51b702eaa1becda2f98e477d353379b1ba8ae87ee771cd5a8bdf4a5d2e934fec  clang/vkf_optimization_dependency_gate_test.exe
f9c0fc7fb6d5b2f1e5ac43a8b8d45421e7fe5f1d92b650dc659f8df6c76d3558  clang/vkf_adaptive_optimizer_contract_test.exe
484e3d587abecc83da15b46d5b7205504abde1def365ffd4f9c4aed8fd1636e8  clang/vkf_retained_optimization_driver_integration_test.exe
1edb4e2ccdf196363813f0b57676a85fccb7e4c98d76a9d9c678aa654d595a8b  msvc/vkf_optimization_dependency_gate_test.exe
a050b1ed65a3f4527cb772d4059b7ed748bd71dfdbfa32232676521211579f36  msvc/vkf_adaptive_optimizer_contract_test.exe
9f2ea8ab1e98df409b2d6a35cf0c3a2c86b41d2957a7f65d7f8d4906bda72379  msvc/vkf_retained_optimization_driver_integration_test.exe
18e9ff1b8733949068145b2b3acff2ca21c46184877dc0baf7bd8c3cf767b911  msvc/vkf_x64_artifact.exe
```

## Limits and next gates

- Parameterized entry/root calls remain serial; the threaded entry ABI still
  receives exactly two zero-argument root demands.
- Only immediate literal `f64` provenance is admitted. Pure computed values,
  immutable scalar locals, multi-level parameter forwarding, defaults, wider
  scalar classes, and more than 32 parameters remain serial until separately
  proven.
- Address/aggregate parameters, ownership transfer, parameter-slot writes, and
  incomplete borrow metadata remain `mutable-borrow-unknown` or
  `mutable-alias-unknown`.
- Only the exact Windows x64 two-result shape executes concurrently. POSIX,
  wider results, GPU scheduling, stable reductions, and cancellation/failure
  scheduling remain separate proof gates.
- The two timing rows are independent compiler builds on one host. A separately
  owned ADR-0010/T4 exclusive-runner verification remains necessary before any
  release-wide performance claim.

## Lane estimate

The bounded quantum optimization lane is estimated at **99% complete**, with
high confidence (about +/-1 point). Explicit 100-point weighting: audit/model
10/10; statistical proof and exact parity 20/20; bounded one-shot exploration
15/15; retained reuse 15/15; dependency/value/borrow-safe composition and
parallel eligibility 15/15; explicit failure reporting 10/10; shipped
integration plus independent performance evidence 14/15.

No Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
