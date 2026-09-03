# 050-I201 Stage-2-owned typed numeric-stack evidence

## Scope

- Git base: `6c851eee`
- Consumed packet: committed I200 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I201 extends the private Stage-2 writer from terminal true division to one
settled post-division arithmetic path:

```vkf
value: 90
:: value / 40 + 1
```

The writer now mirrors the validated maximum-three-value Machine-IR stack with
three private representation slots. Loads enter as integers; true division
replaces two integer slots with one `f64` slot; the new addition selector
accepts an `f64` left operand and integer right operand, converts only the
integer, and retains an exact `f64` result. Other unimplemented representation
orders reject inside the private writer instead of selecting integer code.

The independently selected x64 body is:

```text
6A 5A                         push 90
6A 28                         push 40
58 F2 48 0F 2A C8             pop/convert right to xmm1
58 F2 48 0F 2A C0             pop/convert left to xmm0
F2 0F 5E C1                   divsd xmm0, xmm1
66 48 0F 7E C0 50             push exact xmm0 bits
6A 01                         push 1
58 F2 48 0F 2A C8             pop/convert integer right to xmm1
58 66 48 0F 6E C0             pop/restore floating left to xmm0
F2 0F 58 C1                   addsd xmm0, xmm1
66 48 0F 7E C0 50             push exact xmm0 bits
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
  tests/bootstrap/stage2-owned-x64-float-integer-addition-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 15.51 s;
- intended failure: the compiler could not resolve the absent private typed
  numeric-chain writer.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 17.72 s;
- Stage-2 and Stage-3 programs returned exact Stage-0 stdout `3.25`;
- both programs contained the independently assembled byte stream;
- Stage-2/Stage-3 programs were byte-identical;
- Stage-2/Stage-3/Stage-4 compilers were byte-identical.

The margin suite covered I201, I200 terminal division, positive `imm64`, the
complete integer writer, compositional integer arithmetic, bounded division,
integer addition/multiplication, and the locked Stage-2 graph paths.

- exit `0`, 12/12 passed in 40.85 s.

The full x64/locked-source differential passed 24/24 in 79.55 s. The locked
executable-bundle gate passed 1/1 in 49.66 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `3166E3871EAC733D9CC5C0D38D1F71F874BD9CF5EB25BBD6EC4F5BB316F86EF2`
- bootstrap manifest canonical bytes:
  `C0BEECF0B473546A4BAA9BA9E5E54DF7CBE871867828896BBB5D6F28EB0A897D`
- canonical compiler facade source:
  `670E72F061DC87DD1954806C477A6D8824599357991F4E3DC6545F8CD7BA40E5`
- I201 acceptance test canonical bytes:
  `B931732255CAC6426C41D490D9F52C02281854E3DF5CD49D62E316A601FD0012`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I201 proves that the Stage-2-owned writer carries typed numeric stack state
past true division and selects a correct mixed-representation addition at
fixed point. Gate 6 remains open on the reverse integer-plus-float order,
general floating arithmetic, signed dynamic-tape loads, relocations,
byte-arena packaging, and rebuilding the complete locked compiler graph into
Stage 3.

Re-evaluated from I200's 95.8%, 0.5.0 is conservatively **96.2% total**,
**+0.4 percentage points** for the first post-division typed-stack operation.

## Handoff inventory

I201 adds private three-slot representation tracking and one mixed addition
selector, rotates compiler and bundle hashes, adds one fixed-point test, and
records this receipt. No push or merge was performed.
