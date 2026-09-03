# MAT010D-FC: native measured-stone frame capture

Date: 2026-09-03

## Packet

- Release gate: MAT-010 material correctness and MAT-040 stone consumption.
- Base: `2cde2948e5c0f45c8541f3b21cf18ce63000dc80`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Consumed private contract: MAT010D-LT measured stone-mineral spectral
  transport.
- Scope: bounded native software reference render and in-memory RGBA8 frame
  capture only.
- Public VKF syntax, API, schema, ABI, diagnostics, compiler, shared renderer,
  UI, 0.4.1, and 0.5 paths: unchanged.
- Owned paths:
  - `native/material/vf_stone_mineral_frame_capture.hpp`
  - `native/material/vf_stone_mineral_frame_capture_test.cpp`
  - `docs/evidence/060-mat010d-stone-mineral-frame-capture.md`

## Observable internal behavior

The native reference renderer projects one fixed closed sphere footprint into
a caller-sized frame. At each covered pixel it derives the surface normal and
incidence cosine, calls the existing MAT010D-LT transport with the stable stone
identity and dominant-mineral condition, checks the three-band energy split,
and converts the reflected 650, 550, and 450 nm values to linear RGB bytes.
The renderer then exposes the exact RGBA8 readback as a frame capture.

The 48 by 48 fixture contains 1,500 rendered pixels and 9,216 RGBA8 bytes.
Every rendered pixel consumes exactly one measured spectral transport sample.
Two captures with the same demand are byte-identical and have version
`17278990745347197516`. Albite and hornblende conditions produce different
captured byte streams and versions.

Every band at every covered pixel retains:

```text
reflected + absorbed = projected incident energy
0 <= reflected <= projected incident energy
0 <= absorbed
```

The maximum observed balance error is at most `1e-7`. Inflating all retained
local-fit standard errors by 100 times leaves the complete captured byte stream
and version unchanged. Measurement error therefore remains evidence metadata,
not procedural pixel variation.

Frame extents are nonzero and bounded to 256 by 256, limiting allocation to
262,144 RGBA8 bytes and spectral work to 65,536 pixels. Invalid extents,
non-finite illumination, and incompatible measured provenance are rejected
before a capture is accepted.

This is a private CPU reference consumer, not the shared 0.4 renderer or a GPU
claim. It deliberately does not define camera, lighting, tone-mapping,
material-record, or frame-capture APIs for VKF authors.

## TDD receipt

RED command:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I. native/material/vf_stone_mineral_frame_capture_test.cpp -o .work/060-mat010d-stone-mineral-frame-capture/vf_stone_mineral_frame_capture_test.exe
```

RED exited 1 because
`native/material/vf_stone_mineral_frame_capture.hpp` did not exist. The test
already required deterministic repeat capture, one transport sample per stone
pixel, passive energy, distinct mineral captures, stable background bytes, and
measurement-error separation.

GREEN compiled with the same strict command and ran:

```text
stone mineral frame capture: pixels=1500 bytes=9216 center_rgb=28,22,25 version=17278990745347197516 passive=true
```

Consumer-boundary checks additionally reject zero/over-capacity extents,
non-finite incident radiance, and a mismatched source archive hash.

## Verification

Environment:

```text
Microsoft Windows NT 10.0.26200.0, X64
clang version 22.1.4 (llvm-project 35990504507d79e0b9deb809c8ee5e1b34ceef20)
```

The focused measured-material dependency chain compiled with the strict command
and passed 6/6 in 22.63 seconds:

```text
vf_material_reference_fit_test
vf_material_researched_preset_test
vf_material_population_distribution_test
vf_stone_mineral_conditioned_distribution_test
vf_stone_mineral_spectral_transport_test
vf_stone_mineral_frame_capture_test
```

The complete native material source tier compiled all 66 tests with the same
strict flags. Fifty-two executed green from the initial temporary directory.
Fourteen executables had 260-261-character paths and Windows refused to launch
them with `0xfffffffe`; copying those unchanged binaries to the shorter
`.work/mc-suite` path produced 14/14 green. Aggregate result: 66 passed, 0
failed. The launch-path issue was not counted as a test result.

A descriptive 25-run timing of the complete capture test process reported:

```text
median 100.3211 ms
p95    119.1574 ms
```

This includes process startup, four complete valid captures, and rejection
checks. It is proportional regression evidence only, not a renderer-performance
ratchet or frontier claim.

SHA-256 at GREEN:

| Artifact | SHA-256 |
| --- | --- |
| native capture reference | `894F883D68C59FB1A0FF9C85E2FA2F5F34D8EBA5B524D6ABC8BA96A6C3BD4627` |
| native behavior test | `BE92A6B726FEEC99A9528DACCF59C15FB50AF7B33A2C9C07991FCAC1F5173047` |
| strict test executable | `AAE5AC13DC296422C8E6EEC6A97225DF7E4B4CA310C1828BBD745794FABB024E` |

## Acceptance impact and handoff

This closes the private native CPU path from licensed, identity-conditioned
stone measurement through spectral energy transport to deterministic frame
bytes. It does not close shared renderer/GPU consumption, CPU/WGSL image
parity, hundreds-stone frame budgets, or released-scene capture.

The evidence-based 0.6 estimate is **69.5%**, up **0.5 percentage points** from
the previous 69.0% report. Confidence remains medium (about +/-4 points)
because the roadmap has no canonical per-gate weights and the public authoring
surface remains unfrozen.

No Language Design Authority decision is needed. Reverting this packet removes
only the private native reference consumer, test, and receipt.
