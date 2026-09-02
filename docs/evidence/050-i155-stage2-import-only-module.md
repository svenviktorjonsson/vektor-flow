# 050-I155 Stage-2 import-only module evidence

## Scope

- Base: `6a16b4bf`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I155 extends the Stage-1-built Stage-2 compiler CLI through one existing
standard-library import statement:

```vkf
system: .system
```

The VKF-owned scalar-safe token tape recognizes the identifier, colon, dot,
module identifier, newline, and EOF. A bounded parser projection validates
the frozen `system` alias and module relationship. Because an unused standard
import has no executable effect, the compiler reuses the exact empty typed
module, MachineModule v23 lowering, and zero-stack validator established in
I154.

The resulting Stage-2 native executable exits zero with the same empty stdout
as the independent Stage-0 artifact. Two clean emissions preserve
byte-identical PE and provenance receipts. Appending `:: 1` is rejected before
replacing either prior output.

This packet reuses the internal
`machine_ir.empty.typed_module_pipeline`; no native adapter changed. It does
not claim general package resolution or arbitrary import aliases. No public
syntax, API, diagnostic, MachineModule version, opcode, receipt schema, or ABI
changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I154 compiler graph, the new acceptance test reached the
  Stage-1-built CLI but failed before producing an import-only Stage-2
  artifact with `machine IR supports direct calls only`; command exited `1`,
  0/1 passed, in 7.48 s.
- GREEN: `node --test`
  `tests/bootstrap/stage2-import-only-compiler-cli.test.mjs` passed 1/1 in
  12.89 s. It verifies exact empty stdout, deterministic clean emission, and
  atomic rejection after appending `:: 1`.
- adjacent Stage-2 comment-only empty-module CLI passed 1/1 in 11.60 s;
- adjacent Stage-2 count-to loop CLI passed 1/1 in 27.68 s;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 27.92 s;
- the fresh I154 Release `vkf-strict.exe` remained the native adapter because
  this packet changes VKF source only;
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
  `0ADC4BCE9AC2FA6F4BE172FDBCEA64C50DC438B3439A7334A3B4BDB93FA7C341`
- bootstrap manifest checkout bytes:
  `58A69E699D5E20AB1E3DF9A30C2AF14066522926F6C2AF2EC1296DEE6695B0CF`
- canonical parser source:
  `ABEA89CD74444470D712634839739B06B220377A47B773D23601A152A7FFE9CA`
- canonical compiler facade source:
  `7ED59862CEED7AD72F463A4D57420B4DE1403EF8DA968D660A88CAE2429DD1F9`
- Stage-2 import-only tracer checkout bytes:
  `C0D74E2A1EB9F226E5C644BC34F06B2AC9F42185AF1D4944DA04F74B645F2A96`
- reused Release `vkf-strict.exe`:
  `AB8EF5933274D0C294C846FF9C7A6FC1A8BAB3A644896B2520CEEF851AED61EF`

## Acceptance-gate impact

This closes the first exact import statement through the actual
Stage-1-built Stage-2 compiler CLI while preserving the no-output module
contract. It does not close general import resolution or ADR 0005 cutover rule
5: Stage 2 still cannot rebuild the complete compiler graph, no Stage-3
compiler exists, and Stage 2 and Stage 3 have not run the same full suite.

Re-evaluated from I154's 74.7%, 0.5 is conservatively **75.0% total**, **+0.3
percentage points** for this exact standard-import syntax subgate.
