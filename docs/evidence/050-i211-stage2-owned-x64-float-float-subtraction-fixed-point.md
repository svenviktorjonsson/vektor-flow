# 050-I211 Stage-2-owned floating subtraction evidence

## Scope

- Git base: `d07caf8b`
- Consumed packet: committed I210 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I211 completes the private typed subtraction representation family:

```vkf
value: 8
:: (value / 2) - (6 / 3)
```

Both grouped divisions push exact `f64` bits. Subtraction restores operands
in left/right order, executes `subsd`, and returns exact `2`.

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 5C C1                   subsd xmm0, xmm1
66 48 0F 7E C0 50             push exact difference bits
```

Stage 2 and Stage 3 match Stage 0 exactly. Their programs are byte-identical,
as are the Stage-2, Stage-3, and Stage-4 compiler artifacts. The path uses
neither internal stage observation nor `process.run_native`.

No public syntax, semantics, API, diagnostics, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-float-float-subtraction-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 13.34 s; the private floating writer was absent.
- GREEN: exit `0`, 1/1 in 20.91 s; exact Stage0/2/3 stdout and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.
- broad x64/output/locked-source differential: 33/33 in 193.09 s with
  concurrency capped at four.
- locked source graph and executable bundle: 3/3 in 39.82 s.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `CABB9ECE42DC2642878D915F64F6BB82B6C278E92E4B74FA571E7F4BD4A4AB48`
- bootstrap manifest canonical bytes:
  `BDCAC37F5D9D6035D5D6D9103A5B4B1D80F45485CCBF14FD458C9F73C74B9CFC`
- canonical compiler facade source:
  `D5700245C44BDA81CA7748862C36267AD4ADB397E67900844C000E5876BDA767`
- I211 acceptance test canonical bytes:
  `1D02B1BBCF1B6EF9B782487576B46035E0BEA00106A6B81EE57284F0083338A6`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I211 proves floating-left/floating-right subtraction in the Stage-2-owned
grouped native writer at fixed point. All four integer/floating subtraction
representations are now covered. Gate 6 remains open on reverse and
float/float division, signed dynamic-tape loads, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.

Re-evaluated from I210's 98.3%, 0.5.0 is conservatively **98.5% total**,
**+0.2 percentage points** for completing typed subtraction emission.

## Handoff inventory

I211 adds one private floating subtraction selector, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No push or
merge was performed.
