# MAT010D-FB: bounded measured-stone frame batch

Date: 2026-09-03

## Packet

- Release gates: MAT-010 deterministic hierarchical distributions and the
  MAT-040 hundreds-stone tracer.
- Base: `8666a18876ed44022300b614bfbfe69a7cd6ae73`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Consumed private contract: MAT010D-FC native measured-stone frame capture.
- Scope: bounded native CPU reference batching into an in-memory RGBA8 atlas.
- Public VKF syntax, API, schema, ABI, diagnostics, compiler, shared renderer,
  UI, 0.4.1, and 0.5 paths: unchanged.
- Owned paths:
  - `native/material/vf_stone_mineral_frame_batch.hpp`
  - `native/material/vf_stone_mineral_frame_batch_test.cpp`
  - `docs/evidence/060-mat010d-stone-mineral-frame-batch.md`

## Observable internal behavior

Each demanded stone has a stable 64-bit identity, one of the three measured
mineral conditions, and a unique stable slot. The private reference consumer
captures a 12 by 12 tile through MAT010D-FC and blits it directly into that
slot. Reversing traversal of all 128 instances produces the exact same pixels,
aggregate evidence fields, and version.

The 128-stone fixture uses 16 columns and produces:

```text
extent=192x96
rgba8 bytes=73728
rendered pixels=11264
spectral transport samples=11264
version=3939306036450568041
passive=true
```

The batch admits at most 256 addressable slots. Its rectangular allocation is
also limited to 256 tiles, so RGBA8 capture storage cannot exceed 147,456
bytes. The exact 256-stone, 16-column boundary reaches this ceiling and passes.
Empty demand, zero or excessive columns, duplicate slots, slots outside
`[0, 255]`, and rectangular layouts exceeding 256 tiles are rejected.

All covered pixels retain the prior per-band passive-energy invariant and each
covered pixel consumes exactly one measured spectral transport sample. Stable
identity and mineral condition reach the final atlas: the three leading tile
centres are not all equal. Inflating every retained local-fit standard error by
100 times leaves the complete atlas and version unchanged, preserving the
separation between measurement error metadata and population variation.

Provenance is validated by the consumed MAT010D chain before any tile is
accepted. That chain pins the USGS Spectral Library Version 7 CC0-1.0 artifact
`ASCIIdata_splib07a.zip` at SHA-256
`D232645740869A82AAFCAD5839448C50B1DC72965CE042D1374F29B7A798A91C`.
No new source material or internet research was needed for this packet.

## TDD receipt

RED command:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I. native/material/vf_stone_mineral_frame_batch_test.cpp -o .work/mb/vf_stone_mineral_frame_batch_test.exe
```

RED exited 1 in 930.8 ms solely because
`native/material/vf_stone_mineral_frame_batch.hpp` did not exist. The behavior
test already required a 128-stone capture, stable-slot traversal independence,
bounded storage, one transport sample per covered pixel, passive energy,
mineral-conditioned pixel differences, measurement-error separation, and
invalid-demand rejection.

GREEN used the same strict command and ran:

```text
stone mineral frame batch: stones=128 extent=192x96 bytes=73728 pixels=11264 version=3939306036450568041 passive=true
```

The final test also exercised the exact 256-stone storage boundary and an
oversized sparse rectangle.

## Verification

Environment:

```text
Microsoft Windows 10.0.26200, X64
clang version 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
```

The focused measured-material dependency chain compiled with strict flags and
passed 7/7 in 34.67 seconds:

```text
vf_material_reference_fit_test
vf_material_researched_preset_test
vf_material_population_distribution_test
vf_stone_mineral_conditioned_distribution_test
vf_stone_mineral_spectral_transport_test
vf_stone_mineral_frame_capture_test
vf_stone_mineral_frame_batch_test
```

The complete native material source tier compiled all 67 tests with the same
strict flags and ran 67/67 green in 278.53 seconds. Executables were built
directly under the short `.work/mb` directory, so no Windows path-length retry
or copied binary was involved.

A descriptive 25-run timing of the complete batch behavior test process gave:

```text
median 518.0299 ms
p95   1094.6519 ms
```

The test process captures three 128-stone atlases and one 256-stone atlas,
performs rejection checks, and includes process startup. This is proportional
regression evidence only, not a shared-renderer frame-budget or frontier claim.

SHA-256 at GREEN:

| Artifact | SHA-256 |
| --- | --- |
| native batch reference | `33C171F57F2672BBA6B3C8169A1662E5D9B4C6B30BE910B53AA620EAA7BF3DF2` |
| native behavior test | `CD70CDD2524A52F6A4C79E887A3CF8FD221FF78CD79658547F9B1C67B20804F4` |
| strict test executable | `193C9772A1E631EA62B41877A5D01F0A5DA9868E4A6D9E3633369ED161763F28` |

## Acceptance impact and handoff

This is the first bounded hundreds-stone consumer of the licensed,
identity-conditioned native measured-material path. It proves deterministic
placement, population/mineral differences, passive transport, measurement-error
separation, and a fixed CPU capture-memory ceiling across 128 stones.

It only partially advances MAT-040. It does not close shared renderer or GPU
consumption, CPU/WGSL image parity, an acceptance frame-time budget, adaptive
visibility/refinement, or released-scene capture. The evidence-based 0.6
estimate is **69.9%**, up **0.4 percentage points** from 69.5%. Confidence
remains medium (about +/-4 points) because roadmap gates have no canonical
weights and the public authoring surface remains unfrozen.

No Language Design Authority decision is needed. Reverting this packet removes
only this private batch reference, behavior test, and receipt.
