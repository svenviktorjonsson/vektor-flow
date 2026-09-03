# 050-I163 Stage-2 add-power evidence

## Scope

- Git base: `563bd6fe`
- Consumed packet: uncommitted I162 GREEN contract
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I163 extends the Stage-1-built Stage-2 compiler CLI through power precedence
inside a printed expression over an earlier binding:

```vkf
value: 31
:: value + 2 ^ 3
```

The VKF-owned general token tape retains the already-supported caret token.
The parser validates the explicit output and mixed-arithmetic shape, including
that the output loads the declared binding. Existing typed-IR and Machine-IR
contracts emit `push 31`, `push 2`, `push 3`, `power`, `add`, `return` and
validate maximum stack depth three.

The Stage-2 native executable exits zero with stdout `39`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the internal
`machine_ir.closed_add_power.typed_module_pipeline` component. No public
syntax, precedence rule, API, diagnostic, MachineModule version, opcode,
receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-add-power-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 13.57 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- consumed source graph bundle:
  `54418F698F9E393471281E4EC1416FDE368BBD8D403F2119CB84A598B29E0AC7`;
- consumed compiler binary:
  `B34967763DA1ED1D0F93E120C2739FB784E55E250C3EB3F7E24D7F70F24B5F79`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 28.68 s;
- compiler binary:
  `C3388254A18E899BDE18DAA7A2F12B59B3020D6A6842CAC2514A65970DF42643`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 21.21 s;
- exact Stage-0/Stage-2 stdout match: `39`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-add-remainder-compiler-cli.test.mjs `
  tests/bootstrap/stage1-compiler-tagged-power.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 4/4 passed in 19.82 s;
- preceding Stage-2 remainder remained exact;
- the independent Stage-1 power demand-lowering stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 39.63 s;
- all ten declared compiler sources emitted as executables and ran successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `11B8E6AB38FCC000796C394F2D35CDB8ADCAFB6835591011CC827D07DFB3CD49`
- bootstrap manifest checkout bytes:
  `4911D8BCC81B7470634A8EAD9ED99774732DD040780DC413F8FCD961AC441F13`
- canonical lexer source:
  `520EF065ADC28125EB255E1CF23FDB51F33A1B27081DA6E5AA59F8A213B19393`
- canonical parser source:
  `E835F14CB3C6BA808A6DA44BE806380FE5F484C006BBB96967AC19DFC6C81B17`
- canonical typed-IR source:
  `D9FCCABBAD6B8B94B7E1FE18197A9BCCB23861363C3D4876FB747DA5C988E40A`
- canonical Machine-IR source:
  `50BE795AA376219B09179B7530FB36A167B9392838479CE4841C78278457F74C`
- canonical compiler facade source:
  `6FC5EC203F495978DC0604EDA2965B2DA72C8F25B81F666337F5BA08368719C4`
- Stage-2 add-power acceptance test:
  `74BA7D35F402B95575AE1BFCB5E0445C7318E4FB219CED1A022A0482E41F9F0F`
- internal Stage observation adapter checkout bytes:
  `F54BB185898EE738ADEA42A87B8326D927B0E4161C58A4F2DE7475AA109D9B3B`

## Acceptance-gate impact

This closes the first exact Stage-2 power-precedence output over a demanded
prior binding and connects caret through the general Stage-2 token tape. It
does not close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild the
complete compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3
have not run the same full suite.

Re-evaluated from I162's 77.2%, 0.5 is conservatively **77.4% total**, **+0.2
percentage points** for this power-precedence and token-tape subgate.

## Handoff inventory

I163 adds only caret/power lines to the same isolated compiler path family
already owned by I162, plus one focused test and this receipt. Existing dirty
I162 files and pre-existing untracked `.work/` content were preserved. No
commit, push, merge, renderer edit, UI launch, or generated artifact was added
to Git.
