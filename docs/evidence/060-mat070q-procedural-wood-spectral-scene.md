# MAT070Q: procedural-wood spectral scene

Status: private 0.6 procedural-material graphics tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, shared compiler behavior, shared
0.4.1 renderer/runtime, rabbit example, or gallery changed.

## Acceptance gap selected

After MAT070P, capture identity was proven only for a presentation-color image.
The next smallest acceptance gap was to prove that the lowered spectral result
colors actual generated geometry before capture. This directly advances the
0.6 geometry-and-material scene experience without introducing author syntax.

## Bounded spectral scene

`procedural-wood-spectral-scene:v1` consumes the MAT070O lowering receipt. It
projects the existing wood triangle packet in its retained tangent frame,
preserves display aspect, and supplies the lowered display-linear spectral
color to a private vertex/fragment pipeline.

Bounds are explicit:

- at most 65,536 vertices and 131,072 triangles;
- at most 1,048,576 output pixels;
- one retained index array from the source renderer packet; and
- a 256-byte-aligned texture readback row with an exact byte receipt.

The render target is `rgba8unorm-srgb`, so the shader remains linear while the
stored image receives the standard display transfer. The capture seam now also
accepts an exact tightly packed GPU RGBA array; it still records the unclipped
HDR and display metadata separately.

## TDD and off-screen WebGPU evidence

The fixture test first failed with `ERR_MODULE_NOT_FOUND`. The minimal scene
fixture then proved bounded, aspect-correct tangent projection and the expected
private WGSL entry points. A second RED test proved the MAT070P capture helper
was replacing supplied GPU pixels with a color swatch; GREEN preserves exact
GPU scene pixels.

The hidden Edge fixture compiled a real render pipeline, drew all eight wood
triangles into a 64 by 64 sRGB texture, copied the texture to a mapped buffer,
removed row padding, and passed those pixels through the repository capture
system. The geometry occupied 2,704 of 4,096 pixels, proving both foreground
and background remained visible.

```json
{"outcome":"pass",
 "rendererTriangleCount":8,
 "rendererSceneFrames":[0,1],
 "rendererCapture":{
   "mimeType":"image/png",
   "width":64,
   "height":64,
   "byteLength":414,
   "renderedPixels":2704,
   "repeatMatched":true,
   "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
   "displayLinearRgb":[0.3646416050,0.2344417606,0.0702097533]}}
```

Both captures and a second independent hidden Edge process produced SHA-256:

`1e673f75acefb456cb42b3d97d13bc74e624e6f1e46828f4f0eb7b0b6d4839e8`

The full related capture, spectral, polarization, renderer, scheduler,
lowering, and scene regression passed together:

```text
46 passed, 0 failed
```

Windows deferred deletion of the locked temporary Edge profiles after the
successful evidence; pixels, hashes, HDR metadata, and teardown counters were
unaffected.

## Acceptance-gate impact

The private 0.6 path now produces a deterministic captured image from actual
procedural geometry carrying the lowered spectral presentation. Conservative
estimated 0.6.0 completion is **54.0%**, up **0.7 percentage points** from
MAT070P's 53.3%. This slice deliberately uses one uniform spectral result over
the cut. Per-fragment procedural fields, approved shared-compiler integration,
and the complete released stone/tree/forest/road scene remain open.
