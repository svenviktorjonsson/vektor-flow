# 050-I92 loop entry terminator evidence

## Scope

- Base: `94aa16fabb24f6d4471940e76fca01add3a591f9`
- RED: `82172705e7868b7bee0377e25ca7f3e17a2982c8`
- Implementation: `541039dbcff2807fcd89bca6d9d92fb5774bfbb4`
- Branch: `codex/0.5/050-i92-loop-entry-terminator-kind`

A stack-equivalent `store_local` could replace the fixed loop entry's
`return_f64` while satisfying terminal stack balance. I92 requires that entry
to end in `return_f64`. No public contract changed.

## TDD and affected verification

Verification used I83 strict compiler SHA-256
`BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`
with scratch data inside the repository.

- Focused RED: 0 passed, 1 failed, 3,876.11 ms;
  `unterminated fixed-loop entry produced output`.
- Focused GREEN: 1 passed, 0 failed, 3,361.50 ms.
- Serial affected loop validation, loop pipeline/dispatch, and strict dispatch
  matrix: 26 passed, 0 failed, 152,054.68 ms.

I91's full shared matrix passed immediately before this path-specific matrix;
I92 changes only the bounded loop assertion.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92. I92 commits are `8217270`, `541039d`, then this evidence commit. Do not
merge or reset the original dirty I84 worktree.

## Contract hashes

- `machine_ir_validation.vkf`:
  `EB66BBA913B3FBC019365B7C47132C4F5D68FF4ADD5471C9E5A72D0E5BB4C303`
- `stage1-machine-ir-loop-stack-validation.test.mjs`:
  `D3DB8E584ED658BDFFFE5A672FA62FFE1204B5C0F319F36500FF8B33CA97895E`

## Acceptance-gate impact

The bounded loop validator now proves the entry return in addition to its
header, exit branch, back edge, and exit return. This closes its currently
bounded terminator-kind slice. General CFG and Stage 2/Stage 3 fixed-point
gates remain open.

Next packet: reassess the acceptance DAG before widening the fixed validator;
the next major gate remains a reproducible Stage-1 compiler rebuild toward
Stage 2.
