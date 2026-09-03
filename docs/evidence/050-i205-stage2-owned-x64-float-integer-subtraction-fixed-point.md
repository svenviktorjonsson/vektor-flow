# 050-I205 Stage-2-owned mixed-subtraction evidence

## Scope

- Git base: `6e620817`
- Consumed packet: committed I204 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I205 closes the next reachable private typed-numeric writer boundary:

```vkf
value: 9
:: value / 4 - 1
```

The settled true-division opcode leaves an exact `f64` representation on the
private stack. The subtraction selector restores that left operand, converts
only the integer right operand, performs ordered `subsd`, and pushes the exact
floating result bits:

```text
58 F2 48 0F 2A C8             pop/convert integer right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 5C C1                   subsd xmm0, xmm1
66 48 0F 7E C0 50             push exact difference bits
```

Stage 2 and Stage 3 print `1.25`, exactly matching Stage 0. Their programs are
byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler artifacts.
The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`.

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
  tests/bootstrap/stage2-owned-x64-float-integer-subtraction-fixed-point.test.mjs
```

RED:

- exit `1`, 0/1 passed in 13.58 s;
- intended failure: Stage 0 could not resolve the absent private typed
  subtraction writer entry point.

GREEN:

- exit `0`, 1/1 passed in 17.53 s;
- Stage-2 and Stage-3 programs returned exact Stage-0 stdout `1.25`;
- both programs contained the independently assembled byte stream;
- Stage-2/Stage-3 programs were byte-identical;
- Stage-2/Stage-3/Stage-4 compilers were byte-identical.

The broad x64/output/locked-source differential passed 27/27 in 85.02 s.
The locked source-graph and executable-bundle gate passed 3/3 in 48.26 s,
including canonical source and bundle digest validation.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `26A1CFAA42DCC04F1F57634EC13975AA0456D0229005D87E50C73CCC2B04CC75`
- bootstrap manifest canonical bytes:
  `D6ACB5F5C5AF8EF1C9409417EF754BC61B04FFEBF9F2CD1842989B628DFCE798`
- canonical compiler facade source:
  `9D94EADAFA9CF2265E4781AABF9C09AEEB79848917AF763480228F5AD8134DAC`
- I205 acceptance test canonical bytes:
  `C8108E8727E27420E9C1853452CCABD4B0F9A2DA8EB2144871050B650F29A738`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I205 proves that ordered subtraction consumes a fractional typed-stack value
through Stage-2-owned native emission at fixed point. Gate 6 remains open on
reverse and float/float multiplication and subtraction, other floating
arithmetic families, signed dynamic-tape loads, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.

Re-evaluated from I204's 97.0%, 0.5.0 is conservatively **97.2% total**,
**+0.2 percentage points** for mixed-representation subtraction.

## Handoff inventory

I205 adds one private mixed-subtraction selector, rotates compiler and bundle
hashes, adds one fixed-point test, and records this receipt. No push or merge
was performed.
