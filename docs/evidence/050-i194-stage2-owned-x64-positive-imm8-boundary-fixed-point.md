# 050-I194 Stage-2-owned positive-imm8 evidence

## Scope

- Git base: `896be2ef`
- Consumed packet: committed I193 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I194 advances Gate 6 value encoding from selected printable bytes and small
exponents to the complete positive x64 `imm8` range. The boundary source is:

```vkf
value: 127
:: value + 1
```

The private encoder emits both numeric values as raw bytes through the x64
`push imm8` instruction. The selected 17-byte stream is:

```text
6A 7F                   push 127
6A 01                   push 1
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `128`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

This private slice deliberately excludes zero, negative immediates, and
values requiring `imm32`; those representations remain separate work. No
public syntax, API, schema, ABI, or diagnostic changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-positive-imm8-boundary-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 17.91 s;
- intended failure: Stage 2 returned status `3` when the private encoder
  rejected value `127` outside its previous byte subset.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 14.11 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `128`;
- both contained the exact 17-byte instruction stream with `6A 7F`;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Compositional regression command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-positive-imm8-boundary-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-floor-division-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-power-chain-fixed-point.test.mjs
```

- exit `0`, 5/5 passed in 22.14 s.

Full focused differential command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-positive-imm8-boundary-fixed-point.test.mjs `
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

- exit `0`, 17/17 passed in 56.57 s;
- every earlier primitive, compositional tape, fixed-point graph, and bundle
  identity remained exact.

Locked-bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 39.74 s;
- every declared compiler source emitted as an executable and ran.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git
index remained clean after the I193 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `54EDB5F8B66B43C74AA1B8ECEB3EB24AA97D025769954F25CB9D11348158610A`
- bootstrap manifest checkout bytes:
  `329D73E59D43BB8C399D9916F86ADBE5A3E833B02A6FA65740AA10B991279B65`
- canonical compiler facade source:
  `4B05498634FD329B5DE33553F8D905D667C4E2A1A19603C1A0EF443DC393ECDF`
- I194 acceptance test canonical bytes:
  `6268BD4B45A69DC95C8459464B0FFAA0B2755FCB2B3214C7D7D3D31A54A38C84`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I194 proves deterministic raw-byte encoding across the positive x64 `imm8`
range, eliminating the earlier printable-character subset. Gate 6 remains
open on zero/negative values, `imm32`, true-division representation,
relocation, and compilation of the complete locked compiler graph into
Stage 3.

Re-evaluated from I193's 92.7%, 0.5.0 is conservatively **93.1% total**, **+0.4
percentage points** for full positive-imm8 value encoding with exact
Stage-0/2/3 behavior.

## Handoff inventory

I194 simplifies and widens the private immediate encoder, rotates compiler and
bundle hashes, adds one fixed-point boundary test, and records this receipt.
Existing dirty files and untracked `.work/` remain preserved. No push or merge
was performed.
