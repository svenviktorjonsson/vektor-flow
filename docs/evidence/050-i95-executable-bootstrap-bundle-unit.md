# 050-I95 executable bootstrap bundle unit evidence

## Scope

- Base: `ecb947ef7e537bf0716957547960a809e614cfeb`
- Build target: `9eff194a2ce569a62a4c987bf8c9250fbd51a71a`
- RED: `a5ca8b755598a5cc0b7e15c24db9e380c6bdf47e`
- Test isolation: `f5a6c012ed70551fbafc1d6f99c0782cf8878c81`
- Implementation: `256badd65cda17754dea6d7eef6609b6ece550e7`
- Branch: `codex/0.5/050-i95-executable-bootstrap-bundle-unit`

I95 is the first bounded Stage-1 to Stage-2 executable tracer. The bootstrap
bundle tool now compiles one declared compiler-source unit through the existing
strict compiler contract with deterministic optimizer policy `mask-0`. On
Windows it emits a PE executable instead of the former comment-only `.cmd`
placeholder. The emitted unit is executed by the acceptance test and must exit
successfully without output. No CLI, manifest schema, language syntax, or other
public contract changed.

## TDD evidence

The intended RED reached the old bundle pipeline and failed because its output
was `bundle.artifact.cmd`, not an executable. Earlier environment-only setup
failures (missing sibling tools and Windows path length) are excluded from the
RED evidence. The test copies the exact branch `compiler.vkf` into isolated
scratch space so it cannot observe another dirty worktree.

After implementation and source-digest refresh, the focused acceptance command
passed 3/3 in 1177.28 ms:

- executable compiler-source unit: 938.86 ms;
- bootstrap source dependency order: 4.15 ms;
- canonical source and ordered bundle digests: 19.66 ms.

The emitted artifact starts with `MZ`, executes with exit code zero, and writes
neither stdout nor stderr.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95. I95 commits are `9eff194`, `a5ca8b7`, `f5a6c01`,
`256badd`, then this evidence commit. Do not merge or reset the original dirty
I84 worktree.

## Contract hashes

- `vkf_bootstrap_bundle_artifact_smoke.cpp`:
  `DDAB13FA20FCE21FB4721406757896683C801542BBE120DE896FE328C47B429D`
- `compiler.vkf`:
  `0F339F869364EFD7C967B04620B14389B01E5A8A8CFD8DC8FC7578D3A82E359D`
- `vf-compiler-bootstrap.json`:
  `972BBAD80BD6AD7FE3951AF5E84AE87BCA4874ED6A865552817F7EF0EA364EBF`
- `stage1-bootstrap-executable-bundle-unit.test.mjs`:
  `F4FD676D15C2173767E95FA1890649247243AB8EDF441F02E8CEC0A9D6C9722B`
- built `vkf_bootstrap_bundle_artifact_smoke.exe`:
  `B725E51D3831CE29184EADD3CCF40FBB9816F172A60DB0929687495FE5F70349`
- built `vkf-strict.exe`:
  `9C9A8BFE9C7AF5C0C94B5B84BC77B5395C826C173A17D63F11DF227E263CC462`

## Acceptance-gate impact

The bootstrap path now produces and executes a real compiler-source machine
artifact, and the obsolete placeholder emitter is gone. This does not yet
constitute a complete Stage-2 compiler bundle. Direct strict compilation of
`lexer.vkf` currently fails with `machine IR block result layout mismatch`;
other probed units (`parser.vkf`, `typed_ir.vkf`, `machine_ir.vkf`, and
`compiler.vkf`) compile. The next dependency-ordered packet should close that
lexer block-result-layout lowering gap, then expand this tracer to the ordered
bundle.
