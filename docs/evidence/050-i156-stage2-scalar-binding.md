# 050-I156 Stage-2 scalar-binding evidence

## Scope

- Base: `dce3c5dc`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I156 extends the Stage-1-built Stage-2 compiler CLI through one ordinary
scalar binding consumed by output:

```vkf
value: 5
:: value
```

The VKF-owned token tape and bounded parser validate the binding, numeric
value, output marker, and binding load. Typed IR preserves a `store_binding`
and `load` under `io.print`. Machine-IR lowering emits the exact optimized
Stage-0 shape: push the constant, store local zero, push the propagated
constant, and return one f64. The VKF validator recomputes the exact stack
maximum of one.

The Stage-2 native executable exits zero with stdout `5`, matching the
independent Stage-0 artifact. Two clean emissions preserve byte-identical PE
and provenance receipts. Replacing the output binding with an unknown name is
rejected before replacing either prior output.

The native observation handoff gains only the internal
`machine_ir.scalar_binding.typed_module_pipeline` component. No public syntax,
API, diagnostic, MachineModule version, opcode, receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I155 compiler graph, the new acceptance test reached the
  Stage-1-built CLI but failed before producing a scalar-binding Stage-2
  artifact with `machine IR supports direct calls only`; command exited `1`,
  0/1 passed, in 7.03 s.
- The first implementation reached the new validator but the current direct
  backend rejected dynamic dotted instruction indexing. Replacing that loop
  with four explicit projections preserved the same target-independent stack
  algorithm inside the currently supported compiler subset.
- GREEN: `node --test`
  `tests/bootstrap/stage2-scalar-binding-compiler-cli.test.mjs` passed 1/1 in
  14.62 s. It verifies exact Stage-0 stdout, deterministic clean emission, and
  atomic rejection of a mismatched binding load.
- adjacent Stage-2 import-only CLI passed 1/1 in 14.20 s;
- existing closed-binding Machine-IR encode tracer passed 1/1 in 10.81 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 35.86 s;
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
  `6E9AB9E5C16E2DE46706CEB566C532AA1B606CA2D179F84BCDB27246BF379E49`
- bootstrap manifest checkout bytes:
  `919D86A869264D022E30673B8213390A077B9076F12A63B1390ED4C141549627`
- canonical parser source:
  `796074F9E54EE7CCEA3DC4A889B7809BD57A7F400BF74F5ED16BC771B0D6F5E1`
- canonical typed-IR source:
  `3DBD05BEA403744FE4C45D1C54F67F1CDDFAA11B4B1F284E7B15A48B4CB925B0`
- canonical Machine-IR source:
  `3E18D38143DFD9E815A1AA1E3D0D2CE474CADC737547E9ECBEC7140CD8EA2A9E`
- canonical Machine-IR validator source:
  `2B7398D311643571447EAEE55439C77E05C09980EC88E493309CEA2BB226C92E`
- canonical compiler facade source:
  `03DDD58A91FF7CD623BE69097D90122E02920BFE47AB59DB44E3562ED31549AC`
- Stage-2 scalar-binding tracer checkout bytes:
  `C86ED8E9539D701526062EAF5900210FF86B83A8CF5F7545E046711C689133CE`
- internal Stage observation adapter checkout bytes:
  `482BF6E464A8BEB5DB2B2716E41AE38D521122300996F1BF63129E1E4EE5682A`
- fresh Release `vkf-strict.exe`:
  `9258AF163052AA99DBBFB6ED25697FA6BD913415BAECFF2F40945462D045EFD9`

## Acceptance-gate impact

This closes the first exact ordinary binding, local store, demanded load,
constant propagation, and direct output through the actual Stage-1-built
Stage-2 compiler CLI. It does not close ADR 0005 cutover rule 5: Stage 2 still
cannot rebuild the complete compiler graph, no Stage-3 compiler exists, and
Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I155's 75.0%, 0.5 is conservatively **75.5% total**, **+0.5
percentage points** for this scalar-binding and output capability subgate.
