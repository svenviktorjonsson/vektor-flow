# 0.6 recovery — road hierarchical residency

## Scope

- Base: `23f3f74e6d45467b691096201b232ad3e4e67972`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact shared deterministic-packet helper and road hierarchical-
  residency header/test from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private shared helper provides explicit little-endian word/float
packing, deterministic FNV-style byte hashing, and record-granular change
counting with exact layout validation. The road residency reference consumes
the committed hierarchical road material, validates passive material before
packing, separates reusable coarse geometry from deterministic detail bytes,
retains identical packets without upload, repacks only changed detail records,
and accounts exact upload/resident bytes and packet versions. Its exact test
covers first residency, passive rejection, reversed-demand retention, one-
record delta, full segment replacement, exact regeneration, and fresh-build
determinism.

All three restored files are byte-identical to the preserved payload. No
existing hierarchical material, LOD residency, renderer, public package, or
language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed hierarchical-road-
  material and LOD-transition-residency tests with `/std:c++20 /EHsc`; both
  executions passed (exit 0).
- RED 1: with only the exact recovered hierarchical-residency test present,
  MSVC compilation failed with `C1083` because
  `native/material/vf_road_hierarchical_residency.hpp` did not exist (exit 1,
  2.55 s).
- RED 2: after restoring the exact road residency header, compilation still
  failed with `C1083` because its exact dependency
  `native/material/vf_deterministic_packet_reference.hpp` did not exist (exit
  1, 2.55 s).
- GREEN: after restoring the exact shared packet helper, the same compilation
  passed (exit 0, 3.53 s); execution printed
  `hierarchical road residency: samples=2 resident=192 stable_upload=0 detail_delta=60 segment_delta=192 version=10719266955414531121`
  (exit 0, 30 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The hierarchical-road-material dependency recompiled successfully (exit 0,
  3.58 s) and executed with its pinned sparse realization and energy report
  (exit 0, 30 ms).
- The adjacent LOD-transition-residency reference recompiled successfully
  (exit 0, 3.69 s) and executed with
  `private road LOD transition residency passed` (exit 0, 31 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_deterministic_packet_reference.hpp` | `563c59fab8a78bb65f742d82746a2f320dbde46e` | `26A4914F599F0B11FEE72A73083C9E3E49434062F75417AABE6F120178D0D399` |
| `native/material/vf_road_hierarchical_residency.hpp` | `0aaf44bc8479bb342ea98ae77f8c0d23e27105e9` | `FBDC3E1C2F01706389083ADBFAB7FDD45B4A52434454322D6BD13824C2CF7E84` |
| `native/material/vf_road_hierarchical_residency_test.cpp` | `38223cab2153c9b3fcdb02765700cd2e3590221c` | `5D9ABB3FE0A0BC20888355FD5D16AD52245597D56A9EE1E9754DCF14F688545A` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-residency executable is 342,528 bytes with SHA-256
`55244648A78658E30F6B2956773115229B20F47E4339296F5682EC522897CFEE`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles three
of its remaining 35 source files, leaving 32 native material source/test files.
All remaining recovery files are in the stone chain. The next dependency-safe
vertical slice is the self-contained stone coarse-shape header/test pair,
followed by face refinement and refinement-batch dependents.
