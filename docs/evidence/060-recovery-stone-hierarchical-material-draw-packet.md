# 0.6 recovery — stone hierarchical material draw packet

## Scope

- Base: `37b885d5acf22d5b8cb81ac8f551ccc62c122d01`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone hierarchical-material-draw-packet header/test pair
  from the preserved `027-060-mat070c-rough-polarization` untracked-source
  payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native adapter combines the committed hierarchical
material with projected draw geometry. It validates passive samples and energy,
packs canonical little-endian material records, retains stable geometry and
material packets, counts changed records, and charges only geometry plus
changed-record upload bytes. Missing geometry, over-realized or non-passive
material, and inconsistent energy have explicit exceptions.

The exact recovered test pins two demanded records, geometry ownership,
passivity, initial upload accounting, traversal-stable zero upload, one-record
material deltas with retained geometry, unchanged record bytes, deterministic
packet bytes and hash, and rejection of invalid energy. Both restored files
are byte-identical to the preserved payload. No existing hierarchical
material, projected draw packet, renderer, public package, or language
implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed hierarchical-material
  test with `/std:c++20 /EHsc` (exit 0, 3.73 s) and executed it with
  `hierarchical stone material: potential=20 sampled=3 energy[min/max]=0.298652/1`
  (exit 0, 25 ms). The committed projected-draw-packet test also compiled
  (exit 0, 3.66 s) and executed with
  `private native projected draw packet passed` (exit 0, 28 ms).
- RED: with only the exact recovered hierarchical-material-draw-packet test
  present, MSVC compilation failed with `C1083` because
  `native/material/vf_stone_hierarchical_material_draw_packet.hpp` did not
  exist (exit 2, 2.37 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.80 s); execution printed
  `hierarchical material draw packet: samples=2 bytes=106 stable_upload=0 delta_upload=53 hash=6565731993597997717`
  (exit 0, 34 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The hierarchical-material dependency recompiled successfully (exit 0,
  3.32 s) and executed with
  `hierarchical stone material: potential=20 sampled=3 energy[min/max]=0.298652/1`
  (exit 0, 23 ms).
- The projected-draw-packet dependency recompiled successfully (exit 0,
  3.34 s) and executed with
  `private native projected draw packet passed` (exit 0, 23 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_hierarchical_material_draw_packet.hpp` | `82b3cbd619abd32d513c507fd2ca39889c7d92a9` | `1286CF032B80E599803CEBCC98EB114AB395C62FBF150805295E97321B3C7710` |
| `native/material/vf_stone_hierarchical_material_draw_packet_test.cpp` | `a685f6cc9d828ef843698c729ad8ec4e2ce6fdaa` | `D2373C84ACA64C01A161C39F7A3DF5152C47E1A452323717C141ECE8D276FD96` |

The live and preserved files have matching SHA-256 values. The temporary x64
hierarchical-material-draw-packet executable is 446,976 bytes with SHA-256
`5FFA3A35A7D1AC0DB21CC8BF7F47CA32528D5F5B85DAB16673AE4CD72B8D5140`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining six source files, leaving four native material source/test
files, all in the stone chain. The next dependency-safe vertical slice is the
stone hierarchical-material-residency header/test pair.
