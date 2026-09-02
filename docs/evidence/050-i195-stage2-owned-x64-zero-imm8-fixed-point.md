# 050-I195 Stage-2-owned zero-imm8 evidence

## Scope

- Git base: `d01ead60`
- Consumed packet: committed I194 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I195 closes the remaining non-negative x64 `imm8` value boundary by proving
that a zero byte survives the self-hosted string-backed byte path:

```vkf
value: 65
:: value * 0 + 40
```

The private encoder emits `0x00` inside the generated artifact. Stage 2 and
Stage 3 both preserve the embedded null byte without truncating subsequent
instructions. The selected 26-byte x64 stream is:

```text
6A 41                   push 65
6A 00                   push 0
58 59 48 0F AF C1 50    multiply and push
6A 28                   push 40
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `40`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

Negative immediates and values requiring `imm32` remain separate work. No
public syntax, API, schema, ABI, or diagnostic changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-owned-x64-zero-imm8-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 13.21 s;
- intended failure: Stage 2 returned status `3` when the private encoder
  rejected zero outside its previous positive range.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 13.19 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `40`;
- both contained the exact `6A 00` encoding and all following bytes;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Margin-focused command:

```powershell
node --test `
  tests/bootstrap/stage2-owned-x64-zero-imm8-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-positive-imm8-boundary-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-arithmetic-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-remainder-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-floor-division-chain-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-power-chain-fixed-point.test.mjs
```

- exit `0`, 6/6 passed in 24.58 s.

The full x64/locked-source differential passed 18/18 in 53.37 s. The locked
executable-bundle gate passed 1/1 in 47.63 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. The Git
index remained clean after the I194 commit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `D919F382B08928CEBF906D0EC9F1A613304DDDD13356CD9E10DC0E00174049D9`
- bootstrap manifest checkout bytes:
  `0C2ED0CF1C06FD422FCDA5F842D48B73A618E4FF5B09A385B02B216A5E069957`
- canonical compiler facade source:
  `C3C67C94B4DB426FD3CD72CA04EAA6060A6E0E3B3AAFFAD1E538765B42D9F16B`
- I195 acceptance test canonical bytes:
  `C0BD23BE6F6EDEE4F5C9713536E43E040242CC630B8371A65EDFDFAC1CC57F13`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I195 proves byte-exact embedded-null handling and closes the non-negative
`imm8` encoder range. Gate 6 remains open on negative values, `imm32`,
true-division representation, relocation, and compilation of the complete
locked compiler graph into Stage 3.

Re-evaluated from I194's 93.1%, 0.5.0 is conservatively **93.5% total**, **+0.4
percentage points** for exact zero-immediate encoding across the complete
Stage-2/Stage-3 artifact path.

## Handoff inventory

I195 extends the private immediate encoder by one boundary, rotates compiler
and bundle hashes, adds one fixed-point test, and records this receipt.
Existing dirty files and untracked `.work/` remain preserved. No push or merge
was performed.
