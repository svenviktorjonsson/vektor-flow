# 050-I217 Stage-2-owned signed multiplication evidence

## Scope

- Git base: `7e05ab87`
- Consumed packet: committed I216 GREEN contract
- Worktree: `.worktrees/0.5/integration`
- Branch: `codex/0.5/integration`
- State: GREEN, ready for exact-scope commit

I217 composes the unary-negation selector with established integer
multiplication through the VKF-owned signed-integer tape:

```vkf
value: 8
:: value * -----3
```

Stage 0, Stage 2, and Stage 3 print exact `-24`. Each unary entry emits exact
`58 48 F7 D8 50`, followed by the existing seven-byte multiplication selector.
The Stage-2 and Stage-3 programs are byte-identical, as are the Stage-2,
Stage-3, and Stage-4 compiler artifacts. The path uses neither internal stage
observation nor `process.run_native`.

The implementation adds opcode 5 and a private multiplication delegate to the
signed-integer tape. Existing unary, signed-addition, and signed-subtraction
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
  tests/bootstrap/stage2-owned-x64-signed-multiplication-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 9.36 s; Stage 0 produced exact `-24`, then the strict
  compiler rejected the absent private signed-multiplication member.
- GREEN: exit `0`, 1/1 in 14.13 s; exact Stage0/2/3 output and selected x64
  bytes passed; Stage2/3 program and Stage2/3/4 compiler identity passed.

GREEN parent-contract differential and locked source graph:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-signed-multiplication-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-subtraction-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-unary-negation-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 6/6 in 49.18 s;
- I217 passed in 11.69 s, I216 in 12.40 s, I215 in 11.69 s, and I214 in
  12.51 s;
- locked source graph passed 2/2.

Additional gate:

- complete locked bootstrap bundle: 1/1 in 34.78 s; all 10 declared units
  emitted as executables and ran.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `641DFFCAF374964F3AA6FECB61EB83C5729BA5E92D7A65EA7FDF1058F42AC926`
- bootstrap manifest canonical bytes:
  `FAC96902FA3FFF337103A3CB28C9EDFBE2913015832B828B94D89009B3ED7FBF`
- canonical compiler facade source:
  `8CBD7AD371750E38CEFF308BD79F73D912AC4DE93C3CB79B1E725D19522F5E15`
- I217 acceptance test canonical bytes:
  `DA3CB68FC8D153986ABEEBD2D9AE69E923EAA0A435DC958B4A2B564B57834321`
- strict Stage-0 compiler used for the receipt:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Performance and acceptance impact

Each unary operation remains five emitted bytes. Multiplication reuses its
existing seven-byte selector. Normal cached startup and unsigned numeric tapes
are unchanged; no threshold or performance assertion changed. This packet
claims no frontier performance result.

I217 advances the narrow Stage-2 arithmetic fixed-point subgate to
approximately 99.3%. Overall 0.5 release completion remains approximately 55%
on the weighted acceptance basis. Gate 6 remains open on integrating signed
operations into the complete numeric writer, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.
Release-level stdlib/UI migration, strict no-bridge rebuild, native/WASM parity,
and independent performance proof remain open.

## Handoff inventory

I217 adds one private signed-multiplication selector, deepens the shared signed
integer tape, rotates compiler and bootstrap bundle hashes, adds one fixed-point
test, and records this receipt. No public contract decision is needed.
