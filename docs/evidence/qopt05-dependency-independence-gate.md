# QOPT-05: private dependency-independence gate

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `459d4ecbf1fb1802dd12033940f29a6a9ba24fec` (QOPT-04).
- Branch: `codex/quantum/qopt05-dependency-gate`.
- Worktree: `.worktrees/quantum/qopt05-dependency-gate`.
- Consumed contracts: QOPT-01 through QOPT-04 private proof and
  composition contracts.
- Public VKF syntax, semantics, APIs, diagnostics, manifest schemas, and ABIs:
  unchanged.
- Explicit research `tune` is unchanged. This packet changes only private
  automatic composition and CPU-pair eligibility.

Owned paths:

- `compiler/native/vkf_optimization_dependency_gate.hpp`
- `compiler/native/vkf_optimization_dependency_gate_test.cpp`
- `compiler/native/vkf_adaptive_optimizer.hpp`
- `compiler/native/vkf_adaptive_optimizer_contract_test.cpp`
- `compiler/native/vkf_retained_optimization_driver_integration_test.cpp`
- `compiler/native/vkf_x64_artifact.cpp`
- `compiler/native/CMakeLists.txt`
- `docs/evidence/qopt05-dependency-independence-gate.md`

## Correctness gate

The private dependency analyzer emits a receipt for every entry/function with
its name, direct call symbols, and an explicit reason. Current reasons are:

- `independent`
- `parameterized-function`
- `call-graph-dependency`
- `missing-function`
- `same-function`

Composition and parallelism are permitted by this dependency gate only for
call-free, zero-argument functions. The existing replay-safety, stable
reduction, work-size, core-limit, output-shape, and measured-speed gates remain
additional requirements; this receipt does not replace them.

QOPT-04 composition now consumes one module dependency receipt. A
parameterized or call-connected module cannot enter per-leaf composition and
continues through QOPT-03's serial whole-entry proof adapter. Each miss still
emits exactly baseline `mask-0` plus guided `mask-ff`, with paired bit-exact
parity and proof-before-selection.

The automatic CPU-pair selector now consumes a pair receipt before work-size
or concurrency selection. A nested call is conservatively rejected because
there is no transitive effect/dependency proof. This closes the case where two
apparently independent heavy top-level loops could both call an unanalyzed
helper and still be selected for parallel emission.

The dependency receipt remains private in memory. The public tuning manifest
shape is unchanged. The private toolchain revision is `x64-emitter-qopt05`, so
older proof receipts cannot authorize the changed scheduling boundary.

## Vertical TDD receipt

1. Module receipt RED: strict Clang exited 1 because
   `vkf_optimization_dependency_gate.hpp` did not exist. GREEN reported
   `call-graph-dependency`, recorded the entry call symbol, and separately
   classified the called parameterized function.
2. Pair receipt RED: strict Clang exited 1 because `analyze_pair` did not
   exist. GREEN rejected a nested call and preserved its exact dependency
   symbol in the receipt.
3. Production selector RED compiled successfully but exited 1 with:

   ```text
   nested calls without transitive dependency proof must not select parallel emission
   ```

   The fixture used two heavy top-level loops that both called an unanalyzed
   helper; the old selector incorrectly returned true. GREEN consumed the pair
   receipt and kept the same module serial.
4. The independent control remained GREEN: call-free zero-argument functions
   still expose `independent`, permit QOPT-04 composition, and retain its
   independently cached proofs.
5. The real x64 integration compiled a parameterized call graph through the
   production backend, observed only `mask-0` and `mask-ff`, executed the
   selected PE, and received exact `42` output. The existing independent-leaf
   tracer still measured `4 -> 2` candidates across a one-leaf program change.

Strict header/contract Clang command:

```text
clang++ -std=c++17 -O2 -Wall -Wextra -Werror -pedantic -I. compiler/native/<test>.cpp -o .work/qopt05/<test>.exe
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
  -o .work/qopt05/vkf_retained_optimization_driver_integration_test.exe
```

Final focused outputs:

