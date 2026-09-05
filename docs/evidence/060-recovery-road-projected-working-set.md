# 0.6 recovery — road projected working set

## Scope

- Base: `588b3968e8ddeb5c812ba02973252564523eba5e`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road projected-working-set header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native working-set reference consumes the committed
road projected-LOD selector. It maps deterministic LOD demands to immutable
packet identities, retains pointer identity for unchanged keys, reports exact
created/retained/evicted receipts, and discards storage after eviction. Its
exact test covers input-order independence, steady-state retention, camera
movement, complete release, and regeneration without stale storage.

Both restored files are byte-identical to the preserved payload. No existing
LOD, road field, renderer, material-energy, or public package implementation
was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-LOD and
  road-material-energy tests with `/std:c++20 /EHsc`; both executions passed
  (exit 0), printing `private road projected LOD selection passed` and
  `native road material energy parity passed` respectively.
- RED: with only the exact recovered working-set test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_projected_working_set.hpp` did not exist (exit 1,
  2.68 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.27 s); execution printed
  `private road projected working set passed` (exit 0, 46 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-LOD dependency recompiled successfully (exit 0,
  3.37 s) and executed with
  `private road projected LOD selection passed` (exit 0, 28 ms).
- The adjacent road-material-energy reference recompiled successfully (exit
  0, 3.28 s) and executed with
  `native road material energy parity passed` (exit 0, 32 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_projected_working_set.hpp` | `2de8be74a7a61064b86a0f96836c5c6d0d8e0d56` | `E0448074BE3BD7FE085CD3F3AF625650CDA3F53DD0BCC14B0D76380B09B587D0` |
| `native/material/vf_road_projected_working_set_test.cpp` | `02327009a45a8b2ec191ef3256bd33a9b1d87ff0` | `7F8734B127B046C7A90E232832277B4D00706BE90C4B02ADE76E03DBF0ED3ED2` |

The live and preserved files have matching SHA-256 values. The temporary x64
working-set executable is 265,728 bytes with SHA-256
`563714886F5B3F7D2BEE7044F12E53C538B31F41F312C77F6455953F7E1DFC46`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 56 source files, leaving 54 native material source/test files.
The next dependency-safe vertical slice is the road LOD-transition header/test
pair; later transition residency/path/energy/boundary and stone dependency
chains remain separate packets.
