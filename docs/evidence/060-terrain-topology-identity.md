# Retained terrain cell and triangle identity

2026-09-06; base `a084e86f0e985aa91edb2699bff7731bebe7659b`, branch `pre-gen`.

## Private source-bound mapping

`BuildTerrainTopologyIdentityReference` delegates geometry production to the
existing addressed triangulator and retains its selected caller-ordered cell
prefix. Its private constructor prevents a caller from supplying a mismatched
cell list alongside an unrelated mesh. The resulting index owns the original
triangulation; field stream/scalar bits, tile, refinement, source vertices,
normals and materials remain reachable through that same owner.

`ResolveTerrainTriangleIdentityReference` maps an emitted triangle ordinal to
its cell ID, local face 0 or 1, and exact compact source vertex indices. It does
not regenerate triangles. The two faces remain the existing `[a,c,b]` and
`[b,c,d]` pair. A resolved record also owns the mesh, so it stays valid after the
index object leaves scope.

A cell/face pair is meaningful only with its retained field, tile and refinement.
It is not a new globally unique hash or serialized public key. Ordinals follow
caller demand order; source vertex indices follow source storage order. Those
may change under permutation while the contextual cell/face identity and
addressed vertices remain the same. Prefix and indexed layouts are consumed
explicitly through the existing addressed entry; the old prefix-only entry's
indexed-layout rejection is unchanged.

This is a private identity consumer for the MAT-020 shared-topology direction.
It adds no intersection, barycentric sampling, material interpretation,
renderer, camera, LOD or public API/schema/default behavior.

## Validation and bounds

The factory preserves the existing source-first validation and selected-prefix
rules: cell/triangle/input caps, then selected caller-order domain, residency
and duplicate checks. An invalid unselected suffix is not evaluated. A triangle
budget cannot emit half a cell. Zero selected cells retain source ownership,
allocate no cell-ID or triangle elements and preserve the existing truncation
flag. Empty demand is not truncated.

Cell-ID storage is allocated only after the underlying triangulator succeeds
and reserves exactly the emitted cell count on the tested toolchains. No
per-triangle identity array is retained. The resolver checks the ordinal before
indexing and rejects both the first out-of-range value and maximum `size_t` with
`terrain triangle ordinal exceeds emitted topology`.

The full fixture retains 65,024 cells over 65,536 reverse-ordered samples and
resolves all 130,048 emitted triangles. No old demand cap is increased. Source
buffers are not mutated. This is not a process-wide memory bound or an
authentication check for arbitrary externally authored field values.

## RED → GREEN

- `build/terrain/47-terrain-topology-identity-red.txt`: compiler exit 1 for the
  absent adapter. GREEN resolves one distant sparse cell to exact compact
  indices and retains its source.
- `build/terrain/48-terrain-topology-ordinal-red.txt`: exit 1 for the initially
  mismatched invalid-ordinal diagnostic. GREEN adds the exact explicit rejection
  before indexing; no unsafe out-of-bounds access is used for RED.

Further native regressions lock caller and source permutations, replay, retained
seed/scalar/tile/refinement identity, signed zero, prefix/indexed addressing,
full/empty/truncated budgets, ownership after index destruction, source-first
and selected-demand rejection order, highest cell ID 4,294,967,295 and highest
sample address 4,295,098,368.

The independent JS oracle derives every full-demand cell's row-major corners,
existing two-face winding and reverse-source indices. It compares every byte
of the native trace, including retained field/tile/refinement metadata. Replay
SHA-256 of the 3,121,212-byte trace:

`f124786fc405072ff2591e8b9773337881b5f7f37bae7604369ab0503fb364dc`

This remains ignored build evidence within the unchanged 16 MiB capture limit.

## Verified gates

GCC 12.2, Clang 22.0.0git and MSVC 19.44.35217 each pass all 47 affected tests,
including the same exact independent identity oracle. The combined unchanged
terrain/road/material/random/spatial dependencies pass 98/98 on GCC.

All original terrain/material, association, residency, planner and refinement
identities remain unchanged. The existing full refinement trace still compares
byte-for-byte across all three toolchains with SHA-256
`1c9a287dc1713cf6f966c4d8f74ed678a468685a8fb80103179c28f98753bc2a`.
The sampled-residual oracle remains GREEN. No existing production file, expected
hash, diagnostic assertion, timeout, tolerance or acceptance gate changes.

All fourteen affected native units were rebuilt with ASan + UBSan and passed
20 executions each: 280 exits of 0, every stderr empty. The units cover height,
normals, prefix triangulation, waterline, association, presets, prefix residency,
sparse samples, addressed topology, sparse residency, planning, refinement,
sampled residuals and the new identity consumer. The receipt is
`build/terrain/topology-identity-sanitizer-20.json`.

Flags retain `-O1 -g -ffp-contract=off -fsanitize=address,undefined
-fno-omit-frame-pointer -no-pie` and strict warnings. No sanitizer options or
checks were disabled. Fixed layout retains the documented
[PIE startup isolation](060-conditioned-terrain-normals.md); ordinary PIE startup
is not relabeled GREEN.

## Reproduce

```sh
node --test tests/js/vf-terrain-topology-identity-native.test.mjs tests/js/vf-terrain-refinement-residual-native.test.mjs tests/js/vf-terrain-cell-refinement-native.test.mjs tests/js/vf-terrain-cell-demand-native.test.mjs tests/js/vf-terrain-sparse-residency-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
g++ -std=c++20 -O2 -ffp-contract=off -Wall -Wextra -Werror -pedantic -I. native/material/vf_terrain_topology_identity_test.cpp -o build/terrain/topology-identity
build/terrain/topology-identity --trace > build/terrain/topology-identity.bin
sha256sum build/terrain/topology-identity.bin
```

Clang uses identical flags. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4 /WX`.
`VKF_TERRAIN_TOPOLOGY_IDENTITY_TEST` selects a separately rebuilt native test for
the same JS oracle. Existing dependency executable overrides remain unchanged.

Forest identity, physical terrain/sediment laws, general water, stitching,
renderer integration and quality policy remain separate. No performance,
naturalism or release-percentage claim is made.
