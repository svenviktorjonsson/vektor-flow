# 0.6 recovery — stone hierarchical population

## Scope

- Base: `d8b9d0dfe240aab5234177f2b0a4be54275fdc28`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone hierarchical-population header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native population realizes only demanded members from a
seeded potential population. It sorts demands deterministically, separates
low-frequency population variation from instance variation, derives bounded
coarse geometry and local surface roughness, and feeds the committed projected
refinement path. Empty populations, duplicate or out-of-range members,
non-finite positions, and exceeded member budgets have explicit exceptions.

The exact recovered test pins three realized members from a potential billion,
source-order independence, seed identity, spatial coherence and variation,
radius and surface bounds, coarse-shape counts, projected refinement, lazy
distant-member realization, and budget rejection. Both restored files are
byte-identical to the preserved payload. No existing refinement, coarse-shape,
renderer, public package, or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed
  projected-refinement test with `/std:c++20 /EHsc` (exit 0, 3.71 s) and
  executed it with `private native projected refinement passed` (exit 0,
  25 ms). The committed coarse-shape test also compiled (exit 0, 3.20 s) and
  executed with `private native coarse stone shape passed` (exit 0, 23 ms).
- RED: with only the exact recovered hierarchical-population test present,
  MSVC compilation failed with `C1083` because
  `native/material/vf_stone_hierarchical_population.hpp` did not exist (exit
  2, 2.37 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.31 s); execution printed
  `hierarchical stone population: potential=1000000000 realized=3 vertices=18 faces=24`
  (exit 0, 43 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-refinement dependency recompiled successfully (exit 0,
  3.16 s) and executed with
  `private native projected refinement passed` (exit 0, 23 ms).
- The transitive coarse-shape dependency recompiled successfully (exit 0,
  3.16 s) and executed with
  `private native coarse stone shape passed` (exit 0, 24 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_hierarchical_population.hpp` | `50cdada56dcbec2cba1c6d8e08b74610fbca06ca` | `10A75173CE28DF1D2F3E87278466AE364E792728271D623FA815C0185D7F7772` |
| `native/material/vf_stone_hierarchical_population_test.cpp` | `4dd2707d01103748ecabcba6b973aa3e85325c3e` | `9FA62B1E43DCFA14FBD1ABC41A53CB9B0CA7940C28FAE12B8828B870583025B5` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-population executable is 404,480 bytes with SHA-256
`A79AA6B2771903B3AE6B4E86D1B67034F4889EA7DFDBDA76D251CC841E267BC2`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 10 source files, leaving eight native material source/test
files, all in the stone chain. The next dependency-safe vertical slice is the
stone hierarchical-material header/test pair.
