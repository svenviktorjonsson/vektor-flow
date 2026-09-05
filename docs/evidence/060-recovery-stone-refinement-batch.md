# 0.6 recovery — stone refinement batch

## Scope

- Base: `0f36871f4786efa0a76661c7eae8f6c6af379bd1`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone refinement-batch header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native batch reference consumes the committed stone face
refiner. It canonicalizes requested faces independent of vertex order, sorts
demands, rejects duplicates or unavailable faces, preflights aggregate vertex
and face budgets, and applies each refinement deterministically. Its exact test
covers demand-order independence, pinned vertex/face counts, closed edge
pairing, consistent winding, Euler characteristic, and batch-budget rejection.

Both restored files are byte-identical to the preserved payload. No existing
face refiner, coarse shape, renderer, public package, or language
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed stone face-refinement
  and coarse-shape tests with `/std:c++20 /EHsc`; both executions passed (exit
  0) with their exact expected messages.
- RED: with only the exact recovered refinement-batch test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_refinement_batch.hpp` did not exist (exit 1,
  2.47 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.18 s); execution printed
  `private native stone refinement batch passed` (exit 0, 48 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct face-refinement dependency recompiled successfully (exit 0,
  3.66 s) and executed with
  `private native stone face refinement passed` (exit 0, 26 ms).
- The coarse-shape root recompiled successfully (exit 0, 3.44 s) and executed
  with `private native coarse stone shape passed` (exit 0, 43 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_refinement_batch.hpp` | `8679bd3ebc6fe18f0842901ac52768411aebe0fe` | `ADA41A169E92136A7F7CFF9FA9581D53458DB67FE4CBB5822BCB73C5B35A7FC4` |
| `native/material/vf_stone_refinement_batch_test.cpp` | `db711f837711bca19e10830e3889b37c5d78c3cf` | `5B2F184C5F80BF7FD2B5F733DA3777A784EFFF01270CDC5F8D11039FB31E3F05` |

The live and preserved files have matching SHA-256 values. The temporary x64
batch executable is 265,728 bytes with SHA-256
`5C30579381E2E5B5B8E822A65994AF49BA73CF8D54AECF380F65C6DAE68F18F1`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 28 source files, leaving 26 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
visible-demand header/test pair; projected demand is an independent sibling
that also consumes this batch reference.
