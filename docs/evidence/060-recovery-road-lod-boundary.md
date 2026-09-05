# 0.6 recovery — road LOD boundary

## Scope

- Base: `96953aee21a274025baf95213d7b29921baee62f`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-boundary header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native boundary reference is self-contained. It validates
bounded signed cell coordinates and detail levels, requires edge-adjacent road
cells, promotes the shared edge to the finer detail level, emits exact rational
sample numerators, and rejects an insufficient sample budget. Its exact test
covers cell-order independence, pinned denominator and sample count, exact
shared-edge coordinates, and budget enforcement.

Both restored files are byte-identical to the preserved payload. No existing
LOD selector, material pipeline, transition, renderer, or public package
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed LOD-material-pipeline
  and LOD-transition tests with `/std:c++20 /EHsc`; both executions passed
  (exit 0), printing `private road LOD material pipeline passed` and
  `private road LOD coverage transition passed` respectively.
- RED: with only the exact recovered boundary test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_boundary.hpp` did not exist (exit 1, 2.59 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.20 s); execution printed
  `private road LOD boundary conformance passed` (exit 0, 27 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The adjacent LOD-material pipeline recompiled successfully (exit 0, 3.53 s)
  and executed with `private road LOD material pipeline passed` (exit 0,
  57 ms).
- The adjacent LOD-coverage transition recompiled successfully (exit 0,
  3.52 s) and executed with
  `private road LOD coverage transition passed` (exit 0, 27 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_boundary.hpp` | `d85720baccffc046762302fb60147664a72c546d` | `721B059B1AD0AA3487C0224E897E8E37D95B31904A87B086AE59AEB73EEBCC9D` |
| `native/material/vf_road_lod_boundary_test.cpp` | `771ab89855e762573d2149f7c7a038b0a5c97a7c` | `1EB1E8CA8E7D20031618D7CC5E9DF4AA2BCE04B3420359B2DE30FD9A645BA670` |

The live and preserved files have matching SHA-256 values. The temporary x64
boundary executable is 231,936 bytes with SHA-256
`22451EB72BB2708DD323476745D86D8F726E035BF673F5C6C4FE378339FF6852`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 42 source files, leaving 40 native material source/test files.
The next dependency-safe vertical slice is the road LOD-transition-boundary
header/test pair; hierarchical road and stone chains remain separate later
packets.
