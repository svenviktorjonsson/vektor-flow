# Measured foliage variants in forest draw packets

Date: 2026-09-05. Base: `9ff5651f533df13379441cbeb6adfb7d8126356a`.
Branch: `pre-gen`.

## Scope

This private composition joins the existing MAT010C measured leaf conditions
to the existing forest material pipeline and MAT070Y draw-packet adapter.
It changes no public VKF syntax, defaults, diagnostics, API, schema, ABI,
renderer, or existing producer implementation.

Each demand explicitly pairs a resident tree identity with an existing
`LeafSpeciesConditionV1`. Population species IDs are not interpreted as measured
species, remapped, or taken modulo nine. The existing leaf adapter changes only
foliage color; population, wood, bark, geometry, normals, opacity, roughness,
reflectivity, and hierarchy variation retain their existing meanings.

The [MAT010C receipt](060-mat010c-leaf-species-conditioning.md) owns measurement
provenance, licensing, uncertainty, and supported species. No new fit or
biological model is introduced. These are nine measured **leaf-material
variants**, not nine measured complete tree architectures.

## RED to GREEN

The new integration test initially failed with the missing
`native/material/vf_forest_leaf_species.hpp` header. The same strict command
passed after adding the composition helper:

```text
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -pedantic -I. native/material/vf_forest_leaf_species_test.cpp -o build/material-capture/forest-leaf-test
build/material-capture/forest-leaf-test
```

Observed output under both Linux Clang 22.0.0git and GCC 12.2.0:

```text
forest leaf species: variants=9 material_bytes=2664 draw_version=7876682727181603241
```

The test calls the real forest population and material producers, existing
measured leaf adapter, packet packer, energy validator, and draw adapter. It
proves:

- every conditioned foliage sample exactly matches its existing measured
  adapter result, and all nine fixture colors differ;
- wood, bark, population, positions, normals, alpha, indices, and material
  offsets are unchanged;
- foliage colors reach both material bytes and existing draw vertex colors;
- reversing demands yields the identical realization and draw packet;
- changing one explicit condition changes only one material bundle;
- existing passive-energy bounds hold; and
- unknown species, missing tree identity, duplicate identity, and exceeded
  demand budget preserve their exact existing exception messages.

## Full regression inventory

All 69 native material tests were attempted from this checkout with the same
strict Clang flags: **64 passed, 5 remained RED**. No acceptance gates changed.

| Existing test | Observed RED |
| --- | --- |
| `vf_forest_tree_large_scene_benchmark_test` | `forest benchmark path changed nondeterministically` |
| `vf_forest_tree_large_scene_path_test` | `large forest path version changed nondeterministically` |
| `vf_forest_tree_material_pack_test` | `forest material pack changed bounded output size` |
| `vf_forest_tree_material_realization_test` | `direct forest realization changed packet identity` |
| `vf_procedural_scene_native_frame_capture_test` | Preserved implementation header is missing |

The four forest failures include only unchanged baseline headers; none includes
the new composition helper. A build-only diagnostic of the pack assertion
found the expected 151,552 bytes and direct/oracle byte equality. Its actual
hash is `4259925755961605299`, versus the unchanged expected
`14970851967876841848`; both Clang and GCC reproduced this. The underlying
cross-checkpoint/platform cause is not yet established. The hashes were not
updated, and the complete material suite is not claimed GREEN.

The preserved frame-capture RED remains untouched. Its sparse stone/road
bindings do not define unsampled-surface shading or interpolation; this packet
does not invent those semantics or add a replacement renderer.

Exact compiler outputs and diagnostic copies are under
`build/material-capture/` only. No artifacts were placed outside the repository.
No performance claim is made from concurrently executed regression tests.

## Acceptance boundary

This closes native measured-foliage consumption through existing private forest
draw packets. It does not establish shared GPU rendering, final-frame parity,
public author controls, additional tree architectures, or release completion.
No release percentage is increased from this packet alone.

Next work is recorded in [the incremental nature plan](../plans/0.6-nature-next.md).

SHA-256:

| Source | Hash |
| --- | --- |
| `vf_forest_leaf_species.hpp` | `3FFDA7416D3AAA4D48319523933ED312D57F9750DC91B19C795806F8D8887367` |
| `vf_forest_leaf_species_test.cpp` | `0B52AFF8A600AB83AF8AEDE3FDCCC0ADF211C945EED73E0D8408A542CC47463F` |
