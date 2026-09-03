# 050-I171 Stage-2 unbounded mixed-arithmetic evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I170 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I171 removes the fixed token-count boundary for mixed addition and floor
division while preserving precedence:

```vkf
value: 127
:: value + 31 // 4 // 2 + 9 // 2 + 6
```

The VKF-owned parser iterates runtime-sized operator-number pairs into dynamic
operator and operand vectors. Typed IR preserves both vectors. Machine IR
keeps an addition pending until the complete floor-division term has been
emitted, so floor division remains higher precedence and repeated floor
division remains left associative. This acceptance source produces fourteen
instructions with validated maximum stack depth three.

The Stage-2 native executable exits zero with stdout `140`, matching the
independent Stage-0 artifact. A purely left-to-right lowering would produce a
different value, so the oracle match directly verifies precedence. Two clean
emissions preserve byte-identical PE and provenance receipts. Replacing the
demanded binding with an unknown name is rejected before replacing either
prior output.

This is a private bootstrap extension. It reuses the internal dynamic
arithmetic tape and existing `FloorDivideF64`; no public syntax, precedence
rule, API, diagnostic, MachineModule version, opcode, receipt schema, or ABI
changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`. All spawned processes used hidden
windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-unbounded-mixed-arithmetic-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 10.36 s;
- intended failure: Stage 0 rejected the absent VKF compiler method with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `B27FE00E6896B2336D3FEDFC3AAC4B6DDC32BFF50C6E65EC335BE020505D3942`;
- consumed compiler binary:
  `42E6562727868AFF4EB8549CBFFA08D694D4C23B3D4B3B96D9F28573382B3E86`.

No native rebuild was required: I171 changes only self-hosted VKF compiler
sources, their locked manifest, the focused test, and this evidence receipt.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 12.46 s;
- exact Stage-0/Stage-2 stdout match: `140`;
- fourteen instructions prove the mixed parser is not tied to I169's
  five-operand template;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-unbounded-addition-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-dynamic-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage2-extended-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage1-derived-binding-chain-encode.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 8/8 passed in 22.32 s;
- I168-I170 fixed, dynamic, and unbounded-addition paths remained exact;
- the existing dependency-tape and underflow rejection remained green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 31.69 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `AE80F174CD549CC91E6E3B1C42E0425BBB34A0C35DB464530AB6DB65F10FC217`
- bootstrap manifest checkout bytes:
  `DDB43C627A7B32E99B8CF25436949F87994174A25116D06000CB62D68A3C6A0A`
- canonical parser source:
  `AA7D9CFED142742ECD1DB3EFE4F022D8C651A6CB55869824833693F60B85F63E`
- canonical typed-IR source:
  `3E39E867164D97CBC0B60C55C12B5DB0857788EAED080166E8B0AA88A068153B`
- canonical Machine-IR source:
  `49BC9B102F2E7DB36F0F255037567E0660492E49215B198AABE95C2C805ADEDE`
- canonical compiler facade source:
  `AE60FBC6A4BDC6D5B67B8CCF6CAD931E5898B0837F0D174854976CB15D0C9AE7`
- Stage-2 unbounded mixed-arithmetic acceptance test:
  `2050CBA83B8FE8054B7B2284E714A52F0680932DFAD29C78D87F36A14D0D03E1`
- internal Stage observation adapter checkout bytes:
  `A07DADDC8F46840A59E709C6B7B2AE54620A7B12F9EC04AA7724D5C5D3240F4E`.

## Acceptance-gate impact

This closes the fixed-length mixed-precedence parser boundary for the
currently accepted dynamic addition/floor-division grammar. It does not yet
generalize all arithmetic operators or grouping through the runtime-sized
parser and does not close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild
the complete compiler graph, no Stage-3 compiler exists, and Stage 2 and
Stage 3 have not run the same full suite.

Re-evaluated from I170's 79.8%, 0.5 is conservatively **80.5% total**, **+0.7
percentage points** for this mixed-precedence parser subgate.

## Handoff inventory

I171 layers a runtime-sized mixed parser/typed-IR path, precedence-preserving
dynamic Machine-IR lowering, one focused test, and this receipt over I162-I170.
Existing dirty files and pre-existing untracked `.work/` content were
preserved. No commit, push, merge, renderer edit, UI launch, public-contract
edit, or generated artifact was added to Git.
