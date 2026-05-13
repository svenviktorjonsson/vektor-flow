# ADR 0002: Make UI Runtime Packet Contract Authoritative

## Status

Accepted

## Context

Vektor Flow UI work currently spreads across several shallow modules:

- `vektorflow.stdlib.screen`
- `vektorflow.stdlib.ui`
- `vektorflow.ui.payloads`
- `vektorflow.ui.event_ingress`
- `web/vf-ui/*.js`
- `native/VfOverlay/main.cpp`

The project is now also growing deeper modules behind the packet seam:

- `vektorflow.ui.display_runtime`
- `vektorflow.ui.representation_runtime`

Those deep modules are converging on a **runtime bundle seam**: one deep seam that should package packet-first UI runtime behavior for the native executable.

The interface is too wide. Callers and maintainers still need to know:

- when full files are rewritten
- when widget state is patched
- which path is authoritative between Python memory, JSON files, JavaScript polling, WebView messages, and native queueing

This hurts locality and gives low leverage. It also blocks the project goal of removing Python from hot UI paths.

## Decision

We will make a **UI runtime packet contract** the authoritative seam.

We will also keep deepening the packet-first implementation into a **runtime bundle seam** that earns leverage behind that contract, instead of leaving orchestration spread across shallow Python modules.

That contract owns:

- scene replacement
- display replacement
- widget state replacement
- widget append patches
- host input packets

Python file mirroring becomes an adapter behind that seam. The current overlay HTTP/WebView path also becomes an adapter. Future native C++ / WASM / WebGPU runtime work will target the packet contract first, not ad-hoc JSON writes.

## Consequences

Positive:

- one deep module for UI runtime behavior
- `vektorflow.ui.display_runtime` and `vektorflow.ui.representation_runtime` can keep concentrating implementation detail with better locality
- the runtime bundle seam gives the native executable one small interface for shipped UI runtime behavior
- better locality for tests and future migration work
- lets native runtime consume one contract instead of reverse-engineering Python stdlib behavior
- makes deletion of Python UI adapters measurable

Negative:

- temporary duplication while legacy JSON files still exist
- requires explicit migration of both payload egress and input ingress onto the same contract
- leaves `vektorflow.stdlib.ui`, `vektorflow.stdlib.events`, `vektorflow.ui.payloads`, and `vektorflow.ui.session` as the exact shallow modules still blocking the target-machine claim until the runtime bundle seam absorbs their shipped-runtime responsibilities or their adapters are deleted

## Follow-up

- keep emitting runtime packets from Python now
- add a native `VfCore` header for the packet contract
- move overlay consumption from file-polling toward packet consumption
- move host input delivery to the same contract
- delete legacy JSON polling adapters after native path is stable
