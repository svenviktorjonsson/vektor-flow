# 050-I126 prior-binding lookup evidence

## Scope

- Base: `7f1e326a`
- RED: `c2a53072`
- GREEN: `ff3bdfd5`
- Branch: `codex/0.5/050-i126-prior-binding-lookup`

I126 extends demanded closed-MIR dependencies beyond adjacent statement pairs.
For an existing identifier-plus-number expression, the internal resolver walks
earlier homogeneous parser rows backward, skips unrelated bindings, and selects
the nearest matching source-order binding. The resulting closed statement then
uses the unchanged self-hosted stack validator, v4 envelope, and private x64
encoder bridge.

The acceptance cases prove:

- `value: 31; other: 10; value + 1` resolves across the unrelated binding and
  emits an executable printing `32`;
- `value: 5; value: 31; other: 10; value + 1` selects the nearest rebind and
  prints `32`, rather than using stale value `5`;
- `other: 31; value + 1` rejects before encoding, with the internal missing
  dependency diagnostic embedded in the producer artifact.

No public syntax, API, diagnostic, opcode, schema, or ABI changed.

## TDD evidence

The RED suite kept the I125 adjacent-pair case green while the new non-adjacent
case failed at the missing resolver. GREEN verifies:

- four focused adjacent, non-adjacent, shadowing, and rejection cases: 4/4
  passed in 25.29 s;
- source graph plus the full dependent tagged lexer/parser/typed-IR/Machine-IR
  chain: 25/25 passed in 30.72 s;
- both accepted selected executables: exit 0, stdout `32`;
- unresolved dependency: private Stage dispatch rejects before output;
- all child processes hidden; no performance workload or shared benchmark
  root used.

## Deliberate boundary

The binding value is still a numeric literal and the demanded expression is
identifier-plus-number. Bindings whose values are expressions, chained/nested
arithmetic, general lexical scopes, broader grammar/type lowering, the compiler
fixed point, stdlib ownership, and toolchain-free rebuild remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126. I126 commits are
`c2a53072`, `ff3bdfd5`, then this evidence commit. Do not merge or reset the
original dirty I84 worktree.

## Contract hashes

- canonical `machine_ir.vkf`:
  `1CBC76FBA9C25533DB90FEA20DF7C1FD3B91BC87C1420031C8B77F403A73C7C4`
- bootstrap bundle identity:
  `7482AB140A34C62BDADE4C4CF2B52DFAC3E89941D023415417704645A2064566`
- bootstrap manifest file:
  `2929BDBC0BF2C0C8DB990308BE4D9A5FF79141A223B5C4B857106AC6D2F68112`
- multi-binding demand acceptance test:
  `5AEB2F53F14BAA2C23B815FFF7D243C267FA18DEC07CA3EDC3F6465EB7C4EDD8`
- reused isolated I124 `vkf-strict.exe`:
  `97E1B3B5E4118D63D191DDD40DD4856EBF845E444EFDA058EE1C8F2A326F7169`

## Acceptance-gate impact

The executable Stage-1 tracer now performs source-order dependency lookup
rather than relying on an adjacent pair supplied by the caller. Against release
gates, 0.5 is estimated at **57.5% total**, **+0.5 percentage points** from
I125's 57.0%.
