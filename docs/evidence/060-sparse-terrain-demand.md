# Explicit sparse terrain samples through the existing field

2026-09-05; base `dcdfbc500795311685adf8f8cab2aa38b32f73b4`, branch `pre-gen`.

## Private indexed layout

The existing terrain working set has an explicit private `row_prefix` or
`indexed` layout. The old producer remains `row_prefix`, allocating no sample-ID
buffer. Indexed demand retains the selected IDs in caller order, alongside the
same condition, tile, refinement, potential count and position data.

IDs are 64-bit row-major addresses in the full tile grid, not dense output
indices or standalone world-global identifiers. Tile and refinement remain part
of their identity. Four corners near grid coordinate `[50000,60000]` at
refinement 16 can now be sampled without realizing preceding rows.

There is one coordinate/evaluation kernel. Both entry adapters use the same
exact integer global numerator, dyadic division and existing conditioned height
field. No alternate terrain noise, mini-generator, material equation or normal
implementation was introduced. Existing normal and water-level material
consumers retain the indexed source and operate on its actual positions.

The `truncated` flag keeps its old meaning: not every potential tile sample is
resident. It is not redefined as unfulfilled explicit requests. A fully fulfilled
four-sample request in a large tile therefore still has this flag set.

## Demand, validation and unsupported topology

Input demand and output sample budget each cap at 65,536. After the existing
request validation, the demand-list cap is checked. Selected IDs then validate
in source order: domain before duplicate at each address. Only the selected
prefix is evaluated. Undemanded invalid or duplicate addresses do not run.
Selected IDs validate before position/ID storage is reserved; the duplicate
lookup is bounded and its iteration never determines output.

Indexed consumers reject unknown/misdeclared layout, mismatched ID count,
invalid grid identity, out-of-domain or duplicated IDs, and any position whose
X/Z bits differ from its retained dyadic address. Existing finite-position
errors retain precedence. The old prefix-only residency key cannot match an
indexed working set.

Prefix-only triangulation rejects indexed layout explicitly with
`terrain indexed samples require addressed topology`, before interpreting
positions as row-major storage. This is an intentional private unsupported
consumer boundary, not a renderer fallback. Addressed topology is a separate
next packet. Existing prefix outputs and error assertions remain unchanged.

## RED → GREEN

Captures under `build/terrain`:

| Capture | RED | GREEN |
| --- | --- | --- |
| `29-terrain-sparse-red.txt` | Indexed producer/layout absent | Four distant samples through shared kernel |
| `30-terrain-sparse-domain-red.txt` | Out-of-tile address accepted | Exact domain rejection |
| `31-terrain-sparse-duplicate-red.txt` | Duplicate selected ID accepted | Exact ordered duplicate rejection |
| `32-terrain-sparse-cap-red.txt` | Oversized input accepted at zero output demand | Exact input cap |
| `33-terrain-sparse-layout-red.txt` | ID count did not align with positions | Source-layout validation |
| `34-terrain-sparse-position-red.txt` | Swapped IDs accepted for unchanged coordinates | Exact ID/position alignment |
| `35-terrain-sparse-cache-red.txt` | Sparse samples matched a prefix key | Explicit layout in cache comparison |
| `36-terrain-sparse-probe-red.txt` | Direct indexed probe mode absent | Existing JS field differential |

Each RED exited 1. No old golden, tolerance, timeout, error assertion or
acceptance gate was relaxed. The shared kernel passed the original twenty-three
terrain/material/residency gates before the new differential coverage expanded.

## Verified gates

| Gate | Result |
| --- | --- |
| GCC 12.2 complete sparse and old prefix/material/residency byte suites | 27/27 GREEN |
| Clang 22.0.0git same suites | 27/27 GREEN |
| MSVC 19.44.35217 same suites | 27/27 GREEN |
| Combined unchanged road/random/spatial dependencies and terrain | 78/78 GREEN |
| Native sparse seam/refinement/malformed-source/full-demand tests, all three compilers | GREEN |
| Rebuilt height/normal/triangulation/waterline/association/preset/residency/sparse units, full GCC ASan + UBSan | 20/20 each clean |

The existing JS spatial reference compares every position, normal, material ID,
retained sample ID, count and flag. Coverage includes two seeds, replay,
permuted demand, water-level changes, sparse-to-prefix byte equality, zero and
limited budgets, and exact ordered rejection with no partial output.
Native tests prove both shared-edge axes, identical coarse refinement anchors,
source ownership, corrupt layout rejection and explicit topology rejection.

The maximum fixture realizes 65,536 non-prefix diagonal samples out of
4,295,098,369 potential samples, starting with ID 4,295,098,368 (above uint32).
Position and ID vector capacities equal the selected count on all three tested
toolchains. Its full normal/material/address probe output is 3,932,184 bytes,
inside the unchanged 16 MiB capture limit. Zero demand reserves neither vector.

All eight original terrain/material SHA-256 gates remain unchanged, as do the
association trace `73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de`
and residency trace `dd486e72228b6fa606d8c2419cb78bf7325871a5fc9d5329b84806e8416785cd`.
All original default, normal, triangle and waterline probe modes retain their
bytes. Only explicit `--indexed` adds the retained-address trailer.

## Reproduce

```sh
node --test tests/js/vf-terrain-water-level-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_sparse_demand_test.cpp -o build/terrain/sparse
build/terrain/sparse
```

Clang uses identical flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
The existing `VKF_TERRAIN_PROBE`, `VKF_TERRAIN_ASSOCIATION_TEST` and
`VKF_TERRAIN_RESIDENCY_TEST` variables select separately rebuilt executables.

All eight native units were rebuilt with
`-O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -no-pie`
and strict warnings, then executed twenty times each. All 160 runs exited 0
with empty stderr. No sanitizer options or checks were disabled. The local
receipt is `build/terrain/sparse-sanitizer-20.json`. Fixed layout retains the
documented [PIE startup isolation](060-conditioned-terrain-normals.md); ordinary
PIE instability is not relabeled GREEN.

## Still separate

Addressed cell topology, sparse cache identity/residency, adaptive mixed-level
stitching, projected error, camera selection, sediment laws and rendering are
not supplied by this packet. No public syntax/API/schema/default, forest
identity, performance, naturalism or release-percentage claim is changed.
