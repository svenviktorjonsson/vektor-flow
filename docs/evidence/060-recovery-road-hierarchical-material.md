# 0.6 recovery — road hierarchical material

## Scope

- Base: `8647d8f1c7265f1a6c2de81512c37244ee36c10a`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact shared hierarchical-field helper and road hierarchical-
  material header/test from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private shared helper provides deterministic keyed 2D field
sampling with finite-position and positive-correlation validation. The road
material reference composes population-, segment-, crack-, and aggregate-scale
variation over a potentially billion-by-billion surface while realizing only
explicit demands. It canonicalizes and rejects duplicate demands, enforces the
sample budget, derives bounded passive material samples, and evaluates the
committed road white-furnace model. Its exact test covers sparse realization,
hierarchical sharing/local variation, bounds, demand-order independence,
repeatability, seed identity, energy passivity, and budget rejection.

All three restored files are byte-identical to the preserved payload. No
existing material-energy, LOD pipeline, renderer, public package, or language
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed road material-energy
  and LOD-material-pipeline tests with `/std:c++20 /EHsc`; both executions
  passed (exit 0), printing `native road material energy parity passed` and
  `private road LOD material pipeline passed` respectively.
- RED 1: with only the exact recovered hierarchical-material test present,
  MSVC compilation failed with `C1083` because
  `native/material/vf_road_hierarchical_material.hpp` did not exist (exit 1,
  2.55 s).
- RED 2: after restoring the exact road header, compilation still failed with
  `C1083` because its exact dependency
  `native/material/vf_hierarchical_field_reference.hpp` did not exist (exit 1,
  2.97 s).
- GREEN: after restoring the exact shared helper, the same compilation passed
  (exit 0, 3.43 s); execution printed
  `hierarchical road material: potential_segments=1000000000 sampled=3 energy[min/max]=0.0807485/1`
  (exit 0, 29 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The road material-energy dependency recompiled successfully (exit 0,
  3.30 s) and executed with
  `native road material energy parity passed` (exit 0, 29 ms).
- The LOD-material pipeline recompiled successfully (exit 0, 3.57 s) and
  executed with `private road LOD material pipeline passed` (exit 0, 27 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_hierarchical_field_reference.hpp` | `9b0a0f9e90066dfce80df8dfe0267e05803b6aab` | `BDEE6A17AC453EB2549D40E7D8D97EC941AB00F4A7950BF949F87A194EC1169B` |
| `native/material/vf_road_hierarchical_material.hpp` | `884f08d414f116340fdd1f8375ed4153dd523c44` | `19E2FF5E98DC26111E82AD0811D5A1F9532903438BD084B2B6146ACE3CD1291B` |
| `native/material/vf_road_hierarchical_material_test.cpp` | `d4c91a1075af8fc11f1c56ab708d161a049a55c1` | `8910C75D24E11258E40C0D0867F42F3E9F62B5A34BFB25275DB54A5B9C362B52` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-material executable is 316,928 bytes with SHA-256
`5192C38D2388DC7EA057A7CBB6C08F7A571CA7408A90F07CB846DB4DE6E9AF47`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles three
of its remaining 38 source files, leaving 35 native material source/test files.
The next dependency-safe road slice is the deterministic-packet helper plus the
road hierarchical-residency header/test that exercises it; remaining stone
chains consume these shared helpers in later packets.
