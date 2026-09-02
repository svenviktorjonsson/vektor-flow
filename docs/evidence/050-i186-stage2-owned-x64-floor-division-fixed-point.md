# 050-I186 Stage-2-owned x64 floor-division evidence

## Scope

- Git base: `fc90fd0a`
- Consumed packet: committed I185 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I186 extends valid-input Stage-2-owned native emission with positive floor
division. The running Stage-2 compiler parses and lowers:

```vkf
value: 90
:: value // 40
```

It verifies the locked `load-load-floor-divide-print` Machine-IR tape, emits
both source-derived immediates, performs signed x64 division, and writes the PE
through direct `.io.write_bytes`. The emitted runtime sequence is:

```text
6A 5A          push 90
6A 28          push 40
59             pop rcx
58             pop rax
48 99          cqo
48 F7 F9       idiv rcx
F2 48 0F 2A C0 cvtsi2sd xmm0, rax
C3             ret
```

Stage 2 and Stage 3 both compute and print `2`, matching Stage 0. Their program
artifacts are byte-identical, and Stage-2, Stage-3, and Stage-4 compiler
artifacts are byte-identical. The path uses neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This remains a bounded valid-input encoder with printable positive one-byte
operands and a locked runner tail. Negative floor correction, division by zero,
general numeric encoding, instruction selection, relocation, and complete
compiler-graph emission remain open. No invalid-source diagnostic choice is
made.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-floor-division-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 12.44 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-floor-division emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 19.06 s;
- Stage-2 and Stage-3 PEs both returned exact Stage-0 stdout `2`;
- both PEs contained the exact 17-byte runtime floor-division sequence;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-floor-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 9/9 passed in 30.95 s;
- prior native operations, graph materialization, and identities stayed exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 42.61 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git index
remained clean after the I185 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `07B67354CAF7A480A4F9817873450E46EC83A00FAFBD7529A2D4EAC43F485C11`
- bootstrap manifest checkout bytes:
  `42935F748905E78E2E2E135E4094637CB0A1BB8124CD949FFD92E94F3AAABBA8`
- canonical compiler facade source:
  `44290583B48FD306FB5CF6B9958C5BC5BACBB3BC92A0BF7815BB3773CAF63330`
- I186 acceptance test canonical bytes:
  `FA540A9DBD7FD048AE072031BB42F917C7636BE6A950A1E0585CF31CDACD8DEE`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes positive floor division executed at runtime in a Stage-2-owned x64
artifact and reproduced at the bounded Stage-3 fixed point. Gate 6 remains
open because encoding is not general, negative floor correction is not yet
emitted, and the full locked compiler graph is not yet compiled into Stage 3.

Re-evaluated from I185's 88.3%, 0.5.0 is conservatively **88.7% total**, **+0.4
percentage points** for positive native floor-division emission and exact
fixed-point execution.

## Handoff inventory

I186 adds one private runtime-floor-division emitter, rotates the locked
compiler and bundle hashes, adds one focused test, and records this receipt.
Existing dirty files and untracked `.work/` content remain preserved. No
commit, push, or merge was performed for I186.
