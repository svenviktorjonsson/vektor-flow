# 0.6 recovery — stone projected large scene

## Scope

- Base: `fb1b1fabfc8d7c3cc7ca0ba134141b61ec7f7e69`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-large-scene header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native report consumes the committed projected camera
path and draw cache. It audits every stone across every camera frame, records
per-frame hits, uploads, upload and resident bytes, hashes the scene
deterministically, and reports per-item, full-frame, and moving-frame upload
bounds. Empty stone or camera inputs are rejected explicitly.

The exact recovered test pins 128 stones across nine camera frames, first-frame
materialization, partial forward LOD transitions, zero-upload return frames,
cache and packet upload bounds, symmetric scene hashes, and equality across
five reports. Wall time is printed as observed run data only; no performance
acceptance threshold or claim is introduced. Both restored files are
byte-identical to the preserved payload. No existing camera-path, cache,
renderer, public package, or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-camera-path
  test with `/std:c++20 /EHsc` (exit 0, 3.92 s) and executed it with
  `moving camera cache benchmark: frames=10 hits=2 uploads=8 bytes=3712 peak=928`
  (exit 0, 42 ms). The committed projected-draw-cache test also compiled (exit
  0, 3.45 s) and executed with
  `multi-stone cache benchmark: hits=3 uploads=7 evictions=6 bytes=3248 peak=928`
  (exit 0, 34 ms).
- RED: with only the exact recovered projected-large-scene test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_projected_large_scene.hpp` did not exist (exit 2,
  2.48 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 4.10 s); execution passed (exit 0, 1.084 s) with this measured output:

  `large-scene benchmark: stones=128 frames=9 updates=1152 wall_us[min/median/max]=206715/210968/213946 max_frame_upload=52608 peak_resident=57984`

  `frame uploads: 128/52608 4/1344 4/1344 4/1344 4/1344 0/0 0/0 0/0 0/0`

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-camera-path dependency recompiled successfully (exit
  0, 3.46 s) and executed with
  `moving camera cache benchmark: frames=10 hits=2 uploads=8 bytes=3712 peak=928`
  (exit 0, 31 ms).
- The transitive projected-draw-cache dependency recompiled successfully (exit
  0, 3.49 s) and executed with
  `multi-stone cache benchmark: hits=3 uploads=7 evictions=6 bytes=3248 peak=928`
  (exit 0, 24 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_large_scene.hpp` | `7543b2b517badc3b728bea27e294f9944dc04204` | `A09E56C97F3E081703F797F1214A89051ED549D600F7F3F03FF0C5E6DD91FB4F` |
| `native/material/vf_stone_projected_large_scene_test.cpp` | `b55c483a958048915868b756f28400ffb40e22ec` | `DB06C03E9B00B22F04413AC6C594512A6A9332928FB87209EFDBB0BE3E1E246B` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-large-scene executable is 436,736 bytes with SHA-256
`E5483AEB7C4688BB8FA7861398E5A7B0C55CEBFE7980F81C12612906DF7FA3AC`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 12 source files, leaving 10 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
hierarchical-population header/test pair.
