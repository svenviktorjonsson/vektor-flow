# 0.6 recovery — stone projected draw cache

## Scope

- Base: `6c2b93553f62dbd8e4feea3c7e946f8ab55a15f8`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-draw-cache header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native cache consumes the committed projected draw
packet. It keys entries by stone id, semantic source geometry, and projected
demand; deterministically refreshes least-recently-used order; regenerates
evicted camera variants exactly; removes stale source variants; enforces its
byte budget; and accumulates hits, uploads, evictions, uploaded bytes, resident
bytes, and peak residency.

The exact recovered test pins first insertion, semantic and traversal-stable
hits, LRU ordering and pressure, expired packet ownership, camera-variant
regeneration, stale-source replacement, accounting totals, and oversized
packet rejection. Both restored files are byte-identical to the preserved
payload. No existing draw-packet adapter, refinement, renderer, public package,
or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-draw-packet
  test with `/std:c++20 /EHsc` (exit 0, 4.24 s) and executed it with
  `private native projected draw packet passed` (exit 0, 26 ms). The committed
  projected-refinement test also compiled (exit 0, 3.41 s) and executed with
  `private native projected refinement passed` (exit 0, 27 ms).
- RED: with only the exact recovered projected-draw-cache test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_projected_draw_cache.hpp` did not exist (exit 2,
  2.33 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.57 s); execution printed
  `multi-stone cache benchmark: hits=3 uploads=7 evictions=6 bytes=3248 peak=928`
  (exit 0, 48 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-draw-packet dependency recompiled successfully (exit
  0, 3.59 s) and executed with
  `private native projected draw packet passed` (exit 0, 24 ms).
- The transitive projected-refinement dependency recompiled successfully
  (exit 0, 3.43 s) and executed with
  `private native projected refinement passed` (exit 0, 25 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_draw_cache.hpp` | `fb1481114bc40cdfb8d8625d41a78920f3948de1` | `C1C8C4C428DEA070A25BEE65EB7B91BD706B7AB76132EDA5073A818271817BA2` |
| `native/material/vf_stone_projected_draw_cache_test.cpp` | `c9f1ddc42848505786cf15322eb3ae897bc1ca22` | `19B16198FBC734CAFC059E778539F9DB8C4A172BF832A327BCF76A628C067610` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-draw-cache executable is 420,864 bytes with SHA-256
`3B03ED35F3B8F5B5321275D5F9981F460DD05097DDEEB78A518AB8E46712E45E`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 18 source files, leaving 16 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-draw-residency header/test pair.
