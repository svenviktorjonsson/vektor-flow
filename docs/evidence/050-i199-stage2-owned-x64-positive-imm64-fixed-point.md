# 050-I199 Stage-2-owned positive-imm64 evidence

## Scope

- Git base: `9d8c946f`
- Consumed packet: committed I198 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

The intended I199 signed-immediate tracer first established that Stage 0
accepts `value: -1` and produces `39` for `value + 40`. The self-hosted dynamic
tape exits before producing the signed load, however. Repairing that path would
widen grammar coverage, outside this private writer packet, so the signed slice
was removed without production residue.

I199 instead takes the next writer-only value boundary: the first positive
integer above signed `imm32` range.

```vkf
value: 2147483648
:: value + 1
```

The private complete integer writer now chooses `mov rax, imm64; push rax` for
positive exact integers above `2147483647`. It continues using `push imm8` and
`push imm32` below their existing boundaries. The independently selected x64
stream is:

```text
48 B8 00 00 00 80 00 00 00 00  mov rax, 0x0000000080000000
50                             push rax
6A 01                          push 1
58 59 48 01 C8 50              add and push
58 F2 48 0F 2A C0 C3           print result
```

Stage 2 and Stage 3 print `2147483649`, exactly matching Stage 0. Their
generated programs are byte-identical, as are the Stage-2, Stage-3, and
Stage-4 compiler artifacts. The path uses neither
`--vkf-internal-stage-observation` nor `process.run_native`.

No VKF syntax, semantics, API, diagnostics, schema, ABI, native backend, UI,
or renderer changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-positive-imm64-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 17.38 s;
- intended failure: Stage 2 returned status `3` at the previous signed-`imm32`
  upper bound.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 19.75 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `2147483649`;
- both contained the exact independently selected `mov imm64` byte stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Margin-focused command covered I199, the complete integer writer, both I196
and I197 positive-`imm32` cases, maximum positive `imm8`, and zero `imm8`.

- exit `0`, 6/6 passed in 25.73 s.

The full x64/locked-source differential passed 22/22 in 69.51 s. The locked
executable-bundle gate passed 1/1 in 62.75 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `53EC1D531D492CF7B4867B2211CEDA2849B6DF6969EA378FCF32A556A0F3FEFC`
- bootstrap manifest checkout bytes:
  `74CCE2E72D18BCE36CDF7348886121447703FD79C368B560A62CED1A4262F87B`
- canonical compiler facade source:
  `063C334BE441997B5FC30A377F695911542F36DFF50E5008AD35C7C4AF55C85C`
- I199 acceptance test canonical bytes:
  `AB98111E84FCAC9C856C58B3AEEDB8E354953C400A48DCCFC1457EFBA79FE328`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I199 proves that the complete Stage-2-owned integer writer crosses the
`imm32` boundary into an exact positive `imm64` representation while retaining
byte identity at fixed point. Gate 6 remains open on signed dynamic-tape
coverage, true-division representation, relocations, packaging the byte arena,
and compiling the complete locked compiler graph into Stage 3.

Re-evaluated from I198's 94.9%, 0.5.0 is conservatively **95.4% total**, **+0.5
percentage points** for positive exact-`imm64` representation.

## Handoff inventory

I199 adds positive exact-`imm64` selection, rotates compiler and bundle hashes,
adds one fixed-point test, and records this receipt. No push or merge was
performed.
