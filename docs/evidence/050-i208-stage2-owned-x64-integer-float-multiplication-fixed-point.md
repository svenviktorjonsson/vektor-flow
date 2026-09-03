# 050-I208 Stage-2-owned integer-float multiplication evidence

## Scope

- Git base: `f60e087b`
- Consumed packet: committed I207 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I208 closes the next private typed-numeric writer boundary unlocked by grouped
expression traversal:

```vkf
value: 3
:: value * (8 / 4)
```

The grouped division pushes exact `f64` bits. Multiplication restores the
floating right operand, converts only the integer left operand, executes
`mulsd`, and returns exact `6` through the floating print tail.

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 F2 48 0F 2A C0             pop/convert integer left to xmm0
F2 0F 59 C1                   mulsd xmm0, xmm1
66 48 0F 7E C0 50             push exact product bits
```

Stage 2 and Stage 3 match Stage 0 exactly. Their programs are byte-identical,
as are the Stage-2, Stage-3, and Stage-4 compiler artifacts. The path uses
neither `--vkf-internal-stage-observation` nor `process.run_native`.

The selector and grouped writer entry point are private bootstrap details.
No public syntax, semantics, API, diagnostics, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-integer-float-multiplication-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 16.89 s; the private grouped typed writer was absent.
- GREEN: exit `0`, 1/1 in 19.37 s; exact Stage0/2/3 stdout and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.
- broad x64/output/locked-source differential: 30/30 in 177.08 s with
  concurrency capped at four.
- locked source graph and executable bundle: 3/3 in 42.38 s.

An initial unconstrained broad run passed 29/30; one pre-existing imm8 test
exceeded its 20-second child timeout under contention. Its isolated rerun
passed 1/1 in 15.24 s, and the complete concurrency-four rerun passed 30/30.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `5580C0030BA8C1F65183541D47753A5437DE16C6AB0188F456E8AD1F38DB1F28`
- bootstrap manifest canonical bytes:
  `AC1F87F87BC68005F90CA8558BD61772117F57F93E3279C7C634E66AA3AACC67`
- canonical compiler facade source:
  `9CE8303D7115EDB17988065FD9187C8823640E74D2D952D34FFDD418B5C629BE`
- I208 acceptance test canonical bytes:
  `91C77152D723CB93D189466FB49FBFECBD2F636CB312D2EA380A14F8383D57ED`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I208 proves integer-left/floating-right multiplication in the Stage-2-owned
grouped native writer at fixed point. Gate 6 remains open on float/float
multiplication, reverse and float/float subtraction/division, signed dynamic
tape loads, relocations, byte-arena packaging, and rebuilding the complete
locked compiler graph into Stage 3.

Re-evaluated from I207's 97.7%, 0.5.0 is conservatively **97.9% total**,
**+0.2 percentage points** for the typed multiplication representation.

## Handoff inventory

I208 adds one private integer-float multiplication selector, rotates compiler
and bundle hashes, adds one fixed-point test, and records this receipt. No push
or merge was performed.
