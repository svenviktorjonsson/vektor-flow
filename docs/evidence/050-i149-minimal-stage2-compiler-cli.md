# 050-I149 minimal Stage-2 compiler CLI evidence

## Scope

- Base: `e46794fa`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I149 turns the locked Stage-1 graph into a minimal actual compiler CLI. The
Stage-1-built VKF executable reads one closed VKF source path from standard
input, reads and compiles that source through `.compiler`, writes its validated
Machine-IR observation, and asks the existing compiler-owned x64 writer to emit
the selected artifact. The CLI then executes that artifact and prints exact
stdout `43`.

The VKF producer imports every source in the ten-source bootstrap manifest.
The native handoff accepts only the existing closed dependency-chain component,
requires a source-graph fingerprint on the calling artifact, and consumes an
explicit observation file. It does not re-run the interactive producer. The
receipt records `exact_oracle_match: false` because this new path is an
end-to-end compiler handoff rather than the older independent-oracle adapter.

The native adapter remains limited to argv, filesystem validation, provenance,
and compiler-owned PE writing. Source parsing, typed lowering, Machine-IR
construction, and validation remain in the locked VKF graph. No public syntax,
API, diagnostic, MachineModule version, opcode, receipt schema, or ABI changed.

## TDD and regression evidence

- RED: after replacing a homogeneous dynamic argument vector with a fixed
  tuple, the Stage-1-built CLI compiled and ran but exited `3` because
  `--vkf-internal-stage-observation` did not exist;
- fresh Release rebuild:
  `cmake --build J:\build\i148-release-fast --config Release --target`
  `vkf_strict -- /m:1` passed;
- focused minimal Stage-2 compiler CLI tracer after the final rebuild: 1/1
  passed in 20.28 s;
- adjacent locked-graph Stage-2 artifact tracer: 1/1 passed in 19.05 s while
  running concurrently with the focused tracer;
- adjacent compiler facade: 1/1 passed in 14.38 s;
- adjacent unbounded typed-Machine-IR handoff: 1/1 passed in 9.65 s;
- bootstrap source graph and manifest hashes: 2/2 passed in 0.45 s;
- complete locked bootstrap executable bundle: 1/1 passed in 43.66 s;
- emitted CLI and selected output were native `MZ` PE files; the selected
  output exited `0` and printed exact `43`;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

All executable tests used
`VKF_NATIVE_BIN=J:\build\i148-release-fast\bin\Release`. The bundle test also
used that directory for `VKF_BOOTSTRAP_FRONTEND_BIN` and its
`vkf_bootstrap_bundle_artifact_smoke.exe` as `VKF_BUNDLE_ARTIFACT_TOOL`.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `DF0D784FD2095257A0E69A5C19CE48E93655980C184EB7A588C058D8994D8D88`
- bootstrap manifest checkout bytes:
  `621064656D38C13963D586591C62EADCFF863BDE1EE04D140AEA38265426205A`
- minimal Stage-2 compiler CLI tracer checkout bytes:
  `82A7D8B831C14778173B14C97200AA80F8C81530213403EE28AF6FFB000C1A7A`
- internal Stage observation adapter checkout bytes:
  `93198493275F443FA7F7496FEFF2E0EB44F05DBFF4C360C400E03694C2747516`
- rebuilt Release `vkf-strict.exe`:
  `D5BF3FAA90DE91D6F3C240431DE5B236251BB4FCB787AED84076DFEAE48B5A5B`

## Acceptance-gate impact

This closes the smallest actual Stage-2 compiler-CLI tracer: a compiler built
from the locked Stage-1 graph accepts a closed VKF source and emits a runnable
native artifact with exact observable output. It does not close ADR 0005's full
cutover gate. Stage 2 does not yet rebuild the complete compiler graph, and no
Stage-2-to-Stage-3 deterministic fixed-point comparison has run.

Re-evaluated from I148's 71.0%, 0.5 is conservatively **72.2% total**, **+1.2
percentage points** for the minimal Stage-2 compiler-CLI subgate.
