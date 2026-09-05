# Shared-field terrain normals and aligned surface data

2026-09-05; base `d66ef996d8b00530c72db06e8bdcd3dbf2671d81`, branch `pre-gen`.

## Scope

The private terrain working set retains its supplied height condition. Normal
generation samples that same height field at positive/negative X followed by
positive/negative Z, with a caller-supplied finite positive sampling distance.
Central differences produce `[-dx, 1, -dz]`, normalized using its Euclidean
length. Sampling distance is independent of tile refinement: equal global
positions use the same stencil, including both tile seams and coarse anchors.
These are finite-difference normals, not a claim of analytic derivative accuracy.

The private surface-data consumer assembles position/normal/material buffers.
It rejects unequal source identities or array lengths before allocation, even
when separate sources happen to contain equal coordinates. It retains the
generated terrain owner. Existing water-level material selection is reused;
there is no second material algorithm, shading model, or renderer.

Normal demand equals realized terrain demand, capped at 65,536 samples. Normal
payload is 24 bytes/sample; the assembled position/normal/material payload is
52 bytes/sample, excluding container/ownership metadata. Neither stage expands
the potential grid. Stencil collapse, overflowing sampling span, non-finite
lengths and malformed consumer normals produce exact private errors. No clamp,
flat-normal repair or fallback is used. Stencil errors are evaluated in explicit
source order. No public VKF syntax, API, schema, default or diagnostic changes.

## RED → GREEN

- First seam/refinement consumer test: missing `vf_terrain_normals.hpp`, exit 1.
- Positive distance too small to change a coordinate: accepted invalid stencil,
  then rejected as `terrain normal sampling distance is not representable at position`.
- Extreme finite height amplitude: accepted overflowing normal length, then
  rejected as `terrain normal length must be finite and positive`.
- Forged NaN normal reached surface assembly, then rejected as
  `terrain surface normals must be finite` before allocation.
- Finite distance whose doubled span overflows: accepted flat result, then
  rejected as `terrain normal sampling span must be finite`.

The four behavioral REDs exited 1 with `invalid input was accepted` before
their fixes. Raw captures are `build/terrain/05-normals-seam-red.txt` through
`09-normal-span-red.txt`. The existing height sampler and position validation
were extracted only while GREEN; their operation order and messages remain.

## Existing terrain identity preserved

The previous committed producer/probe was extracted from `d66ef996` into this
checkout's `build/terrain/baseline-d66` and compiled with the same strict GCC
flags. Eight original terrain/material traces were byte-identical before and
after: both seams, refinement, zero/prefix/full budgets and extreme int32 tiles.
The tracked JS test pins all eight original SHA-256 values and passes on GCC,
Clang and MSVC. It supplements, rather than replaces, the existing byte oracle.

- Concatenated eight original traces:
  `6a62a67922e29c61fa5af07f5230e472d8842851aff52bbc3207e747397da7aa`
- Original 65,536-sample trace, 1,835,028 bytes:
  `e1c0539a8261acd4b6032b19a40492a139af315e64956a0ab3af791d231807e6`

Existing forest, road and stone source/identity hashes are not edited.

## Verification

| Gate | Result |
| --- | --- |
| GCC 12.2 JS/native complete terrain/surface byte differential and old hashes | 10/10 GREEN |
| Clang 22.0.0git same differential and hashes | 10/10 GREEN |
| MSVC 19.44.35217 same differential and hashes | 10/10 GREEN |
| GCC terrain + existing road/random/spatial dependencies | 61/61 GREEN |
| Native normals/consumer tests, strict Clang and MSVC | GREEN |
| GCC ASan + UBSan, fixed executable layout | 20/20 clean executions |

The JS oracle samples the existing spatial kernel at the explicit stencil
positions and compares every float64 position/normal and uint32 material ID.
It covers changed seeds/conditions/distances, signed/extreme positions, flat
height, replay, zero/prefix/full demand and exact errors without partial output.
Native tests prove both seams, coarse anchors, bounded finite upward normals,
source ownership, mismatched buffers and validation order. Full 65,536-sample
demand is included under sanitizers. No tests, tolerances, sanitizer checks or
acceptance timeouts were weakened. No speed or release-percentage claim.

## Sanitizer startup isolation, not a removed check

An ordinary PIE ASan/UBSan launch initially repeated `AddressSanitizer:DEADLYSIGNAL`
without a report. The exact owned test container was stopped; unrelated
containers were untouched. Bounded diagnostic launches used verbosity 1 and
64 KiB capture, killing only the looping process on capture overflow.

In a subsequent 20-launch series for each binary:

| Ordinary PIE binary | Initialized and passed | Failed before initialization | Failed after initialization |
| --- | --- | --- | --- |
| Unchanged previous terrain sanitizer executable | 14 | 6 | 0 |
| New normals sanitizer executable | 14 | 6 | 0 |

All twelve observed failures lacked `AddressSanitizer Init done`; the first
fatal-signal text was at byte offset 14008, with no program stdout. All 28
initialized executions passed. Earlier 8-launch controls also reproduced one
pre-initialization failure in each binary. This isolates an observed sanitizer
startup/layout issue; it does not establish the underlying loader defect.

Rebuilding the same normals test with only `-no-pie` added, keeping both
sanitizers and every test intact, passed 20 consecutive executions with empty
stderr (in addition to an earlier 8/8). No `ASAN_OPTIONS` override was used for
those acceptance runs. Ordinary PIE startup instability remains recorded, not
silently called GREEN. Raw bounded receipts remain under `build/terrain/`:
`sanitizer-verbose-startup-20.json` and `sanitizer-fixed-address-20.json`.

## Reproduce

```sh
node --test tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O1 -g -ffp-contract=off -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -fno-omit-frame-pointer -no-pie -I. native/material/vf_terrain_normals_test.cpp -o build/terrain/normals-sanitized-no-pie
build/terrain/normals-sanitized-no-pie
```

Run that sanitizer executable twenty times, requiring exit 0 and empty stderr
on every execution. For the diagnostic PIE comparison, omit `-no-pie` and use
`ASAN_OPTIONS=verbosity=1`; retain failed launches and initialization markers.
Do not disable sanitizer handlers or omit tests to make startup failures pass.

The differential probe uses `-O2 -ffp-contract=off` with GCC/Clang, and
`/O2 /fp:strict /W4 /WX /EHsc /std:c++20` with MSVC. `VKF_TERRAIN_PROBE`
selects the explicitly compiled per-toolchain binary. Clang uses
`/emsdk/upstream/bin/clang++` in `emscripten/emsdk:4.0.14`; GCC uses
`node:22-bookworm`. The unchanged default probe mode still emits the original
terrain/material bytes; `--normals` adds only the private surface-data trace.

## Remaining boundaries

This supplies finite shared-boundary normals, not triangulation, camera LOD,
conservative geometric error bounds, multiscale relief, mountains, erosion,
physical sediment/wetting, general water or a renderer. Authored fixture
conditions carry no measured-naturalism claim. Public author controls and
the separate forest identity decision still require Viktor's approval.
