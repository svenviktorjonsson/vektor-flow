# 0.6 recovery — stone hierarchical camera path

## Scope

- Base: `87def3a8f666960946de294fdb9fa080579deb02`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone hierarchical-camera-path header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native camera-path updater consumes the committed
hierarchical material residency. It realizes only visible population members,
canonicalizes member and material-demand traversal, refines and packs demanded
content, retains semantic versions across stable frames, charges bounded
camera-change uploads, checks passive energy, and hashes each frame
deterministically. Empty visibility, duplicate identities, and exceeded member
budgets have explicit exceptions.

The exact recovered test pins two realized identities from a potential billion,
geometry and material counts, first-frame residency, canonical frame hash,
stable and traversal-independent zero uploads, bounded moved-camera deltas,
passive energy, exact regeneration, and fresh-run determinism. Both restored
files are byte-identical to the preserved payload. No existing residency,
material draw packet, renderer, public package, or language implementation was
edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed hierarchical-material
  residency test with `/std:c++20 /EHsc` (exit 0, 3.41 s) and executed it with
  `combined stone residency: hits=2 uploads=4 evictions=3 resident=570 version=17193349899520853817`
  (exit 0, 31 ms). The committed material-draw-packet test also compiled (exit
  0, 3.51 s) and executed with
  `hierarchical material draw packet: samples=2 bytes=106 stable_upload=0 delta_upload=53 hash=6565731993597997717`
  (exit 0, 24 ms).
- RED: with only the exact recovered hierarchical-camera-path test present,
  MSVC compilation failed with `C1083` because
  `native/material/vf_stone_hierarchical_camera_path.hpp` did not exist (exit
  2, 2.18 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 4.26 s); execution printed
  `hierarchical camera path: potential=1000000000 realized=2 first_upload=1140 stable_upload=0 moved_upload=1034 hash=12071396023394362807`
  (exit 0, 24 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct hierarchical-material-residency dependency recompiled
  successfully (exit 0, 4.01 s) and executed with
  `combined stone residency: hits=2 uploads=4 evictions=3 resident=570 version=17193349899520853817`
  (exit 0, 33 ms).
- The transitive hierarchical-material-draw-packet dependency recompiled
  successfully (exit 0, 3.81 s) and executed with
  `hierarchical material draw packet: samples=2 bytes=106 stable_upload=0 delta_upload=53 hash=6565731993597997717`
  (exit 0, 27 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_hierarchical_camera_path.hpp` | `8282d0740f62ac8ebd906434a57981b69aa0cc18` | `A2354C0C12689CB05D303AE6C33629B736D05A63819EFD14364CB2D727FD83F5` |
| `native/material/vf_stone_hierarchical_camera_path_test.cpp` | `a1b60ef7c31d598399f383d699f5f63a92ae64c5` | `B6A207F383DD29575E2D1E5FCE40CDD1173AD3E3F140522BE6EB085C4581F6C6` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-camera-path executable is 458,752 bytes with SHA-256
`8477E0E600928D181584EA69009E3937A6CEC145E52545B2128D0C9C47F6B30E`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles its
final two source files. A complete SHA-256 inventory audit found all 72
preserved source files present in the isolated worktree, with zero missing and
zero differing files. This final packet remains unstaged pending root review
and integration.
