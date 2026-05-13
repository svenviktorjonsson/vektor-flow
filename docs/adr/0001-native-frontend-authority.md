# ADR 0001: Make The Native Frontend The Authoritative Seam

## Status

Accepted

## Context

Vektor Flow currently has substantial Python ownership across the CLI, lexer, parser, runtime, and stdlib. Native work exists, but it is not yet the authoritative seam. That leaves the codebase shallow in the worst place: callers must still know which path is real, which path is prototype, and where behavior actually lives.

The project goal is to remove Python from the repository entirely. That means we need one authoritative seam for source loading, lexing, parsing, diagnostics, and eventually runtime execution.

## Decision

We will make a **native frontend** the authoritative seam.

That native frontend will:

- own source ingestion
- own tokenization
- own parsing
- own frontend diagnostics
- define the stable contract that a future self-hosted `.vkf` parser must satisfy

Python is treated as a temporary bootstrap implementation to be deleted, not as a long-term adapter. During migration, the only acceptable surviving Python role is the **build-time parser seam**. That seam must not leak into the shipped target-machine path.

## Consequences

Positive:

- improves locality by concentrating frontend behavior in one module
- improves leverage by giving every caller one interface to target
- creates a real seam for later self-hosting
- makes Python deletion measurable
- supports the nearer packaging claim that the whole app can ship to the target machine with no Python installed

Negative:

- requires duplicated work for a while as the native frontend catches up
- forces explicit migration planning for CLI, tests, and stdlib behavior

## Follow-up

- create a native frontend module in `native/VfCore`
- route future parser work there first
- measure Python removal by shrinking the authoritative Python surface, not by adding more experimental side paths
- keep the build-time parser seam build-only; do not let it become a runtime dependency of the packaged app
