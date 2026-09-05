# 0.6 recovery — road LOD transition residency

## Scope

- Base: `cd9bc5bd685d1b18597ebeaab640f3c1ffe2c189`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-transition-residency header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native residency reference consumes the committed road
LOD-transition and projected-working-set contracts. It validates working-set
shape, packet/key correspondence, key uniqueness, and stable packet identity;
then binds every transition-coverage entry to the exact resident packet. Its
exact test covers middle/start/finish residency, old/new/stable identity,
input-order independence, release timing, and bounded transition rejection.

Both restored files are byte-identical to the preserved payload. No existing
transition selector, working set, projected LOD, road renderer, or public
package implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed road LOD-transition
  test with `/std:c++20 /EHsc`; execution printed
  `private road LOD coverage transition passed` (compile and run exit 0;
  3.50 s and 28 ms).
- RED: with only the exact recovered residency test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_transition_residency.hpp` did not exist (exit
  1, 2.72 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.84 s); execution printed
  `private road LOD transition residency passed` (exit 0, 28 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct road LOD-transition dependency recompiled successfully (exit 0,
  3.43 s) and executed with
  `private road LOD coverage transition passed` (exit 0, 73 ms).
- The projected-working-set dependency recompiled successfully (exit 0,
  3.37 s) and executed with
  `private road projected working set passed` (exit 0, 29 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_transition_residency.hpp` | `aa7c392dfcbfa72fa4dd7ac8e09c8190afff8da5` | `BE95DB1B6BE7BED36F78A722885B4E8E5726ABC215ADDFF51624B0015F7A717D` |
| `native/material/vf_road_lod_transition_residency_test.cpp` | `02611c6130ca3195e60ee93fad4b430c27a10484` | `8883703101BB6122696D5B4AD97E48FC0279B735DF135BB63FE2C004C98EB853` |

The live and preserved files have matching SHA-256 values. The temporary x64
residency executable is 266,240 bytes with SHA-256
`7612715E4EF977D7EB5AB543284FB85D083E180B9688D758E34B91525078DF4C`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 52 source files, leaving 50 native material source/test files.
The next dependency-safe vertical slice is the road LOD-transition-path
header/test pair; later transition energy/boundary and stone dependency chains
remain separate packets.
