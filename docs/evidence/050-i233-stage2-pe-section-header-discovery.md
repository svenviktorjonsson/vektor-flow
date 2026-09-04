# 050-I233 Stage-2 PE section-header discovery evidence

## Scope and behavior

- Git base: `9b8836f0a2e11cf3961a14baf37e937ddecee7ad` (I232)
- Worktree: `.worktrees/0.5/050-i233-stage3-pe-section-header`
- Branch: `codex/0.5/050-i233-stage3-pe-section-header`
- State: GREEN, ready for exact-scope commit

I233 removes the locked marker and 32 KiB capacity assumptions from the
whole-template x64 writer. The Stage-2 caller still supplies one opaque PE
template and no offset, capacity, prefix, suffix, or prebuilt section layout.
A locked compiler-private `pe_x64.vkf` module validates the DOS and PE
signatures, decodes `e_lfanew`, COFF section count and optional-header size,
scans 40-byte section headers for `.vkfcod`, and returns its
`PointerToRawData` and `SizeOfRawData` values.

One compiler-private Machine IR operation copies a byte range at
runtime-discovered offsets. Its x64 and arm64 implementations allocate through
the existing allocator and copy through existing runtime slot 28. It neither
decodes UTF-8 nor adds a runtime slot. The internal opcode is appended so all
existing opcode values remain stable; Machine IR version 23, the manifest
schema, public VKF syntax and semantics, diagnostics, and runtime ABI are
unchanged.

The acceptance fixture is intentionally invalid UTF-8. It removes the
`VKFX64AOTCODE001` marker and changes the `.vkfcod` section header's raw size
from 32 KiB to 16 KiB while preserving the remaining container bytes. Stage 2
and Stage 3 discover that section from PE headers, insert the exact 92 selected
code bytes, zero-fill only the discovered capacity, preserve the exact opaque
prefix and suffix, and emit byte-identical runnable executables that print
exact `42`. Stage-2, Stage-3, and Stage-4 compiler artifacts are byte-identical.

The I232 regex capture is no longer on this path. The deletion test replaces
the locked regex source with the smaller, purpose-owned `pe_x64.vkf` source;
the bundle remains 11 units and recovers the unchanged executable-bundle
timeout margin. Generated drivers still contain no internal stage observation
or `process.run_native` fallback.

## TDD and build receipts

Environment: Windows x64, Node `v24.11.0`, Visual Studio 2019 Build Tools
MSVC `19.29.30159.0`. The six ignored seed/smoke binaries came mechanically
from I232. Tests used
`VKF_NATIVE_BIN=(Resolve-Path '.work/full-suite-bin')` and short
`VKF_TEST_WORK_ROOT` paths under `C:\w`.

Public-behavior RED:

```powershell
node --test tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `1`, 0/1 in 18.50 s;
- the marker-free 16 KiB fixture reached the old fixed regex writer and the
  Stage-2 process exited with status 3.

Native configure/build used no generated-source or external-tool fallback:

```powershell
cmake -S compiler/native -B C:\w\vf-i233-vs16 -G "Visual Studio 16 2019" -A x64
cmake --build C:\w\vf-i233-vs16 --config Release --target vkf_strict --parallel 2
```

- configure exit `0`;
- Release `vkf_strict` build exit `0`;
- the rebuilt compiler was copied only to ignored `.work/full-suite-bin` for
  verification.

First focused GREEN before the deletion-test split:

- exit `0`, 1/1 in 23.10 s.

The first full-bundle attempt exposed a real performance RED: exit `1` after
60.78 s because the unchanged 60 s child-process gate timed out. A second
10-source attempt also crossed that boundary and its cleanup reported `EPERM`
at 60.98 s. No timeout or assertion was changed. Moving PE parsing out of the
already-large compiler facade into the locked compiler-private module restored
headroom.

Final focused plus source/hash gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage1-bootstrap-source-graph.test.mjs tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs
```

- exit `0`, 3/3 in 16.51 s;
- marker-free PE fixed point: 15.84 s.

Final adjacent serial gate:

```powershell
node --test --test-concurrency=1 tests/bootstrap/stage2-owned-x64-code-section-replacement-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-marker-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-code-section-layout-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-dynamic-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-relocation-collection-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-symbol-relocation-table-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-backward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-forward-call-relocation-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-artifact-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-positive-imm32-high-byte-fixed-point.test.mjs tests/bootstrap/stage2-owned-x64-complete-integer-writer-fixed-point.test.mjs tests/bootstrap/stage1-locked-graph-stage2-artifact.test.mjs tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 14/14 in 295.28 s.

Final locked Stage-2/3/4 graph:

```powershell
node --test tests/bootstrap/stage2-locked-source-graph-fixed-point.test.mjs
```

- exit `0`, 1/1 in 13.13 s.

Final full executable bundle:

```powershell
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 in 45.56 s under the unchanged 60 s child-process gate.

No assertion, byte oracle, timeout, or performance gate was weakened. The
focused and bundle observations are not statistically sufficient for a formal
performance claim; they show that I233 does not consume the existing gate
budget.

## Contract hashes

- ADR 0005 canonical bytes:
  `96A0552F3104475533AFFA66456CDCF9D0F187629865357A1181DB6250CE7BB1`
- bootstrap bundle identity:
  `13EB48867C5E3AC9879A785ABB6E492080E6AF1A6FDB95C1426095196E02B6E3`
- bootstrap manifest canonical bytes:
  `D68A10E2074244684C01313B34E95213D55DC1C07696311990911A760A8D5345`
- compiler facade canonical bytes:
  `0DA6D8032A17FA9610A34DEA49490EC506D3C8B0E9B8BA8AA5B19F5997006BDB`
- PE x64 module canonical bytes:
  `9F5401C4F3834A8F876C52105EADA5CF6672A9AE9A739CA472C6F3D1FCC9EAF5`
- acceptance test canonical bytes:
  `D3EF428FBD5956C3D6B251E375F88854C00A582A2FE008488EF5EF6A3397842F`
- rebuilt strict verification compiler:
  `5BC784475E1B83C8921716799DC1651F947F729579989F1D902355B84BFDDCF4`
- locked x64 runner template:
  `8B501F0F67A5AA20E33F82DA8B1747E498A09BCE2BC2B4AD576A165CA792D039`

## Gate and completion impact

I233 advances ADR 0005 rules 3, 4, and 5: section location and capacity now
come from compiler-owned PE headers; byte-preserving replacement, relocations,
and fixed-point artifacts remain direct and deterministic. It does not yet own
general PE header creation, arbitrary section creation, ELF/Mach-O containers,
or complete language/ecosystem direct coverage.

Rules 1, 2, and 7 are established; rules 3, 4, and 5 remain partial; rules 6
and 8 remain open. Counting partial rules as one half remains
`4.5/8 = 56.25%`, so the defensible rounded ADR 0005 completion estimate stays
**55%**. The next real RED should encode or rewrite compiler-owned PE section
headers/container layout, then broaden artifact formats and full-suite direct
coverage before fallback retirement and seed-only toolchain-free rebuild.
