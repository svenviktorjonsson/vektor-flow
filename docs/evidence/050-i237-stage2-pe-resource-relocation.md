# 050-I237 Stage-2 PE resource relocation evidence

## Scope and behavior

- Git base: `e9496ac205dc0e98595f409e61e4121f975e9d4c` (I236)
- Worktree: `.worktrees/0.5/050-i237-stage3-pe-resource-relocation`
- Branch: `codex/0.5/050-i237-stage3-pe-resource-relocation`
- State: GREEN, ready for exact-scope commit

I237 adds compiler-owned relocation of a retained PE resource tree during
middle code-section insertion. A dependency audit confirmed this precedes full
seed/container creation: resource subdirectory targets are offsets relative to
the resource-directory root, but each leaf `IMAGE_RESOURCE_DATA_ENTRY` stores
an absolute payload RVA that must move with its section.

The compiler-private `pe_x64.vkf` module now maps the resource data-directory
RVA to its opaque raw bytes, recursively follows named/ID directory entries,
preserves each relative directory target, and shifts only the absolute leaf
payload RVAs at or after the insertion point. Bounds for every directory,
entry table, and leaf data record are checked against the declared resource
directory size. The I236 section, data-directory, base-relocation, file-offset,
checksum, and alignment updates remain unchanged.

The public-interface fixture retains `.CRT`, the complete locked `.rsrc`, and
`.reloc` after the exception-section insertion seam. It has three nested
resource directories leading to one data entry at relative offset `0x48`.
Before insertion, `.rsrc` is at RVA `0x6000`, and its leaf points at payload
RVA `0x6060`. The input retains ASLR, its matching base relocation, a valid
nonzero checksum, invalid UTF-8 opaque bytes, and contiguous virtual/raw
section extents.

Stage 2 inserts the 92-byte virtual/512-byte raw `.vkfcod`, moves `.rsrc` to
RVA `0x7000`, preserves all three relative directory links, and changes only
the leaf payload RVA to `0x7060`. `.CRT`, `.reloc`, their raw offsets, the base
relocation directory/page, section cardinality, aggregate sizes, and checksum
also retain I236's exact relocation behavior. The image grows from 4,608 to
5,120 bytes, executes and prints `42`. Stage-2 and Stage-3 program bytes are
identical; Stage-2, Stage-3, and Stage-4 compiler bytes are identical.

I237 adds no native opcode, runtime slot, fallback, public VKF syntax or
semantics, public diagnostic, manifest shape/version, Machine IR version, or
runtime ABI. Generated drivers remain free of internal stage observation and
`process.run_native`.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the six ignored seed/smoke binaries
were mechanically copied from I236. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and short
`VKF_TEST_WORK_ROOT` paths under `C:\v`.

Public-behavior RED against unchanged I236 production:

```powershell
node --test --test-name-pattern='relocates nested PE resource' tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 0/1 in 70.05 s, then reproduced in 46.76 s under host
  contention;
- Stage 2 completed, but the emitted executable did not exit within its
  unchanged 3 s limit because the resource leaf still addressed `0x6060`
  after its section moved to `0x7000`.

A diagnostic-only run temporarily raised the Stage compiler timeout from 20 s
to 60 s; it reproduced the same emitted-executable timeout in 47.95 s. The
compiler timeout was restored to 20 s before production changes and all GREEN
and acceptance runs.

First GREEN with exact nested pointers, executable output, and fixed points:

```powershell
node --test --test-name-pattern='relocates nested PE resource' tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 1/1 in 44.72 s under host contention.

Final focused command:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 5/5 in 196.93 s under heavy host contention;
- all original discovery, blank-slot, end-growth, and middle-insertion cases
  remained GREEN under unchanged child limits.

The expected source-graph check reported only the stale bundle identity after
the PE source hash changed. Applying its computed digest mechanically restored
the source-graph gate, 2/2 in 0.42 s.

Final adjacent serial gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 18/18 in 449.41 s under heavy host contention.

Complete locked Stage-2/3/4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 31.90 s.

Full executable bundle under unchanged test limits:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 60.52 s wall / 60.35 s Node.

Compiler-private PE module through the direct backend:

```powershell
vkf-strict.exe -b compiler/self_hosted/pe_x64.vkf -o C:\v\i237-pe-smoke.exe --diagnostics --optimizer-policy mask-0
```

- exit `0`, `artifact_fallback:false`, 585.68 ms reported.

No assertion, byte oracle, final timeout, or performance gate was weakened.
The full-bundle result is close to its current boundary and should be treated
as a performance-risk observation. The focused/adjacent wall-time increase
also coincided with severe host contention; these single observations are not
a statistically credible regression measurement.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `2A91624CBCA50F2D4B86E9E4E1B385962D9C4EBE00774C4B5ABB8BC9E5067C96`
- bootstrap manifest canonical bytes:
  `48A1CAF662DC9DA0CC026B041B884F93FA8DDF39086A19866EE53AE262ACC589`
- compiler facade canonical bytes:
  `0E595B09011A5B9A73D9FD23B007BF5FE6B39A911289175AED7DAECEA887B907`
- PE x64 module canonical bytes:
  `684285A205C7DC81B59450B41F91CA55FAA7243A32031E2AA621133F0F70297F`
- acceptance test canonical bytes:
  `68B324CAF1DB61DE2953716CFB06D8A65C6489D28CC5673AB040DE119169BA25`
- strict Stage-0 verification compiler:
  `5BC784475E1B83C8921716799DC1651F947F729579989F1D902355B84BFDDCF4`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I237 advances ADR 0005 rules 3, 4, and 5: the VKF compiler now owns nested PE
resource-tree leaf relocation in addition to section/data-directory/base-reloc
middle insertion, with deterministic direct Stage fixed points. It does not
yet rewrite shifted import/export/TLS/debug payload internals, create a PE
wholly from compiler-owned source facts, cover ELF or Mach-O, or provide
complete language/ecosystem direct coverage.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 remain partial; rules 6
and 8 remain open. Under the established weighting, partial rules still count
as one half: `4.5/8 = 56.25%`, so the defensible rounded ADR 0005 estimate
remains **55%**. I237 deepens three partial rules without promoting any to
complete. The next packet should audit the earliest real remaining PE payload
relocation against actual locked directories, then move to compiler-owned
container/seed creation rather than manufacture inactive directory cases.
