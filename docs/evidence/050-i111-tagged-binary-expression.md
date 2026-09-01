# 050-I111 tagged binary-expression evidence

## Scope

- Base: `9c7ab71`
- RED: `b2017a2`
- Implementation: `34bd8ca`
- Branch: `codex/0.5/050-i111-tagged-binary-expression`

I111 adds a bounded linked `alpha+42` token stream, advances the flattened tagged
cursor through identifier, plus, and number tokens, and constructs the parser's
existing `BinaryOpNode` with `IdentifierNode` and `NumberLiteralNode` children.

This compiler-internal tracer changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

Against I110, the RED tracer failed before artifact output because the bounded
expression stream and tagged binary parser operation did not exist. The final
execution produced:

```text
binary_op
+
identifier
alpha
number_literal
42
```

Final evidence using the fresh hash-gated I108 compiler:

- source graph, I107 handoff, I108 lexical scope, I109 tagged values, I110
  cursor advance, and I111 expression suite: 7/7 passed in 5.03 s;
- direct strict compile and execution of `lexer.vkf`: exit 0, compile 881 ms;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 2306 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The tracer covers one bounded binary expression and a plus operator. It does not
yet implement general precedence, an EOF-driven statement loop, or dynamic
aggregate token-vector indexing. Those remain separate backend/frontend slices.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111. I111 commits are `b2017a2`, `34bd8ca`, then this evidence commit. Do
not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `6A53A2C76FD0912C255A105083B5CBE1C5995C7B73703645A5E4E366AE89D147`
- canonical `parser.vkf`:
  `82D421E34661E1EB10B619084616A43E2AAB036E69F9CDF889DA96D0D7BD5E7D`
- bootstrap bundle identity:
  `DDCD1C2FD771E9C382685AF65A940D86F48FBAD0135837A7C53A5417B196F239`
- bootstrap manifest file:
  `250FF8216AD75B2C6C4CCC64229E7828C43821583596B3834FB386FEFE79A1CD`
- I111 acceptance test:
  `D3F024FC30536CC2AC69C48BB7CD855DCADDC593B6E646BD5F3C3C41B60AC636`
- hash-gated fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- directly emitted I111 lexer artifact:
  `A6B19D913C3B41292452A67E88B891301DF6B05C046F3FB8E804E751C73A53EA`
- directly emitted I111 parser artifact:
  `D6C7D72F28D1934E1B71E7FE7027C6C0A4B3E20B6315872305DB661A66DD0A8D`

## Acceptance-gate impact

The Stage-1 frontend now executes one linked source expression across lexer,
cursor transitions, operator decoding, and AST assembly. General expression
precedence, statement iteration, the full parser/frontend, fixed point, stdlib
ownership, and toolchain-free rebuild remain open.
