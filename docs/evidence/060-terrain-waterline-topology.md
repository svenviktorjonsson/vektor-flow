# Stable topology identity for emitted waterline segments

2026-09-06; base `e433871f34dc1ee4455e5790fc996baee3a0fbd1`, branch `pre-gen`.

## Private retained provenance

The existing waterline extraction now retains one segment-parallel triangle
ordinal. It is the ordinal of the first emitted triangle that produces each
unique segment. Duplicate suppression therefore retains the earlier emitter;
truncated and zero-budget results retain only the provenance corresponding to
published segments. Provenance capacity is bounded by the unchanged 65,536
segment budget.

Extraction still uses the single existing kernel. No intersection predicate,
endpoint ordering, interpolation operation, duplicate key, validation order,
diagnostic, segment byte, truncation rule, or output serialization changed.

`ResolveTerrainWaterlineSegmentIdentityReference` accepts only a waterline and
topology index that share the exact retained triangulation owner. It resolves
the retained triangle ordinal through the existing topology identity adapter,
returning the original cell ID, local face and compact source indices without
regenerating geometry or copying source buffers.

This is private MAT-020 provenance. It adds no sediment or material
interpolation, general water, renderer behavior, public API/schema/default, or
release-percentage claim.

## RED -> GREEN

The new native consumer test first failed to compile because
`TerrainWaterline::triangle_ordinals` and
`ResolveTerrainWaterlineSegmentIdentityReference` did not exist. The compiler
exited 1 without an executable.

GREEN covers replay, bounded prefix and zero demand, maximum segment ordinal,
mismatched topology ownership, and source lifetime. An explicit addressed-cell
fixture makes both local faces emit the same on-level edge; the unique segment
retains triangle ordinal 0 and resolves to the cell's local face 0.

No existing test, expected hash, diagnostic assertion, timeout, tolerance or
acceptance condition was changed.

## Verified gates

| Gate | Result |
| --- | --- |
| GCC 12.2 affected terrain/topology/waterline matrix | 48/48 GREEN |
| Clang 22.0.0git same matrix | 48/48 GREEN |
| MSVC 19.44.35217 `/fp:strict` same matrix | 48/48 GREEN |
| GCC combined terrain/road/material/random/spatial dependencies | 99/99 GREEN |
| GCC ASan + UBSan, 15 affected native units, 20 executions each | 300/300 clean |

The affected matrices retain the independent 3,121,212-byte topology identity
oracle and every old waterline/terrain byte oracle. The combined gate retains
all original terrain/material hashes, including
`e1c0539a8261acd4b6032b19a40492a139af315e64956a0ab3af791d231807e6`,
and the refinement identity
`1c9a287dc1713cf6f966c4d8f74ed678a468685a8fb80103179c28f98753bc2a`.

Sanitizers used `-O1 -g -ffp-contract=off
-fsanitize=address,undefined -fno-omit-frame-pointer -no-pie` with strict
warnings. All 300 executions exited 0 with no sanitizer output. Fixed layout
retains the documented PIE startup isolation; ordinary PIE startup is not
relabeled GREEN.

## Reproduce

```sh
node --test tests/js/vf-terrain-waterline-topology-native.test.mjs tests/js/vf-terrain-topology-identity-native.test.mjs tests/js/vf-terrain-refinement-residual-native.test.mjs tests/js/vf-terrain-cell-refinement-native.test.mjs tests/js/vf-terrain-cell-demand-native.test.mjs tests/js/vf-terrain-sparse-residency-native.test.mjs tests/js/vf-terrain-residency-native.test.mjs tests/js/vf-terrain-material-association-native.test.mjs tests/js/vf-terrain-water-level-native.test.mjs
```

GCC and Clang use `-std=c++20 -O2 -ffp-contract=off -Wall -Wextra
-Werror -pedantic -I.`. MSVC uses `/std:c++20 /O2 /EHsc /fp:strict /W4
/WX /I.`. `VKF_TERRAIN_WATERLINE_TOPOLOGY_TEST` selects a separately
rebuilt native consumer for the same JS gate.
