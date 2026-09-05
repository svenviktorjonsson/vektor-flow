# 0.6 recovery — stone projected refinement

## Scope

- Base: `44457a4eb7d781e47d4a4110fa73724b2418efc3`.
- Branch: `codex/0.6/060-mat070c-rough-polarization`.
- Restores the exact stone projected-refinement header/test pair from the
  preserved `027-060-mat070c-rough-polarization` untracked-source payload.
- No recovered executable or excluded build output was restored.
- No public VKF syntax, constructor, API, schema, ABI, package export,
  diagnostic, fixture, or 0.4/0.5 path changes.

## Dependency and API audit

The recovered private native updater consumes the committed stone projected
demand. It retains the geometry pointer when source geometry semantics and
demands are unchanged, canonicalizes source faces so traversal order does not
invalidate retention, rebuilds when camera demand changes, settles to coarse
geometry when the error threshold accepts it, and rejects retained geometry
when reduced budgets cannot contain it.

The exact recovered test pins selected demands and detail counts, first-build
versus stable-retention behavior, reordered-source retention, opposite-camera
rebuild, coarse settling and retention, and reduced-budget rejection. Both
restored files are byte-identical to the preserved payload. No existing
projected-demand selector, refinement batch, renderer, public package, or
language implementation was edited.

## RED / GREEN

- Baseline: MSVC 19.44.35217 x64 compiled the committed stone
  projected-demand test with `/std:c++20 /EHsc` (exit 0, 3.77 s) and executed
  it with `private native stone projected demand passed` (exit 0, 29 ms).
  The committed refinement-batch test also compiled (exit 0, 3.46 s) and
  executed with `private native stone refinement batch passed` (exit 0,
  26 ms).
- RED: with only the exact recovered projected-refinement test present, MSVC
  compilation failed with `C1083` because
  `native/material/vf_stone_projected_refinement.hpp` did not exist (exit 1,
  2.63 s).
- GREEN: after restoring the exact header, the same compilation passed (exit
  0, 3.55 s); execution printed
  `private native projected refinement passed` (exit 0, 37 ms).

All compiler object and executable outputs were directed to the temporary
directory outside the repository.

## Regression evidence

- The direct projected-demand dependency recompiled successfully (exit 0,
  3.67 s) and executed with
  `private native stone projected demand passed` (exit 0, 63 ms).
- The transitive refinement-batch dependency recompiled successfully (exit
  0, 3.68 s) and executed with
  `private native stone refinement batch passed` (exit 0, 29 ms).
- `git diff --check` is clean.

## Content identities

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `native/material/vf_stone_projected_refinement.hpp` | `a3b175f2e6203f9de2a3cd90bf1c02c0cfe4b091` | `1935ED1EC00A4A20A5443F1734EBFD16432B168D009B91CC29F1C3017F49B046` |
| `native/material/vf_stone_projected_refinement_test.cpp` | `41a0957211eddeeb51ed4909fd2b07a75083eb5b` | `63181C200027A8057F015EBD8698B655E03FCA79DEB23447A7A638AD6C27FA97` |

The live and preserved files have matching SHA-256 values. The temporary x64
projected-refinement executable is 329,216 bytes with SHA-256
`8C44067DDF2A8C352FAE710127D35B162A885B6DBAE933C58F56E106C0BDDF7C`;
it is outside the repository and is not part of recovery or this packet.

## Recovery boundary

The original recovery payload remains untouched. This packet reconciles two
of its remaining 22 source files, leaving 20 native material source/test files,
all in the stone chain. The next dependency-safe vertical slice is the stone
projected-draw-packet header/test pair.
