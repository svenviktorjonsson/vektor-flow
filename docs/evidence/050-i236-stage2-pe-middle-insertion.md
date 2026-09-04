# 050-I236 Stage-2 PE middle insertion evidence

## Scope and behavior

- Git base: `6f44da43c7afff1beadb9896e2beeb49e785f2a9` (I235)
- Worktree: `.worktrees/0.5/050-i236-stage3-pe-middle-insert`
- Branch: `codex/0.5/050-i236-stage3-pe-middle-insert`
- State: GREEN, ready for exact-scope commit

I236 adds the first compiler-owned PE middle insertion. A seed/container audit
found no earlier seed prerequisite: the retained Windows x64 PE32+ runner's
exception directory provides a deterministic insertion seam immediately after
the section that contains its unwind table. The compiler does not depend on a
fixed RVA, raw offset, section index, marker, or caller-supplied layout.

When a packed template has later sections at that seam, `pe_x64.vkf` inserts a
new `.vkfcod` header into the section table, shifts the later headers right,
and inserts the file-aligned code bytes before the opaque suffix. It updates:

- COFF `NumberOfSections`;
- later section virtual addresses and `PointerToRawData` fields;
- `SizeOfCode`, `SizeOfInitializedData`, and aligned `SizeOfImage`;
- every later RVA-bearing data-directory address;
- the security directory as a file offset rather than an RVA;
- a nonzero COFF symbol-table file offset when it follows the insertion;
- every affected base-relocation block page RVA; and
- the invalidated optional PE checksum, cleared under the repository's
  existing checksum-disabled user-executable policy.

The public-interface fixture retains a packed `.text/.rdata/.data/.pdata/.CRT`
and `.reloc` runner. All virtual extents and nonempty raw extents are
contiguous, `.vkfcod` is absent, `.CRT` begins at the exception-section end,
ASLR remains enabled, and the relocation table targets `.CRT`. The unrelated
resource section/directory is deliberately absent, keeping resource-tree
internal RVA rewriting as a later independent vertical slice. The fixture has
a valid nonzero checksum and invalid UTF-8 bytes in its opaque prefix.

Stage 2 inserts a 92-byte virtual and 512-byte raw `.vkfcod` at RVA `0x5000`
and raw offset `0x0c00`. It shifts `.CRT` to RVA `0x6000`/raw `0x0e00`, shifts
`.reloc` to RVA `0x7000`/raw `0x1000`, changes the base-relocation directory to
RVA `0x7000`, and changes its target page from `0x5000` to `0x6000`. The exact
image grows from 4,096 to 4,608 bytes, executes and prints `42`. Stage-2 and
Stage-3 program bytes are identical; Stage-2, Stage-3, and Stage-4 compiler
bytes are identical.

I236 adds no native opcode, runtime slot, fallback, public VKF syntax or
semantics, public diagnostic, manifest shape/version, Machine IR version, or
runtime ABI. Generated drivers remain free of internal stage observation and
`process.run_native`.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the six ignored seed/smoke binaries
were mechanically copied from I235. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and short
`VKF_TEST_WORK_ROOT` paths under `C:\v`.

Public-behavior RED against unchanged I235 production:

```powershell
node --test --test-name-pattern='inserts x64 code before later' tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 0/1 in 20.29 s wall / 20.08 s Node;
- I235 appended after the later sections, so the executable still dereferenced
  the required insertion RVA and exited with Windows access violation
  `0xC0000005` instead of `0`.

Two initial implementation runs remained RED because direct lowering reported
`unknown binding relocation_position`; moving the middle-relocation scratch
bindings to function scope fixed the direct backend path without fallback.

First GREEN with exact layout, executable output, and all fixed points:

```powershell
node --test --test-name-pattern='inserts x64 code before later' tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 1/1 in 12.96 s.

Final focused command:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 4/4 in 60.79 s;
- existing marker-free discovery: 15.51 s;
- I234 blank-slot creation: 17.99 s;
- I235 end growth: 10.70 s;
- I236 middle insertion: 15.70 s.

The expected locked-source check first reported only the stale bundle identity
after the two source hashes changed. Applying its computed digest mechanically
restored the source-graph gate, 2/2 in 0.40 s.

Final adjacent serial gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 17/17 in 272.65 s.

Complete locked Stage-2/3/4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 20.30 s.

Full executable bundle under its unchanged 60 s child-process gate:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 42.38 s.

Compiler-private PE module through the direct backend:

```powershell
vkf-strict.exe -b compiler/self_hosted/pe_x64.vkf -o C:\v\i236-pe-final.exe --diagnostics --optimizer-policy mask-0
```

- exit `0`, `artifact_fallback:false`, 0.41 s wall / 275.91 ms reported.

No assertion, byte oracle, timeout, or performance gate was weakened. The full
bundle observation rose from I235's 36.41 s to 42.38 s but remains below the
unchanged 60 s gate; one observation under varying host contention is not a
statistically credible performance regression claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `BBF94A7FE12F0DAC6E3F652A856944D0940E9AA431A43A452F7AF49CE37F514A`
- bootstrap manifest canonical bytes:
  `45B557AC88A19F84FAEC17AB4D04BA1E490308290275C0A245B09B15710A5E16`
- compiler facade canonical bytes:
  `0E595B09011A5B9A73D9FD23B007BF5FE6B39A911289175AED7DAECEA887B907`
- PE x64 module canonical bytes:
  `1E68A74F34D8B5C933F094742EF8048225A6D943783ECF9FDF37D6A1A4DEB93F`
- acceptance test canonical bytes:
  `D1828EC999691CCB58985775CD310CBC0C13E1340013E034181ACB6A3F08E31C`
- strict Stage-0 verification compiler:
  `5BC784475E1B83C8921716799DC1651F947F729579989F1D902355B84BFDDCF4`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I236 advances ADR 0005 rules 3, 4, and 5: the VKF compiler owns a real PE
middle insertion and relocates later container metadata and base-relocation
pages while preserving direct deterministic Stage fixed points. It does not
yet rewrite internal RVAs in a retained resource tree, import/export/TLS/debug
payloads, create a PE wholly from compiler-owned source facts, cover ELF or
Mach-O, or provide complete language/ecosystem direct coverage.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 remain partial; rules 6
and 8 remain open. Under the established weighting, partial rules still count
as one half: `4.5/8 = 56.25%`, so the defensible rounded ADR 0005 estimate
remains **55%**. I236 deepens three partial rules without promoting any to
complete. The next real container RED is a retained resource directory whose
internal data-entry RVAs must move with the section, unless the dependency
audit identifies complete source-owned seed creation as earlier.
