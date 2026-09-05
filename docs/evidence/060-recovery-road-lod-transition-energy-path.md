# 0.6 recovery — road LOD transition energy path

## Scope

- Base: `a25c3514280473474ab45a25925350aad94d7beb`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-transition-energy-path header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native energy-path audit consumes the committed road
LOD-transition-energy reference. It requires both path endpoints, rejects
backtracking and duplicate keyed materials, evaluates exact coverage-weighted
material energy at every progress sample, and reports deterministic per-frame
work, peak work, energy bounds, and passivity violations. Its exact test covers
the pinned five-frame path, complementary old/new LOD interpolation, material-
order independence, passive-energy bounds, and material-budget enforcement.

Both restored files are byte-identical to the preserved payload. No existing
transition-energy, transition-path, material-energy, renderer, or public
package implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed transition-energy and
  transition-path tests with `/std:c++20 /EHsc`; both executions passed (exit
  0), printing `private road LOD transition energy passed` and
  `private road LOD transition camera path passed` respectively.
- RED: with only the exact recovered energy-path test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_transition_energy_path.hpp` did not exist (exit
  1, 2.66 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.63 s); execution printed
  `private road LOD transition energy path passed` (exit 0, 37 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct transition-energy dependency recompiled successfully (exit 0,
  3.65 s) and executed with
  `private road LOD transition energy passed` (exit 0, 27 ms).
- The sibling transition camera-path audit recompiled successfully (exit 0,
  3.72 s) and executed with
  `private road LOD transition camera path passed` (exit 0, 52 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_transition_energy_path.hpp` | `d904ddf77c23235fcef7e5029ff627c3f6ae259c` | `B7A3C9425A871146DDCA6B25192EF8A332BB0F22363D8C67D5DAC9D6CD0803F5` |
| `native/material/vf_road_lod_transition_energy_path_test.cpp` | `a8be57e7ccc49fd961187d6e0168f86dcbd311d9` | `7378D2D565381BB42FC3F9C23AA4A8168AED63B8ABFF88A167A5FB69CAB23380` |

The live and preserved files have matching SHA-256 values. The temporary x64
energy-path executable is 294,400 bytes with SHA-256
`80EF460EA07562A7B2EF640C45108CE8F855D3BD8CFF12C012BE46200270DD9E`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 46 source files, leaving 44 native material source/test files.
The next dependency-safe vertical slice is the road LOD-material-pipeline
header/test pair; the independent road boundary chain and later hierarchical
road/stone chains remain separate packets.
