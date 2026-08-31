# 050-I85 four-way CPU group execution evidence

## Scope

- Base: `251fe136766c5f9af32429133cc77daedeb0dc83`
- RED: `462cc0c`
- Probe calibration: `67e30db`
- Implementation: `24766e3f40b347d60aa13603e2eecb2ef92720a8`
- Branch: `codex/0.5/050-i85-four-worker-execution`
- Owned paths:
  - `compiler/native/vkf_x64_artifact.cpp`
  - `compiler/native/vkf_pe_writer.hpp`
  - `tests/bootstrap/generated-artifact-automatic-cpu-group-execution.test.mjs`

The selected four-demand group now executes three demands through private
Windows thread thunks while the fourth demand runs on the entry thread. Each
worker has an isolated result context. The entry joins every worker, closes
its handle, and writes results in source order. A failed thread creation falls
back only the unstarted suffix to serial execution and still joins every
already-started worker.

This is a private generated-artifact implementation. It changes no VKF syntax,
public API, ABI, schema, diagnostic text, or generated output.

## Environment

- Windows `10.0.26200.0`
- Node.js `v24.11.0`
- Clang `22.1.4`
- Runtime-visible processors: `14`

Fresh strict compilers were built with the repository helper. Final command:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/i85-refactor/bin' `
  -OnlyTargets @('vkf-strict')
```

Final compiler SHA-256:
`07D2D6EB9F651AE54CF1247CD2D5C42804381670034B61CAED151511F0A96934`.

## TDD evidence

Focused command, with `VKF_AUTOMATIC_CPU_COMPILER` set to the fresh strict
compiler and `VKF_TEST_WORK_ROOT` inside the worktree:

```powershell
node --test `
  tests/bootstrap/generated-artifact-automatic-cpu-group-execution.test.mjs
```

- RED at 500,000,000 iterations per lane: 0 passed, 1 failed, 15,384.58 ms.
  The selected artifact exposed only one CPU-active thread.
- First GREEN attempt at that duration completed faster, but the external
  process sampler missed the shortened parallel interval. The four-thread
  requirement was not weakened; the fixed workload was extended to
  2,000,000,000 iterations per lane.
- Calibrated GREEN: 1 passed, 0 failed, 8,378.41 ms. Four simultaneously
  advancing OS threads were observed and all four outputs matched source
  order.

The timings above are test durations, not a graduated performance claim.

## Affected verification

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/generated-artifact-automatic-cpu-pair.test.mjs `
  tests/bootstrap/generated-artifact-automatic-cpu-execution.test.mjs `
  tests/bootstrap/generated-artifact-automatic-cpu-group.test.mjs `
  tests/bootstrap/generated-artifact-automatic-cpu-group-execution.test.mjs
```

Result after refactor: 6 passed, 0 failed, 19,386.59 ms. This includes the
existing one-core ceiling and small-work serial checks for pair selection.

## Contract hashes

- `vkf_x64_artifact.cpp`:
  `64D082B22E766D470663085AD1966F03EDB396C9A49A7911E5A5DD6217E20FB1`
- `vkf_pe_writer.hpp`:
  `77030E3F81FE9531E0B6A85AA6EF080463452204028D98AF393CA476519CBC47`
- `generated-artifact-automatic-cpu-group-execution.test.mjs`:
  `9C34BE1F496346C4BB1C0C556530C36EEC0F6B44C26BCD1E211493DA7C1640A8`

## Acceptance-gate impact

This closes the first generated-artifact four-way overlap tracer: the user
writes ordinary serial VKF, the compiler privately selects four independent
demands, and the artifact executes them concurrently while retaining source
order. It does not close general automatic-flow scheduling, performance
graduation, or the Stage 2/Stage 3 fixed-point gate.

Next packet: add a correctness-gated, isolated one-core versus four-core timing
row for the same artifact shape, with raw samples and no benchmark claim until
independent verification.
