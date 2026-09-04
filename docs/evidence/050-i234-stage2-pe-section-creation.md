# 050-I234 Stage-2 PE section creation evidence

## Scope and behavior

- Git base: `46d6605523ed2e1cc13249101d1c0b236459c5b3` (I233)
- Worktree: `.worktrees/0.5/050-i234-stage3-pe-section-create`
- Branch: `codex/0.5/050-i234-stage3-pe-section-create`
- State: GREEN, ready for exact-scope commit

I234 removes the requirement that an opaque x64 runner template already
contain a populated `.vkfcod` section header. The Stage-2 caller still supplies
only the complete PE template and code fragments. It supplies no header
offset, raw/virtual address, capacity, prefix, suffix, or host-prebuilt layout.

The compiler-private `pe_x64.vkf` module now recognizes a blank 40-byte
section-table slot. It derives that slot's raw range from the preceding raw
section end and following raw section start, derives its virtual range from
the preceding aligned virtual span and following virtual address, and encodes
the complete `.vkfcod` header in little-endian bytes. Existing `.vkfcod`
headers retain the I233 discovery path unchanged.

The public-interface fixture erases the complete original `.vkfcod` header and
the legacy marker while leaving the opaque physical gap. Stage 2 recreates the
exact 40 header bytes, inserts the exact 92 selected code bytes, zero-fills the
derived 32 KiB raw span, preserves every other opaque byte, and emits a
runnable executable that prints exact `42`. Stage 2 and Stage 3 program bytes
are identical; Stage-2, Stage-3, and Stage-4 compiler bytes are identical.

I234 adds no native opcode, runtime slot, fallback, public VKF syntax or
semantics, diagnostic, manifest shape/version, Machine IR version, or runtime
ABI. It reuses I233's compiler-private byte slice and the existing byte arena.
Generated drivers remain free of internal stage observation and
`process.run_native`.

## TDD receipts

Environment: Windows x64, Node `v24.11.0`; the six ignored seed/smoke binaries
came mechanically from I233. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and short
`VKF_TEST_WORK_ROOT` paths under `C:\w`.

Public-behavior RED:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 1/2 in 117.44 s under host contention;
- retained marker-free header discovery passed;
- the fixture with the complete `.vkfcod` header erased reached Stage 2 and
  exited with status 3.

The compiler-private PE module was independently compiled through the direct
backend:

```powershell
vkf-strict.exe -b compiler/self_hosted/pe_x64.vkf -o C:\w\vf-i234-pe-smoke.exe --diagnostics --optimizer-policy mask-0
```

- exit `0`, `artifact_fallback:false`, 0.48 s total.

First missing-section GREEN:

```powershell
node --test --test-name-pattern="creates a missing" tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 1/1 in 37.15 s.

A strengthened two-case run exposed one scoped regression: the new virtual-gap
assertion was incorrectly applied to already-existing sections, producing
1/2 in 49.38 s. Restricting the following-section bound to created slots
restored both paths.

Final focused command:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 2/2 in 36.91 s;
- existing dynamic-capacity discovery: 19.56 s;
- missing-header creation: 17.04 s.

Final adjacent serial gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 15/15 in 287.77 s.

Final locked Stage-2/3/4 graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 16.36 s.

Final full executable bundle:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 37.28 s under the unchanged 60 s child-process gate.

No assertion, byte oracle, timeout, or performance gate was weakened. The
bundle time is lower than I233's 45.56 s observation, but neither single run is
a statistically credible performance claim.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `68C05BCE15DC4027D700845A8CD3413C34F6A404A329334BA11004E7516E99ED`
- bootstrap manifest canonical bytes:
  `49C2217F886FCEF391DE2B38F2C6E46E4F0368D0E510D65CE17CFD54884DC6A2`
- compiler facade canonical bytes:
  `4ED432E49C66BC5C7423EA351C41D9C69CF5B944E02B33D160819709BD65B1B4`
- PE x64 module canonical bytes:
  `FC1FD367ECD88F55C1CCC1DE595410A15590CB7B264BC8BF5878ABD7C58DBC68`
- acceptance test canonical bytes:
  `191CD8F73468BBE4E251E92C73A509B77E4367D179C0EFFC911CCD097AEB0178`
- strict Stage-0 verification compiler:
  `5BC784475E1B83C8921716799DC1651F947F729579989F1D902355B84BFDDCF4`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I234 advances ADR 0005 rules 3, 4, and 5: VKF source now owns discovery and
creation of one missing PE code-section header, direct byte encoding, and the
same deterministic Stage fixed points. It does not yet grow a PE that lacks a
physical raw/virtual gap, change COFF section cardinality, update later raw
offsets, create arbitrary sections, or cover ELF/Mach-O and the full language
ecosystem.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 remain partial; rules 6
and 8 remain open. Counting partial rules as one half remains
`4.5/8 = 56.25%`, so the defensible rounded ADR 0005 completion estimate stays
**55%**. The next real RED is PE section insertion: grow a template without a
blank raw/virtual gap, update COFF section count and affected container fields,
then continue to general container creation and cross-platform formats.
