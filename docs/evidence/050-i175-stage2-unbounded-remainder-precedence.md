# 050-I175 Stage-2 unbounded remainder evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I174 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I175 extends the runtime-sized arithmetic parser with the already-settled `%`
token and `RemainderF64` execution contract:

```vkf
value: 100
:: value - 29 % 6 * 3 + 11 % 4
```

The private dynamic arithmetic tape now uses identity `8` for the existing
`RemainderF64` opcode. Remainder joins multiplication, true division, and floor
division in the high-precedence, left-associative term path. The expression
therefore evaluates as `100 - ((29 % 6) * 3) + (11 % 4)` and emits twelve
instructions with validated maximum stack depth three.

This packet exercises only the positive numeric-literal operand domain already
owned by the fixed Stage-2 remainder path. Dynamic unary minus is not yet
accepted, so it does not select or extend a negative-remainder convention.

The Stage-2 executable exits zero with stdout `88`, matching an independent
Stage-0 artifact. Right associating `%` with multiplication would produce `92`,
so associativity cannot pass accidentally. Two clean emissions preserve
byte-identical PE and provenance receipts. Replacing the demanded binding with
an unknown name is rejected before replacing either prior output.

No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, numeric type rule, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-remainder-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 13.80 s;
- intended failure: the Stage-2 CLI rejected remainder in the dynamic mixed
  parser and exited `3` before selecting an artifact;
- consumed source graph bundle:
  `130CB1A24ADA08D7D2938A3960459E93685829E762E5C53F0DFE507DF2E5C27E`;
- consumed compiler binary:
  `223BE1DEA674BFC633ED66A9B510EB91756280039D0E392BFF22F91C97C26ECF`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 16.78 s;
- final compiler binary:
  `5DAF7411343CFF553890C11801B799B72649F99E4F1DF9769D6B182FA5E040A4`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 15.57 s;
- exact Stage-0/Stage-2 stdout match: `88`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-divide-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-subtract-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-remainder-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 8/8 passed in 23.46 s;
- I172-I174 dynamic precedence paths remained exact;
- the fixed positive-remainder owner remained exact;
- source graph, count-independent validation, and underflow rejection remained
  green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 36.69 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `854E7EAAEE5EEB9F621DBABBF2A82E30BFB3E9F1C875F0F490FF7769E3F0EA57`
- bootstrap manifest checkout bytes:
  `1878D5A964467AA7C0D8E0A1AA1286FB4A54BB17FED26AA895BD0429B99B1366`
- canonical parser source:
  `C2614885D828283C1D12C0DB5B6ED5E7746921901365B55C6439750B29D490A3`
- canonical Machine-IR source:
  `4BA69C85482B5249D7847CB6E37CFEB54F2725B4DB3351FC46CC206F544A457F`
- canonical Machine-IR validation source:
  `4BE118C5723CB13C2112636EE6950761C9295A469D4FA11BAF6F366857A7615D`
- Stage-2 unbounded remainder acceptance test:
  `BB94FE8CD7D47C2785A0EC6413975C4C3F81F17299811A72F97BE6A220B2E1E4`
- internal Stage observation adapter checkout bytes:
  `D7D9302DF908B4EC70A142C8AB9B3759CC36EDBADDA3AFD8E890EE94566F4957`.

## Acceptance-gate impact

This closes runtime-sized positive-operand remainder precedence and
associativity through parsing, typed IR, dynamic Machine IR, validation, native
consumption, and emitted execution. The dynamic parser still does not cover
power, unary minus, or grouping, and ADR 0005 cutover rule 5 remains open:
Stage 2 cannot rebuild the complete compiler graph, no Stage-3 compiler exists,
and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I174's 81.7%, 0.5 is conservatively **82.1% total**, **+0.4
percentage points** for this remainder-precedence subgate.

## Handoff inventory

I175 extends the layered dynamic parser/Machine-IR/validator and private native
observation consumer, plus one focused test and this receipt over I162-I174.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
