# 050-I187 Stage-2-owned x64 remainder evidence

## Scope

- Git base: `985af915`
- Consumed packet: committed I186 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I187 extends valid-input Stage-2-owned native emission with positive remainder:

```vkf
value: 90
:: value % 40
```

The Stage-2 compiler verifies the locked `load-load-remainder-print`
Machine-IR tape, emits source-derived immediates, performs signed division,
moves the remainder from `rdx`, and writes the PE with `.io.write_bytes`:

```text
6A 5A          push 90
6A 28          push 40
59             pop rcx
58             pop rax
48 99          cqo
48 F7 F9       idiv rcx
48 89 D0       mov rax, rdx
F2 48 0F 2A C0 cvtsi2sd xmm0, rax
C3             ret
```

Stage 2 and Stage 3 both print `10`, exactly matching Stage 0. Program outputs
and bytes are identical, as are Stage-2, Stage-3, and Stage-4 compiler bytes.
The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

This remains a bounded positive valid-input encoder with printable one-byte
operands and a locked runner tail. Negative and fractional remainder coverage,
zero-divisor handling, general encoding, instruction selection, relocation,
and complete compiler-graph emission remain open. No public diagnostic choice
is made.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-remainder-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 11.72 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-remainder emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 14.38 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `10`;
- both contained the exact 20-byte runtime remainder sequence;
- Stage-2/Stage-3 program and Stage-2/3/4 compiler artifacts were exact.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-remainder-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-floor-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-division-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs `
  tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 10/10 passed in 25.48 s;
- all prior native operations, graph materialization, and identities stayed
  exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 35.33 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git index
remained clean after the I186 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `0BFC8CD130C31A00A7C9C263D123EC9B86FEA40259B8B78C0002067CBC6E3C47`
- bootstrap manifest checkout bytes:
  `2794BDECB3009B5E388C3B341C13AC6DEF6743FD18D5C854C49589D595480810`
- canonical compiler facade source:
  `00748F859A263BC0518708FA90244CD287C2DB9B297871FD25CE74BA963B1197`
- I187 acceptance test canonical bytes:
  `8CF5C838FCFA7AA8F71B88BC05D6FC5F37FB671F69A23BD9A890FFECC27DE44F`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes positive remainder executed at runtime in a Stage-2-owned x64
artifact and reproduced at the bounded Stage-3 fixed point. Gate 6 remains
open because encoding is not general and the full locked compiler graph is not
yet compiled into Stage 3.

Re-evaluated from I186's 88.7%, 0.5.0 is conservatively **89.1% total**, **+0.4
percentage points** for positive native remainder emission and exact
fixed-point execution.

## Handoff inventory

I187 adds one private runtime-remainder emitter, rotates the locked compiler
and bundle hashes, adds one focused test, and records this receipt. Existing
dirty files and untracked `.work/` content remain preserved. No commit, push,
or merge was performed for I187.
