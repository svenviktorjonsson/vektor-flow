# 050-I93 bootstrap source graph evidence

## Scope

- Base: `d2f67a5e4e81bbb05e40aa04d548f1de165d32b7`
- RED: `ba94a184875ed8f4ed5b7c306846c1c9be3924e1`
- Implementation: `1adc9d9bad07733b8d0fdcea521c8170dfbf17b7`
- Branch: `codex/0.5/050-i93-bootstrap-source-graph-integrity`

The locked bootstrap graph omitted `machine_ir_validation.vkf`, even though
strict Stage-1 dispatch executes it. I93 adds that source immediately after
`machine_ir.vkf`, increments the source count, and refreshes the bundle digest
using the manifest's existing ordered `path + newline + source_sha256` rule.
No manifest schema or public contract changed.

## TDD evidence

```powershell
node --test tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- RED: 0 passed, 1 failed, 393.72 ms; `Machine IR validator is missing`.
- GREEN: 1 passed, 0 failed, 412.01 ms.

The test also proves `sources`, `source_order`, and `source_count` agree and
that the compiler follows the validator in dependency order.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93. I93 commits are `ba94a18`, `1adc9d9`, then this evidence commit.
Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `vf-compiler-bootstrap.json`:
  `120D4B2448DDEF199FC44D47BA83B9590C56A88B9DCA3105853811DCF6FC4C8E`
- `stage1-bootstrap-source-graph.test.mjs`:
  `4AFA3BCE907E04D737DFAC0E795181AC36C168FCD7ED6457B0548DFBC2972C31`

## Acceptance-gate impact

The locked bootstrap graph now names the source-owned Machine IR validator it
actually depends on. The separate source-digest freshness and bundle-digest
verification slice remains open before a reproducible Stage-1 rebuild can be
claimed.

Next packet: verify every declared source digest against canonical Git bytes
and verify the ordered bundle digest.
