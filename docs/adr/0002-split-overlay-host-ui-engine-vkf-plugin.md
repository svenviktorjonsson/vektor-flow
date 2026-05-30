# ADR 0002: Split Overlay Host From VKF Runtime

Date: 2026-05-14

## Status

Accepted. Revised 2026-05-30.

## Context

The project contains two ownership concerns that must stay separate:

- the native transparent overlay host
- the Vektor Flow language, stdlib, UI runtime, examples, docs, and tests

Keeping the overlay host separate preserves leverage for future languages. A
language-neutral host can launch a transparent window, embed WebView2, transport
packets or compiled modules, and report crashes without knowing anything about
VKF syntax.

Keeping the VKF-owned UI runtime in `vektor-flow` improves locality. A bug in
VKF lowering, stdlib UI semantics, examples, WebGPU picking, axis snapping,
runtime arenas, or compiled-module tests often crosses compiler, docs, examples,
and UI files in one change. Splitting that across a submodule creates detached
HEADs, hidden dirty state, push-order hazards, and missing-submodule-commit
surprises.

ADR 0001 already defines the hot seam as:

`VKF compiled core -> shared arenas -> renderer adapter -> GPU buffers`

This ADR records the ownership split around that seam after learning from the
submodule workflow.

## Decision

The target architecture is two repos plus internal `vektor-flow` modules.

### Overlay Host

The overlay host is the minimal native shell.

Its interface is:

- launch configuration
- web root or packaged web assets
- transparent window configuration
- alpha click-through threshold, defaulting to `0.05`
- process lifecycle and fail-fast diagnostics
- generic transport endpoints for packets, static assets, and compiled modules

Its implementation owns:

- Win32 window creation
- WebView2 embedding
- transparent always-on-top behavior
- pointer pass-through based on alpha
- native process startup, shutdown, and error reporting
- crash diagnostics
- generic compiled-module loading

It must not own widget semantics, geometry semantics, VKF stdlib semantics, or
VKF source semantics.

### VKF UI Runtime

The VKF UI runtime is part of `vektor-flow`.

Its interface is:

- scene, ledger, arena, and packet schemas
- event schema
- renderer and picker contract
- packaged web, WASM, and WebGPU assets
- widget model exposed through the VKF `ui` stdlib
- tests that prove VKF programs satisfy the runtime protocol

Its implementation owns:

- the `ui` stdlib surface exposed to `.vkf` programs
- parsing, type checking, and lowering of VKF UI declarations
- frames and widgets
- GPU geometry drawing
- GPU picking
- shared-memory or packet-backed ledgers
- render scheduling
- dirty-range upload policy
- VKF examples and language docs

It must not carry the native overlay implementation.

## Repository Shape

The intended repo/package split is:

- `transparent-overlay`: native C++/Win32/WebView2 transparent overlay host
- `vektor-flow`: VKF language, compiler, stdlib, UI runtime, examples, docs,
  tests, and packaged assets

The protocol may start inside `vektor-flow`. It should become a tiny shared
package only when a second language adapter needs it. Until then, splitting it
early would create a shallow module with more release cost than leverage.

During migration, `vektor-flow` may import the overlay host as a submodule or
release artifact. The UI runtime and VKF stdlib should be normal tracked files
in `vektor-flow`, not a submodule.

## Consequences

- Overlay bugs have locality in the overlay host.
- VKF syntax, type checking, stdlib, rendering, picking, widgets, ledgers,
  examples, and docs have locality in `vektor-flow`.
- Other languages can gain leverage by targeting the overlay host contract
  without importing VKF.
- Releases need explicit version compatibility between `vektor-flow` and
  `transparent-overlay`.
- Integration tests must live at the interfaces: host launch contract, runtime
  packet contract, compiled-module contract, and VKF stdlib contract.

## Migration Plan

1. Keep `native/VfOverlay` pointing at `transparent-overlay`.
2. Convert `web/vf-ui` from a submodule into normal tracked files in
   `vektor-flow`.
3. Keep VKF stdlib files in `vektor-flow`.
4. Keep overlay-host code language-neutral in `transparent-overlay`.
5. Extract a shared protocol package only when a second language adapter proves
   the seam needs independent release.

## Open Questions

- Whether overlay import should stay source-submodule or become binary release.
- How strict the host/runtime protocol versioning should be before a second
  language adapter exists.
- Whether alpha click-through should stay global or become frame-configurable.
