# 050-I169 Stage-2 dynamic-arithmetic-chain evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I168 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I169 crosses the first arithmetic expression beyond the existing fixed
eight-instruction Machine-IR aggregate:

```vkf
value: 31
:: value + 7 // 2 + 5 + 1
```

The VKF-owned parser retains five operands. Typed IR preserves the expression,
and Machine IR emits homogeneous numeric opcode and value tapes with ten
instructions. Internal opcode identity `4` selects the already-existing
`floor_divide_f64` instruction while mapping to the existing binary stack
effect for count-independent validation. Maximum stack depth is three.

The native observation consumer iterates the two tapes rather than projecting
them through another fixed-width self-hosted Machine-IR record. The Stage-2
native executable exits zero with stdout `40`, matching the independent
Stage-0 artifact. Two clean emissions preserve byte-identical PE and
provenance receipts. Replacing the demanded binding with an unknown name is
rejected before replacing either prior output.

The new component is private:
`machine_ir.closed_dynamic_arithmetic.typed_module_pipeline`. No public
syntax, precedence rule, API, diagnostic, MachineModule version, opcode,
receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-dynamic-arithmetic-chain-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 11.90 s;
- intended failure: Stage 0 rejected the absent VKF compiler method with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `8E17619EE346F401DA685B7400BD0EAA6185746D55B519B2EF656202551EA9AC`;
- consumed compiler binary:
  `4ABC8DFB18130B0B2756F1EECDC3676838D86C86A4F4B2594593DC1A6FA24779`.

GREEN builds:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- first build exited `0` in 26.25 s;
- the first GREEN run exposed an overly restrictive adapter guard that
  compared ten tape instructions with nine observation leaves;
- after removing that fixed-width assumption, the second build exited `0`
  in 20.10 s;
- final compiler binary:
  `ABC14DEF0C9844E46C666C52037ABAF6A5A012417AE1ABFC0638FC9AFD348619`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 12.96 s;
- exact Stage-0/Stage-2 stdout match: `40`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-extended-arithmetic-chain-compiler-cli.test.mjs `
  tests/bootstrap/stage1-derived-binding-chain-encode.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs `
  tests/bootstrap/stage1-unbounded-machine-ir-validation.test.mjs
```

- exit `0`, 6/6 passed in 17.63 s;
- I168's fixed eight-instruction chain remained exact;
- the earlier dynamic dependency-tape owner and its underflow rejection
  remained green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 39.18 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `8ED3B1256CAA89E9116AFD190521DA2F24F05E43E3D12CE644387906BAFA9726`
- bootstrap manifest checkout bytes:
  `6E71E2145E0879238297ED779C41656B40B6EACF8505E437C83C22E201B95FFE`
- canonical parser source:
  `CAC50753C7CB69A5BA1B2454501F68D68B891FB0576B0E5794BCE158A59160E6`
- canonical typed-IR source:
  `5119BFDA7A3649DA71D36A91FE351B1A2D2097D11958545909BDC26A87B6C8F9`
- canonical Machine-IR source:
  `B232237352E5667D80832DE5CDB81BFC2475FF1827C69F6034B4F502F00B8280`
- canonical Machine-IR validation source:
  `C44990DED809D94023475549AE23189BDEF4622B7F99B863B1AACC08F18C3635`
- canonical compiler facade source:
  `F752695A27EA1311390CCC79B05977F28257E28F40EE427BD7BB6340A27361D5`
- Stage-2 dynamic-arithmetic acceptance test:
  `95BB8063579AFFB931BCE549FAC55DE9EC7371E735A0B9A70BE92D429BFE6D8C`
- internal Stage observation adapter checkout bytes:
  `4A3867CAA1019773ADA01D45FF5A6EFB99536EA0721A09A43A05E044EE19B06E`.

## Acceptance-gate impact

This closes a count-independent Machine-IR tape handoff for a mixed arithmetic
expression longer than every prior fixed aggregate. It does not make source
expression parsing fully unbounded and does not close ADR 0005 cutover rule
5: Stage 2 still cannot rebuild the complete compiler graph, no Stage-3
compiler exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I168's 78.7%, 0.5 is conservatively **79.2% total**, **+0.5
percentage points** for this dynamic-tape subgate.

## Handoff inventory

I169 layers a five-operand parser/typed-IR path, a dynamic arithmetic
Machine-IR tape and validator, a private native observation consumer, one
focused test, and this receipt over I162-I168. Existing dirty files and
pre-existing untracked `.work/` content were preserved. No commit, push,
merge, renderer edit, UI launch, or generated artifact was added to Git.
