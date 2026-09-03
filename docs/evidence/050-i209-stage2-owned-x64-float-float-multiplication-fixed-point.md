# 050-I209 Stage-2-owned floating multiplication evidence

## Scope

- Git base: `719d122b`
- Consumed packet: committed I208 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I209 completes the private typed multiplication representation family:

```vkf
value: 8
:: (value / 4) * (6 / 3)
```

Both grouped divisions push exact `f64` bits. Multiplication restores the
floating operands in left/right order, executes `mulsd`, and returns exact
`4` through the floating print tail.

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 59 C1                   mulsd xmm0, xmm1
66 48 0F 7E C0 50             push exact product bits
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
  tests/bootstrap/stage2-owned-x64-float-float-multiplication-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 13.99 s; the private floating writer was absent.
- GREEN: exit `0`, 1/1 in 18.52 s; exact Stage0/2/3 stdout and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.
- broad x64/output/locked-source differential: 31/31 in 170.98 s with
  concurrency capped at four.
- locked source graph and executable bundle: 3/3 in 54.47 s.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `25A5159E2C705C6D98FBE07CA0A9724B3340DC8704DC44FE98696B858D9DCF7A`
- bootstrap manifest canonical bytes:
  `6C568F7F8E9ABC4A5A779EC1DCE7EF77BB6A0558C2AA33F0349F8999B9F9B72A`
- canonical compiler facade source:
  `D2EC12718D0392ED8EBD0816FC19484BBEE14D0093A5813BF7A8161F1706FDA2`
- I209 acceptance test canonical bytes:
  `276D5A41D32957856F5B3860FB8D1DAEDFBA47737B41E2C7F369F43BB888766C`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I209 proves floating-left/floating-right multiplication in the Stage-2-owned
grouped native writer at fixed point. All four integer/floating multiplication
representations are now covered. Gate 6 remains open on reverse and
float/float subtraction/division, signed dynamic-tape loads, relocations,
byte-arena packaging, and rebuilding the complete locked compiler graph into
Stage 3.

Re-evaluated from I208's 97.9%, 0.5.0 is conservatively **98.1% total**,
**+0.2 percentage points** for completing typed multiplication emission.

## Handoff inventory

I209 adds one private floating multiplication selector, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No push or
merge was performed.
