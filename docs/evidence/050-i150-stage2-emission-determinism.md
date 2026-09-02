# 050-I150 Stage-2 emission determinism evidence

## Scope

- Base: `143f5c1f`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I150 proves the strongest currently honest deterministic-rebuild prerequisite.
The Stage-1-built minimal Stage-2 compiler CLI compiles the same closed VKF
source twice. Before the second run, its selected artifact, Machine-IR
observation, and provenance receipt are removed. Both clean emissions execute
with exact stdout `43`, and the resulting PE bytes and provenance bytes are
identical.

This is deliberately not called Stage 3 or self-compilation. The current
VKF-owned compiler facade lowers its approved closed arithmetic subset. It does
not yet lower the compiler CLI's imports, function graph, strings, IO, process,
argv, or filesystem behavior. Invoking Stage 0 from the Stage-2 CLI or copying
the Stage-2 binary would not satisfy ADR 0005's definition of a compiler built
by Stage 2.

No production implementation changed because the I149 handoff was already
deterministic. No public syntax, API, diagnostic, MachineModule version,
opcode, receipt schema, or ABI changed.

## Test-first and regression evidence

- the acceptance tracer was extended before any production edit to require a
  second clean emission and byte equality;
- the existing implementation passed the new requirement, so no artificial
  production RED or fixture-specific change was introduced;
- a fresh non-LTCG Release helper was configured under
  `J:\build\i150-release-fast` and built with target `vkf_strict`;
- focused deterministic Stage-2 emission tracer: 1/1 passed in 16.69 s;
- adjacent locked-graph Stage-2 artifact tracer: 1/1 passed in 15.08 s;
- bootstrap source graph and manifest hashes: 2/2 passed in 0.63 s;
- both fresh emissions produced native `MZ` PE files, exited `0`, and printed
  exact `43`;
- the emitted PE files were byte-identical;
- the internal provenance receipts were byte-identical;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

Executable tests used
`VKF_NATIVE_BIN=J:\build\i150-release-fast\bin\Release`.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `DF0D784FD2095257A0E69A5C19CE48E93655980C184EB7A588C058D8994D8D88`
- bootstrap manifest checkout bytes:
  `621064656D38C13963D586591C62EADCFF863BDE1EE04D140AEA38265426205A`
- deterministic Stage-2 emission tracer checkout bytes:
  `25FBCFFCC5E6A9989F3B5BD6755B4E3BB2EF193D755F0A01ADEA620BF97B7D4D`
- fresh Release `vkf-strict.exe`:
  `174E3394CF3AA6541C943AAD13315424D0F49E9D1311A9C1A07AD29AC40F975E`

## Acceptance-gate impact

This proves deterministic repeated emission at the minimal Stage-2 compiler
boundary and removes output nondeterminism as the immediate fixed-point risk.
It does not close ADR 0005 cutover rule 5: no Stage-3 compiler exists yet, the
full compiler graph has not been rebuilt by Stage 2, and Stage 2 and Stage 3
have not run the same full suite.

Re-evaluated from I149's 72.2%, 0.5 is conservatively **72.4% total**, **+0.2
percentage points** for deterministic Stage-2 emission evidence.
