# 050-I212 Stage-2-owned integer-float division evidence

## Scope

- Git base: `52f3a9f6`
- Consumed packet: committed I211 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I212 closes the reverse mixed-representation division boundary:

```vkf
value: 9
:: value / (8 / 4)
```

The grouped division pushes exact `f64` bits. The outer division restores the
floating right operand, converts the integer left operand, executes ordered
`divsd`, and returns exact `4.5`.

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 F2 48 0F 2A C0             pop/convert integer left to xmm0
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
  tests/bootstrap/stage2-owned-x64-integer-float-division-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 12.97 s; the private grouped typed writer was absent.
- GREEN: exit `0`, 1/1 in 20.42 s; exact Stage0/2/3 stdout and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.
- broad x64/output/locked-source differential: 34/34 in 247.45 s with
  concurrency capped at four.
- locked source graph and executable bundle: 3/3 in 54.82 s.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `32168F2918E744D5809D42016C66CCE3D0FF68D901266461B0AE26F4212819E8`
- bootstrap manifest canonical bytes:
  `FB375FE5882633E820A1C1EF531D1AEC9E6D234D49BB9F5BBA431C1C8F9C9790`
- canonical compiler facade source:
  `0039962A1E884986532D31BB86EB218E9EE037B6C7884348B1D2D5BDE2E2E365`
- I212 acceptance test canonical bytes:
  `44D34DE7E57F355E563CB1DFD92212EF2938A23330DAB301E777E4C50505C371`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I212 proves integer-left/floating-right division in the Stage-2-owned grouped
native writer at fixed point. Gate 6 remains open on float/float division,
signed dynamic-tape loads, relocations, byte-arena packaging, and rebuilding
the complete locked compiler graph into Stage 3.

Re-evaluated from I211's 98.5%, 0.5.0 is conservatively **98.7% total**,
**+0.2 percentage points** for reverse typed division emission.

## Handoff inventory

I212 adds one private integer-float division selector, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No push or
merge was performed.
