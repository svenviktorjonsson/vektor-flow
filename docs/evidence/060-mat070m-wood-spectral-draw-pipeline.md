# MAT070M: wood spectral multi-frame draw pipeline

Status: private 0.6 procedural-material draw tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, compiler lowering, shared 0.4.1
renderer/runtime, rabbit example, or gallery changed.

## Multi-frame retention

`wood-spectral-renderer-draw-pipeline:v1` coordinates retained renderer packets
above MAT070L's resource arena. It has a hard packet budget from 1 through
1,024; that same bound limits concurrent cached bindings.

The first draw retains the packet acquisition and creates a bind group keyed by
material buffer, pipeline, and output-buffer identity. Later frames with the
same identities reuse both the uploaded material buffer and bind group. Frame
identifiers must be non-negative and non-decreasing.

Releasing a packet removes its acquisition and cached bindings when the final
packet using that material buffer leaves. Pipeline destruction releases every
retained packet, clears binding state, destroys final arena resources, and is
idempotent. Draws after destruction are rejected.

The mock-device TDD slice proves two frames cause exactly one buffer creation,
one upload, and one bind-group creation; the second frame reports bind reuse.
No GPU allocation or upload occurs per frame. Teardown performs one final
buffer destruction and leaves no retained packet, bind, or arena resource.

## Hidden WebGPU evidence

The headless fixture submits two real compute frames through the retained draw
pipeline. It waits for frame zero, submits frame one with the same bind group,
reads frame one's output, verifies color parity, then tears the pipeline down.

```json
{"outcome":"pass","rendererBindingReused":true,
 "bundledMaxAbsoluteError":1.4901161194e-7,
 "rendererGpuLifetime":{
   "packetBudget":1,
   "retainedPackets":0,
   "liveBindings":0,
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
     "drawBindings":1}}}
```

The fixture ran in headless Edge with no visible window. The established
Windows temporary-profile cleanup deferred a locked directory after successful
GPU evidence; parity and lifetime counters were unaffected.

Relevant regression evidence is recorded after the wood renderer packet,
spectral/polarization stack, resource arena, and draw pipeline pass together:

```text
38 passed, 0 failed
```

## Acceptance-gate impact

The private 0.6 procedural-material path now retains the spectral GPU resource
and binding across real frames without per-frame allocation or upload, then
tears it down deterministically. Conservative estimated 0.6.0 completion is
**52.1%**, up **0.4 percentage points** from MAT070L's 51.7%. Integration into
the shared renderer's actual scene-frame scheduler, compiler consumption, and
released-scene capture evidence remain open.
