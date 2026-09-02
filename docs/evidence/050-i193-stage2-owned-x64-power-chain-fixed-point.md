# 050-I193 Stage-2-owned power-chain evidence

## Scope

- Git base: `0ca3aa7b`
- Consumed packet: committed I192 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I193 advances Gate 6 value encoding and opcode coverage by composing positive
integer power inside a longer Machine-IR tape:

```vkf
value: 40
:: value ^ 2 + 65
```

The bounded Stage-2 immediate encoder now emits the exponent as raw byte
`0x02`, rather than the ASCII byte for `2`. The power fragment consumes that
integer exponent, pushes its result back onto the runtime stack, and the tape
continues through addition and print. The selected 41-byte x64 stream is:

```text
6A 28                   push 40
6A 02                   push 2
59 58                   load exponent and base
BA 01 00 00 00          initialize result to 1
48 85 C9 74 09          test exponent; branch to result
48 0F AF D0             multiply result by base
48 FF C9 75 F7          decrement exponent; loop
52                      push result
6A 41                   push 65
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `1665`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

The slice covers only the already-settled positive integer exponent. Negative
or non-integral power semantics remain outside it. No public syntax, API,
schema, ABI, or diagnostic changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-power-chain-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 14.64 s;
- intended failure: the generated Stage-2 compiler could not lower the
  missing private power-chain selector.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 13.54 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `1665`;
- both contained the exact 41-byte compositional instruction stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Compositional regression command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-floor-division-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-power-chain-fixed-point.test.mjs
```

- exit `0`, 4/4 passed in 22.04 s.

Full focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-power-chain-fixed-point.test.mjs `
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

- exit `0`, 16/16 passed in 49.04 s;
- every earlier native primitive, compositional tape, fixed-point graph, and
  bundle identity remained exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 34.75 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git
index remained clean after the I192 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `DFD6D966CC50AA3B4827917568DA9EEE291A886714DA7D241E78F87D5BEF1DBC`
- bootstrap manifest checkout bytes:
  `D9CEA058704489FCD234DBB7513BDF8A114F3A596C6C47072958994943E0365A`
- canonical compiler facade source:
  `51EF86142B573D8C08A4BF3726E9FC837A7FE0DD08BC51AEBFF3A8D6724A401A`
- I193 acceptance test canonical bytes:
  `5A41DA173B49A9D8F22CB29EF8A23A27A021D7FD850ED13ED07812F61B2DBECC`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I193 proves raw small-byte value encoding and a loop-based integer opcode can
participate in a compositional Stage-2-owned tape. Gate 6 remains open on
wider immediate encoding, true-division value representation, relocation, and
compilation of the complete locked compiler graph into Stage 3.

Re-evaluated from I192's 92.1%, 0.5.0 is conservatively **92.7% total**, **+0.6
percentage points** for raw small-immediate encoding plus compositional power
selection with exact Stage-0/2/3 behavior.

## Handoff inventory

I193 broadens the private immediate encoder and integer tape selector, rotates
compiler and bundle hashes, adds one fixed-point test, and records this
receipt. Existing dirty files and untracked `.work/` remain preserved. No
commit, push, or merge was performed for I193.
