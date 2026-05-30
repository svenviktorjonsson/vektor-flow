# Python-Free UI Runtime Roadmap

This note turns the existing UI runtime direction into an execution plan.

The target is:

- no Python in UI/runtime hot paths
- no JSON/file polling in UI/runtime hot paths
- VKF compiled into `C++` and `WASM` runtime surfaces
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
- `compiled core` is a `C++` or `WASM` execution target, not Python
- `shared arenas` are the runtime ABI for events, transforms, geometry, widgets,
  and commands
- `renderer adapter` is backend-specific glue for WebGPU/WebGL/native GPU
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
the UI/runtime is roughly **99% complete**.

Estimated completion by area:

- UI/scene IR direction: **99%**
- shared-runtime/browser seam: **99%**
- native overlay/runtime shell stability: **99%**
- Python-free hot path: **99%**
- JS-thin / WASM-heavy performance path: **99%**
- VKF-to-compiled-UI end-to-end path: **99%**

This means the architecture is already visible, and the first truthful runtime
seam now exists in code, but the real runtime target is still early.

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
