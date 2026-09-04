# QOPT-08: value and alias independence gate

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `3ee340124f6566771ffa3c41431e53d7495c80f9` (QOPT-07).
- Branch: `codex/quantum/qopt08-value-alias-gate`.
- Worktree: `.worktrees/quantum/qopt08-value-alias-gate`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- Explicit research `tune`, proof thresholds, cache policy, exact parity, and
  the production two-candidate miss policy: unchanged.

Owned paths:

- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_adaptive_optimizer_contract_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/evidence/qopt08-value-alias-independence-gate.md`

## Private correctness contract

QOPT-08 advances only a narrow resolved-function-graph class. A CPU pair can
now receive an independence proof when both closures are acyclic, completely
resolved, effect-free, zero-argument scalar computations whose local metadata
contains only scalar value classes. Calls may share immutable function code;
each invocation owns its stack frame and no mutable resource crosses the
closures.

The receipt records four independent facts:

- `value_knowledge_complete`;
- `values_proven_independent`;
- `alias_knowledge_complete`; and
- `mutable_aliases_proven_disjoint`.

It also records `resolved_call_graph` after the closure is successfully
resolved. Parameter or argument flow reports `value-dependency`. Address or
aggregate locals, including incomplete local-class metadata, report
`mutable-alias-unknown`. Both reasons keep composition and parallelism false.
The earlier unresolved, recursive, fallible, ordered-effect, owned-resource,
and unclassified-operation reasons remain conservative and unchanged.

Resolved graphs do not use the legacy static-work selector. They require the
measured-proof overload and remain serial unless its paired decision has
`use_candidate=true`. The production x64 adapter does not yet possess an exact
serial-versus-threaded graph-pair benchmark receipt, so it deliberately calls
the no-proof overload and newly recognized graph shapes remain serial. This
packet therefore adds the proof gate without allowing static dependency facts
to masquerade as a performance proof.

The normal production whole-entry driver remains baseline `mask-0` plus one
guided `mask-ff` candidate on a miss. A real zero-argument pure call-graph
artifact measured exactly two candidates and retained bit-exact output. No
256-policy production search and no fallback from a rejected proof was added.
The toolchain identity advances to `x64-emitter-qopt08` so QOPT-07 receipts
cannot authorize the changed analysis boundary.

## Vertical TDD receipt

1. Pure-closure RED failed strict compilation because the receipt did not
   expose value/alias knowledge fields. GREEN resolved `left -> shared ->
   leaf`, proved the zero-argument scalar closure, retained stable dependency
   names, and enabled the private independence receipt.
2. Module-alias RED exited 1 with:

   ```text
   module composition must remain serial when a mutable alias class is not proven disjoint
   ```

   GREEN applied the same scalar-local alias boundary to call-free module
   composition.
3. Measured-graph RED failed strict compilation because
   `resolved_call_graph` and the measured selector overload did not exist.
   GREEN made an otherwise eligible pure graph remain serial without proof,
   select with a measured-faster decision, and remain serial with an
   insufficient-samples decision.
4. The selector integration uses two heavy roots that call the same resolved
   pure helper. Changing only that helper to contain an address-class local
   produces `mutable-alias-unknown` and rejects selection.
5. The production x64 integration compiles and runs a zero-argument pure call
   graph. Its private manifest contains exactly `mask-0`, `mask-ff`; both are
   tested/correct and the selected artifact prints the expected exact result.

## Verification

Strict focused Clang command:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I.
  compiler/native/<test>.cpp -o .work/qopt08-clang/<test>.exe
```

Strict real-backend Clang command retained `-Werror` and suppressed only the
translation unit's pre-existing warning classes:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror
  -Wno-missing-field-initializers -Wno-reorder-ctor
  -Wno-unused-parameter -Wno-unused-variable -Wno-unused-function
  -pedantic -DVKF_X64_BACKEND_LIBRARY -I. -Inative/VfOverlay
  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
  compiler/native/vkf_x64_artifact.cpp native/VfOverlay/vf/json.cpp
  -o .work/qopt08-clang/vkf_retained_optimization_driver_integration_test.exe
