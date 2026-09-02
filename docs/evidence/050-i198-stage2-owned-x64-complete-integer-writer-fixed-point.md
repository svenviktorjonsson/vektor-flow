# 050-I198 Stage-2-owned complete integer-writer evidence

## Scope

- Git base: `6d65c3b8`
- Consumed packet: committed I197 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, ready for exact-scope commit

I198 integrates I197's private high-byte arena into the complete compositional
integer-writer entry point. The entry point receives all settled integer
opcode fragments—addition, multiplication, subtraction, power, floor
division, and remainder—alongside the byte arena, so high-byte construction is
no longer confined to the dedicated I197 arithmetic tracer.

The fixed-point input exercises a high-byte `imm32`, remainder, addition, and
print through that complete entry point:

```vkf
value: 16909288
:: value % 100 + 1
```

The selected bytes are derived independently in the test:

```text
68 E8 03 02 01          push 0x010203E8
6A 64                   push 100
59 58 48 99 48 F7 F9 52 remainder and push
6A 01                   push 1
58 59 48 01 C8 50       add and push
58 F2 48 0F 2A C0 C3    print result
```

Stage 2 and Stage 3 print `89`, exactly matching Stage 0. Their generated
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. Existing focused fixed-point tests independently cover every other
opcode fragment accepted by the complete entry point.

The path uses neither `--vkf-internal-stage-observation` nor
`process.run_native`. No VKF public intrinsic, syntax, semantic, API,
diagnostic, schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
Every child process used hidden windows. No UI, browser, renderer, or benchmark
workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test `
  tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs
```

- exit `1`, 0/1 passed in 16.24 s;
- intended failure: direct lowering rejected the absent complete private
  integer-writer entry point.

The initial GREEN attempt deliberately over-composed grouped operators and
returned status `3`. The test was minimized back to the already settled
dynamic grammar boundary rather than widening grammar or diagnostics in this
backend packet.

Final GREEN command: the RED command above.

- exit `0`, 1/1 passed in 26.12 s;
- Stage-2 and Stage-3 PEs returned exact Stage-0 stdout `89`;
- both contained the independently assembled expected byte stream;
- Stage-2/Stage-3 programs and Stage-2/3/4 compilers were byte-identical.

Margin-focused command covered I198, I197, I196, the general arithmetic chain,
and the remainder, floor-division, and power chain emitters.

- exit `0`, 7/7 passed in 31.64 s.

The full x64/locked-source differential passed 21/21 in 62.88 s. The locked
executable-bundle gate passed 1/1 in 46.45 s, emitting and running every
declared compiler source.

`git diff --check` passed with only existing LF-to-CRLF warnings. Unrelated
dirty files and untracked work remained preserved.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `2A206BD3B9503A128687CBCF388A7EB1CB1E9DD072556D815E05D981DEF56EAF`
- bootstrap manifest checkout bytes:
  `AEBED315F3AD6EF9A53193C7A060AFB9ACC56DF0ACB9481F8201F0D78CDD7E66`
- canonical compiler facade source:
  `22EA489A76B59D56526A9FD3945B25FEE50A777A2EF6172A3B72007F6CB94F16`
- I198 acceptance test canonical bytes:
  `0CF4FE89C714F98D3E2C2B31F618D614BCFF3ADEC9509FD729358B3483E60FD3`
- locked x64 runner template:
  `A5A11724BFFCEAF9BC0AD22F1F202F3435156D11251C06D7BD56A00222258EB8`

## Acceptance-gate impact

I198 proves byte-safe high-immediate construction through the complete settled
integer-writer dependency surface rather than an opcode-specific alternate.
Gate 6 remains open on making the complete writer own or package its arena,
signed immediates, true-division representation, relocations, and compiling
the complete locked compiler graph into Stage 3.

Re-evaluated from I197's 94.4%, 0.5.0 is conservatively **94.9% total**, **+0.5
percentage points** for complete integer-writer integration.

## Handoff inventory

I198 adds one complete private integer-writer entry point, rotates compiler and
bundle hashes, adds one fixed-point test, and records this receipt. No native
backend, UI, renderer, push, or merge was involved.
