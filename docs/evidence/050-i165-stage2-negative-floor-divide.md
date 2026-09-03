# 050-I165 Stage-2 signed-floor-division evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I164 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I165 extends the Stage-1-built Stage-2 compiler CLI through unary minus at a
floor-division operand:

```vkf
value: 31
:: value + -7 // 2
```

The VKF-owned parser normalizes the existing unary-minus token and numeric
literal to `-7`, then reuses I164's typed-IR, Machine-IR, validation, and native
observation handoff. The emitted instruction sequence remains `push 31`,
`push -7`, `push 2`, `floor-divide`, `add`, `return`, with maximum stack depth
three.

The Stage-2 native executable exits zero with stdout `27`, matching the
independent Stage-0 artifact and proving floor rather than truncate-toward-zero
behavior for a negative dividend. Two clean emissions preserve byte-identical
PE and provenance receipts. Replacing the demanded binding with an unknown
name is rejected before replacing either prior output.

No public syntax, precedence rule, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-add-negative-floor-divide-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 8.83 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `17924E13846EA633652113CB85945DB1C309288F30DDD767E145B03E9426202A`;
- consumed compiler binary:
  `BC73B8EAD0E254717A052642D80F9ADA036B14D2E1663127EC0F694B574285A8`.

The first implementation run remained RED in 11.45 s with exit status `3`.
An executable VKF token-tape probe showed that the established general
function scanner represents minus with internal kind `20`; aligning the
parser with that frozen representation produced GREEN. The temporary probe
source was removed before handoff.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 3.62 s;
- compiler binary remained byte-identical because I165 changes VKF source
  only:
  `BC73B8EAD0E254717A052642D80F9ADA036B14D2E1663127EC0F694B574285A8`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 12.56 s;
- exact Stage-0/Stage-2 stdout match: `27`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-add-floor-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage2-add-subtract-compiler-cli.test.mjs `
  tests/bootstrap/stage1-compiler-tagged-floor-division.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 5/5 passed in 17.99 s;
- I164 unsigned floor division and Stage-2 subtraction remained exact;
- the independent Stage-1 floor-division demand-lowering stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 36.82 s;
- all ten declared compiler sources emitted as executables and ran
  successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `938B68625487046CAF7B19AAB353D225CAD155E70B55E8E48E91612BE1D01F04`
- bootstrap manifest checkout bytes:
  `24B441C9F448CCE37F44753099C301C81B2984955358EE48C7BFD521AA1843BF`
- canonical parser source:
  `AB2DB6FC37229183057DA3CF6DD2742D1BD255920D5C06C9C91360074E2FD0D5`
- canonical compiler facade source:
  `F472EF8E99A64E23BB8BBAE33229E298311ACF9D84655105CF9FD6BE7FE84757`
- Stage-2 signed-floor-division acceptance test:
  `14B79E8B226E7060CDA20EF19C9C289C63CDD48B9527659F63AFD1C10A1E0759`
- reused internal Stage observation adapter checkout bytes:
  `306E511915FA8A7AB69A6598561BC27AA4641735B26AB3F0BB9C9EEE889AE44E`

## Acceptance-gate impact

This closes the first exact Stage-2 unary-negative arithmetic output and the
negative-dividend floor semantic through the Stage-1-built compiler. It does
not close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild the complete
compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3 have not
run the same full suite.

Re-evaluated from I164's 77.7%, 0.5 is conservatively **77.9% total**, **+0.2
percentage points** for this unary-normalization and signed-floor subgate.

## Handoff inventory

I165 adds one parser normalizer and compiler-facade method to the isolated
compiler path, plus one focused test and this receipt. Existing dirty
I162-I164 files and pre-existing untracked `.work/` content were preserved.
No native adapter, commit, push, merge, renderer edit, UI launch, or generated
artifact was added to Git.
