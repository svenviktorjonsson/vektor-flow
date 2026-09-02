# 050-I148 locked-graph Stage-2 artifact evidence

## Scope

- Base: `70984bdb`
- Worktree: `.worktrees/0.5/050-i142-machine-function-list-layout`
- Branch: `codex/0.5/050-i142-machine-function-list-layout`

I148 connects the complete locked ten-source graph to the established Stage-1
compiler facade and compiler-owned x64 writer. One Stage-1 producer explicitly
imports every manifest source, compiles the smallest closed dependency module
to validated Machine IR, and hands that observation to the existing native
Machine-IR consumer. The emitted PE executes with exact stdout `43`.

The test mutates the otherwise-unused locked `io.vkf` after producer creation
and proves the handoff rejects the stale graph before consuming it. This binds
the producer artifact to the full declared graph rather than merely copying
ten files beside a six-source compiler dependency chain.

This packet adds acceptance coverage only. Existing source-first production
seams already composed correctly, so no production implementation changed.
No syntax, API, diagnostic, MachineModule version, opcode, schema, or ABI
changed.

## TDD and regression evidence

- first harness RED rejected checkout CRLF bytes against manifest digests; the
  canonical LF normalization used by the existing source-graph contract fixed
  the test before evaluating public behavior;
- focused locked graph to Stage-2 PE tracer on fresh Debug strict: 1/1 passed
  in 136.11 s;
- focused tracer on fresh non-LTCG Release strict: 1/1 passed in 15.20 s;
- the emitted artifact started with `MZ`, executed with exit 0 and stdout `43`;
- mutating locked `io.vkf` after producer creation was rejected as a stale
  source graph;
- source graph, compiler facade, normal Machine-IR handoff, mismatch/staleness
  rejection, and malformed-observation rejection: 6/6 passed in 33.33 s;
- complete locked bootstrap bundle with fresh Release strict/frontend/bundle
  helpers: all ten source artifacts emitted and executed, 1/1 passed in
  32.76 s;
- `git diff --check` passed;
- all child processes were hidden and no performance workload ran.

A parallel adjacent run on Debug exceeded existing 20/30-second test-local
timeouts, and the locked bundle exceeded its 60-second timeout by about
0.18 s twice with Debug frontends. All affected tests passed on the fresh
non-LTCG Release helpers. These were configuration/resource failures, not
semantic output mismatches.

## Contract hashes

- ADR 0005 checkout bytes:
  `533D8743CAFB44B19088276DF3A4AE1407FF30D3F58BED5DD16887128DCB7925`
- bootstrap bundle identity:
  `DF0D784FD2095257A0E69A5C19CE48E93655980C184EB7A588C058D8994D8D88`
- bootstrap manifest checkout bytes:
  `621064656D38C13963D586591C62EADCFF863BDE1EE04D140AEA38265426205A`
- locked-graph Stage-2 tracer checkout bytes:
  `8DE8244E038963F11410373D5EE2CAF888D50EB2A1A6141061BBDDFD9CD7EC2B`
- fresh non-LTCG Release `vkf-strict.exe`:
  `965F0F1E28AF302B0E5E23745FB7693CEBD31D7B2A1C1A91026033C370D641D5`
- fresh Release bootstrap bundle driver:
  `920F9DA7DD495B1F41819725DE56AAF3BB387ECBDF54D60874F6EF8E8B66D006`
- fresh Release typed-IR frontend:
  `9EEAECAD4CE88B5B1F94A0FF58BF3B91CFE246D8459D520554DE357F6B6DE1A0`

## Acceptance-gate impact

This is the first tracer in the current dependency chain where one Stage-1
producer is bound to every source in the locked graph and its validated output
becomes a runnable Stage-2 native artifact. It materially advances ADR-0005's
Stage-1-to-Stage-2 build gate, but does not close it: the emitted artifact is a
minimal compiled program, not yet a compiler CLI capable of rebuilding the
locked graph. Stage-2/Stage-3 fixed-point equivalence also remains open.

Re-evaluated from I147's 70.1%, 0.5 is conservatively **71.0% total**, **+0.9
percentage points** for the full-graph-to-runnable-artifact subgate.
