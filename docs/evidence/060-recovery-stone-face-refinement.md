# 0.6 recovery — stone face refinement

## Scope

- Base: `a9a98c78c216a6edee2545641172244b3c801171`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone face-refinement header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native reference consumes the committed stone coarse
shape. It validates the target face and shape budgets, rejects invalid triangle
indices and degenerate coarse faces, projects a new center onto the ellipsoid,
and deterministically replaces one triangle with three outward-oriented
children. Its exact test pins vertex/face counts, center position, child
indices, closed edge pairing, consistent winding, Euler characteristic, and
budget rejection.

Both restored files are byte-identical to the preserved payload. No existing
coarse-shape, road boundary, renderer, public package, or language
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed stone coarse-shape and
  road LOD-transition-boundary tests with `/std:c++20 /EHsc`; both executions
  passed (exit 0) with their exact expected messages.
- RED: with only the exact recovered face-refinement test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_face_refinement.hpp` did not exist (exit 1,
  2.48 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.47 s); execution printed
  `private native stone face refinement passed` (exit 0, 29 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct stone coarse-shape dependency recompiled successfully (exit 0,
  3.38 s) and executed with
  `private native coarse stone shape passed` (exit 0, 32 ms).
- The adjacent road LOD-transition-boundary reference recompiled successfully
  (exit 0, 3.29 s) and executed with
  `private road LOD transition boundary passed` (exit 0, 63 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_face_refinement.hpp` | `ee2bda7dda8f1b15e6228bd16dc2e00b8d41f637` | `B60450250C608FBED7E27F973A7D192111694365F7473783AF3B5330E0E72000` |
| `native/material/vf_stone_face_refinement_test.cpp` | `a2a474fcb1a97ddc0274a9f2275e5d4e226528d2` | `6CB6233E088D3567884C9D9D2C26D5B282A82FF247A2C23AAD536D9996BA27E3` |

The live and preserved files have matching SHA-256 values. The temporary x64
face-refinement executable is 251,392 bytes with SHA-256
`D35CB81DC934F39442862C1CD321D2346B169539493F68513F6D3E9E90AE6C8D`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 30 source files, leaving 28 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
refinement-batch header/test pair; visible and projected demand dependents
follow separately.
