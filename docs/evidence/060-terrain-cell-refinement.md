# Complete dyadic terrain child groups

2026-09-05; base `c35a4acb7adc7f8d92f95504995a84ed2c6a1bea`, branch `pre-gen`.

## Private deterministic mapping

`RefineTerrainCellDemandReference` preserves the caller's complete ordered parent
list. A parent at refinement `r`, grid column `x`, row `z` maps to refinement
`r+1` cells `(2x,2z)`, `(2x+1,2z)`, `(2x,2z+1)`, `(2x+1,2z+1)`, in that
row-major group order. The parent request and IDs remain retained alongside the
child request, cell list and existing sample plan.

Parent refinements 0–15 are supported. Conditions, tile and sample budget are
copied exactly; only child refinement increments. The existing cell planner
derives first-use unique corners. Existing sparse residency, normals/materials,
addressed topology and waterline consume the plan without a second field or
alternate renderer.

This is an explicit private mapping, not automatic quality selection. Four-child
group order and all-or-reject fit were approved before RED. It supplies no
mixed-level stitching, crack-free mixed-resolution mesh, geomorphing, camera
policy, projected error or continuous-field bound.

## Exact budgets and validation

The existing terrain-request validator runs first. Parent refinement 16 then
rejects with `terrain cell refinement requires level from 0 to 15`. Existing
cell/triangle/input caps validate next. Every requested parent is validated in
caller order: domain before duplicate, with unchanged existing diagnostics.

All parents must fit complete groups: four child cells and eight triangles per
parent. Insufficient fit rejects with `terrain cell refinement exceeds cell
budget` or `terrain cell refinement exceeds triangle budget`. Child sample fit
uses the existing planner diagnostic `terrain cell demand exceeds sample budget`.
No cap silently shortens the parent list or emits a partial group.

Parent validation and group-fit checks precede child-list allocation. Child
storage is bounded by the existing 65,536-cell cap; required samples are bounded
by the existing 65,536-sample cap. Returned vectors reserve exact counts on the
tested toolchains. Empty requests allocate no returned vectors and are not
reported as truncated. Previous sources and cache states remain unchanged.

## RED → GREEN

`build/terrain/44-terrain-cell-refinement-red.txt` records compiler exit 1 for the
absent refinement adapter. GREEN proves one parent produces the exact ordered
four-child group and the existing sparse producer preserves its coarse anchor.
Further regression coverage checks all 16 parent levels, explicit dyadic child
IDs, caller permutations, replay, seed changes, retained request identity,
zero/insufficient/full budgets, cap precedence and ordered malformed parents.

Every coarse corner in the selected fixtures is found at its exact even-coordinate
child address. Position, normal and material bytes match, using the same explicit
normal sampling distance and retained water level. Both seam axes preserve two
corners and the newly sampled midpoint. These are same-level shared-boundary
checks, not a claim that neighboring coarse/fine meshes are stitched.

The highest parent at refinement 15 reaches child ID 4,294,967,295 and sample ID
4,295,098,368 without truncating 64-bit identity. The full fixture maps 16,256
parents to 65,024 child cells, 65,535 required samples and 130,048 triangles.
One fewer cell, triangle or required sample rejects the whole request. The
downstream waterline retains the same sparse cache owner.

## Evidence

The 8,141,200-byte trace records both request identities, parent/child/sample
addresses, and the full fixture's exact surface/material/triangle/waterline
bytes. Replay SHA-256:

`1c9a287dc1713cf6f966c4d8f74ed678a468685a8fb80103179c28f98753bc2a`

The trace remains ignored build evidence within the unchanged 16 MiB capture
limit. GCC 12.2, Clang 22.0.0git and MSVC 19.44.35217 each pass all 38 affected
suites; their complete traces compare byte-for-byte. The combined unchanged
road/material/random/spatial dependencies and terrain suites pass 89/89 on GCC.
No old expected hash, diagnostic assertion, timeout, tolerance or acceptance
gate was weakened.

All eight original terrain/material hashes remain unchanged, as do the frozen
association, prefix-residency, sparse-residency and cell-planner traces. The old
prefix topology still rejects indexed layout with its exact diagnostic and
precedence.

All twelve affected native units were rebuilt with full ASan + UBSan and each
passed 20 executions: 240 exits of 0, every stderr empty. This includes height,
normals, prefix triangulation, waterline, association, presets, prefix residency,
sparse samples, addressed topology, sparse residency, the cell planner and
refinement.

Flags retain `-O1 -g -ffp-contract=off -fsanitize=address,undefined
-fno-omit-frame-pointer -no-pie` and strict warnings. No sanitizer options or
checks were disabled. The local receipt is
`build/terrain/cell-refinement-sanitizer-20.json`. Fixed layout preserves the
documented [PIE startup isolation](060-conditioned-terrain-normals.md); ordinary
PIE startup is not relabeled GREEN.

## Reproduce

```sh
node --test tests/js/vf-terrain-cell-refinement-native.test.mjs tests/js/vf-terrain-cell-demand-native.test.mjs tests/js/vf-terrain-sparse-residency-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_cell_refinement_test.cpp -o build/terrain/cell-refinement
build/terrain/cell-refinement --trace > build/terrain/cell-refinement.bin
sha256sum build/terrain/cell-refinement.bin
```

Clang uses identical flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_CELL_REFINEMENT_TEST` selects a separately rebuilt native test;
existing probe/planner/cache/association overrides remain unchanged.

## Still separate

Public authoring controls, forest identity, physical terrain/sediment laws,
general water, rendering and the camera/stitching/quality concerns above remain
separate. No public syntax/API/schema/default, naturalism, performance or
release-percentage claim changes.
