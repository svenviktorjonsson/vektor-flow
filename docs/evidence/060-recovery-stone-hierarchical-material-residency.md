# 0.6 recovery — stone hierarchical material residency

## Scope

- Base: `afa22523cf8f8fa5fcd8fdbfbe33be00782b641c`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone hierarchical-material-residency header/test pair
  from the preserved `027-060-mat070c-rough-polarization` untracked-source
  payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native residency cache consumes the committed combined
material draw packet. It validates geometry/material pairing, hashes a
deterministic combined version, finds semantic hits, retains least-recently-used
entries within its byte budget, charges material-record deltas separately from
geometry replacement, and tracks upload, eviction, resident, and peak bytes.
Stale versions and exceeded packet budgets have explicit exceptions.

The exact recovered test pins initial combined residency, canonical version,
semantic hits across independent packets and demand traversal, a 53-byte
material delta with stable geometry, deterministic version eviction, stale-pair
rejection, geometry replacement, exact regeneration, and aggregate residency
bounds. Both restored files are byte-identical to the preserved payload. No
existing material draw packet, hierarchical material, renderer, public package,
or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed hierarchical-material
  draw-packet test with `/std:c++20 /EHsc` (exit 0, 3.57 s) and executed it
  with `hierarchical material draw packet: samples=2 bytes=106 stable_upload=0 delta_upload=53 hash=6565731993597997717`
  (exit 0, 31 ms). The committed hierarchical-material test also compiled
  (exit 0, 3.81 s) and executed with
  `hierarchical stone material: potential=20 sampled=3 energy[min/max]=0.298652/1`
  (exit 0, 27 ms).
- RED: with only the exact recovered hierarchical-material-residency test
  present, MSVC compilation failed with `C1083` because
  `native/material/vf_stone_hierarchical_material_residency.hpp` did not exist
  (exit 2, 2.55 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.57 s); execution printed
  `combined stone residency: hits=2 uploads=4 evictions=3 resident=570 version=17193349899520853817`
  (exit 0, 22 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The hierarchical-material-draw-packet dependency recompiled successfully
  (exit 0, 3.54 s) and executed with
  `hierarchical material draw packet: samples=2 bytes=106 stable_upload=0 delta_upload=53 hash=6565731993597997717`
  (exit 0, 25 ms).
- The hierarchical-material dependency recompiled successfully (exit 0,
  3.38 s) and executed with
  `hierarchical stone material: potential=20 sampled=3 energy[min/max]=0.298652/1`
  (exit 0, 24 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_hierarchical_material_residency.hpp` | `d8849c8d38bbbf8a8085af4ec5a2eafd77259de3` | `99313DCAAB894D2E0174522707E87D8A246D4414C58FE51B1720E9325CA2534D` |
| `native/material/vf_stone_hierarchical_material_residency_test.cpp` | `4c03f429e42c3990acf5fa9226b0c39ea40dc8a0` | `44048A6C927DDB332A455FAD562C55A33257C2CC0E5507AD076193DC784BB1E6` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-material-residency executable is 465,408 bytes with SHA-256
`3B1BD4BEF3C123D524583FE05D9BC166B0C8632DD0DA899F53799E1DE95314E1`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining four source files, leaving only the stone
hierarchical-camera-path header/test pair.
