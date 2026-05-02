# ADR 0001: UI Runtime Uses Shared Memory And GPU-Owned Buffers

Date: 2026-05-02

## Status

Accepted.

## Context

The first interactive UI demos used this loop:

1. browser or overlay emits pointer events
2. Python polls events over HTTP
3. VKF code mutates Python objects
4. Python writes `vf-display.json`
5. browser or overlay reloads JSON and redraws

That path is useful for language semantics, screenshots, and simple smoke tests.
It is not acceptable for high-performance UI. Dragging a single rectangle showed
visible tail latency because every pointer sample crosses process boundaries and
forces a JSON/file synchronization cycle.

Vektor Flow needs UI interaction to feel like a rendering system, not like a
remote-control script.

## Decision

The real UI runtime will be:

- browser-first for iteration and testing
- WASM-first for VKF execution in the UI process
- shared-memory-backed for UI state, events, transforms, and geometry
- GPU-buffer-backed for render data
- JSON-free on the hot path
- Python-free on the hot path

VKF source may still compile through Python during bring-up, but the interactive
frame loop must run in the browser/native overlay process as WASM or native code.

## Runtime Model

The UI runtime owns arenas:

- `EventArena`: input samples and hover context
- `TransformArena`: TRS/quaternion authoring state plus cached `mat4`
- `GeometryArena`: vertices, indices, dimensions, and topology
- `WidgetArena`: retained widget state and dispatch metadata
- `CommandArena`: append-only setup commands, not per-frame movement

The render loop owns GPU resources:

- WebGPU storage/uniform buffers when available
- WebGL typed-array uploads as fallback
- native overlay GPU buffers later

WASM/VKF writes directly into arenas. The renderer reads dirty ranges and uploads
only changed slices.

## Event Model

Events carry:

- absolute cursor position in pixel coordinates
- absolute cursor position in active frame/data coordinates when available
- hover context (`frame`, `object`, `face`, `edge`, `vertex`)
- button and modifier state

`trans` may exist as a convenience delta, but it is not the core API. Serious
interaction should anchor on `down` and compute transforms from absolute cursor
position:

```vkf
down_pos: ui.cursor.pos
start: rect.transform

drag(e):
  rect.translate(to: start.pos + (ui.cursor.pos - down_pos))
```

## Transform Model

2D and 3D objects expose semantic operations:

- `translate(trans:[num])`
- `rotate(axis:[num], angle:num)`
- `scale(factor:[num])`

Internally:

- authoring state is TRS
- 3D rotation is quaternion
- cached render state is `mat4`
- parent/child propagation updates cached world matrices

## Consequences

- The current Python/JSON UI path becomes a compatibility and test path, not the
  target runtime.
- The next demos must run against the shared-memory browser runtime before adding
  more language surface.
- A feature is not "real" until it is testable in the shared-memory/GPU path.

