# MAT070P: procedural-material released-scene capture

Status: private 0.6 procedural-material capture tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, shared compiler behavior, shared
0.4.1 renderer/runtime, rabbit example, or gallery changed.

## Capture seam

`procedural-material-scene-capture:v1` consumes a completed private scene-frame
receipt and the corresponding spectral presentation. It converts display-linear
RGB through the standard sRGB transfer curve, produces an RGBA image, and uses
the repository `createSceneMediaCapture` path to encode an in-memory PNG.

The receipt retains:

- the encoded image byte array, MIME type, dimensions, byte length, and SHA-256;
- the unclipped linear HDR RGB used by lighting;
- the display-linear RGB and exposure used only for presentation; and
- the exact completed scene frame that was captured.

The hard capture budget is 16,777,216 pixels. Invalid or unfinished frame
receipts, invalid presentation values, and captures beyond that bound are
rejected before allocating an image.

## TDD and off-screen evidence

The focused test first failed with `ERR_MODULE_NOT_FOUND`. The minimal helper
then produced identical image bytes and hashes for two captures of the same
completed scene frame while retaining its HDR metadata.

```text
15 passed, 0 failed
```

The hidden Edge WebGPU fixture now captures the frame emitted by MAT070O and
completed by MAT070N twice through the repository capture system. Both encoded
PNGs remain in memory; no screenshot file is written and no window is opened.

```json
{"outcome":"pass",
 "rendererLoweringKind":"procedural-wood-spectral-lowering:v1",
 "rendererSceneFrames":[0,1],
 "rendererCapture":{
   "kind":"procedural-material-scene-capture:v1",
   "mimeType":"image/png",
   "width":4,
   "height":4,
   "byteLength":110,
   "repeatMatched":true,
   "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
   "displayLinearRgb":[0.3646416050,0.2344417606,0.0702097533],
   "exposureStops":1}}
```

Both encoded PNGs had SHA-256:

`60eddcd95d70d035fff6469b876238d29ba5d8f3696d0dadea8f4c46fcf63656`

An independent second headless Edge process produced the same byte length and
hash, so the identity is stable both within and across capture runs.

The full related capture, spectral, polarization, renderer, scheduler, and
lowering regression also passed together:

```text
44 passed, 0 failed
```

Windows deferred deletion of the locked temporary Edge profile after the
successful evidence; PNG identity, HDR metadata, shader parity, and teardown
counters were unaffected.

## Acceptance-gate impact

The private 0.6 procedural-material path now lowers, schedules, renders, and
captures one released spectral scene result with deterministic encoded-image
identity and explicit HDR/presentation provenance. Conservative estimated
0.6.0 completion is **53.3%**, up **0.4 percentage points** from MAT070O's
52.9%. Approved shared-compiler integration and the complete user-visible
procedural generator acceptance scene remain open.
