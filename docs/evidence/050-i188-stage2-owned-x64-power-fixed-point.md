# 050-I188 Stage-2-owned x64 power evidence

## Scope

- Git base: `cd2e8778`
- Consumed packet: committed I187 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I188 extends valid-input Stage-2-owned native emission with positive integer
power:

```vkf
value: 40
:: value ^ 2
```

The Stage-2 compiler verifies the locked `load-load-power-print` Machine-IR
tape, emits the source-derived base and decimal exponent, then uses a bounded
x64 multiplication loop. It writes the PE through direct `.io.write_bytes`.
The emitted code decodes the decimal exponent byte, initializes the result to
one, multiplies until the exponent reaches zero, converts to `f64`, and returns.

Stage 2 and Stage 3 both print `1600`, exactly matching Stage 0. Their program
outputs and bytes are identical, as are Stage-2, Stage-3, and Stage-4 compiler
bytes. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

This remains a bounded valid-input encoder for a single decimal, non-negative
integer exponent and a printable one-byte base. Negative or fractional powers,
overflow policy, general encoding, instruction selection, relocation, and
complete compiler-graph emission remain open. No public semantic or diagnostic
choice is made.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All child processes used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-power-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 26.47 s;
- intended failure: the generated Stage-2 compiler could not resolve the
  missing private runtime-power emission function.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 19.36 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `1600`;
- both contained the exact 38-byte runtime integer-power sequence;
- Stage-2/Stage-3 program and Stage-2/3/4 compiler artifacts were exact.

Focused differential command:

```powershell
node --test `
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

- exit `0`, 11/11 passed in 34.60 s;
- all prior native operations, graph materialization, and identities stayed
  exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 48.35 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git index
remained clean after the I187 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `35F445217A5C9FFD5E8BBA6281FF97F56B173C2A71907C4B61A4EC244643B7C8`
- bootstrap manifest checkout bytes:
  `20A9FB41B2FF53ED27C202398C2444F0CE67E9169C433BE63043585BE86D5CBA`
- canonical compiler facade source:
  `74002DA0E68864CA96FE934F265B47EB3728105ED7142E9FB49493DA3FE349DE`
- I188 acceptance test canonical bytes:
  `3ABBEA5487E6EC15E6B091AEF831B145E3EAAE330281DF6ED5F468B45CF36B72`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

This closes bounded positive integer power at runtime in a Stage-2-owned x64
artifact and reproduces it at the Stage-3 fixed point. All settled binary
arithmetic opcode families now have a direct valid-input native tracer. Gate 6
remains open because these emitters are bounded fragments rather than a general
instruction selector, and the full locked compiler graph is not compiled into
Stage 3.

Re-evaluated from I187's 89.1%, 0.5.0 is conservatively **89.6% total**, **+0.5
percentage points** for native positive-integer power and complete settled
binary arithmetic tracer coverage.

## Handoff inventory

I188 adds one private runtime-power emitter, rotates the locked compiler and
bundle hashes, adds one focused test, and records this receipt. Existing dirty
files and untracked `.work/` content remain preserved. No commit, push, or
merge was performed for I188.
