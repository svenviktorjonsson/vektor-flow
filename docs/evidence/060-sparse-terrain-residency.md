# Ordered sparse terrain residency

2026-09-05; base `7225a335de011aa7567cad8d52841f868443bf6f`, branch `pre-gen`.

## Private existing-contract adapter

`UpdateTerrainSparseResidencyReference` retains the existing immutable
`TerrainResidencyState` and shared eviction/recency implementation. Its explicit
request supplies the existing terrain condition, tile, refinement, sample budget
and an ordered span of tile-grid sample IDs. Misses call the same sparse producer;
hits retain the exact source pointer. No second terrain generator is introduced.

Sparse identity includes every existing conditioned stream word and scalar bit,
tile, refinement, selected sample count, indexed layout and selected IDs in
order. Reordering selected IDs is a different compact buffer and therefore a
miss. An unselected suffix does not affect identity. Different sample budgets
that select the same complete demand share identity. Zero selected demand has
an empty ordered identity but still retains its condition, tile and refinement.

Prefix and indexed layouts cannot alias, even when all position bytes happen
to match. Both may coexist in the same bounded state. The original prefix
adapter, diagnostics, key behavior and frozen trace remain unchanged.

## Validation, ownership and budgets

The sparse producer and cache use one demand validator: existing tile/condition
checks, input cap, then selected IDs in order with domain before duplicate.
Residency entry cap, resident-sample cap and active-request fit follow. All
existing errors remain exact, including on a hit. Neither a hit nor rejected
request regenerates a source buffer. A miss is validated again by the existing
producer, as on the original prefix path.

The shared update kernel remains a private member of the opaque state. Only the
two validating adapters may create a state; callers cannot provide arbitrary
accounting, key matching or source factories. Prior states are immutable.

Least-recent non-active entries are evicted until both explicit budgets fit.
Only surviving entries and the active source are reserved. Bounds describe
logical residency in one state, not process memory when callers retain older
states. The sample count includes selected positions; indexed sources also own
one 64-bit address per selected position. No global allocator, byte budget or
GPU residency guarantee is added.

The existing 65,536 entry/sample caps are unchanged. Zero samples still occupy
one entry and allocate neither position nor address payload. The full-demand
fixture retains 65,536 positions and IDs out of 4,295,098,369 potential samples,
including ID 4,295,098,368, without allocating preceding rows.

## RED → GREEN

`build/terrain/40-terrain-sparse-residency-red.txt` captures the missing sparse
update adapter, compiler exit 1. GREEN proves sparse A → B → A regeneration
after eviction, exact ordered IDs/position bytes and repeated-request pointer
reuse. Shared validator/recency extraction then passed all 32 existing affected
terrain/material/residency suites before the new trace suite was added.

Further regression coverage proves ordered-ID misses, unselected suffix/effective
budget hits, mixed-layout separation, recency refresh, budget contraction,
every field-key change, signed zero, malformed demand precedence, immutable
rejection, zero/full allocation and release after the final old owner is dropped.
Two 64-step seeded trajectories match an explicit ordered recency-list oracle.
Every active source matches direct sparse producer position/ID bytes. A direct
normal/material → addressed-triangle → waterline chain retains the cached owner.

No expected hash, diagnostic, timeout, tolerance or acceptance gate was weakened.

## Verified gates

GCC 12.2, Clang 22.0.0git and MSVC 19.44.35217 each pass all 34 affected suites.
The addressed-topology native consumer was also rebuilt and passed on Clang and
MSVC. Clang and MSVC retained-state traces compare byte-for-byte with GCC.
The 2,196,592-byte sparse trace records every condition, layout, retained address,
recency entry and generated position in the fixtures. Replay and SHA-256 are:

`0562d7a5e716ee53ac52327397108870f7816e12f3bed2ea1975cb9e50c2a8f8`

This trace remains ignored build evidence inside the unchanged 16 MiB capture
limit. All eight original terrain/material hashes remain unchanged, as do the
association trace
`73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de`
and prefix residency trace
`dd486e72228b6fa606d8c2419cb78bf7325871a5fc9d5329b84806e8416785cd`.

The combined road/material/random/spatial dependencies and terrain suites pass
85/85 on GCC. All ten affected native units were rebuilt with full ASan + UBSan
and passed 20 executions each: 200 exits of 0, every stderr empty. This includes
height, normals, prefix triangulation, waterline, association, presets, prefix
residency, sparse samples, addressed topology and sparse residency.

Flags retain `-O1 -g -ffp-contract=off -fsanitize=address,undefined
-fno-omit-frame-pointer -no-pie` and strict warnings. No sanitizer options or
checks were disabled. The receipt is
`build/terrain/sparse-residency-sanitizer-20.json`. Fixed layout preserves the
documented [PIE startup isolation](060-conditioned-terrain-normals.md); ordinary
PIE startup is not relabeled GREEN.

## Reproduce

```sh
node --test tests/js/vf-terrain-sparse-residency-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_sparse_residency_test.cpp -o build/terrain/sparse-residency
build/terrain/sparse-residency --trace > build/terrain/sparse-residency.bin
sha256sum build/terrain/sparse-residency.bin
```

Clang uses identical flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_SPARSE_RESIDENCY_TEST` selects a separately built sparse cache test;
the existing probe/association/prefix-residency overrides remain unchanged.

## Still separate

Projected error, camera selection, adaptive mixed-level stitching, continuous
terrain/shore bounds, sediment laws, renderer behavior and public authoring
controls remain separate. No performance, naturalism, forest-identity or
release-percentage claim follows from these residency gates.
