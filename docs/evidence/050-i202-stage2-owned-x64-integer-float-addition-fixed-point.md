# 050-I202 Stage-2-owned reverse mixed-addition evidence

## Scope

- Git base: `d28dfb05`
- Consumed packet: committed I201 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I202 closes the reverse mixed-representation addition order in the private
Stage-2 numeric writer:

```vkf
value: 1
:: value + 90 / 40
```

The I201 representation stack identifies the left operand as integer and the
right operand as `f64`. A distinct internal selector restores the right
floating bits into `xmm1`, converts only the left integer into `xmm0`, and
performs the settled addition. It does not rely on an unsafe operand swap.

The independently selected x64 body is:

```text
6A 01                         push 1
6A 5A                         push 90
6A 28                         push 40
58 F2 48 0F 2A C8             pop/convert division right to xmm1
58 F2 48 0F 2A C0             pop/convert division left to xmm0
F2 0F 5E C1                   divsd xmm0, xmm1
66 48 0F 7E C0 50             push exact division bits
58 66 48 0F 6E C8             pop/restore floating right to xmm1
58 F2 48 0F 2A C0             pop/convert integer left to xmm0
F2 0F 58 C1                   addsd xmm0, xmm1
66 48 0F 7E C0 50             push exact sum bits
58 66 48 0F 6E C0 C3          restore xmm0 and return
```

Stage 2 and Stage 3 print `3.25`, exactly matching Stage 0. Their programs are
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
  tests/bootstrap/stage2-owned-x64-integer-float-addition-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 15.87 s;
- intended failure: the compiler could not resolve the absent private
  bidirectional numeric-chain writer.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 20.30 s;
- Stage-2 and Stage-3 programs returned exact Stage-0 stdout `3.25`;
- both programs contained the independently assembled byte stream;
- Stage-2/Stage-3 programs were byte-identical;
- Stage-2/Stage-3/Stage-4 compilers were byte-identical.

The margin suite covered I202, I201, terminal division, positive `imm64`, the
complete integer writer, compositional integer arithmetic, bounded division,
integer addition/multiplication, and the locked Stage-2 graph paths.

- exit `0`, 13/13 passed in 44.38 s.

The full x64/locked-source differential passed 25/25 in 99.91 s. The locked
executable-bundle gate passed 1/1 in 43.84 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `B6194B5D0B60D8C72512744D4D0242300B0C5D6899C90438A881054286DFF984`
- bootstrap manifest canonical bytes:
  `0381E0FCB1421FD811F8B779B62925A446B9156BEA086B47BAB199E013C85E6C`
- canonical compiler facade source:
  `579E064BFAAA2909945621B609C5D8D1FE7A2A5C6B2B7B23397FC91CA49A5D70`
- I202 acceptance test canonical bytes:
  `3B59A6F53D2B25C67BC5881F0CD493D9CAB926594450D121DB2F91D69203B33C`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I202 proves both integer/`f64` addition operand orders are selected correctly
by the Stage-2-owned typed numeric stack at fixed point. Gate 6 remains open
on floating multiplication/subtraction/division chains, signed dynamic-tape
loads, relocations, byte-arena packaging, and rebuilding the complete locked
compiler graph into Stage 3.

Re-evaluated from I201's 96.2%, 0.5.0 is conservatively **96.5% total**,
**+0.3 percentage points** for reverse mixed-addition selection.

## Handoff inventory

I202 adds one private reverse mixed-addition selector, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No push or
merge was performed.
