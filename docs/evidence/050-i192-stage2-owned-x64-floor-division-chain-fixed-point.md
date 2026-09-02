# 050-I192 Stage-2-owned floor-division-chain evidence

## Scope

- Git base: `4348122c`
- Consumed packet: committed I191 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I192 advances Gate 6 opcode coverage by composing positive integer floor
division inside a longer Machine-IR tape:

```vkf
value: 90
:: value // 40 + 65
```

The self-hosted compiler walks the tape, emits a signed integer division
fragment that pushes its quotient back onto the runtime stack, then consumes
it through the existing addition and print fragments. The selected 27-byte
x64 stream is:

```text
6A 5A                   push 90
6A 28                   push 40
59 58 48 99             load operands; sign-extend dividend
48 F7 F9 50             divide; push quotient
6A 41                   push 65
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `67`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

The private integer tape traversal now has separately guarded floor-division
and remainder fragments. Negative floor-division semantics remain outside
this valid-input slice. No public syntax, API, schema, ABI, or diagnostic
changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-floor-division-chain-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 11.75 s;
- intended failure: the generated Stage-2 compiler could not lower the
  missing private floor-division-chain selector.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 13.46 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `67`;
- both contained the exact 27-byte compositional instruction stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Compositional regression command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-floor-division-chain-fixed-point.test.mjs
```

- exit `0`, 3/3 passed in 16.64 s.

Full focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-floor-division-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs `
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

- exit `0`, 15/15 passed in 36.68 s;
- every earlier native primitive, compositional tape, fixed-point graph, and
  bundle identity remained exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 54.09 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git
index remained clean after the I191 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `272704A4F5E1E0F739DBD36D5B27D1BB9FE1F5DDE7488D67DF9A8FE71B25B9AF`
- bootstrap manifest checkout bytes:
  `BB4D5790EEE667FF3DB647FD21078A0E97470B0B30710FB787130E9EA6813CE1`
- canonical compiler facade source:
  `DEF73042ECFA509F670B3F86C1982DB0FE3BF32E34604128DC07A4D5FCD850BC`
- I192 acceptance test canonical bytes:
  `00BCA2F3811B5FA456572E484F79A75E5694C86BED4BADDC1044D98154D95F60`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I192 proves that Stage 2 can compose another division-family integer opcode
with a subsequent operation while preserving exact instruction order and
fixed point. Gate 6 remains open on wider value encoding, the remaining
compositional opcode families, relocation, and compilation of the complete
locked compiler graph into Stage 3.

Re-evaluated from I191's 91.6%, 0.5.0 is conservatively **92.1% total**, **+0.5
percentage points** for compositional floor-division selection with exact
Stage-0/2/3 behavior.

## Handoff inventory

I192 extends the private integer tape selector, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. Existing dirty
files and untracked `.work/` remain preserved. No commit, push, or merge was
performed for I192.
