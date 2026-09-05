# 0.6 recovery — road projected LOD

## Scope

- Base: `5f6ac1dc06bde2ae37ce2fa286d549aef2795c20`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road projected-LOD header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native reference is self-contained. It ranks visible
road cells by projected geometric/material error, computes the minimum bounded
detail level that satisfies the pixel-error policy, uses cell id as the exact
tie-break, and applies the configured cell budget after deterministic ordering.
Its exact test covers input-order independence, visibility/threshold exclusion,
budget truncation, and pinned selected levels and residual errors.

Both restored files are byte-identical to the preserved payload. No existing
road field, renderer, distribution, material-energy, or public package
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled and ran the committed
  `vf_road_material_energy_test.cpp` with `/std:c++20 /EHsc`; execution printed
  `native road material energy parity passed` (compile and run exit 0).
- RED: with only the exact recovered test present, MSVC compilation of
  `vf_road_projected_lod_test.cpp` failed with `C1083` because
  `native/material/vf_road_projected_lod.hpp` did not exist (exit 1, 3.9 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 4.8 s); execution printed `private road projected LOD selection passed`
  (exit 0, 41 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The adjacent committed native road-material-energy reference recompiled
  successfully (exit 0, 3.24 s) and executed with
  `native road material energy parity passed` (exit 0, 49 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_projected_lod.hpp` | `db43c6281f3caf98a07cfd9d54ea091fe9c0fb2c` | `B197067C33D6F6B5703063D58E87935701D2662C0052DC8C9CA0B4FE0D5D4DB4` |
| `native/material/vf_road_projected_lod_test.cpp` | `2b51d47a63b2a5525805715f2a4e4b824e1fca60` | `774791E8F8F6A15BD100F866BBD61AAFC2EAE7841A73869D2D01D5610DA8020C` |

`git diff --no-index` returned 0 for each live/recovery comparison. The
temporary projected-LOD x64 executable is 239,104 bytes with SHA-256
`4ED9C947817204966A5CD46FC0141E226D41C273DB5EDF0A155E80E832801056`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 58 source files, leaving 56 native material source/test files.
The next independent vertical slice is the road projected-working-set
header/test pair, which consumes this projected-LOD reference; the later road
transition and stone dependency chains remain separate packets.
