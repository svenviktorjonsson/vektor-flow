# 050-I168 Stage-2 extended-arithmetic-chain evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I167 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I168 extends the Stage-1-built Stage-2 compiler CLI beyond the existing
three-value arithmetic shape:

```vkf
value: 31
:: value + 7 // 2 + 5
```

The VKF-owned parser retains four operands in the already-frozen four-value
internal aggregate. Typed IR preserves the extended expression and Machine IR
emits `push 31`, `push 7`, `push 2`, `floor-divide`, `add`, `push 5`, `add`,
`return`, with validated maximum stack depth three. The implementation reuses
the existing eight-instruction aggregate and stack validator rather than
introducing another container contract.

The Stage-2 native executable exits zero with stdout `39`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the internal
`machine_ir.closed_extended_arithmetic.typed_module_pipeline` component. No
public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-extended-arithmetic-chain-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 10.62 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `6DD62A717EA84D1B4B9EC08660173824C3B1973950637B5CE792BBC9459F3CD8`;
- consumed compiler binary:
  `AD38A27AD32631C2DF554312482A0A54955E3EFE4BCED6F8F9AC4315A550609B`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 17.85 s;
- compiler binary:
  `4ABC8DFB18130B0B2756F1EECDC3676838D86C86A4F4B2594593DC1A6FA24779`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 13.02 s;
- exact Stage-0/Stage-2 stdout match: `39`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-grouped-add-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-grouped-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage1-derived-binding-chain-encode.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 15.74 s;
- I166 and I167's opposite grouping orders remained exact;
- the existing eight-instruction dependency-chain owner stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 33.95 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `8E17619EE346F401DA685B7400BD0EAA6185746D55B519B2EF656202551EA9AC`
- bootstrap manifest checkout bytes:
  `892D43C91B6FCBD8DE855E861CF9B67C1019FA816374CA8B5545E9682FCD3506`
- canonical parser source:
  `C26D66CB3463E5008BAA187D8162A65E7EB02441599781189AFB9B342F246292`
- canonical typed-IR source:
  `5D50644D26281869DBA38F965B65411DF1C484219E1D15BD49E10A0062D64E08`
- canonical Machine-IR source:
  `0F468E77C8A393C4460E7D6B96BEBC72666D089E05E9DE64E519CBCC9DF420DB`
- canonical compiler facade source:
  `12ED2242DEA96E13CBD7F82E309F66CC7B24CC23687602AB10113B9E35623018`
- Stage-2 extended-arithmetic acceptance test:
  `C5D3B4968B8C38127FD9CBD8181614E4CA2CC3F7CF2D2C407FACF0B2D39E11F8`
- internal Stage observation adapter checkout bytes:
  `9B2CE5C479F6FA10922E5231AB72C850BA645AF1D1F49690644E27BDB3E1A994`

## Acceptance-gate impact

This closes the first exact four-operand/eight-instruction arithmetic chain
through the Stage-1-built Stage-2 compiler. It does not make expression length
fully unbounded and does not close ADR 0005 cutover rule 5: Stage 2 still
cannot rebuild the complete compiler graph, no Stage-3 compiler exists, and
Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I167's 78.4%, 0.5 is conservatively **78.7% total**, **+0.3
percentage points** for this extended-expression subgate.

## Handoff inventory

I168 adds only the extended arithmetic path to the isolated compiler phase
files and internal observation adapter, plus one focused test and this receipt.
Existing dirty I162-I167 files and pre-existing untracked `.work/` content
were preserved. No commit, push, merge, renderer edit, UI launch, or generated
artifact was added to Git.
