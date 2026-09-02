# 050-I158 Stage-2 nested-addition evidence

## Scope

- Base: `b03f70a4`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I158 extends the Stage-1-built Stage-2 compiler CLI through one nested
arithmetic expression over an earlier binding:

```vkf
value: 31
:: value + 1 + 2
```

The VKF-owned token tape validates the already-supported explicit output and
nested-addition shape, including that the output loads the declared binding.
Existing typed-IR and Machine-IR producers preserve the three values and emit
`push 31`, `push 1`, `add`, `push 2`, `add`, `return`. Existing
target-independent validation proves maximum stack depth two.

The Stage-2 native executable exits zero with stdout `34`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the demanded binding with an unknown name
is rejected before replacing either prior output.

The native observation handoff admits the already-existing internal
`machine_ir.closed_nested_addition.typed_module_pipeline` component. No public
syntax, API, diagnostic, MachineModule version, opcode, receipt schema, or ABI
changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I157 compiler graph, the new acceptance test reached the
  Stage-1-built compiler CLI but failed before artifact production with
  `machine IR supports direct calls only`; command exited `1`, 0/1 passed, in
  7.98 s.
- GREEN: `node --test`
  `tests/bootstrap/stage2-nested-addition-compiler-cli.test.mjs` passed 1/1 in
  15.59 s. It verifies exact Stage-0 stdout, deterministic clean emission, and
  atomic rejection of an unknown demanded binding.
- adjacent Stage-2 closed-binding CLI passed 1/1 in 27.86 s while sharing the
  runner with both differential commands;
- existing nested/mixed-arithmetic Stage-1 coverage passed 5/5 in 89.78 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 45.86 s;
- fresh `vkf_strict` Release rebuild passed;
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
  `8B037F054199E0D44C769FB3D36EDCDBD84CBAECAD5F0478025CB173FAEA20B6`
- bootstrap manifest checkout bytes:
  `8CD97191A3D4FF506A1EB601CFEDD6BDDCB7C839B65436CF096647CFD2036F01`
- canonical parser source:
  `12F2F3FAD26B90969E70E1F6912D53191B515001242CB1445DEDA03C99F26988`
- canonical compiler facade source:
  `2912575A38388F3BB969F1ED02C0E2B86CC9457086F54074AF91002EC0D54A74`
- Stage-2 nested-addition tracer checkout bytes:
  `01F8ACAD5E7008C3337F7761225AACD99D7F954D4224EDDDF44A8B94463A62B7`
- internal Stage observation adapter checkout bytes:
  `5385D8DE996DAAF271C7813A2B85B1D3DA8A1CB7ADEA63C418AADFED180F7C23`
- fresh Release `vkf-strict.exe`:
  `50728241D9FBF6F88B41D4C70A776ABD5C56F1575CC24ACC5D2CE76E5428D48F`

## Acceptance-gate impact

This closes the first exact Stage-2 nested arithmetic output over a demanded
prior binding, while preserving deterministic emission and atomic invalid-name
rejection. It does not close ADR 0005 cutover rule 5: Stage 2 still cannot
rebuild the complete compiler graph, no Stage-3 compiler exists, and Stage 2
and Stage 3 have not run the same full suite.

Re-evaluated from I157's 75.9%, 0.5 is conservatively **76.2% total**, **+0.3
percentage points** for this nested-arithmetic subgate.
