# 0.6 recovery — stone projected camera path

## Scope

- Base: `9794ee0ec228ada0108e6d6b2f4a693007d9bd3c`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-camera-path header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native report consumes the committed projected draw
cache. It runs a sequence of stone/camera steps, records bounded frame upload
and resident bytes, hashes packet contents deterministically, and returns the
final cache accounting. An empty camera path is rejected explicitly.

The exact recovered test pins ten moving-camera frames, upload and residency
bounds, semantic cache reuse, exact regeneration hashes after eviction,
distinct camera demand, aggregate cache totals, and equality of repeated
reports. Both restored files are byte-identical to the preserved payload. No
existing cache, draw-packet adapter, renderer, public package, or language
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-draw-cache
  test with `/std:c++20 /EHsc` (exit 0, 3.52 s) and executed it with
  `multi-stone cache benchmark: hits=3 uploads=7 evictions=6 bytes=3248 peak=928`
  (exit 0, 23 ms). The committed projected-draw-packet test also compiled
  (exit 0, 3.37 s) and executed with
  `private native projected draw packet passed` (exit 0, 36 ms).
- RED: with only the exact recovered projected-camera-path test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_projected_camera_path.hpp` did not exist (exit 2,
  2.27 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.59 s); execution printed
  `moving camera cache benchmark: frames=10 hits=2 uploads=8 bytes=3712 peak=928`
  (exit 0, 25 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-draw-cache dependency recompiled successfully (exit 0,
  3.39 s) and executed with
  `multi-stone cache benchmark: hits=3 uploads=7 evictions=6 bytes=3248 peak=928`
  (exit 0, 24 ms).
- The transitive projected-draw-packet dependency recompiled successfully
  (exit 0, 3.35 s) and executed with
  `private native projected draw packet passed` (exit 0, 23 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_camera_path.hpp` | `cc2b05af2993f972fed8fd3e6b8c06e328d0319a` | `00568E27E9BCDEA4F11FCAFEFAA0F293B1B5503F934ED74236470F4903E8489D` |
| `native/material/vf_stone_projected_camera_path_test.cpp` | `879c0b84916a26170e153f3a583cf39c597a0209` | `D42BA794CFC2E09268BE7E9F4611DCBFEBB0EBB62B1D0D73AA433CB148A6CEAB` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-camera-path executable is 422,912 bytes with SHA-256
`2D2080682761C4422162C7FDB81F2BE9B32FE7CA3E922F5111C5DCE02001488F`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 14 source files, leaving 12 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-large-scene header/test pair.
