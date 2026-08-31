# 050-I94 bootstrap source digest evidence

## Scope

- Base: `89e2572e38352a583794f64c24f846ebfaa0de9e`
- RED: `a068b05bc4306a4e5afb5e8288e249ef4cc45e62`
- Implementation: `0671c670f954bbaa4741335f249af2c847d547f6`
- Branch: `codex/0.5/050-i94-bootstrap-source-digest-integrity`

Five locked source digests were stale. I94 verifies every declared digest
against canonical LF-normalized source bytes, refreshes the stale values, and
verifies the bundle digest over the ordered `path + newline + source_sha256`
identities. This is host-line-ending independent and changes no schema or
public contract.

## TDD evidence

Focused RED failed on `typed_ir.vkf digest is stale`: 0 passed, 1 failed,
867.46 ms. After refreshing the five stale source identities and bundle
identity, the complete source-graph test passed 2/2 in 182.56 ms.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94. I94 commits are `a068b05`, `0671c67`, then this evidence
commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `vf-compiler-bootstrap.json`:
  `2C85F0C7CC581208D41071FD388501676CE03AB484906DAE1450791D9F2B2232`
- `stage1-bootstrap-source-graph.test.mjs`:
  `48678D9605DAE9CEDCF10D6A1CCBDE36819A6FD1B9D60396A9710EE972B794E3`

## Acceptance-gate impact

The locked Stage-1 source graph now has a test-enforced, reproducible identity
chain for all declared sources and the ordered bundle. It still does not build
a Stage-2 compiler; the next slice must make the bootstrap consumer reject a
tampered source before output, then begin replacing bundle placeholder
artifacts with executable compiler output.
