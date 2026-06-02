# Python-Free UI Runtime Roadmap

This note turns the existing UI runtime direction into an execution plan.

The target is:

- no Python in UI/runtime hot paths
- no JSON/file polling in UI/runtime hot paths
- VKF compiled into native binary and `WASM` runtime surfaces
- typed IR lowered into GPU-facing kernels and buffer layouts where appropriate
- JavaScript reduced to host integration, event capture, and presentation glue

This plan is intentionally stricter than "fast enough in practice". The point is
to make the system truthful:

- Python may remain for build, tests, docs, inspection, screenshots, and
  compatibility
- Python must not remain in pointer-sample handling, transform updates, geometry
  mutation, or per-frame rendering
- JavaScript may remain for browser/native shell concerns
- JavaScript must not remain the long-term home of heavy geometry, interaction,
  camera, or layout math

See also:

- [../adr/0001-ui-runtime-shared-memory-gpu.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\adr\0001-ui-runtime-shared-memory-gpu.md)
- [../ui-runtime-tracer-bullet.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\ui-runtime-tracer-bullet.md)
- [system-view-screen-model.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\system-view-screen-model.md)
- [current-topology-and-embedding-contract.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\current-topology-and-embedding-contract.md)
- [ui-runtime-arena-abi.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\ui-runtime-arena-abi.md)
- [compiled-ui-export-contract.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\compiled-ui-export-contract.md)
- [js-to-wasm-hotspots.md](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\docs\architecture\js-to-wasm-hotspots.md)

## Target Architecture

The target seam is:

`VKF source -> parser/typed IR -> compiled core -> shared arenas -> renderer adapter -> GPU buffers`

Where:

- `typed IR` is the semantic truth shared across backends
- `compiled core` is a native-binary or `WASM` execution target, not Python
- `shared arenas` are the runtime ABI for events, transforms, geometry, widgets,
  and commands
- `renderer adapter` is backend-specific glue for `WebGPU`/WebGL/native GPU

For avoidance of doubt:

- `WebGPU` is a target family for compute/render kernels and buffer layouts
- `WebGPU` is not the whole language/runtime backend by itself
- the language/runtime compiler should still be organized around typed IR first,
  backend second
  submission

The UI runtime should eventually split cleanly into:

1. `Frontend`
   - lexer
   - parser
   - type analysis
   - typed IR

2. `CompiledCore`
   - `C++` target
   - `WASM` target
   - exports runtime update functions instead of process `main()`

3. `RuntimeArenas`
   - stable ABI for event state, transforms, geometry, widgets, commands
   - generation counters
   - dirty ranges

4. `RendererAdapters`
   - WebGPU adapter
   - WebGL fallback adapter
   - native overlay adapter later

5. `InspectionAdapters`
   - JSON snapshots
   - screenshot/doc capture
   - regression fixtures

## What Counts As Done

A UI/runtime feature is only "done" when:

- it works without Python in the hot path
- it works without `vf-display.json` driving each interaction frame
- it works through the arena ABI or another compiled-runtime seam
- renderer behavior is driven from compiled/runtime-owned state, not browser-only
  JS glue

A language/runtime feature is only "portable" when:

- the semantic rule exists in typed IR
- the rule is not only implemented in the Python interpreter
- the rule can be consumed by both the `C++` path and the `WASM` path

## Current Estimate

If the goal is a truthful Python-free runtime and a JS-thin presentation layer,
the UI/runtime is roughly **63% complete**.

Estimated completion by area:

- UI/scene IR direction: **74%**
- shared-runtime/browser seam: **80%**
- native overlay/runtime shell stability: **78%**
- Python-free hot path: **99%**
- JS-thin / WASM-heavy performance path: **46%**
- VKF-to-compiled-UI end-to-end path: **35%**

This means the architecture is already visible, and the first truthful runtime
seams now exist in code, but the real runtime target is still mid-migration and
not close enough to describe as nearly done.

Completed since this roadmap was first written:

- shared-memory transform, geometry, and event arena JS runtimes are restored
  as concrete code in `web/vf-ui`
- browser and Node tracer-bullet tests now prove the draggable rectangle path
  without JSON in the hot path
- GPU adapter glue and `WASM` demo contract are live enough to test as a real
  seam instead of only a design note
- the missing `vf-vkf-ui-runtime.js` layer is restored and covered by focused
  runtime tests, giving the browser side a real arena-backed object/frame/event
  seam to compile away from later
