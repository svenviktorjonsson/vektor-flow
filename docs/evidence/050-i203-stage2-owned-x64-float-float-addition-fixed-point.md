# 050-I203 Stage-2-owned floating-addition evidence

## Scope

- Git base: `d765e1f6`
- Consumed packet: committed I202 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

The Gate-6 audit still identifies general writer coverage as the nearest
blocker between the current bounded Stage2 artifact and a full Stage3 rebuild.
I203 closes the remaining addition representation pair while also exercising
the complete three-slot private numeric stack:

```vkf
value: 90
:: value / 40 + 3 / 2
```

Each true division replaces two integer representations with one `f64`
representation. The second division reaches validated stack depth three.
The final addition restores both exact floating bit patterns into distinct
registers, performs `addsd`, and pushes the exact result bits for the floating
return tail.

The selected runtime sequence contains two independently assembled division
fragments followed by:

```text
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 58 C1                   addsd xmm0, xmm1
66 48 0F 7E C0 50             push exact sum bits
58 66 48 0F 6E C0 C3          restore xmm0 and return
```

Stage 2 and Stage 3 print `3.75`, exactly matching Stage 0. Their programs are
byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler artifacts.
The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

No public syntax, semantics, API, diagnostics, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-float-float-addition-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 23.76 s;
- intended failure: the compiler could not resolve the absent private
  complete-addition numeric-chain writer.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 18.44 s;
- Stage-2 and Stage-3 programs returned exact Stage-0 stdout `3.75`;
- both programs contained the independently assembled byte stream;
- Stage-2/Stage-3 programs were byte-identical;
- Stage-2/Stage-3/Stage-4 compilers were byte-identical.

The margin suite covered all four addition representation pairs, terminal
division, positive `imm64`, the complete integer writer, bounded arithmetic,
and the locked Stage-2 graph paths.

- exit `0`, 14/14 passed in 59.44 s.

The full x64/locked-source differential passed 26/26 in 86.09 s. The locked
executable-bundle gate passed 1/1 in 47.96 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `72117CC1A1A5084047489A5F0BC558D0726FDED3777D354B12E36BE04A253B72`
- bootstrap manifest canonical bytes:
  `0180033D8D7BAEAEEC5B976394CDAB14D45B8A5C1AF9019EE030BE0A2F2D10EE`
- canonical compiler facade source:
  `5B3AEA38A7F218645ABB34DAE8173F829C71CFEB2BA45D9A69B06D67987EC0CF`
- I203 acceptance test canonical bytes:
  `4B0A13DCA4F62CDF215BF60A1F7FDC555ACAD26B7A69C7FFFDC5DD8DCA2724DA`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I203 proves every integer/`f64` operand pairing for addition, including two
simultaneous fractional branches at maximum current stack depth. Gate 6
remains open on other floating arithmetic families, signed dynamic-tape
loads, relocations, byte-arena packaging, and rebuilding the complete locked
compiler graph into Stage 3.

Re-evaluated from I202's 96.5%, 0.5.0 is conservatively **96.8% total**,
**+0.3 percentage points** for complete typed-stack addition selection.

## Handoff inventory

I203 adds one private floating-addition selector, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. No push or merge
was performed.
