# 050-I172 Stage-2 unbounded multiplication-precedence evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I171 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I172 extends the runtime-sized mixed arithmetic parser with the already-settled
multiplication precedence and associativity contract:

```vkf
value: 100
:: value + 24 // 3 * 2 + 7 * 5 // 4 + 1
```

Multiplication and floor division share the high-precedence, left-associative
term. Machine IR keeps each addition pending until that term closes and emits
the existing `MultiplyF64` or `FloorDivideF64` instruction in source order.
Private arithmetic-tape identity `5` selects `MultiplyF64` and maps to the
existing binary stack effect. This source lowers to sixteen instructions with
validated maximum stack depth three.

The Stage-2 native executable exits zero with stdout `125`, matching the
independent Stage-0 artifact. Alternative precedence or right association
produces a different result. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-multiply-precedence-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 13.14 s;
- intended failure: the Stage-2 CLI rejected multiplication in the dynamic
  mixed-arithmetic parser and exited `3` before selecting an artifact;
- consumed source graph bundle:
  `AE80F174CD549CC91E6E3B1C42E0425BBB34A0C35DB464530AB6DB65F10FC217`;
- consumed compiler binary:
  `42E6562727868AFF4EB8549CBFFA08D694D4C23B3D4B3B96D9F28573382B3E86`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 20.52 s;
- compiler binary:
  `25F090F29A697407CBA4AC6507BC332CDAA7614DC429EBD5F3837F5264E1B3FA`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 16.80 s;
- exact Stage-0/Stage-2 stdout match: `125`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-mixed-arithmetic-compiler-cli.test.mjs `
  tests/bootstrap/stage2-unbounded-addition-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-dynamic-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-multiply-compiler-cli.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 8/8 passed in 25.42 s;
- I169-I171 dynamic arithmetic paths remained exact;
- the earlier fixed multiplication-precedence owner remained exact;
- source graph, count-independent stack validation, and underflow rejection
  remained green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 38.64 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `45B1670A73FCB1B85D7B412EC057D9C0785E97EFB3D0F8692694C8980255EAFE`
- bootstrap manifest checkout bytes:
  `FCF8ECF43613763C1DABA9088854F1803E5362EDF8E12BB630CEEEE97FC0463A`
- canonical parser source:
  `CDCC3B73575B24E9082B7A0AE7AF2079520D71B98E22B4F545A02FF956D9E4FF`
- canonical Machine-IR source:
  `FCFD1BA61D13540F12DA5F1ADC978C3E7127BA0F8DD1AD40AF1CBDD60DD8819E`
- canonical Machine-IR validation source:
  `C44C29CCC50D55B3D1153F3E6B67F0F6CA62CDC10F4899DDC573B7AA46C6C781`
- Stage-2 unbounded multiplication-precedence acceptance test:
  `73861F248A780D95512946B66BBD22C677704CBA3F7D8B1EF1D08CA736AAA3F6`
- internal Stage observation adapter checkout bytes:
  `2DE4A879307769807F8419CB2D1E51CAB7FEEE7097DF0A69413647564D6D9A4B`.

## Acceptance-gate impact

This closes runtime-sized multiplication precedence through parsing, typed
IR, dynamic Machine IR, validation, native consumption, and emitted execution.
The dynamic parser still does not cover subtraction, true division, remainder,
power, unary minus, or grouping, and ADR 0005 cutover rule 5 remains open:
Stage 2 cannot rebuild the complete compiler graph, no Stage-3 compiler exists,
and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I171's 80.5%, 0.5 is conservatively **80.9% total**, **+0.4
percentage points** for this multiplication-precedence subgate.

## Handoff inventory

I172 extends the layered dynamic parser/Machine-IR/validator and private native
observation consumer, plus one focused test and this receipt over I162-I171.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
