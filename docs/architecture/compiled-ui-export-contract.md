# Compiled UI Export Contract

This note defines the first compiled-runtime contract for UI execution.

The goal is to replace "compiled VKF program with `main()`" with
"compiled VKF runtime module with update hooks".

See also:

- [ui-runtime-arena-abi.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\ui-runtime-arena-abi.md)
- [python-free-ui-runtime-roadmap.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\python-free-ui-runtime-roadmap.md)
- [../ui-runtime-tracer-bullet.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\ui-runtime-tracer-bullet.md)

## Purpose

The contract must work for:

- native `C++` runtime targets
- `WASM` runtime targets
- one shared browser/native host-facing runtime seam

It must not require:

- Python in the hot path
- JSON to communicate per-frame changes
- process `main()` entrypoints for interactive UI modules

## Core Entry Points

The first export surface is:

```text
vkf_init(VfRuntimeApi* api)
vkf_update(const VfInputSnapshot* input, VfRuntimeApi* api)
vkf_shutdown(VfRuntimeApi* api)
```

Rules:

- `vkf_init` sets up persistent widget/geometry/transform state
- `vkf_update` consumes current input snapshot and mutates arenas
- `vkf_shutdown` is optional in the first slice but should exist in the contract

## Runtime API Surface

The host provides one `VfRuntimeApi`.

The first shape should expose:

- arena pointers or typed spans
- arena metadata accessors
- mutation helpers for transforms and geometry
- optional logging/debug hooks

Conceptually:

```text
struct VfRuntimeApi {
  EventArena* events;
  TransformArena* transforms;
  GeometryArena* geometry;
  WidgetArena* widgets;
  CommandArena* commands;

  void (*mark_transform_dirty)(u32 id);
  void (*mark_geometry_dirty)(u32 id);
  void (*append_command)(const VfCommandRecord*);
}
```

The important thing is not the exact field names yet. The important thing is
that the compiled core writes through a stable ABI instead of through host
language object graphs.

## Input Snapshot

The host passes one normalized snapshot into `vkf_update`.

The first shape should include:

- cursor position
- drag delta
- button state
- modifiers
- hover context
- wheel step
- active frame or widget id when known

This snapshot is intentionally flat. The compiled runtime should not have to
reconstruct browser or overlay event objects.

## What The Compiled Module May Do

The compiled module may:

- read the input snapshot
- consume the normalized host event queue
- read existing runtime state from arenas
- mutate widget/transform/geometry state
- append setup commands when structure changes

The compiled module must not:

- write files
- perform JSON serialization in the hot path
- depend on Python callbacks for ordinary interaction

## Language Boundary

The export contract is runtime-facing, not source-facing.

That means:

- VKF functions may remain functional at the language level
- compiled lowering may still target mutable runtime resources explicitly
- ordinary VKF structs/vectors are not the ABI
- arena records and runtime handles are the ABI

## Backend Expectations

### Native Binary

The native-binary backend should be able to emit:

- a header for the runtime API and arena ABI
- a compiled module exporting `vkf_init`, `vkf_update`, `vkf_shutdown`

### WASM

The `WASM` backend should be able to export:

- the same conceptual init/update/shutdown entrypoints
- memory layout compatible with the arena ABI

### WebGPU-Oriented Kernel Emission

The compiler should also be able to lower typed-IR-owned compute/render work
into `WebGPU`-oriented kernel and buffer-layout artifacts where GPU execution is
the right target.

That does not replace the language/runtime backend by itself. It complements the
native-binary and `WASM` runtime targets.

### Browser Host

The browser host should be able to:

- instantiate the `WASM` module
- map or share the memory
- call `vkf_update` for input ticks
- render by consuming dirty arena ranges

## First Vertical Slice

The first truthful slice should intentionally avoid the full `ui` surface.

It should prove the seam with:

- one small draggable transform-controlled object
- one transform record
- one geometry record
- one frame/widget or equivalent input target

This allows:

- the export contract to stabilize
- the arena ABI to stabilize
- the renderer seam to stabilize