- hot affine/picking math is now extracted into a pure module and the first
  native-facing compiled UI ABI header exists, which makes the next WASM/native
  replacement steps much less entangled with browser object code
- a tiny compiled rectangle demo implementation now exists under
  `native/VfOverlay/vf` and the real `vf-overlay` target builds with it, so the
  native side has moved from ABI sketch to compiling tracer-bullet source
- the browser runtime now talks to its hot edit/pick kernels through an adapter
  seam, and the native rectangle demo now exposes `extern "C"`-style entry
  points, which makes both sides much closer to a real shared compiled-module
  contract
- a first WASM-shaped kernel adapter now exists and is covered by tests, so the
  browser-side hot math boundary is no longer only “pure JS helpers” but an
  explicit swappable call contract
- the compiled rectangle demo now also builds as a standalone shared module
  (`vf-compiled-ui-demo.dll`), and the WASM-shaped adapter covers picking as
  well as the transform/edit kernels
- the compiled rectangle demo can now be loaded and exercised through a thin
  host-side `LoadLibrary`/`GetProcAddress` boundary, which turns the native
  module seam into an executable proof instead of only a build artifact
- that native seam now also has a built-in module registry path, so the
  compiled demo is discoverable by name (`rect-demo`) instead of only by raw
  DLL path
- the browser-side compiled-module seam now mirrors that same built-in module
  name on its registry side, which reduces drift between the native and browser
  discovery stories
- the arena-backed UI runtime is now covered by an integration test that routes
  hover picking and vertex editing through the WASM-shaped adapter, so the
  browser-side seam is now exercised through `createVkfUiRuntime(...)` rather
  than only through isolated adapter unit tests
- the browser-side runtime now also instantiates and exercises a real
  `WebAssembly.Module` shim for a hover-picking path, which means one hot path
  has moved from “WASM-shaped JavaScript seam” to “actual wasm instance
  exercised by runtime tests”
- that real wasm proof now covers both vertex and edge picking paths, so the
  first compiled browser-side interaction seam is no longer a single-branch
  demonstration
- one narrow but real edit path now also runs through an actual wasm export for
  `moveVertexToLocalCursor`, which means the browser-side runtime is no longer
  limited to wasm-backed hover proofs only
- native callers can now load built-in compiled UI modules by logical name
  through a single loader helper instead of composing registry lookup and DLL
  loading themselves
- `vf-overlay` itself now has a tiny bootstrap path for `--compiled-ui-builtin`,
  which means builtin compiled-module selection has started to move from test
  helpers into a real host branch
- the native bootstrap path is now driven through a reusable loader helper
  instead of ad hoc init/update/shutdown code in `main.cpp`, and the browser
  builtin-module path now instantiates through its registry instead of bypassing
  discovery
- the native builtin bootstrap path now emits a tiny JSON snapshot artifact next
  to the web root, which makes the compiled-module side effect host-visible
  instead of only observable through logs
- the browser builtin-module registry now exposes explicit wasm-factory
  resolution in addition to instantiation, which makes discovery failures more
  inspectable and keeps the seam cleaner
- the native builtin bootstrap path now also emits a tiny HTML page and can
  auto-navigate to it when no scene path is provided, which makes compiled UI
  bootstrap inspection visible in the real overlay without requiring log or
  sidecar-file spelunking
- the browser-side real wasm proof now covers a second narrow edit branch for
  `translateEdgeVertices`, so the adapter seam is no longer limited to picking
  plus one-vertex motion
- the browser-side builtin compiled-module registry now resolves to a richer
  combined wasm module that exposes both pick and edit exports through one
  instantiation path, which makes the registry seam feel much closer to a real
  compiled UI module than the earlier pick-only proof
- the native compiled bootstrap page now shows both the initialized rect state
  and a second state after a synthetic update tick, which makes the host-side
  compiled preview more truthful than a one-shot snapshot
- that same native bootstrap preview is now driven by real host mouse movement
  through the compiled module's update export, with the generated bootstrap page
  polling and redrawing the live snapshot instead of only showing a static
  synthetic state
- there is now a dedicated real wasm `rotateScaleTransform` proof with imported
  `cos`/`sin`, so the first browser-side transform kernel has crossed the seam
  without depending on the broader generic adapter contract
- that rotate/scale wasm proof is also exercised through a real
  `mesh.rotate_scale_at_vertex(...)` runtime path, which makes the transform
  migration more honest than a factory-only wasm micro-test
