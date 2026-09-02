# MAT070R: wood per-fragment procedural field

Status: private 0.6 procedural-material graphics tracer. No public VKF syntax,
material property, schema, ABI, diagnostic, shared compiler behavior, shared
0.4.1 renderer/runtime, rabbit example, or gallery changed.

## Field transport

MAT070Q rendered actual wood triangles with one presentation-color swatch.
MAT070R carries every generated vertex base color from the retained material
packet into the graphics vertex stream and interpolates that field across the
actual triangle fragments.

The fragment shader normalizes each interpolated base color against the exact
wood sample that produced the spectral descriptor. The bounded ratio modulates
the already tone-mapped spectral presentation, preserving the center sample
while exposing spatial wood variation. The ratio is clamped from 0.5 through
1.5 and the display-linear result remains bounded from zero through one.

Roughness remains unchanged in the procedural material packet and is not used
as a brightness multiplier in this unlit diagnostic pass. Its established
semantics require an angular light/view response, which belongs in the next
lit per-fragment slice.

The private vertex layout is five f32 lanes, or 20 bytes:

```text
ndc_x, ndc_y, base_r, base_g, base_b
```

The fragment uniform is two aligned vec4 records: display-linear spectral RGBA
followed by the source sample's base RGB and one padding lane. Existing scene
vertex, triangle, pixel, readback, and capture bounds remain unchanged.

## TDD and hidden WebGPU evidence

The updated fixture first failed because the packet scene exposed only its old
position-only stride. GREEN pins the exact interleaved field bytes, 20-byte
stride, reference sample, and WGSL field inputs.

The hidden Edge renderer compiled the field shader and captured two identical
images. The wood geometry still occupies 2,704 of 4,096 pixels, while the
foreground now contains 67 distinct encoded RGB colors rather than one swatch.

```json
{"outcome":"pass",
 "rendererTriangleCount":8,
 "rendererCapture":{
   "width":64,
   "height":64,
   "byteLength":2702,
   "renderedPixels":2704,
   "foregroundColorCount":67,
   "repeatMatched":true,
   "linearHdrRgb":[0.2869574148,0.1844956818,0.0552520860],
   "displayLinearRgb":[0.3646416050,0.2344417606,0.0702097533]}}
```

Both captures produced SHA-256:

`2db51c250aedbac6dec679b01ff561fbfff2875325e5f45cb4b305ef29ccf57f`

One initial hidden run emitted a transient adapter parser message for a token
absent from every submitted shader. Line-aware scene-shader diagnostics were
retained; the next two independent hidden runs compiled, rendered, and produced
the identical hash above.

The full related capture, spectral, polarization, renderer, scheduler,
lowering, and per-fragment scene regression passed together:

```text
46 passed, 0 failed
```

## Acceptance-gate impact

The private 0.6 path now carries a generated material field across actual GPU
fragments instead of displaying a packet-level swatch. Conservative estimated
0.6.0 completion is **54.6%**, up **0.6 percentage points** from MAT070Q's
54.0%. Per-fragment angular roughness/normal response, approved shared-compiler
integration, and the complete released stone/tree/forest/road scene remain
open.
