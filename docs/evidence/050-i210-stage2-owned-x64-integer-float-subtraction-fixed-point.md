# 050-I210 Stage-2-owned integer-float subtraction evidence

## Scope

- Git base: `6efc9b14`
- Consumed packet: committed I209 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I210 closes the reverse mixed-representation subtraction boundary:

```vkf
value: 9
:: value - (6 / 3)
```

The grouped division pushes exact `f64` bits. Subtraction restores the
floating right operand, converts only the integer left operand, executes
ordered `subsd`, and returns exact `7` through the floating print tail.

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 F2 48 0F 2A C0             pop/convert integer left to xmm0
F2 0F 5C C1                   subsd xmm0, xmm1
66 48 0F 7E C0 50             push exact difference bits
```

Stage 2 and Stage 3 match Stage 0 exactly. Their programs are byte-identical,
as are the Stage-2, Stage-3, and Stage-4 compiler artifacts. The path uses
neither `--vkf-internal-stage-observation` nor `process.run_native`.

The selector and writer entry point are private bootstrap details. No public
syntax, semantics, API, diagnostics, schema, ABI, UI, renderer, or native
bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-integer-float-subtraction-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 14.29 s; the private grouped typed writer was absent.
- GREEN: exit `0`, 1/1 in 18.17 s; exact Stage0/2/3 stdout and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.
- broad x64/output/locked-source differential: 32/32 in 216.89 s with
  concurrency capped at four.
- locked source graph and executable bundle: 3/3 in 46.66 s.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `2AD0FB7F07DA30D54830AD5201CBCC9A40C6CDC918DC25F6400CAAAD7CB19960`
- bootstrap manifest canonical bytes:
  `CBD71988BD9BD30711E6E67953E0B2359273E44FDFE37B129B28BB3F705B7BCC`
- canonical compiler facade source:
  `9BC65912E3BDCE08B612E4DDAED25F70A23788576314BE9A349DFACF734A7ECA`
- I210 acceptance test canonical bytes:
  `68C7CC65AE91712460735EAEC5C4C5D6DCC1E2613CFD4D29AE6991E297501C2F`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I210 proves integer-left/floating-right subtraction in the Stage-2-owned
grouped native writer at fixed point. Gate 6 remains open on float/float
subtraction, reverse and float/float division, signed dynamic-tape loads,
relocations, byte-arena packaging, and rebuilding the complete locked compiler
graph into Stage 3.

Re-evaluated from I209's 98.1%, 0.5.0 is conservatively **98.3% total**,
**+0.2 percentage points** for reverse typed subtraction emission.

## Handoff inventory

I210 adds one private integer-float subtraction selector, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No push or
merge was performed.