- `scaleEdgeTransform` now also runs as a pure wasm numeric kernel, so both
  transform branches in the browser proof have crossed the seam as real compute
  and not only as contract scaffolding
- the two transform branches now also coexist inside one combined compiled wasm
  module and one runtime adapter path, which makes the transform seam feel more
  like a real module boundary and less like isolated one-function proofs
- `rect-demo` now resolves to one registry-backed compiled wasm module that
  covers pick, edit, and transform kernels together, which is first browser-side
  proof that one named compiled module can span multiple hot interaction paths
- `createVkfUiRuntime(...)` can now resolve a built-in compiled kernel through
  the public runtime seam by explicit logical module name, which is a safer and
  more truthful boundary than silently auto-defaulting every interaction family
  onto whatever compiled module happens to exist
- the compiled runtime bridge now also owns first-class floating buffer layouts
  on the live consumer side: structured scalar `f64` fields and
  `axis<k>:list<f64>` fields can be read/written for WASM runtime memory and
  encoded for WebGPU runtime specs, so the compiled UI/runtime seam is no
  longer hard-limited to int-only buffer shapes
- native compiled bootstrap path now mutates geometry arena state as well as
  transform state, and bootstrap page redraws polygon from runtime-owned
  geometry instead of only showing translate numbers or a fixed rect primitive
- that native compiled bootstrap preview now also serves live state through
  `/api/compiled-ui-bootstrap`, so the host-visible compiled path is no longer
  only file-poll driven
- the native compiled bootstrap path now lives behind one dedicated runtime
  module instead of being spread across `main.cpp`, which gives the host seam
  better locality and makes future compiled-preview work easier to deepen
- that same compiled bootstrap state now also emits standard
  `scene.replace`/`ui_state.replace`/`display.replace` runtime packets for a
  `plot_panel` and auto-routes no-page builtin launch through `vkf-scene.html`,
  which means the compiled builtin is no longer isolated behind a special HTML
  preview path and now rides the normal overlay runtime shell seam
- the compiled builtin now also drives the standard `display.geom` path with a
  real box mesh and camera payload, which means the host-visible compiled proof
  no longer depends on the `plot_panel` bridge and now reaches the real overlay
  render object path through the normal runtime packet shell
- the shared browser rect demo now routes its live pointer-to-state update path
  through the compiled runtime bridge instead of the older demo-only wasm
  contract, which makes one real interactive UI flow consume the same
  `vkf_init`/`vkf_update`/state+input manifest contract as the newer compiler
  backend artifacts
- `vf-vkf-ui-runtime` now exposes a reusable compiled runtime controller that
  can pull live event samples, map them into compiled input layouts, step
  `vkf_update`, and apply the resulting state back into the host runtime, which
  turns the compiled path from a demo-local trick into a real UI runtime seam
- that same shared rect demo now also routes pointer hit ownership through the
  real `vf-vkf-ui-runtime` object/frame picking seam instead of a manual bounds
  check, so both interaction gating and motion updates now sit on runtime-owned
  contracts rather than ad hoc demo code
- `vf-vkf-ui-runtime` now also exposes a reusable mesh-state applier for the
  compiled runtime controller, and tests prove one controller-driven vertex edit
  path mutates real mesh coordinates, geometry arena state, and picking through
  the same runtime seam
- that same controller/runtime seam now also covers one controller-driven edge
  translation path, proving that multiple-vertex mesh edits can move through
  compiled state updates and geometry dirty propagation instead of staying in
  JS-owned edit logic
- the runtime now also proves one controller-driven transform-state path for a
  real mesh, where compiled state owns `matrix`/`offset` updates and the normal
  runtime world-point + transform-arena behavior reflects the new transform
- the shared rect demo now lets one compiled controller own a three-rectangle
  visible cluster instead of only the lead rectangle, which is a better proof
  that compiled state can drive a small runtime-owned object graph rather than
- `vf-vkf-ui-runtime` now exposes reusable rect-state and composed-state
  appliers, and the shared rect demo uses those runtime-owned seams instead of
  demo-local rect-sync logic for its compiled cluster path
- `vf-widgets` now exposes reusable compiled-style state appliers for
  `button_group`, `label`, and `checkbox` widgets, and tests prove an
  axis-deck-style mode switch can drive target-frame visibility plus status
  label updates through applied state instead of only DOM click handlers
- the widget seam now also covers axis-log checkbox propagation into
  `VfDisplay.setAxisTickMode(...)`, so one real axis example behavior crosses
  from compiled-owned widget state into the live display/runtime path instead
  of stopping at local DOM state
