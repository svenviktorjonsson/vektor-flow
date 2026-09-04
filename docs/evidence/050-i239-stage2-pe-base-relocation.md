# 050-I239 Stage-2 PE base-relocation evidence

## Scope and behavior

- Git base: `1e891a7b` (I239A prerequisite on I238)
- Worktree: `.worktrees/0.5/050-i239-stage3-pe-runtime-text`
- Branch: `codex/0.5/050-i239-stage3-pe-runtime-text`
- State: GREEN, ready for exact-scope commit

I239 audits the remaining opaque 3,584-byte Windows x64 runtime body and owns
its first active section body. The earliest independent body is the locked
512-byte `.reloc` section. The compiler-private `pe_x64.runner_seed` now
accepts only the preceding 3,072 opaque runtime bytes and appends the exact
base-relocation block itself:

- relocation page RVA `0x5000`;
- block size `12`;
- one `IMAGE_REL_BASED_DIR64` entry at offset zero (`0xA000`);
- one absolute padding entry and 500 zero-padding bytes.

The existing compiler-owned middle-insertion path subsequently relocates that
page to its final RVA, as established by I236. The public-behavior fixture
supplies only bytes 1,024 through 4,095 of the locked runner, verifies that
those opaque bytes include invalid UTF-8, and proves the generated 5,120-byte
PE remains byte-identical to the locked executable. The artifact executes and
prints `42`; Stage-2 and Stage-3 program bytes are identical; Stage-2,
Stage-3, and Stage-4 compiler bytes are identical.

I239 adds no native opcode, runtime slot, fallback, cache, public VKF syntax
or semantics, diagnostic, manifest shape/version, CLI, schema, or ABI. The
remaining 3,072 runtime bytes stay opaque and byte-preserved.

## TDD receipt

Environment: Windows x64, Node `v24.11.0`. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and
`VKF_TEST_WORK_ROOT=C:\\vkf-i239-work`.

Public-behavior RED before connecting the relocation-body entry:

```powershell
node --test --test-name-pattern "owns the x64 PE runner seed and base relocations" tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 0/1 in 30.42 s;
- strict direct lowering rejected the absent compiler entry with
  `direct x64 backend unsupported: machine IR supports direct calls only`;
- no fallback was attempted.

The initial entry was GREEN, then refactored into the existing
`pe_x64.runner_seed` seam so no parallel facade remained. Final integrated
focused result:

- exit `0`, 1/1 in 21.35 s.

All code-section and PE-container cases:

```powershell
node --test tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 6/6 in 135.40 s.

Source and bundle identities:

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 2/2 in 0.34 s.

Complete locked Stage-2/3/4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 19.09 s.

Full executable locked bundle using the I239A linked bundle tool and the
unchanged 60 s child limit:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- first independent sample: exit `0`, 1/1 in 26.14 s;
- second independent sample: exit `0`, 1/1 in 27.30 s;
- worst observed headroom: 32.70 s (54.5% of the fixed limit);
- no cache or fallback was used.

Final adjacent serial gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 19/19 in 379.03 s;
- 0 failed, 0 skipped.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `5117B508E7580BBF206D3A2D2B3507E3A32FE4B7E3C8F672F7322A6BB266FCE7`
- bootstrap manifest canonical bytes:
  `1A0690E9C9897AB12C62F06653463A3202E57A59FC487BCFF90AE2528D2ECCEA`
- compiler facade canonical bytes (unchanged):
  `CE45BC6C5D970E89EC09C834B059643BA0776DB94F2682EF07032033A9200CE1`
- PE x64 module canonical bytes:
  `CA25B8E8CDBEEB13FA9FB0B1B8DC01801F410641EC339D2DA658B3B15706CD63`
- acceptance test canonical bytes:
  `141EB042682D363B03B835DD37077FEEA9AB1DBC6B4087B7B0ECD1A7E8E6639C`
- locked x64 runner template (unchanged):
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I239 deepens ADR 0005 rules 3, 4, 5, 7, and 8 by moving one active runtime
section body across the source-ownership boundary. It does not complete a new
rule: the import, read-only data, exception, CRT, and resource section bodies
remain opaque, other platform containers remain unowned, and broad direct
language/ecosystem coverage remains incomplete.

Rules 1, 2, and 7 are established; rules 3, 4, 5, and 8 remain partial; rule
6 remains open. Under the established weighting, partial rules count as one
half: `5.0/8 = 62.5%`, so the defensible rounded ADR 0005 estimate remains
**60%**.
