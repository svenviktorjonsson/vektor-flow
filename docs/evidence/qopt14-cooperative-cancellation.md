# QOPT-14: cooperative cancellation proof

Date: 2026-09-04

## Packet

- Lane: private automatic/quantum optimization proof.
- Base: `23e52cbeaebede1e02871a4f4d8ea4365c776f11` (QOPT-13).
- Branch: `codex/quantum/qopt14-cooperative-cancellation`.
- Public VKF syntax, semantics, APIs, diagnostics, schemas, and ABIs:
  unchanged.
- Completion estimate remains **99%**, never 100%.

QOPT-14 extends only the already-proven Windows x64 two-root fallible pair.
Each root must expose a dependency-receipt polling site of the form
`<function>#<instruction>:loop-backedge:<label>`. The admitted loop has an
initialized counter, a fixed integral bound, and an exact unit increment.
Missing proof fails closed with `cancellation-polling-unknown` and stays serial.

Cancellation is directional to preserve source-order errors. A source-left
terminal error publishes a shared request. The right lane polls only its proven
backedge, records observation, returns no value, and is then joined and closed.
A right error does not cancel left; both lanes complete for exact left-first
arbitration. No forced thread termination, serial retry, fallback output, or
partial output exists.

The artifact's private tuning outcome records whether cancellation was observed
and whether every candidate sample created, joined, and closed exactly one
worker. These proof fields do not change the semantic outcome comparison or any
public artifact schema.

## RED receipts

The dependency RED required explicit receipt fields, deterministic polling-site
order, and the exact fail-closed reason. It initially failed to compile because
`Receipt` lacked `cancellation_knowledge_complete`, `safe_backedges_proven`, and
`cancellation_poll_sites`, and `Reason` lacked `CancellationPollingUnknown`.

The executor RED ran one exact source-left error against a started
100,000,000-iteration sibling. It initially failed to compile because no
receipt-aware four-argument `execute_automatic_cpu_pair` overload existed.

The corrected artifact RED was reproduced in a detached worktree at the exact
base SHA with only the artifact test changed. The erroring root retained the
established minimum work bound `1,048,576`; its sibling used `100,000,000`, so
the candidate was eligible. MSVC failed exactly at the missing proof receipt:

```text
error C2039: 'optimizer_cancellation_observed': is not a member of 'vkf_x64_backend::ArtifactResult'
error C2039: 'optimizer_thread_cleanup_complete': is not a member of 'vkf_x64_backend::ArtifactResult'
```

## GREEN contract

- The dependency gate centralizes the existing exact static-loop recognizer and
  records both polling sites. A non-unit increment remains serial with the exact
  reason `cancellation-polling-unknown`.
- The generic executor requests cancellation only from the source-left lane,
  always joins, propagates left before right, and publishes no result tuple on
  error.
- The Windows x64 artifact stores one shared flag in a private pair context.
  The left terminal-error path publishes with a locked operation; the right
  proven backedge polls it and atomically records observation.
- The worker thunk preserves nonvolatile `r12` and `r13`. Its private context is
  disjoint from regular frame values, saved registers, error slots, the 32-byte
  Windows shadow area, and CreateThread arguments 5 and 6. An internal layout
  guard fails compilation if those ranges overlap.
- Every measured candidate sample must show exactly one successful create, one
  successful join, and one successful handle close. Otherwise exact evidence is
  rejected. Semantic parity still compares exact error bytes, length bits,
  error mask, ordered result bits, and zero partial output.
- `x64-emitter-qopt14` and `x64-threaded-pair-qopt14` invalidate older retained
  machine-code proof after this private lowering change.

## Verification

The host had Visual Studio 2022 MSVC 19.44 x64 and no Clang executable. The
seven focused Release targets were built with bundled CMake/Ninja and passed:

- `vkf_adaptive_optimizer_contract_test`
- `vkf_retained_optimization_schedule_test`
- `vkf_retained_optimization_cache_test`
- `vkf_retained_optimization_driver_test`
- `vkf_retained_optimization_composition_test`
- `vkf_optimization_dependency_gate_test`
- `vkf_retained_optimization_driver_integration_test`

The integration parent called Windows `SetErrorMode(0x8003)` before launch, so
Node/artifact descendants inherited
`SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX`.
This suppresses interactive crash UI without changing exit codes or assertions.
No fixture process remained after the runs.