before broad compiler surface work starts.

## Relationship To Existing Native-Core Path

The repo already has:

- a native-core path
- standalone compiled executable generation

What is still missing is:

- UI-oriented compiled exports instead of `main()`
- runtime arena ABI emission
- a shared contract between native and browser runtimes

So this workstream should treat the current native-core path as a useful base,
not as the finished UI runtime contract.

## Overlay Host Boundary

`transparent-overlay` is a generic host. It may:

- open a transparent native window
- serve packaged assets
- expose packet and compiled-module transport endpoints
- load a compiled module by path or logical name
- provide input snapshots and host diagnostics

It must not:

- parse VKF source
- know VKF stdlib names or semantics
- lower VKF declarations into runtime records
- special-case VKF examples

VKF-owned runtime assets live in `vektor-flow`. The overlay receives those
assets as files, packets, arenas, or compiled modules. This keeps the host
usable by another language later without importing VKF-specific behavior.

## Current Transitional Seam

The repo now has a browser-side transitional seam in:

- [web/vf-ui/vf-shared-runtime.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-shared-runtime.js)
- [web/vf-ui/vf-wasm-demo-contract.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-wasm-demo-contract.js)
- [web/vf-ui/vf-vkf-ui-runtime.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-runtime.js)
- [web/vf-ui/vf-vkf-ui-kernel-adapter.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-kernel-adapter.js)
- [web/vf-ui/vf-vkf-ui-wasm-kernel-adapter.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-wasm-kernel-adapter.js)

And a first native-facing ABI sketch in:

- [native/VfOverlay/vf/compiled_ui_runtime_abi.hpp](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\native\VfOverlay\vf\compiled_ui_runtime_abi.hpp)
- [native/VfOverlay/vf/compiled_ui_runtime_demo.hpp](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\native\VfOverlay\vf\compiled_ui_runtime_demo.hpp)
- [native/VfOverlay/vf/compiled_ui_runtime_demo.cpp](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\native\VfOverlay\vf\compiled_ui_runtime_demo.cpp)

That layer is still JavaScript, so it is not the final destination.

But it is now useful because it proves:

- arena-backed input, transform, and geometry mutation can be exercised without
  Python in the hot path
- the compiled export contract can target a real host seam instead of a design
  note
- later `WASM` or native implementations can replace method groups behind the
  same public runtime shape instead of rethinking the seam from scratch
- the native overlay target can already compile a tiny update-driven rectangle
  demo against the ABI, even though that demo is not yet wired into the live
  browser/runtime bridge
- that same rectangle demo now builds as a standalone shared module
  (`vf-compiled-ui-demo.dll`), which is a more truthful compiled-module shape
  than only linking it into the overlay executable
- that shared module can now also be loaded and exercised through a thin native
  loader boundary, so the export contract is proven as a host-consumable module
  seam instead of only a linker-time arrangement
- that loader boundary now supports a tiny built-in module registry, so the
  host can resolve compiled modules by logical name as well as direct DLL path
- the browser-side seam now mirrors that same logical module naming for its
  wasm/demo registry, which helps keep the compiled-module discovery story
  aligned across native and browser hosts
- the browser-side runtime already consumes its hottest edit/pick operations
  through an injected adapter seam instead of directly depending on one JS
  implementation
- that adapter seam can already be satisfied by a WASM-shaped scratch-buffer
  contract for the transform/edit kernels and picking, even though the actual
  implementation is still test-side/browser-side today
- that same adapter seam is now exercised through the actual
  `createVkfUiRuntime(...)` object/frame runtime, so the browser-side contract
  is no longer only unit-tested in isolation
- one hover-picking path now runs through an actual `WebAssembly.Module`
  instance created by the browser-side test seam, which is the first concrete
  proof that this contract can be satisfied by real wasm rather than only a JS
  stand-in
- that wasm proof now covers more than one hover branch, with both vertex and
  edge picking exercised through real wasm module exports
