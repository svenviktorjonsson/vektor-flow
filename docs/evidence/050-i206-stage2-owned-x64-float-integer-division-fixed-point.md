# 050-I206 Stage-2-owned chained-division evidence

## Scope

- Git base: `e7678470`
- Consumed packet: committed I205 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I206 closes the next private typed-numeric writer boundary:

```vkf
value: 9
:: value / 4 / 2
```

The first true division pushes exact `f64` bits. The second division restores
that floating left operand, converts only the integer right operand, executes
ordered `divsd`, and returns exact `1.125` through the floating tail.

```text
58 F2 48 0F 2A C8             pop/convert integer right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 5E C1                   divsd xmm0, xmm1
66 48 0F 7E C0 50             push exact quotient bits
```

Stage 2 and Stage 3 match Stage 0 exactly. Their programs are byte-identical,
as are the Stage-2, Stage-3, and Stage-4 compiler artifacts. The path uses
neither `--vkf-internal-stage-observation` nor `process.run_native`.

No public syntax, semantics, API, diagnostics, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

Command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-float-integer-division-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 14.69 s; the private chained-division writer was
  absent.
- GREEN: exit `0`, 1/1 in 16.94 s; exact Stage0/2/3 stdout and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.

The broad x64/output/locked-source differential passed 28/28 in 88.17 s.
The locked source-graph and executable-bundle gate passed 3/3 in 41.29 s.
One parallel bundle run first completed all compiler work but hit Windows
`EPERM` while deleting its temporary directory; the immediate isolated rerun
passed, confirming cleanup contention rather than a compiler mismatch.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `3F5FB9FFFB9552B33FDE4CB44898E8D62660D9266DB0126AB5D7EE4C0DF2D810`
- bootstrap manifest canonical bytes:
  `9687B879AAB1F485B34D4C9BCE8E327E234AA94AF4742CEC395BA2702AB9680F`
- canonical compiler facade source:
  `4065B049BB30564879A0B57CD4B7EC5B22FA99FDE736670EEE5576A52187D8F5`
- I206 acceptance test canonical bytes:
  `279FF5812AE310C73D801A26AC96EDEFE7363C3C9467567289ABB80CE49D13F6`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I206 proves that true division can consume an earlier fractional result in a
Stage-2-owned native chain at fixed point. Gate 6 remains open on the reverse
and float/float typed orders, other floating arithmetic families, signed
dynamic-tape loads, relocations, byte-arena packaging, and rebuilding the
complete locked compiler graph into Stage 3.

Re-evaluated from I205's 97.2%, 0.5.0 is conservatively **97.4% total**,
**+0.2 percentage points** for chained typed division.

## Handoff inventory

I206 adds one private chained-division selector, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. No push or merge
was performed.