The production integration measured exactly one serial baseline and one guided
threaded candidate per proof miss, within the existing ten-run ceiling. Its
selector output records both candidates correct, observed cancellation, exact
zero-output parity, and complete worker cleanup. The pre-existing right-only and
simultaneous-error cases also retained two correct candidates and exact
source-left behavior.

Final local selector receipt:

```text
cancellation_candidates=2 cancellation_selected=mask-0
cancellation_serial_median_ns=6.8883e+06
cancellation_threaded_median_ns=7.33e+06
cancellation_observed=1 cancellation_cleanup=1
```

The guided candidate was slower in this run, so the existing winner proof
correctly retained the unoptimized `mask-0` baseline. No cancellation lowering
was applied to the shipped artifact from this measurement.

Timing values in this evidence are local selector observations only. They permit
application solely through the existing measured winner proof and are not a
portable or release-wide performance claim.

## SHA-256 receipts

Changed implementation and test inputs at packet commit
`dad65acdfce6aa29d299da5a816c3ccbe16c38f5`:

```text
f609e51412035270df3591754a915c0c53ee02cceff2c2003968beb8e0111188  compiler/native/vkf_adaptive_optimizer.hpp
b8002261882a0ae1e77612c573ec7ce92eb983ddae3ba88077cc52513552d8c0  compiler/native/vkf_adaptive_optimizer_contract_test.cpp
ab031b55d0f3017c5ba6d7f0c3c551c604b9579bc7f36d92d58ceeb4017a8f84  compiler/native/vkf_optimization_dependency_gate.hpp
f4a26a59a546538939a24c1e6df66a2a209eb65cba60af31341fbe9a830c4ae6  compiler/native/vkf_optimization_dependency_gate_test.cpp
717d819612e0892a6b2697f8252a2c64a9aadf7b565958bf8309bcf9be48a3d7  compiler/native/vkf_retained_optimization_driver_integration_test.cpp
aae33491c6aa41de1f5506ea7e1acc053a2855294550f560f9530a07997e24a0  compiler/native/vkf_x64_artifact.cpp
49c8b9b027c0de921c13968d6e9f5a4b93cbf0472ebf1574ccc7c25dfb06296b  compiler/native/vkf_x64_backend.hpp
```

Final MSVC 19.44 x64 Release test binaries:

```text
ac7e1b62b27bb50691f2e30cb41d7012bfcee1cc6e49da265c4c4beb2ddaf30a  vkf_adaptive_optimizer_contract_test.exe
1a27fffff3831340a4cdfe2b12f0ff04319ec95bde03c6c4eb97a6b5bcf7b2d9  vkf_retained_optimization_schedule_test.exe
224f80641666f9e0f191dd5618fef914ce876c6e226924abbfee53999ac86ad9  vkf_retained_optimization_cache_test.exe
eee96732789c36585e20947296b98d31c5e16325cd63cf52fbecc595f80bd495  vkf_retained_optimization_driver_test.exe
6e7f0191d1743c7325a8310e8505102d5492ce3f2ffacea4c3a53835fcce9786  vkf_retained_optimization_composition_test.exe
4d6d10724ee22bc9046cc455f179fa27eb5c9062d6b08c0a786554ab945ace24  vkf_optimization_dependency_gate_test.exe
722c4e7cca50b4dd1d35fb3d5ba36d73ce78cb9c9228006f52abd3f729089130  vkf_retained_optimization_driver_integration_test.exe
```

Git identity for the code packet:

```text
commit dad65acdfce6aa29d299da5a816c3ccbe16c38f5
tree   016b96c02cd3dad812be3039b25114d615dd0cab
```

The passing integration test deliberately removed its temporary build root at
the end of the run. Consequently, no final emitted cancellation artifact or
manifest remained available to hash. Earlier crash-diagnostic remnants were
not final proof artifacts and are excluded. The integration binary, exact
source inputs, code commit, and tree above bind the reproducible receipt.

## Remaining gates

- Polling is limited to the exact proven static loop. Dynamic, nested, non-unit,
  resource-owning, or otherwise incomplete loops remain serial.
- Only the declared Windows x64 two-result pair is covered. POSIX, GPU, broader
  result shapes, and forced preemption are outside this packet.
- Independent exclusive-runner performance verification under ADR-0010 remains
  open, so the lane stays at **99%**.
