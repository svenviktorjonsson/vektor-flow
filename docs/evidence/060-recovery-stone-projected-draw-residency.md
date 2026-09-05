# 0.6 recovery — stone projected draw residency

## Scope

- Base: `53fee44d5b74e8d678243688a9c506d0ed60ed83`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-draw-residency header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native residency updater composes the committed
projected refinement and draw-packet states. It retains stable packet storage,
counts cache hits without hidden uploads, replaces and releases stale packets
when the camera or detail level changes, and tracks upload, eviction, resident,
and peak-resident byte bounds.

The exact recovered test pins 256 stable detailed updates, traversal-order
independence, camera-driven replacement, coarse settling, another 256 stable
coarse updates, exact detail regeneration, expired packet ownership, and all
accounting totals. Both restored files are byte-identical to the preserved
payload. No existing draw-packet adapter, refinement, cache, renderer, public
package, or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-draw-packet
  test with `/std:c++20 /EHsc` (exit 0, 3.46 s) and executed it with
  `private native projected draw packet passed` (exit 0, 23 ms). The committed
  projected-refinement test also compiled (exit 0, 3.21 s) and executed with
  `private native projected refinement passed` (exit 0, 26 ms).
- RED: with only the exact recovered projected-draw-residency test present,
  MSVC compilation failed with `C1083` because
  `native/material/vf_stone_projected_draw_residency.hpp` did not exist (exit
  2, 2.29 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.34 s); execution printed
  `projected draw residency benchmark: hits=513 uploads=4 bytes=1728 peak=464`
  (exit 0, 49 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-draw-packet dependency recompiled successfully (exit
  0, 3.34 s) and executed with
  `private native projected draw packet passed` (exit 0, 23 ms).
- The transitive projected-refinement dependency recompiled successfully
  (exit 0, 3.52 s) and executed with
  `private native projected refinement passed` (exit 0, 33 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_draw_residency.hpp` | `3a5b2d6da57a7cfb22138deeb902f698b675badf` | `74271C2666E54DC51AFBD75D2CF03D9FEEFA42104D13C7C40432C1792960F09D` |
| `native/material/vf_stone_projected_draw_residency_test.cpp` | `9a47f967d9cdedf1b05596529d5a114a3f03f813` | `9DF00B0D71CC8842EFE1A10FB794153BF0916785E740422D932B815729DAB3C8` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-draw-residency executable is 403,456 bytes with SHA-256
`2B63893D58550D17697FA60D3CDBD76A4AE12E56665AAC931CC139C4C21EEA6C`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 16 source files, leaving 14 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-camera-path header/test pair.
