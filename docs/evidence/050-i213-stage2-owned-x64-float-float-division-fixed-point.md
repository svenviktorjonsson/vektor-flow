# 050-I213 Stage-2-owned floating division evidence

## Scope

- Git base: `853f0479`
- Consumed packet: committed I212 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I213 completes the private typed division representation family:

```vkf
value: 8
:: (value / 2) / (6 / 3)
```

Both grouped subexpressions push exact `f64` bits. The outer division restores
the right then left operands, executes ordered `divsd`, and prints exact `2`.

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 5E C1                   divsd xmm0, xmm1
66 48 0F 7E C0 50             push exact quotient bits
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
  tests/bootstrap/stage2-owned-x64-float-float-division-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 17.39 s; the private floating writer was absent.
- GREEN: exit `0`, 1/1 in 17.02 s after correcting the test harness argument
  order; exact Stage0/2/3 stdout/x64 and Stage fixed-point identities passed.
- broad x64/output/locked-source differential: 35/35 in 198.05 s with
  concurrency capped at four.
- locked source graph and executable bundle: 3/3 in 51.99 s.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `BB757EA26F51ED2858739007EB181D1E36C5007D21D545859639252FCAA312C1`
- bootstrap manifest canonical bytes:
  `EE58EEFF6BF9FC9408F470CE30CAA2C3C11D9DD4BE5E252C1728AF8637F638E7`
- canonical compiler facade source:
  `851C6F8989E77A364F2BE1F9E8F8D3340C638F95A6855BA743B437D979265667`
- I213 acceptance test canonical bytes:
  `ADA0F25B49204B8AF4CA0AE37DA4B6DFD11C9FE9722E66C190C52C0A88E985EB`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I213 proves floating-left/floating-right division in the Stage-2-owned grouped
native writer at fixed point. All integer/floating representations for
addition, multiplication, subtraction, and true division are now covered.
Gate 6 remains open on signed dynamic-tape loads, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.

Re-evaluated from I212's 98.7%, 0.5.0 is conservatively **98.9% total**,
**+0.2 percentage points** for completing typed division emission.

## Handoff inventory

I213 adds one private floating division selector, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. No push or merge
was performed.