```text
optimization dependency gate: reason=call-graph-dependency pair=call-graph-dependency independent=1
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

From the clean short build path `C:\w\qopt05`, MSVC Release built the same
seven tests plus standalone `vkf_x64_artifact`. All seven tests passed. Both
real integration artifacts executed with exact output.

This is a correctness packet, not a performance claim. The independent-leaf
production tracer still had to earn QOPT-04's paired speed proof before reuse;
the call graph remained on the two-candidate whole-entry proof path. No new
parallel performance result is claimed because QOPT-05 intentionally disables
parallel selection when dependency proof is absent.

SHA-256 at final GREEN:

| Artifact | SHA-256 |
| --- | --- |
| private dependency gate | `4873EB00C0D970E6C5D5BBFCB484E1CCC8BD14FF62B0FBF9D11F0B1304AA411F` |
| dependency behavior test | `C3A8F86BCC108A74186C25435F353888F8810EEFF4B48FCEE8FD77753F6E894F` |
| adaptive optimizer | `EB40F730AD594CAE7196682E2390A96056A92E20BA74B392E5CFE73B73721320` |
| adaptive contract test | `E238176EAED513DBD1AB26C6E4B032FD4C5FD7F3475922A0BC74C5D8E587E2A5` |
| production integration test | `A9CB9269862ECDDF0FB1C98CCB4A914CA68FC46FB8F7904A96106C380E535206` |
| x64 backend source | `A05212FE919DB7F4C6368C37D74BF1C5534DD767A8D383D86F175D360FF2AEFE` |
| native CMake graph | `99A41A9FA6060CB8AD3632664181D24AC52DC49D4053EEC02D2579DA68CBD6AB` |
| strict Clang dependency test | `611C54EB65DC1DCA5542D65D1A65491057F8D4C30EBFCE89721BE554D8C305E9` |
| strict Clang adaptive test | `488B825DC40E1D406027A8E96DF442D6B6625462E6AC51241BDCB7C28FB3ADD0` |
| strict Clang integration test | `B7D488A9ACC9F1F417C0343CF91BC44679FA7E26973DC1814C10D367E3984C48` |
| MSVC dependency test | `5950F85F16731719B05E23B18C412ADA7872112F7CEA381FE99DC3859F9DDAB8` |
| MSVC adaptive test | `EB8A0B2CB8129AB7BC0D8B719AB06261FA26B02149AF4654BFFBC839613D4AD9` |
| MSVC integration test | `03074D39F838651E6D3F6C950A4C368902453C59E2C3E2AE7F0C242D93B1D66F` |
| MSVC production x64 artifact | `4A9850E3201A2C0D1C8585F9E4A3029FF5423FA0507B8EED9F8191DFB95234C3` |

## Limitations and next gates

- Calls are conservatively rejected rather than analyzed transitively. A
  private call graph with effect summaries is required before call-connected
  composition or parallelism can be enabled.
- Parameterized functions remain on QOPT-03's complete-entry proof identity.
  Parameter/value-shape proof is not yet part of per-function caching.
- QOPT-04 still selects one compatible global policy and serially measures
  misses. No mixed-policy ABI or parallel measurement path was introduced.
- A statistically rejected speed candidate is not cached; negative-decision
  retention still needs expiry/invalidation policy.
- Concurrent cache stress, admission/pruning, crash-durability policy,
  GPU/reduction/cancellation scheduling, and independent ADR-0010/T4 evidence
  remain.

The next smallest prerequisite is a private transitive call graph with
deterministic effect summaries and stable function/value-shape fingerprints.
Only after that graph proves disjoint demands should parameterized composition
or parallel execution be considered.

## Lane estimate

The quantum optimization lane is estimated at **92% complete**, with medium
confidence (about +/-5 points). There is no canonical quantum-lane roadmap, so
the explicit 100-point gate weighting is: audit/model 10/10; statistical proof
and exact parity 20/20; bounded one-shot exploration 15/15; retained reuse
15/15; dependency-safe composition/parallel execution 13/15; explicit failure
reporting 10/10; shipped integration plus independent performance evidence
9/15.

No Language Design Authority decision is required. This packet is
independently revertible and is not merged or pushed.