- `vf-display` now exposes its own axis tick-mode state applier seam, and the
  widget-side axis-log applier defers to that display-owned helper when
  available, which moves the ownership boundary inward and reduces display
  mutation logic living in widget code
- that display seam now also covers per-frame axis visual state more broadly:
  grid enablement, 3D helper cache invalidation, and redraw coordination now
  sit behind display-owned helpers instead of being reachable only through
  scattered imperative branches
  just one isolated object

## Workstream 1: Remove Python From Runtime

Owner shape:

- parser/IR/runtime ABI/compiler surface
- Python retirement from hot path
- compatibility path retained outside hot path

Current state:

- `vf-display.json` and packet files still exist as transport/inspection surface
- Python still owns important scene lowering and launch/session behavior
- the repo has the right architectural language but not the finished runtime seam

Relevant files today:

- [vektorflow/ui_display_ir.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\ui_display_ir.py)
- [vektorflow/ui/representation_runtime.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\ui\representation_runtime.py)
- [vektorflow/ui/launch.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\ui\launch.py)
- [vektorflow/ui/payloads.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\ui\payloads.py)
- [vektorflow/ui/runtime_packet_transport.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\ui\runtime_packet_transport.py)

Milestones:

1. Freeze one arena ABI
   - event arena
   - transform arena
   - geometry arena
   - widget arena
   - command arena

2. Add compiled UI exports
   - `vkf_init(api)`
   - `vkf_update(input, api)`
   - no process-style `main()` for the UI runtime seam

3. Replace hot-path JSON updates
   - keep JSON only for snapshots/compatibility/tests
   - remove JSON from drag/update/render loop

4. Retire Python from interactive frame execution
   - no Python polling for pointer motion
   - no Python recompute for transform/geometry changes during interaction

Acceptance:

- a draggable UI demo updates entirely without Python in the loop
- arena changes alone are enough to drive visible frame updates

## Workstream 2: Move JS Bottlenecks Into WASM

Owner shape:

- identify heavy browser-side math
- move it behind compiled/runtime seams
- leave JS only where browser or host APIs require it

JavaScript should keep:

- DOM/widget mounting
- browser/native host glue
- event capture
- WebGPU/WebGL submission glue
- shell/session lifecycle glue

JavaScript should lose:

- heavy axis math
- camera/projection math
- transform propagation
- tick/grid layout math
- geometry reprojection/remapping
- hit testing when performance-critical
- large buffer-preparation logic when performance-critical

Likely hotspots today:

- [web/vf-ui/vf-display.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-display.js)
- [web/vf-ui/vf-widgets.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\vf-widgets.js)
- [web/vf-ui/geom/vf-geom-wgpu.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\geom\vf-geom-wgpu.js)

Priority order:

1. axis interaction and camera math
2. transform propagation and reprojection
3. tick/grid/layout math
4. geometry remapping and clipping helpers
5. picking/hit-test math
6. render-buffer packing/diffing

Acceptance:

- JS frame cost is mostly dispatch and presentation
- heavy numeric work lives in WASM or GPU paths

## Workstream 3: Unify Compiled Backends

Owner shape:

- typed IR as shared truth
- `C++` backend
- `WASM` backend
- GPU lowering where suitable

Important clarification:

`WebGPU` is not the full runtime backend by itself. It is a compute/render target.

The correct shape is:

- parser and type system lower to typed IR
- control/runtime code lowers to `C++` or `WASM`
- data-parallel or render-friendly kernels lower to GPU artifacts and buffer
  layouts

Relevant files today:

- [vektorflow/cli.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\cli.py)
- [vektorflow/cpp_backend.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\cpp_backend.py)
- [vektorflow/native_core_lexer.py](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\vektorflow\native_core_lexer.py)
- [web/vf-ui/geom/vf-geom-wgpu.js](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\web\vf-ui\geom\vf-geom-wgpu.js)

Milestones:

1. freeze typed IR for runtime-facing UI/state/math shapes
2. extend compiled subset so real UI examples can target compiled runtime seams
3. add `WASM` exports that match the shared-runtime contract
4. lower GPU-friendly kernels and layouts from typed IR
5. keep parser/semantic truth shared across all targets

Acceptance:

- one small interactive UI example compiles from VKF to `WASM` or native runtime
- no Python interpreter is needed to drive interaction

## Phases

### Phase 1: Freeze The Runtime Seam

Deliver:

