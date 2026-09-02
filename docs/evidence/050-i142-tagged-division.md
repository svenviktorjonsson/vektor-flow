# 050-I142 tagged-division evidence

## Scope

- Base: `9c4518ad3108a5073923b177c2ccaf7e572bfa73`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- Commit: none; this packet remains an uncommitted delivery candidate.

I142 extends the connected tagged binary-expression path through the compiler
facade. The already-recognized slash token now retains its identity through
parser storage and typed IR, lowers to the existing `divide_f64` Machine-IR
opcode, passes the existing stack validator, and is observable in the
unchanged version-4 `MachineModule` returned by
`compile_tagged_module_statement`.

No public syntax, API, diagnostic, Machine-IR schema, opcode, or ABI changed.

## TDD and regression evidence

RED compiled `value0/4` through `.compiler`; compilation succeeded but the
produced artifact exited with status 3 because slash reached the internal
unknown-operator branch.

- intentional RED: 0/1 passed in 11.37 s; artifact exit status 3;
- focused GREEN: 1/1 passed in 13.90 s; opcode `divide_f64`;
- source graph, canonical digests, addition tracer, validated Machine IR,
  subtraction, multiplication, and division: 7/7 passed in 18.60 s;
- complete locked bootstrap bundle: 10/10 declared units emitted as PE
  executables and ran with exit 0 in 35.63 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

The bundle test used the preserved I140 bundle/frontend tools, the isolated
I135 strict compiler, and a temporary short drive alias mapped to this
worktree's `.work` directory. The alias was removed after the test.

## Packet boundary

The full-module-functions RED remains a separate, unfulfilled gate. A local
attempt reproduced the existing dynamic aggregate seam: `[MachineFunction]`
cannot be represented by the numeric dynamic-list runtime without losing its
nested string/list ownership. That work was removed from this packet rather
than weakening ownership or special-casing `MachineModule.functions`.

## Contract hashes

- canonical `parser.vkf` source:
  `BD40364935AA8AB7D4E18178630C7C93491657F690032A266F08265BE4B2FC7B`
- canonical `typed_ir.vkf` source:
  `ED29E7C65750629E984251A49D60DAE22F771D9857302BC30E79D327AC70C838`
- canonical `machine_ir.vkf` source:
  `D49C5C125CA31EE7D8417E04992202F355B385AE4ADF3983D785AFC22A6FAD01`
- bootstrap bundle identity:
  `F566B49A196986996AEAC9D9440D659E34DFA4A97A831680E036CE3D155E73ED`
- tagged-division acceptance test:
  `5C4B917D2777F6CA9F9CE1A2670533FE831F1FE42A93E7A5CC7BF1510C4E927E`
- bootstrap manifest file:
  `293466D837AE265709DFD7F8AC60CDA693CD2310FD5D6B572E5E83192E1BAE5C`
- reused isolated I135 `vkf-strict.exe`:
  `CF98E81E325541ED6E6EF1CE22A0489230757996027461C16E0E61E95D148AD7`
- reused I140 bootstrap bundle tool:
  `1117890AF150CB2DC8822D07D431D87C568EE92B923BB2557D85EC32EAE31484`

## Acceptance-gate impact

This adds one Gate-2 frontend identity and Gate-4 lowering slice, observed
through the Gate-3 source-first compiler application. It does not close a
release gate: full-module aggregate storage and Gate-6 Stage-2/Stage-3 fixed
point remain open. Re-evaluated from I140, 0.5 therefore remains **70.1%
total**, **+0.0 percentage points**.
