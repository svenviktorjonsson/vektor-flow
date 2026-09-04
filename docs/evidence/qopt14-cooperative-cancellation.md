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

## Remaining gates

- Polling is limited to the exact proven static loop. Dynamic, nested, non-unit,
  resource-owning, or otherwise incomplete loops remain serial.
- Only the declared Windows x64 two-result pair is covered. POSIX, GPU, broader
  result shapes, and forced preemption are outside this packet.
- Independent exclusive-runner performance verification under ADR-0010 remains
  open, so the lane stays at **99%**.
