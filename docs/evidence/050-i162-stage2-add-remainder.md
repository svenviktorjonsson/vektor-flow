# 050-I162 Stage-2 add-remainder evidence

## Scope

- Base: `563bd6fe`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`
- State: GREEN, uncommitted for Integration Steward review

I162 extends the Stage-1-built Stage-2 compiler CLI through remainder
precedence inside a printed expression over an earlier binding:

```vkf
value: 31
:: value + 7 % 4
```

The VKF-owned general token tape retains the already-supported percent token.
The parser validates the explicit output and mixed-arithmetic shape, including
that the output loads the declared binding. Existing typed-IR and Machine-IR
contracts emit `push 31`, `push 7`, `push 4`, `remainder`, `add`, `return` and
validate maximum stack depth three.

The Stage-2 native executable exits zero with stdout `34`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the internal
`machine_ir.closed_add_remainder.typed_module_pipeline` component. No public
syntax, precedence rule, API, diagnostic, MachineModule version, opcode,
receipt schema, or ABI changed.

## RED and GREEN receipts

Environment: Windows x64, Node `v24.11.0`, CMake `4.3.0`, MSBuild `16.11.6`.
All spawned processes used hidden windows. No UI or performance workload ran.

RED command:

```powershell
$env:VKF_NATIVE_BIN='J:\build\i150-release-fast\bin\Release'
$env:VKF_TEST_WORK_ROOT='J:\.work'
node --test tests/bootstrap/stage2-add-remainder-compiler-cli.test.mjs
```

- exit `1`, 0/1 passed in 8.61 s;
- intended failure: the Stage-1-built CLI reached the new tracer, but Stage 0
  rejected its missing VKF pipeline with
  `machine IR supports direct calls only`;
- source graph bundle: `0857AA59F1D3BF4C85CBD2C0941DDD2AC73254DF8B34A94FB8A29BC7B78E8C5E`;
- compiler binary: `C4ADCD0EE895FE86621A3354C465EB2BEA5B82BE693D58E1CD5F2AFFD228C33A`.

GREEN build:

```powershell
cmake --build J:\build\i150-release-fast --config Release --target vkf_strict
```

- exit `0` in 20.94 s;
- compiler binary:
  `B34967763DA1ED1D0F93E120C2739FB784E55E250C3EB3F7E24D7F70F24B5F79`.

GREEN command: the RED command above.

- exit `0`, 1/1 passed in 16.88 s;
- exact Stage-0/Stage-2 stdout match: `34`;
- two clean emissions were byte-identical;
- an unknown demanded binding was atomically rejected.

Differential and robustness command:

```powershell
node --test `
  tests/bootstrap/stage2-add-divide-compiler-cli.test.mjs `
  tests/bootstrap/stage1-compiler-tagged-remainder.test.mjs `
  tests/bootstrap/stage1-bootstrap-source-graph.test.mjs
```

- exit `0`, 4/4 passed in 15.72 s;
- adjacent Stage-2 division remained exact;
- the independent Stage-1 remainder demand-lowering stayed green;
- source ordering and every canonical source/bundle digest stayed green.

Locked bundle command:

```powershell
$env:VKF_BOOTSTRAP_FRONTEND_BIN=$env:VKF_NATIVE_BIN
$env:VKF_BUNDLE_ARTIFACT_TOOL=
  'J:\build\i150-release-fast\bin\Release\vkf_bootstrap_bundle_artifact_smoke.exe'
node --test tests/bootstrap/stage1-bootstrap-executable-bundle.test.mjs
```

- exit `0`, 1/1 passed in 36.94 s;
- all ten declared compiler sources emitted as executables and ran successfully.

`git diff --check` passed; Git only reported existing LF-to-CRLF conversion
warnings.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `54418F698F9E393471281E4EC1416FDE368BBD8D403F2119CB84A598B29E0AC7`
- bootstrap manifest checkout bytes:
  `530F7BBA5174E61CEEE47BDB152BCB69F2D86A1CEA7A1B944BB28E3E9971ABA1`
- canonical lexer source:
  `9B427E41903D3B55B949503D34004D500E00FFFF5D2DDDA0DB51C5BE99CD4425`
- canonical parser source:
  `0695A3DEAA98EAE31EBAEEB14BA20BF28AE0E963BB6DA135B71091BA8E885094`
- canonical typed-IR source:
  `B20109A2E1AE990F71CA96351A237B70080B25477B190CC901ECBACCD4B573CE`
- canonical Machine-IR source:
  `740343F0F44CD8A6FA178DDE8D4851A0056EF9AAA37521C14C01ECEBE4A93A9F`
- canonical compiler facade source:
  `7BE4D6AFB77F09B4C05340D2FE66BF7B6E8B3E1E4859D44EA76958296C29C9C2`
- Stage-2 add-remainder acceptance test:
  `43786223EEF952E9A699E0AE3B9AD50EE3DC6454E0E7487715CC49D8B009A737`
- internal Stage observation adapter checkout bytes:
  `71021DD5A0378BB238D9D7BB341A4EED12B8309413902F41D6934967328A889A`

## Acceptance-gate impact

This closes the first exact Stage-2 remainder-precedence output over a
demanded prior binding and connects percent through the general Stage-2 token
tape. It does not close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild
the complete compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage
3 have not run the same full suite.

Re-evaluated from I161's 77.0%, 0.5 is conservatively **77.2% total**, **+0.2
percentage points** for this remainder-precedence and token-tape subgate.

## Handoff inventory

Writable packet files are limited to the compiler facade, lexer, parser,
typed IR, Machine IR, native Stage-observation adapter, generated bootstrap
digest manifest, focused acceptance test, and this receipt. Existing untracked
`.work/` content predates I162 and was preserved untouched. No commit, push,
merge, renderer edit, UI launch, or generated artifact was added to Git.
