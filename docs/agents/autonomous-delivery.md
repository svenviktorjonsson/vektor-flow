# Autonomous delivery protocol

This protocol governs parallel agent work for the 0.5.0 self-hosting program
and any later program that opts into it. GitHub Issues remain the canonical
work-packet tracker; architectural decisions remain in `docs/adr/`.

The language designer is the final authority for every public language/API
decision. The approval boundary and compact decision-packet format are defined
in [the Language Design Authority workflow](language-design-authority.md).

The goal is not maximum agent count. The goal is the maximum number of
independent, verifiable changes that can reach the merge queue without two
agents inventing different contracts or editing the same ownership boundary.

## Roles

- **Integration Steward** owns the release DAG, freezes contracts, assigns
  write ownership, reviews evidence, and is the only role that integrates
  packets into the release branch.
- **Contract Owner** owns one versioned interface, schema, fixture, or
  conformance trace and approves consumer-visible changes.
- **Packet Implementer** owns one observable vertical behavior and its isolated
  branch/worktree.
- **QA/CI Guardian** independently verifies red/green evidence, parity,
  malformed-input behavior, and flaky-test policy.
- **Performance Lead** freezes benchmark contracts and peer sets. A separate
  verifier approves performance claims.
- **Recovery Owner** adopts preserved work when a packet lease expires or an
  implementation becomes blocked.
- **Language Design Authority** approves syntax, type/evaluation semantics,
  public APIs, diagnostics, public schemas/ABIs, and compatibility decisions.

One person or agent may hold several roles across unrelated packets, but cannot
approve its own correctness or frontier-performance evidence.

## Concurrency and ownership

Use at most:

~~~text
min(available agent slots - 1, ready path-disjoint packets, CI capacity)
~~~

The remaining slot belongs to the Integration Steward. A packet is ready only
when its parent contracts are frozen and it does not share writable paths with
another active packet.

Each implementation packet uses one branch and one worktree:

~~~text
codex/<release>/<packet-id>-<slug>
.worktrees/<release>/<packet-id>-<slug>/
~~~

There is one writer per path family. `compiler/native/`, root build files,
generated schemas, and shared registries are serialization hotspots. Native
and WASM consumers may run concurrently only after their shared typed-IR/ABI
contract is frozen and their write globs do not overlap.

Generated output has exactly one generator owner. Consumers never hand-edit
generated files.

## Work-packet contract

Every packet is a GitHub Issue with `ready-for-agent` only after these fields
are complete:

~~~text
Packet ID and release gate
Role, owner, status, lease, and checkpoint time
Parent packets and dependencies
Base commit, branch, and worktree
Consumed contract version and hash
User story and one observable behavior
Public interface or reference consumer
Invariants and exact diagnostics
Write globs, protected paths, and generated paths
Explicit out-of-scope work
RED command, expected failure, and evidence location
Smallest intended implementation
Native/WASM or stage differential requirement
Robustness/property/fuzz requirement
Performance hypothesis, baseline, target, and benchmark contract
Test tiers and exact commands
Merge-queue position and recovery notes
~~~

A packet that cannot name one observable behavior is an initiative, not an
implementable packet, and must be split before assignment.

If a packet exposes a language/API choice, it is labeled `ready-for-human` and
cannot enter RED until the Language Design Authority approves its decision
packet. Research and path-disjoint work behind already frozen contracts may
continue. Silence or a prototype passing tests is not API approval.

## Packet lifecycle

Each packet moves through these states:

1. **Baseline**: reproduce the current behavior and record the base commit.
2. **RED**: add the smallest public test; run it; prove it fails for the
   intended missing behavior.
3. **GREEN**: implement only enough to pass the same command.
4. **Refactor**: improve ownership and names while the public test stays green.
5. **Differential**: compare native/WASM, Stage 0/new stage, or another required
   consumer after every observable step.
6. **Robustness**: exercise malformed input, atomic rejection, properties,
   fuzz seeds, and mutation where the packet contract requires them.
7. **Performance**: preserve ratchets; profile and optimize only when the
   packet owns an explicit performance target.
