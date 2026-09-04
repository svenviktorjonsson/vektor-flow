# QOPT-06: transitive call/effect gate

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `4a0fe0e6c4e12f0d153917e129d4d732655a8622` (QOPT-05).
- Branch: `codex/quantum/qopt06-transitive-effect-gate`.
- Worktree: `.worktrees/quantum/qopt06-transitive-effect-gate`.
- Consumed contracts: QOPT-01 through QOPT-05 private proof,
  composition, and dependency contracts.
- Public VKF syntax, semantics, APIs, diagnostics, manifest schemas, and ABIs:
  unchanged.
- No new parallel path is enabled. Explicit research `tune` is unchanged.

Owned paths:

- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_adaptive_optimizer_contract_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `docs/evidence/qopt06-transitive-call-effect-gate.md`

## Correctness gate

QOPT-05 rejected direct calls but did not summarize their callees. QOPT-06
walks each automatic CPU-pair root transitively and records its deterministic
closure names. The receipt distinguishes:

- `unresolved-call`: a direct or transitive symbol cannot be resolved;
- `recursive-call-graph`: the closure contains a cycle;
- `transitive-ordered-effect`: a resolved callee contains a known ordered
  effect;
- `transitive-fallibility`: a function or instruction can fail;
- `transitive-owned-resource`: a callee owns list or string storage;
- `transitive-unclassified-operation`: an opcode has no private scalar-pure
  effect summary; and
- `call-graph-dependency`: the closure is completely resolved and proven
  scalar-pure, but value/dependency independence is still absent.

`effect_knowledge_complete` is false for unresolved symbols, recursion, and
unclassified operations. `effects_proven_absent` is true only after every
operation in a completely resolved acyclic closure belongs to the private
scalar-pure whitelist. Both CPU roots retain direct and transitive dependency
names in the private receipt. Effect-reason reduction is monotonic and
order-independent: an unclassified operation cannot be downgraded by a later
known ordered effect.

The production automatic CPU-pair selector already consumes this receipt from
QOPT-05. Consequently, every reason above keeps execution serial. Even a
complete pure call graph remains serial because complete effect knowledge is
necessary but not sufficient to prove value independence.

QOPT-04 per-leaf composition remains limited to direct call-free functions.
Parameterized and call-connected programs continue through QOPT-03's serial
whole-entry adapter, which emits exactly baseline `mask-0` plus guided
`mask-ff` on a miss and retains paired bit-exact parity/proof/no-fallback
behavior. The private toolchain revision is `x64-emitter-qopt06`, preventing an
older receipt from authorizing the changed analysis boundary.

## Vertical TDD receipt

1. Direct unresolved-call RED failed to compile because
   `effect_knowledge_complete` and `UnresolvedCall` did not exist. GREEN
   reported `unresolved-call`, no independence, and no parallelism.
2. Transitive unresolved-call RED compiled but exited 1:

   ```text
   an unresolved transitive call must reject parallelism before selection
   ```

   GREEN walked the nested closure and rejected the missing grandchild.
3. Ordered-effect RED failed to compile because
   `TransitiveOrderedEffect` and `effects_proven_absent` did not exist. GREEN
   resolved the graph, exposed the known effect, and kept the pair serial.
4. Recursive-graph RED failed to compile because `RecursiveCallGraph` did not
   exist. GREEN detected the active DFS cycle and marked effect knowledge
   incomplete.
5. Fallibility and owned-resource REDs each failed to compile for their missing
   explicit reasons. Their GREENs propagated the callee property to the pair
   receipt without enabling parallelism.
6. Unclassified-operation RED failed to compile because
   `TransitiveUnclassifiedOperation` did not exist. GREEN used a conservative
   scalar-pure opcode whitelist; a resolved `SystemCpuCount` was no longer
   mistaken for proven effect-free work.
7. Transitive-closure RED failed to compile because the per-function receipt
   lacked `transitive_dependencies`. GREEN recorded `shared -> leaf` in stable
   traversal order.
8. Production selector GREEN used two heavy loop roots calling a resolved
   `WriteString` helper. The receipt reported `transitive-ordered-effect`, and
   parallel selection remained false.
9. Mixed-effect order RED exited 1 when `SystemCpuCount` followed by
   `WriteString` was incorrectly reported as a complete known ordered effect:

   ```text
   an unclassified operation must keep the pair serial regardless of later known effects
   ```

   GREEN reduced effect reasons by conservative precedence, so unclassified
   knowledge remains incomplete regardless of instruction/traversal order.

Strict header/contract Clang command:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I. compiler/native/<test>.cpp -o .work/qopt06/<test>.exe
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
  -o .work/qopt06/vkf_retained_optimization_driver_integration_test.exe
