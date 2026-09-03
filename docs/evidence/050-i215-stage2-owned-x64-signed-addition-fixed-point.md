# 050-I215 Stage-2-owned signed addition evidence

## Scope

- Git base: `1e3ecaf4`
- Consumed packet: committed I214 GREEN contract
- Worktree: `.worktrees/0.5/integration`
- Branch: `codex/0.5/integration`
- State: GREEN, ready for exact-scope commit

I215 composes the I214 unary-negation selector with the established integer
addition selector through one VKF-owned dynamic tape:

```vkf
value: 8
:: value + -----3
```

Stage 0, Stage 2, and Stage 3 print exact `5`. Each of the five unary entries
emits exact `pop rax; neg rax; push rax` bytes before the existing addition.
The Stage-2 and Stage-3 programs are byte-identical, as are the Stage-2,
Stage-3, and Stage-4 compiler artifacts. The path uses neither internal stage
observation nor `process.run_native`.

The implementation deepens I214's unary-only selector into a shared private
signed-integer tape writer. The I214 entrypoint remains and delegates to that
writer; its focused fixed-point test stays green.

No public syntax, semantics, API, diagnostic, schema, ABI, UI, renderer, or
native bootstrap implementation changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`. Every child process
used hidden windows.

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT=(Resolve-Path '.work/i').Path
node --test `
  tests/bootstrap/stage2-owned-x64-signed-addition-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 20.97 s; Stage 0 produced exact `5`, then the strict
  compiler rejected the absent private signed-addition member before Stage 2.

GREEN plus parent-contract differential and locked source graph:

```powershell
node --test --test-concurrency=1 `
  tests/bootstrap/stage2-owned-x64-signed-addition-fixed-point.test.mjs `
  tests/bootstrap/stage2-owned-x64-unary-negation-fixed-point.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 4/4 in 26.86 s;
- I215 passed in 13.78 s and I214 passed in 12.54 s;
- exact Stage0/2/3 stdout and selected x64 bytes passed;
- Stage2/3 program identity and Stage2/3/4 compiler identity passed;
- I214 unary-only fixed point remained exact;
- locked source graph passed 2/2.

Additional gates:

- complete locked bootstrap bundle: 1/1 in 32.10 s; all 10 declared units
  emitted as executables and ran;
- `git diff --check` passed with only existing LF-to-CRLF warnings.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `D4D9DF2405AA6652048F127596579856FAF48D475E8DF53B7500D934163F8EFA`
- bootstrap manifest canonical bytes:
  `95D7FC51537350DC3150830586D8DB48021AA8584CD8B9F14FD3889896A0257D`
- canonical compiler facade source:
  `D647C6912CD437F8F7D4B540D01572CF18BC7D19563AD852D324CB9646A0456B`
- I215 acceptance test canonical bytes:
  `633A6F97AB7C3605A817D9788D4AD3C93F96CB82A1877F981F9DE12B4DAB1A49`
- strict Stage-0 compiler used for the receipt:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Performance and acceptance impact

Each unary operation remains five emitted bytes. Addition reuses its existing
six-byte selector. Non-signed tapes and normal cached startup are unchanged;
no threshold or performance assertion changed. This packet claims no frontier
performance result.

I215 advances the narrow Stage-2 arithmetic fixed-point subgate to
approximately 99.1%. Overall 0.5 release completion remains approximately 55%
on the weighted acceptance basis. Gate 6 remains open on integrating signed
operations into the complete numeric writer, relocations, byte-arena
packaging, and rebuilding the complete locked compiler graph into Stage 3.
Release-level stdlib/UI migration, strict no-bridge rebuild, native/WASM parity,
and independent performance proof remain open.

## Handoff inventory

I215 adds one private signed-addition selector, deepens the I214 implementation
without changing its interface, rotates compiler and bootstrap bundle hashes,
adds one fixed-point test, and records this receipt. No public contract decision
is needed.
