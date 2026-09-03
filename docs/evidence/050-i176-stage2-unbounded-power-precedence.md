# 050-I176 Stage-2 unbounded power evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I175 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I176 extends the runtime-sized arithmetic parser with the already-settled `^`
token and `PowerF64` execution contract:

```vkf
value: 10
:: value + 2 ^ 3 ^ 2 * 2
```

Before implementation, an independent Stage-0 probe compiled and ran
`:: 2 ^ 3 ^ 2` and produced `512`. This establishes the current authoritative
right-associative behavior; left association would produce `64`.

The private dynamic arithmetic tape now uses identity `9` for the existing
`PowerF64` opcode. A power chain emits all operands followed by the power
operators in reverse evaluation order, so power remains right associative and
binds above the left-associative multiplication/division/remainder tier. The
acceptance expression therefore evaluates as `10 + (2 ^ (3 ^ 2)) * 2 = 1034`.

Dynamic maximum-stack accounting now follows the actual power-chain depth, and
the private native Stage-observation consumer accepts that validated stack
maximum rather than assuming three. Existing non-power expressions continue
to report their previous exact maxima.

The Stage-2 executable exits zero with stdout `1034`, matching the independent
Stage-0 artifact. Two clean emissions preserve byte-identical PE and provenance
receipts. Replacing the demanded binding with an unknown name is rejected
before replacing either prior output.

No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, numeric type rule, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-power-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 12.87 s;
- intended failure: the Stage-2 CLI rejected power in the dynamic mixed parser
  and exited `3` before selecting an artifact;
- consumed source graph bundle:
  `854E7EAAEE5EEB9F621DBABBF2A82E30BFB3E9F1C875F0F490FF7769E3F0EA57`;
- consumed compiler binary:
  `5DAF7411343CFF553890C11801B799B72649F99E4F1DF9769D6B182FA5E040A4`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 19.83 s;
- final compiler binary:
  `25C820854F57D26585DF56A7E1703FA2F7D6A2C8EAD938468F3B7D1A5A14964E`.

The first GREEN iterations exposed a private Stage-0 lowering restriction:
mutable bindings declared inside the outer loop were not owned by the compiled
loop body. Moving the reusable power-chain counter outside the loop preserved
the algorithm without changing any diagnostic or public contract.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 15.65 s;
- exact Stage-0/Stage-2 stdout match: `1034`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-remainder-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-divide-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-subtract-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-power-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 9/9 passed in 26.85 s;
- I172-I175 dynamic precedence paths remained exact;
- the fixed power owner remained exact;
- source graph, count-independent validation, and underflow rejection remained
  green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 42.63 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `D4DB8C112DA08ADF8F7D4A301A87094278D32ACDE8B5E1B4DA4666B2792C6229`
- bootstrap manifest checkout bytes:
  `B0D5703FEA6EA9E35A107841CBE73E32B8B40D7986CD46E016FD7C4FFE14715A`
- canonical parser source:
  `FA19D7C616949F408A0F44A6B28AFADCCE6FDF493B1E839D0EEAF875FD625588`
- canonical Machine-IR source:
  `0AC8E8FD1B5811716E0EAEF17E0138E0FFD6CE8C60E7847F74E59CCA57F1D1B9`
- canonical Machine-IR validation source:
  `E6F7D6633B56CFB92D9FF595F841C11EEAC59ABE81C469F3A2C95D4FD548EF40`
- Stage-2 unbounded power acceptance test:
  `2C5E6AD6A7969550D9CAAF97319C63EEC7BBF24179CF2EFBAF875222E46338D5`
- internal Stage observation adapter checkout bytes:
  `C95D3CE79AEC712D80FB85AD26B0D034AF062C19D5E8BFE74EE0CFC65B7FF7DF`.

## Acceptance-gate impact

This closes runtime-sized power precedence and right associativity through
parsing, typed IR, dynamic Machine IR, exact stack validation, native
consumption, and emitted execution. The dynamic parser still does not cover
unary minus or grouping, and ADR 0005 cutover rule 5 remains open: Stage 2
cannot rebuild the complete compiler graph, no Stage-3 compiler exists, and
Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I175's 82.1%, 0.5 is conservatively **82.6% total**, **+0.5
percentage points** for this power-precedence/associativity subgate.

## Handoff inventory

I176 extends the layered dynamic parser/Machine-IR/validator and private native
observation consumer, plus one focused test and this receipt over I162-I175.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
