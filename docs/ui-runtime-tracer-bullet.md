# UI Runtime Tracer Bullet

Goal: make the tomorrow demo prove the real runtime path, not the old inspection
path.

## Demo Path

The demo path is:

1. VKF source compiles before the interaction starts.
2. The VKF binary or compiled core runs in-process.
3. The compiled core writes events, transforms, geometry, widgets, and commands
   into shared arenas.
4. The renderer adapter reads dirty arena ranges.
5. The renderer updates GPU buffers.
6. The frame presents without Python polling or JSON reloads.

Python and JSON are allowed before and after the hot path: compilation bring-up,
fixtures, inspection snapshots, screenshots, docs, and regression tests. They are
excluded from pointer-sample handling, transform updates, geometry mutation, and
per-frame rendering.

## Smallest Slice

Build the smallest deep module slice that earns the seam:

- `CompiledCore` writes one draggable rectangle into `RuntimeArenas`.
- `RuntimeArenas` expose a stable interface: arena pointers, record formats,
  generation counters, and dirty ranges.
- `RendererAdapter` reads dirty ranges and updates one GPU-backed vertex buffer.
- `InspectionAdapter` can snapshot the same arena state for tests, but never
  drives the frame.

This gives depth because the caller only needs the arena interface while memory
layout, event dispatch, transform math, and upload strategy stay local to their
modules. It gives leverage because the same seam supports browser iteration now
and native overlay adapters later.

## Acceptance

- Dragging the rectangle mutates shared arena state from compiled VKF code.
- The renderer presents from GPU buffers derived from arena dirty ranges.
- No per-frame `vf-display.json` write/read is needed.
- No Python HTTP poll is needed for pointer movement.
- A test or inspection snapshot can verify arena contents outside the hot path.

## Current Browser Tracer

The current executable browser tracer is:

- `web/vf-ui/vf-shared-rect-demo.html`
- `web/vf-ui/vf-shared-rect-demo.js`
- `tests/test_vf_shared_runtime_browser.py`

This tracer uses a JS `CompiledCore` stand-in behind
`VfWasmDemoContract.createWasmDemoContract(...)`. That is deliberate: the seam is
the stable part being tested. Replacing the stand-in with a real VKF/WASM export
should not require renderer changes.

## Not In This Slice

- General widget library.
- Multi-window scheduling.
- Native overlay GPU backend.
- Full compiler cleanup.
- JSON compatibility removal.
