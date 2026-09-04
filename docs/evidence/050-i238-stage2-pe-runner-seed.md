# 050-I238 Stage-2 PE runner seed evidence

## Scope and behavior

- Git base: `202228b1c56f4a7e5bb34708ffe6c03c05219e25` (I237)
- Worktree: `.worktrees/0.5/050-i238-stage3-pe-seed`
- Branch: `codex/0.5/050-i238-stage3-pe-seed`
- State: GREEN, ready for exact-scope commit

I238 audited every active data directory and file-offset dependency in the
locked Windows x64 runner before selecting a new container slice. Import, IAT,
debug, and exception data all precede the established insertion seam. The
retained resource leaf RVA and base-relocation page are already relocated by
I237 and I236. Export and TLS directories are absent; the certificate table
and COFF symbol table are absent. Synthetic cases for those inactive paths
would not advance the locked bootstrap artifact.

The earliest active dependency is therefore source-owned PE seed creation.
The compiler-private `pe_x64.runner_seed` now writes a deterministic minimal
DOS header, COFF header, PE32+ optional header and sixteen data-directory
entries, followed by seven section headers and zero padding through the
1,024-byte header boundary. It accepts only the 3,584-byte opaque runtime
section body. Existing compiler-owned middle insertion adds `.vkfcod`, shifts
`.CRT`, `.rsrc`, and `.reloc`, and updates the resource leaf and relocation
page. No host-side caller supplies PE header or section-layout fields.

The public-interface fixture proves that the runtime body contains invalid
UTF-8 and is preserved byte-for-byte except for the two already-required
relocation fields. Stage 2 emits an exact 5,120-byte PE, the artifact executes
and prints `42`, Stage-2 and Stage-3 program bytes are identical, and Stage-2,
Stage-3, and Stage-4 compiler bytes are identical.

I238 adds no native opcode, runtime slot, fallback, public VKF syntax or
semantics, public diagnostic, manifest shape/version, Machine IR version, or
runtime ABI. The generated driver contains neither `process.run_native` nor a
PE layout/template vocabulary.

## TDD and acceptance receipts

Environment: Windows x64, Node `v24.11.0`; the six ignored seed/smoke binaries
were mechanically copied from I237. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and
`VKF_TEST_WORK_ROOT=C:\vkf-i238-work`.

Public-behavior RED before the compiler facade was connected:

```powershell
node --test --test-name-pattern "owns the x64 PE runner seed" tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 0/1 in 21.18 s;
- strict direct lowering rejected the absent entry with
  `direct x64 backend unsupported: machine IR supports direct calls only`;
- no fallback was attempted.

Final focused seed case after the opaque-byte assertion:

```powershell
node --test --test-name-pattern "owns the x64 PE runner seed" tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 1/1 in 24.00 s.

All code-section/container cases:

```powershell
node --test tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 6/6 in 181.33 s.

Source and bundle identities:

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 2/2 in 0.37 s.

Complete locked Stage-2/3/4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 26.65 s.

Final adjacent serial gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 19/19 in 513.19 s under host contention.

Full executable bundle under the unchanged 60 s child limit:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- first sample: exit `0`, 1/1 in 55.15 s;
- deliberate second sample: exit `1`, 0/1 in 61.02 s after the child crossed
  60 s; cleanup reported `EPERM` while the timed-out process tree closed;
- no bundle, strict compiler, lexer, parser, or IR process remained after the
  failure.

The bundle smoke serially launches lexer, parser, IR, and compiler processes
for each of eleven sources, then the JavaScript test launches all eleven
artifacts. It reports no per-stage timings. I237 observed 36.41 s, 42.38 s,
and 60.52 s bundle walls while its compiler-private PE compile remained below
one second. During the I238 timeout, an unrelated long-running `Robocopy`
process was active on the host. The I238 PE module still compiled directly in
715.56 ms compiler time / 1.13 s wall with `artifact_fallback:false`.

These observations classify the second sample as a real unchanged-gate
performance-boundary failure correlated with host I/O/process contention, not
a semantic or byte-oracle failure. A single pass and fail are not enough for a
statistically credible regression claim. The 60 s timeout and every assertion
remain unchanged; the near-boundary risk remains explicit.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `4B63D0BB5FB535083E753AEFB041F8B097AB64DFBF3BA987043E861C154F847E`
- bootstrap manifest canonical bytes:
  `A556FECC5745D8AB9901755DBE0F22B9818E9B1B5E6BCB77F3874CA651A532AF`
- compiler facade canonical bytes:
  `CE45BC6C5D970E89EC09C834B059643BA0776DB94F2682EF07032033A9200CE1`
- PE x64 module canonical bytes:
  `98141ECD06CB04C09C3D52768EC4703F4846E362A3CADAB7F8520F730ED34F75`
- acceptance test canonical bytes:
  `483844DFCFE69EA8712DF8BD629D194A23283BAC2FDC07505DD6AD911EE4998E`
- strict Stage-0 verification compiler:
  `5BC784475E1B83C8921716799DC1651F947F729579989F1D902355B84BFDDCF4`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I238 advances ADR 0005 rules 3, 4, 5, 7, and 8 by replacing the locked PE
container header and section-table seed with deterministic compiler-owned
bytes. Runtime section bodies remain opaque seed material, other platform
containers remain unowned, and broad language/ecosystem direct coverage is
still incomplete.

Rules 1, 2, and 7 are established; rules 3, 4, 5, and 8 remain partial; rule
6 remains open. Under the established weighting, partial rules count as one
half: `5.0/8 = 62.5%`, so the defensible rounded ADR 0005 estimate is **60%**.
This promotes rule 8 from open to partial because the final bootstrap path now
has a compiler-owned Windows PE seed boundary, but it is not complete until
the remaining opaque runtime body and other required platform seeds are owned.
