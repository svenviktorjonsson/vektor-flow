# Rabbit startup gate

This harness measures the staged Stanford Bunny application through an
offscreen `--headless=new` Edge process. The Edge child is also created with
`windowsHide: true`; the benchmark must never open a visible window.

The timing contract is process spawn to the atomic `ui:revealed` mark. Reveal
is valid only after the visible WebGPU queue reports completion. For the
compiled application, the gate also requires all four WASM/WGSL artifacts,
the compiled dependency closure, both WASM arenas, every canonical draw list,
and the depth-1/depth-2 floor and upright-mirror reflection passes. The JSON
retains navigation, dependency, compiled-artifact, scene, GPU-completion, and
reveal stages for every cold-profile and warm-profile sample. The older native
arena/renderer probe remains available for legacy staged pages.

Run the real hardware gate against an already staged application:

```powershell
node benchmarks/rabbit-startup/run.mjs --pairs=3 --scene=.w/startup-fast/web/sessions/app/vkf-scene.html
```

The command writes `.w/rabbit-startup-evidence/latest.json` and exits nonzero
unless every sample is fully rendered in at most 500 ms. A fresh Edge profile
is used for each cold sample; the immediately following warm sample reuses
that profile. “Cold” does not claim that the Windows filesystem cache was
flushed.

An existing native-host JSONL trace can be joined into the same gate with
`--host-trace=PATH`. The harness deliberately does not launch the native host,
because that would violate its no-visible-window measurement boundary.

Use `--gpu=swiftshader` only to debug correctness. SwiftShader results are
recorded but can never pass the performance gate.

## Fresh-Edge platform floor

The 500 ms requirement remains the application gate. A fresh headless Edge
process is also retained as a diagnostic, but its process-spawn timing includes
browser and graphics-platform initialization which the packaged overlay host
can keep alive and reuse.

September 2026 hardware samples measured 0.9–1.1 s in
`navigator.gpu.requestAdapter()`, 0.3–0.7 s in `requestDevice()`, and 0.5–0.9 s
in cold WebGPU pipeline creation. In comparison, uploading the 2.27 MB
compiler-owned scene arena took about 5–14 ms and first submit/work completion
took about 20–35 ms. These substages are emitted in each evidence file using
the `compiled-gpu:*` timeline marks. Do not reinterpret a fresh-Edge failure as
proof that the retained compiled scene itself exceeds the application budget.

The compiled bootstrap starts dependency fetches in parallel and primes GPU
acquisition as soon as the compiled WebGPU adapter is available. This hides
roughly 0.1–0.35 s in current samples without changing shader math, scene
quality, or the public event ABI.
