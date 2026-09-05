# 0.6 recovery — stone projected demand

## Scope

- Base: `ce2f75d2a77803b3c2c2fb12710cb58f12b84965`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-demand header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native selector consumes the committed stone refinement
batch. It validates camera projection and geometry, rejects duplicate coarse
faces and stones crossing the camera plane, computes projected midpoint error
and a conservative bound, identifies silhouette edges, and ranks visible faces
deterministically under the face budget. Its exact test pins demanded and
culled faces, candidate count, silhouette priority, JS-parity error values,
conservative acceptance thresholds, traversal independence, and diagonal-view
ranking.

Both restored files are byte-identical to the preserved payload. No existing
visible-demand selector, refinement batch, renderer, public package, or
language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed stone refinement-batch
  and visible-demand tests with `/std:c++20 /EHsc`; both executions passed
  (exit 0) with their exact expected messages.
- RED: with only the exact recovered projected-demand test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_projected_demand.hpp` did not exist (exit 1,
  2.75 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.81 s); execution printed
  `private native stone projected demand passed` (exit 0, 34 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct refinement-batch dependency recompiled successfully (exit 0,
  3.43 s) and executed with
  `private native stone refinement batch passed` (exit 0, 54 ms).
- The sibling visible-demand selector recompiled successfully (exit 0,
  3.36 s) and executed with
  `private native stone visible demand passed` (exit 0, 39 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_demand.hpp` | `5e225f904ed7354fa50a8a2cb0143f2fc1b60b17` | `E33AED0D38F637420501F7A09DD8760E98A3699067DE1263C626A22DE149DB6A` |
| `native/material/vf_stone_projected_demand_test.cpp` | `0846559171752f93b8a7bbb01375f6d4cac16e33` | `3F6FA152BDB665130FCE53E6A9F4035420CA3F53407E6E57A3E2DFB392406640` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-demand executable is 308,224 bytes with SHA-256
`5D85FB22BF4FF0652ABA16B889105702F720355A96CB50084A9AC101021ACC2C`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 24 source files, leaving 22 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-refinement header/test pair.
