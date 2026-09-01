# 050-I110 tagged cursor-advance evidence

## Scope

- Base: `6601d5b`
- Initial RED: `a54f9bd`
- Corrected RED: `da0cb54`
- Implementation: `5a226f5`
- Branch: `codex/0.5/050-i110-tagged-cursor-advance`

I110 adds a bounded internal parser cursor whose mutable state and current token
are flattened into one ABI-safe record. `tagged_advance` increments the index
and installs the next typed token snapshot. Parser operations then construct an
identifier node before the advance and a number node after it.

This compiler-internal tracer changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

Against I109, the RED tracer failed before artifact output because the parser
did not expose a tagged cursor or advance operation. The final execution proves:

```text
0
alpha
1
42
```

Final evidence using the fresh hash-gated I108 compiler:

- source graph, I107 handoff, I108 lexical scope, I109 tagged values, and I110
  cursor-advance suite: 6/6 passed in 4.41 s;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 2408 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The fixed token vector remains the source of typed tokens, but the bounded
tracer passes the next token into `tagged_advance`. Two backend gaps prevent a
generic vector-owning cursor today: dynamic indexing of aggregate elements is
not lowered, and returning a cursor containing nested token records loses their
non-numeric payloads. Aggregate-valued match expressions are also unavailable.
I110 therefore flattens the current token into the cursor instead of weakening
layout checks or pretending these operations work.

The next packet can parse the identifier-number pair as one small expression
using this cursor. Generic cursor ownership should wait for a focused dynamic
aggregate-index/return ABI packet.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110.
I110 commits are `a54f9bd`, `da0cb54`, `5a226f5`, then this evidence commit.
Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `parser.vkf`:
  `DB3251EA691676FA253A97DDC5EE2E3DFFE73CA0000A1D75545994689555B006`
- bootstrap bundle identity:
  `8662AB85DDC4644934E27975F586D1A37B6A1FFDDC4528B2ED4209789E7E8752`
- bootstrap manifest file:
  `EEEDD036F2E13CCB7EC51C6A445589C237C2C7E58F6EE90FD9D0DF15734A7580`
- I110 acceptance test:
  `6073F1C3CB721BA8862F41DDBD916EFBD997F85DA7B3A8A7C67629927853582E`
- hash-gated fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- directly emitted I110 parser artifact:
  `167206E9EC4A1B6C958DF20BBAEA12F790CB716068372D26F08A72E3956A8C1B`

## Acceptance-gate impact

The Stage-1 parser now performs a stateful cursor transition across text and
number token categories and materializes AST nodes on both sides. Expression
assembly, statement iteration, the full parser/frontend, fixed point, stdlib
ownership, and toolchain-free rebuild remain open.
