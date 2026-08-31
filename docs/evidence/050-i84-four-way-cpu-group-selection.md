# 050-I84 four-way CPU group selection evidence

## Scope

- Base/test commit: `261fbec0421b1193815a48e1e220fdb3bdf8a240`
- Implementation: `b7ec12f81d3c811531104c64c2bf83120ecffbf1`
- Recovery branch: `codex/0.5/050-i84-recovery`
- Preserved source packet: `codex/0.5/050-i84-four-worker-performance`
- Owned paths:
  - `compiler/native/vkf_adaptive_optimizer.hpp`
  - `compiler/native/vkf_x64_artifact.cpp`
  - `tests/bootstrap/generated-artifact-automatic-cpu-group.test.mjs`

The original I84 worktree contained uncommitted changes in the two native
backend files. Recovery left that worktree untouched, reproduced the committed
RED in a fresh worktree, and applied the same bounded selector behavior.

This packet recognizes exactly four independent, worthwhile, pure scalar
demands in the canonical source-order entry shape. It records
`automatic-cpu-group-selected` in the optimizer manifest only when the process
core ceiling and available cores permit four partitions. It changes no VKF
syntax, public API, ABI, schema, diagnostic text, or generated output.

The packet proves selection and source-order results. It does **not** claim
that four worker threads overlap during execution; that is the next observable
packet.

## Environment

- Windows `10.0.26200.0`
- Node.js `v24.11.0`
- Clang `22.1.4`
- Runtime-visible processors: `14`

Fresh strict compilers were built with:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/i84-recovery-red/bin' `
  -OnlyTargets @('vkf-strict')

.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/i84-recovery-green/bin' `
  -OnlyTargets @('vkf-strict')
```

GREEN compiler SHA-256:
`A7A7B85CD137B448B4EE390E47CCD9543E30FE8082B5C93C0DD541CA49A006F0`.

## TDD evidence

Focused command, with `VKF_AUTOMATIC_CPU_COMPILER` set to the fresh strict
compiler and `VKF_TEST_WORK_ROOT` inside this worktree:

```powershell
node --test tests/bootstrap/generated-artifact-automatic-cpu-group.test.mjs
```

- RED: 0 passed, 1 failed, 1082.63 ms. The manifest reported only
  `["baseline"]`; failure:
  `optimizer did not select the four-way source demand group`.
- GREEN: 1 passed, 0 failed, 1470.28 ms. The same generated artifact retained
  all four source-order integer results.

## Affected verification

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/generated-artifact-automatic-cpu-pair.test.mjs `
  tests/bootstrap/generated-artifact-automatic-cpu-group.test.mjs
```

Result: 4 passed, 0 failed, 2706.49 ms. The pair selector still respects the
one-core ceiling and keeps small demand pairs serial.

## Contract hashes

- `vkf_adaptive_optimizer.hpp`:
  `7728135C0A6C648791E741F9E2C0EC0E1557A4733AFE0C65879F7B9F15274677`
- `vkf_x64_artifact.cpp`:
  `A3DCC04673AF21A6EE06DBBAF0E8AD9B7B5C4233D4E2F270BEB3B67211201A89`
- `generated-artifact-automatic-cpu-group.test.mjs`:
  `813E9639A41D26A8CBE5D1597CF64437681BA4DCB261FD1DF0ACDF9AE0222EC3`

## Acceptance-gate impact

This advances the target-independent automatic-flow backend from a selected
pair to a selected four-demand group while preserving the user-authored serial
program and private optimizer ownership. It does not close the automatic-flow
execution or Stage 2/Stage 3 fixed-point gates.

Next packet: execute the selected four-demand group on four overlapping OS
threads, preserve source-order results, and prove that `process.max_cores: 1`
keeps the same program serial.
