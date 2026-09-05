# 0.6 recovery — stone hierarchical material

## Scope

- Base: `ab96443955538d4a0c7232b477464dbe66803311`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone hierarchical-material header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native material combines the committed hierarchical
population with the shared road material-energy oracle. It samples only
demanded vertices and faces, maps their geometry to deterministic surface
coordinates, derives bounded spectral/RGB reflectance, roughness and
dielectric reflectivity, and evaluates passive Schlick energy probes. Foreign
geometry, unavailable or duplicate elements, invalid triangle indices, origin
positions, and exceeded sample budgets have explicit exceptions.

The exact recovered test pins three samples from 20 potential elements,
canonical output order, wavelengths and spectral/RGB mapping, material bounds,
zero white-furnace violations, shared-oracle energy, traversal independence,
seed sensitivity, and budget rejection. Both restored files are byte-identical
to the preserved payload. No existing population, material-energy, renderer,
public package, or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed hierarchical-population
  test with `/std:c++20 /EHsc` (exit 0, 4.01 s) and executed it with
  `hierarchical stone population: potential=1000000000 realized=3 vertices=18 faces=24`
  (exit 0, 34 ms). The committed road material-energy test also compiled (exit
  0, 3.10 s) and executed with
  `native road material energy parity passed` (exit 0, 22 ms).
- RED: with only the exact recovered hierarchical-material test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_hierarchical_material.hpp` did not exist (exit 2,
  2.26 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.93 s); execution printed
  `hierarchical stone material: potential=20 sampled=3 energy[min/max]=0.298652/1`
  (exit 0, 23 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The hierarchical-population dependency recompiled successfully (exit 0,
  3.36 s) and executed with
  `hierarchical stone population: potential=1000000000 realized=3 vertices=18 faces=24`
  (exit 0, 23 ms).
- The shared road material-energy dependency recompiled successfully (exit 0,
  3.20 s) and executed with
  `native road material energy parity passed` (exit 0, 24 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_hierarchical_material.hpp` | `8ff3d43345c1305c764f8ce0ed3a3d51397f286c` | `B2E16CF9F5A98BF41DC35B65479E9A2539020F6301F9FA515F7B455EBD0E5CCA` |
| `native/material/vf_stone_hierarchical_material_test.cpp` | `346057eca5e5a5d42e266d2597df8ffa60bcc259` | `0C289F94AC9E324431BB24E555AABDE3AED2E3A453650799ECEE3DA48BE67C33` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-material executable is 423,936 bytes with SHA-256
`E09009DFEFABBC04DE34CEA17EC67051A98C9CA95BA5EDD75C2C948068FCD7B2`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining eight source files, leaving six native material source/test
files, all in the stone chain. The next dependency-safe vertical slice is the
stone hierarchical-material-draw-packet header/test pair.
