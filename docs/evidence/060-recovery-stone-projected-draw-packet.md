# 0.6 recovery — stone projected draw packet

## Scope

- Base: `0841aa96b3a1adf0748e791d16498087ffbaebe1`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-draw-packet header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native adapter consumes the committed projected
refinement state. It packs each geometry position with its ellipsoid normal
and fixed material color, preserves triangle order in the index buffer,
reports the exact upload byte bound, and retains the existing packet with zero
upload when the refined geometry pointer is unchanged. Invalid normals and
triangle indices produce explicit native exceptions.

The exact recovered test pins refined and coarse vertex/index counts, upload
bounds, stable and traversal-independent packet retention, camera-driven
replacement, vertex layout, winding, and JS-parity values. Both restored files
are byte-identical to the preserved payload. No existing refinement, demand,
renderer, public package, or language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed projected-refinement
  test with `/std:c++20 /EHsc` (exit 0, 3.27 s) and executed it with
  `private native projected refinement passed` (exit 0, 22 ms). The committed
  projected-demand test also compiled (exit 0, 3.39 s) and executed with
  `private native stone projected demand passed` (exit 0, 30 ms).
- RED: with only the exact recovered projected-draw-packet test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_projected_draw_packet.hpp` did not exist (exit 2,
  2.44 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.26 s); execution printed
  `private native projected draw packet passed` (exit 0, 25 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-refinement dependency recompiled successfully (exit 0,
  3.31 s) and executed with
  `private native projected refinement passed` (exit 0, 23 ms).
- The transitive projected-demand dependency recompiled successfully (exit 0,
  3.31 s) and executed with
  `private native stone projected demand passed` (exit 0, 39 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_draw_packet.hpp` | `e85ac1fcf3f4b588b46fd5aeab031fd6c4815385` | `2AC235EFECB1F7823B698A7BADC2A6C6F85426F233C8315C9F826964EB2B9676` |
| `native/material/vf_stone_projected_draw_packet_test.cpp` | `cdf7877c829267da6eabaa0cd4633d712a42c4f1` | `929F94A39364FE5C06940FB0CC19BCF4F7544D1A04F0FD1AB7FD52E5670A97B3` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-draw-packet executable is 344,576 bytes with SHA-256
`018D08131E2B24B2DE148211B2D6328EDC0928F40C5A5FD3FCD54EE35E8A14D3`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 20 source files, leaving 18 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-draw-cache header/test pair.