```

Final focused outputs:

```text
optimization dependency gate: reason=call-graph-dependency pair=unresolved-call independent=1 pure_call=call-graph-dependency
retained optimization composition: functions=2 unchanged=function-hit changed=function-mismatch reason=all-proven
retained optimization driver: cache=missing candidates=2 retained=program-hit parity=incorrect-output changed=function-mismatch slower=measurement-rejected store=io-error
retained optimization cache: stored=1 program_hit=1 function_hit=1 atomic_reject=1 corrupt_reject=1 selected=1
retained optimization schedule: reused_program=1 reused_function=1 changed_candidates=2 faster_ratio=0.699927 parity_blocked=1
retained optimization driver integration: candidates=4 incremental_candidates=2 exact_output=1 call_candidates=2
```

## Native verification

Environment:

```text
Microsoft Windows 10.0.26200, X64
Clang 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
MSVC 19.29.30159.0
CMake 4.3.0
```

Strict Clang compiled and passed:

- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_composition_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_cache_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_driver_integration_test`

From the clean short build path `C:\w\qopt06`, MSVC Release built the same
seven tests plus standalone `vkf_x64_artifact`. All seven tests passed. The
real independent and call-graph integration artifacts retained exact output.

Final SHA-256 receipts:

```text
244674c0f4e2f5654d498af7eab292654c9f6f251df14ae88e654bc65e0437ee  compiler/native/vkf_optimization_dependency_gate.hpp
8b8b598b4b42c11bfd032b6816683060b14b4b4893e97303c8932863cbfa4c0d  compiler/native/vkf_optimization_dependency_gate_test.cpp
32a6f2e34e5ac0fffcf3c1ff2d6d925c11f235749a2a794850ca029fb1d04703  compiler/native/vkf_adaptive_optimizer_contract_test.cpp
8ec188f068dd094d2e738d996833b7665182313734a7888920293b4706cd2eac  compiler/native/vkf_x64_artifact.cpp
ddb436a90207615ea21698c42c33379663c24c562946f491aef614b8e4dc16eb  clang/vkf_optimization_dependency_gate_test.exe
234321f3e4fa7be922ec5326271ec9a16d8517d71acff6fb4d90420fbd6cd893  clang/vkf_adaptive_optimizer_contract_test.exe
83cb3e431f9fa5d72a29e359127e347ca54e40c1e046db438907cc057bf09d39  clang/vkf_retained_optimization_driver_integration_test.exe
0e3c4f975e113ea09eb74f685f8d71bf9c256f49ee2c0843ffa5c12245be2c56  msvc/vkf_optimization_dependency_gate_test.exe
501f6f7448a28fbbab035ec81d7341071d156ba12ad316e0f0ee05707e6a5e2b  msvc/vkf_adaptive_optimizer_contract_test.exe
c6e895af333b8e9fdfa0e5e77dcd29db2e1a65f7e76cd170b8b02f29e6474b77  msvc/vkf_retained_optimization_driver_integration_test.exe
b2d5bad981a5ecef5889b071f76e3fe0df6a3ac530e475edec32a56d3bb4dbbb  msvc/vkf_x64_artifact.exe
```

This is a correctness packet, not a performance claim. It deliberately adds
no parallel work, and the call-graph integration continues to emit two serial
proof candidates. Independent ADR-0010/T4 performance evidence remains
required for release claims.

## Limitations and next gates

- The pure whitelist intentionally covers only scalar numeric/local/control
  operations. Other operations remain `transitive-unclassified-operation`
  until they receive an audited effect summary.
- Complete pure call graphs remain serial because parameter/value aliasing and
  dependency flow are not yet proven.
- QOPT-04 composition still selects one global compatible policy and serially
  measures misses. No mixed-policy ABI or parallel measurement was added.
- Negative speed decisions are not retained; expiry/invalidation policy is
  still required before doing so safely.
- Concurrent cache stress, admission/pruning, crash durability,
  GPU/reduction/cancellation scheduling, and independent T4 evidence remain.

The next smallest prerequisite is a private parameter/value dependency summary
with conservative alias classes. Only disjoint, effect-free, completely
resolved closures may advance to a measured parallel candidate.

## Lane estimate

The quantum optimization lane is estimated at **93% complete**, with medium
confidence (about +/-5 points). There is no canonical quantum-lane roadmap, so
the explicit 100-point gate weighting is: audit/model 10/10; statistical proof
and exact parity 20/20; bounded one-shot exploration 15/15; retained reuse
15/15; dependency-safe composition/parallel execution 14/15; explicit failure
reporting 10/10; shipped integration plus independent performance evidence
9/15.

No Language Design Authority decision is required. This packet is
independently revertible and is not merged or pushed.
