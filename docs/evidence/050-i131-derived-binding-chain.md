# 050-I131 derived-binding chain evidence

## Scope

- Base: `d20334ce`
- RED: `41bf2f1d`
- GREEN: `c6f85f49`
- Branch: `codex/0.5/050-i131-derived-binding`

I131 deepens the executable Stage-1 dependency tracer using only existing VKF
binding and addition syntax:

```vkf
base: 31
value: base + 1
value + 2
```

The self-hosted token tape now retains an identifier on a binding right-hand
side. The bounded parser proves both source-order name links (`base` into the
derived binding and `value` into the demanded expression), typed IR retains the
three numeric operands, and Machine IR closes the chain as `push 31`, `push 1`,
`add`, `push 2`, `add`, `return`. The already-validated private nested-addition
bridge encodes the zero-parameter v4 module; the artifact prints `34`.

No public syntax, API, diagnostic, opcode, Machine-IR schema, or ABI changed.

## TDD and regression evidence

RED failed in the intended unsupported self-hosted source shape. GREEN reused
the exact I130 native compiler because no native bridge changed; the compiler
compiled the current I131 VKF source graph and its source-fingerprinted producer
before private dispatch.

- established arithmetic tracers plus derived binding closure: 5/5 passed in
  27.48 s;
- source graph and full dependent tagged lexer/parser/typed-IR/Machine-IR
  ownership chain: 30/30 passed in 38.03 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 24.39 s;
- derived-binding executable: exit 0, stdout `34`;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

This bounded tracer closes one derived numeric binding and one later demand.
Unbounded expression-valued binding storage, arbitrary dependency depth,
cycles, broad grammar/type lowering, the compiler fixed point, stdlib
ownership, and toolchain-free rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131. I131 commits are `41bf2f1d`, `c6f85f49`, then this
evidence commit. Do not merge or reset the original dirty I84 worktree.

## Contract hashes

- canonical `lexer.vkf`:
  `6DFF4027B4D56C4CF24F2A3E4EA1BAC6C48D075BB5E41A29DBFCAF1D56BA97AC`
- canonical `parser.vkf`:
  `08887F69E69E3864C669B6888FA71AF1E6EE7C1884BFB791E84E39A87CB8356F`
- canonical `typed_ir.vkf`:
  `E89DD0455740284D45FEF679A41EA84EA5327884E3F4A03056DC169DBC206359`
- canonical `machine_ir.vkf`:
  `F00D20315BBEBB678D911E8D57123B010124D52AB9E1D9172EB281A2151D8C34`
- canonical `machine_ir_validation.vkf`:
  `4CC8D39922B212CEBD371F6E22547EE6B1A8B9F1E60B481B905BC2740507918F`
- bootstrap bundle identity:
  `8BDF4F53DEDED0150CBECE7263034F5DCA63ED0AAF2F1A8F7E71F26F03402F21`
- bootstrap manifest file:
  `0E84FBEDC4D41303912FD8A4234F2039B1AC567ED8E873C065891BE7E9218FC1`
- derived-binding acceptance test:
  `F78CDD09DFB17EDD13B514289D9B7CA7FD55C22673573452CBC16872388D4DAF`
- reused isolated I130 `vkf-strict.exe`:
  `9D0C8D7DD24D9504BF2FA3CA43A78C5C61CB3DD293948B4CEC8763ECF03AD652`

## Acceptance-gate impact

The executable Stage-1 tracer now resolves a derived binding through a later
demand instead of closing only literal bindings. Against release gates, 0.5 is
estimated at **62.5% total**, **+1.2 percentage points** from I130's 61.3%.
