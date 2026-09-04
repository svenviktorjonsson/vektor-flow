# 050-I225 Stage-2 forward-call relocation evidence

## Scope and behavior

- Git base: `b7fda86c83207cd71891c72c5d6e6454a603049f` (I224)
- Worktree: `.worktrees/0.5/050-i225-stage3-general-relocation`
- Branch: `codex/0.5/050-i225-stage3-general-relocation`
- State: GREEN, ready for exact-scope commit

I225 is the first Stage-2-owned x64 call relocation. It compiles the existing
public source `examples/native_core/hello_native.vkf`, whose function call
prints exact `42`. The Stage-2 writer parses the existing tagged function form,
emits its literal argument and factor, applies a resolved forward `rel32`, and
writes the executable artifact around the locked runner seed.

The test places the helper behind one return byte and 129 NOP bytes. The
resolved displacement is therefore 130 and the emitted call is exactly
`E8 82 00 00 00`. This crosses the raw-ASCII byte boundary and proves all four
little-endian relocation bytes use the existing byte arena. The called helper
consumes the source-derived argument `21` and factor `2`, returning `42`.

Stage 0, Stage 2, and Stage 3 print exact `42`. Stage-2 and Stage-3 programs
are byte-identical; Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical. Generated compiler source contains neither internal stage
observation nor `process.run_native`.

This packet applies an already-resolved unsigned forward displacement. Symbol
position discovery, backward/signed relocations, relocation tables, and general
PE/ELF/Mach-O writing remain open. No public syntax, semantics, API, diagnostic,
manifest schema, ABI, UI, renderer, or native implementation changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`; ignored seed/smoke
binaries came from I224. Tests used `VKF_TEST_WORK_ROOT=C:\w\vf-i225`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i225'
node --test tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 16.03 s; the unresolved private writer was rejected
  as a non-direct call while the Stage-0 oracle itself compiled and ran.
- Intermediate RED: exit `1`, 0/1 in 14.89 s; newly reachable function-tape
  validation exposed a fixed `[num:4]` to dynamic `[num]` call-width mismatch.
- Intermediate RED: exit `1`, 0/1 in 14.50 s; direct code generation cannot
  yet discover byte positions through `str.length()`.
- GREEN: exit `0`, 1/1 in 20.39 s after preserving the validated dynamic tape
  and accepting the independently resolved displacement as a private input.

Direct-only adjacent matrix (`node --test --test-concurrency=1`) covered the
new relocation, original artifact, high-byte imm32, complete integer writer,
I224 signed mixed division, and source/bundle hashes:

- exit `0`, 7/7 in 97.53 s.

One legacy parameter-envelope file was also attempted. Its two assertions
failed before execution in 28 ms because the deliberately minimal seed folder
does not contain fallback-only `vkf.exe` or `vkf_compiler_artifact_smoke.exe`.
Those binaries were not introduced into this direct-only packet.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 18.20 s;
- complete ten-source executable bundle: exit `0`, 1/1 in 50.05 s.

No timeout, assertion, byte oracle, or performance gate was weakened.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `FD9270C41F658C35D47F6251717935A43344C662FAF8C0BC37DD6CAE031CAEBF`
- bootstrap manifest canonical bytes:
  `E5D6F0BD8315C970288B610C9369D1519A6A97DF7F8ABBEADEF0FECC450FD9B0`
- canonical compiler facade source:
  `E91F50F0E8CBE2FF5C222831450AC3E11775272B68F1480D131DFFE9136379CF`
- I225 acceptance test canonical bytes:
  `454B5CE2E0D3F252F8B5C741A8C1FA89628103F8209719434857F3BC0B124EFB`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I225 advances ADR 0005 rule 5 with the first executable Stage-2-owned call
relocation and creates a concrete artifact-encoding seam needed by rules 3 and
4. It does not close any whole rule or claim compiler performance improvement.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. The next relocation
work is source-owned symbol-position resolution, then signed/backward branch
relocations and general container writing. Full suite equivalence, stdlib/UI
migration, fallback removal, and the seed-only toolchain-free rebuild remain.
