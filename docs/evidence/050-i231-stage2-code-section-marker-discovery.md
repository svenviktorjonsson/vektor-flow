# 050-I231 Stage-2 code-section marker discovery evidence

## Scope and behavior

- Git base: `b143e83148012228077323dcca01011e9c26ba8d` (I230)
- Worktree: `.worktrees/0.5/050-i231-stage3-marker-discovery`
- Branch: `codex/0.5/050-i231-stage3-marker-discovery`
- State: GREEN, ready for exact-scope commit

I231 moves locked x64 runner marker discovery across the host seam. The
Stage-2 driver now passes the whole 37,376-byte runner template to a private
VKF compiler member. That member walks byte positions, filters on the first
ASCII marker byte, and recognizes `VKFX64AOTCODE001` at byte offset 3,072.
The generated driver contains no marker offset, template prefix, artifact
suffix, section capacity, or `process.run_native` fallback.

Stage 2 and Stage 3 print the same exact discovered offset. Stage-2,
Stage-3, and Stage-4 compiler artifacts are byte-identical. The adjacent I230
gate continues to prove exact Stage-0/2/3 program output, Stage-2/3 executable
byte identity, the exact 92 selected code bytes, 32,676 compiler-owned padding
bytes, and Stage-2/3/4 compiler fixed point.

This packet deliberately owns marker-position discovery only. The locked PE
template is not valid UTF-8, while the current `vkf_utf8_slice` intrinsic
decodes and re-encodes scalars. It therefore cannot truthfully preserve the
opaque prefix and suffix. Stage-2 binary slicing/patching or compiler-owned PE
section/header encoding remains the next container prerequisite. No public
syntax, semantics, API, diagnostic, manifest schema, ABI, native
implementation, UI, renderer, or 0.6 material changed.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the complete six-file ignored
seed/smoke bin set came from I230. Focused and adjacent tests used
`VKF_TEST_WORK_ROOT=C:\w\vf-i231` and
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin').Path`.

Focused command:

```powershell
node --test tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs
```

- RED: exit `1`, 0/1 in 20.88 s; the linked driver reached the absent private
  compiler member and failed with `machine IR supports direct calls only`.
- First implementation run: exit `1`, 0/1 in 15.67 s; it exposed the genuine
  direct-machine prerequisite that `str.length()` is not available for byte
  buffers. The implementation was narrowed to the existing byte-position
  `vkf_string_eof` and `vkf_string_peek_scalar` operations.
- GREEN: exit `0`, 1/1 in 14.87 s; Stage 2 and Stage 3 both discovered offset
  3,072 and Stage-2/3/4 compiler bytes were exact.

Adjacent serial command covered I231, I230, dynamic and two-entry relocation
tables, source symbol positions, backward and forward rel32, the original
artifact seam, high-byte imm32, the complete integer writer, and source/bundle
hash checks:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 12/12 in 213.47 s.

Locked gates:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- locked Stage-2/3/4 source graph: exit `0`, 1/1 in 30.87 s;
- the first two bundle runs completed their work but teardown returned Windows
  `EPERM` while removing separate temporary directories: each exit `1`, 0/1 in
  60.72 s and 60.41 s; no VKF/test process remained;
- unchanged bundle under fresh `VKF_TEST_WORK_ROOT=C:\w\vf-i231b`: exit `0`,
  1/1 in 61.62 s.

No assertion, byte oracle, timeout, or performance gate was weakened. The
focused elapsed time is a local correctness observation, not a formal
performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `D4C7DC2D3F725E0C531EF8971F53A224DECDE6D4A62CFA89EE7D1E9332E2D23A`
- bootstrap manifest canonical bytes:
  `C522AEDA3358527E5AC21089E8470EF9B364EC36A4343E3F602D2D6700E27B8E`
- canonical compiler facade source:
  `207E76D5D6C8E89BCE0AC3D65BEFDF8EC57EC648295AC88EBEE569C54070C893`
- I231 acceptance test canonical bytes:
  `0E23C2DCB2A7660E989F37384E59DA0322CAE49DE624B162AEA3491DBDE31075`
- strict Stage-0 seed compiler:
  `C6C450DD729F97F43F35067E7E0D4BE216EBD6059BB4B910BD40BCA89ED85336`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I231 advances ADR 0005 rules 3 and 5 by making the source-authored compiler
discover the locked x64 section marker instead of accepting a host-computed
offset. It does not close a whole rule or claim general PE/ELF/Mach-O writing.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 are partial; rules 6 and
8 remain open. Counting partial rules as one half remains `4.5/8 = 56.25%`,
so the defensible rounded release estimate stays **55%**. Next is a genuine
byte-preserving section replacement or compiler-owned PE section/header
encoder RED; after that remain platform-neutral container writing, arbitrary
source-module coverage, complete locked-graph compilation into Stage 3,
full-suite equivalence, fallback retirement, and seed-only toolchain-free
rebuild.
