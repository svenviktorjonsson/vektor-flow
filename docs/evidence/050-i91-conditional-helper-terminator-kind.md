# 050-I91 conditional helper terminator evidence

## Scope

- Base: `dc70b99d5868c96f58498b043d4aca080abea3ad`
- RED: `4309003002e3008194c527cf90a12eb23b9e097b`
- Implementation: `af264fb36458e1eb1350deb43038ffcd2ca18e3e`
- Branch: `codex/0.5/050-i91-conditional-helper-terminator-kind`

A stack-equivalent `store_local` could replace the fixed conditional
CPU-count helper's `return_f64` while satisfying terminal stack balance. I91
requires the helper to end in `return_f64`. No public contract changed.

## TDD and affected verification

Verification used I83 strict compiler SHA-256
`BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`.
Scratch data stayed inside the repository. The first GREEN attempt crossed the
Windows path limit in the longer I91 worktree before compilation and is
excluded; the rerun used the repository's shorter `.work` directory.

- Focused RED: 0 passed, 1 failed, 2,405.90 ms;
  `unterminated fixed-conditional helper produced output`.
- Focused GREEN: 1 passed, 0 failed, 5,401.41 ms.
- Serial Stage-1 validation/dispatch matrix: 57 passed, 0 failed,
  333,878.68 ms.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91.
I91 commits are `4309003`, `af264fb`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

- `machine_ir_validation.vkf`:
  `56A7166FFEC361BACE6BCC21B42FF5CEB09ACF5985F6FDF05FC96E0B65BDA73E`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `9D352EB49BB03A56E56F179949467DA09A919DB15FBB45AE9E3ADE57FCDF937A`

## Acceptance-gate impact

The bounded conditional validator now structurally proves its entry, helper,
branch, then-arm, and false-arm terminators. This closes its currently bounded
terminator-kind slice. General CFG and Stage 2/Stage 3 fixed-point gates remain
open.

Next packet: require the fixed loop entry to end in `return_f64`.
