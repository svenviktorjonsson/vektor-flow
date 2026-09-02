# 050-I185 Stage-2-owned x64 division evidence

## Scope

- Git base: `d0b70b1d`
- Consumed packet: committed I184 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I185 extends valid-input Stage-2-owned native emission with settled true
division. The running Stage-2 compiler parses and lowers:

```vkf
value: 90
:: value / 40
```

It verifies the locked `load-load-divide-print` Machine-IR tape, emits both
source-derived immediates, converts operands to `f64`, performs `divsd`, and
writes the PE through direct `.io.write_bytes`. The emitted runtime sequence
is:

```text
6A 5A          push 90
6A 28          push 40
58             pop rax
F2 48 0F 2A C8 cvtsi2sd xmm1, rax
58             pop rax
F2 48 0F 2A C0 cvtsi2sd xmm0, rax
F2 0F 5E C1    divsd xmm0, xmm1
C3             ret
```

Stage 2 and Stage 3 both compute and print `2.25`, matching Stage 0. Their
program artifacts are byte-identical, and the Stage-2, Stage-3, and Stage-4
compiler artifacts are byte-identical. The path uses neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This remains a bounded valid-input encoder with printable one-byte operands
and a locked runner tail. General numeric encoding, instruction selection,
relocation, complete compiler-graph emission, and invalid division diagnostics
remain open. This packet makes no invalid-source diagnostic choice.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-division-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 11.10 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-division emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 9.50 s;
- Stage-2 and Stage-3 PEs both returned exact Stage-0 stdout `2.25`;
- both PEs contained the exact 21-byte runtime division sequence;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 8/8 passed in 21.55 s;
- prior native operations, graph materialization, and identities stayed exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 39.75 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git index
remained clean after the I184 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `51A09A695F3B1EA003C1D90E67255892C0EE051F419CDD619D4BD0929F29B12E`
- bootstrap manifest checkout bytes:
  `E0A4DABB86B2F889CFFEDCA1F5793C7558390B304EB0D71E532EB893E4B23451`
- canonical compiler facade source:
  `B6ED6D6E0500D760EA728297CBB90E3272D05220B0ED8C058900AF660DC2E65B`
- I185 acceptance test canonical bytes:
  `B99C4A9633F4512036B492516AC3CDE8246DF9B57D9BEF7F7C9210B9D3712FE5`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes the first settled fractional binary Machine-IR operation executed
at runtime in a Stage-2-owned x64 artifact and reproduced at the bounded
Stage-3 fixed point. Gate 6 remains open because encoding is not general and
the full locked compiler graph is not yet compiled into Stage 3.

Re-evaluated from I184's 87.8%, 0.5.0 is conservatively **88.3% total**, **+0.5
percentage points** for native true-division emission and exact fixed-point
execution.

## Handoff inventory

I185 adds one private runtime-division emitter, rotates the locked compiler and
bundle hashes, adds one focused test, and records this receipt. Existing dirty
files and untracked `.work/` content remain preserved. No commit, push, or
merge was performed for I185.
