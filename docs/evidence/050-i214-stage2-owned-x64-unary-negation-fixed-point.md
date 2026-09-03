# 050-I214 Stage-2-owned unary negation evidence

## Scope

- Git base: `c9a031c5`
- Consumed packet: committed I213 GREEN contract
- Worktree: `.worktrees/0.5/integration`
- Branch: `codex/0.5/integration`
- State: GREEN, ready for exact-scope commit

I214 carries the already-approved unary-minus operator through the private
Stage-2-owned x64 writer:

```vkf
value: 8
:: -----value
```

The existing grouped parser emits one load, five unary opcode-10 entries, and
one terminal print. The VKF-owned writer emits exact signed integer negation:

```text
58 48 F7 D8 50              pop rax; neg rax; push rax
```

Stage 0, Stage 2, and Stage 3 all print exact `-8`. The Stage-2 and Stage-3
programs are byte-identical, as are the Stage-2, Stage-3, and Stage-4 compiler
artifacts. The path uses neither internal stage observation nor
`process.run_native`.

No public syntax, semantics, API, diagnostic, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Every child process
used hidden windows.

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT=(Resolve-Path '.work/i').Path
node --test `
  tests/bootstrap/stage2-owned-x64-unary-negation-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 12.22 s; Stage 0 produced exact `-8`, then the strict
  compiler rejected the absent private unary-writer member before Stage 2.
- GREEN: exit `0`, 1/1 in 18.34 s; exact Stage0/2/3 stdout and selected x64
  bytes, Stage2/3 program identity, and Stage2/3/4 compiler identity passed.
- prior I213 float/float division fixed point: 1/1 in 15.53 s.
- locked source graph: 2/2 in 0.34 s.
- complete locked bootstrap bundle: 1/1 in 32.60 s; all 10 declared units
  emitted as executables and ran.

One legacy I178 adjacency probe still exits `3` inside its
`process.run_native` observation harness. This is the already-classified
harness-environment failure family; I214 does not use that bridge. In the same
serial command, I213 and I214 passed. No retry was classified as GREEN for the
I178 result.

`git diff --check` passed with only existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `627A5A0509631D0D13E84D3EEBD8FCDC8C1FA2661CEC5667F41BCB0A057CCCAF`
- bootstrap manifest canonical bytes:
  `C89C536307803193D5A13D31633EB26D96283EC4D68BFB2B34532CDE20837288`
- canonical compiler facade source:
  `AF61046FA8FD00EA845876102F3639F0C7EE6343C97750197966E112C9B667F1`
- I214 acceptance test canonical bytes:
  `7CFEDEA11E3F4F513494B54DE484853F82ED95E49BDA740160B5BC4174F3B1D7`
- strict Stage-0 compiler used for the receipt:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Performance and acceptance impact

Unary negation adds exactly five emitted bytes per operator. The non-unary
writer and normal cached-startup path are unchanged, so no unrelated runtime
or startup cost is introduced. This packet does not claim a frontier
performance result and changes no performance threshold.

I214 advances the narrow Stage-2 arithmetic fixed-point subgate from I213's
98.9% estimate to approximately 99.0%. It adds only about 0.1 percentage point
to the overall release, which remains approximately 55% complete on the
weighted acceptance-gate basis. Gate 6 remains open on general signed tape
integration, relocations, byte-arena packaging, and rebuilding the complete
locked compiler graph into Stage 3. Full stdlib and frozen-0.4 UI migration,
clean seed rebuild, native/WASM release parity, and independent performance
proof also remain release-level work.

## Handoff inventory

I214 adds one private unary x64 selector, rotates compiler and bootstrap bundle
hashes, adds one fixed-point test, and records this receipt. No public contract
decision is needed.
