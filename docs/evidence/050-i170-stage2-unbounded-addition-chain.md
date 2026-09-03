# 050-I170 Stage-2 unbounded-addition-chain evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I169 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I170 removes the fixed token-count boundary for a left-associative addition
chain:

```vkf
value: 31
:: value + 1 + 2 + 3 + 4 + 5 + 6
```

The VKF-owned parser validates the binding/prefix and newline/EOF suffix, then
iterates any number of plus-number pairs into a dynamic operand vector. Typed
IR preserves that vector. Machine IR iterates the operands into homogeneous
opcode/value tapes, producing fourteen instructions for this acceptance
source and validating maximum stack depth two.

The existing dynamic dependency-chain observation consumer now accepts an
instruction tape longer than its nine envelope leaves; the prior comparison
between instruction count and envelope leaf count was removed. It still
requires equal opcode/value tape lengths and validates every opcode payload.

The Stage-2 native executable exits zero with stdout `52`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

This is a private bootstrap extension. No public syntax, precedence rule, API,
diagnostic, MachineModule version, opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-addition-chain-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 10.49 s;
- intended failure: Stage 0 rejected the absent VKF compiler method with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `8ED3B1256CAA89E9116AFD190521DA2F24F05E43E3D12CE644387906BAFA9726`;
- consumed compiler binary:
  `ABC14DEF0C9844E46C666C52037ABAF6A5A012417AE1ABFC0638FC9AFD348619`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 14.06 s;
- compiler binary:
  `42E6562727868AFF4EB8549CBFFA08D694D4C23B3D4B3B96D9F28573382B3E86`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 9.23 s;
- exact Stage-0/Stage-2 stdout match: `52`;
- fourteen instructions prove the path is not bounded by the nine-leaf
  observation envelope;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

During GREEN, one multiline assertion diagnostic unsupported by the bootstrap
grammar was collapsed to one line, and the test fixture's literal `$entry`
escape was corrected. Focused staged probes confirmed the parser, typed-IR,
Machine-IR, validation, and facade calls independently before the final
end-to-end run.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-dynamic-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-extended-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage1-derived-binding-chain-encode.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 7/7 passed in 25.20 s;
- I168 and I169 arithmetic chains remained exact;
- the earlier dynamic dependency-tape owner and underflow rejection remained
  green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 33.87 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `B27FE00E6896B2336D3FEDFC3AAC4B6DDC32BFF50C6E65EC335BE020505D3942`
- bootstrap manifest checkout bytes:
  `2910D980C85D1AFF389EA585BCCE9B275548F7869C55230E061666267AC2EFB6`
- canonical parser source:
  `120D1CDA4B4E726CD8908A0CD3C443AC0643C05FF11F99478481B80D7F83110F`
- canonical typed-IR source:
  `4BF6ABA39136B2A95F6EBB97226FCEED4EC6863E6CF5FA1E1564B370993A859B`
- canonical Machine-IR source:
  `34FB76C82361B47A8B3AFB9416E6C246D9FA15FB427C797B0D58C55D44C8E134`
- canonical compiler facade source:
  `F8B03E422F9490105F75D55D9A084E88EAFCBF54FFB549213502A11346CC2248`
- Stage-2 unbounded-addition acceptance test:
  `8DC63C0D459D83CCF106F48AB59E1EF3C790478FE8D1FB399BF29047EDFD2009`
- internal Stage observation adapter checkout bytes:
  `A07DADDC8F46840A59E709C6B7B2AE54620A7B12F9EC04AA7724D5C5D3240F4E`.

## Acceptance-gate impact

This closes the first runtime-sized source-expression parser loop through the
Stage-1-built Stage-2 compiler and the count-independent Machine-IR consumer.
It currently covers repeated addition, not arbitrary mixed-precedence parsing,
and does not close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild the
complete compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3
have not run the same full suite.

Re-evaluated from I169's 79.2%, 0.5 is conservatively **79.8% total**, **+0.6
percentage points** for this parser-length subgate.

## Handoff inventory

I170 layers a runtime-sized addition parser/typed-IR path, dynamic Machine-IR
lowering, removal of one fixed envelope-count assumption, one focused test,
and this receipt over I162-I169. Existing dirty files and pre-existing
untracked `.work/` content were preserved. No commit, push, merge, renderer
edit, UI launch, or generated artifact was added to Git.
