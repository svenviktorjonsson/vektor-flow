# 050-I184 Stage-2-owned x64 multiplication evidence

## Scope

- Git base: `76d7eb06`
- Consumed packet: committed I183 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I184 extends valid-input Stage-2-owned native emission with the settled
multiplication operation. The running Stage-2 compiler parses and lowers:

```vkf
value: 40
:: value * 50
```

It verifies the locked `load-load-multiply-print` Machine-IR tape, emits both
source-derived immediates and a locked signed-multiply tail, then writes the PE
through direct `.io.write_bytes`. The emitted runtime sequence is:

```text
6A 28          push 40
6A 32          push 50
58             pop rax
59             pop rcx
48 0F AF C1    imul rax, rcx
F2 48 0F 2A C0 cvtsi2sd xmm0, rax
C3             ret
```

Stage 2 and Stage 3 both compute and print `2000`, matching Stage 0. Their
program artifacts are byte-identical, and the Stage-2, Stage-3, and Stage-4
compiler artifacts are byte-identical. The path uses neither
`--vkf-internal-stage-observation` nor `process.run_native`.

This remains a bounded encoder with printable one-byte operands and a locked
runner tail. General numeric encoding, instruction selection, relocation, and
complete compiler-graph emission remain open. Invalid input is not exercised,
so the unresolved invalid-source diagnostic contract remains untouched.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-multiplication-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 14.08 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-multiplication emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 12.27 s;
- Stage-2 and Stage-3 PEs both returned exact Stage-0 stdout `2000`;
- both PEs contained the exact 16-byte runtime multiplication sequence;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 7/7 passed in 21.46 s;
- constant, addition, subtraction, graph, and identity contracts stayed exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 47.71 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git index
remained clean after the I183 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `DC7945EC7F17BF60F679E0C5E3F25B295718A68BD1902D39F03E4ADD184AE942`
- bootstrap manifest checkout bytes:
  `009EDBFBFC0CDB5EB96DB8F6F32EB349B05E9BBA907A5341D5B2A27F6CE2ADF9`
- canonical compiler facade source:
  `137640271EEEFC5B19658D976CCCF6234FFD1EF3F00F15E6264D396DC7AD762C`
- I184 acceptance test canonical bytes:
  `BBA7DE93A0303395EB45CBD0E1206DC0E1FD9B2CCA7C13D5018356CA6BE00B09`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes a third settled binary Machine-IR operation executed at runtime in
a Stage-2-owned x64 artifact and reproduced at the bounded Stage-3 fixed point.
Gate 6 remains open because encoding is not general and the full locked
compiler graph is not yet compiled into Stage 3.

Re-evaluated from I183's 87.3%, 0.5.0 is conservatively **87.8% total**, **+0.5
percentage points** for native multiplication emission and exact fixed-point
execution.

## Handoff inventory

I184 adds one private runtime-multiplication emitter, rotates the locked
compiler and bundle hashes, adds one focused test, and records this receipt.
Existing dirty files and untracked `.work/` content remain preserved. No
commit, push, or merge was performed for I184.
