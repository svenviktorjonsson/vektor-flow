# Addressed resident terrain cells through one topology kernel

2026-09-05; base `34b6527bf2c183ddcdfc10146e785f254106f32b`, branch `pre-gen`.

## Private consumer boundary

`TriangulateTerrainAddressedCellsReference` consumes retained terrain sample IDs
and maps their full tile-grid addresses to compact source-buffer indices.
It uses the same triangulation, winding, emitted-bounds and demand-validation
kernel as the original prefix entry. No height, normal, material or waterline
formula is duplicated or changed. The source surface and its tile/refinement
identity remain owned throughout downstream waterline consumption.

The original `TriangulateTerrainCellsReference` remains prefix-only. Its exact
`terrain indexed samples require addressed topology` rejection and precedence
are unchanged. Existing consumers cannot silently interpret sparse storage as
row-major storage. The explicitly addressed adapter also accepts a validated
prefix source through the shared kernel; no implicit fallback is introduced.

Only fully resident cells are emitted. Selected cells retain caller order and
produce the existing upward `[a,c,b]`, `[b,c,d]` triangles. For sparse source
order `[d,a,c,b]`, the corresponding indices are `[1,2,3]`, `[3,2,0]`. Corner IDs
remain 64-bit; triangle indices reference at most 65,536 resident vertices.

## Bounds and validation

The existing cell cap of 65,536, triangle cap of 131,072 and input-demand cap of
65,536 remain unchanged. Source validation runs first, then caps, then selected
cells in order: domain, corner residency, duplicate. Unselected malformed cells
are not evaluated. All selected cells validate before triangle storage is
reserved. The address lookup is bounded by resident source samples; hash-table
iteration never affects result order. Zero selected cells build no lookup and
reserve no triangle storage. Prior source buffers are not mutated.

Bounds still enclose emitted linear triangles only. Signed-zero bounds retain
negative zero as minimum and positive zero as maximum under demand permutation.
This does not bound the unsampled continuous field or specify camera/LOD policy.

## RED → GREEN

Captures under `build/terrain`:

| Capture | RED | GREEN |
| --- | --- | --- |
| `37-terrain-addressed-red.txt` | Addressed topology entry absent | Four distant resident corners map to exact compact indices |
| `38-terrain-addressed-probe-red.txt` | Indexed triangle probe mode absent | Complete existing JS-reference byte differential |
| `39-terrain-addressed-waterline-red.txt` | Indexed waterline probe mode absent | Existing waterline consumes addressed triangles with exact prefix parity |

Each RED exited 1 before its corresponding implementation. No expected identity,
tolerance, timeout, acceptance gate or old diagnostic assertion was weakened.
The shared extraction passed all 27 existing terrain/material/residency checks
before the new probe gates were added.

## Verified evidence

GCC 12.2, Clang 22.0.0git and MSVC 19.44.35217 each pass all 32 affected
terrain/material/residency byte suites. The native addressed test passes on all
three. Coverage locks exact source positions/normals/materials, compact indices,
emitted bounds, replay, two seeds, source/demand permutations, signed zero,
zero/partial budgets, every missing corner, source-order diagnostics and no
partial stdout. Native coverage includes both tile seam axes, a retained
refinement anchor, invalid source ownership/alignment, unchanged prefix rejection,
upward winding and the largest tile corner ID, 4,295,098,368.

The full fixture stores 65,536 samples in reverse address order and emits
130,048 triangles for 65,024 resident cells. Triangle capacity equals emitted
count on all tested toolchains. Its existing waterline consumer reaches the
unchanged 65,536-segment cap; every byte in the combined 8,638,572-byte trace
matches the JS reference, inside the unchanged 16 MiB capture limit.

All eight original terrain/material SHA-256 gates are unchanged. Association
trace identity remains
`73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de`;
residency remains
`dd486e72228b6fa606d8c2419cb78bf7325871a5fc9d5329b84806e8416785cd`.
Original default/normal/triangle/waterline/indexed probe modes retain their
contracts. Only the explicit `--indexed-triangles` and `--indexed-waterline`
modes add this consumer path.

The combined unchanged road/material/random/spatial dependencies and terrain
suites pass 83/83 on GCC. Rebuilt height, normal, prefix-triangulation, waterline,
association, preset, residency, sparse-sample and addressed-topology native units
each pass 20/20 ASan + UBSan executions: 180 exits of 0, all stderr empty.
Build flags retain `-O1 -g -ffp-contract=off -fsanitize=address,undefined
-fno-omit-frame-pointer -no-pie` and strict warnings. No sanitizer options or
checks were disabled. The local receipt is
`build/terrain/addressed-sanitizer-20.json`; fixed layout retains the documented
[PIE startup isolation](060-conditioned-terrain-normals.md), not a claim that
ordinary PIE startup was fixed.

## Reproduce

```sh
node --test tests/js/vf-terrain-water-level-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_addressed_topology_test.cpp -o build/terrain/addressed
build/terrain/addressed
```

Clang uses identical flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
The existing `VKF_TERRAIN_PROBE`, `VKF_TERRAIN_ASSOCIATION_TEST` and
`VKF_TERRAIN_RESIDENCY_TEST` variables select separately rebuilt executables.

## Still separate

Sparse cache identity/residency, adaptive mixed-level stitching, projected error,
camera selection, continuous-field shoreline, sediment laws and rendering remain
separate work. No public syntax/API/schema/default, forest identity, performance,
naturalism or release-percentage claim changes.
