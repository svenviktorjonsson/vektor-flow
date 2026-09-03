# 050-I174 Stage-2 unbounded true-division evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I173 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I174 extends the runtime-sized arithmetic parser with the already-settled `/`
token and `DivideF64` execution contract:

```vkf
value: 100
:: value - 25 / 4 * 2 + 9 / 4
```

The private dynamic arithmetic tape now uses identity `7` for the existing
`DivideF64` opcode. True division joins multiplication and floor division in
the high-precedence, left-associative term path. The expression therefore
evaluates as `100 - ((25 / 4) * 2) + (9 / 4)` and emits twelve instructions
with validated maximum stack depth three.

The Stage-2 executable exits zero with stdout `89.75`, matching an independent
Stage-0 artifact. Floor division would produce `90`, so integer coercion cannot
pass this oracle. Two clean emissions preserve byte-identical PE and provenance
receipts. Replacing the demanded binding with an unknown name is rejected
before replacing either prior output.

No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-divide-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 12.11 s;
- intended failure: the Stage-2 CLI rejected true division in the dynamic
  mixed parser and exited `3` before selecting an artifact;
- consumed source graph bundle:
  `88350267EE0FE3AB918D2F77C9000AF24D68DDF583522D29D3281BF33EBE4B65`;
- consumed compiler binary:
  `32D02D84E751E8088163FCB66A84BE1EBE042930208442D59D45B006DE43B429`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 23.11 s;
- final compiler binary:
  `223BE1DEA674BFC633ED66A9B510EB91756280039D0E392BFF22F91C97C26ECF`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 14.90 s;
- exact Stage-0/Stage-2 stdout match: `89.75`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-subtract-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-mixed-arithmetic-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 8/8 passed in 22.18 s;
- I171-I173 dynamic precedence paths remained exact;
- the fixed true-division owner remained exact;
- source graph, count-independent validation, and underflow rejection remained
  green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 40.49 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `130CB1A24ADA08D7D2938A3960459E93685829E762E5C53F0DFE507DF2E5C27E`
- bootstrap manifest checkout bytes:
  `2D7155AEFB1EEBF242DF85BE57A4BC32C52A637A6A60976EDC51510752B94DB0`
- canonical parser source:
  `CF2CAC637E9A9A8D00F00D0E764DB7F7E0F9A2A0E9B09AA7016144F10FB8E1D4`
- canonical Machine-IR source:
  `44B7CA758E36E0C78DD73D0A4C864BBAABF45D938FF18166E4E085C20D333529`
- canonical Machine-IR validation source:
  `6C4F0A6E76D9A129082B763635AF5EB0959B2922CDA8E83DBA4C2CADC8D6B1FE`
- Stage-2 unbounded true-division acceptance test:
  `52B6A245C2DA41F0CD45347D491BB620BDEA2674EACBF59D78D5602AA06899A7`
- internal Stage observation adapter checkout bytes:
  `7213044ADC177BD6E5630592489F0809ED3F0461E8C06AF0D00F77AFDBA73AAE`.

## Acceptance-gate impact

This closes runtime-sized true-division precedence through parsing, typed IR,
dynamic Machine IR, validation, native consumption, and emitted execution. The
dynamic parser still does not cover remainder, power, unary minus, or grouping,
and ADR 0005 cutover rule 5 remains open: Stage 2 cannot rebuild the complete
compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3 have not run
the same full suite.

Re-evaluated from I173's 81.3%, 0.5 is conservatively **81.7% total**, **+0.4
percentage points** for this true-division-precedence subgate.

## Handoff inventory

I174 extends the layered dynamic parser/Machine-IR/validator and private native
observation consumer, plus one focused test and this receipt over I162-I173.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
