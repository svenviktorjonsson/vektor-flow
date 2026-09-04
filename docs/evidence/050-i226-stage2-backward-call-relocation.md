# 050-I226 Stage-2 backward-call relocation evidence

## Scope and behavior

- Git base: `96797a114be2e1b83bd6cf997b7e3687f2d38d88` (I225)
- Worktree: `.worktrees/0.5/050-i226-stage3-signed-relocation`
- Branch: `codex/0.5/050-i226-stage3-signed-relocation`
- State: GREEN, ready for exact-scope commit

I226 adds the first Stage-2-owned signed/backward x64 relocation. It compiles
the existing public `examples/native_core/hello_native.vkf`, places the helper
before the entry, and executes a backward call that returns exact `42`.

The artifact begins with `EB 14`, skipping the 20-byte helper to its entry.
After the source-derived `push 21`, the return address is offset 29 and the
helper target is offset 2, so the resolved displacement is `-27`. Stage 2
encodes its signed two's-complement `rel32` exactly as `E8 E5 FF FF FF`.
The helper consumes the source-derived argument `21` and factor `2`.

Stage 0, Stage 2, and Stage 3 print exact `42`. Stage-2 and Stage-3 programs
are byte-identical; Stage-2, Stage-3, and Stage-4 compiler artifacts are
byte-identical. Generated compiler source contains neither internal stage
observation nor `process.run_native`.

This packet still accepts resolved entry and call displacements as private
inputs. Source-owned symbol position discovery, relocation tables, and general
PE/ELF/Mach-O writing remain open. No public syntax, semantics, API, diagnostic,
manifest schema, ABI, UI, renderer, or native implementation changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`; ignored seed/smoke
binaries came from I225. Tests used `VKF_TEST_WORK_ROOT=C:\w\vf-i226`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i226'
node --test tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 18.20 s; the missing private backward writer was
  rejected as a non-direct call before artifact creation.
- GREEN: exit `0`, 1/1 in 20.71 s.

Adjacent matrix (`node --test --test-concurrency=1`) covered backward and
forward relocation, the original artifact seam, high-byte imm32, the complete
integer writer, and source/bundle hash checks:

- exit `0`, 7/7 in 92.58 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 16.44 s;
- complete ten-source executable bundle: exit `0`, 1/1 in 44.37 s.

No timeout, assertion, byte oracle, or performance gate was weakened.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `D0850A911149C1C7E0088BB147E24899EED76B0168E4294840A05D4BFE4C4DDA`
- bootstrap manifest canonical bytes:
  `049BDD795DF22634F3D65CD7E66A56C29EC8C9028D724D9071CBAEF558BA3CA2`
- canonical compiler facade source:
  `82F6F721A0FBDCAA2CB75D404E613486192F523FBF40A853DB043C3123C8E863`
- I226 acceptance test canonical bytes:
  `88C11EBCE3F7F3EEBE8B2DEA10F396F2AB9135A607E83A14FB0D9788A8C49646`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I226 advances ADR 0005 rule 5 by covering both signs of executable Stage-2
call relocation. It establishes another general artifact-encoding primitive
needed by rules 3 and 4, but does not close any whole rule or claim performance.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. The next relocation
work is source-owned symbol-position discovery, followed by relocation-table
integration and general container writing. Full suite equivalence, stdlib/UI
migration, fallback removal, and the seed-only toolchain-free rebuild remain.
