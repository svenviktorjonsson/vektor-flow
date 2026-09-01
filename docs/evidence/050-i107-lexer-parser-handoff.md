# 050-I107 lexer-to-parser handoff evidence

## Scope

- Base: `f13556a`
- Initial RED: `8d156c7`
- Corrected RED: `2dfe43a`
- Implementation: `6611633`
- Branch: `codex/0.5/050-i107-lexer-parser-handoff`

I107 connects the production self-hosted lexer module to the production
self-hosted parser's existing cursor. The bounded tracer emits the versioned
token-stream envelope, and the parser consumes its schema, version, token
vector, and initial index. Linked CamelCase type aliases remain isolated by
module while nominal record parameters retain declared structure containing
open `any` fields.

This compiler-internal tracer adds no public VKF API, syntax, diagnostic,
opcode, Machine-IR schema, or ABI.

## TDD evidence

The corrected RED test fails under the fresh I104 compiler before artifact
output:

```text
machine IR call argument structure mismatch for
__vkf_module_parser__cursor.envelope: expected
4[schema:2,tokens:1,version:1], got 38[schema:2,tokens:35,version:1]
```

Final evidence from the fresh I107 compiler:

- source graph, cursor, I101-I106 linked lexer, aggregate ABI, nested aggregate,
  and I107 handoff suite: 21/21 passed in 5.43 s;
- focused I107 handoff: schema `vektorflow.token_stream`, version `1`, five
  tokens, parser index `0`, and first kind `IDENT`;
- queue/container regression (`tests/vkf/containers.vkf`): 19/19 passed;
- direct strict compile of `compiler/self_hosted/lexer.vkf`: exit 0 in 960 ms;
- emitted lexer artifact execution: exit 0 with no output.

The first aggregate ABI attempt reported two infrastructure-only failures
because the short-path build omitted `vkf_x64_artifact.exe`. Building that
existing target and rerunning the identical suite produced 21/21 passes. All
child processes remained hidden and no performance workload ran.

## Deliberate boundary

I107 proves the linked token *structure* boundary. It does not claim transport
of heterogeneous `Token.value` payloads: identifier strings, punctuation
`null`, and numbers still require a tagged dynamic value/vector-of-record
representation. It also does not claim parser `peek`, expression parsing, or a
Stage-1 fixed point. The next packet should add the smallest internal typed
value transport without changing the public language contract, then execute
one parser operation.

The linker also still rewrites module symbols without lexical-scope awareness.
A parser execution slice using a local named like a module function must first
make that rewrite scope-aware.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107. I107 commits are
`8d156c7`, `2dfe43a`, `6611633`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `FBA39A585639A81089E15E5C50F836FA2478FB2102B48376BA286B93964A39F9`
- canonical `parser.vkf`:
  `E69B13F8BFA36D817E4F45B6ADD74F20C81B1BA6F916A777350426ACBD0ABD22`
- bootstrap bundle identity:
  `EC9F2FCA717FBBDC57F3AD6D569B2885B3775D9F3F46F56F4ABCAD5E69D46205`
- bootstrap manifest file:
  `378277BA226DA29225B7232A89EC6269E7175DD84852F21A3A8800976B59E60C`
- I107 acceptance test:
  `672EC7F86D87A00FD4571FBA152B0C02075425D171F07C5532548DD3045A88EA`
- fresh I107 `vkf-strict.exe`:
  `11416721EF429E080196FED54187371A49DA210D6CB0C4EF203B9A4CE87995FA`
- fresh I107 `vkf_x64_artifact.exe`:
  `7245E36505F8047C567860699A4CF81D6D64FB7F67902AB7E79A25499E048AB3`
- directly emitted I107 lexer artifact:
  `F20D355667D768299E40FE6982D6004C10FD5F824BC0CF5D583D00E83D3A45ED`

## Acceptance-gate impact

The Stage-1 frontend now crosses its first executable lexer-to-parser cursor
boundary. The full parser/frontend, Stage-1-to-Stage-3 fixed point,
self-hosted stdlib ownership, and toolchain-free rebuild remain open; therefore
this is a small frontend-gate advance rather than fixed-point graduation.
