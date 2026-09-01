# 050-I137 unbounded compiler-facade evidence

## Scope

- Base: `349ee198`
- RED: `56e15cd7`
- GREEN: `cea6610f`
- Branch: `codex/0.5/050-i137-unbounded-compiler-facade`

I137 connects the already-proven unbounded statement storage and demand-lowering
path behind `compiler.vkf`. The internal compiler facade now accepts source and
a demanded statement index, lexes and parses the whole source through EOF,
constructs the typed and Machine-IR modules, demand-lowers the selected
statement, validates its stack, and returns the unchanged version-4
`MachineModule`.

The acceptance source contains 32 statements and demands statement 31. The
result identifies function `value31`, parameter `num`, constant `32`, stack
maximum `2`, and the existing `load_local`, `push_f64`, `add_f64`, and
`return_f64` instruction sequence.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED imported `.compiler` and demanded the unbounded compiler operation. The
previous facade contained only the fixed dependency-chain entry and direct
lowering rejected the unresolved call. GREEN reuses the established dynamic
parser, typed-IR, MIR, validation, and assembly functions from the locked
source graph; it adds no fallback or backend exception.

- focused unbounded compiler facade plus source graph: 3/3 passed in 5.58 s;
- source graph and dependent self-hosting/ownership chain: 33/33 passed in
  52.86 s;
- established numeric, conditional, and loop private encoder pipelines: 9/9
  passed in 28.79 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 24.48 s;
- all child processes were hidden and no performance workload ran.

The bundle test used a temporary short drive alias mapped to this same isolated
worktree to avoid the known Windows path limit. The alias was removed after the
test.

## Deliberate boundary

The unbounded storage path still recognizes only its existing tagged binary
statement subset, and this packet demand-lowers one selected statement rather
than assembling all module functions. General source/diagnostics, full module
symbol resolution, complete compiler MIR, compiler-owned artifact writing,
Stage-1 invocation over the locked graph, Stage-2 production, and fixed-point
equivalence remain open.

## Merge queue

Preserve I83 -> clean I84 -> I85 -> I86 -> I87 -> I88 -> I89 -> I90 -> I91
-> I92 -> I93 -> I94 -> I95 -> I96 -> I97 -> I98 -> I99 -> I100 -> I101
-> I102 -> I103 -> I104 -> I105 -> I106 -> I107 -> I108 -> I109 -> I110
-> I111 -> I112 -> I113 -> I114 -> I115 -> I116 -> I117 -> I118 -> I119
-> I120 -> I121 -> I122 -> I123 -> I124 -> I125 -> I126 -> I127 -> I128
-> I129 -> I130 -> I131 -> I132 -> I133 -> I134 -> I135 -> I136 -> I137.
I137 commits are `56e15cd7`, `cea6610f`, then this evidence commit. Do not
merge or reset the original dirty I84 worktree.

## Contract hashes

- canonical `compiler.vkf` source:
  `E74B98B5E2F4489545D83799D86C819CD86A513AA349092D0E1812D983D0ECC8`
- bootstrap bundle identity:
  `E3394A57AB030F5095C423029CF3D4BFF037769920ACF01534E36DF1C2C2030A`
- canonical bootstrap manifest Git bytes:
  `5D0FCDF74EBFD9840AC0F9C01517A90CEE392F0F8FBC6BBFBFEABD41433E38B6`
- unbounded compiler-facade acceptance test:
  `D902F241024F698D11C4F2BCAA6450AF5289C8BF25A4640C95AB7C39564F64DE`
- reused bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`

## Acceptance-gate impact

The connected VKF compiler facade is no longer limited to the fixed
four-statement dependency tracer: it owns count-independent module storage and
demand-lowers a selected statement from a 32-statement source. Re-evaluated
against the release gates, 0.5 is estimated at **69.6% total**, **+1.2
percentage points** from I136's 68.4%.