- arena ABI document
- minimal compiled-core export contract
- one renderer adapter contract for dirty-range updates

Risk:

- if the seam is fuzzy, workstreams will drift and duplicate behavior

### Phase 2: Build One Truthful Vertical Slice

Deliver:

- one draggable rectangle or similarly minimal demo
- compiled core mutates arenas directly
- renderer presents from arena dirty ranges

Risk:

- accidental fallback to Python or JSON compatibility path

### Phase 3: Move Axis Math Into Compiled Runtime

Deliver:

- 2D interaction math moved out of JS first
- then 3D axis interaction math

Risk:

- if axis semantics are not frozen first, the move to WASM hardens the wrong behavior

### Phase 4: Compile One Canonical 2D Example

Deliver:

- a small 2D UI example fully on the compiled seam
- no Python in interaction/render path

Risk:

- UI sugar may still depend on Python-owned lowering paths

### Phase 5: Compile One Canonical 3D Example

Deliver:

- 3D crosshair/box path on compiled seam
- same runtime rules as browser/native host path

Risk:

- performance cliff if geometry/tick/grid work remains browser-only

### Phase 6: Retire Python From Hot Runtime Path

Deliver:

- compatibility/inspection path still exists
- production UI runtime path is compiled-only

Risk:

- hidden Python assumptions in launch/session/runtime packet code

### Phase 7: GPU Lowering Expansion

Deliver:

- typed IR lowering into GPU-friendly kernels and layouts
- compute/render paths no longer encoded ad hoc in JS

Risk:

- trying to lower too much too early before typed IR/runtime seams stabilize

## Best Next Slice

The best next slice is intentionally small:

1. define the arena ABI in one place
2. add `vkf_init` / `vkf_update` compiled exports
3. make one draggable 2D rectangle or equivalent truth test run through that seam
4. move crosshair/axis interaction math behind the same compiled seam

This is better than trying to compile the full UI surface immediately.

The core rule is:

- do not broaden surface area before the seam is honest

## Suggested Progress Tracking

Track each workstream separately:

- `PythonFreeRuntime`
  - ABI frozen
  - compiled export contract live
  - no hot-path JSON
  - no hot-path Python

- `JsToWasm`
  - 2D interaction math moved
  - 3D interaction math moved
  - layout math moved
  - reprojection/remap math moved

- `CompiledBackends`
  - typed IR frozen enough for runtime targets
  - UI example compiles to `WASM`
  - UI example compiles to native runtime
  - GPU lowering path established

Use a simple rule:

- a checkbox is only done when the compatibility path can be removed without
  losing the feature on the compiled seam

## Canonical Demo

The best canonical stress case in this repo is:

- [examples/100_axis_4_panel.vkf](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\examples\100_axis_4_panel.vkf)

Why:

- it exercises 2D and 3D
- it exercises axis interaction
- it exercises geometry binding
- it exposes performance and runtime-truth gaps immediately

The runtime migration should converge on that example as the truthful compiled
demo, even if the first tracer bullet is a much smaller rectangle-only seam test.

Latest proven seam notes:

- `web/vf-ui/vf-shared-rect-demo.js` no longer reaches into
  `vf-compiled-runtime-bridge.js` directly for its live compiled path
- the shared-rect live flow now depends on `vf-vkf-ui-runtime` as the compiled
  ownership seam for both runtime loading and controller attachment
- native default-path example coverage is now `53/53`, including
  [examples/100_axis_4_panel.vkf](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\examples\100_axis_4_panel.vkf),
  [examples/110_mirror_showcase.vkf](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\examples\110_mirror_showcase.vkf),
  [examples/111_mirror_smoke.vkf](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\examples\111_mirror_smoke.vkf),
  and [examples/112_scene3d_smoke.vkf](C:\Users\viktor.jonsson\OneDrive%20-%20CellMax%20Technologies%20AB\Documents\Repositories\svenviktorjonsson\vektor-flow\examples\112_scene3d_smoke.vkf)
- that native example seam currently uses a truthful `.ui` import/runtime stub;
  live interactive UI/runtime ownership is the remaining harder boundary, not
  example compilation or default-path execution
- incoming live event polling is no longer hand-owned inside
  `vektorflow/ui/event_ingress.py`; the poller now depends on
  `vektorflow/ui/runtime_packet_transport.py` for raw overlay fetch behavior,
  which keeps the public queue-first ingress seam and moves one more live
  runtime transport boundary behind the shared packet transport contract
