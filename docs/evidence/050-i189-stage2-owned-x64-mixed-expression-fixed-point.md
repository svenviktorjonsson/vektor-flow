# 050-I189 Stage-2-owned mixed x64 selection evidence

## Scope

- Git base: `1e7ef527`
- Consumed packet: committed I188 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

The acceptance audit identifies Gate 6 as the largest remaining 0.5 gap:
Stage 2 can materialize the full locked source graph and emit every settled
binary operation separately, but it does not yet traverse general Machine IR
to build Stage 3. I189 takes the first larger instruction-selection slice.

The Stage-2 compiler parses and lowers a mixed-precedence expression:

```vkf
value: 40
:: value + 50 * 60
```

It traverses the resulting Machine-IR opcode/value tapes, emits each printable
operand, selects multiply and add fragments in postfix order, appends the print
terminator, and writes the PE through `.io.write_bytes`. The emitted stream is:

```text
6A 28                   push 40
6A 32                   push 50
6A 3C                   push 60
58 59 48 0F AF C1 50    multiply and push
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 both print `3040`, exactly matching Stage 0. Their program
bytes are identical, as are Stage-2, Stage-3, and Stage-4 compiler bytes. The
path uses neither `--vkf-internal-stage-observation` nor `process.run_native`.

The selector is private and supports only load, add, multiply, and terminal
print over a bounded printable immediate range. Other instructions, general
numeric encoding, relocation, and compilation of the full source graph remain
open. No public syntax, API, schema, or diagnostic choice is made.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-mixed-expression-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 17.13 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private mixed-expression instruction selector.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 16.42 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `3040`;
- both contained the exact 26-byte mixed instruction stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-mixed-expression-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-power-fixed-point.test.mjs `
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

- exit `0`, 12/12 passed in 35.53 s;
- every earlier native primitive, fixed-point graph, and identity stayed exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 47.59 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git index
remained clean after the I188 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `CD3E5FCD07E823E9F6E8A89A157BA50907FED123D0CA417BE049A88CB441E2E1`
- bootstrap manifest checkout bytes:
  `D1897BA5E44EAA508EFF38DDA0C90C44FA1BB0B230D3CC65CDC600033967388C`
- canonical compiler facade source:
  `A15376499C3512AF91372F9292566316972D236D1CBD1F6F7EA69A3BC2FCA4E8`
- I189 acceptance test canonical bytes:
  `65300931DC334E9C61EFE3FD216BE650565DCCB9C6F66BED272642E66AD5FEB8`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I189 closes the first Stage-2-owned traversal and native selection of a
multi-operation Machine-IR tape, including precedence established before
emission. Gate 6 remains open because the selector covers only a small opcode
subset and does not compile the complete locked compiler source graph.

Re-evaluated from I188's 89.6%, 0.5.0 is conservatively **90.4% total**, **+0.8
percentage points** for the first compositional Stage-2 x64 instruction stream
and exact fixed-point reproduction.

## Handoff inventory

I189 adds a private printable-immediate encoder and mixed instruction selector,
rotates compiler and bundle hashes, adds one focused test, and records this
receipt. Existing dirty files and untracked `.work/` remain preserved. No
commit, push, or merge was performed for I189.
