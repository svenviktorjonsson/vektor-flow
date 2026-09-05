# 0.6 recovery — road LOD transition boundary

## Scope

- Base: `759bce39a398c682a031fafe7f67a49cd92da7af`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-transition-boundary header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native transition-boundary reference consumes the
committed road LOD-boundary reference. It requires unchanged edge locations
across transition orderings, independently conforms previous and current
boundaries, selects the finest shared lattice, and reports exact integer
strides for both source lattices. Its exact test covers pinned finest detail,
denominator, sample count, coarse-to-fine embedding, current-lattice identity,
cell/transition-order independence, and sample-budget rejection.

Both restored files are byte-identical to the preserved payload. No existing
boundary, coverage transition, LOD pipeline, renderer, or public package
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed LOD-boundary and LOD-
  coverage-transition tests with `/std:c++20 /EHsc`; both executions passed
  (exit 0), printing `private road LOD boundary conformance passed` and
  `private road LOD coverage transition passed` respectively.
- RED: with only the exact recovered transition-boundary test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_road_lod_transition_boundary.hpp` did not exist (exit 1,
  2.61 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.40 s); execution printed
  `private road LOD transition boundary passed` (exit 0, 31 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct LOD-boundary dependency recompiled successfully (exit 0, 3.41 s)
  and executed with `private road LOD boundary conformance passed` (exit 0,
  49 ms).
- The adjacent LOD-coverage transition recompiled successfully (exit 0,
  3.55 s) and executed with
  `private road LOD coverage transition passed` (exit 0, 32 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_transition_boundary.hpp` | `1fb81ab66626f771258129c422d3435abf7d904d` | `C7C9A235036C6AEC8B32294FCC08EEC8E22E84498F591289ADB3F13878B93464` |
| `native/material/vf_road_lod_transition_boundary_test.cpp` | `1c3ef0346d87aaa955603d6a3b25297e25aaace5` | `BF52CBEEB7EA545961B9D53F247710EC4F54DD68002DBEC07446CD57C64B3124` |

The live and preserved files have matching SHA-256 values. The temporary x64
transition-boundary executable is 233,984 bytes with SHA-256
`CFC04321F62BD834A28B0BEB45D08EEA67088E1A5271BCF875289AE234041422`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 40 source files, leaving 38 native material source/test files.
The next dependency-safe road slice is the hierarchical-field helper plus the
road hierarchical-material header/test that exercises it; the deterministic-
packet helper and road hierarchical-residency pair follow separately.