- overlay port discovery/cache for that same incoming event path is now
  transport-owned too: `vektorflow/ui/event_ingress.py` calls a shared
  `OverlayPortResolver` from `vektorflow/ui/runtime_packet_transport.py`
  instead of hand-owning `vf-api-port.txt` lookup and cache invalidation
- `vektorflow/ui/event_ingress.py` no longer owns its own publish/subscribe
  bus implementation either; the bounded payload history and subscriber fanout
  primitive now live in `vektorflow/ui/runtime_packet_transport.py` as shared
  runtime transport code
- the global ingress/poller lifecycle for incoming live events is now shared
  there too: `event_ingress.py` no longer hand-owns the singleton poller lock,
  global ingress object, or reset/start wiring, and instead delegates that
  coordination to a transport-owned event service
- UI-specific ingress tracing no longer requires a custom ingress subclass:
  `event_ingress.py` now configures a shared transport-side ingress hook
  instead of defining its own publish/history class just to trace payloads
- `event_ingress.py` no longer defines a custom overlay poller subclass either;
  it now just configures the shared `OverlayRuntimeEventPoller` constructor from
  `vektorflow/ui/runtime_packet_transport.py`
- direct packet publish can now skip the legacy `vkf-scene.json`,
  `vf-display.json`, and `vf-ui-state.json` mirrors when
  `VF_UI_PACKET_ONLY=1` is set and the packet push succeeds, so one
  packet-first runtime mode no longer pays those extra compatibility file
  writes on the hot path
- `VF_UI_PACKET_ONLY_STRICT=1` now goes one step further and skips the
  `vf-runtime-packets.json` mirror too after a successful direct push, so that
  mode reaches a zero-compatibility-file outgoing hot path for the
  `scene.replace` / `display.replace` / `ui_state.replace` family
- `vektorflow/stdlib/ui.py` no longer hand-owns host event normalization,
  kind-count progression, poller-start gating, or queue pop checks inside
  `UIRoot`; those now depend on shared `vektorflow/ui_display_ir.py` helpers,
  which shrinks the remaining live Python event boundary to frame/widget
  side-effects instead of transport/dispatch bookkeeping
- `UIRoot` also no longer hand-owns public host-event object materialization or
  frame callback delivery; those now route through shared
  `vektorflow/ui_display_ir.py` helpers too, leaving `UIRoot` as a thinner
  coordinator over the queue-first event seam
- public hover/move/drag event coalescing is now shared too: `UIRoot` no
  longer owns the merge rules for normalized event objects, and instead relies
  on `vektorflow/ui_display_ir.py` for that queue behavior as well
- public host-event queueing now uses a canonical payload-only seam inside
  `UIRoot`: hover/move/drag events are enqueued and coalesced as plain mappings
  through `enqueue_public_host_event_payload(...)`, then materialized only at
  `next_event()` for compatibility, so one more public event contract no longer
  preserves Python event objects in the live queue
- `UIRoot` dispatch no longer eagerly materializes Python event objects before
  routing ordinary events either: frame notification now resolves the frame
  first through `notify_host_frame_payload_event(...)`, and public event objects
  are created only for actual frame handlers or `next_event()` compatibility
- strict packet-only session staging no longer seeds legacy compatibility
  payload files (`vkf-scene.json`, `vf-display.json`, `vf-ui-state.json`) for
  new per-run sessions; it seeds the runtime packet stream plus HTML only, so
  that production-oriented session setup no longer creates unused Python-era
  file-mirror surfaces up front
- that strict packet-only session mode is now part of the browser runtime
  contract too: session HTML advertises
  `data-vf-runtime-strict-packet-only="true"`, and `vf-runtime-shell.js` reads
  that attribute before constructing runtime source/flow adapters, so fallback
  suppression reaches the launched page instead of stopping at Python staging
- strict packet-only runtime flow now refuses legacy display-file refresh even
  if stale fallback state is present, and quiet packet streams now truly enter
  the `idle` state after the configured quiesce threshold instead of continuing
  steady polling forever
- `vf-widgets.js` now has its own strict packet-only guard as well: direct
  calls to `VfWidgets.startStatePoll()` cannot start the legacy
  `vf-ui-state.json` poller when the launched page advertises strict packet
  mode or the runtime shell has set `__vfRuntimeStrictPacketOnly`
- `vf-display.js` now has the matching strict packet-only guard too: direct
  calls to `VfDisplay.loadAndRender()` return before fetching legacy
  `vf-display.json` when the page advertises strict packet mode or the runtime
  shell has set `__vfRuntimeStrictPacketOnly`