8. **Handoff**: publish evidence, path inventory, contract hash, and recovery
   notes for independent verification.

RED and GREEN receipts record command, exit code, duration, salient output,
source hash, binary/artifact hash, and environment identity. A rerun that turns
green after an unexplained failure is a flaky result, not a successful red or
green cycle.

## Contract-first fan-out

Parallel target work follows this graph:

~~~text
public behavior + schema RED
            |
      frozen contract/hash
       /          |          \
 native       WASM/host    inspector/tooling
       \          |          /
       differential verifier
                 |
        integrated reference fixture
~~~

The reference consumer and malformed-input behavior are part of the contract.
Preparing a downstream packet may begin once its consumed interface is frozen,
but it cannot merge a private substitute for an unmet dependency.

Schema/generator packets additionally prove:

- two fresh generations have identical hashes;
- checked-in output passes a generator `--check` mode;
- widths, offsets, alignment, endianness, tags, versions, and capability bits
  are exact;
- each producer decodes the other consumer's data;
- truncated, unknown, stale, and over-capacity input fails before mutation;
- the committed-state hash is unchanged after rejection; and
- decoders run under the relevant sanitizer/fuzz tier.

## Verification tiers

- **T0 focused** (target: 90 seconds): packet test, generator check,
  differential fixture, and harness unit tests.
- **T1 pull request** (target: 10 minutes): strict compiler build, core and
  stdlib tests, JS/WASM tests, package tests, generated checks, and cheap stage
  parity.
- **T2 affected integration** (target: 30 minutes): browser, overlay, platform,
  replication, or package integration selected by changed paths.
- **T3 nightly robustness**: ASan/UBSan, extended properties, deterministic
  replay, fuzz corpora, and mutation testing.
- **T4 pinned performance**: paired parent/release/competitor runs on exclusive
  runners under [ADR 0010](../adr/0010-correctness-gated-frontier-performance.md).
- **T5 release/tag**: every supported platform, bootstrap stage, artifact,
  clean-machine build, and graduated performance row.

Fixed property seeds run in pull requests; extended random seeds run nightly
and save minimized failures as replayable corpus entries. Critical semantic
packets must kill all selected non-equivalent mutants; changed semantic code
starts with an 85% mutation target. Generated output is excluded, but its
generator is not.

Tests are not automatically retried. Quarantine requires a linked issue,
owner, evidence, and a seven-day expiry. Contract, security, target-parity,
bootstrap-equivalence, and performance-gate tests cannot be quarantined.

## Merge queue

The Integration Steward rebases and verifies one packet at a time in this
order:

1. public contract/reference consumer;
2. target-independent semantics;
3. native/WASM or stage consumers;
4. host adapters;
5. integrated tracer/reference application; and
6. independent evidence and ratchet update.

No packet merges with an unknown contract hash, overlapping write ownership,
missing red receipt, unreviewed generated changes, or unexplained baseline
failure. Failed integration returns to its packet branch; the release branch is
not debugged by mixing unrelated patches.

## Reporting, leases, and recovery

An active agent reports roughly every five minutes with:

- packet/state;
- current red or green command;
- files changed;
- blocker or next observable step; and
- whether its lease needs extending.

A long test/build command counts as a live checkpoint when its command and
start time are recorded. Otherwise a packet becomes stale after three missed
reports. Stale work is never deleted: preserve the branch/worktree, inventory
the diff and artifacts, revoke write ownership, and open a recovery packet from
the last verified state.

## Performance isolation

Performance sampling uses an exclusive runner and never overlaps builds,
browser automation, or another benchmark. The implementation agent may propose
a result; the Performance Lead freezes the workload/peer manifest and an
independent verifier reruns it. Store raw samples and failed rows, not only the
summary.

## 0.4 visual-test boundary

During the 0.4/0.5 overlap, visual-test work owns its fixtures, goldens, browser
profiles, and screenshot policy. Self-hosting packets consume the frozen 0.4 UI
source fixture, manifest, arena schema, stable scene IDs, and event trace. They
must not rewrite visual-test helpers or goldens to make a source migration pass.
Any necessary public UI change returns to the 0.4 contract owner first.
