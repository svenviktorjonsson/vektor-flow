# MAT070O: procedural-wood spectral lowering

Status: private 0.6 procedural-material lowering tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, shared compiler behavior, shared
0.4.1 renderer/runtime, rabbit example, or gallery changed.

## Lowering seam

`procedural-wood-spectral-lowering:v1` consumes one existing procedural wood
material packet, its verified `wood-polarization-gpu:v1` intermediate, and the
corresponding GPU result. It performs the already-proven visible integration
and presentation stages, emits `wood-spectral-presentation-gpu:v1`, attaches
that descriptor to the matching triangle renderer packet, and returns one
immutable lowering receipt.

The existing validators remain authoritative at every boundary:

- polarization output must retain physical and f32 fixture parity;
- presentation must retain bounded linear HDR and valid exposure;
- triangle generation must stay within the explicit triangle budget; and
- the emitted spectral descriptor must refer to the same source material as
  the renderer packet.

No author-facing constructor or property is introduced. This is a private
lowering seam for later approved compiler integration.

## TDD and hidden WebGPU evidence

The focused test first failed with `ERR_MODULE_NOT_FOUND` for the new lowering.
The minimal implementation then emitted the established 1,456-byte descriptor
from a generated wood material and preserved the exact polarization record
bytes at its versioned offset.

```text
11 passed, 0 failed
```

The hidden Edge WebGPU fixture now obtains the scheduled renderer packet only
through the private lowering. Two real scene frames consume the emitted
descriptor, retain one binding, preserve the visible HDR result, and release
every owned resource:

```json
{"outcome":"pass",
 "rendererLoweringKind":"procedural-wood-spectral-lowering:v1",
 "bundledBytes":1456,
 "bundledMaxAbsoluteError":1.4901161194e-7,
 "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
 "rendererSceneFrames":[0,1],
 "rendererBindingReused":true,
 "rendererGpuLifetime":{
   "completedFrames":2,
   "destroyed":true,
   "drawPipeline":{
     "bindingCreations":1,
     "bindingReuses":1,
     "destroyed":true,
     "arena":{
       "liveResources":0,
       "createdBuffers":1,
       "destroyedBuffers":1,
       "uploadedBytes":1456}}}}
```

The fixture ran off-screen and opened no visible UI. Windows deferred deletion
of its locked temporary Edge profile after the successful evidence; GPU parity
and teardown counters were unaffected.

The full related spectral, polarization, renderer, scheduler, and lowering
regression also passed together:

```text
40 passed, 0 failed
```

## Acceptance-gate impact

The private 0.6 path now has one compiler-shaped lowering receipt from an
existing procedural material packet to the versioned GPU descriptor consumed
by the retained scene-frame scheduler. Conservative estimated 0.6.0 completion
is **52.9%**, up **0.4 percentage points** from MAT070N's 52.5%. Integration
into the approved shared compiler, released-scene presentation/capture, and
the user-visible procedural generator acceptance scene remain open.