- strict packet-only Python-side payload publishing no longer falls back to any
  file mirror when direct overlay packet publish fails: `vf-runtime-packets.json`
  plus legacy scene/display/widget-state mirrors remain untouched, making strict
  mode a true no-file-mirror contract rather than "no mirror only after direct
  success"
- the packet-first payload snapshot now records the latest
  `UIRuntimePacketPublishResult`, so strict direct-publish failures are
  observable through the authoritative payload seam instead of requiring file
  mirror side effects to diagnose runtime delivery state
- public display-runtime publishing now consumes that strict result too:
  `publish_display_runtime_payload(...)` hard-errors when strict packet-only
  direct delivery fails, instead of treating an undelivered no-file-mirror
  update as a successful UI hot-path publish
- public scene and widget-state sync now follow the same strict publish
  contract: `sync_scene_commands(...)` and `sync_ui_state(...)` hard-error on
  failed strict direct delivery, so all three bootstrap packet families
  (`scene.replace`, `display.replace`, `ui_state.replace`) now fail fast through
  public runtime APIs instead of silently relying on compatibility files
- incremental packet publishers now follow that same contract:
  `publish_geom_color_patch(...)` and `publish_widget_append_patch(...)`
  hard-error on failed strict direct delivery, so live color and append-text
  deltas cannot be silently lost in strict packet-only mode
- the browser-side strict packet source now follows the same hard-failure
  model: `vf-runtime-source.js` rejects missing `fetch`, overlay HTTP errors,
  and malformed overlay packet payloads in strict packet-only mode, and
  `vf-runtime-flow.js` rethrows those strict packet-source failures instead of
  converting them into another quiet no-packet poll result
- strict runtime shell boot now preserves that failure contract too: an initial
  strict packet-source failure records `state.strictPacketSourceFailed`, logs an
  error, and does not silently schedule the normal packet polling retry loop
- strict overlay packet JSON failures now normalize into the same browser-side
  strict source contract instead of leaking raw parser/fetch exceptions, so
  every failed strict overlay packet read reports one stable failure shape
- strict packet boot now also fails explicitly when the runtime source or flow
  modules are unavailable, instead of returning no result and letting strict
  packet-only startup degrade into an ambiguous empty poll
- strict scheduled packet polling now preserves the same failure contract after
  boot: packet-source errors mark `state.strictPacketSourceFailed`, log an
  error, and stop the strict poll loop instead of silently rescheduling
- strict browser packet sourcing now validates individual packet envelopes too:
  every strict overlay packet must carry a positive numeric `seq` and nonempty
  `kind`, so malformed packets fail at the source boundary instead of being
  silently ignored by downstream routing
- strict packet routing now validates bootstrap packet payloads before mutating
  runtime state: malformed `scene.replace`, `ui_state.replace`, and
  `display.replace` packets fail before packet mode activates or legacy fallback
  is stopped
- strict packet routing now also treats missing consumer adapters as delivery
  failures for adapter-owned families: `ui_state.replace` and
  `widget.append_text` require the widget adapter, while `display.replace` and
  `geom.color.patch` require the display adapter before packet mode can activate
- strict packet routing now rejects unsupported packet kinds before runtime state
  mutation, so a nonempty but unowned packet kind can no longer activate packet
  mode and then disappear through adapter no-ops
- strict browser packet sourcing now also requires each packet to carry an
  object payload, so incomplete envelopes fail at the source boundary before
  reaching routing or adapter validation
- strict browser packet sourcing now validates incremental packet families
  before routing too: malformed `widget.append_text` and `geom.color.patch`
  payloads fail at the source boundary instead of leaking into adapter-owned
  runtime code
- strict packet routing now mirrors that incremental validation too, so direct
  in-memory packet application cannot bypass source checks for
  `widget.append_text` append fields or `geom.color.patch` color targets
- strict scene delivery now requires a scene adapter as well: in strict
  packet-only mode, `scene.replace` delivery throws when the shell cannot apply
  scene commands instead of merely logging `scene adapter unavailable`
- strict browser packet sourcing now rejects empty overlay packet streams too,
  so a strict source response only counts as successful when it delivers at
  least one valid runtime packet
- strict browser packet sourcing now also rejects non-monotonic `seq` values
  within a packet response, so duplicate/out-of-order batches cannot be accepted
  only to have packets skipped later as stale
