# 050-I112 tagged parse-result evidence

## Scope

- Base: `a14f642`
- Parse-result RED: `7722ded`
- EOF-traversal RED: `56076e9`
- Implementation: `8e325a8`
- Branch: `codex/0.5/050-i112-tagged-parse-result`

I112 wraps the executable `alpha+42` binary expression in the parser's existing
`ModuleNode` and `ParseResult`. The bounded lexer stream now ends with explicit
`NEWLINE` and `EOF` tokens, and the flattened tagged cursor advances to index 4
where `tagged_at_end` observes EOF.

This compiler-internal tracer changes no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

Against I111, the first RED tracer failed because `parse_tagged_binary_result`
did not exist. The second RED tracer failed at `envelope.tokens.(3)` because the
bounded linked stream ended after its three expression tokens. The final hidden
execution produced:

```text
module
1
binary_op
+
alpha
42
0
4
true
```

Final evidence using the fresh hash-gated I108 compiler:

- source graph, I107 handoff, I108 lexical scope, I109 tagged values, I110
  cursor advance, I111 expression, and I112 parse-result suite: 8/8 passed in
  6.87 s;
- direct strict compile and execution of `lexer.vkf`: exit 0, compile 877 ms;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 2097 ms.

All child processes remained hidden and no performance workload ran.

## Deliberate boundary

The tracer covers one bounded expression statement and explicit cursor advances
through `NEWLINE` to `EOF`. It does not yet implement a general statement loop,
dynamic aggregate token-vector indexing, expression precedence, or recovery.
Those remain separate backend/frontend slices.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112. I112 commits are `7722ded`, `56076e9`, `8e325a8`, then this
evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `7DD481B606461A2EE80D5D1E59919909C8425C60847C54529F52305303806EB1`
- canonical `parser.vkf`:
  `A4EC8738EF5D45A33CA3090C6B857E799A52FCB28906EA533B8C9B228E8216D9`
- bootstrap bundle identity:
  `9E0DF143120EC4CF9186EAFAE859803B66DA122ED78B6BED41781ABE4BFF2565`
- bootstrap manifest file:
  `0426B9E023C27DCA6418DEF36A87AC9D947FAF760B800D27AE0EDD81515A944F`
- I112 acceptance test:
  `874488AD7A66508BD31565D84F1AF915A36DB215C5ABD40170375BE776A14EB0`
- hash-gated fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- directly emitted I112 lexer artifact:
  `291EE69B69B3D3F78596904ED6E8A4F6CC2128227689F43E7D64B0EBB97D5E6D`
- directly emitted I112 parser artifact:
  `3D99A6B9546B6D2A4048710C0D804B2E4C71A15C27645A699710B2E0D7505621`

## Acceptance-gate impact

The Stage-1 frontend now executes a bounded linked source statement into a
one-statement module result, preserves an empty diagnostic vector, and reaches
EOF without materializing heterogeneous nested token payloads. General
statement iteration, the full parser/frontend, fixed point, stdlib ownership,
and toolchain-free rebuild remain open.
