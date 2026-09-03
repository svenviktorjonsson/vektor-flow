# 0.4 transparent overlay and slider-event acceptance

## Decision provenance

Viktor approved this public event contract in the 0.4 restart thread on
2026-08-30:

- every UI owner exposes an event queue through `.events.get()`;
- `get()` returns the next event object, or `null` when the queue is empty;
- the catalog contains a general component event type and past-tense concrete
  event types;
- the button types are `ButtonEvent` and `ButtonClicked`; and
- the slider types are `SliderEvent` and `SliderValueChanged`.

`SliderEvent`/`SliderValueChanged` use the already-approved specificity rule:
an exact concrete arm wins, otherwise the corresponding general component arm
receives the event. This packet does not change event propagation,
`prevent_default()`, or owner hierarchy semantics.

## Acceptance story

As a VKF application author, I can load a static HTML+CSS interface into a
frame, identify native HTML components by `id`, and react to button and range
input through VKF queues without application JavaScript. Native and WASM
artifacts must bundle the same local resource graph. A desktop frame remains
draggable while the transparent area outside retained hit regions remains
click-through.

The HTML fixture is declarative. The shipped static-loader script is a platform
adapter: it translates browser input into target-neutral VKF event packets.
Application behavior remains in compiled VKF.

## Acceptance boundaries

- A button click produces `ButtonClicked`.
- A range input produces `SliderValueChanged` with its numeric value.
- Component, frame, and display queues receive the same event identity.
- Queue reads are FIFO and terminate with `null`.
- The static fixture contains no `<script>` element or inline event handler.
- Local nested CSS and image resources are bundled byte-identically for native
  and WASM targets; missing or invalid resources fail atomically.
- Hidden/headless browser execution proves retained frame dragging and explicit
  hit-region gaps.
- Existing compiled native and WASM rectangle demos remain executable.
- The existing WebGPU capture API produces a still and directly playing looping
  animation without launching a visible browser.

The packet adds no other syntax, public schema, ABI, widget name, or renderer
contract.
