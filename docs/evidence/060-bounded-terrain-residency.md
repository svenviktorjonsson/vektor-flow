# Bounded logical residency for existing terrain tiles

2026-09-05; base `861d764d17c5c42b99b9452da357af13bd6c3325`, branch `pre-gen`.

## Existing-contract consumer

This private consumer implements the terrain regeneration/residency step of
[MAT-020](../plans/0.6.0.md) and the [nature foundation](../plans/0.6-nature-next.md).
It consumes the unchanged terrain producer. It adds no terrain field, camera
selection, renderer, material equation or public control.

Each request specifies the existing condition, tile, refinement and sample
budget. Identity compares all conditioned stream words, exact double bits for
correlation length/mean/amplitude, tile coordinates, refinement and effective
resident sample count. Signed zeros remain distinct condition identities.
Different requested budgets producing the same effective count share identity.

Entries are ordered least-to-most recently used. A hit retains the exact tile
pointer and refreshes recency. A miss uses the existing producer. The oldest
non-active entries are evicted until both explicit budgets fit. The eviction
prefix is calculated before allocating the next entry vector; only surviving
entries and the active tile are reserved. No potential sample grid is allocated.

The entry and resident-sample budgets each accept at most 65,536. A request that
cannot fit as the active tile is rejected, including zero entry budget.
Zero-sample tiles still occupy one entry. A hit still performs the producer's
existing two-point domain validation; it does not regenerate its sample buffer.

`TerrainResidencyState` has a private constructor and immutable members. Only
the update function creates states, so callers cannot forge cache accounting or
replace source owners. Prior states remain unchanged after updates or errors.
An evicted tile is released when no retained prior state or other caller owns it.

These are **logical per-state** entry/sample bounds, not process-wide memory
bounds. Callers may retain older immutable states and their buffers. There is
no global allocator, GPU residency, upload-byte or peak-process-memory claim.

## RED → GREEN

1. The A → B → A test failed to compile because the residency consumer was
   absent (`build/terrain/27-terrain-residency-red.txt`, exit 1).
2. A residency entry budget above the hard cap was accepted. Exact cap
   validation made `28-terrain-residency-cap-red.txt` GREEN (behavioral RED exit 1).

The producer's request validation was extracted with all twenty-one existing
terrain/waterline/material byte tests GREEN. Coordinate generation, source-order
errors and all old source hashes are unchanged. Invalid requests are validated
before residency entry cap, residency sample cap, and active-request fit.
No acceptance gate, diagnostic assertion, tolerance or timeout was weakened.

## Verified gates

| Gate | Result |
| --- | --- |
| GCC 12.2 residency and existing terrain/material exact-byte suites | 23/23 GREEN |
| Clang 22.0.0git same suites | 23/23 GREEN |
| MSVC 19.44.35217 same suites | 23/23 GREEN |
| Combined unchanged road/random/spatial dependencies and terrain | 74/74 GREEN |
| Rebuilt height/normal/triangulation/waterline/association/preset/residency units, full GCC ASan + UBSan | 20/20 each clean |

Native integration proves A → B → A byte-identical regeneration after eviction,
exact hit pointer reuse, deterministic recency, sample-budget contraction,
condition/stream/tile/refinement/count misses, signed-zero keys, effective-count
alias hits, immutable rejection, and release after prior ownership is dropped.
Two 64-step seeded trajectories match an independent explicit recency-list
oracle; every active tile matches the unchanged direct producer bit-for-bit.
Existing normal/material consumers retain the cached source pointer and preserve
classification through eviction and regeneration.

The full-demand fixture represents 4,295,098,369 potential samples while retaining
65,536 positions. Its state contains one entry; its position payload is 1,572,864
bytes. Empty tiles reserve no positions. The trajectory exercises bounded
recency at small budgets; it does not claim exhaustive filling of 65,536 entries.

The canonical state trace contains exact key words, flags, recency order and
every resident position for the captured fixtures. GCC and Clang compare
byte-for-byte; all three toolchains pass the same replay and SHA-256 gate:

`dd486e72228b6fa606d8c2419cb78bf7325871a5fc9d5329b84806e8416785cd`

The 2,340,528-byte trace remains ignored build evidence, within the unchanged
16 MiB capture limit. All eight original terrain/material hashes and the
association trace `73ce596f838d9f3e9208df9dfb79da4be67af550e5f65238ff0e3a30dc0ed6de`
remain unchanged. No existing forest, stone, road or material identity changes.

## Reproduce

```sh
node --test tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_residency_test.cpp -o build/terrain/residency
build/terrain/residency --trace > build/terrain/residency.bin
sha256sum build/terrain/residency.bin
```

Clang uses the same flags; MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_RESIDENCY_TEST`, `VKF_TERRAIN_ASSOCIATION_TEST` and `VKF_TERRAIN_PROBE`
select separately compiled executables for cross-toolchain checking.

All seven native units were rebuilt with
`-O1 -g -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer -no-pie`
and strict warning/error flags, then executed twenty times each. All 140 runs
exited 0 with empty stderr. No sanitizer options or checks were disabled.
The local receipt is `build/terrain/residency-sanitizer-20.json`. Fixed layout
retains the documented [PIE startup isolation](060-conditioned-terrain-normals.md);
ordinary PIE instability is not relabeled GREEN.

## Outside this packet

Projected error, camera demand, terrain/sediment laws, mixed-level stitching,
GPU uploads, renderer behavior, public schemas/defaults and forest identity
remain separate. No performance, naturalism, visual quality or release-percentage
claim follows from the cache tests.
