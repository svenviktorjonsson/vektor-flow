# 050-I153 Stage-2 loop compiler evidence

## Scope

- Base: `8458807e`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I153 extends the Stage-1-built minimal Stage-2 compiler CLI through the
already-locked count-to loop fixture:

```vkf
count_to(limit:num) -> num:
    value: 0
    value < limit?>
        .value: value + 1
    @: value

:: count_to(3)
```

The VKF-owned lexer now recognizes the already-supported less-than and plus
tokens in this bounded function projection and treats CR in canonical CRLF
source as layout. The VKF parser projection validates the exact declaration,
local initialization, loop condition, update, return, and call relationships.
The compiler facade then uses the existing typed loop, Machine-IR lowering,
and target-independent stack validator. The Stage-2 CLI sends that exact
MachineModule observation to the existing compiler-owned x64 writer, executes
the resulting artifact, and matches the independent Stage-0 oracle. Two clean
emissions preserve stdout and byte-identical PE and provenance receipts.

The native observation handoff now accepts the already-existing
`machine_ir.numeric_count_to_loop.typed_module_pipeline` component. It
continues to own validation, provenance, and PE writing only. No public syntax,
API, diagnostic, MachineModule version, opcode, receipt schema, or ABI changed.

## RED, GREEN, robustness, and differential evidence

- RED: with the I152 strict compiler, the new acceptance test reached the
  Stage-1-built CLI but failed before producing a loop Stage-2 artifact with
  `machine IR supports direct calls only`; command exited `1`, 0/1 passed, in
  11.28 s.
- GREEN: `node --test tests/bootstrap/stage2-loop-compiler-cli.test.mjs`
  passed 1/1 in 27.40 s using the fresh Release compiler. The test also
  rejects a loop initialized at two before output and proves the previously
  emitted artifact and provenance remain byte-identical.
- adjacent Stage-2 conditional CLI tracer passed 1/1 in 30.35 s;
- adjacent Stage-2 function-call and minimal arithmetic CLI tracers passed
  2/2 in 33.01 s;
- loop typed-module pipeline differential and malformed-input suite passed
  3/3 in 38.53 s;
- loop stack maximum differential passed 1/1 in 6.58 s with exact maxima
  `[1, 2]`;
- bootstrap source graph, canonical hashes, and full ten-unit executable
  bundle passed 3/3 in 25.86 s;
- fresh `vkf_strict` Release rebuild passed;
- the first bundle command supplied the frontend executable instead of its
  containing directory and failed before executing a compiler unit. The
  corrected command used the same fresh binary directory and passed 3/3;
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
  `DAE80052B5D16F42863ED01E6A94D631129F520FA022BE3DE1794AD32496E801`
- bootstrap manifest checkout bytes:
  `DFBD3C3B6D12FDD536FA554A3E6564544659380CCC72B9EC4DC61532A12433AA`
- canonical lexer source:
  `01B202B1C348D1404E27CE7D79C809E31DA60F9095D32A25B336639E066B60D3`
- canonical parser source:
  `46341379403D5A99BD6303A745B53199ED0F8A1086DB1BD33CA975D3F78B0F89`
- canonical compiler facade source:
  `EEDB02E39D96F2362382683CC70196FCD96D1119AF6A618AD0F6E4B91FEA507E`
- Stage-2 loop tracer checkout bytes:
  `6763E15F57591A66A5F6A74BFBB41AD1F2AEBC5141C8E65B1912E0EE4F0034AA`
- internal Stage observation adapter checkout bytes:
  `6168F4DB32C708D40B76717AA4E9179CCDD422B29493C1BC7652D45BF305C178`
- fresh Release `vkf-strict.exe`:
  `2C5D7C4272BE3DAB28A408ED64378B42EAADBC47306CFEC2072ABAB127469C63`

## Acceptance-gate impact

This closes the first existing mutable local, loop backedge, conditional exit,
and final return through the actual Stage-1-built Stage-2 compiler CLI while
preserving deterministic repeated emission and atomic rejection. It does not
close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild the complete
compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3 have not
run the same full suite.

Re-evaluated from I152's 73.6%, 0.5 is conservatively **74.3% total**, **+0.7
percentage points** for this real Stage-2 loop-control capability subgate.
