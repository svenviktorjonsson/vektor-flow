# 050-I196 Stage-2-owned positive-imm32 evidence

## Scope

- Git base: `5368d189`
- Consumed packet: committed I195 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I196 extends the private x64 tracer from `imm8` to the first positive `imm32`
encoding without changing VKF syntax, semantics, APIs, diagnostics, schemas, or
ABIs:

```vkf
value: 2130772480
:: value + 1
```

The self-hosted compiler selects `push imm32` and decomposes the positive
value into little-endian bytes. This architectural tracer deliberately uses
an immediate whose bytes are all in the current string-backed byte-safe range:

```text
68 00 02 01 7F       push 0x7F010200
6A 01                push 1
58 59 48 01 C8 50    add and push
58 F2 48 0F 2A C0 C3 print result
```

Stage 2 and Stage 3 print `2130772481`, exactly matching Stage 0. Their
generated programs are byte-identical, as are the Stage-2, Stage-3, and
Stage-4 compiler artifacts. The path uses neither
`--vkf-internal-stage-observation` nor `process.run_native`.

No raw-byte intrinsic was added. Bytes `0x80` through `0xFF`, arbitrary
positive `imm32`, negative immediates, and relocations remain independent
private backend packets.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-positive-imm32-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 16.52 s;
- intended failure: Stage 2 returned status `3` because the private encoder
  still rejected values above `127`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 14.80 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `2130772481`;
- both contained exact `68 00 02 01 7F` little-endian encoding;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Margin-focused command covered I196, zero and maximum positive `imm8`, plus
all four compositional integer-chain emitters.

- exit `0`, 7/7 passed in 26.70 s.

The full x64/locked-source differential passed 19/19 in 66.95 s. The locked
executable-bundle gate passed 1/1 in 45.11 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `184D79CE935C66A72D71386D6A7A796AA497FD826034B4CCA9442726B68B857D`
- bootstrap manifest checkout bytes:
  `88329822C63C7719B068A7C45A31F16159D7EE40E322F8ABA92474EFD9FE37D3`
- canonical compiler facade source:
  `CFD1815497E6CB663ED79533BC42BC4412177A338E2C4BBEA99693598EBE1F96`
- I196 acceptance test canonical bytes:
  `82F17108960912535E42F6352DF98A19B79499DDAA6A93CEA047736EED6B4036`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I196 proves the width-selection and little-endian decomposition architecture
for a positive `imm32` through the complete Stage-2/Stage-3 artifact path.
Gate 6 remains open on raw high-byte construction, signed immediates,
true-division representation, relocation, and compiling the complete locked
compiler graph into Stage 3.

Re-evaluated from I195's 93.5%, 0.5.0 is conservatively **93.9% total**, **+0.4
percentage points** for the first byte-exact positive-`imm32` fixed point.

## Handoff inventory

I196 adds private positive-immediate width selection and little-endian
decomposition, rotates compiler and bundle hashes, adds one fixed-point test,
and records this receipt. No push or merge was performed.
