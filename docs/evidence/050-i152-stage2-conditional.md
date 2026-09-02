# 050-I152 Stage-2 conditional compiler evidence

## Scope

- Base: `cff3edfa`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I152 extends the Stage-1-built minimal Stage-2 compiler CLI through the
already-locked positive-conditional tracer:

```vkf
system: .system
positive(x:num) -> num:
    x > 0?
        @: 1
    @: 0
:: positive(system.cpu_count())
```

The VKF-owned lexer, parser projection, compiler facade, typed lowering,
Machine-IR lowering, and target-independent stack validator produce the
existing conditional module. The Stage-2 CLI sends that exact observation to
the existing compiler-owned x64 writer, executes the resulting artifact, and
matches the independent Stage-0 oracle. Two clean emissions preserve stdout
and byte-identical PE and provenance receipts.

The native observation handoff now accepts the already-existing
`machine_ir.numeric_positive_conditional.typed_module_pipeline` component. It
continues to own validation, provenance, and PE writing only. No public syntax,
API, diagnostic, MachineModule version, opcode, receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I151 strict compiler, the new acceptance test reached the
  Stage-1-built CLI but failed before producing a conditional Stage-2 artifact
  with `machine IR supports direct calls only`; command exited `1`, 0/1 passed,
  in 6.54 s.
- GREEN: `node --test`
  `tests/bootstrap/stage2-conditional-compiler-cli.test.mjs` passed 1/1 in
  55.64 s using the fresh Release compiler. The test also rejects a mutated
  return value before output and proves the previously emitted artifact and
  provenance remain byte-identical.
- adjacent Stage-2 function-call CLI tracer passed 1/1 in 34.99 s;
- adjacent minimal Stage-2 arithmetic CLI tracer passed 1/1 in 19.71 s;
- conditional typed-module pipeline differential and malformed-input suite
  passed 3/3 in 52.58 s;
- conditional stack maximum differential passed 1/1 in 8.89 s with exact
  maxima `[1, 1, 2]`;
- bootstrap source graph, canonical hashes, and full ten-unit executable bundle
  passed 3/3 in 42.23 s;
- fresh `vkf_strict` Release rebuild passed;
- the first adjacent Stage-2 rerun used the long physical worktree path and
  reproduced Windows nested-artifact path failure. Both older Stage-2 tests now
  honor `VKF_TEST_WORK_ROOT`; their identical short-root reruns passed and no
  semantic expectation was weakened;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

Executable tests used
`VKF_NATIVE_BIN=J:\build\i150-release-fast\bin\Release` and short work roots
under `J:\.work`. The bundle test also used that directory for
`VKF_BOOTSTRAP_FRONTEND_BIN` and its
`vkf_bootstrap_bundle_artifact_smoke.exe` as `VKF_BUNDLE_ARTIFACT_TOOL`.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `2E9432123574B118BC23CC0B59ADBB24480076E7B9503ACAE3CCFFFE86842614`
- bootstrap manifest checkout bytes:
  `36D69FA67F21E2FF740E289C1E1734CE674AF3B9AC751EB4922D675D7E46981A`
- canonical lexer source:
  `9681B86EDA27FAA32380C0D4C57DF9238F031560001F93A4AD175FC45D2CA923`
- canonical parser source:
  `24F17449AF3FAD733463EDDD509698805F302CC0F357407CF3D9E903F1D39AFD`
- canonical compiler facade source:
  `697CDA21AAA6C4E28A072AA1B7E862F03B202B0D19C820853E898BEA5263B747`
- Stage-2 conditional tracer checkout bytes:
  `4EF3642212D8D37D1C7DB116C97AD6EB3574E7BE1F47BADDCBB454C8E994688B`
- internal Stage observation adapter checkout bytes:
  `0A5B78D736C955E5416EA1A4E80AF5FD15D2DECAB00D333983F1C894E545843F`
- fresh Release `vkf-strict.exe`:
  `81F96D5D133189CA0FCE1B1FFBEB3DE593F7C660912E5BF0E005D546B7BC8CC5`

## Acceptance-gate impact

This closes the first existing conditional branch and two-return function
through the actual Stage-1-built Stage-2 compiler CLI while preserving
deterministic repeated emission and atomic rejection. It does not close ADR
0005 cutover rule 5: Stage 2 still cannot rebuild the complete compiler graph,
no Stage-3 compiler exists, and Stage 2 and Stage 3 have not run the same full
suite.

Re-evaluated from I151's 73.0%, 0.5 is conservatively **73.6% total**, **+0.6
percentage points** for this real Stage-2 control-flow capability subgate.
