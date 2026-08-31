# 050-I66B native build-helper evidence

## Scope

- Base: `b78b4170c94e08b6cd696fb74139dd7aa81f1675`
- Implementation: `0dedca4b6c2214ac8998e2996f81faf19646b6c8`
- Branch: `codex/0.5/050-i66b-native-build-helper`
- Owned paths:
  - `scripts/build-native-compiler.ps1`
  - `docs/evidence/050-i66b-native-build-helper.md`

The packet adds the existing CSV demand-scanner implementation to the three
helper targets that compile `vkf_ast_to_ir_smoke.cpp`: `vkf`, `vkf-strict`,
and `vkf_ast_to_ir_smoke`. It changes no VKF syntax, public API, ABI, schema,
diagnostic, or generated program output.

## RED

Command:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i66b-red/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: link failed. The exact unresolved members were:

- `CsvDemandSourceScanner::scan`
- `CsvDemandSourceScanner::raw_column_names`
- `CsvDemandSourceScanner::column_count`
- `CsvDemandSourceScanner::row_count`

## GREEN build

Command:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i66b-green/bin' `
  -OnlyTargets @('vkf-strict')
```

Result: exit 0; `vkf-strict.exe` produced. Binary SHA-256:
`2344E80D8763420C815458844FEC34A36DD1867C42864680BB932D099F463C86`.

The same helper also linked both other affected frontend targets:

```powershell
.\scripts\build-native-compiler.ps1 `
  -OutputDirectory 'build/050-i66b-other-frontends/bin' `
  -OnlyTargets @('vkf','vkf_ast_to_ir_smoke')
```

Result: exit 0.

- `vkf.exe` SHA-256:
  `6968B20217CB99DEC4CC54AD8B519B4A7C5637341CE71FE9F6907E911BA344EE`
- `vkf_ast_to_ir_smoke.exe` SHA-256:
  `D3A150A5D9196EA8CCA49DA70C4DC583BCCC61D7EB47FB12E64E2D39C5FDE9DE`

## Affected verification

The following matrix used the strict binary produced by the helper:

```powershell
$env:VKF_NATIVE_BIN=(Resolve-Path 'build/050-i66b-green/bin').Path
node --test tests/bootstrap/stage1-machine-ir-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-conditional-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-loop-stack-validation.test.mjs tests/bootstrap/stage1-machine-ir-dispatch-takeover.test.mjs tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-validation-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-conditional-pipeline-dispatch.test.mjs tests/bootstrap/stage1-machine-ir-loop-pipeline-dispatch.test.mjs
```

Result: 35 passed, 0 failed. This includes I66 normal entry-stack balance and
the adjacent normal, conditional, and loop validation/dispatch coverage.

## Hashes

- `scripts/build-native-compiler.ps1`:
  `1FE0067BB1594A9748ED0C283BB28199494726BAFAEB48292728689AD5C4C09F`

## Further helper observations

- With `-OnlyTargets @('vkf-strict')`, the helper still prints a path to
  `vkf.exe`, although only `vkf-strict.exe` was requested and produced.
- A `vkf` binary built alone links, but running it requires sibling tool
  artifacts that an isolated `-OnlyTargets @('vkf')` build does not produce.

Those pre-existing selection/output behaviors are not missing-source failures
and were left outside this bounded packet.

## Acceptance-gate impact

This removes the build-helper gap found during I66 verification: the documented
Clang helper can again produce a current strict compiler, and that compiler
passes the affected 0.5.0 Machine IR validation and dispatch matrix. It
strengthens reproducibility for Gate 4 but does not by itself close that gate.
