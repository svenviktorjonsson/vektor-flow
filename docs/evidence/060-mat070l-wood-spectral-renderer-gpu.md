# MAT070L: wood spectral renderer GPU lifetime

Status: private 0.6 procedural-material GPU resource tracer. No public VKF
syntax, material property, schema, ABI, diagnostic, compiler lowering, shared
0.4.1 renderer/runtime, rabbit example, or gallery changed.

## Shared resource arena

`wood-spectral-renderer-gpu-arena:v1` owns private WebGPU resources for the
attached `wood_spectral_presentation_gpu` sidecar. It has an explicit resource
budget from 1 through 256 and keys resources by descriptor identity.

Acquiring two retained packets that share one descriptor creates and uploads
one storage buffer. Each acquisition has its own immutable handle. Releasing
one handle keeps the buffer alive; releasing the final handle destroys it and
removes the descriptor from the arena. Releasing a handle twice is rejected.

The draw-binding operation consumes a live handle and creates the actual group
zero binding used by the MAT070J shader:

```text
binding 0: shared spectral material storage buffer
binding 1: draw output storage buffer
```

The mock-device test proves one creation, one upload, shared buffer identity,
one bind group, no early destruction, exact final destruction, and zero live
resources or acquisitions after release.

## Off-screen WebGPU evidence

The hidden Edge fixture now uploads and binds the retained renderer packet only
through the resource arena. It no longer creates the spectral material buffer
or bind group directly.

```json
{"outcome":"pass","rendererTriangleCount":8,
 "bundledBytes":1456,
 "bundledMaxAbsoluteError":1.4901161194e-7,
 "rendererGpuLifetime":{
   "resourceBudget":1,
   "liveResources":0,
   "liveAcquisitions":0,
   "createdBuffers":1,
   "destroyedBuffers":1,
   "uploadedBytes":1456,
   "drawBindings":1}}
```

The fixture ran headlessly with no visible window. The established Windows
temporary-profile cleanup deferred a locked directory after successful GPU
evidence; parity and lifetime counters were unaffected.

Relevant regression evidence is recorded after the full wood renderer packet,
spectral/polarization stack, and lifetime test pass together:

```text
37 passed, 0 failed
```

## Acceptance-gate impact

The retained 0.6 renderer packet now has bounded shared GPU allocation,
last-reference destruction, and the bind group that consumes its spectral
descriptor in a verified shader invocation. Conservative estimated 0.6.0
completion is **51.7%**, up **0.4 percentage points** from MAT070K's 51.3%.
Shared draw-pipeline integration, compiler consumption, multi-frame retention,
and released-scene captures remain open.
