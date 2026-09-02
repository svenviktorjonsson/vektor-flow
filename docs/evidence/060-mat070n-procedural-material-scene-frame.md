# MAT070N: procedural-material scene-frame scheduler

Status: private 0.6 procedural-material scene tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, compiler lowering, shared 0.4.1
renderer/runtime, rabbit example, or gallery changed.

## Shared scene-frame seam

`procedural-material-scene-frame-scheduler:v1` is the missing private 0.6
scene ownership layer above MAT070M's retained draw coordinator. It accepts an
injected frame scheduler, owns the draw pipeline, assigns monotonic frame
identifiers, and serializes scene-frame submission through a bounded queue.

The hard frame budget is 1 through 64. A request beyond that bound is rejected
instead of growing an unbounded working set. Each completed receipt retains its
frame timestamp, draw receipt, and submitted output. Destruction rejects queued
work, owns final draw-pipeline teardown, and rejects future requests. Teardown
during an active asynchronous submission is rejected explicitly.

The reference test drives two queued scene frames through one retained binding.
Both retain the same linear HDR result, the draw coordinator receives frame
zero then frame one, and final destruction reaches the owned pipeline.

## Hidden WebGPU evidence

The established headless Edge fixture injects real `requestAnimationFrame` as
the scheduler and submits two WebGPU scene frames. Frame one's material buffer
and bind group are reused by frame two. The visible linear HDR result remains
the established spectral wood value before presentation:

```json
{"outcome":"pass","rendererSceneFrames":[0,1],
 "rendererBindingReused":true,
 "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
 "bundledMaxAbsoluteError":1.4901161194e-7,
 "rendererGpuLifetime":{
   "frameBudget":2,
   "pendingFrames":0,
   "completedFrames":2,
   "nextFrame":2,
   "destroyed":true,
   "drawPipeline":{
     "frames":2,
     "draws":2,
     "bindingCreations":1,
     "bindingReuses":1,
     "destroyed":true,
     "arena":{
       "liveResources":0,
       "liveAcquisitions":0,
       "createdBuffers":1,
       "destroyedBuffers":1,
       "uploadedBytes":1456,
       "drawBindings":1}}}}
```

The fixture ran off-screen and opened no visible UI. The established Windows
temporary-profile cleanup deferred a locked directory after successful GPU
evidence; shader parity and lifetime evidence were unaffected.

Focused RED evidence was `ERR_MODULE_NOT_FOUND` for the new private scheduler.
After the minimal implementation, the scheduler and retained spectral renderer
slice passed together:

```text
10 passed, 0 failed
```

The full spectral, polarization, renderer, and scheduler regression also passed
together:

```text
39 passed, 0 failed
```

## Acceptance-gate impact

The private 0.6 procedural-material renderer now crosses an actual asynchronous
scene-frame scheduling boundary, preserves visible HDR output across frames,
reuses bounded GPU state, and tears its scene-owned state down
deterministically.
Conservative estimated 0.6.0 completion is **52.5%**, up **0.4 percentage
points** from MAT070M's 52.1%. Compiler consumption, released-scene
presentation/capture, and the user-visible procedural generator acceptance
scene remain open.