```

Strict Clang 22.1.4 compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

A clean `C:\w\qopt08` MSVC 19.29 x64 Release build compiled the same seven
tests plus standalone `vkf_x64_artifact`; all seven tests passed.

Salient output:

```text
optimization dependency gate: reason=call-graph-dependency pair=unresolved-call independent=1 pure_call=independent
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected negative=negative-program-hit negative_function=negative-function-hit expired=negative-expired store=io-error
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 concurrent=1 superseded=8 process_concurrent=1 deterministic_tie=1 selected=1
retained optimization driver integration: candidates=4 incremental_candidates=2 exact_output=1 call_candidates=2 pure_call_candidates=2
```

Final SHA-256 receipts:

```text
d9068c5908e771996fd6dc729583ec4af47e9ead261b10ca482a5b85d579af67  compiler/native/vkf_optimization_dependency_gate.hpp
ad8cf0a111c9fadf0fcaf3c74d9601956fe23f0d58410ecb1c72b44a018e25f4  compiler/native/vkf_optimization_dependency_gate_test.cpp
357d8d0e01f898766cc6f0d28a186f5244990a84de9393e2aff6614d1a305b2b  compiler/native/vkf_adaptive_optimizer.hpp
c2c9bf6be18d2b0552829d26026f6cd55c0e01d0271bf39e3d5b5619654ca5a5  compiler/native/vkf_adaptive_optimizer_contract_test.cpp
3a3ae117c153beaceaa0148e398443442b868736258f0b4f58f4467bd8b3e279  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
97473f858a35787c8063f0266bcd3d0c71601d817c23859185ba42371ce4d9df  compiler/native/vkf_x64_artifact.cpp
f30c25c6ee174c56ac52b3dcde7761c882e6c66525c54ebf1f9f8d2170a88451  clang/vkf_optimization_dependency_gate_test.exe
4434cf285966e3b4f1cf9254cce6a056c745c9a269d65992d12745432538f4c4  clang/vkf_adaptive_optimizer_contract_test.exe
db630dde32c0688282cd68f5c8f7df09891a4e9859416c8f1ac9441d3c0f97db  clang/vkf_retained_optimization_driver_integration_test.exe
7d4c4974c7a719b78ebc3b511fdca2ce202b979b04d9c82680dfcb84c8213414  msvc/vkf_optimization_dependency_gate_test.exe
1ff6ccd780eaa0805b5ab795c650ae694be993801c88fca4422b5645fe250b82  msvc/vkf_adaptive_optimizer_contract_test.exe
3767aea4a391f61a6f49ac7d64a45fcf1376cb0dac25b7c7d9fff61fec2f41ed  msvc/vkf_retained_optimization_driver_integration_test.exe
d9445b438d94106490a2dd8832c1f5bcda0357c78d5f5b1b1504d503d07f329b  msvc/vkf_x64_artifact.exe
```

## Limits and next gates

- Parameterized graphs remain serial. A future value-flow summary must prove
  exact argument provenance and non-aliasing before admitting them.
- Address/aggregate locals and missing local-class metadata remain
  `mutable-alias-unknown`; this packet does not infer borrow regions.
- The production x64 adapter does not yet benchmark the exact threaded
  multi-result artifact candidate. Consequently, QOPT-08 graph eligibility is
  exposed only through the measured private overload and production stays
  serial for these new shapes.
- Legacy call-free pair execution, GPU scheduling, stable reductions,
  cancellation/failure scheduling, and independent ADR-0010/T4 performance
  evidence remain separate gates.
- POSIX cache durability branches and power-loss behavior retain QOPT-07's
  platform limits.

## Lane estimate

The quantum optimization lane is estimated at **95% complete**, with
medium-high confidence (about +/-4 points). Explicit 100-point weighting:
audit/model 10/10; statistical proof and exact parity 20/20; bounded one-shot
exploration 15/15; retained reuse 15/15; dependency-safe composition and
parallel eligibility 15/15; explicit failure reporting 10/10; shipped
integration plus independent performance evidence 10/15.

No Language Design Authority decision is required. This packet is private,
independently revertible, and is not merged or pushed.
