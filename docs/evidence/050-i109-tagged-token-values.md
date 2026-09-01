# 050-I109 tagged token-value evidence

## Scope

- Base: `7040f3e`
- Initial RED: `7fe513b`
- Corrected RED: `2e14133`
- Implementation: `2babd3c`
- Branch: `codex/0.5/050-i109-tagged-token-values`

I109 transports text and number token payloads through one homogeneous linked
token vector. Each token carries a `TaggedTokenValue` with a tag plus fixed
text and number slots. The self-hosted parser consumes the typed token and
constructs its existing `IdentifierNode` and `NumberLiteralNode` shapes.

The tag is an internal bootstrap representation. This packet changes no public
VKF API, syntax, diagnostic, opcode, Machine-IR schema, or ABI.

## TDD evidence

Against I108, the RED tracer failed before artifact output because the linked
lexer and parser did not expose the tagged producer/consumer functions. The
final tracer uses `alpha 42 beta 7`, carries both value categories in one token
vector, and produces:

```text
identifier
alpha
number_literal
42
```

Final evidence using the fresh hash-gated I108 compiler:

- source graph, I103 number parity, I107 cursor handoff, I108 lexical scope,
  and I109 tagged value suite: 6/6 passed in 3.33 s;
- direct strict compile and execution of `lexer.vkf`: exit 0, compile 585 ms;
- direct strict compile and execution of `parser.vkf`: exit 0, compile 1667 ms.

The first number-parity regression attempt could not start its canonical lexer
helper because that target was absent. Building the existing helper and
rerunning the identical suite produced 6/6 passes. All child processes remained
hidden and no performance workload ran.

## Deliberate boundary

I109 passes selected typed tokens directly to parser node constructors. Calling
the generic `advance(ParseCursor)` with the deeply nested tagged vector still
exposes a backend literal-layout mismatch below the current diagnostic depth.
The next packet should either give tagged streams their concrete internal cursor
type or generalize nested aggregate projection/layout equality, then execute a
cursor-advancing parser operation. Dynamic user-visible `any` semantics are not
inferred by this internal representation.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109. I109
commits are `7fe513b`, `2e14133`, `2babd3c`, then this evidence commit. Do not
merge or reset the original dirty I84 worktree.

## Contract hashes

Source hashes use canonical LF bytes.

- canonical `lexer.vkf`:
  `B84989794F45311CC491C9569CA7F510BFC183A69B0757FA4F1A2C56B9DABA16`
- canonical `parser.vkf`:
  `87567B6421438985D1480C4F9CAAC8D58E3270AAE2DD4327C5A4682EF3DE5422`
- bootstrap bundle identity:
  `B920A7CE4BBFA2730C6F7FB3C98D6EE9CABEEC7F673FE75A120498676C77DF64`
- bootstrap manifest file:
  `7D84AC6600AFB963DAD9FF5C65E7C2CFBD778E808871A00256EA289930D44D5B`
- I109 acceptance test:
  `4308BD46AE8B612655E0BB69FE073AF0242A564EAB6288F259F3EBC0A78AF119`
- hash-gated fresh I108 `vkf-strict.exe`:
  `EDF8ECED8C5854FB2F5E14D1BF8CBB1BDD4E044169A9C6DFF2F1EF5252F8CEC8`
- directly emitted I109 lexer artifact:
  `E244CAE3EE77AF073926F001287C032905B7F5179B17B8FAEF8FD26D95AA9A3C`
- directly emitted I109 parser artifact:
  `B644FD53859E909786F350509F957555BB4AF1520193AC9926FAD0477E75E15B`

## Acceptance-gate impact

The Stage-1 frontend now transports two heterogeneous source-value categories
without a heterogeneous physical vector and executes parser AST construction
for both. Full cursor traversal, literal dispatch, expression parsing, the
Stage-1-to-Stage-3 fixed point, and toolchain-free rebuild remain open.
