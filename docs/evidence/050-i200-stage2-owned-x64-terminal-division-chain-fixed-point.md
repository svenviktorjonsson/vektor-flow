# 050-I200 Stage-2-owned terminal-division-chain evidence

## Scope

- Git base: `e1653928`
- Consumed packet: committed I199 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I200 closes the next private complete-writer representation boundary without
changing VKF syntax or numeric semantics. The dynamic Machine-IR tape for:

```vkf
value: 90
:: value * 2 / 40
```

first composes integer multiplication, then converts both integer operands to
`f64` for the already-settled true-division opcode. The writer carries the
division result as its exact 64-bit floating representation until the runner
return boundary. Stage 2 and Stage 3 both print `4.5`, exactly matching the
Stage-0 oracle.

The independently selected x64 body is:

```text
6A 5A                         push 90
6A 02                         push 2
58 59 48 0F AF C1 50          multiply and push
6A 28                         push 40
58 F2 48 0F 2A C8             pop/convert right to xmm1
58 F2 48 0F 2A C0             pop/convert left to xmm0
F2 0F 5E C1                   divsd xmm0, xmm1
66 48 0F 7E C0 50             push exact xmm0 bits
58 66 48 0F 6E C0 C3          restore xmm0 and return
```

True division is intentionally required to terminate this private tracer
tape. Supporting arithmetic after a fractional result needs general typed
numeric stack representation and is not inferred by this packet. The path
uses neither `--vkf-internal-stage-observation` nor `process.run_native`.
No public syntax, semantics, API, diagnostic, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-terminal-division-chain-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 13.69 s;
- intended failure: the Stage-0 compiler could not resolve the absent private
  `_compile_printed_dynamic_numeric_chain_x64` entry point.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 16.05 s;
- Stage-2 and Stage-3 programs returned exact Stage-0 stdout `4.5`;
- both programs contained the independently assembled byte stream;
- Stage-2/Stage-3 program artifacts were byte-identical;
- Stage-2/Stage-3/Stage-4 compiler artifacts were byte-identical.

The margin suite covered I200, positive `imm64`, the complete integer writer,
the compositional integer tape, bounded true division and multiplication, the
first x64 artifact, and the locked Stage-2 graph paths.

- exit `0`, 10/10 passed in 37.70 s.

The full x64/locked-source differential passed 23/23 in 68.48 s. The locked
executable-bundle gate passed 1/1 in 50.25 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `C1B32ECA95C3AE56303F29DCAB105ED4650E3444BA42B5B257AC9D73EFE3CD1D`
- bootstrap manifest canonical bytes:
  `E92B7ECE521595F347FFF7BCFA95F9C8B73DE941AB36741A3CDBA110514DA70C`
- canonical compiler facade source:
  `A62AD86DA1F66762661E2295281A4498EE425476CDCC0B95B0B66DEC49A5FA55`
- I200 acceptance test canonical bytes:
  `F4A21547B6C0519723FA44DCA6E67EBED56CFD054674ACC795CEB30A4E8E956A`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I200 proves the complete Stage-2-owned writer can preserve a fractional
true-division result through native emission at fixed point, after composing
an earlier integer operation. Gate 6 remains open on general mixed numeric
stack representation, signed dynamic-tape loads, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.

Re-evaluated from I199's 95.4%, 0.5.0 is conservatively **95.8% total**,
**+0.4 percentage points** for terminal true-division representation.

## Handoff inventory

I200 generalizes the private tape writer to select integer or floating return
tails, adds one numeric-chain entry point, rotates compiler and bundle hashes,
adds one fixed-point test, and records this receipt. No push or merge was
performed.
