# 0.6 recovery — stone coarse shape

## Scope

- Base: `0380c45e7cc740b8fca74a94f8fcb2f6256e4a2a`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact self-contained stone coarse-shape header/test pair from
  the preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native reference validates finite positive radii and
explicit vertex/face budgets, then emits a fixed six-vertex, eight-face
ellipsoidal octahedron. Its exact test pins positions and triangle winding,
proves every face is outward-oriented, verifies the twelve undirected edges
are each shared exactly twice with opposite directions, checks finiteness, and
exercises budget rejection. The pair is the dependency root for the remaining
stone refinement chain.

Both restored files are byte-identical to the preserved payload. No existing
road geometry, residency, renderer, public package, or language implementation
was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed road hierarchical-
  residency and road LOD-boundary tests with `/std:c++20 /EHsc`; both
  executions passed (exit 0) with their pinned reports.
- RED: with only the exact recovered coarse-shape test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_coarse_shape.hpp` did not exist (exit 1, 2.73 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.29 s); execution printed
  `private native coarse stone shape passed` (exit 0, 29 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The adjacent road LOD-boundary reference recompiled successfully (exit 0,
  3.20 s) and executed with
  `private road LOD boundary conformance passed` (exit 0, 30 ms).
- The latest road hierarchical-residency reference recompiled successfully
  (exit 0, 3.42 s) and executed with its exact deterministic residency report
  (exit 0, 27 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_coarse_shape.hpp` | `f79fe2dcad2a50ebd103f719afff9bda1f4e6ba2` | `B173E7D26668610F25E35ED8690691A4737CC70EFE37E745BF197988B65311A6` |
| `native/material/vf_stone_coarse_shape_test.cpp` | `c415991bdc122bf69d81132c1023baf2e5aaf944` | `848108CE9506359A27C01A8D31F4EB871E592F6B7C8B1B88485E2EFE2A9F566D` |

The live and preserved files have matching SHA-256 values. The temporary x64
coarse-shape executable is 241,664 bytes with SHA-256
`C63A090A28778CAB7AE4F2D904F966184A942E6532E84AAEFE2B36C18B5B0318`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 32 source files, leaving 30 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
face-refinement header/test pair, followed by refinement-batch dependents.
