# 050-I227 Stage-2 symbol relocation evidence

## Scope and behavior

- Git base: `f12f9ba94e14869864651dc049d5dcd3fd191a39` (I226)
- Worktree: `.worktrees/0.5/050-i227-stage3-symbol-relocation`
- Branch: `codex/0.5/050-i227-stage3-symbol-relocation`
- State: GREEN, ready for exact-scope commit

I227 adds the first source-owned function symbol-position discovery used by a
Stage-2 x64 relocation. It compiles the existing public
`examples/native_core/hello_native.vkf`, derives the selected immediate widths,
discovers the helper and entry positions, and resolves both relocation origins
inside the writer. The caller supplies source and immutable byte fragments; it
does not supply the prior `20`-byte entry displacement or `-27` call
displacement.

The resulting artifact is unchanged from I226: it begins with `EB 14`, places
the 20-byte helper at offset 2, places the entry at offset 22, and emits the
backward call as `E8 E5 FF FF FF`. Stage 0, Stage 2, and Stage 3 print exact
`42`. Stage-2 and Stage-3 programs are byte-identical; Stage-2, Stage-3, and
Stage-4 compiler artifacts are byte-identical. Generated compiler source
contains neither internal stage observation nor `process.run_native`.

This packet has two internal relocation entries for the selected numeric
literal function layout. It does not introduce a public relocation-table
schema. General symbol collections, multiple functions, branches, data
relocations, and PE/ELF/Mach-O writing remain open. No public syntax, semantics,
API, diagnostic, manifest schema, ABI, UI, renderer, or native implementation
changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; ignored seed/smoke binaries came
from I226. Tests used `VKF_TEST_WORK_ROOT=C:\\w\\vf-i227`.

Focused command:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path
$env:VKF_TEST_WORK_ROOT='C:\w\vf-i227'
node --test tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 25.02 s; the missing private symbol-position writer was
  rejected as `direct x64 backend unsupported: machine IR supports direct calls
  only` before artifact creation.
- GREEN: exit `0`, 1/1 in 21.45 s.

Adjacent matrix (`node --test --test-concurrency=1`) covered source-owned symbol
positions, backward and forward relocation, the original artifact seam,
high-byte imm32, the complete integer writer, and source/bundle hash checks:

- exit `0`, 8/8 in 135.21 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 17.52 s;
- complete ten-source executable bundle: exit `0`, 1/1 in 45.18 s.

No timeout, assertion, byte oracle, or performance gate was weakened. This
correctness packet makes no performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `EF86061A26C846EC3FF33D4604A03C6536D644D49B78B727870FF33F78673A27`
- bootstrap manifest canonical bytes:
  `FA9DEE61EC26161097362C005435BFF641A04A680EEBFFEA77404485392754B6`
- canonical compiler facade source:
  `0872FC9A96485497FFD11392C47CA95AE053358EC3CA415964DFFDA055F2748A`
- I227 acceptance test canonical bytes:
  `81237AACB086EC01C3EBD3E36322F43D4E6465D0AF785E60552AE798F5BC6F2D`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I227 advances ADR 0005 rules 3, 4, and 5 by moving relocation positions across
the facade seam into the Stage-2 writer. It establishes a bounded symbol
discovery prerequisite but does not close a whole rule or claim general
artifact writing.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. Next is an internal
general relocation collection applied to more than one source-owned symbol or
the earliest general container-encoding prerequisite exposed by a genuine
public RED. Full suite equivalence, stdlib/UI migration, fallback removal, and
the seed-only toolchain-free rebuild remain.
