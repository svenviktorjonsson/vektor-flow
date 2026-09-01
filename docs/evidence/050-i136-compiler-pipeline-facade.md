# 050-I136 compiler pipeline-facade evidence

## Scope

- Base: `cdfaae7a`
- RED: `3085660a`
- GREEN: `fac0caf9`
- Branch: `codex/0.5/050-i136-compiler-pipeline-facade`

I136 connects the existing self-hosted lexer, parser, typed-IR, Machine-IR, and
Machine-IR-validation units behind one internal function owned by
`compiler.vkf`. An ordinary producer imports only `.compiler`, supplies the
existing four-statement arithmetic source, receives the validated dynamic
instruction tape, and passes it through I135's count-independent private
handoff. The resulting native artifact executes with stdout `33`.

This is the first connected VKF compiler-application facade over those phases.
It is deliberately not called a complete Stage 1: its accepted grammar and
operation set remain narrow, it still uses the Stage-0-built executable, and it
does not yet consume the locked compiler graph to produce Stage 2.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED imported `.compiler` and required one phase-composition call. The previous
source had no executable composition entry and direct lowering rejected the
unresolved member call. GREEN moved the already-tested phase sequence into
`compiler.vkf`, updated the canonical locked-source identity, and made the same
test execute and encode through the existing private contract.

- focused compiler-facade plus source-graph contract: 3/3 passed in 6.10 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 22.69 s;
- source graph and dependent self-hosting/ownership chain: 32/32 passed in
  43.77 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 24.46 s;
- connected compiler-facade artifact: exit 0, stdout `33`;
- child processes were hidden and no performance workload ran.

The first bundle attempt reached the known Windows path-length limit before
compilation. The passing rerun used a temporary drive alias mapped to this same
isolated worktree; that alias was removed immediately afterward.

## Deliberate boundary

The facade currently recognizes only the existing tagged dependency-chain
tracer. General compiler input, diagnostics, arbitrary modules/functions,
broader typed/Machine IR, compiler-owned artifact writing, Stage-1 invocation
over the locked graph, Stage-2 production, and the Stage-2/Stage-3 fixed point
remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132 -> I133 -> I134 -> I135 -> I136. I136
commits are `3085660a`, `fac0caf9`, then this evidence commit. Do not merge or
reset the original dirty I84 worktree.

## Contract hashes

- canonical `compiler.vkf` source:
  `82D9742AB2146008B8213AC7D2BC48702DA8284AFAE799BD4A838DFF14281347`
- bootstrap bundle identity:
  `123840BB0E373AFD4EE03D0F10AF64802D594E9B590551FCA6AB20D496003ACA`
- canonical bootstrap manifest Git bytes:
  `ABF7210409525722DB6ABEFCF34F9945900C8404E9C550402342DCC5C89F182C`
- compiler-facade acceptance test:
  `247843175F8F0E938D7CCC1DE34959C75F0B1EB6102C5200B0088BD57B67007B`
- fresh bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`

## Acceptance-gate impact

The frontend and validated dynamic MIR phases are no longer connected only by
test-local orchestration; `compiler.vkf` now owns one executable vertical
composition and remains part of a truthful, fully executable locked graph.
Re-evaluated against the release gates, 0.5 is estimated at **68.4% total**,
**+1.4 percentage points** from I135's 67.0%.
