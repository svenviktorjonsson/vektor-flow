# 0.6 recovery — road LOD material pipeline

## Scope

- Base: `a00f13b2bfab79b21c527d843eb99e2d50073e51`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-material-pipeline header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native material pipeline joins the committed road
projected-LOD selector and road material-energy reference. It rejects duplicate
cell ids, selects only demanded cells under the existing LOD policy, evaluates
material energy only for those selected cells, and preserves deterministic
demand ordering. Its exact test covers candidate-order independence, bounded
material work, exact selected cell ids and sample count, passive energy, and
pinned Fresnel values.

Both restored files are byte-identical to the preserved payload. No existing
projected-LOD, material-energy, transition, renderer, or public package
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-LOD and road
  material-energy tests with `/std:c++20 /EHsc`; both executions passed (exit
  0), printing `private road projected LOD selection passed` and
  `native road material energy parity passed` respectively.
- RED: with only the exact recovered pipeline test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_material_pipeline.hpp` did not exist (exit 1,
  2.61 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.90 s); execution printed
  `private road LOD material pipeline passed` (exit 0, 39 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The projected-LOD dependency recompiled successfully (exit 0, 3.46 s) and
  executed with `private road projected LOD selection passed` (exit 0, 26 ms).
- The road material-energy dependency recompiled successfully (exit 0,
  3.44 s) and executed with
  `native road material energy parity passed` (exit 0, 26 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_material_pipeline.hpp` | `bbfd4a8e63a6def2a705447e95dc83c0681b3ef5` | `FFD5C7EBD43AD8FE6D7DE84358E28AE74D4FAE463DB494DF3E0EC6F5EB97AE8D` |
| `native/material/vf_road_lod_material_pipeline_test.cpp` | `6f3a47e71700a3fd9e4133af3635d5d02b8d78cd` | `E53EE62ACA7FC0FD8C43127B848D2B8BDCD90251855AE4D7C1563E1FE0D47530` |

The live and preserved files have matching SHA-256 values. The temporary x64
pipeline executable is 269,312 bytes with SHA-256
`9838937ABC99FB99F5C5C4608B0A1A80855A7538E323D11BC92E4DA9575640D5`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 44 source files, leaving 42 native material source/test files.
The next dependency-safe vertical slice is the self-contained road LOD-boundary
header/test pair, followed by its transition-boundary dependent; hierarchical
road and stone chains remain separate later packets.
