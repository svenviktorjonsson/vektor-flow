# 050-I167 Stage-2 grouped-add-floor-division evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I166 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I167 extends the Stage-1-built Stage-2 compiler CLI through grouping that
changes arithmetic evaluation order:

```vkf
value: 31
:: (value + 7) // 2
```

The VKF-owned parser validates the existing grouping tokens and binding
identity. Typed IR preserves the grouped operation, and Machine IR emits
`push 31`, `push 7`, `add`, `push 2`, `floor-divide`, `return`, with validated
maximum stack depth two. This differs observably from I166, where floor
division precedes addition.

The Stage-2 native executable exits zero with stdout `19`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the internal
`machine_ir.closed_grouped_add_floor_divide.typed_module_pipeline` component.
No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-grouped-add-floor-divide-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 10.19 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `2C1AB21F76B6E8EDF50862464F81BA9B0F5AEF73C3DE74C6D764D23F128469E8`;
- consumed compiler binary:
  `BC73B8EAD0E254717A052642D80F9ADA036B14D2E1663127EC0F694B574285A8`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 22.38 s;
- compiler binary:
  `AD38A27AD32631C2DF554312482A0A54955E3EFE4BCED6F8F9AC4315A550609B`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 13.27 s;
- exact Stage-0/Stage-2 stdout match: `19`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-add-grouped-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-negative-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage1-compiler-tagged-floor-division.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 21.11 s;
- I166's opposite grouping and I165's signed floor division remained exact;
- the independent Stage-1 floor-division demand-lowering stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 35.71 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `6DD62A717EA84D1B4B9EC08660173824C3B1973950637B5CE792BBC9459F3CD8`
- bootstrap manifest checkout bytes:
  `9521F9F1BB130556249FA8EEBD6806701493AC614C740078C2C29F6F5E10C5FF`
- canonical parser source:
  `7FAC26A45B1E77C6E57A001AF5982DE0D5B32174956D567E343CFA84454CDBC9`
- canonical typed-IR source:
  `111916DCC2C06BCD8944A73380005F18BEE5A8B6C075B5BB24A9EF7AD34FEA5D`
- canonical Machine-IR source:
  `4F3679A7883C3458018D7CC25C911F6E44E0D29A72647EE34D64902EC3DB35CB`
- canonical compiler facade source:
  `4331907082F7004BBF65FCC52BE83D7E83E2EC142751E6052284997AC91CAB83`
- Stage-2 grouped-add-floor-division acceptance test:
  `B28F9506719D042FB7926EEFD4824FA4FF9B2B20240A68341D419361D6BC702F`
- internal Stage observation adapter checkout bytes:
  `E584AC7095D4AA58FDA3D71D1EB5404F91C4DB993080FD436CAB678C9F2D39BF`

## Acceptance-gate impact

This closes the first exact grouping-driven evaluation-order change through
the Stage-1-built Stage-2 compiler. It does not close ADR 0005 cutover rule 5:
Stage 2 still cannot rebuild the complete compiler graph, no Stage-3 compiler
exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I166's 78.1%, 0.5 is conservatively **78.4% total**, **+0.3
percentage points** for this grouped evaluation-order subgate.

## Handoff inventory

I167 adds only the grouped operation path to the isolated compiler phase files
and internal observation adapter, plus one focused test and this receipt.
Existing dirty I162-I166 files and pre-existing untracked `.work/` content
were preserved. No commit, push, merge, renderer edit, UI launch, or generated
artifact was added to Git.
