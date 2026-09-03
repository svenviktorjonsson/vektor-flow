# 050-I166 Stage-2 grouped-floor-division evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I165 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I166 extends the Stage-1-built Stage-2 compiler CLI through parenthesized
grouping around an existing floor-division expression:

```vkf
value: 31
:: value + (7 // 2)
```

The VKF-owned parser validates the existing left and right grouping tokens,
removes only those delimiters, and reuses I164's typed-IR, Machine-IR,
validation, and native observation handoff. The emitted instruction sequence
remains `push 31`, `push 7`, `push 2`, `floor-divide`, `add`, `return`, with
maximum stack depth three.

The Stage-2 native executable exits zero with stdout `34`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
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
node --test tests/bootstrap/stage2-add-grouped-floor-divide-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 12.97 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `938B68625487046CAF7B19AAB353D225CAD155E70B55E8E48E91612BE1D01F04`;
- consumed compiler binary:
  `BC73B8EAD0E254717A052642D80F9ADA036B14D2E1663127EC0F694B574285A8`.

GREEN build and focused command:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
node --test tests/bootstrap/stage2-add-grouped-floor-divide-compiler-cli.test.mjs
```

- exit `0`; build and focused test completed in 22.82 s;
- focused result: 1/1 passed in 19.35 s;
- exact Stage-0/Stage-2 stdout match: `34`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected;
- compiler binary remained byte-identical because I166 changes VKF source
  only:
  `BC73B8EAD0E254717A052642D80F9ADA036B14D2E1663127EC0F694B574285A8`.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-add-negative-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage1-compiler-tagged-floor-division.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 36.91 s;
- I164 unsigned and I165 signed floor division remained exact;
- the independent Stage-1 floor-division demand-lowering stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 37.10 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `2C1AB21F76B6E8EDF50862464F81BA9B0F5AEF73C3DE74C6D764D23F128469E8`
- bootstrap manifest checkout bytes:
  `18BDC5DA247BF8659F66860B9ED5AB5B5B55D5540B41412E1AC65304BD959014`
- canonical parser source:
  `0955B2C2231DBAC6121D9092F1EFA274A58BA3D1AB6F565FF17D91B4F817FA4D`
- canonical compiler facade source:
  `C3BFE9EC4705B5AA481AC664339CEFC729A007FCF6894DD048709AE29769D647`
- Stage-2 grouped-floor-division acceptance test:
  `06EA3B3F51D469EA1ECCC553B09D6DE39ABDC6C45ED895032354E3E609C8C879`
- reused internal Stage observation adapter checkout bytes:
  `306E511915FA8A7AB69A6598561BC27AA4641735B26AB3F0BB9C9EEE889AE44E`

## Acceptance-gate impact

This closes the first exact parenthesized arithmetic group through the
Stage-1-built Stage-2 compiler. It does not close ADR 0005 cutover rule 5:
Stage 2 still cannot rebuild the complete compiler graph, no Stage-3 compiler
exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I165's 77.9%, 0.5 is conservatively **78.1% total**, **+0.2
percentage points** for this grouping-delimiter and precedence subgate.

## Handoff inventory

I166 adds one parser normalizer and compiler-facade method to the isolated
compiler path, plus one focused test and this receipt. Existing dirty
I162-I165 files and pre-existing untracked `.work/` content were preserved.
No native adapter, commit, push, merge, renderer edit, UI launch, or generated
artifact was added to Git.
