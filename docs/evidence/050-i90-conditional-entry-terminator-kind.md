# 050-I90 conditional entry terminator evidence

## Scope

- Base: `19ff9779ad545fc0a9598a10546c9d6c88fa8b55`
- RED: `48dcbf3013d54d55ba2e3c74c7d3be65a9e23444`
- Implementation: `0b3e04b01987059fcbcb42631b8f83f1c9ca1a95`
- Branch: `codex/0.5/050-i90-conditional-entry-terminator-kind`

A stack-equivalent `store_local` could replace the fixed conditional entry's
`return_f64` while satisfying terminal stack balance. I90 requires that entry
to end in `return_f64`. No syntax, public API, ABI, schema, diagnostic text, or
generated output changed.

## TDD and affected verification

Verification used I83 strict compiler SHA-256
`BD87316B33B63B6CC6E98CD50411FFCDA3E233D9E8BAF00F97A3662315DA3CD5`
and the I90 worktree's 8.3 test-work path.

- Focused RED: 0 passed, 1 failed, 2,631.77 ms;
  `unterminated fixed-conditional entry produced output`.
- Focused GREEN: 1 passed, 0 failed, 4,964.01 ms.
- Serial Stage-1 normal/conditional/loop validation and dispatch matrix:
  56 passed, 0 failed, 281,250.66 ms.

## Merge queue

Preserve this exact queue:

1. I83: `68d420e`, `aa8a774`.
2. clean I84: `261fbec`, `b7ec12f`, `251fe13`.
3. I85: `462cc0c`, `67e30db`, `24766e3`, `70be8ea`.
4. I86: `330f03a`, `6d980af`, `7a3250c`, `5ebc212`, `9200174`, `b29da02`.
5. I87: `51e9480`, `654edac`, `c5b127f`.
6. I88: `4be2b48`, `e41aa82`, `66bc6ed`.
7. I89: `128845c`, `4281f69`, `19ff977`.
8. I90: `48dcbf3`, `0b3e04b`, then this evidence commit.

Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- `machine_ir_validation.vkf`:
  `8C8C13989949A41781E8BA4027313829568146A5D06FD3B9FF33EB8387180E66`
- `stage1-machine-ir-conditional-stack-validation.test.mjs`:
  `317BB79540F6F4E17E4E65532D3E77B203D36024FAB604AA5C2C8C7A9AA82B24`

## Acceptance-gate impact

The bounded conditional validator now proves its entry terminator in addition
to branch and arm structure. The helper terminator and general CFG/fixed-point
gates remain open.

Next packet: require the fixed conditional CPU-count helper to end in
`return_f64`.
