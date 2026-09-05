# Bounded waterlines from emitted terrain triangles

2026-09-05; base `d5b0849f50f25ecd726afb70ebe1e5cebc1f22bb`, branch `pre-gen`.

## Private consumer boundary

The existing terrain material binding retains its explicitly supplied water
level and exposed/submerged IDs. The surface packet carries that same truth;
the new waterline consumer owns the existing triangulation through a shared
immutable pointer. It copies no terrain, normal, material, or triangle buffers.
The old probe modes and all original generator bytes remain unchanged.

Membership remains `height <= water_level`. Only already-emitted linear
triangles are intersected. Shared edges are evaluated in global X/Z endpoint
order, then segment endpoints are ordered lexicographically. This fixes the
floating-point operation order independently of local indices or winding.
An endpoint exactly on the level retains its exact X/Z coordinates; every
emitted Y contains the retained level itself.

Coplanar triangles emit no separator. Point-only contacts emit no zero-length
segment. A shared level edge exposed on both sides emits once. Duplicate
segments are suppressed; output follows first occurrence in triangle order.
Reordering demand may change segment order and a bounded prefix, but not the
canonical identity of a shared intersection.

The consumer validates source alignment, finite retained level, all material
IDs against that level, input triangle cap, segment budget, and all indices
before reserving output. Interpolation rejects non-finite differences/results
and invalid fractions instead of clamping or substituting a result. These are
private native errors, not new public VKF language diagnostics.

At most 131,072 input triangles and 65,536 output segments are accepted.
Storage for segments and duplicate lookup is bounded by the segment budget.
Zero budget reserves no segment vector; the first eligible unique segment
marks truncation. Larger budgets preserve the first-occurrence prefix.

## RED → GREEN

1. The generated shared-edge test failed to compile without the consumer.
2. A forged NaN retained level was accepted; explicit finite validation rejects it.
3. A forged material ID was accepted; the consumer now verifies retained
   classification truth before allocation.
4. Finite endpoint heights whose subtraction overflows produced an accepted
   intersection; exact finite interpolation checks now reject that input.

Captures: `build/terrain/16-waterline-seam-red.txt` through
`19-waterline-interpolation-red.txt`. Behavioral REDs exited 1. No expected
hashes, tolerances, timeouts, or sanitizer checks were relaxed.

Retained private metadata and extraction of the existing common topology
validator were added only with the preceding fifteen byte/hash gates GREEN.
The existing validator's check order and messages remain unchanged.

## Verified gates

| Gate | Result |
| --- | --- |
| GCC 12.2 complete terrain/normal/mesh/waterline differential and old hashes | 19/19 GREEN |
| Clang 22.0.0git same byte suite | 19/19 GREEN |
| MSVC 19.44.35217 same byte suite | 19/19 GREEN |
| GCC combined unchanged road/random/spatial dependencies and terrain | 70/70 GREEN |
| Native waterline seam, degeneracy, ownership and full-cap tests, all three compilers | GREEN |
| Rebuilt height tests, full GCC ASan + UBSan fixed-layout | 20/20 clean |
| Rebuilt normal tests, same sanitizers | 20/20 clean |
| Rebuilt triangulation tests, same sanitizers | 20/20 clean |
| New waterline tests, same sanitizers | 20/20 clean |

The oracle compares every byte, including all source positions, normals,
material IDs, triangles, bounds, counts, truncation flags and waterline points.
Two seeds, three explicit water levels and four output budgets are covered.
Replay is exact. Changing only the explicit water level leaves all source
position/normal bytes unchanged while moving the contour and classification.
Generated adjacent tiles agree exactly on both seam axes at the same refinement.
Separate authored triangle fixtures exercise degeneracies without replacing
the generated-terrain seam test.

The maximum fixture emits 65,536 segments from 65,536 resident samples and
65,024 cells. The complete probe trace is 8,114,280 bytes, inside the unchanged
16 MiB capture limit. Observed segment capacity never exceeds its budget;
truncation is explicit. Original eight terrain/material SHA-256 gates remain
unchanged, including the full terrain/material trace
`e1c0539a8261acd4b6032b19a40492a139af315e64956a0ab3af791d231807e6`.

## Reproduce

```sh
node --test tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_waterline_test.cpp -o build/terrain/waterline
build/terrain/waterline
```

Use Clang with the same flags or MSVC `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
Build `tools/terrain-water-level-probe.cpp` separately for each compiler and
set `VKF_TERRAIN_PROBE` to that executable. `--waterline` extends the existing
triangle trace; existing default, normal and triangle trace bytes are intact.

All four native terrain units were rebuilt with
`-O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -no-pie`
and the same warning/error flags, then each executed twenty times. Every
execution exited 0 with empty stderr. No sanitizer options or checks were
disabled. The 80-run receipt is `build/terrain/waterline-sanitizer-20.json`.
The fixed-layout flag retains the documented [PIE startup isolation](060-conditioned-terrain-normals.md);
ordinary PIE instability remains recorded, not relabeled GREEN.

## Limits

Refinement may change linear-mesh contours. This packet proves same-level
seam identity, not mixed-level shoreline stitching or continuous-field shores.
It adds no sediment, erosion, physical water, beach model, camera selection,
renderer, shading behavior, forest identity change or public schema/API/default.
There is no performance, naturalism or release-percentage claim.
