# 0.6 recovery — road LOD transition energy

## Scope

- Base: `2448bd3940e3d642fff8d23e89e11d6d8e8b7a05`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact road LOD-transition-energy header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native energy reference joins the committed road LOD-
coverage transition and road material-energy references. It canonicalizes
covered materials by packet key, rejects invalid or duplicate coverage and
per-cell coverage above one, enforces a material-evaluation budget, evaluates
the existing white-furnace model once per transition entry, and accumulates
coverage-weighted energy per cell. Its exact test covers input-order
independence, pinned output shape and work, passive-energy bounds, complementary
old/new LOD energy, and budget rejection.

Both restored files are byte-identical to the preserved payload. Their private
`vf::material` transition and `vkf::material` material-energy namespace usage
matches the recovered sources exactly. No existing transition, material-
energy, renderer, or public package implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed LOD-transition and
  material-energy tests with `/std:c++20 /EHsc`; both executions passed (exit
  0), printing `private road LOD coverage transition passed` and
  `native road material energy parity passed` respectively.
- RED: with only the exact recovered energy test present, MSVC compilation
  failed with `C1083` because
  `native/material/vf_road_lod_transition_energy.hpp` did not exist (exit 1,
  2.71 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 4.17 s); execution printed
  `private road LOD transition energy passed` (exit 0, 27 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The LOD-coverage transition input recompiled successfully (exit 0, 3.43 s)
  and executed with `private road LOD coverage transition passed` (exit 0,
  34 ms).
- The road material-energy input recompiled successfully (exit 0, 3.28 s) and
  executed with `native road material energy parity passed` (exit 0, 29 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_road_lod_transition_energy.hpp` | `a581570b687726c5b470a5770a9b424d4cd27d8f` | `C39037DB3329153EDF84B6A0224A954201C46F2E622183ED0AAEA8A62D26CBF7` |
| `native/material/vf_road_lod_transition_energy_test.cpp` | `19cf121f8bc7cb585d7606701d693ec456be0729` | `073541F3BF03354550FD187654F600B316E696C2DB356359F7CAF72990E0AB48` |

The live and preserved files have matching SHA-256 values. The temporary x64
energy executable is 278,016 bytes with SHA-256
`AA966760FC63E02AAC9BDB5C0691949944BE42A66B5A942FCEF3FC8CB465F988`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 48 source files, leaving 46 native material source/test files.
The next dependency-safe vertical slice is the road LOD-transition-energy-path
header/test pair; road boundary and stone dependency chains remain separate
later packets.
