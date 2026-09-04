# 050-I235 Stage-2 PE section growth evidence

## Scope and behavior

- Git base: `60a97f1dac298a23b85f589d5ea692a6a5738dc0` (I234)
- Worktree: `.worktrees/0.5/050-i235-stage3-pe-section-insert`
- Branch: `codex/0.5/050-i235-stage3-pe-section-insert`
- State: GREEN, ready for exact-scope commit

I235 removes the requirement that a complete PE template reserve either a
counted blank `.vkfcod` header or a blank raw/virtual span. The Stage-2 caller
still supplies only the complete opaque PE template and compiler fragments; it
does not supply a section offset, capacity, alignment, prefix, suffix, marker,
or host-prebuilt layout.

The compiler-private `pe_x64.vkf` module now scans all retained section
headers, derives the first aligned virtual address after their maximum extent,
derives an aligned raw offset after the opaque file, sizes the new raw section
from the actual generated code size and PE file alignment, and writes the next
available header-table entry. It increments COFF `NumberOfSections`, updates
`SizeOfCode`, `SizeOfInitializedData`, and aligned `SizeOfImage`, and clears the
now-invalid optional PE checksum in accordance with the existing
checksum-disabled user-executable policy. Existing-section discovery and
I234's counted blank-slot materialization remain unchanged.

The public-interface fixture is a packed four-section Windows x64 runner. Its
`.text`, `.rdata`, `.data`, and `.pdata` virtual extents are contiguous, every
nonempty raw extent is contiguous, its file ends exactly at the last raw
section, its remaining header table is zero, and its `.vkfcod`, `.CRT`,
`.rsrc`, and `.reloc` sections are absent. Relocations are explicitly stripped
and ASLR disabled for this fixed-base runner. The fixture carries a valid
nonzero input checksum so the output oracle proves it is invalidated. It also
contains invalid UTF-8 in the retained PE prefix.

Stage 2 grows that 3,072-byte image by one 512-byte file-aligned section,
writes a 92-byte virtual/code extent at RVA `0x5000` and raw offset `0x0c00`,
zero-fills the remaining 420 raw bytes, preserves every unrelated opaque byte,
and emits an exact 3,584-byte executable that prints `42`. Stage-2 and Stage-3
program bytes are identical; Stage-2, Stage-3, and Stage-4 compiler bytes are
identical.

I235 adds no native opcode, runtime slot, fallback, public VKF syntax or
semantics, public diagnostic, manifest shape/version, Machine IR version, or
runtime ABI. Generated drivers remain free of internal stage observation and
`process.run_native`.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the six ignored seed/smoke binaries
were mechanically copied from I234. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and short
`VKF_TEST_WORK_ROOT` paths under `C:\v`.

An initial fixture-construction run stopped before compiler execution because
the fixture incorrectly assumed the linker's `SizeOfCode` included
`.vkfcod`; correcting that test-only premise produced the valid public RED.

Public-behavior RED against unchanged I234 production:

```powershell
node --test --test-name-pattern='grows a packed' tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 0/1 in 19.07 s wall / 18.88 s Node;
- the packed fixture reached Stage 2, whose direct compiler exited status 3
  because no counted `.vkfcod` or blank counted slot existed.

First GREEN for actual aligned growth:

```powershell
node --test --test-name-pattern='grows a packed' tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 1/1 in 15.94 s.

The fixture was then strengthened with a valid nonzero input PE checksum. The
same command remained GREEN, 1/1 in 19.78 s, and exact bytes proved the output
checksum was cleared.

Final focused command:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 3/3 in 68.88 s under host contention;
- existing marker-free discovery: 25.98 s;
- I234 blank-slot creation: 21.67 s;
- I235 packed-image growth: 20.46 s.

The first adjacent run was 15/16 in 252.00 s. Every executable and fixed-point
test passed; the sole failure was the expected stale locked-bundle digest after
the two source hashes changed. The computed bundle identity was applied
mechanically, and the locked source-graph test passed 2/2 in 0.37 s.

Final adjacent serial gate after the checksum-strengthened fixture:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 16/16 in 303.32 s under host contention.

Complete locked Stage-2/3/4 source graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 24.95 s.

Full executable bundle under its unchanged 60 s child-process gate:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 36.41 s.

Compiler-private PE module through the direct backend:

```powershell
vkf-strict.exe -b compiler/self_hosted/pe_x64.vkf -o C:\v\i235-pe-smoke.exe --diagnostics --optimizer-policy mask-0
```

- exit `0`, `artifact_fallback:false`, 0.29 s wall / 212.48 ms reported.

No assertion, byte oracle, timeout, or performance gate was weakened. I235's
36.41 s bundle observation is close to I234's 37.28 s; neither single run is a
statistically credible performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `72ADD88CF176163C12B0712DD842FDC0247FCDFC7BC1736B83B7006F190B0EFE`
- bootstrap manifest canonical bytes:
  `F9866ED89B5523EFBCBE34C3659A67ED8E372E54AD5285321617E21688869880`
- compiler facade canonical bytes:
  `72308BF0D3856E38335B6D6FB393856A402256AF65D0BCD778450CAE1F1DFBF3`
- PE x64 module canonical bytes:
  `59554F760B626FF013459448AE95B550B9B37F70A84278381CA09296714D8370`
- acceptance test canonical bytes:
  `811A5B0A60A8D7E87AECF4BDC19612C6CFEE8FA7A40CF9644117D467A56ED4E2`
- strict Stage-0 verification compiler:
  `5BC784475E1B83C8921716799DC1651F947F729579989F1D902355B84BFDDCF4`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I235 advances ADR 0005 rules 3, 4, and 5: the VKF compiler now owns one real
PE growth operation, including dynamic code sizing, alignment, section
cardinality, aggregate optional-header fields, checksum invalidation, raw byte
storage, and the same deterministic Stage fixed points. It does not yet insert
a section before later raw/virtual sections, rewrite their affected data
directories/relocations, create an entire PE without a retained runner prefix,
cover ELF/Mach-O, or provide complete language/ecosystem direct coverage.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 remain partial; rules 6
and 8 remain open. Under the established rule-weighting method, partial rules
still count as one half: `4.5/8 = 56.25%`, so the defensible rounded ADR 0005
completion estimate remains **55%**. I235 materially deepens three partial
rules but does not falsely promote any rule to complete. The next real PE RED
is middle insertion with later section/data-directory relocation, unless the
dependency audit shows compiler-owned seed/container creation is earlier.
