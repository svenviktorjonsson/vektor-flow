# 050-I207 Stage-2-owned grouped numeric-chain evidence

## Scope

- Git base: `60edd67e`
- Consumed packet: committed I206 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I207 removes the next private writer traversal blocker. The typed x64 writer
can now select the already-authoritative grouped arithmetic frontend rather
than being restricted to the ungrouped mixed-expression frontend:

```vkf
value: 18
:: value / (4 + 2)
```

The grouped tape has maximum stack depth three and emits exact integer
addition followed by true division. Stage 2 and Stage 3 print `3`, matching
Stage 0. Their programs are byte-identical, as are the Stage-2, Stage-3, and
Stage-4 compiler artifacts. The path uses neither internal stage observation
nor `process.run_native`.

The grouping selector and grouped writer entry point are private bootstrap
implementation details. No public syntax, semantics, API, diagnostics,
schema, ABI, UI, renderer, or native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-grouped-numeric-chain-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 12.56 s; the private grouped writer was absent.
- GREEN: exit `0`, 1/1 in 18.53 s; exact Stage0/2/3 output and x64 bytes,
  Stage2/3 program identity, and Stage2/3/4 compiler identity.
- broad x64/output/locked-source differential: 29/29 in 94.63 s.
- locked source graph and executable bundle: 3/3 in 47.39 s.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `71CD86A8AB30AADECFD828AFF9D59FF0E69DB6332388720DB603D9F09D3B902D`
- bootstrap manifest canonical bytes:
  `7A6F122A57DEC69B951DCABFB8AD7AB6107A9EE38EAE24F15814B6BB4339C474`
- canonical compiler facade source:
  `AAB89458AAC1E862931FA4FF26B5A7C57752F7FA951F24E9E74FBA62A1F910A4`
- I207 acceptance test canonical bytes:
  `A17C21A74553186F9E59A90105C348902059C73386184EE9C1BE502FCA80F7CE`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I207 proves Stage-2-owned native emission can consume the settled grouped
arithmetic tape at fixed point. This directly unlocks right-hand fractional
and float/float representation tests without duplicating emitter logic.
Gate 6 remains open on those typed selectors, signed dynamic-tape loads,
relocations, byte-arena packaging, and rebuilding the complete locked
compiler graph into Stage 3.

Re-evaluated from I206's 97.4%, 0.5.0 is conservatively **97.7% total**,
**+0.3 percentage points** for grouped typed-writer traversal.

## Handoff inventory

I207 adds one private grouped-statement selector and writer entry point,
rotates compiler and bundle hashes, adds one fixed-point test, and records
this receipt. No push or merge was performed.
