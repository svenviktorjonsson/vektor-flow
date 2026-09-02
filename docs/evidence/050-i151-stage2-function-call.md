# 050-I151 Stage-2 function-call compiler evidence

## Scope

- Base: `6fbdec7a`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I151 extends the Stage-1-built minimal Stage-2 compiler CLI by one existing,
locked language capability. It accepts a numeric function declaration with one
typed parameter, an implicit return expression, and a direct call:

```vkf
: .system
twice(value:num):
    value * 2
:: twice(cpu_count())
```

The VKF-owned lexer, parser, compiler facade, typed lowering, Machine-IR
lowering, and stack validation produce the existing numeric-parameter multiply
module. The Stage-2 CLI then asks the existing compiler-owned x64 writer to
emit the artifact, runs it, and matches the independent Stage-0 oracle's exact
stdout. A second clean emission preserves both stdout and byte-identical PE and
provenance receipts.

The native observation handoff now accepts the already-locked
`machine_ir.numeric_parameter_multiply.typed_module_pipeline` component. It
does not parse or lower source and remains limited to validation, provenance,
and compiler-owned PE writing.

This is deliberately not called Stage 3 or self-compilation. The accepted
function form is a bounded existing-language tracer. The Stage-2 compiler CLI
does not yet lower the full compiler graph's general functions, strings, IO,
process, argv, or filesystem behavior. No public syntax, API, diagnostic,
MachineModule version, opcode, receipt schema, or ABI changed.

## RED, GREEN, and regression evidence

- RED: the new public-behavior tracer reached the Stage-1-built CLI but source
  compilation failed with `machine IR supports direct calls only` before the
  bounded lexer/parser/compiler facade existed;
- GREEN: `node --test`
  `tests/bootstrap/stage2-function-call-compiler-cli.test.mjs` passed 1/1 in
  28.31 s using the fresh Release helpers;
- adjacent deterministic arithmetic CLI tracer:
  `tests/bootstrap/stage2-minimal-compiler-cli.test.mjs` passed 1/1 in 14.88 s;
- existing typed numeric pipeline dispatch:
  `tests/bootstrap/stage1-machine-ir-normal-pipeline-dispatch.test.mjs` passed
  3/3 in 38.67 s;
- bootstrap source graph and manifest hashes passed 2/2 in 0.41 s;
- fresh `vkf_strict` Release rebuild passed after the native handoff change;
- the fresh lexer, parser, IR, and executable-bundle helpers built successfully;
- complete locked bootstrap executable bundle passed 1/1 in 47.48 s; all ten
  declared compiler units emitted native executables and ran successfully;
- the first bundle attempt stopped before compilation at Windows path length;
  the identical command passed with the in-repository short work root
  `VKF_TEST_WORK_ROOT=J:\.work\i151-short`;
- both clean Stage-2 function-call emissions matched the Stage-0 oracle and
  produced byte-identical PE and provenance files;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

Executable tests used
`VKF_NATIVE_BIN=J:\build\i150-release-fast\bin\Release`. The bundle test also
used that directory for `VKF_BOOTSTRAP_FRONTEND_BIN` and its
`vkf_bootstrap_bundle_artifact_smoke.exe` as `VKF_BUNDLE_ARTIFACT_TOOL`.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `8BBFE3410814A2BF0232DCE65AD5B70879060996C017E682981A2221FC1F4DB7`
- bootstrap manifest checkout bytes:
  `59A24B39D55A007DFC9172837A299FC98E8F6BDA7A2F79EC485369A76F242FD3`
- canonical lexer source:
  `9D845D876ED70E53C973C949E575C0E5A1E5E9D277D42D95F264C0F57C961250`
- canonical parser source:
  `A6C627003FF10C938F29C62AD66BB38F2EBD6226F7BE92CADCCC7819C28C5255`
- canonical compiler facade source:
  `B1A98422BF4F015F698886B9CB0C4E6BF0847C8BB9949A401B8E10848D28DAF5`
- Stage-2 function-call tracer checkout bytes:
  `D053D9A4F6BDBC73D24ECB6082875D2492931D485AD424B6EAC0343C670CBCD3`
- internal Stage observation adapter checkout bytes:
  `67648FA2A13AC891DB686071D832074693EE2BCC20E73B08A137D7493BC6017A`
- fresh Release `vkf-strict.exe`:
  `0BFB056EFE10C7EBDA79BF98136B58617A7484C9AB767662A028402967FD5DCA`
- fresh executable-bundle helper:
  `727E6650C73820125F4F2891182EBF2B286C8B9713F97CDFAF514C9062F54C2F`

## Acceptance-gate impact

This closes the first bounded existing function declaration, typed parameter,
implicit return, and direct call tracer through the actual Stage-1-built
Stage-2 compiler CLI. It retains deterministic repeated emission. It does not
close ADR 0005 cutover rule 5: Stage 2 still cannot rebuild the complete
compiler graph, no Stage-3 compiler exists, and Stage 2 and Stage 3 have not
run the same full suite.

Re-evaluated from I150's 72.4%, 0.5 is conservatively **73.0% total**, **+0.6
percentage points** for this real Stage-2 language-capability subgate.
