# JS To WASM Hotspot Inventory

This note identifies which browser-side UI/runtime work should move out of
JavaScript first.

The rule is:

- JavaScript keeps host integration and presentation glue
- heavy runtime math moves to compiled runtime or GPU paths

See also:

- [python-free-ui-runtime-roadmap.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\python-free-ui-runtime-roadmap.md)
- [ui-runtime-arena-abi.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\ui-runtime-arena-abi.md)
- [compiled-ui-export-contract.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\compiled-ui-export-contract.md)

## Keep In JavaScript

JavaScript should remain responsible for:

- DOM mounting
- browser and WebView shell integration
- pointer and keyboard capture
- canvas/WebGPU/WebGL context wiring
- host fetch/post glue
- session lifecycle and asset bootstrap

These are host duties, not heavy runtime duties.

## Move Out Of JavaScript

The following areas are good candidates for WASM or compiled runtime movement.

### Priority 1: Axis Interaction Math

Files:

- [web/vf-ui/vf-vkf-ui-math.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-math.js)
- [web/vf-ui/vf-vkf-ui-kernel.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-kernel.js)
- [web/vf-ui/vf-vkf-ui-kernel-adapter.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-kernel-adapter.js)
- [web/vf-ui/vf-vkf-ui-wasm-kernel-adapter.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-wasm-kernel-adapter.js)
- [web/vf-ui/vf-display.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-display.js)
- [web/vf-ui/vf-vkf-ui-runtime.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-runtime.js)

Includes:

- 2D pan/zoom transforms
- 2D rotation snapping
- 3D crosshair/box rotation math
- axis lock and drag classification
- snapped/raw orientation tracking
- frame-local drag math and hover event shaping in the arena-backed UI runtime

Why first:

- interaction feel is correctness-sensitive
- this code runs often during drag
- this logic is already complex enough that it wants a clearer compiled seam
- `vf-vkf-ui-math.js`, `vf-vkf-ui-kernel.js`,
  `vf-vkf-ui-kernel-adapter.js`, and
  `vf-vkf-ui-wasm-kernel-adapter.js` now form the first explicit swap boundary,
  so they are the natural pilot modules for a WASM replacement
- that boundary now covers both transform/edit kernels and picking, which means
  `vf-vkf-ui-runtime.js` can stay focused on object/frame orchestration while
  the numeric interaction code migrates separately
- that boundary is now exercised through the actual arena-backed runtime tests,
  not only through isolated adapter tests, which makes it a much more truthful
  staging seam for a real WASM module
- there is now also a tiny real `WebAssembly.Module` factory used in tests for
  a hover-picking path, so the first browser-side hot path has crossed from
  “adapter-only” to “real wasm instance”
- that test seam now covers both vertex and edge picking branches, which makes
  the early wasm proof less toy-like and more representative of the real hover
  pipeline
- there is now also a real wasm-backed `moveVertexToLocalCursor` proof for a
  narrow one-vertex case, which is the first step from hover-only wasm into
  edit-kernel wasm
- there is now also a second narrow real wasm edit proof for
  `translateEdgeVertices`, which means the seam now covers both vertex motion
  and a small edge-translate branch instead of only one edit shape
- the builtin browser-side compiled-module registry now points at a combined
  pick-and-edit wasm module for `rect-demo`, so one registry-backed module
  instantiation can exercise multiple hot interaction kernels through the same
  compiled seam
- there is now also a dedicated real wasm `rotateScaleTransform` proof with
  imported `cos`/`sin`, which means the first transform kernel has started to
  cross the seam through a purpose-built contract instead of only the broad
  generic adapter path
- `scaleEdgeTransform` now also runs as a pure wasm numeric kernel, so the
  browser transform seam now covers both transform branches as real compute and
  not only as a contract-level crossing
- those two transform exports now also run together from one compiled wasm
  module through one runtime adapter path, which makes the transform migration
  closer to a real module boundary than the earlier one-export-at-a-time proofs
- builtin browser registry now points `rect-demo` at one compiled wasm module
  carrying pick, edit, and transform kernels together, so one named module now
  spans multiple hot paths instead of only one kernel family

### Priority 2: Camera / Transform Propagation

Files:

- [web/vf-ui/vf-display.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-display.js)
- [web/vf-ui/geom/vf-geom-wgpu.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\geom\vf-geom-wgpu.js)
- [web/vf-ui/vf-vkf-ui-runtime.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-runtime.js)

Includes:

- matrix updates
- camera reprojection helpers
- world/local transform propagation
- mirror/surface camera preparation where performance-critical
- mesh affine updates, child transform propagation, and parent/local conversion
  helpers used by the arena-backed UI runtime

Why second:

- this math belongs naturally near the transform arena
- it will benefit from the same compiled seam as interaction logic

### Priority 3: Tick / Grid / Label Layout Math

Files:

- [web/vf-ui/vf-display.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-display.js)

Includes:

- tick position generation
- grid suppression rules
- label boundary/gap solving
- crosshair/box label anchoring

Why third:

- not every scene needs it
- but axis-heavy scenes exercise it constantly
- once interaction math is compiled, this is the next big axis-specific load

### Priority 4: Geometry Remapping / Reprojection

Files:

- [web/vf-ui/vf-display.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-display.js)

Includes:

- axis-bound plot reprojection
- 2D box clipping helpers
- 3D axis-bound geometry remapping to live box state

Why fourth:

- this is strongly tied to runtime-owned geometry and transforms
- it should move after the transform/axis seams are stable

### Priority 5: Picking / Hit Testing

Files:

- likely shared across display/runtime shell paths as interaction deepens
- [web/vf-ui/vf-vkf-ui-runtime.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-vkf-ui-runtime.js)

Includes:

- object/edge/vertex hover math
- drag target resolution
- screen-to-data hit projection
- point-in-polygon and edge-distance tests currently implemented in the JS
  arena-backed runtime layer

Why fifth:

- important, but can wait until the core transform and interaction contracts are stable

### Priority 6: Buffer Preparation / Diffing

Files:

- [web/vf-ui/geom/vf-geom-wgpu.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\geom\vf-geom-wgpu.js)

Includes:

- data packing
- range updates
- upload orchestration that becomes expensive in large scenes

Why sixth:

- this area may partially stay in JS if it remains thin
- only move what is shown to be expensive or semantically too deep

## Sequencing Rule

Do not move code by file. Move it by seam.

Good move:

- define one compiled interaction API
- move all axis rotation math behind it

Bad move:

- copy random helpers into WASM while the main ownership is still split

## First Candidate Seam

The first good WASM seam is:

- current cursor/input snapshot
- current raw orientation state
- current snapped orientation state
- active drag lock classification
- return updated raw/snap state and transform deltas

This lets JS do:

- event capture
- schedule one runtime call
- render from resulting state

without owning the heavy math.

## Acceptance

A hotspot migration is done when:

- the JS path only marshals inputs and consumes outputs
- the heavy math is no longer duplicated in browser-only code
- behavior is testable outside DOM/browser details

## Open Questions

- whether hit testing should move into compiled runtime or GPU picking first
- whether some layout math is cheap enough to stay in JS longer
- how much matrix/camera math should live in shared WASM versus backend-specific renderer adapters
