# ADR 0002: Split Overlay Host, UI Engine, And VKF Plugin

Date: 2026-05-14

## Status

Accepted.

## Context

The current repository contains three concerns that should not keep growing in
one implementation:

- the native transparent overlay host
- the graphics and widget UI runtime
- the Vektor Flow language adapter for that runtime

Keeping them together lowers locality. A bug in click-through window behavior,
WebGPU picking, button group rendering, or VKF event semantics all pull a
maintainer through the same tree. It also lowers leverage: other languages
cannot reuse the overlay and UI runtime without also importing VKF-specific
code.

ADR 0001 already defines the hot seam as:

`VKF compiled core -> shared arenas -> renderer adapter -> GPU buffers`

This ADR records the ownership split around that seam.

## Decision

The target architecture is three systems. Each system should become its own
repo or package once the interface is stable enough to import.

### Overlay Host

The overlay host is the minimal native shell.

Its interface is:

- launch configuration
- web root or packaged web assets
- transparent window configuration
- alpha click-through threshold, defaulting to `0.05`
- process lifecycle and fail-fast diagnostics
- transport endpoints needed by the UI engine

Its implementation owns:

- Win32 window creation
- WebView2 embedding
- transparent always-on-top behavior
- pointer pass-through based on alpha
- native process startup, shutdown, and error reporting

It must not own widget semantics, geometry semantics, or VKF semantics.

### UI Engine

The UI engine is the language-neutral graphics and widget runtime.

Its interface is:

- scene, ledger, arena, and packet schemas
- event schema
- renderer and picker contract
- packaged web, WASM, and WebGPU assets
- widget model, including reusable controls such as button groups

Its implementation owns:

- frames and widgets
- GPU geometry drawing
- GPU picking
- shared-memory or packet-backed ledgers
- render scheduling
- dirty-range upload policy

It must not know about VKF source syntax or VKF compiler internals.

### VKF Plugin

The VKF plugin is the Vektor Flow adapter.

Its interface is:

- the `ui` stdlib surface exposed to `.vkf` programs
- compilation from VKF UI declarations into UI-engine packets
- event handler mapping from UI-engine events back into VKF state updates
- tests that prove VKF programs satisfy the UI-engine protocol

Its implementation owns:

- parsing and type checking of VKF UI code
- VKF-specific lowering into UI runtime records
- VKF examples and language docs

It must not carry the native overlay implementation.

## Repository Shape

The intended repo/package split is:

- `transparent-overlay`: native C++/Win32/WebView2 transparent overlay host
- `overlay-ui-engine`: language-neutral graphics and widget UI engine
- `vektor-flow`: VKF language, compiler, stdlib, and UI plugin adapter

The protocol may start inside `overlay-ui-engine`. It should become a tiny shared
package only when a second language adapter needs it. Until then, splitting it
early would create a shallow module with more release cost than leverage.

During migration, `vektor-flow` may vendor or import transitional builds of the
overlay host and UI engine. That is an implementation detail, not the target
ownership model.

## Consequences

- Overlay bugs have locality in the overlay host.
- Rendering, picking, widgets, and ledgers have locality in the UI engine.
- VKF syntax, type checking, and examples have locality in `vektor-flow`.
- Other languages can gain leverage by writing their own plugin adapter instead
  of forking the overlay host or UI engine.
- Releases need explicit version compatibility across the three systems.
- Integration tests must live at the interfaces: host launch contract, UI engine
  protocol contract, and VKF plugin contract.

## Migration Plan

1. Define the overlay host interface from current `native/VfOverlay` behavior.
2. Extract the smallest C++/WebView2 overlay host into `transparent-overlay`.
3. Replace local overlay builds with an imported overlay package.
4. Extract UI engine assets, ledgers, widgets, renderer, and picker into
   `overlay-ui-engine`.
5. Keep VKF-specific UI lowering and examples in `vektor-flow`.
6. Remove local native overlay implementation from `vektor-flow` after imported
   packages are stable.

## Open Questions

- Exact repo names and package distribution format.
- Whether the first import should be source, binary, or both.
- How strict the UI-engine protocol versioning should be before a second
  language adapter exists.
- Whether alpha click-through should stay global or become frame-configurable.
