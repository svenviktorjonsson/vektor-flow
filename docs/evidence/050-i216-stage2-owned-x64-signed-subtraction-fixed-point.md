# 050-I216 Stage-2-owned signed subtraction evidence

## Scope

- Git base: `dd805dd1`
- Consumed packet: committed I215 GREEN contract
- Worktree: `.worktrees/0.5/integration`
- Branch: `codex/0.5/integration`
- State: GREEN, ready for exact-scope commit

I216 composes the I214 unary-negation selector with established integer
subtraction through the VKF-owned signed-integer tape:

```vkf
value: 8
:: value - -----3
```

Stage 0, Stage 2, and Stage 3 print exact `11`. Each unary entry emits exact
`58 48 F7 D8 50`, followed by the existing six-byte subtraction selector.
The Stage-2 and Stage-3 programs are byte-identical, as are the Stage-2,
Stage-3, and Stage-4 compiler artifacts. The path uses neither internal stage
observation nor `process.run_native`.

The implementation adds opcode 6 and a private subtraction delegate to the
signed-integer tape introduced by I215. Existing unary-only and signed-addition
delegates remain exact.

No public syntax, semantics, API, diagnostic, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Every child process
used hidden windows.

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT=(Resolve-Path '.work/i').Path
node --test `
  tests/bootstrap/stage2-owned-x64-signed-subtraction-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 10.76 s; Stage 0 produced exact `11`, then the strict
  compiler rejected the absent private signed-subtraction member before Stage 2.
- GREEN: exit `0`, 1/1 in 16.34 s; exact Stage0/2/3 output and selected x64
  bytes passed; Stage2/3 program and Stage2/3/4 compiler identity passed.

GREEN parent-contract differential and locked source graph:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-signed-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-unary-negation-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 in 48.60 s;
- I216 passed in 16.87 s, I215 in 15.06 s, and I214 in 15.65 s;
- locked source graph passed 2/2.

Additional gate:

- complete locked bootstrap bundle: 1/1 in 35.86 s; all 10 declared units
  emitted as executables and ran.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `65F87A45809A2460F3B7EC6A9B3BDC6FEB67D93EB649CBA11417B473FB44630C`
- bootstrap manifest canonical bytes:
  `ABCEB1CFB7AD5FA4ECEAEBCD41B738EB7483A9EAF0A50C532A548812DAF78ABE`
- canonical compiler facade source:
  `879A4A49DD006F69C1DAB7C67B29A31E6CEB719DB90787C9B4121C61080D37C7`
- I216 acceptance test canonical bytes:
  `049EBEA51FB051A5549DCED03E3818AD9DAB8CB692331E178A40F115AAF4630A`
- strict Stage-0 compiler used for the receipt:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Performance and acceptance impact

Each unary operation remains five emitted bytes. Subtraction reuses its
existing six-byte selector. Normal cached startup and unsigned numeric tapes
are unchanged; no threshold or performance assertion changed. This packet
claims no frontier performance result.

I216 advances the narrow Stage-2 arithmetic fixed-point subgate to
approximately 99.2%. Overall 0.5 release completion remains approximately 55%
on the weighted acceptance basis. Gate 6 remains open on integrating signed
operations into the complete numeric writer, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.
Release-level stdlib/UI migration, strict no-bridge rebuild, native/WASM parity,
and independent performance proof remain open.

## Handoff inventory

I216 adds one private signed-subtraction selector, deepens the shared signed
integer tape without changing a public interface, rotates compiler and bootstrap
bundle hashes, adds one fixed-point test, and records this receipt. No public
contract decision is needed.
