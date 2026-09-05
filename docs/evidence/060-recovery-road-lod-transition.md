# 0.6 recovery — road LOD transition

## Scope

- Base: `3606c259029c94a6999b8a44402c50b80b96545e`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-transition header/test pair from the preserved
  `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native transition reference consumes the committed road
projected-working-set packet keys. It canonicalizes input by cell, rejects
duplicate cells and invalid progress, assigns complementary old/new coverage,
preserves full coverage for retained keys, sorts output by packet key, and
rejects partial results when the entry budget is insufficient. Its exact test
covers input-order independence, removal, refinement, creation, retention,
coverage conservation, and the budget error.

Both restored files are byte-identical to the preserved payload. No existing
working-set, projected-LOD, road material, renderer, or public package
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-working-set
  test with `/std:c++20 /EHsc`; execution printed
  `private road projected working set passed` (compile and run exit 0; 3.41 s
  and 28 ms).
- RED: with only the exact recovered transition test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_transition.hpp` did not exist (exit 1, 2.55 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.43 s); execution printed
  `private road LOD coverage transition passed` (exit 0, 27 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-working-set dependency recompiled successfully (exit
  0, 3.52 s) and executed with
  `private road projected working set passed` (exit 0, 30 ms).
- The underlying projected-LOD selector recompiled successfully (exit 0,
  3.45 s) and executed with
  `private road projected LOD selection passed` (exit 0, 27 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_transition.hpp` | `ef29801a8c3a71a9a8977a8babea68b87ba3c00a` | `A527EE886C7E1A8A5957E21C457663D6C878C61D484D57F6210BF9373BE45C5F` |
| `native/material/vf_road_lod_transition_test.cpp` | `a56a0476b1a17f14b96f3bceede570842695360f` | `04AF08898DE7EF31D83FE8502CD69AE71D93CA68897C6F31C1D29D2F1A5DD244` |

The live and preserved files have matching SHA-256 values. The temporary x64
transition executable is 245,760 bytes with SHA-256
`1182C9AECF917CB0F8270A73ABC601105255A24D4E398C48F7A303A1DE1B949C`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 54 source files, leaving 52 native material source/test files.
The next dependency-safe vertical slice is the road LOD-transition-residency
header/test pair; later transition path/energy/boundary and stone dependency
chains remain separate packets.
