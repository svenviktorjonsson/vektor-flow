# 050-I190 Stage-2-owned arithmetic-chain evidence

## Scope

- Git base: `7db36603`
- Consumed packet: committed I189 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I190 advances Gate 6 from one mixed expression to a longer compositional
Machine-IR tape. The Stage-2 compiler parses and lowers:

```vkf
value: 40
:: value + 50 * 60 - 70 + 80
```

It traverses five loads and four binary operations in postfix order, including
multiplication precedence and left-associative addition/subtraction. Stage 2
selects one 42-byte x64 stream and writes the completed PE through
`.io.write_bytes`:

```text
6A 28                   push 40
6A 32                   push 50
6A 3C                   push 60
58 59 48 0F AF C1 50    multiply and push
58 59 48 01 C8 50       add and push
6A 46                   push 70
58 59 48 29 C1 51       subtract and push
6A 50                   push 80
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `3050`, exactly matching Stage 0. Their program
bytes are identical, as are Stage-2, Stage-3, and Stage-4 compiler bytes. The
path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

This remains a private, valid-input tracer. The bounded printable-immediate
encoder and opcode subset do not yet constitute the complete compiler or
artifact writer. No public syntax, API, schema, ABI, or diagnostic changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 12.56 s;
- intended failure: the generated Stage-2 compiler could not lower the
  missing private arithmetic-chain x64 selector.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 15.57 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `3050`;
- both contained the exact 42-byte arithmetic instruction stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs `
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

- exit `0`, 13/13 passed in 32.43 s;
- every earlier native primitive, fixed-point graph, and identity remained
  exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 48.03 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git
index remained clean after the I189 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `59A1B6193140476D1284FFAE61DEB961BCAD5366C09551B50BD972BF44DF2C15`
- bootstrap manifest checkout bytes:
  `0F44D27195F264B4822C307918A63F0DED6116E5E4B8E2006D03DBAB9EE3E0B4`
- canonical compiler facade source:
  `5829BC72B8AD8EBDE245078CDDDA2FFE0A5C0949F9E0E14B640C14DF377629D1`
- I190 acceptance test canonical bytes:
  `887A545481F18B145359B10E8C907039841FF3E53FCF987523C6600D018FE8AB`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I190 proves that Stage 2 can traverse a longer mixed-precedence Machine-IR
tape, preserve operation ordering, and reproduce the complete executable at
fixed point. Gate 6 remains open because instruction coverage, general value
encoding, relocation, and compilation of the full locked compiler graph are
still incomplete.

Re-evaluated from I189's 90.4%, 0.5.0 is conservatively **91.1% total**, **+0.7
percentage points** for count-independent traversal across five operands and
multiple binary-operation instances with exact Stage-0/2/3 behavior.

## Handoff inventory

I190 adds one private arithmetic-chain selector, rotates compiler and bundle
hashes, adds one focused fixed-point test, and records this receipt. Existing
dirty files and untracked `.work/` remain preserved. No commit, push, or merge
was performed for I190.
