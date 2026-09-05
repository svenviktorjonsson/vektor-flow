# 0.6 recovery — road LOD transition path

## Scope

- Base: `ea241db88cb730aa45297aee047621d204763917`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-transition-path header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native path audit consumes the committed transition-
residency reference. It requires both path endpoints, rejects backtracking,
evaluates residency at every progress sample, and reports deterministic
resident counts, peak residency, and settled residency. Its exact test covers
the pinned five-step camera path, input-order independence, endpoint settling,
backtracking rejection, and resident-budget enforcement.

Both restored files are byte-identical to the preserved payload. No existing
transition residency, coverage transition, working set, road renderer, or
public package implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed transition-residency
  test with `/std:c++20 /EHsc`; execution printed
  `private road LOD transition residency passed` (compile and run exit 0;
  3.73 s and 34 ms).
- RED: with only the exact recovered path test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_transition_path.hpp` did not exist (exit 1,
  2.84 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.55 s); execution printed
  `private road LOD transition camera path passed` (exit 0, 41 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct transition-residency dependency recompiled successfully (exit 0,
  3.75 s) and executed with
  `private road LOD transition residency passed` (exit 0, 27 ms).
- The underlying LOD-coverage transition recompiled successfully (exit 0,
  3.55 s) and executed with
  `private road LOD coverage transition passed` (exit 0, 26 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_transition_path.hpp` | `c3bc51135316e6e7e1e6af2b526d448d8de9da1b` | `73EF07B4A9E2167F55A344D38F36EE0E76088261A271B4233CF04412E9D231AD` |
| `native/material/vf_road_lod_transition_path_test.cpp` | `a32e500f565ecaee480de09bb5939bb34fb22281` | `85E52825345DD9B76D1930CC44B63B584897E88F1B7FB00C27F64172A1D36430` |

The live and preserved files have matching SHA-256 values. The temporary x64
path executable is 273,920 bytes with SHA-256
`779B2E303CF91CF90C7312F776C27FF441F1C5ECA9EDD87E5F82605D6FCFDEB6`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 50 source files, leaving 48 native material source/test files.
The next dependency-safe vertical slice is the road LOD-transition-energy
header/test pair, which joins the committed transition and material-energy
references; its energy-path dependent remains a later packet.
