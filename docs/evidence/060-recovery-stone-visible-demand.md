# 0.6 recovery — stone visible demand

## Scope

- Base: `1ae90be1a473830da55646e5af9429ded7792dc1`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone visible-demand header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native selector consumes the committed stone refinement
batch. It validates finite camera coordinates and triangle indices, selects
front-facing coarse faces by exact oriented geometry, canonicalizes selection
order, and truncates deterministically to the face budget. Its exact test pins
the positive- and negative-X visible sets, proves triangle-traversal
independence, feeds the result through bounded refinement, verifies zero-budget
selection, and rejects a non-finite camera.

Both restored files are byte-identical to the preserved payload. No existing
refinement batch, face refiner, renderer, public package, or language
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed stone refinement-batch
  and face-refinement tests with `/std:c++20 /EHsc`; both executions passed
  (exit 0) with their exact expected messages.
- RED: with only the exact recovered visible-demand test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_visible_demand.hpp` did not exist (exit 1,
  3.30 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.47 s); execution printed
  `private native stone visible demand passed` (exit 0, 33 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct refinement-batch dependency recompiled successfully (exit 0,
  3.80 s) and executed with
  `private native stone refinement batch passed` (exit 0, 41 ms).
- The face-refinement dependency recompiled successfully (exit 0, 3.50 s) and
  executed with `private native stone face refinement passed` (exit 0, 59 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_visible_demand.hpp` | `26a3a2df10e264d85edf6b915f542dce66e6dffc` | `E4D71477886CE95B9ED869AC736F5990C7E47E9BBE4560BC2B07F3984BE8541C` |
| `native/material/vf_stone_visible_demand_test.cpp` | `5ff9d0e0d81b4bb75b135776d981cbb044881eac` | `58E52A5244C9EDE3532187F14CCAE2F5CCA3BA61C023AECBCDC559E2C2882F8A` |

The live and preserved files have matching SHA-256 values. The temporary x64
visible-demand executable is 265,728 bytes with SHA-256
`84786F2B70EE008C35A52A1F387F25D5D6E54FF7320E98556093EFC1AFDD4C57`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 26 source files, leaving 24 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-demand header/test pair, the independent sibling that also consumes
the committed refinement batch.