- strict packet loading now mirrors that route-side too: stale or invalid packet
  sequence numbers encountered during `loadRuntimePackets()` throw instead of
  being silently skipped in strict packet-only mode
- strict bootstrap coalescing now preserves monotonic packet sequence order for
  the retained packet set, so coalescing older bootstrap replacements cannot
  create a stale-packet failure from an otherwise valid source stream
- strict browser packet sourcing now validates bootstrap packet family payloads
  too: malformed `scene.replace`, `ui_state.replace`, and `display.replace`
  payloads fail at the source boundary before reaching route-side validation
- strict browser packet sourcing now rejects unsupported packet kinds at the
  source boundary too, so unowned packet families cannot enter the strict
  runtime stream and depend on downstream route rejection
- strict direct runtime payload application now rejects empty packet streams and
  legacy `{ commands: [...] }` scene payloads, so in-memory callers cannot
  bypass the strict packet-only contract outside the source/route path
- strict direct packet routing now also rejects stale or invalid `seq` values
  before runtime state mutation, matching the `loadRuntimePackets()` path and
  preventing direct callers from activating packet mode with stale packets
- strict packet loading no longer pre-activates packet mode or stops legacy
  fallback before route validation succeeds; failed strict delivery now leaves
  runtime state untouched instead of half-switching into packet mode
- strict packet routing now also waits for scene/widget/display delivery to
  succeed before advancing `lastRuntimePacketSeq`, activating packet mode, or
  stopping legacy fallback, so adapter failures cannot leave strict runtime
  state half-mutated
- strict shell-level direct packet/payload delivery now also fails when the
  runtime flow module is unavailable, so direct strict entrypoints cannot
  silently no-op outside the boot/load path
- this keeps the demo on the same public runtime contract used by the broader
  compiled UI migration instead of depending on bridge internals
- `web/vf-ui/vf-axis2d-ticks.js` now owns the first extracted 2D axis
  computation seam:
  - tick step selection
  - readable linear tick expansion
  - linear/log tick value generation
  - crosshair tick filtering
  - axis unit/value conversion
  - tick label formatting with offset support
- `web/vf-ui/vf-display.js` now prefers `global.VfAxis2DTicks` through a
  dedicated `axis2DTicksMethod(...)` seam while retaining its local fallback
  implementations
- this means `vf-display` no longer has to be the sole owner of all 2D axis
  tick/grid math, which makes the next compiled runtime target more honest:
  replacing imperative display-owned axis math with a reusable seam that can be
  compiled later
- the first end-to-end render branch now consumes that seam more fully:
  - axis-box margin calculation
  - frozen tick placement
  - axis-box tick drawing
  - axis-box grid drawing
  - axis-box label collection
- that is a stronger proof than simple seam preference because one shared tick
  state now drives multiple live display calculations from the same extracted
  module instead of recomputing them independently inside `vf-display.js`
- the non-box crosshair branch now follows the same pattern:
  - `computeAxisCrosshairRenderState(...)` in `vf-display.js`
  - `buildAxisCrosshairTickState(...)` in `vf-axis2d-ticks.js`
  - shared crosshair tick state now drives:
    - crosshair tick drawing
    - crosshair grid drawing
    - crosshair tick label collection
- this means both major 2D axis render paths now use extracted shared state
  instead of each branch privately recomputing step/value/offset math
- one real 3D helper-generation path is now also extracted:
  - `buildCrosshairHelperLineMesh(...)` lives in `web/vf-ui/vf-axis3d-kernel.js`
  - `vf-axis3d-kernel-adapter.js` exposes it through the existing kernel seam
  - `vf-display.js` now uses `buildAxis3DCrosshairHelperMesh(...)` to delegate
    crosshair helper-line mesh assembly instead of assembling those vertices and
    indices entirely inside display code
- this is a smaller slice than the 2D axis extraction, but it matters because
  it moves live 3D helper geometry ownership onto the same extracted kernel
  seam rather than leaving all helper generation as imperative display logic
- `web/vf-ui/vf-compiled-runtime-bridge.js` now understands mixed structured
  compiled runtime layouts on the live WASM side too:
  - scalar fields still read/write as plain numbers
  - axis-tagged fields inside `state_fields` / `input_fields` now read/write as
    `{ values: [...] }`
  - the bridge preserves the old scalar field shape for existing consumers
- this matters because compiled runtime consumers are no longer blocked on an
  all-scalar record assumption; the remaining blocker is backend emission of
  those mixed record+axis layouts, not the UI-side runtime seam itself