- a first narrow edit kernel path now also runs through a real wasm export for
  vertex movement, which is the first concrete proof that edit operations can
  cross the same compiled seam instead of remaining JS-only
- a dedicated real wasm `rotateScaleTransform` export now exists with imported
  `cos`/`sin`, which is the first concrete proof that a transform kernel can
  cross the seam without leaning on the broader generic JS adapter path
- that transform proof is also exercised through `mesh.rotate_scale_at_vertex`
  in the arena-backed runtime tests, which makes it a real runtime seam rather
  than only a factory-level wasm demo
- `scaleEdgeTransform` now also has its own dedicated compiled seam and runtime
  proof as a pure wasm numeric kernel, so the browser transform proof no longer
  depends on host-side math for that branch
- those two transform exports now also coexist inside one combined compiled
  wasm module and one runtime adapter path, which is a more realistic compiled
  module shape than validating each transform branch in total isolation
- `rect-demo` now resolves through the browser registry to one compiled wasm
  module carrying pick, edit, and transform exports together, which is the
  first proof that one logical compiled module can own more than one hot path
- native compiled bootstrap preview now also reads geometry arena output from
  the compiled module and redraws a polygon from that state, which makes the
  host-visible proof closer to a real overlay object path than a transform-only
  preview
- native callers can now reach built-in compiled modules through a direct
  `LoadBuiltinFromDirectory(...)` helper, which tightens the host-facing module
  contract and reduces bootstrap drift
- `vf-overlay` now contains a small bootstrap flag for builtin compiled modules,
  so the host-facing contract is beginning to be exercised inside the real
  native shell instead of only in the standalone loader test
- that bootstrap path now flows through a reusable runtime-loader helper, and
  the browser side now instantiates builtin wasm modules through its registry,
  which reduces seam drift between discovery and execution
- the native host path now also emits a small bootstrap snapshot artifact,
  making the compiled-module effect visible outside logs, while the browser
  registry now exposes explicit wasm-factory resolution as part of the same
  discovery/execution seam
- the native host bootstrap path now also writes a tiny bootstrap HTML page and
  can route the overlay to it automatically when no scene page is supplied,
  which makes the compiled-module side effect directly inspectable in the host
- the browser-side wasm seam now has a second narrow edit proof for
  `translateEdgeVertices`, so the contract is no longer only hover-picking plus
  one-vertex movement
- the browser-side builtin module registry now resolves a richer combined wasm
  module for `rect-demo`, exposing both pick and edit exports through one
  instantiation path instead of splitting that proof across separate factories
- the native bootstrap preview now shows both init-time and post-update state
  for the compiled rect demo, which makes the host-visible compiled-module path
  closer to a real update-driven module contract
- that bootstrap preview is now also fed by real host mouse movement through
  the compiled module's `update` export, which makes the native host seam a live
  interaction proof instead of only a synthetic bootstrap artifact
- that native bootstrap preview now also serves live compiled state through
  `/api/compiled-ui-bootstrap`, so host inspection can move through a real API
  path instead of only polling the mirrored JSON file directly
- the native bootstrap state/update/file/API flow now sits behind a dedicated
  compiled-bootstrap runtime module, which gives the host-facing seam one place
  to deepen instead of continuing to spread that policy across `main.cpp`
- that compiled-bootstrap runtime now also emits standard
  `scene.replace`/`ui_state.replace`/`display.replace` packets for a
  `plot_panel` scene and routes builtin no-page launch through `vkf-scene.html`,
  so the compiled module now rides normal overlay packet/display shell flow
  instead of only a bespoke bootstrap preview page

## Acceptance

This contract is good enough for the first phase when:

- one compiled module can initialize UI runtime state
- one input update can mutate transform state
- the renderer consumes that state without Python or JSON in the hot path
- the same conceptual contract works for both native and `WASM` targets

## Open Questions

- whether shutdown is needed immediately or only after the first stable slice
- whether command append should stay function-based or become a command-arena write-only convention
- how much typed metadata should be visible to the runtime host versus staying in the compiler/tooling layer
